/**
 * HLS Broadcaster (webinar) — siarkan panggung mediasoup ke HLS untuk ribuan
 * PENONTON (view-only) lewat CDN.
 *
 * Alur: mediasoup Router --(PlainTransport, RTP)--> ffmpeg --(transcode H264/AAC)--> HLS
 *   - PlainTransport (rtcpMux) kirim RTP ke port lokal yang didengar ffmpeg via SDP.
 *   - ffmpeg transcode (VP8/Opus → H264/AAC) dan tulis segmen HLS ke storage/hls/<roomId>/.
 *   - Express menyajikan /hls/<roomId>/index.m3u8 (lalu di-depan-i CDN).
 *
 * Fitur (Stage 3):
 *   - Auto-start: dipicu otomatis saat peserta panggung mulai publish (lihat socket).
 *   - Active-speaker SMOOTH: ganti sumber via swap RTP pada PlainTransport yang sama
 *     (tanpa restart ffmpeg) → tanpa blip; fallback ke restart bila codec tak cocok.
 *   - Gallery: komposit beberapa pembicara jadi grid via ffmpeg filter_complex (xstack).
 *
 * PRASYARAT SERVER: `apt install ffmpeg`. Set MEDIASOUP_ANNOUNCED_IP utk RTC tetap.
 * Catatan: pipa ffmpeg/RTP ini WAJIB diuji di server (tak bisa diverifikasi lokal).
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const mediasoupService = require('./mediasoup.service');

const HLS_ROOT = path.join(__dirname, '../../storage/hls');
const REC_ROOT = path.join(__dirname, '../../storage/recordings');
const FFMPEG_BIN = process.env.FFMPEG_PATH || 'ffmpeg';
// Rentang port lokal RTP server→ffmpeg (PISAH dari RTC 10000–10500).
const BASE_PORT = parseInt(process.env.HLS_RTP_BASE_PORT || '41000', 10);
const PORT_RANGE = 1000;
// Auto-start siaran saat ada media panggung (matikan dengan HLS_AUTOSTART=0).
const AUTOSTART = process.env.HLS_AUTOSTART !== '0';
// Maks. tile pada mode galeri (CPU origin naik per tile).
const GALLERY_MAX = Math.max(1, parseInt(process.env.HLS_GALLERY_MAX || '4', 10));
// Ukuran tiap sel grid galeri.
const CELL_W = parseInt(process.env.HLS_GALLERY_CELL_W || '640', 10);
const CELL_H = parseInt(process.env.HLS_GALLERY_CELL_H || '360', 10);

class HlsBroadcaster {
  constructor() {
    // roomId -> session { ffmpeg, transports:[], consumers:[], dir, ports:[],
    //                      sourcePeerId, guard, record, recPath, layout, media, gridSig }
    this.sessions = new Map();
    this.usedPorts = new Set();      // port RTP yang sedang dipakai (hindari tabrakan)
    this.switchTimers = new Map();   // roomId -> debounce timer active-speaker
    this.manualStopped = new Set();  // roomId yang dihentikan host (jangan auto-start ulang)

    // Active-speaker: saat pembicara dominan berubah, alihkan sumber siaran.
    mediasoupService.on('dominant-speaker', ({ roomId, peerId }) => {
      this.switchSource(roomId, peerId);
    });
  }

  isLive(roomId) {
    return this.sessions.has(roomId);
  }

  getLayout(roomId) {
    return this.sessions.get(roomId)?.layout || null;
  }

  /**
   * Mulai siaran otomatis (dipanggil saat peserta panggung publish media).
   * Diam-diam abaikan bila sudah live, dihentikan manual, atau belum ada media.
   */
  async autoStart(roomId, options = {}) {
    if (!AUTOSTART) return;
    if (this.sessions.has(roomId) || this.manualStopped.has(roomId)) return;
    try {
      await this.startBroadcast(roomId, null, options);
    } catch {
      /* belum ada media / belum siap — wajar, akan dicoba lagi pada produce berikutnya */
    }
  }

  /** Alihkan sumber siaran ke pembicara dominan (debounce agar tak flapping). */
  switchSource(roomId, peerId) {
    const s = this.sessions.get(roomId);
    if (!s || s.layout === 'gallery') return; // galeri menampilkan semua → tak perlu switch
    if (s.sourcePeerId === peerId) return;
    clearTimeout(this.switchTimers.get(roomId));
    this.switchTimers.set(roomId, setTimeout(() => {
      this.switchTimers.delete(roomId);
      this._swapSource(roomId, peerId);
    }, 1500));
  }

  /**
   * Ganti sumber active-speaker MULUS: konsumsi producer baru pada PlainTransport
   * (port) yang sama → ffmpeg terus membaca port yang sama, tanpa restart.
   * Bila codec/payload sumber baru tak cocok dengan SDP yang sudah dibaca ffmpeg,
   * fallback ke restart penuh (perilaku lama).
   */
  async _swapSource(roomId, peerId) {
    const s = this.sessions.get(roomId);
    if (!s || s.sourcePeerId === peerId) return;
    const room = mediasoupService.getRoom(roomId);
    const peer = room?.peers?.get(peerId);
    if (!room || !peer) return;

    let newVideo = null;
    let newAudio = null;
    for (const [, prod] of peer.producers) {
      if (prod.kind === 'video' && !newVideo) newVideo = prod;
      if (prod.kind === 'audio' && !newAudio) newAudio = prod;
    }

    try {
      const router = room.router;
      const swapKind = async (kind, newProducer) => {
        const slot = s.media?.[kind];
        if (!slot || !newProducer) return;          // tak ada slot/sumber → pertahankan yang lama
        if (slot.producerId === newProducer.id) return;
        const newConsumer = await slot.transport.consume({
          producerId: newProducer.id,
          rtpCapabilities: router.rtpCapabilities,
          paused: false,
        });
        const newPt = newConsumer.rtpParameters.codecs[0].payloadType;
        if (newPt !== slot.payloadType) {
          // SDP ffmpeg memetakan payload-type lama; sumber baru beda → batalkan swap.
          try { newConsumer.close(); } catch { /* noop */ }
          throw new Error('payload-mismatch');
        }
        const old = slot.consumer;
        slot.consumer = newConsumer;
        slot.producerId = newProducer.id;
        s.consumers = s.consumers.filter((c) => c !== old);
        s.consumers.push(newConsumer);
        try { old.close(); } catch { /* noop */ }
        if (newConsumer.requestKeyFrame) newConsumer.requestKeyFrame().catch(() => {});
      };
      await swapKind('video', newVideo);
      await swapKind('audio', newAudio);
      s.sourcePeerId = peerId;
      console.log(`[HLS ${roomId}] swap active-speaker → ${peerId} (tanpa restart ffmpeg).`);
    } catch (e) {
      console.warn(`[HLS ${roomId}] swap gagal (${e.message}); fallback restart.`);
      const wasRecording = !!s.record;
      const layout = s.layout;
      // Jangan hapus segmen (purge=false) agar pemutar penonton tak 404 saat switch.
      this.stopBroadcast(roomId, { purge: false });
      try { await this.startBroadcast(roomId, peerId, { record: wasRecording, layout }); }
      catch (err) { console.error(`[HLS ${roomId}] fallback restart gagal:`, err.message); }
    }
  }

  /** Ambil port genap bebas dalam rentang (lacak agar webinar paralel tak tabrakan). */
  _allocPort() {
    for (let p = BASE_PORT; p <= BASE_PORT + PORT_RANGE; p += 2) {
      if (!this.usedPorts.has(p)) {
        this.usedPorts.add(p);
        return p;
      }
    }
    throw new Error('Tidak ada port RTP HLS yang tersedia (terlalu banyak siaran paralel).');
  }

  /** Pilih 1 video + 1 audio dari panggung (utamakan peer target/dominan). */
  _collectSpeaker(room, preferredPeerId) {
    const target = preferredPeerId || room.dominantPeerId;
    let videoProducer = null;
    let audioProducer = null;
    const pick = (peer) => {
      if (!peer) return;
      for (const [, prod] of peer.producers) {
        if (prod.kind === 'video' && !videoProducer) videoProducer = prod;
        if (prod.kind === 'audio' && !audioProducer) audioProducer = prod;
      }
    };
    if (target && room.peers.has(target)) pick(room.peers.get(target));
    if (!videoProducer || !audioProducer) {
      for (const [, peer] of room.peers) pick(peer);
    }
    return { video: videoProducer, audio: audioProducer, target: target || null };
  }

  /** Kumpulkan hingga GALLERY_MAX peer yang punya video (+ audio-nya) untuk grid. */
  _collectGallery(room) {
    const members = [];
    for (const [, peer] of room.peers) {
      let video = null;
      let audio = null;
      for (const [, prod] of peer.producers) {
        if (prod.kind === 'video' && !video) video = prod;
        if (prod.kind === 'audio' && !audio) audio = prod;
      }
      if (video) members.push({ video, audio });
      if (members.length >= GALLERY_MAX) break;
    }
    return members;
  }

  /** Tanda-tangan keanggotaan panggung (id producer video) → deteksi perubahan grid. */
  _galleryStageSig(room) {
    const ids = [];
    for (const [, peer] of room.peers) {
      for (const [, prod] of peer.producers) {
        if (prod.kind === 'video') ids.push(prod.id);
      }
    }
    return ids.sort().join(',');
  }

  /** Susun layout xstack untuk n tile seragam (sel sama ukuran). */
  _xstackLayout(n) {
    const cols = Math.ceil(Math.sqrt(n));
    const tokens = [];
    for (let i = 0; i < n; i++) {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const x = c === 0 ? '0' : Array(c).fill('w0').join('+');
      const y = r === 0 ? '0' : Array(r).fill('h0').join('+');
      tokens.push(`${x}_${y}`);
    }
    return tokens.join('|');
  }

  /**
   * Bangun filter_complex galeri.
   * @returns {{ fc:string, vH:?string, aH:?string, vR:?string, aR:?string }}
   *   vH/aH = label untuk output HLS; vR/aR = label untuk output rekaman (bila record).
   */
  _galleryFilter(n, m, record) {
    const parts = [];
    let vlabel = null;
    let alabel = null;

    if (n === 1) {
      parts.push(`[0:v:0]scale=${CELL_W}:${CELL_H},setsar=1[vout]`);
      vlabel = '[vout]';
    } else if (n > 1) {
      for (let i = 0; i < n; i++) parts.push(`[0:v:${i}]scale=${CELL_W}:${CELL_H},setsar=1[v${i}]`);
      const inputs = Array.from({ length: n }, (_, i) => `[v${i}]`).join('');
      parts.push(`${inputs}xstack=inputs=${n}:layout=${this._xstackLayout(n)}[vout]`);
      vlabel = '[vout]';
    }

    if (m === 1) {
      parts.push(`[0:a:0]anull[aout]`);
      alabel = '[aout]';
    } else if (m > 1) {
      const inputs = Array.from({ length: m }, (_, i) => `[0:a:${i}]`).join('');
      parts.push(`${inputs}amix=inputs=${m}:normalize=0[aout]`);
      alabel = '[aout]';
    }

    let vH = vlabel;
    let aH = alabel;
    let vR = null;
    let aR = null;
    if (record) {
      // Sebuah pad filter hanya bisa dikonsumsi sekali → split untuk 2 output.
      if (vlabel) { parts.push(`[vout]split=2[voutH][voutR]`); vH = '[voutH]'; vR = '[voutR]'; }
      if (alabel) { parts.push(`[aout]asplit=2[aoutH][aoutR]`); aH = '[aoutH]'; aR = '[aoutR]'; }
    }
    return { fc: parts.join(';'), vH, aH, vR, aR };
  }

  /** Opsi encode video x264 (low-latency) — dipakai berulang per output. */
  _videoEncodeArgs() {
    return [
      '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
      '-profile:v', 'baseline', '-level', '3.1', '-pix_fmt', 'yuv420p',
      '-r', '30', '-g', '30', '-keyint_min', '30', '-sc_threshold', '0',
      '-force_key_frames', 'expr:gte(t,n_forced*1)',
      '-b:v', '1500k', '-maxrate', '1800k', '-bufsize', '2000k',
    ];
  }

  _audioEncodeArgs() {
    return ['-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2'];
  }

  _hlsOutputArgs(dir) {
    return [
      '-f', 'hls',
      '-hls_time', '1',
      '-hls_list_size', '8',
      '-hls_flags', 'delete_segments+append_list+omit_endlist+independent_segments',
      '-hls_segment_type', 'mpegts',
      '-hls_segment_filename', path.join(dir, 'seg_%05d.ts'),
      path.join(dir, 'index.m3u8'),
    ];
  }

  /**
   * Mulai siaran HLS untuk sebuah room.
   * @param {string} roomId
   * @param {?string} preferredPeerId sumber awal (speaker layout)
   * @param {{ record?:boolean, layout?:'speaker'|'gallery' }} options
   * @returns {Promise<{ playlist:string, recording:boolean, layout:string }>}
   */
  async startBroadcast(roomId, preferredPeerId = null, options = {}) {
    const record = !!options.record;
    const layout = options.layout === 'gallery' ? 'gallery' : 'speaker';
    this.manualStopped.delete(roomId); // start eksplisit membatalkan suppress auto-start

    const existing = this.sessions.get(roomId);
    if (existing) {
      if (layout === existing.layout) {
        return { playlist: `/hls/${roomId}/index.m3u8`, recording: existing.record, layout: existing.layout };
      }
      // Ganti tata letak → restart (pertahankan segmen agar penonton tak 404).
      this.stopBroadcast(roomId, { purge: false });
    }

    const room = mediasoupService.getRoom(roomId);
    if (!room) throw new Error('Room mediasoup tidak ditemukan (belum ada peserta di panggung).');
    const router = room.router;

    const dir = path.join(HLS_ROOT, roomId);
    fs.mkdirSync(dir, { recursive: true });

    const session = {
      ffmpeg: null, transports: [], consumers: [], dir, ports: [], roomId,
      sourcePeerId: null, record, recPath: null, guard: null,
      layout, media: { video: null, audio: null }, gridSig: null,
    };

    // Buat PlainTransport + consumer untuk satu producer; kirim RTP ke port lokal ffmpeg.
    const setup = async (producer) => {
      const port = this._allocPort();
      const transport = await router.createPlainTransport({
        listenIp: { ip: '127.0.0.1' },
        rtcpMux: true,
        comedia: false,
      });
      await transport.connect({ ip: '127.0.0.1', port });
      const consumer = await transport.consume({
        producerId: producer.id,
        rtpCapabilities: router.rtpCapabilities,
        paused: false,
      });
      session.transports.push(transport);
      session.consumers.push(consumer);
      session.ports.push(port);
      return { transport, consumer, port, payloadType: consumer.rtpParameters.codecs[0].payloadType, producerId: producer.id };
    };

    const videoSlots = [];
    const audioSlots = [];
    try {
      if (layout === 'gallery') {
        const members = this._collectGallery(room);
        for (const mb of members) { if (mb.video) videoSlots.push(await setup(mb.video)); }
        for (const mb of members) { if (mb.audio) audioSlots.push(await setup(mb.audio)); }
        if (videoSlots.length === 0 && audioSlots.length === 0) {
          throw new Error('Tidak ada media di panggung untuk disiarkan.');
        }
        session.gridSig = this._galleryStageSig(room);
      } else {
        const { video, audio, target } = this._collectSpeaker(room, preferredPeerId);
        if (!video && !audio) throw new Error('Tidak ada media di panggung untuk disiarkan.');
        session.sourcePeerId = target;
        if (audio) { const s = await setup(audio); audioSlots.push(s); session.media.audio = s; }
        if (video) { const s = await setup(video); videoSlots.push(s); session.media.video = s; }
      }
    } catch (e) {
      this._releaseSession(session);
      throw e;
    }

    // SDP: audio dulu lalu video (indeks 0:a:N / 0:v:N mengikuti urutan ini per-tipe).
    const sdpMedia = [];
    audioSlots.forEach((s) => sdpMedia.push(this._sdpForConsumer(s.consumer, s.port)));
    videoSlots.forEach((s) => sdpMedia.push(this._sdpForConsumer(s.consumer, s.port)));
    const sdp = [
      'v=0',
      'o=- 0 0 IN IP4 127.0.0.1',
      's=mediasoup-hls',
      'c=IN IP4 127.0.0.1',
      't=0 0',
      ...sdpMedia,
    ].join('\n') + '\n';
    const sdpPath = path.join(dir, 'input.sdp');
    fs.writeFileSync(sdpPath, sdp);

    const hasVideo = videoSlots.length > 0;
    const hasAudio = audioSlots.length > 0;

    const args = [
      '-loglevel', 'warning',
      '-protocol_whitelist', 'file,udp,rtp',
      '-fflags', '+genpts',
      '-i', sdpPath,
    ];

    if (layout === 'gallery') {
      const g = this._galleryFilter(videoSlots.length, audioSlots.length, record);
      args.push('-filter_complex', g.fc);
      // Output HLS
      if (g.vH) args.push('-map', g.vH);
      if (g.aH) args.push('-map', g.aH);
      if (g.vH) args.push(...this._videoEncodeArgs());
      if (g.aH) args.push(...this._audioEncodeArgs());
      args.push(...this._hlsOutputArgs(dir));
      // Output rekaman (opsional)
      if (record) {
        fs.mkdirSync(REC_ROOT, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        session.recPath = path.join(REC_ROOT, `${roomId}_${stamp}.mp4`);
        if (g.vR) args.push('-map', g.vR);
        if (g.aR) args.push('-map', g.aR);
        if (g.vR) args.push(...this._videoEncodeArgs());
        if (g.aR) args.push(...this._audioEncodeArgs());
        args.push('-movflags', '+faststart', session.recPath);
      }
    } else {
      // Speaker: 1 sumber, tanpa filter (mapping default ffmpeg).
      if (hasVideo) args.push(...this._videoEncodeArgs());
      if (hasAudio) args.push(...this._audioEncodeArgs());
      args.push(...this._hlsOutputArgs(dir));
      if (record) {
        fs.mkdirSync(REC_ROOT, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        session.recPath = path.join(REC_ROOT, `${roomId}_${stamp}.mp4`);
        if (hasVideo) args.push(...this._videoEncodeArgs());
        if (hasAudio) args.push(...this._audioEncodeArgs());
        args.push('-movflags', '+faststart', session.recPath);
      }
    }

    const ff = spawn(FFMPEG_BIN, args);
    session.ffmpeg = ff;
    ff.stderr.on('data', (d) => {
      const line = d.toString();
      if (/error|failed|invalid/i.test(line)) console.error(`[HLS ${roomId}] ffmpeg:`, line.trim());
    });
    ff.on('exit', (code, signal) => {
      console.log(`[HLS ${roomId}] ffmpeg exit code=${code} signal=${signal}`);
      // Hanya cleanup bila sesi ini masih aktif (hindari merusak sesi baru saat switch).
      if (this.sessions.get(roomId) === session) this._cleanup(roomId);
    });

    // Pengawas berkala: auto-stop saat panggung kosong; refresh grid saat anggota berubah.
    session.guard = setInterval(() => {
      const r = mediasoupService.getRoom(roomId);
      let hasMedia = false;
      if (r) {
        for (const [, peer] of r.peers) {
          if (peer.producers.size > 0) { hasMedia = true; break; }
        }
      }
      if (!hasMedia) {
        console.log(`[HLS ${roomId}] auto-stop: tidak ada media di panggung.`);
        this.manualStopped.delete(roomId); // panggung kosong → reset agar siklus berikut bisa auto-start
        this.stopBroadcast(roomId, { purge: true });
        return;
      }
      // Galeri: bila keanggotaan panggung berubah, bangun ulang grid (restart ffmpeg).
      if (this.sessions.get(roomId) === session && session.layout === 'gallery') {
        const sig = this._galleryStageSig(r);
        if (sig !== session.gridSig) {
          console.log(`[HLS ${roomId}] panggung berubah → bangun ulang galeri.`);
          const wasRecording = session.record;
          this.stopBroadcast(roomId, { purge: false });
          this.startBroadcast(roomId, null, { record: wasRecording, layout: 'gallery' })
            .catch((e) => console.error(`[HLS ${roomId}] refresh galeri gagal:`, e.message));
        }
      }
    }, 5000);
    if (session.guard.unref) session.guard.unref();

    this.sessions.set(roomId, session);
    console.log(`[HLS ${roomId}] broadcast dimulai (layout=${layout}, video=${videoSlots.length}, audio=${audioSlots.length}, record=${record}).`);
    return { playlist: `/hls/${roomId}/index.m3u8`, recording: record, layout };
  }

  /** Bangun blok SDP m= untuk satu consumer (codec & payload dari rtpParameters). */
  _sdpForConsumer(consumer, port) {
    const codec = consumer.rtpParameters.codecs[0];
    const pt = codec.payloadType;
    const kind = consumer.kind;
    const encName = codec.mimeType.split('/')[1]; // VP8, opus, H264, ...
    const lines = [];
    if (kind === 'audio') {
      lines.push(`m=audio ${port} RTP/AVP ${pt}`);
      lines.push(`a=rtpmap:${pt} ${encName}/${codec.clockRate}/${codec.channels || 2}`);
    } else {
      lines.push(`m=video ${port} RTP/AVP ${pt}`);
      lines.push(`a=rtpmap:${pt} ${encName}/${codec.clockRate}`);
    }
    const fmtp = Object.entries(codec.parameters || {})
      .map(([k, v]) => `${k}=${v}`)
      .join(';');
    if (fmtp) lines.push(`a=fmtp:${pt} ${fmtp}`);
    lines.push('a=rtcp-mux');
    lines.push('a=recvonly');
    return lines.join('\n');
  }

  /** Tutup transport/consumer & lepas port untuk sesi yang gagal/dibuang (belum di-set). */
  _releaseSession(session) {
    if (!session) return;
    if (session.guard) { clearInterval(session.guard); session.guard = null; }
    session.consumers.forEach((c) => { try { c.close(); } catch { /* noop */ } });
    session.transports.forEach((t) => { try { t.close(); } catch { /* noop */ } });
    (session.ports || []).forEach((p) => this.usedPorts.delete(p));
  }

  stopBroadcast(roomId, { purge = true, manual = false } = {}) {
    if (manual) this.manualStopped.add(roomId);
    const s = this.sessions.get(roomId);
    if (!s) return;
    if (s.ffmpeg && !s.ffmpeg.killed) {
      try { s.ffmpeg.kill('SIGINT'); } catch { /* noop */ }
    }
    this._cleanup(roomId, { purge });
    console.log(`[HLS ${roomId}] broadcast dihentikan${manual ? ' (manual)' : ''}.`);
  }

  _cleanup(roomId, { purge = false } = {}) {
    const s = this.sessions.get(roomId);
    if (!s) return;
    if (s.guard) { clearInterval(s.guard); s.guard = null; }
    s.consumers.forEach((c) => { try { c.close(); } catch { /* noop */ } });
    s.transports.forEach((t) => { try { t.close(); } catch { /* noop */ } });
    (s.ports || []).forEach((p) => this.usedPorts.delete(p));
    this.sessions.delete(roomId);

    // Bersihkan segmen HLS di disk saat stop sungguhan (purge), beri jeda agar
    // permintaan terakhir penonton selesai. Rekaman MP4 (recPath) TIDAK dihapus.
    if (purge) {
      setTimeout(() => {
        if (this.sessions.has(roomId)) return; // siaran baru sudah jalan, jangan hapus
        try { fs.rmSync(s.dir, { recursive: true, force: true }); } catch { /* noop */ }
      }, 8000);
    }
  }
}

module.exports = new HlsBroadcaster();
