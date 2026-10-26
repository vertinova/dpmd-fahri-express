/**
 * Klien go2rtc — restream RTSP → WebRTC/MSE untuk live view Smart CCTV.
 *
 * go2rtc dikelola lewat REST API-nya, bukan lewat berkas go2rtc.yaml:
 * setiap kamera yang dibuat/diubah/dihapus di super app langsung
 * menambah/menghapus stream di go2rtc. Semua panggilan bersifat
 * best-effort — go2rtc yang sedang mati tidak boleh menjatuhkan operasi CRUD
 * kamera di database.
 */

const axios = require('axios');

const base = () => (process.env.GO2RTC_URL || 'http://127.0.0.1:1984').replace(/\/+$/, '');

const klien = (timeout = 5000) => axios.create({ baseURL: base(), timeout });

/** URL yang dipakai browser (same-origin lewat proxy /go2rtc — lihat vite.config & nginx). */
const urlWebRtc = (src) => `/go2rtc/api/webrtc?src=${encodeURIComponent(src)}`;

/** Tambah/replace stream: POST /api/streams?src=NAME&input=URL */
const tambahStream = async (src, input) => {
  try {
    await klien().post(`/api/streams?src=${encodeURIComponent(src)}&input=${encodeURIComponent(input)}`);
    console.log(`[go2rtc] Stream "${src}" didaftarkan`);
    return true;
  } catch (err) {
    console.warn(`[go2rtc] Gagal mendaftarkan stream "${src}":`, err.message);
    return false;
  }
};

/** Hapus stream: DELETE /api/streams?src=NAME (404 = memang tidak ada, bukan error). */
const hapusStream = async (src) => {
  try {
    await klien().delete(`/api/streams?src=${encodeURIComponent(src)}`);
    console.log(`[go2rtc] Stream "${src}" dihapus`);
    return true;
  } catch (err) {
    if (err.response && err.response.status === 404) return true;
    console.warn(`[go2rtc] Gagal menghapus stream "${src}":`, err.message);
    return false;
  }
};

/** Daftar stream saat ini: GET /api/streams → objek { nama: [...] } */
const daftarStream = async () => {
  try {
    const { data } = await klien().get('/api/streams');
    return data && typeof data === 'object' ? data : {};
  } catch (err) {
    console.warn('[go2rtc] Gagal membaca daftar stream:', err.message);
    return null;
  }
};

/** Apakah go2rtc hidup? */
const sehat = async () => {
  try {
    await klien(2000).get('/api/streams');
    return true;
  } catch {
    return false;
  }
};

module.exports = { tambahStream, hapusStream, daftarStream, sehat, urlWebRtc };
