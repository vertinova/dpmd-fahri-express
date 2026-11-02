/**
 * Helpdesk DPMD.
 *
 * /publik/*  — widget chatbot untuk tamu, akun desa, dan kecamatan. Token
 *              bersifat opsional: bila ada dan sah, wilayah & data akun
 *              penanya dipakai; bila tidak, penanya dianggap tamu.
 * /petugas/* — panel tiket untuk kecamatan, staf bidang, dan pimpinan DPMD.
 *              Cakupannya dibaca dari akun di controller, bukan dari query.
 */
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const helpdesk = require('../controllers/helpdesk.controller');
const { auth, checkRole } = require('../middlewares/auth');
const { PERAN_PEGAWAI_DPMD } = require('../config/peranDpmd');

/* Token opsional: tidak pernah menolak permintaan. Token rusak/kedaluwarsa
   diperlakukan sebagai tamu — chatbot tetap harus bisa dipakai. */
function authOpsional(req, res, next) {
	const token = req.header('Authorization')?.replace('Bearer ', '');
	if (token) {
		try {
			const d = jwt.verify(token, process.env.JWT_SECRET);
			req.user = { id: d.id, name: d.name, role: d.role };
		} catch {
			/* tamu */
		}
	}
	next();
}

/* Chat memakai kuota AI bersama, jadi dibatasi per IP jauh di bawah limiter
   umum. Tiket lebih ketat lagi karena memicu notifikasi ke petugas. */
const pesanBatas = (message) => ({ success: false, message });
const chatLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 40, message: pesanBatas('Terlalu banyak pertanyaan. Tunggu beberapa menit lalu coba lagi.') });
const tiketLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 8, message: pesanBatas('Terlalu banyak tiket dibuat. Coba lagi nanti.') });
const cekTiketLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 40, message: pesanBatas('Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.') });
const drafLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, message: pesanBatas('Terlalu banyak permintaan draf. Tunggu sebentar.') });

// Publik
router.get('/publik/awal', authOpsional, helpdesk.awal);
router.get('/publik/kecamatan', helpdesk.kecamatan);
router.get('/publik/kecamatan/:id/desa', helpdesk.desa);
router.post('/publik/chat', chatLimiter, authOpsional, helpdesk.chat);
router.post('/publik/kontak', chatLimiter, authOpsional, helpdesk.kontak);
router.post('/publik/umpan-balik', chatLimiter, helpdesk.umpanBalik);
router.post('/publik/tiket', tiketLimiter, authOpsional, helpdesk.buatTiket);

// Tiket milik akun yang login
router.get('/publik/tiket-saya', auth, helpdesk.tiketSaya);
router.get('/publik/tiket-saya/:id', auth, helpdesk.detailTiketSaya);
router.post('/publik/tiket-saya/:id/balas', auth, helpdesk.balasTiketSaya);
router.post('/publik/tiket-saya/:id/nilai', auth, helpdesk.nilaiTiketSaya);

// Tiket tamu — kode tiket + nomor WhatsApp (POST supaya nomor tidak masuk log URL)
router.post('/publik/cek-tiket', cekTiketLimiter, helpdesk.cekTiketTamu);
router.post('/publik/cek-tiket/detail', cekTiketLimiter, helpdesk.detailTiketTamu);
router.post('/publik/cek-tiket/balas', chatLimiter, helpdesk.balasTiketTamu);
router.post('/publik/cek-tiket/nilai', cekTiketLimiter, helpdesk.nilaiTiketTamu);

// Panel petugas
const petugas = [auth, checkRole('kecamatan', 'superadmin', ...PERAN_PEGAWAI_DPMD)];
router.get('/petugas/tiket', ...petugas, helpdesk.daftarTiketPetugas);
router.get('/petugas/tiket-baru', ...petugas, helpdesk.jumlahTiketBaru);
router.get('/petugas/statistik', ...petugas, helpdesk.statistik);
router.get('/petugas/tiket/:id', ...petugas, helpdesk.detailTiketPetugas);
router.post('/petugas/tiket/:id/balas', ...petugas, helpdesk.balasTiketPetugas);
router.patch('/petugas/tiket/:id/status', ...petugas, helpdesk.ubahStatusTiket);
router.patch('/petugas/tiket/:id/prioritas', ...petugas, helpdesk.ubahPrioritasTiket);
router.post('/petugas/tiket/:id/teruskan', ...petugas, helpdesk.teruskanTiket);
router.post('/petugas/tiket/:id/draf', drafLimiter, ...petugas, helpdesk.drafBalasanTiket);

// Basis pengetahuan — pimpinan DPMD & Kepala Bidang (dicek lagi di controller)
router.get('/petugas/kelola', ...petugas, helpdesk.kelolaData);
router.post('/petugas/kategori', ...petugas, helpdesk.simpanKategori);
router.put('/petugas/kategori/:id', ...petugas, helpdesk.simpanKategori);
router.delete('/petugas/kategori/:id', ...petugas, helpdesk.hapusKategori);
router.post('/petugas/faq', ...petugas, helpdesk.simpanFaq);
router.put('/petugas/faq/:id', ...petugas, helpdesk.simpanFaq);
router.delete('/petugas/faq/:id', ...petugas, helpdesk.hapusFaq);
router.get('/petugas/tak-terjawab', ...petugas, helpdesk.takTerjawab);
router.post('/petugas/tak-terjawab/tinjau', ...petugas, helpdesk.tandaiDitinjau);
router.put('/petugas/pengaturan', ...petugas, helpdesk.simpanPengaturan);

module.exports = router;
