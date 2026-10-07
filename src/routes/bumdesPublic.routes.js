/**
 * Pasar BUM Desa — etalase publik, TANPA login.
 * Base path: /api/public/bumdes
 *
 * Katalog produk BUM Desa memang dibuat untuk dilihat pembeli, tapi sampai
 * sekarang hanya bisa dibuka dari dalam aplikasi — pembeli harus punya akun
 * desa dulu untuk melihat produk yang dijual desa. Jadi dibuka seperti halaman
 * transparansi Bantuan Keuangan (bankeuPublic.routes.js).
 *
 * Yang dibuka hanya pembacaan katalog. Penambahan dan penyuntingan produk tetap
 * lewat /api/desa/bumdes/produk yang ber-auth.
 *
 * Isinya memang untuk umum: nama produk, harga, foto, dan kontak penjual —
 * persis yang dicetak di spanduk dan dibagikan di media sosial BUM Desa.
 * Handler-nya dipakai bersama rute ber-auth (bukan disalin) supaya katalog
 * publik dan katalog di dalam aplikasi mustahil berbeda isi.
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const bumdesController = require('../controllers/bumdes.controller');

// Tanpa login tidak ada yang membatasi siapa pun memanggil ini berulang-ulang,
// sementara satu panggilan menjalankan belasan kueri agregat.
const batas = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Terlalu banyak permintaan. Coba lagi sebentar.' },
});

router.get('/katalog-produk', batas, bumdesController.getKatalogProduk);

module.exports = router;
