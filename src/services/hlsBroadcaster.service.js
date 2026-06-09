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
const FFMPEG_BIN = process.env.FFMPEG_PATH || 'ffmpeg';
// Rentang port lokal RTP server→ffmpeg (PISAH dari RTC 10000–10500).
const BASE_PORT = parseInt(process.env.HLS_RTP_BASE_PORT || '41000', 10);

class HlsBroadcaster {
  constructor() {
    // roomId -> { ffmpeg, transports:[], consumers:[], dir, ports:[] }
    this.sessions = new Map();
    this.nextPort = BASE_PORT;
  }

  isLive(roomId) {
    return this.sessions.has(roomId);
  }

  _allocPort() {
    // RTP port harus genap (RTCP = +1 saat tidak rtcpMux). Pakai rtcpMux → 1 port cukup,
    // tetap genap untuk aman. Daur ulang sederhana dalam rentang.
    const p = this.nextPort;
    this.nextPort += 2;
    if (this.nextPort > BASE_PORT + 1000) this.nextPort = BASE_PORT;
    return p;
  }

  /**
   * Mulai siaran HLS untuk sebuah room.
   * @param {string} roomId
   * @returns {Promise<{ playlist: string }>}
   */
  async startBroadcast(roomId) {
    if (this.sessions.has(roomId)) {
      return { playlist: `/hls/${roomId}/index.m3u8` };
    }
    const room = mediasoupService.getRoom(roomId);
    if (!room) throw new Error('Room mediasoup tidak ditemukan (belum ada peserta di panggung).');
    const router = room.router;

    // Pilih 1 video + 1 audio producer dari peserta mana pun (v1).
    let videoProducer = null;
    let audioProducer = null;
    for (const [, peer] of room.peers) {
      for (const [, prod] of peer.producers) {
        if (prod.kind === 'video' && !videoProducer) videoProducer = prod;
        if (prod.kind === 'audio' && !audioProducer) audioProducer = prod;
      }
    }
    if (!videoProducer && !audioProducer) {
      throw new Error('Tidak ada media di panggung untuk disiarkan.');
    }

    const dir = path.join(HLS_ROOT, roomId);
    fs.mkdirSync(dir, { recursive: true });

    const session = { ffmpeg: null, transports: [], consumers: [], dir, ports: [], roomId };
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
        '-g', '60', '-r', '30', '-b:v', '1500k', '-maxrate', '1800k', '-bufsize', '3000k',
      );
    }
    if (audioProducer) {
      args.push('-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2');
    }
    args.push(
      '-f', 'hls',
      '-hls_time', '2',
      '-hls_list_size', '6',
      '-hls_flags', 'delete_segments+append_list+omit_endlist',
      '-hls_segment_filename', path.join(dir, 'seg_%05d.ts'),
      path.join(dir, 'index.m3u8'),
    );

    const ff = spawn(FFMPEG_BIN, args);
    session.ffmpeg = ff;
    ff.stderr.on('data', (d) => {
      const line = d.toString();
      if (/error|failed|invalid/i.test(line)) console.error(`[HLS ${roomId}] ffmpeg:`, line.trim());
    });
    ff.on('exit', (code, signal) => {
      console.log(`[HLS ${roomId}] ffmpeg exit code=${code} signal=${signal}`);
      this._cleanup(roomId);
    });

    this.sessions.set(roomId, session);
    console.log(`[HLS ${roomId}] broadcast dimulai (audio=${!!audioProducer}, video=${!!videoProducer}).`);
    return { playlist: `/hls/${roomId}/index.m3u8` };
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

  stopBroadcast(roomId) {
    const s = this.sessions.get(roomId);
    if (!s) return;
    if (s.ffmpeg && !s.ffmpeg.killed) {
      try { s.ffmpeg.kill('SIGINT'); } catch { /* noop */ }
    }
    this._cleanup(roomId);
    console.log(`[HLS ${roomId}] broadcast dihentikan.`);
  }

  _cleanup(roomId) {
    const s = this.sessions.get(roomId);
    if (!s) return;
    s.consumers.forEach((c) => { try { c.close(); } catch { /* noop */ } });
    s.transports.forEach((t) => { try { t.close(); } catch { /* noop */ } });
    this.sessions.delete(roomId);
    // Sisakan segmen di disk sampai di-overwrite; bersihkan playlist agar pemutar berhenti.
  }
}

module.exports = new HlsBroadcaster();
