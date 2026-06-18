# Video Meeting — Handoff & TODO (lanjut besok)

Dokumen lanjutan dari [VIDEO_MEETING_WEBINAR.md](./VIDEO_MEETING_WEBINAR.md).
Mencatat fitur yang **ditambahkan di sesi ini**, **yang WAJIB diuji di server**,
langkah **deploy**, dan **rencana berikutnya**. Terakhir diperbarui: **2026-06-11**.

> Status build: **frontend `npm run build` LULUS**, **backend `node -c` OK**.
> Semua fitur di bawah **belum diuji runtime** (perlu kamera + ≥2 peserta nyata).

---

## 1. Yang sudah dikerjakan di sesi ini

### A. UI/UX & list page
- `VideoMeetingListPage.jsx`: redesign header + kartu (badge Rapat/Webinar),
  kartu statistik (Total/Berlangsung/Terjadwal), skeleton loading, **responsive mobile**.

### B. Virtual background (efek latar)
- Library baru: **`@mediapipe/selfie_segmentation`** (sudah `npm i`, masuk `package.json`).
- File baru: `src/pages/video-meeting/virtualBackground.js` (`VirtualBackgroundProcessor`,
  canvas + `captureStream`, model di-load dari CDN jsDelivr — butuh internet klien).
- Tombol **✨ Latar** di toolbar (VideoMeetingPage **dan** PublicMeetingPage) →
  panel **Tanpa / Blur / Unggah gambar device** + galeri (maks 8). Track olahan
  meng-`replaceTrack` producer kamera → peserta lain ikut melihat latar.
- Aman terhadap ganti kamera & screen share; dibersihkan di `cleanup`.

### C. Kontrol host (kooperatif — klien target menegakkan)
Backend `src/socket/meeting.socket.js` (event baru) + UI di VideoMeetingPage:
- `host-mute-participant`, `host-mute-all`, `host-remove-participant`, `toggle-lock`.
- UI: tombol **Mute semua** & **Kunci** di toolbar host; per-baris peserta **mute** & **keluarkan**.

### D. Reactions (emoji)
- Event `reaction` (efemeral) → overlay emoji melayang (keyframe `floatUp` di `src/index.css`).
- Tombol 😀 di toolbar (kedua halaman).

### E. Waiting room (sungguhan)
- Backend in-memory: `meetingLocks`, `waitingRooms`, `admittedPeers` + event
  `admit-participant`, `admit-all`, `reject-participant`, `waiting-updated`, `admitted`, `join-rejected`.
- `join-room` mengarahkan peserta non-host ke ruang tunggu bila `waiting_room_enabled`.
- UI: panel **Ruang Tunggu** di sidebar peserta (host) + **layar tunggu** (peserta).

### F. Layout berbagi layar ala Zoom (DUAL-PRODUCER)
- **Layar = producer terpisah** (`appData.mediaType: 'screen'`), kamera tetap jalan →
  video presenter tampil **di samping** layar.
- Backend: event `new-producer` kini membawa `mediaType`.
- Frontend (kedua halaman): `consumeProducer` memisahkan track layar ke `screenStreams`
  (key `screen:<peerId>`); layout **layar besar + filmstrip** (kanan di desktop, bawah di mobile);
  komponen `ScreenShareView`. Pause-consumer dinonaktifkan saat share.
- **Spotlight** (VideoMeetingPage): klik peserta di filmstrip → jadi tampilan utama,
  layar pindah jadi tile "Layar" yang bisa diklik untuk kembali. Self-view tidak bisa
  di-spotlight (hindari bentrok `localVideoRef`).

### G. Penyempurnaan ("maksimalkan")
- **Fullscreen** area video (tombol header + overlay hover di layar) — kedua halaman.
- **Timer durasi** meeting di header.
- **Shortcut keyboard**: `M` mic, `V` kamera, `S` share layar, `F` fullscreen
  (diabaikan saat fokus di input/chat).

### H. Password meeting  ← *fitur terakhir sebelum berhenti*
- Backend `getPublicMeetingInfo` kini mengirim `requires_password: Boolean(password)`.
- **PublicMeetingPage (lobby)**: input **Password Meeting** muncul bila `requires_password`,
  divalidasi (error inline "Password salah"), dikirim di `join-room`. Auto-rejoin
  dimatikan bila butuh password (tidak ada password tersimpan).
- **VideoMeetingPage**: tidak ada lobby → **modal prompt password** muncul saat join
  ditolak karena password; submit → join ulang via `doJoinRoomRef`.

### I. Laporan kehadiran (absensi meeting)  ← *baru, perlu uji*
- Backend: `GET /api/video-meetings/:id/attendance` (host/superadmin) — method
  `getAttendance` di `videoMeeting.controller.js`, route di `videoMeeting.routes.js`.
  Mengelompokkan sesi per identitas (user_id / guest_name), hitung total durasi & "masih di ruangan".
- Frontend: tombol **ClipboardList** di kartu meeting (host) → **modal kehadiran**
  (tabel nama/join/keluar/durasi) + **Ekspor CSV**.

---

## 2. WAJIB diuji di server (belum diverifikasi runtime)

Urut prioritas:
1. **Virtual background** — Blur & unggah gambar tampil di self-view **dan** di peserta lain.
   Model MediaPipe ter-load dari CDN (cek tab Network: `selfie_segmentation.*`).
2. **Screen share dual-producer** — pembagi & penonton melihat **layar besar + kamera presenter
   di filmstrip**; stop share kembali normal; spotlight & "Kembali ke layar" bekerja.
3. **Waiting room** — buat meeting centang *Waiting Room* → tamu lihat layar tunggu →
   host terima/tolak. Cek reconnect tidak menggandakan.
4. **Kontrol host** — mute satu/semua, keluarkan, kunci (tolak peserta baru).
5. **Password** — meeting ber-password: lobby tamu minta password; halaman internal
   (`/meet/...`) memunculkan modal password. **Catatan:** host pun saat ini diminta
   password (lihat TODO #3 di bawah).
6. **Kehadiran + CSV** — angka durasi & status "Di ruangan" benar; CSV terbuka di Excel
   (sudah pakai BOM UTF-8).
7. **Reactions, timer, fullscreen, shortcut** — uji cepat.

---

## 3. Deploy

```bash
# Backend (vertinova/dpmd-fahri-express)
git pull
npm install                 # tidak ada dependency baru di BE, tapi aman dijalankan
pm2 restart dpmd-backend --update-env

# Frontend (erlanggart/dpmd-frontend)
git pull
npm install                 # WAJIB: dependency baru @mediapipe/selfie_segmentation
npm run build               # deploy folder dist/
```

- **Tidak ada migrasi DB baru** di sesi ini (kolom `waiting_room_enabled`, `password`,
  `joined_at/left_at` semua sudah ada).
- State waiting/lock/admit **in-memory** → hilang bila backend restart di tengah meeting
  (dapat diterima; meeting tetap jalan, hanya status tunggu/kunci tereset).
- Screen share **butuh backend ter-update** (event `new-producer` membawa `mediaType`).
  Jika hanya FE yang di-deploy, share tampil sebagai tile biasa (fallback aman).

---

## 4. TODO / catatan teknis untuk dikerjakan berikutnya

### Selesai pada update lanjutan 2026-06-11

1. **PublicMeetingPage — spotlight saat share**: sudah dibawa ke halaman tamu.
   Klik filmstrip untuk fokus peserta, klik tile **Layar** untuk kembali ke screen share.
2. **Enforcement mute/kamera**: sudah tidak hanya kooperatif. Backend sekarang
   `pause/resume` producer di SFU lewat `media-state-change`, `host-mute-participant`,
   dan `host-mute-all`. Catatan: ini belum menjadi lock permanen; peserta masih bisa
   menyalakan kembali mic/kamera dari tombolnya sendiri.
3. **Host & password**: host meeting sudah exempt dari validasi password di `join-room`.
4. **Kebocoran kecil**: `GET /room/:roomId` sudah memakai `select` field aman dan
   hanya mengirim `requires_password`, bukan hash password.
5. **Dua orang share bersamaan**: UI internal dan tamu sekarang menghitung daftar
   screen share aktif dari `localScreenStream + screenStreams`; layar lain muncul
   sebagai tile di filmstrip dan bisa diklik untuk menjadi tampilan utama.
6. **Multi-device 1 akun**: backend meeting sekarang memakai `peerId` unik per koneksi
   socket, bukan `user.id` langsung. Satu akun dapat join dari dua device/tab tanpa
   saling menendang; `user.id` tetap dipakai untuk otorisasi host dan pencatatan DB.

### Masih tersisa

1. **Lock mute/kamera oleh host**: enforcement sudah hard pause di SFU, tetapi belum ada
   status server-side untuk melarang peserta unmute/menyalakan kamera kembali sampai host
   membuka izin.

---

## 5. Rencana fitur lanjutan (belum dimulai)

Kandidat berikut belum dikerjakan sama sekali (urut nilai vs usaha untuk DPMD):
- **Laporan kehadiran lanjutan**: filter, simpan ke modul Absensi, cetak PDF.
- **Live caption / transkrip** otomatis (Whisper/STT) → notulen rapat.
- **Breakout rooms** (bagi peserta ke sub-room) — perlu manajemen multi-room mediasoup.
- **Whiteboard** kolaboratif.
- **Anotasi di atas screen share** & remote control.
- **Live streaming ke YouTube/Facebook** (pipeline HLS/ffmpeg sudah ada → relatif dekat).

---

## 6. Berkas yang disentuh sesi ini (peta cepat)

Backend:
- `src/socket/meeting.socket.js` — host controls, reactions, waiting room, lock, `new-producer.mediaType`.
- `src/controllers/videoMeeting.controller.js` — `requires_password`, `getAttendance`.
- `src/routes/videoMeeting.routes.js` — route `/:id/attendance`.

Frontend (`dpmd-frontend/src/`):
- `pages/video-meeting/virtualBackground.js` — **baru**.
- `pages/video-meeting/VideoMeetingPage.jsx` — semua fitur (host, reactions, waiting,
  screen share + spotlight, fullscreen/timer/shortcut, modal password).
- `pages/video-meeting/PublicMeetingPage.jsx` — virtual background, reactions, waiting,
  screen share, fullscreen/timer/shortcut, **input password lobby**.
- `pages/video-meeting/VideoMeetingListPage.jsx` — redesign + **modal kehadiran + CSV**.
- `index.css` — keyframe `floatUp`. `vite.config.js` — chunk `mediapipe`.
---

## 7b. Update 2026-06-19 — Share screen + suara (audio tab/YouTube)

- **Tangkap suara saat share**: `getDisplayMedia` kini meminta `audio` (echo/noise/AGC
  off). Track audio layar dikirim sebagai **producer terpisah** `mediaType: 'screenAudio'`
  (Opus stereo 128 kbps). Berlaku di `VideoMeetingPage.jsx` & `PublicMeetingPage.jsx`.
- **Audiens mendengar**: komponen baru `ScreenAudio` dirender **sekali per stream layar**
  (tak dobel walau tile di filmstrip/spotlight); mengikuti tombol mute speaker + banner
  "Aktifkan Suara" (atasi blokir autoplay). `consumeProducer` menggabungkan track
  video+audio layar dalam satu MediaStream.
- **Perbaikan bug penting (backend)**: `mediasoup.service.js` `setProducerPausedByKind`
  dulu hanya melindungi VIDEO layar. Kini media layar (`screen` & `screenAudio`)
  sama-sama dikecualikan kecuali `includeScreen` → peserta yang **mute mic tidak lagi
  ikut mematikan suara tab yang dibagikan**. **WAJIB deploy backend** untuk perbaikan ini.
- **Rekaman** lokal kini menyertakan layar + suaranya.
- **Catatan browser**: pengguna harus mencentang **"Bagikan audio tab/sistem"** di dialog
  share (Chrome/Edge; Firefox/Safari terbatas). Ada toast pengingat bila audio tak ikut.
- **Status**: FE `npm run build` LULUS, BE `node -c` OK. **Belum diuji runtime** (perlu 2+ peserta).

---

## 7. Update lanjutan 2026-06-11 malam

- **Selesai:** host meeting sekarang tidak diminta password saat `join-room`.
  Backend mengecek `host_id === user.id` sebelum validasi password.
- **Selesai:** `GET /api/video-meetings/room/:roomId` sekarang memakai `select`
  field aman dan mengirim `requires_password`, bukan hash password.
- **Selesai:** `PublicMeetingPage.jsx` sekarang mendukung spotlight saat screen share:
  klik peserta remote di filmstrip untuk fokus ke tampilan utama, lalu klik tile
  **Layar** untuk kembali ke screen share.
- **Selesai:** enforcement mute/kamera tidak lagi hanya kooperatif. Backend sekarang
  pause/resume producer SFU berdasarkan `media-state-change`; host mute peserta
  dan mute semua ikut pause producer target di server. Host juga punya tombol
  paksa matikan kamera peserta di sidebar.
- **Selesai:** multi-device 1 akun tidak lagi saling menendang. `peerId` meeting
  dibuat unik per koneksi socket, sementara `user.id` tetap dipakai untuk cek host,
  chat user, dan pencatatan peserta.
- **Selesai:** beberapa peserta bisa share screen bersamaan. FE menyimpan semua
  `screenStreams`, menampilkan layar aktif di area utama, dan menaruh layar lain
  sebagai tile filmstrip yang bisa dipilih.
