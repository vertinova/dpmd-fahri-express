/**
 * HLS Broadcaster (Stage 2 webinar) — siarkan panggung mediasoup ke HLS untuk
 * ribuan PENONTON (view-only) lewat CDN.
 *
 * Alur: mediasoup Router --(PlainTransport, RTP)--> ffmpeg --(transcode H264/AAC)--> HLS
 *   - Ambil 1 video + 1 audio producer dari panggung (v1: producer pertama yg ada).
 *   - PlainTransport (rtcpMux) kirim RTP ke port lokal yang didengar ffmpeg via SDP.
 *   - ffmpeg transcode (VP8/Opus → H264/AAC) dan tulis segmen HLS ke storage/hls/<roomId>/.
 *   - Express menyajikan /hls/<roomId>/index.m3u8 (lalu di-depan-i CDN).
 *
 * PRASYARAT SERVER: `apt install ffmpeg`. Set MEDIASOUP_ANNOUNCED_IP utk RTC tetap.
 * Catatan: v1 menyiarkan SATU sumber (active-speaker switching = Stage 3).
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

class HlsBroadcaster {
  constructor() {
    // roomId -> { ffmpeg, transports:[], consumers:[], dir, ports:[], sourcePeerId, guard, recPath }
    this.sessions = new Map();
    this.usedPorts = new Set(); // port RTP yang sedang dipakai (hindari tabrakan)
    this.switchTimers = new Map(); // roomId -> debounce timer

    // Active-speaker: saat pembicara dominan berubah, alihkan sumber siaran.
    mediasoupService.on('dominant-speaker', ({ roomId, peerId }) => {
      this.switchSource(roomId, peerId);
    });
  }

  /** Alihkan sumber siaran ke pembicara dominan (debounce agar tak flapping). */
  switchSource(roomId, peerId) {
    const s = this.sessions.get(roomId);
    if (!s || s.sourcePeerId === peerId) return;
    clearTimeout(this.switchTimers.get(roomId));
    this.switchTimers.set(roomId, setTimeout(async () => {
      this.switchTimers.delete(roomId);
      if (!this.sessions.has(roomId)) return;
      const wasRecording = !!s.record;
      console.log(`[HLS ${roomId}] alihkan active-speaker → ${peerId}`);
      // Saat switch, jangan hapus segmen (purge=false) agar pemutar penonton tak 404.
      this.stopBroadcast(roomId, { purge: false });
      try { await this.startBroadcast(roomId, peerId, { record: wasRecording }); }
      catch (e) { console.error(`[HLS ${roomId}] gagal switch:`, e.message); }
    }, 1500));
  }

  isLive(roomId) {
    return this.sessions.has(roomId);
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

  /**
   * Mulai siaran HLS untuk sebuah room.
   * @param {string} roomId
   * @returns {Promise<{ playlist: string }>}
   */
  async startBroadcast(roomId, preferredPeerId = null, options = {}) {
    const record = !!options.record;
    if (this.sessions.has(roomId)) {
      return { playlist: `/hls/${roomId}/index.m3u8` };
    }
    const room = mediasoupService.getRoom(roomId);
    if (!room) throw new Error('Room mediasoup tidak ditemukan (belum ada peserta di panggung).');
    const router = room.router;

    // Pilih sumber: utamakan pembicara dominan / peer yang diminta, lalu lengkapi
    // (video/audio yang belum ada) dari peer lain.
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
    if (!videoProducer && !audioProducer) {
      throw new Error('Tidak ada media di panggung untuk disiarkan.');
    }

    const dir = path.join(HLS_ROOT, roomId);
    fs.mkdirSync(dir, { recursive: true });

    const session = { ffmpeg: null, transports: [], consumers: [], dir, ports: [], roomId, sourcePeerId: target || null, record, recPath: null, guard: null };
    const sdpMedia = [];

    // Buat PlainTransport + consumer untuk tiap kind, kirim RTP ke port lokal ffmpeg.
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
      return { consumer, port };
    };

    if (audioProducer) {
      const { consumer, port } = await setup(audioProducer);
      sdpMedia.push(this._sdpForConsumer(consumer, port));
    }
    if (videoProducer) {
      const { consumer, port } = await setup(videoProducer);
      sdpMedia.push(this._sdpForConsumer(consumer, port));
    }

    // Tulis file SDP untuk input ffmpeg.
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

    // Spawn ffmpeg: baca SDP (RTP) → transcode H264/AAC → HLS (LL-HLS opsional).
    const args = [
      '-loglevel', 'warning',
      '-protocol_whitelist', 'file,udp,rtp',
      '-fflags', '+genpts',
      '-i', sdpPath,
    ];
    if (videoProducer) {
      args.push(
        '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
        '-profile:v', 'baseline', '-level', '3.1', '-pix_fmt', 'yuv420p',
        // Keyframe tiap 1 dtk agar segmen 1 dtk rapi (latensi rendah).
        '-r', '30', '-g', '30', '-keyint_min', '30', '-sc_threshold', '0',
        '-force_key_frames', 'expr:gte(t,n_forced*1)',
        '-b:v', '1500k', '-maxrate', '1800k', '-bufsize', '2000k',
      );
    }
    if (audioProducer) {
      args.push('-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2');
    }
    args.push(
      '-f', 'hls',
      '-hls_time', '1',
      '-hls_list_size', '8',
      '-hls_flags', 'delete_segments+append_list+omit_endlist+independent_segments',
      '-hls_segment_type', 'mpegts',
      '-hls_segment_filename', path.join(dir, 'seg_%05d.ts'),
      path.join(dir, 'index.m3u8'),
    );

    // Output kedua (opsional): rekam ke MP4 untuk arsip webinar. Encode terpisah
    // (CPU sedikit lebih tinggi, tapi 1 sumber → masih ringan). Catatan: butuh ffmpeg
    // di server; perlu diuji di lingkungan produksi.
    if (record) {
      fs.mkdirSync(REC_ROOT, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      session.recPath = path.join(REC_ROOT, `${roomId}_${stamp}.mp4`);
      if (videoProducer) {
        args.push('-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-b:v', '1500k');
      }
      if (audioProducer) {
        args.push('-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2');
      }
      args.push('-movflags', '+faststart', session.recPath);
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

    // Auto-stop: bila panggung tak lagi punya media (host berhenti share / keluar),
    // hentikan ffmpeg agar tidak jalan sia-sia.
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
        this.stopBroadcast(roomId, { purge: true });
      }
    }, 5000);
    if (session.guard.unref) session.guard.unref();

    this.sessions.set(roomId, session);
    console.log(`[HLS ${roomId}] broadcast dimulai (audio=${!!audioProducer}, video=${!!videoProducer}, record=${record}).`);
    return { playlist: `/hls/${roomId}/index.m3u8`, recording: record };
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
    // fmtp params (mis. opus, H264) bila ada.
    const fmtp = Object.entries(codec.parameters || {})
      .map(([k, v]) => `${k}=${v}`)
      .join(';');
    if (fmtp) lines.push(`a=fmtp:${pt} ${fmtp}`);
    lines.push('a=rtcp-mux');
    lines.push('a=recvonly');
    return lines.join('\n');
  }

  stopBroadcast(roomId, { purge = true } = {}) {
    const s = this.sessions.get(roomId);
    if (!s) return;
    if (s.ffmpeg && !s.ffmpeg.killed) {
      try { s.ffmpeg.kill('SIGINT'); } catch { /* noop */ }
    }
    this._cleanup(roomId, { purge });
    console.log(`[HLS ${roomId}] broadcast dihentikan.`);
  }

  _cleanup(roomId, { purge = false } = {}) {
    const s = this.sessions.get(roomId);
    if (!s) return;
    if (s.guard) { clearInterval(s.guard); s.guard = null; }
    s.consumers.forEach((c) => { try { c.close(); } catch { /* noop */ } });
    s.transports.forEach((t) => { try { t.close(); } catch { /* noop */ } });
    // Lepas port RTP agar bisa dipakai siaran berikutnya.
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
