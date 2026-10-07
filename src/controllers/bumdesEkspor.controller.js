/**
 * Ekspor BUM Desa: SELURUH data dan SELURUH berkas.
 *
 * Dipisah dari bumdes.controller.js karena yang dikerjakan di sini beda sifatnya:
 * bukan membaca sepotong data untuk digambar di layar, melainkan mengalirkan
 * satu berkas besar ke disk pengguna.
 *
 * Dua unduhan, sengaja TERPISAH:
 *
 *   1. data   → .xlsx berisi semua kolom tabel `bumdes` (±150 kolom) ditambah
 *               daftar JSON yang diratakan menjadi lembar sendiri. Ekspor di
 *               Direktori BUMDes tetap ada dan tetap ringkas (19 kolom pilihan)
 *               — itu untuk menindaklanjuti hasil penyaringan, bukan untuk
 *               mengarsipkan seluruh isi tabel.
 *   2. berkas → .zip berisi berkas aslinya, ditata
 *               <Kecamatan>/<Desa — Nama BUM Desa>/<Kelompok>/<berkas>.
 *               Spreadsheet tidak bisa memuat PDF, jadi menggabungkan keduanya
 *               dalam satu unduhan hanya membuat yang butuh angka ikut menunggu
 *               ratusan megabita PDF.
 *
 * Kenapa pakai TIKET, bukan header Authorization: unduhannya dijalankan
 * peramban supaya ditulis langsung ke disk dengan bilah progres, dan navigasi
 * peramban tidak bisa membawa header. Polanya sama dengan pencadangan sistem
 * (lihat src/routes/backup.routes.js) — tiket berumur pendek yang diterbitkan
 * endpoint ber-Authorization biasa.
 */

const path = require('path');
const fsp = require('fs').promises;
const jwt = require('jsonwebtoken');
const ExcelJS = require('exceljs');
const archiver = require('archiver');
const prisma = require('../config/prisma');
const logger = require('../utils/logger');
const ActivityLogger = require('../utils/activityLogger');

const JWT_SECRET = process.env.JWT_SECRET;
const UMUR_TIKET_DETIK = 120;
const JENIS_EKSPOR = ['data', 'berkas'];
const DIR_UPLOADS = path.join(__dirname, '../../storage/uploads');
const DIR_PRODUK_HUKUM = path.join(__dirname, '../../storage/produk_hukum');

/* ───────────────────────────── Peta berkas ───────────────────────────── */

/** Kolom berkas tunggal: kolom → [folder penyimpanan, kelompok, label]. */
const BERKAS_KOLOM = {
  Perdes: ['bumdes_dokumen_badanhukum', 'Dokumen Pendirian', 'Perdes Pendirian'],
  ProfilBUMDesa: ['bumdes_dokumen_badanhukum', 'Dokumen Pendirian', 'Profil BUM Desa'],
  BeritaAcara: ['bumdes_dokumen_badanhukum', 'Dokumen Pendirian', 'Berita Acara'],
  AnggaranDasar: ['bumdes_dokumen_badanhukum', 'Dokumen Pendirian', 'Anggaran Dasar'],
  AnggaranRumahTangga: ['bumdes_dokumen_badanhukum', 'Dokumen Pendirian', 'Anggaran Rumah Tangga'],
  ProgramKerja: ['bumdes_dokumen_badanhukum', 'Dokumen Pendirian', 'Program Kerja'],
  SK_BUM_Desa: ['bumdes_dokumen_badanhukum', 'Dokumen Pendirian', 'SK BUM Desa'],
  LaporanKeuangan2021: ['bumdes_laporan_keuangan', 'Laporan Pertanggungjawaban', 'LPJ 2021'],
  LaporanKeuangan2022: ['bumdes_laporan_keuangan', 'Laporan Pertanggungjawaban', 'LPJ 2022'],
  LaporanKeuangan2023: ['bumdes_laporan_keuangan', 'Laporan Pertanggungjawaban', 'LPJ 2023'],
  LaporanKeuangan2024: ['bumdes_laporan_keuangan', 'Laporan Pertanggungjawaban', 'LPJ 2024'],
  StudiKelayakanUsaha: ['bumdes_ketahanan_pangan', 'Ketahanan Pangan', 'Studi Kelayakan Usaha (tanpa tahun)'],
  RABKetahananPangan: ['bumdes_ketahanan_pangan', 'Ketahanan Pangan', 'RAB Ketahanan Pangan (tanpa tahun)'],
  DokumentasiGeotagging: ['bumdes_ketahanan_pangan', 'Ketahanan Pangan', 'Dokumentasi Geotagging (tanpa tahun)'],
};

/**
 * Berkas di dalam daftar JSON: kolom daftar → kunci isian + label.
 * Semuanya tinggal di folder bumdes_lampiran (lihat uploadBumdesLampiran).
 */
const BERKAS_DAFTAR = {
  LaporanPertanggungjawaban: { kelompok: 'Laporan Pertanggungjawaban', isian: [['berkas', 'LPJ']] },
  RiwayatKontribusiPADes: { kelompok: 'Kontribusi PADes', isian: [['bukti', 'Bukti Penyerahan PADes']] },
  RiwayatKemitraan: { kelompok: 'Kemitraan', isian: [['mou', 'MoU Kemitraan']] },
  DokumenKetahananPangan: {
    kelompok: 'Ketahanan Pangan',
    isian: [
      ['studi_kelayakan', 'Studi Kelayakan Usaha'],
      ['rab', 'RAB Ketahanan Pangan'],
      ['geotagging', 'Dokumentasi Geotagging'],
    ],
  },
};

const KELOMPOK = [
  'Dokumen Pendirian', 'Laporan Pertanggungjawaban', 'Ketahanan Pangan',
  'Kontribusi PADes', 'Kemitraan', 'Produk Hukum', 'Produk BUM Desa',
];

/* ──────────────────────────────── Bantu ──────────────────────────────── */

const bacaDaftar = (v) => {
  if (!v) return [];
  try { const x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch { return []; }
};

const ada = (v) => Boolean(v && String(v).trim() !== '');

/** Nama aman untuk folder/berkas di dalam zip (lintas Windows & Linux). */
const amankan = (teks, maks = 80) =>
  String(teks ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maks) || 'tanpa-nama';

const formatUkuran = (bytes) => {
  if (!bytes) return '0 B';
  const satuan = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), satuan.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${satuan[i]}`;
};

const stempel = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
};

/**
 * Daftar id dari query `?ids=1,2,3`.
 *
 * Dipakai supaya tombol di layar bisa mengekspor BARIS YANG SEDANG TERSARING,
 * bukan diam-diam mengirim seluruh kabupaten padahal layarnya tersaring.
 * Tanpa `ids`, yang diekspor memang seluruhnya.
 */
const bacaIds = (nilai) => {
  const daftar = String(nilai || '')
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n > 0);
  return daftar.length ? [...new Set(daftar)] : null;
};

const syaratBumdes = (req) => {
  const ids = bacaIds(req.query.ids);
  // req.lingkupBumdes: pembatas wilayah dari rute kecamatan, bila nanti dipakai.
  return { ...(req.lingkupBumdes || {}), ...(ids ? { id: { in: ids } } : {}) };
};

/**
 * Kumpulkan seluruh berkas satu BUM Desa sebagai
 * { kelompok, label, tahun, absolut, nama }.
 *
 * Keberadaan berkasnya BELUM diperiksa di sini — pemeriksaan disk dilakukan
 * sekali oleh pemanggil (ringkasan & zip), supaya tidak dua kali stat.
 */
const berkasBumdes = (b) => {
  const keluar = [];

  for (const [kolom, [folder, kelompok, label]] of Object.entries(BERKAS_KOLOM)) {
    if (!ada(b[kolom])) continue;
    const nama = String(b[kolom]).split('/').pop();
    keluar.push({ kelompok, label, tahun: null, absolut: path.join(DIR_UPLOADS, folder, nama), nama });
  }

  for (const [kolom, spek] of Object.entries(BERKAS_DAFTAR)) {
    for (const baris of bacaDaftar(b[kolom])) {
      for (const [kunci, label] of spek.isian) {
        if (!ada(baris?.[kunci])) continue;
        const nama = String(baris[kunci]).split('/').pop();
        keluar.push({
          kelompok: spek.kelompok,
          label: baris.mitra ? `${label} — ${baris.mitra}` : label,
          tahun: baris.tahun ?? null,
          absolut: path.join(DIR_UPLOADS, 'bumdes_lampiran', nama),
          nama,
        });
      }
    }
  }

  // Perdes/SK yang dipilih desa dari modul Produk Hukum. Berkasnya di
  // storage/produk_hukum, BUKAN di storage/uploads.
  for (const [ph, label] of [
    [b.produk_hukums_bumdes_produk_hukum_perdes_idToproduk_hukums, 'Perdes (Produk Hukum)'],
    [b.produk_hukums_bumdes_produk_hukum_sk_bumdes_idToproduk_hukums, 'SK BUM Desa (Produk Hukum)'],
  ]) {
    if (!ph || !ada(ph.file)) continue;
    const nama = String(ph.file).split('/').pop();
    // Dokumen yang sama bisa tercatat dua jalur (unggahan SPKED ikut
    // didaftarkan ke Produk Hukum) — jangan masuk zip dua kali.
    if (keluar.some((x) => x.nama === nama)) continue;
    keluar.push({ kelompok: 'Produk Hukum', label, tahun: ph.tahun ?? null, absolut: path.join(DIR_PRODUK_HUKUM, nama), nama });
  }

  for (const p of b.bumdes_produk || []) {
    if (!ada(p.foto)) continue;
    const nama = String(p.foto).split('/').pop();
    keluar.push({
      kelompok: 'Produk BUM Desa', label: `Foto — ${p.nama}`, tahun: null,
      absolut: path.join(DIR_UPLOADS, 'bumdes_produk', nama), nama,
    });
  }

  return keluar;
};

/** Baris BUM Desa + relasi yang dibutuhkan untuk menelusuri berkas. */
const SERTAKAN_BERKAS = {
  bumdes_produk: { select: { nama: true, foto: true } },
  produk_hukums_bumdes_produk_hukum_perdes_idToproduk_hukums: { select: { file: true, tahun: true } },
  produk_hukums_bumdes_produk_hukum_sk_bumdes_idToproduk_hukums: { select: { file: true, tahun: true } },
};

/**
 * Jalur satu berkas di dalam zip. Diberi awalan label supaya dua berkas
 * bernama "1759..._scan.pdf" dari jenis berbeda tidak saling menimpa.
 */
const jalurZip = (b, berkas, dipakai) => {
  const folder = [
    amankan(b.kecamatan || 'Tanpa Kecamatan', 40),
    amankan(`${b.desa || 'Tanpa Desa'} - ${b.namabumdesa || `BUMDes ${b.id}`}`, 90),
    amankan(berkas.kelompok, 40),
  ].join('/');

  const ext = path.extname(berkas.nama);
  const dasar = amankan([berkas.label, berkas.tahun].filter(Boolean).join(' '), 70);
  let jalur = `${folder}/${dasar}${ext}`;
  let n = 2;
  while (dipakai.has(jalur)) {
    jalur = `${folder}/${dasar} (${n})${ext}`;
    n += 1;
  }
  dipakai.add(jalur);
  return jalur;
};

/* ─────────────────────────── Lembar spreadsheet ─────────────────────────── */

/** Kolom tabel `bumdes` yang isinya daftar JSON — diratakan ke lembar sendiri. */
const LEMBAR_DAFTAR = [
  ['RiwayatPermodalan', 'Penyertaan Modal', ['tahun', 'sumber', 'keterangan', 'jumlah']],
  ['RiwayatAset', 'Aset', ['tahun', 'jenis', 'nilai']],
  ['RiwayatOmsetLaba', 'Omset & Laba', ['tahun', 'omset', 'laba']],
  ['RiwayatKontribusiPADes', 'Kontribusi PADes', ['tahun', 'jumlah', 'bukti']],
  ['RiwayatKemitraan', 'Kemitraan', ['tahun', 'mitra', 'periode', 'kontribusi', 'mou']],
  ['PeranProgram', 'Peran Program', ['program', 'program_lain', 'peran', 'produk', 'keterangan']],
  ['LaporanPertanggungjawaban', 'LPJ per Tahun', ['tahun', 'berkas']],
  ['DokumenKetahananPangan', 'Ketahanan Pangan', ['tahun', 'studi_kelayakan', 'rab', 'geotagging', 'keterangan']],
];

/** Decimal Prisma datang sebagai objek; Excel butuh angka supaya bisa dijumlah. */
const nilaiSel = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return Number(v);
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    // Prisma.Decimal
    if (typeof v.toNumber === 'function') return v.toNumber();
    return JSON.stringify(v);
  }
  return v;
};

const rapikanKepala = (ws) => {
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.columns.forEach((kolom) => {
    const panjang = String(kolom.header || '').length;
    kolom.width = Math.min(Math.max(panjang + 2, 12), 45);
  });
};

/* ──────────────────────────────── Controller ──────────────────────────────── */

class BumdesEksporController {
  /**
   * GET /api/bumdes/ekspor/ringkasan
   * Apa yang akan terunduh: jumlah baris, jumlah berkas per kelompok, dan
   * ukuran totalnya. Dipanggil sebelum mengunduh supaya pengguna tahu ia
   * sedang meminta 4 MB atau 4 GB.
   */
  async ringkasan(req, res, next) {
    try {
      const rows = await prisma.bumdes.findMany({
        where: syaratBumdes(req),
        select: {
          id: true, namabumdesa: true, desa: true, kecamatan: true,
          ...Object.keys(BERKAS_KOLOM).reduce((o, k) => ({ ...o, [k]: true }), {}),
          ...Object.keys(BERKAS_DAFTAR).reduce((o, k) => ({ ...o, [k]: true }), {}),
          ...SERTAKAN_BERKAS,
        },
      });

      const perKelompok = {};
      KELOMPOK.forEach((k) => { perKelompok[k] = { jumlah: 0, ukuran: 0 }; });
      let jumlah = 0;
      let ukuran = 0;
      let hilang = 0;

      for (const b of rows) {
        for (const berkas of berkasBumdes(b)) {
          let stat;
          try {
            stat = await fsp.stat(berkas.absolut);
          } catch {
            // Tercatat di basis data tapi berkasnya tidak ada di disk. Dihitung
            // terpisah, bukan diam-diam dilewatkan: angka "0 berkas" dan
            // "12 berkas hilang" artinya sangat berbeda bagi yang memeriksa.
            hilang += 1;
            continue;
          }
          jumlah += 1;
          ukuran += stat.size;
          if (perKelompok[berkas.kelompok]) {
            perKelompok[berkas.kelompok].jumlah += 1;
            perKelompok[berkas.kelompok].ukuran += stat.size;
          }
        }
      }

      return res.json({
        success: true,
        data: {
          jumlah_bumdes: rows.length,
          tersaring: Boolean(bacaIds(req.query.ids)),
          berkas: {
            jumlah,
            hilang,
            ukuran,
            ukuran_teks: formatUkuran(ukuran),
            per_kelompok: KELOMPOK
              .filter((k) => perKelompok[k].jumlah > 0)
              .map((k) => ({
                kelompok: k,
                jumlah: perKelompok[k].jumlah,
                ukuran_teks: formatUkuran(perKelompok[k].ukuran),
              })),
          },
        },
      });
    } catch (error) {
      logger.error('Gagal menyusun ringkasan ekspor BUM Desa:', error);
      next(error);
    }
  }

  /** POST /api/bumdes/ekspor/tiket — { jenis: 'data' | 'berkas', ids?: '1,2' } */
  async buatTiket(req, res) {
    const jenis = String(req.body.jenis || '').trim();
    if (!JENIS_EKSPOR.includes(jenis)) {
      return res.status(400).json({
        success: false,
        message: `Jenis ekspor tidak dikenal. Pilih: ${JENIS_EKSPOR.join(', ')}`,
      });
    }

    // `ids` ikut DITANDATANGANI, bukan dibaca ulang dari query jalur unduhan:
    // kalau tidak, tiket untuk 5 BUM Desa bisa dipakai menarik seluruh 416.
    const ids = bacaIds(req.body.ids);

    const tiket = jwt.sign(
      {
        tipe: 'bumdes-ekspor',
        jenis,
        ids: ids ? ids.join(',') : null,
        uid: String(req.user.id),
        nama: req.user.name,
        email: req.user.email,
        peran: req.user.role,
        bidang: req.user.bidang_id ?? null,
      },
      JWT_SECRET,
      { expiresIn: UMUR_TIKET_DETIK },
    );

    return res.json({
      success: true,
      data: { tiket, jenis, jumlah_dipilih: ids ? ids.length : null, berlaku_detik: UMUR_TIKET_DETIK },
    });
  }

  /** GET /api/bumdes/ekspor/unduh/:jenis?tiket=… */
  async unduh(req, res) {
    const { jenis } = req.params;
    try {
      if (jenis === 'data') return await this.alirkanData(req, res);
      return await this.alirkanBerkas(req, res);
    } catch (error) {
      logger.error(`Gagal menyiapkan ekspor BUM Desa (${jenis}):`, error);
      // Setelah header terkirim, peramban sudah menganggapnya unduhan: satu-
      // satunya hal jujur yang bisa dilakukan adalah memutus koneksi supaya
      // berkas separuh jadi tampak rusak, bukan tampak selesai.
      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          message: error.message || 'Gagal menyiapkan berkas ekspor',
        });
      }
      return res.destroy(error);
    }
  }

  /** data → .xlsx: satu lembar seluruh kolom + satu lembar per daftar JSON. */
  async alirkanData(req, res) {
    const rows = await prisma.bumdes.findMany({
      where: syaratBumdes(req),
      orderBy: [{ kecamatan: 'asc' }, { desa: 'asc' }],
      include: { bumdes_produk: { select: { nama: true, is_active: true } } },
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'DPMD Kabupaten Bogor';
    wb.created = new Date();

    // Kolom lembar utama diambil dari bentuk barisnya sendiri, bukan dari daftar
    // yang ditulis tangan: kolom baru di tabel `bumdes` ikut terekspor tanpa
    // harus menyentuh berkas ini lagi.
    const kolomDaftar = new Set(LEMBAR_DAFTAR.map(([k]) => k));
    const kolomUtama = Object.keys(rows[0] || {})
      .filter((k) => k !== 'bumdes_produk' && !kolomDaftar.has(k));

    const utama = wb.addWorksheet('Data BUM Desa');
    utama.columns = [
      ...kolomUtama.map((k) => ({ header: k, key: k })),
      { header: 'JumlahProdukAktif', key: '__produk' },
    ];
    for (const r of rows) {
      const baris = { __produk: (r.bumdes_produk || []).filter((p) => p.is_active).length };
      kolomUtama.forEach((k) => { baris[k] = nilaiSel(r[k]); });
      utama.addRow(baris);
    }
    rapikanKepala(utama);

    // Daftar JSON diratakan: satu baris per entri, dengan identitas BUM Desa
    // ikut di tiap baris supaya lembarnya berdiri sendiri saat di-pivot.
    for (const [kolom, judul, isian] of LEMBAR_DAFTAR) {
      const ws = wb.addWorksheet(judul.slice(0, 31));
      ws.columns = [
        { header: 'BumdesID', key: 'id' },
        { header: 'Kecamatan', key: 'kecamatan' },
        { header: 'Desa', key: 'desa' },
        { header: 'NamaBUMDesa', key: 'nama' },
        ...isian.map((k) => ({ header: k, key: k })),
      ];
      for (const r of rows) {
        for (const entri of bacaDaftar(r[kolom])) {
          const baris = { id: r.id, kecamatan: r.kecamatan, desa: r.desa, nama: r.namabumdesa };
          isian.forEach((k) => { baris[k] = nilaiSel(entri?.[k]); });
          ws.addRow(baris);
        }
      }
      rapikanKepala(ws);
    }

    const namaBerkas = `bumdes_data_lengkap_${stempel()}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${namaBerkas}"`);
    res.setHeader('Cache-Control', 'no-store');
    await wb.xlsx.write(res);
    res.end();

    logger.info(`✅ Ekspor data BUM Desa (${rows.length} baris) diunduh oleh ${req.user.email}`);
    this.catat(req, 'data', `mengunduh ekspor data lengkap ${rows.length} BUM Desa`);
  }

  /** berkas → .zip berisi berkas asli, ditata per kecamatan/desa/kelompok. */
  async alirkanBerkas(req, res) {
    const rows = await prisma.bumdes.findMany({
      where: syaratBumdes(req),
      orderBy: [{ kecamatan: 'asc' }, { desa: 'asc' }],
      select: {
        id: true, namabumdesa: true, desa: true, kecamatan: true, kode_desa: true,
        ...Object.keys(BERKAS_KOLOM).reduce((o, k) => ({ ...o, [k]: true }), {}),
        ...Object.keys(BERKAS_DAFTAR).reduce((o, k) => ({ ...o, [k]: true }), {}),
        ...SERTAKAN_BERKAS,
      },
    });

    const namaBerkas = `bumdes_berkas_${stempel()}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${namaBerkas}"`);
    res.setHeader('Cache-Control', 'no-store');

    // Level 1: PDF, JPEG, dan WebP sudah terkompresi. Level 9 hampir tidak
    // mengecilkan apa pun di sini tapi memakan CPU server jauh lebih lama.
    const zip = archiver('zip', { zlib: { level: 1 } });
    zip.on('warning', (err) => logger.warn(`Ekspor berkas BUM Desa: ${err.message}`));
    zip.on('error', (err) => {
      logger.error('Gagal menyusun arsip berkas BUM Desa:', err.message);
      res.destroy(err);
    });
    res.on('close', () => { if (!res.writableFinished) zip.abort(); });
    zip.pipe(res);

    const dipakai = new Set();
    const daftarIsi = [['Kecamatan', 'Desa', 'Nama BUM Desa', 'Kelompok', 'Dokumen', 'Tahun', 'Jalur di dalam ZIP'].join(';')];
    const hilang = [];
    let jumlah = 0;

    for (const b of rows) {
      for (const berkas of berkasBumdes(b)) {
        try {
          await fsp.access(berkas.absolut);
        } catch {
          hilang.push([b.kecamatan, b.desa, b.namabumdesa, berkas.kelompok, berkas.label, berkas.nama].join(';'));
          continue;
        }
        const jalur = jalurZip(b, berkas, dipakai);
        zip.file(berkas.absolut, { name: jalur });
        daftarIsi.push([
          b.kecamatan || '', b.desa || '', b.namabumdesa || '',
          berkas.kelompok, berkas.label, berkas.tahun || '', jalur,
        ].map((s) => String(s).replace(/;/g, ',')).join(';'));
        jumlah += 1;
      }
    }

    // Daftar isi: tanpa ini, 3.000 berkas di dalam zip tidak bisa ditelusuri
    // selain dengan membuka folder satu per satu.
    zip.append(`﻿${daftarIsi.join('\r\n')}\r\n`, { name: 'DAFTAR-ISI.csv' });
    if (hilang.length) {
      zip.append(
        `﻿Kecamatan;Desa;Nama BUM Desa;Kelompok;Dokumen;Nama Berkas\r\n${hilang.join('\r\n')}\r\n`,
        { name: 'BERKAS-HILANG.csv' },
      );
    }
    if (!jumlah) {
      zip.append(
        'Tidak ada satu pun berkas yang bisa diarsipkan untuk BUM Desa yang dipilih.\r\n',
        { name: 'KOSONG.txt' },
      );
    }

    await zip.finalize();

    logger.info(`✅ Ekspor berkas BUM Desa (${jumlah} berkas, ${hilang.length} hilang) diunduh oleh ${req.user.email}`);
    this.catat(req, 'berkas', `mengunduh ${jumlah} berkas BUM Desa dari ${rows.length} BUM Desa`);
  }

  /** Jejak audit. Kegagalannya tidak boleh menggagalkan unduhan yang sudah jadi. */
  catat(req, jenis, keterangan) {
    ActivityLogger.log({
      userId: BigInt(String(req.user.id)),
      userName: req.user.name || req.user.email,
      userRole: req.user.role,
      module: 'bumdes',
      action: 'export',
      entityType: 'bumdes_ekspor',
      entityId: null,
      entityName: jenis === 'data' ? 'Data lengkap BUM Desa' : 'Berkas BUM Desa',
      description: `${req.user.name || req.user.email} ${keterangan}`,
      ipAddress: ActivityLogger.getIpFromRequest(req),
      userAgent: ActivityLogger.getUserAgentFromRequest(req),
    }).catch(() => {});
  }
}

const controller = new BumdesEksporController();
// Metode unduh memakai `this` (memanggil alirkanData/alirkanBerkas), sedangkan
// Express memanggilnya lepas dari objeknya.
controller.unduh = controller.unduh.bind(controller);
controller.ringkasan = controller.ringkasan.bind(controller);
controller.buatTiket = controller.buatTiket.bind(controller);

module.exports = controller;
