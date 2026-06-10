# Video Meeting & Webinar — Status, Operasional, Roadmap

Dokumen handoff fitur video meeting (SFU mediasoup) dan rencana **mode webinar**
untuk skala besar (hingga ~1000 penonton). Terakhir diperbarui: **2026-06-10**.

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

### Pembaruan terbaru (2026-06-10) — commit backend `5ef9f4a`, frontend `fbb0f6c`
Sejumlah item yang sebelumnya tertulis "Stage 3 / berikutnya" **kini sudah masuk**:
- **Hard-enforcement produce (server)** — mode webinar menolak `produce` bila peer
  bukan host/on-stage (sebelumnya gating hanya kooperatif di klien).
  ([meeting.socket.js](../src/socket/meeting.socket.js) ~baris 474).
- **Recording** — output MP4 opsional saat siaran (checkbox "rekam siaran" di host);
  file di `storage/recordings/`. ([hlsBroadcaster.service.js](../src/services/hlsBroadcaster.service.js)).
- **Auto-stop siaran** — broadcast berhenti otomatis saat panggung tak lagi punya media.
- **Active-speaker → HLS** — `AudioLevelObserver` relay `dominant-speaker` →
  `hlsBroadcaster.switchSource` (debounce 1,5 dtk). *Catatan: switch masih
  stop/start ffmpeg → blip ~1–2 dtk (lihat sisa Stage 3).*
- **Worker-died handling** — room ditutup + broadcast `meeting-interrupted` saat
  worker mediasoup mati; `setPreferredLayers` untuk hemat simulcast.
- **Frontend** — pilih kamera/mikrofon (replaceTrack), pin/spotlight + request lapis
  simulcast, indikator kualitas jaringan (getStats: packet-loss + RTT), panel antrian
  angkat tangan untuk host, `transports` via `VITE_SOCKET_TRANSPORTS`. Halaman duplikat
  `pages/pegawai/*` & file `.original` dihapus.

> Daftar roadmap di Bagian 4 sudah disesuaikan dengan kondisi ini.

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

### ✅ Stage 2 — HLS broadcaster (SELESAI scaffold; perlu uji server)
Backend (commit `b8e9e48` @ vertinova): [src/services/hlsBroadcaster.service.js](../src/services/hlsBroadcaster.service.js)
- `router.createPlainTransport` (rtcpMux, 127.0.0.1) → consume 1 audio + 1 video
  panggung → SDP → **ffmpeg** transcode H264/AAC → **HLS** di `storage/hls/<roomId>/`.
- Endpoint: `POST /api/video-meetings/:roomId/broadcast/start|stop` (host-only),
  `GET /api/video-meetings/:roomId/broadcast/status` (publik).
- `server.js` serve `/hls` (CORS; playlist `no-cache`).

Frontend (commit `5c2189e` @ erlanggart):
- `WatchPage` rute **`/watch/:roomId`** (publik, view-only) pakai **hls.js** (sudah
  `npm i hls.js`), polling status, autoplay-unlock.
- Host webinar: tombol **Mulai/Stop Siaran** + salin link tonton di header.

**PRASYARAT & operasional Stage 2 (WAJIB di server):**
1. **ffmpeg**: `apt install ffmpeg` (atau set `FFMPEG_PATH`).
2. **nginx**: tambah proxy `/hls` ke backend (port 3000), mis.:
   ```nginx
   location /hls/ { proxy_pass http://localhost:3000; add_header Cache-Control no-cache; }
   ```
   (atau arahkan `/hls` ke **CDN** untuk skala 1000 — origin = backend ini).
3. Env opsional: `HLS_RTP_BASE_PORT` (default 41000, pisah dari RTC 10000–10500).

**Alur uji:** buat meeting **Webinar** → host **Mulai Siaran** → buka `/watch/<roomId>`
di perangkat lain → harus tampil video panggung (latensi HLS ~4–10 dtk).

### ✅ Tier 1 — Skala (SELESAI; perlu uji server)
Backend `8ca8221`, Frontend `919b9f2`:
- **Simulcast** 3 lapis pada produce video (kapasitas + adaptif).
- **Active-speaker HLS**: `AudioLevelObserver` per room → event `dominant-speaker`
  → `hlsBroadcaster.switchSource` (debounce 1,5 dtk) alihkan siaran ke pembicara
  dominan; guard race saat ffmpeg restart.
- **LL-HLS**: segmen 1 dtk + keyframe per detik (latensi penonton turun).
- **CDN**: WatchPage dukung env **`VITE_HLS_BASE_URL`** (mis. `https://cdn.dpmdbogorkab.id`)
  → playlist disajikan dari CDN, server hanya origin → fan-out nyata ke 1000.

### ✅ Stage 3 — Sebagian SELESAI (commit backend `5ef9f4a`, frontend `fbb0f6c`)
Lihat detail di Bagian 1 "Pembaruan terbaru". Ringkas:
- ✅ Hard-enforcement produce (server) di mode webinar.
- ✅ Recording (MP4 opsional) + checkbox di host.
- ✅ Auto-**stop** broadcast saat panggung kosong.
- ✅ Active-speaker switching (dominant-speaker → `switchSource`).
- ✅ Raise-hand **queue UI** (host), device picker, pin/spotlight, indikator jaringan.

**Prasyarat tambahan recording:** folder `storage/recordings/` akan dibuat otomatis;
pastikan disk cukup & ffmpeg ada (sama dengan prasyarat HLS Stage 2).
**Env frontend baru (opsional):** `VITE_SOCKET_TRANSPORTS` (mis. `polling` atau
`polling,websocket`) untuk mengatur transport Socket.IO tanpa ubah kode.

### ✅ Stage 3 (lanjutan) — SELESAI (perlu uji server ffmpeg)
Diimplementasikan di [hlsBroadcaster.service.js](../src/services/hlsBroadcaster.service.js),
[meeting.socket.js](../src/socket/meeting.socket.js), [videoMeeting.controller.js](../src/controllers/videoMeeting.controller.js),
dan frontend `VideoMeetingPage.jsx`:
- ✅ **Auto-start siaran** — saat peserta panggung (host/on-stage) mulai `produce` di
  mode webinar, `hlsBroadcaster.autoStart()` memulai siaran otomatis (bila belum live &
  belum dihentikan host). Stop manual host disuppress via `manualStopped` agar tak
  langsung menyala lagi; reset saat panggung kosong. Kill-switch: env **`HLS_AUTOSTART=0`**.
- ✅ **Switch active-speaker MULUS (swap RTP)** — `_swapSource()` mengonsumsi producer
  pembicara baru pada **PlainTransport/port yang sama** sehingga ffmpeg tak di-restart
  (tanpa blip). Bila payload-type codec sumber baru ≠ SDP yang dibaca ffmpeg → otomatis
  **fallback** ke restart penuh (perilaku lama). `requestKeyFrame` dipanggil agar video
  langsung tampil.
- ✅ **Gallery compositing** — `layout: 'gallery'` membuat grid via ffmpeg
  `filter_complex` (`scale`+`xstack`, audio `amix`). Saat record, pakai `split`/`asplit`
  untuk 2 output (HLS + MP4). Refresh grid otomatis saat keanggotaan panggung berubah
  (guard, restart ffmpeg). Batas tile: env **`HLS_GALLERY_MAX`** (default 4), ukuran sel
  **`HLS_GALLERY_CELL_W/H`** (default 640×360). Host pilih tata letak via dropdown
  "Pembicara aktif / Galeri" (param `layout` ke `POST /broadcast/start`).

> **WAJIB diuji di server**: ketiga fitur menyentuh pipa ffmpeg/RTP yang tak bisa
> diverifikasi lokal. Cek log `[HLS <roomId>]` (swap/auto-stop/refresh) & pastikan
> ffmpeg tidak error pada filter_complex/SDP. Bila swap RTP bermasalah di produksi,
> set codec seragam atau andalkan fallback restart.

### ⏭️ Stage 3 — SISA (operasional saja)
- **Set CDN** sungguhan di depan `/hls` + isi `VITE_HLS_BASE_URL` (operasional, bukan kode).

---

## 5. Referensi cepat
- Config SFU: `src/config/mediasoup.config.js` (RTC 10000–10500, codecs VP8/VP9/H264).
- Service SFU: `src/services/mediasoup.service.js` (room/peer/transport/produce/consume).
- Signaling: `src/socket/meeting.socket.js`.
- Controller REST: `src/controllers/videoMeeting.controller.js`; routes `src/routes/videoMeeting.routes.js`.
- Frontend: `dpmd-frontend/src/pages/video-meeting/{VideoMeetingListPage,VideoMeetingPage,PublicMeetingPage}.jsx`.
