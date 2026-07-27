/**
 * Pemetaan arsip Dapur Desa → tabel `aparatur_desa`.
 *
 * Integrasi API Dapur Desa sudah dimatikan; sumbernya kini arsip offline hasil
 * backup (lihat scripts/import-dapur-desa.js). Dipakai bersama oleh skrip impor
 * dan endpoint rekonsiliasi di aparatur-desa.controller.js supaya aturan
 * pemetaan hanya ada di satu tempat.
 *
 * CATATAN PENTING: arsip Dapur Desa TIDAK punya tempat lahir dan tanggal lahir,
 * hanya `usia`. Dua kolom itu NOT NULL di `aparatur_desa`, jadi diisi mengikuti
 * konvensi importFromExternal yang sudah ada: tempat lahir '-' dan tanggal lahir
 * ditaksir 1 Januari (tahun berjalan − usia). Nilai taksiran ini sengaja ditandai
 * di kolom `keterangan` supaya desa tahu bagian mana yang wajib dikoreksi.
 */

const { v4: uuidv4 } = require('uuid');

// Gelar akademik/keagamaan yang dibuang saat mencocokkan nama. Hanya untuk
// pencocokan — nama yang disimpan tetap apa adanya.
const GELAR = new Set([
  'IR', 'DRS', 'DRA', 'H', 'HJ', 'S', 'ST', 'SE', 'SH', 'SP', 'SPD', 'SSOS', 'SAG',
  'SKOM', 'SIP', 'SPDI', 'SAP', 'SPT', 'SFARM', 'SKM', 'MM', 'MSI', 'MPD', 'MH',
  'AMD', 'AMDKEB', 'AMDKEP', 'SPSI', 'STP', 'SIKOM', 'SAK', 'SE.', 'MPA', 'MAP',
]);

const teks = (nilai) => String(nilai ?? '').trim();

/**
 * Nilai teks arsip yang benar-benar berisi, atau null.
 *
 * Sumbernya menyimpan sebagian kolom kosong sebagai teks literal "null"/"undefined"
 * (dan kadang "-"). Kalau tidak disaring, nilai-nilai itu tersimpan apa adanya lalu
 * terhitung sebagai "perbedaan" saat dibandingkan dengan isian desa.
 */
const KOSONG = new Set(['', '-', 'NULL', 'UNDEFINED', 'N/A']);
const teksBersih = (nilai) => {
  const t = teks(nilai);
  return KOSONG.has(t.toUpperCase()) ? null : t;
};

/**
 * Nama tanpa tanda baca, huruf besar, spasi rapat.
 * "Ir. Deni  Nugraha" → "IR DENI NUGRAHA"
 */
const normalisasiNama = (nama) =>
  teks(nama)
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Nama inti: normalisasi lalu buang token gelar.
 * "IR DENI NUGRAHA" → "DENI NUGRAHA"; "ABDUL ROHMAN S PD" → "ABDUL ROHMAN"
 *
 * Dipakai sebagai pencocokan lapis kedua supaya isian desa yang menulis gelar
 * (atau tidak menulisnya) tetap ketemu dengan record arsip yang sama.
 */
const namaInti = (nama) => {
  const token = normalisasiNama(nama).split(' ').filter((t) => t && !GELAR.has(t));
  return token.join(' ');
};

/** Kode desa DPMD "32.01.01.1001" ↔ kode Dapur Desa "3201011001". */
const normalisasiKodeDesa = (kode) => teks(kode).replace(/\D/g, '');

/** Dapur Desa memakai "L"/"P"; kolom lokal memakai enum Laki_laki/Perempuan. */
const petakanJenisKelamin = (gender) => {
  const g = teks(gender).toUpperCase();
  if (g === 'P' || g.startsWith('PEREMPUAN')) return 'Perempuan';
  return 'Laki_laki';
};

/**
 * Tanggal aman untuk kolom DATE; string kosong/"null" dianggap tidak ada.
 *
 * Arsip memuat tahun mustahil hasil salah ketik di sumbernya — ada '0004-03-05',
 * '0019-01-02', bahkan '52024-03-01' (136 record). MySQL menolak nilai seperti itu
 * dan menggagalkan seluruh baris, jadi tanggal di luar rentang wajar dibuang saja.
 */
const TAHUN_MIN = 1900;
const tanggal = (nilai) => {
  const t = teks(nilai);
  if (!t || t.toLowerCase() === 'null') return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  const tahun = d.getFullYear();
  if (tahun < TAHUN_MIN || tahun > new Date().getFullYear() + 1) return null;
  return d;
};

/**
 * Tahun lulus dari arsip. Sebagian record mengisinya dengan tanggal lengkap
 * ("22 OKTOBER 2008") yang melebihi lebar kolom, jadi diambil tahunnya saja.
 */
const tahunLulus = (nilai) => {
  const t = teks(nilai);
  if (!t || t.toLowerCase() === 'null') return null;
  if (/^\d{4}$/.test(t)) return t;
  const cocok = t.match(/\b(19|20)\d{2}\b/);
  return cocok ? cocok[0] : null;
};

/**
 * Taksiran tanggal lahir dari usia. Arsip tidak menyimpan tanggal lahir asli,
 * jadi ini murni penanda agar kolom NOT NULL terisi — bukan data sebenarnya.
 */
const taksirTanggalLahir = (usia) => {
  const umur = parseInt(usia, 10);
  if (!Number.isFinite(umur) || umur <= 0 || umur > 120) return new Date('2000-01-01');
  return new Date(`${new Date().getFullYear() - umur}-01-01`);
};

/** Angka bersih dari kolom usia arsip (ada yang berisi "null" sebagai teks). */
const angka = (nilai) => {
  const n = parseInt(teks(nilai), 10);
  return Number.isFinite(n) ? n : null;
};

/**
 * Bentuk baris staging dari satu record mentah arsip Dapur Desa.
 * Menerima bentuk JSON API (master_village_id, name, …).
 */
const keBarisStaging = (record) => {
  const nama = teks(record.name);
  return {
    dapur_id: angka(record.id),
    kode_desa: normalisasiKodeDesa(record.master_village_id),
    kode_kecamatan: normalisasiKodeDesa(record.master_district_id),
    nama_desa_sumber: teksBersih(record.master_village_name),
    nama_kecamatan_sumber: teksBersih(record.master_district_name),
    nama,
    nama_normal: normalisasiNama(nama),
    jabatan: teksBersih(record.master_job_level_name),
    jenis_kelamin: teksBersih(record.gender),
    usia: angka(record.usia),
    agama: teksBersih(record.agama),
    status_kawin: teksBersih(record.marital_status),
    status_pns: teksBersih(record.status_pns),
    pendidikan: teksBersih(record.master_degree_name),
    no_sk: teksBersih(record.no_sk),
    tgl_sk: tanggal(record.sk_date),
    no_sk_pertama: teksBersih(record.no_sk_pertama),
    tgl_sk_pertama: tanggal(record.sk_date_pertama),
    tahun_lulus: tahunLulus(record.tahun_lulus),
    foto_url: teks(record.photo) || null,
  };
};

/**
 * Data siap-simpan untuk `aparatur_desa` dari satu baris staging.
 * `id` dibuat baru bila tidak dioper (kasus update memakai id yang ada).
 */
const keAparaturDesa = (baris, desaId, { id } = {}) => ({
  id: id || uuidv4(),
  desa_id: BigInt(String(desaId)),
  nama_lengkap: baris.nama || '-',
  jabatan: baris.jabatan || '-',
  tempat_lahir: '-',
  tanggal_lahir: taksirTanggalLahir(baris.usia),
  jenis_kelamin: petakanJenisKelamin(baris.jenis_kelamin),
  pendidikan_terakhir: baris.pendidikan || '-',
  agama: baris.agama || '-',
  pangkat_golongan: teks(baris.status_pns).toUpperCase() === 'PNS' ? 'PNS' : null,
  // SK pertama lebih tepat sebagai tanggal pengangkatan; SK terakhir jadi cadangan.
  tanggal_pengangkatan: baris.tgl_sk_pertama || baris.tgl_sk || new Date(),
  nomor_sk_pengangkatan: baris.no_sk_pertama || baris.no_sk || '-',
  status: 'Aktif',
  sumber_data: 'dapur_desa',
  dapur_id: baris.dapur_id,
  keterangan:
    `Dari arsip Dapur Desa (ID ${baris.dapur_id}). ` +
    'Tempat lahir & tanggal lahir belum ada di arsip — tanggal lahir masih taksiran dari usia, mohon dikoreksi.',
});

// ── Perbandingan arsip vs isian desa ────────────────────────────────────────
//
// Banyak "konflik" sebenarnya cuma beda cara menulis: "Islam" vs "ISLAM",
// "Sekretaris BPD" vs "SEKRETARIS BPD", "SMA/SMK" vs "SLTA/Sederajat". Desa tidak
// perlu diminta memilih untuk hal seperti itu — hanya perbedaan yang benar-benar
// berbeda isinya yang layak ditanyakan.

/** Samakan bentuk teks: huruf besar, spasi rapat, tanpa tanda baca pinggiran. */
const teksBanding = (nilai) => teks(nilai).toUpperCase().replace(/\s+/g, ' ').replace(/[.,;]+$/, '');

// Jenjang pendidikan yang sama tapi ditulis berbeda antara arsip dan form desa.
const JENJANG = [
  ['SD', 'SD SEDERAJAT', 'SD/SEDERAJAT', 'SEKOLAH DASAR'],
  ['SMP', 'SLTP', 'SLTP SEDERAJAT', 'SLTP/SEDERAJAT', 'SMP/SEDERAJAT'],
  ['SMA', 'SMK', 'SMA/SMK', 'SLTA', 'SLTA SEDERAJAT', 'SLTA/SEDERAJAT', 'SMU', 'SMA/SEDERAJAT'],
  ['D1', 'DIPLOMA I'],
  ['D2', 'DIPLOMA II'],
  ['D3', 'DIPLOMA III'],
  ['S1', 'D4', 'SARJANA', 'STRATA I', 'STRATA I / DIPLOMA IV', 'STRATA I/DIPLOMA IV', 'DIPLOMA IV'],
  ['S2', 'MAGISTER', 'STRATA II'],
  ['S3', 'DOKTOR', 'STRATA III'],
];
const JENJANG_KANONIK = new Map();
JENJANG.forEach((kelompok, i) => kelompok.forEach((tulisan) => JENJANG_KANONIK.set(tulisan, `JENJANG_${i}`)));

const pendidikanBanding = (nilai) => {
  const t = teksBanding(nilai).replace(/\s*\/\s*S\.?\s*MUDA$/i, '');
  return JENJANG_KANONIK.get(t) || t;
};

// Singkatan jabatan perangkat desa: arsip memakai bentuk pendek ("KAUR PERENCANAAN"),
// form desa sering ditulis panjang ("Kepala Urusan Perencanaan"). Hanya singkatan
// baku yang dibentangkan — beda kata di belakangnya (mis. "…Kesejahteraan" vs
// "…Kesejahteraan Rakyat") tetap dianggap perbedaan nyata yang perlu diputuskan desa.
const SINGKATAN_JABATAN = [
  [/^KAUR\b/, 'KEPALA URUSAN'],
  [/^KASI\b/, 'KEPALA SEKSI'],
  [/^KADUS\b/, 'KEPALA DUSUN'],
  [/^SEKDES\b/, 'SEKRETARIS DESA'],
];

const jabatanBanding = (nilai) => {
  let t = teksBanding(nilai);
  for (const [pola, panjang] of SINGKATAN_JABATAN) {
    if (pola.test(t)) {
      t = t.replace(pola, panjang);
      break;
    }
  }
  return t;
};

const tanggalBanding = (nilai) => {
  if (!nilai) return '';
  const d = nilai instanceof Date ? nilai : new Date(nilai);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

/**
 * Bandingkan satu baris arsip dengan satu record aparatur milik desa.
 *
 * Mengembalikan `{ beda, isian }`:
 *   beda  — kolom yang isinya benar-benar bertentangan; ini yang perlu diputuskan desa.
 *   isian — kolom yang KOSONG di data desa tapi ada di arsip; bukan pertentangan,
 *           melainkan lubang yang bisa langsung ditambal dari arsip.
 *
 * Kolom yang kosong di ARSIP tidak pernah dihitung berbeda — ketiadaan data bukan
 * pertentangan, jadi isian desa yang berlaku. Tempat & tanggal lahir tidak ikut
 * dibandingkan sama sekali karena arsip memang tidak punya keduanya.
 */
const bandingkanDenganAparatur = (baris, aparatur) => {
  const nomorSkArsip = baris.no_sk_pertama || baris.no_sk;
  const tanggalSkArsip = baris.tgl_sk_pertama || baris.tgl_sk;

  // [kolom, nilai arsip, nilai desa, penyama, kolom di aparatur_desa, nilai siap simpan]
  const perbandingan = [
    ['nama', baris.nama, aparatur.nama_lengkap, teksBanding, null, null],
    ['jabatan', baris.jabatan, aparatur.jabatan, jabatanBanding, 'jabatan', baris.jabatan],
    [
      'jenis_kelamin',
      baris.jenis_kelamin ? petakanJenisKelamin(baris.jenis_kelamin) : '',
      aparatur.jenis_kelamin,
      teksBanding,
      null,
      null,
    ],
    [
      'pendidikan',
      baris.pendidikan,
      aparatur.pendidikan_terakhir,
      pendidikanBanding,
      'pendidikan_terakhir',
      baris.pendidikan,
    ],
    ['agama', baris.agama, aparatur.agama, teksBanding, 'agama', baris.agama],
    [
      'nomor_sk',
      nomorSkArsip,
      aparatur.nomor_sk_pengangkatan,
      teksBanding,
      'nomor_sk_pengangkatan',
      nomorSkArsip,
    ],
    [
      'tanggal_pengangkatan',
      tanggalSkArsip,
      aparatur.tanggal_pengangkatan,
      tanggalBanding,
      'tanggal_pengangkatan',
      tanggalSkArsip,
    ],
  ];

  const beda = [];
  const isian = {};

  for (const [kolom, nilaiArsip, nilaiDesa, samakan, kolomAparatur, nilaiSimpan] of perbandingan) {
    const arsip = samakan(nilaiArsip);
    if (!arsip) continue;

    const desa = samakan(nilaiDesa);
    if (!desa || KOSONG.has(desa)) {
      // Data desa memang belum diisi — tambal dari arsip, tidak perlu ditanyakan.
      if (kolomAparatur && nilaiSimpan) isian[kolomAparatur] = nilaiSimpan;
      continue;
    }

    if (arsip !== desa) beda.push(kolom);
  }

  return { beda, isian };
};

module.exports = {
  GELAR,
  tanggal,
  tahunLulus,
  teksBanding,
  bandingkanDenganAparatur,
  normalisasiNama,
  namaInti,
  normalisasiKodeDesa,
  petakanJenisKelamin,
  taksirTanggalLahir,
  keBarisStaging,
  keAparaturDesa,
};
