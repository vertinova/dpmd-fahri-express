/**
 * Ikhtisar Bidang SPKED — bahan grafik halaman depan.
 *
 * KENAPA AGREGASINYA DI SERVER. Angka-angka di halaman ikhtisar berasal dari
 * 416 baris BUM Desa berkolom 149 dan tiga berkas penyaluran Bankeu berisi
 * ~1.400 baris. Mengirim semuanya ke peramban hanya untuk menggambar dua grafik
 * berarti beberapa megabyte melintas setiap kali halaman dibuka — di jaringan
 * kantor desa itu terasa. Yang dikirim dari sini hanya hasilnya, sekitar satu
 * kilobyte.
 *
 * Sumber datanya dua macam dan sengaja tidak disatukan:
 *   - BUM Desa dari basis data (tabel `bumdes`)
 *   - Penyaluran Bankeu dari berkas JSON di public/, yang diunggah berkala oleh
 *     bidang lewat modul Bankeu. Berkas yang belum ada TIDAK dikarang menjadi
 *     nol; bagiannya ditandai `tersedia: false` supaya layar bisa mengatakan
 *     "belum diunggah" alih-alih menggambar grafik kosong yang terlihat seperti
 *     fakta.
 */

const fs = require('fs');
const path = require('path');
const prisma = require('../config/prisma');
const logger = require('../utils/logger');

const AKAR = path.join(__dirname, '../..');

/**
 * Status penyaluran Bankeu dikelompokkan jadi empat tahap yang punya arti bagi
 * pembacanya. Sembilan status mentah terlalu halus untuk grafik ikhtisar, dan
 * yang ingin diketahui pimpinan sebenarnya cuma: sudah cair, masih berjalan,
 * perlu diperbaiki desa, atau belum bergerak sama sekali.
 *
 * Pencocokannya memakai potongan kata, bukan kesamaan persis, karena ejaan di
 * berkas sumber tidak konsisten — ada "Proses SPP,SPM,SP2D di  BPKAD" dengan
 * dua spasi. Status yang tidak cocok mana pun masuk "lainnya", bukan dibuang.
 */
const KELOMPOK_STATUS = [
  { key: 'cair', label: 'Dana telah dicairkan', cocok: (s) => /dicairkan/i.test(s) },
  {
    key: 'proses',
    label: 'Sedang diproses',
    cocok: (s) => /review|proses|spp|sp2d|bank|kecamatan$/i.test(s) && !/dikembalikan/i.test(s),
  },
  { key: 'revisi', label: 'Dikembalikan untuk perbaikan', cocok: (s) => /dikembalikan/i.test(s) },
  { key: 'belum', label: 'Belum mengajukan', cocok: (s) => /belum/i.test(s) },
];

/** "195,696,800" → 195696800. Pemisah ribuan di berkas sumber tidak seragam. */
const keAngka = (nilai) => {
  const digit = String(nilai ?? '').replace(/[^0-9]/g, '');
  return digit ? Number(digit) : 0;
};

const bacaJson = (jalurRelatif) => {
  const berkas = path.join(AKAR, jalurRelatif);
  if (!fs.existsSync(berkas)) return null;
  try {
    const isi = JSON.parse(fs.readFileSync(berkas, 'utf8'));
    return Array.isArray(isi) ? isi : isi?.data || null;
  } catch (error) {
    logger.error(`Berkas ${jalurRelatif} tidak dapat dibaca sebagai JSON:`, error.message);
    return null;
  }
};

/** Ringkas satu berkas penyaluran menjadi angka + sebaran status berkelompok. */
const ringkasBankeu = (jalurRelatif, label) => {
  const baris = bacaJson(jalurRelatif);
  if (!baris) return { label, tersedia: false };

  const hitung = new Map(KELOMPOK_STATUS.map((k) => [k.key, 0]));
  let lainnya = 0;
  let realisasi = 0;
  let realisasiCair = 0;

  baris.forEach((r) => {
    const status = String(r.sts || '').trim();
    const nilai = keAngka(r.Realisasi);
    realisasi += nilai;

    const kelompok = KELOMPOK_STATUS.find((k) => k.cocok(status));
    if (kelompok) {
      hitung.set(kelompok.key, hitung.get(kelompok.key) + 1);
      if (kelompok.key === 'cair') realisasiCair += nilai;
    } else {
      lainnya += 1;
    }
  });

  return {
    label,
    tersedia: true,
    total: baris.length,
    realisasi,
    realisasi_cair: realisasiCair,
    status: [
      ...KELOMPOK_STATUS.map((k) => ({ key: k.key, label: k.label, jumlah: hitung.get(k.key) })),
      ...(lainnya > 0 ? [{ key: 'lainnya', label: 'Lainnya', jumlah: lainnya }] : []),
    ],
  };
};

/**
 * Status badan hukum BUM Desa — inilah pekerjaan pembinaan bidang ini, dan satu-
 * satunya kolom BUM Desa yang sebarannya benar-benar berjenjang. Urutannya
 * disusun dari yang paling jauh ke yang paling dekat dengan selesai, supaya
 * batangnya terbaca sebagai kemajuan, bukan daftar acak.
 */
const URUT_BADAN_HUKUM = [
  'Terbit Sertifikat Badan Hukum',
  'Nama Terverifikasi',
  'Perbaikan Dokumen',
  'Belum Melakukan Proses',
];

class SpkedIkhtisarController {
  async ikhtisar(req, res, next) {
    try {
      const [total, aktif, perBadanHukum] = await Promise.all([
        prisma.bumdes.count(),
        prisma.bumdes.count({ where: { status: 'aktif' } }),
        prisma.bumdes.groupBy({ by: ['badanhukum'], _count: { badanhukum: true } }),
      ]);

      const petaBadanHukum = new Map(
        perBadanHukum.map((r) => [String(r.badanhukum || '').trim(), r._count.badanhukum]),
      );
      // Baris tanpa isi digabung menjadi satu kategori yang jujur, bukan
      // dihilangkan — 21 BUM Desa yang statusnya kosong adalah informasi.
      const belumTerdata =
        perBadanHukum
          .filter((r) => !String(r.badanhukum || '').trim())
          .reduce((jml, r) => jml + r._count.badanhukum, 0) || 0;

      const badanHukum = [
        ...URUT_BADAN_HUKUM.map((label) => ({ label, jumlah: petaBadanHukum.get(label) || 0 })),
        ...(belumTerdata > 0 ? [{ label: 'Belum terdata', jumlah: belumTerdata }] : []),
      ];

      res.json({
        success: true,
        data: {
          bumdes: {
            total,
            aktif,
            tidak_aktif: Math.max(total - aktif, 0),
            badan_hukum: badanHukum,
          },
          bankeu: {
            tahun: 2025,
            rekap: ringkasBankeu('public/bankeu2025.json', 'Rekap 2025'),
            tahap: [
              ringkasBankeu('public/bankeu-tahap1.json', 'Tahap 1'),
              ringkasBankeu('public/bankeu-tahap2.json', 'Tahap 2'),
            ],
          },
        },
      });
    } catch (error) {
      logger.error('Gagal memuat ikhtisar SPKED:', error);
      next(error);
    }
  }
}

module.exports = new SpkedIkhtisarController();
