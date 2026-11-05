/**
 * Jelajah Kantor 3D — endpoint publik, TANPA login.
 * Base path: /api/public/jelajah
 *
 * Tamu jelajah tidak punya akun, jadi kemajuan lintas perangkat memakai "kode simpan":
 * kodenya sendiri yang menjadi kunci, dan server hanya menyimpan hash-nya sebagai nama berkas.
 * Isi simpanan adalah data permainan dari klien, tidak pernah dipercaya untuk hal lain.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../config/database');

const router = express.Router();

const DIR_DATA = process.env.JELAJAH_DATA_DIR || path.join(__dirname, '../../data/jelajah');
const DIR_SIMPANAN = path.join(DIR_DATA, 'simpanan');
const BERKAS_STATISTIK = path.join(DIR_DATA, 'statistik.json');

const MAKS_BYTE = 256 * 1024;
const MAKS_KUNCI = 60;
const MAKS_BERKAS = 5000; // batas atas pemakaian disk ±1,25 GB
const SIMPAN_HARI = 180;
const HARI_MS = 24 * 60 * 60 * 1000;
const ALFABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // tanpa I, L, O, 0, 1 yang mudah tertukar
const POLA_KUNCI = /^jelajah[-:][a-zA-Z0-9:._-]{1,60}$/;
const PERISTIWA = new Set(['layar-awal', 'mulai-3d', 'mulai-2d', 'bersama', 'kecamatan', 'mancing', 'pesanan', 'kode-simpan']);

const batas = (windowMs, max) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Terlalu banyak permintaan. Coba lagi sebentar.' },
  });

function tulisAtomik(berkas, isi) {
  fs.mkdirSync(path.dirname(berkas), { recursive: true });
  fs.writeFileSync(`${berkas}.tmp`, isi);
  fs.renameSync(`${berkas}.tmp`, berkas);
}

// ---------- data resmi per kecamatan ----------

const normalKec = (s) => String(s).toLowerCase().replace(/[^a-z]/g, '');

router.get('/wilayah', batas(60 * 1000, 60), async (_req, res) => {
  try {
    const [kecamatan] = await db.query(`
      SELECT k.nama,
             COALESCE(SUM(d.status_pemerintahan = 'desa'), 0) AS desa,
             COALESCE(SUM(d.status_pemerintahan = 'kelurahan'), 0) AS kelurahan
      FROM kecamatans k
      LEFT JOIN desas d ON d.kecamatan_id = k.id
      GROUP BY k.id, k.nama
      ORDER BY k.nama
    `);
    // bumdes.kecamatan berupa teks bebas, jadi dicocokkan setelah dinormalkan
    const [bumdes] = await db.query(`
      SELECT b.kecamatan, COUNT(DISTINCT b.id) AS bumdes_aktif, COUNT(p.id) AS produk
      FROM bumdes b
      LEFT JOIN bumdes_produk p ON p.bumdes_id = b.id AND p.is_active = 1
      WHERE b.status = 'aktif'
      GROUP BY b.kecamatan
    `);
    const perKec = new Map();
    for (const b of bumdes) {
      const k = normalKec(b.kecamatan);
      const r = perKec.get(k) || { bumdes_aktif: 0, produk: 0 };
      r.bumdes_aktif += Number(b.bumdes_aktif);
      r.produk += Number(b.produk);
      perKec.set(k, r);
    }
    res.set('Cache-Control', 'public, max-age=600');
    res.json({
      success: true,
      data: kecamatan.map((k) => ({
        nama: k.nama,
        desa: Number(k.desa),
        kelurahan: Number(k.kelurahan),
        ...(perKec.get(normalKec(k.nama)) || { bumdes_aktif: 0, produk: 0 }),
      })),
    });
  } catch (error) {
    console.error('Error fetching jelajah wilayah:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil data kecamatan' });
  }
});

// ---------- kode simpan ----------

const buatKode = () => {
  const huruf = Array.from({ length: 12 }, () => ALFABET[crypto.randomInt(ALFABET.length)]).join('');
  return huruf.match(/.{4}/g).join('-');
};

function bersihKode(kode) {
  const k = String(kode).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (k.length !== 12 || [...k].some((c) => !ALFABET.includes(c))) return null;
  return k.match(/.{4}/g).join('-');
}

const berkasKode = (kode) => path.join(DIR_SIMPANAN, `${crypto.createHash('sha256').update(kode).digest('hex')}.json`);

// Mengembalikan isi berkas, atau kode status galat.
function periksaData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 400;
  const entri = Object.entries(data);
  if (!entri.length || entri.length > MAKS_KUNCI) return 400;
  if (entri.some(([k, v]) => !POLA_KUNCI.test(k) || typeof v !== 'string')) return 400;
  const isi = JSON.stringify(data);
  return Buffer.byteLength(isi) > MAKS_BYTE ? 413 : isi;
}

const PESAN_GALAT = { 400: 'Data simpanan tidak sah', 413: 'Simpanan terlalu besar' };

function sapuSimpanan() {
  try {
    const batasWaktu = Date.now() - SIMPAN_HARI * HARI_MS;
    for (const f of fs.readdirSync(DIR_SIMPANAN)) {
      const berkas = path.join(DIR_SIMPANAN, f);
      if (fs.statSync(berkas).mtimeMs < batasWaktu) fs.unlinkSync(berkas);
    }
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[jelajah] gagal menyapu simpanan:', e.message);
  }
}
setInterval(sapuSimpanan, HARI_MS).unref?.();
sapuSimpanan();

const jumlahBerkas = () => {
  try {
    return fs.readdirSync(DIR_SIMPANAN).length;
  } catch {
    return 0;
  }
};

router.post('/simpanan', batas(60 * 60 * 1000, 30), (req, res) => {
  try {
    const isi = periksaData(req.body?.data);
    if (typeof isi === 'number') return res.status(isi).json({ success: false, message: PESAN_GALAT[isi] });
    if (jumlahBerkas() >= MAKS_BERKAS) return res.status(503).json({ success: false, message: 'Penyimpanan penuh' });
    const kode = buatKode();
    tulisAtomik(berkasKode(kode), isi);
    res.json({ success: true, kode });
  } catch (error) {
    console.error('Error saving jelajah simpanan:', error);
    res.status(500).json({ success: false, message: 'Gagal menyimpan' });
  }
});

router.put('/simpanan/:kode', batas(60 * 60 * 1000, 60), (req, res) => {
  try {
    const kode = bersihKode(req.params.kode);
    if (!kode || !fs.existsSync(berkasKode(kode))) return res.status(404).json({ success: false, message: 'Kode tidak ditemukan' });
    const isi = periksaData(req.body?.data);
    if (typeof isi === 'number') return res.status(isi).json({ success: false, message: PESAN_GALAT[isi] });
    tulisAtomik(berkasKode(kode), isi);
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating jelajah simpanan:', error);
    res.status(500).json({ success: false, message: 'Gagal menyimpan' });
  }
});

router.get('/simpanan/:kode', batas(60 * 1000, 20), (req, res) => {
  try {
    const kode = bersihKode(req.params.kode);
    const berkas = kode && berkasKode(kode);
    if (!berkas || !fs.existsSync(berkas)) return res.status(404).json({ success: false, message: 'Kode tidak ditemukan' });
    const kini = new Date();
    fs.utimesSync(berkas, kini, kini); // dipakai = masa simpan diperpanjang
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: JSON.parse(fs.readFileSync(berkas, 'utf8')) });
  } catch (error) {
    console.error('Error reading jelajah simpanan:', error);
    res.status(500).json({ success: false, message: 'Gagal membaca simpanan' });
  }
});

// ---------- penghitung pemakaian ----------
// Hanya hitungan per hari per peristiwa: tanpa identitas, IP, atau kode perangkat.

let statistik = {};
try {
  statistik = JSON.parse(fs.readFileSync(BERKAS_STATISTIK, 'utf8'));
} catch {
  /* belum ada berkas, atau rusak: hitungan mulai lagi */
}
let tundaStatistik = null;
function simpanStatistik() {
  if (tundaStatistik) return;
  tundaStatistik = setTimeout(() => {
    tundaStatistik = null;
    const hari = Object.keys(statistik).sort();
    for (const h of hari.slice(0, -120)) delete statistik[h];
    try {
      tulisAtomik(BERKAS_STATISTIK, JSON.stringify(statistik));
    } catch (e) {
      console.error('[jelajah] gagal menyimpan statistik:', e.message);
    }
  }, 60 * 1000);
  tundaStatistik.unref?.();
}

router.post('/tanda', batas(60 * 1000, 30), (req, res) => {
  const peristiwa = req.body?.peristiwa;
  if (!PERISTIWA.has(peristiwa)) return res.status(400).json({ success: false });
  const hari = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const h = (statistik[hari] ||= {});
  h[peristiwa] = (h[peristiwa] || 0) + 1;
  simpanStatistik();
  res.json({ success: true });
});

router.get('/statistik', batas(60 * 1000, 30), (_req, res) => {
  res.json({ success: true, data: Object.fromEntries(Object.entries(statistik).sort().slice(-30)) });
});

module.exports = router;
