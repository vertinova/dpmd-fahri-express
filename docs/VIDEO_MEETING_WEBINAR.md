# Video Meeting & Webinar — Status, Operasional, Roadmap

Dokumen handoff fitur video meeting (SFU mediasoup) dan rencana **mode webinar**
untuk skala besar (hingga ~1000 penonton). Terakhir diperbarui: **2026-06-08**.

---

## 1. Status fitur (per 2026-06-08)

Video meeting **AKTIF kembali** setelah sebelumnya mode pemeliharaan (port RTC
sudah dibuka Diskominfo).

- Backend (`vertinova/dpmd-fahri-express`): mediasoup SFU aktif, signaling via
  Socket.IO, route `/api/video-meetings` aktif.
- Frontend (`erlanggart/dpmd-frontend`): halaman daftar/meeting/penonton aktif.

### Hal penting yang sudah diperbaiki
1. **Re-enable fitur** — `mediasoupService.init()` dipanggil saat startup; route
   tidak lagi 503. (`src/server.js`)
2. **WASM pdf.js** (tidak terkait meeting, tapi 1 sesi) — JBIG2/JPEG2000 di PDF
   scan kini ter-decode (`vite.config.js` + `wasmUrl`).
3. **Socket polling-only** — LB/TLS di depan (bukan nginx server ini) **men-strip
   header upgrade WebSocket**, sehingga `wss://.../socket.io` selalu gagal di
   console. Frontend di-set `transports: ['polling']` agar tidak memunculkan error.
   Meeting tetap jalan (signaling polling; media tetap WebRTC langsung).
   → **Perbaikan tuntas**: minta Diskominfo aktifkan WebSocket passthrough untuk
   `/socket.io/`, lalu balikkan transports ke `['polling','websocket']`.
4. **Audio remote (autoplay)** — browser memblokir autoplay audio sampai ada
   gesture. Ditambah unlock pada interaksi pertama + tombol "Klik untuk mengaktifkan
   suara peserta" di `VideoMeetingPage` & `PublicMeetingPage`.

### Catatan perilaku
- **peerId = user.id** ([meeting.socket.js](../src/socket/meeting.socket.js)). Satu
  akun login di 2 device → peerId bentrok → dianggap reconnect → saling tendang.
  Untuk uji multi-peserta gunakan **akun berbeda / Incognito (guest)**.

---

## 2. Operasional / Deploy (WAJIB saat setup server)

### Environment backend (`.env` yang AKTIF di server)
```
MEDIASOUP_ANNOUNCED_IP=103.51.103.74   # WAJIB IP publik server, bukan 127.0.0.1
```
Tanpa ini meeting antar-perangkat gagal. Log sukses saat start:
`🎥 Video Meeting: ENABLED (announcedIp=103.51.103.74)`

### Port (firewall / Diskominfo)
- **UDP + TCP 10000–10500** harus terbuka dari luar (RTC media mediasoup).
  Port dibuka dinamis saat meeting berjalan; wajar belum muncul di `ss` sebelum ada
  meeting. Konfigurasi: [src/config/mediasoup.config.js](../src/config/mediasoup.config.js).

### Arsitektur jaringan (penting)
- nginx server ini **hanya listen :80**; TLS/HTTPS diterminasi **di LB/gateway
  Diskominfo** (client IP terlihat `172.168.20.23`).
- nginx aktif = `/etc/nginx/sites-enabled/dpmdbogorkab.id` (symlink). File `default`
  TIDAK aktif (jangan edit di situ).
- Blok `/socket.io` sudah punya header upgrade — masalah WebSocket ada di LB
  Diskominfo, bukan nginx ini.

### Media (kapasitas terukur)
- Upload internet nyata: **~631 Mbps** (speedtest), NIC 10 Gbps, CPU 8 core.
- mediasoup: **1 room = 1 worker = 1 CPU core** (round-robin per room). 8 worker =
  untuk 8 meeting paralel, **bukan** memperbesar 1 meeting.

### Kapasitas realistis per meeting (SFU saat ini)
| Mode | Nyaman | Mentok |
|---|---|---|
| Semua kamera ON | ~15–18 | ~22 (1 core mulai berat) |
| Rapat (kamera pembicara saja) | 30–50 | lebih bila banyak mute |

Batas utama: **CPU per-room** & **bandwidth fan-out N×(N−1)**, bukan jumlah peserta.

---

## 3. Mode Webinar (untuk skala besar / ~1000)

### Kenapa 1000 butuh arsitektur berbeda
- **Device peserta** tidak bisa decode 1000 video → semua platform pakai
  active-speaker/selective (lihat ~9–25 saja). Ini hukum sisi-klien.
- **Bandwidth**: 1 pembicara → 1000 penonton via SFU murni ≈ ~1,2 Gbps (di atas
  631 Mbps). Gallery 9 aktif ≈ ~5 Gbps.
- **Solusi**: **HYBRID** = SFU untuk panggung (pembicara/panelis) + **HLS/CDN** untuk
  distribusi ke ribuan penonton (CDN yang menggandakan, bukan server). Identik dengan
  Zoom Webinar. Biaya kecil (CDN per-GB), server 631 Mbps cukup.

### Anggaran (gambaran)
- **Webinar 1000 penonton (hybrid)**: server gratis (sudah ada) + CDN ~$5–35/acara
  1 jam (atau free-tier untuk volume kecil).
- **1000 interaktif penuh**: SaaS ~$60–240/acara 1 jam, atau cluster self-host (mahal).
  → Tidak disarankan; tidak dibutuhkan untuk sosialisasi/webinar.

---

## 4. Implementasi bertahap (roadmap)

### ✅ Stage 1 — Backend (SELESAI, commit `c0c7ee3`)
Fondasi panggung/penonton:
- DB: `video_meetings.mode` ('meeting'|'webinar'); participants `hand_raised`,
  `on_stage`, `hand_raised_at`. Migration: `migrations/20260608_add_webinar_mode.sql`.
- Socket events (di [meeting.socket.js](../src/socket/meeting.socket.js)):
  - `raise-hand` { raised } → broadcast `hand-updated` { peerId, userName, raised }
  - `promote-to-stage` { targetPeerId } (host-only) → broadcast `stage-updated` { peerId, onStage:true }
  - `demote-from-stage` { targetPeerId } (host-only) → broadcast `stage-updated` { peerId, onStage:false }
- `join-room` balas `meetingSettings.mode` & `meetingSettings.onStage`
  (webinar: hanya host/diangkat yang `onStage=true`; meeting biasa: semua `true`).
- `createMeeting` terima `mode`.

**Yang harus dijalankan di server setelah pull:**
```bash
mysql -u <user> -p <db> < migrations/20260608_add_webinar_mode.sql
npx prisma generate
pm2 restart dpmd-backend --update-env
```

### ✅ Stage 1 — Frontend (SELESAI, commit `6c6408a` @ erlanggart/dpmd-frontend)
- Toggle **Mode: Rapat / Webinar** di form buat meeting (`VideoMeetingListPage.jsx`).
- `VideoMeetingPage.jsx` & `PublicMeetingPage.jsx`:
  - Baca `meetingSettings.mode` & `onStage`; **gating publish** (`produceLocalTracks`
    return awal bila `!onStageRef.current`).
  - `goLive()` / `stopLive()` saat di-promote/demote (listener `stage-updated` cek
    diri sendiri via peerId).
  - Tombol **Angkat Tangan** (penonton) → emit `raise-hand`; toolbar mic/kamera
    disembunyikan untuk penonton.
  - Host (`VideoMeetingPage`): badge tangan terangkat + tombol naik/turun panggung
    di daftar peserta → `promote-to-stage`/`demote-from-stage`.

**Catatan:** Ini masih **SFU webinar** (skala ~puluhan, dibatasi 1-room-1-core &
bandwidth). Skala **1000** butuh Stage 2 (HLS). Belum ada hard-enforcement server
(produce gating saat ini kooperatif/di klien) — tambahkan di Stage 3.

### ⏭️ Stage 2 — HLS broadcaster (skala 1000)
- Backend: service baru mis. `src/services/hlsBroadcaster.service.js`:
  - Buat `router.createPlainTransport` → consume audio+video panggung →
    pipe RTP ke **ffmpeg** → output **HLS/LL-HLS** ke dir publik.
  - Endpoint start/stop broadcast + serve playlist `.m3u8`.
  - Prasyarat server: `apt install ffmpeg`.
- Frontend: halaman penonton pakai **hls.js** (belum terpasang: `npm i hls.js`).
- **CDN** (Cloudflare/Bunny) di depan origin HLS → fan-out ke 1000.
- v1: broadcast 1 active-speaker (ffmpeg 1 audio + 1 video). Gallery compositing = v2.

### ⏭️ Stage 3 — Polish
- Active-speaker switching (mediasoup dominant-speaker), gallery compositing
  (ffmpeg filter_complex), recording, raise-hand queue UI, hard-enforcement
  produce (server tolak publish bila bukan on_stage/host di mode webinar).

---

## 5. Referensi cepat
- Config SFU: `src/config/mediasoup.config.js` (RTC 10000–10500, codecs VP8/VP9/H264).
- Service SFU: `src/services/mediasoup.service.js` (room/peer/transport/produce/consume).
- Signaling: `src/socket/meeting.socket.js`.
- Controller REST: `src/controllers/videoMeeting.controller.js`; routes `src/routes/videoMeeting.routes.js`.
- Frontend: `dpmd-frontend/src/pages/video-meeting/{VideoMeetingListPage,VideoMeetingPage,PublicMeetingPage}.jsx`.
