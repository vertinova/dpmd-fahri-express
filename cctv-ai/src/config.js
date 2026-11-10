/**
 * Konfigurasi layanan deteksi. Kunci layanan dibaca dari .env backend yang
 * sama (CCTV_SERVICE_API_KEY, CCTV_INTERNAL_TOKEN) supaya tidak ada dua
 * salinan rahasia yang bisa berbeda.
 */
const path = require('path');

require('dotenv').config({ path: process.env.BACKEND_ENV || path.join(__dirname, '..', '..', '.env') });

const angka = (nama, bawaan) => {
	const n = Number(process.env[nama]);
	return Number.isFinite(n) && n > 0 ? n : bawaan;
};

module.exports = {
	PORT: angka('CCTV_AI_PORT', 8001),
	HOST: process.env.CCTV_AI_HOST || '127.0.0.1',
	BACKEND_URL: (process.env.CCTV_AI_BACKEND_URL || `http://127.0.0.1:${process.env.PORT || 3000}/api`).replace(/\/+$/, ''),
	GO2RTC_URL: (process.env.GO2RTC_URL || 'http://127.0.0.1:1984').replace(/\/+$/, ''),
	CCTV_SERVICE_API_KEY: process.env.CCTV_SERVICE_API_KEY || '',
	CCTV_INTERNAL_TOKEN: process.env.CCTV_INTERNAL_TOKEN || '',

	// Irama
	JEDA_PUTARAN_MS: angka('CCTV_AI_JEDA_PUTARAN_MS', 1500), // minimal jeda antar putaran semua kamera
	SEGAR_DAFTAR_MS: angka('CCTV_AI_SEGAR_DAFTAR_MS', 60000), // muat ulang kamera & wajah

	// Pengenalan wajah
	AMBANG_KENAL: angka('CCTV_AI_AMBANG_KENAL', 0.55), // kemiripan minimal untuk "dikenal"
	MIN_SKOR_WAJAH: angka('CCTV_AI_MIN_SKOR_WAJAH', 0.6),
	MIN_WAJAH_PX: angka('CCTV_AI_MIN_WAJAH_PX', 24), // wajah lebih kecil terlalu kabur untuk dinilai
	JEDA_KENAL_MS: angka('CCTV_AI_JEDA_KENAL_MS', 5 * 60 * 1000), // orang yang sama di kamera yang sama
	JEDA_ASING_MS: angka('CCTV_AI_JEDA_ASING_MS', 2 * 60 * 1000), // "tidak dikenal" per kamera

	// Orang terdeteksi (tanpa wajah yang bisa dikenali: membelakangi kamera, jauh, di tepi)
	MIN_SKOR_ORANG: angka('CCTV_AI_MIN_SKOR_ORANG', 0.3),
	MIN_SKOR_ORANG_YOLOX: angka('CCTV_AI_MIN_SKOR_ORANG_YOLOX', 0.45), // salah deteksi YOLOX-s terukur di 0,32–0,43
	YOLOX_THREAD: angka('CCTV_AI_YOLOX_THREAD', 3),
	JEDA_ORANG_MS: angka('CCTV_AI_JEDA_ORANG_MS', 60 * 1000), // per kamera; jumlah orang bertambah = lapor lagi
	TAHAN_ORANG_ANALISIS: angka('CCTV_AI_TAHAN_ORANG_ANALISIS', 1), // kotak orang yang terlewat tetap tampil selama sekian analisis
	JAM_KERJA_MULAI: angka('CCTV_AI_JAM_KERJA_MULAI', 7), // WIB; di luar jam ini "orang" jadi peringatan
	JAM_KERJA_SELESAI: angka('CCTV_AI_JAM_KERJA_SELESAI', 17),

	// Jatuh
	BATAS_JATUH_DETIK: angka('CCTV_AI_BATAS_JATUH_DETIK', 8), // rebah selama ini = jatuh
	LUPA_REBAH_MS: angka('CCTV_AI_LUPA_REBAH_MS', 10000), // tidak rebah selama ini = hitungan diulang
	JEDA_JATUH_MS: angka('CCTV_AI_JEDA_JATUH_MS', 5 * 60 * 1000),
};
