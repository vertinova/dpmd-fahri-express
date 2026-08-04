// src/services/outputPemerintahanDesa.service.js
// Prolap — rekap OUTPUT pemerintahan desa. Pemilik output: bidang Pemdes.
//
// Tiga output digabung dalam satu bacaan karena ketiganya menggambarkan
// kesiapan administrasi desa yang sama: aparatur desa, produk hukum desa, dan
// kelengkapan profil desa.
//
// Tiga kenyataan data yang WAJIB ikut dilaporkan, bukan disembunyikan:
//  1. Lebih dari separuh baris aparatur berasal dari arsip Dapur Desa
//     (`sumber_data = 'dapur_desa'`), bukan input desa. Dihitung terpisah.
//  2. Kelengkapan berkas & BPJS aparatur masih sangat rendah (satu digit
//     persen). Angkanya ditampilkan apa adanya sebagai pekerjaan rumah,
//     bukan disembunyikan karena jelek.
//  3. Punya baris di `profil_desas` TIDAK sama dengan profilnya terisi —
//     kebanyakan kolomnya kosong. Karena itu yang dihitung adalah kelengkapan
//     per kolom, bukan sekadar ada/tidak barisnya.
const prisma = require('../config/prisma');

const toNumber = (value) => {
  if (value === null || value === undefined) return 0;
  const numeric = typeof value === 'bigint' ? Number(value) : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const persen = (bagian, total) => (total > 0 ? Math.round((bagian / total) * 1000) / 10 : 0);

// Kolom profil desa yang dianggap inti. Kelengkapan dihitung dari daftar ini
// saja — bukan seluruh kolom — supaya angkanya bermakna dan tidak berubah tiap
// ada kolom baru yang jarang dipakai.
const KOLOM_PROFIL = [
  { key: 'jumlah_penduduk', label: 'Jumlah penduduk' },
  { key: 'koordinat', label: 'Titik koordinat' },
  { key: 'luas_wilayah', label: 'Luas wilayah' },
  { key: 'alamat_kantor', label: 'Alamat kantor' },
  { key: 'foto_kantor', label: 'Foto kantor' },
];

// ============================================================
// Pengambilan data
// ============================================================
const fetchPetaDesa = async () => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT d.id, d.nama, d.status_pemerintahan, k.nama AS nama_kecamatan
     FROM desas d
     LEFT JOIN kecamatans k ON k.id = d.kecamatan_id`
  );
  const peta = new Map();
  for (const row of rows) {
    peta.set(toNumber(row.id), {
      desa_id: toNumber(row.id),
      nama_desa: row.nama,
      nama_kecamatan: row.nama_kecamatan || 'Tidak Diketahui',
      status_pemerintahan: row.status_pemerintahan,
    });
  }
  return peta;
};

const fetchAparatur = async () => {
  const [ringkas, perJabatan, perDesa] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS total,
              SUM(status = 'Aktif' AND tanggal_pemberhentian IS NULL) AS aktif,
              SUM(sumber_data = 'desa') AS input_desa,
              SUM(sumber_data <> 'desa') AS dari_arsip,
              SUM(produk_hukum_id IS NOT NULL) AS ber_sk,
              SUM(bpjs_kesehatan_nomor IS NOT NULL AND bpjs_kesehatan_nomor <> '') AS bpjs_kesehatan,
              SUM(bpjs_ketenagakerjaan_nomor IS NOT NULL AND bpjs_ketenagakerjaan_nomor <> '') AS bpjs_ketenagakerjaan,
              SUM(file_ktp IS NOT NULL) AS berkas_ktp,
              SUM(file_kk IS NOT NULL) AS berkas_kk,
              SUM(file_ijazah_terakhir IS NOT NULL) AS berkas_ijazah,
              SUM(file_pas_foto IS NOT NULL) AS berkas_foto,
              SUM(file_akta_kelahiran IS NOT NULL) AS berkas_akta
       FROM aparatur_desa`
    ),
    prisma.$queryRawUnsafe(
      `SELECT UPPER(jabatan) AS jabatan, COUNT(*) AS jumlah
       FROM aparatur_desa
       WHERE status = 'Aktif' AND tanggal_pemberhentian IS NULL
       GROUP BY UPPER(jabatan)
       ORDER BY jumlah DESC
       LIMIT 15`
    ),
    prisma.$queryRawUnsafe(
      `SELECT desa_id,
              COUNT(*) AS total,
              SUM(status = 'Aktif' AND tanggal_pemberhentian IS NULL) AS aktif,
              SUM(sumber_data = 'desa') AS input_desa
       FROM aparatur_desa
       GROUP BY desa_id`
    ),
  ]);
  return { ringkas: ringkas[0] || {}, perJabatan, perDesa };
};

const fetchProdukHukum = async () => {
  const [ringkas, perTahun, perJenis, perDesa] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS total,
              SUM(status_peraturan = 'berlaku') AS berlaku,
              SUM(status_peraturan <> 'berlaku') AS tidak_berlaku,
              COUNT(DISTINCT desa_id) AS desa
       FROM produk_hukums`
    ),
    prisma.$queryRawUnsafe(
      `SELECT tahun, COUNT(*) AS jumlah FROM produk_hukums GROUP BY tahun ORDER BY tahun`
    ),
    prisma.$queryRawUnsafe(
      `SELECT jenis, COUNT(*) AS jumlah FROM produk_hukums GROUP BY jenis ORDER BY jumlah DESC`
    ),
    prisma.$queryRawUnsafe(`SELECT desa_id, COUNT(*) AS jumlah FROM produk_hukums GROUP BY desa_id`),
  ]);
  return { ringkas: ringkas[0] || {}, perTahun, perJenis, perDesa };
};

const fetchProfilDesa = async () => {
  return prisma.$queryRawUnsafe(
    `SELECT desa_id,
            (jumlah_penduduk > 0) AS jumlah_penduduk,
            (latitude IS NOT NULL AND longitude IS NOT NULL) AS koordinat,
            (luas_wilayah IS NOT NULL AND luas_wilayah <> '') AS luas_wilayah,
            (alamat_kantor IS NOT NULL AND alamat_kantor <> '') AS alamat_kantor,
            (foto_kantor_desa_path IS NOT NULL) AS foto_kantor
     FROM profil_desas`
  );
};

// ============================================================
// Entry point
// ============================================================
const getOutputPemerintahanDesa = async () => {
  const [petaDesa, aparatur, produkHukum, profil] = await Promise.all([
    fetchPetaDesa(),
    fetchAparatur(),
    fetchProdukHukum(),
    fetchProfilDesa(),
  ]);

  const desaSaja = [...petaDesa.values()].filter((desa) => desa.status_pemerintahan === 'desa');
  const totalDesaSistem = desaSaja.length;

  // ---------- Aparatur ----------
  const ap = aparatur.ringkas;
  const totalAparatur = toNumber(ap.total);
  const berkasKolom = [
    { key: 'ktp', label: 'KTP', jumlah: toNumber(ap.berkas_ktp) },
    { key: 'kk', label: 'Kartu Keluarga', jumlah: toNumber(ap.berkas_kk) },
    { key: 'ijazah', label: 'Ijazah terakhir', jumlah: toNumber(ap.berkas_ijazah) },
    { key: 'pas_foto', label: 'Pas foto', jumlah: toNumber(ap.berkas_foto) },
    { key: 'akta', label: 'Akta kelahiran', jumlah: toNumber(ap.berkas_akta) },
  ].map((item) => ({ ...item, persen: persen(item.jumlah, totalAparatur) }));

  const ringkasAparatur = {
    total: totalAparatur,
    aktif: toNumber(ap.aktif),
    tidak_aktif: totalAparatur - toNumber(ap.aktif),
    input_desa: toNumber(ap.input_desa),
    dari_arsip: toNumber(ap.dari_arsip),
    persen_input_desa: persen(toNumber(ap.input_desa), totalAparatur),
    ber_sk: toNumber(ap.ber_sk),
    persen_ber_sk: persen(toNumber(ap.ber_sk), totalAparatur),
    bpjs_kesehatan: toNumber(ap.bpjs_kesehatan),
    persen_bpjs_kesehatan: persen(toNumber(ap.bpjs_kesehatan), totalAparatur),
    bpjs_ketenagakerjaan: toNumber(ap.bpjs_ketenagakerjaan),
    persen_bpjs_ketenagakerjaan: persen(toNumber(ap.bpjs_ketenagakerjaan), totalAparatur),
    berkas: berkasKolom,
    per_jabatan: aparatur.perJabatan.map((row) => ({
      jabatan: row.jabatan,
      jumlah: toNumber(row.jumlah),
    })),
    desa_terjangkau: aparatur.perDesa.length,
  };

  // ---------- Produk hukum ----------
  const ph = produkHukum.ringkas;
  const ringkasProdukHukum = {
    total: toNumber(ph.total),
    berlaku: toNumber(ph.berlaku),
    tidak_berlaku: toNumber(ph.tidak_berlaku),
    desa_terjangkau: toNumber(ph.desa),
    persen_desa: persen(toNumber(ph.desa), totalDesaSistem),
    per_tahun: produkHukum.perTahun.map((row) => ({
      tahun: toNumber(row.tahun),
      jumlah: toNumber(row.jumlah),
    })),
    per_jenis: produkHukum.perJenis.map((row) => ({
      jenis: row.jenis,
      jumlah: toNumber(row.jumlah),
    })),
  };

  // ---------- Profil desa ----------
  const kelengkapan = KOLOM_PROFIL.map((kolom) => ({
    ...kolom,
    jumlah: profil.reduce((total, row) => total + (toNumber(row[kolom.key]) === 1 ? 1 : 0), 0),
  })).map((kolom) => ({ ...kolom, persen: persen(kolom.jumlah, totalDesaSistem) }));

  const skorProfil = new Map();
  for (const row of profil) {
    const terisi = KOLOM_PROFIL.filter((kolom) => toNumber(row[kolom.key]) === 1).length;
    skorProfil.set(toNumber(row.desa_id), terisi);
  }
  const lengkapPenuh = [...skorProfil.values()].filter((skor) => skor === KOLOM_PROFIL.length).length;
  const kosongSamaSekali = [...skorProfil.values()].filter((skor) => skor === 0).length;

  const ringkasProfil = {
    desa_sistem: totalDesaSistem,
    punya_baris: profil.length,
    lengkap_penuh: lengkapPenuh,
    kosong_sama_sekali: kosongSamaSekali,
    // Rata-rata kelengkapan dihitung terhadap SELURUH desa, bukan hanya yang
    // punya baris — desa tanpa baris profil sama saja dengan tidak terisi.
    rata_kelengkapan: persen(
      [...skorProfil.values()].reduce((total, skor) => total + skor, 0),
      totalDesaSistem * KOLOM_PROFIL.length
    ),
    kolom: kelengkapan,
  };

  // ---------- Gabungan per desa & kecamatan ----------
  const aparaturPerDesa = new Map(aparatur.perDesa.map((row) => [toNumber(row.desa_id), row]));
  const produkPerDesa = new Map(produkHukum.perDesa.map((row) => [toNumber(row.desa_id), toNumber(row.jumlah)]));

  const perDesa = desaSaja.map((desa) => {
    const ap2 = aparaturPerDesa.get(desa.desa_id);
    const skor = skorProfil.get(desa.desa_id) || 0;
    return {
      desa_id: desa.desa_id,
      nama_desa: desa.nama_desa,
      nama_kecamatan: desa.nama_kecamatan,
      aparatur: toNumber(ap2?.total),
      aparatur_aktif: toNumber(ap2?.aktif),
      aparatur_input_desa: toNumber(ap2?.input_desa),
      produk_hukum: produkPerDesa.get(desa.desa_id) || 0,
      profil_terisi: skor,
      profil_total: KOLOM_PROFIL.length,
      persen_profil: persen(skor, KOLOM_PROFIL.length),
    };
  });

  const perKecamatan = new Map();
  for (const desa of perDesa) {
    if (!perKecamatan.has(desa.nama_kecamatan)) {
      perKecamatan.set(desa.nama_kecamatan, {
        nama: desa.nama_kecamatan,
        desa: 0,
        aparatur: 0,
        aparatur_aktif: 0,
        produk_hukum: 0,
        profil_terisi: 0,
      });
    }
    const kecamatan = perKecamatan.get(desa.nama_kecamatan);
    kecamatan.desa += 1;
    kecamatan.aparatur += desa.aparatur;
    kecamatan.aparatur_aktif += desa.aparatur_aktif;
    kecamatan.produk_hukum += desa.produk_hukum;
    kecamatan.profil_terisi += desa.profil_terisi;
  }

  return {
    ringkasan: {
      aparatur_aktif: ringkasAparatur.aktif,
      produk_hukum_berlaku: ringkasProdukHukum.berlaku,
      rata_kelengkapan_profil: ringkasProfil.rata_kelengkapan,
      desa_sistem: totalDesaSistem,
    },
    aparatur: ringkasAparatur,
    produk_hukum: ringkasProdukHukum,
    profil_desa: ringkasProfil,
    per_kecamatan: [...perKecamatan.values()]
      .map((kecamatan) => ({
        ...kecamatan,
        persen_profil: persen(kecamatan.profil_terisi, kecamatan.desa * KOLOM_PROFIL.length),
      }))
      .sort((a, b) => b.aparatur_aktif - a.aparatur_aktif),
    per_desa: perDesa.sort((a, b) => b.aparatur_aktif - a.aparatur_aktif),
    catatan_data: {
      aparatur_dari_arsip: ringkasAparatur.dari_arsip,
      persen_aparatur_dari_arsip: persen(ringkasAparatur.dari_arsip, totalAparatur),
      desa_tanpa_baris_profil: totalDesaSistem - profil.length,
    },
    generated_at: new Date().toISOString(),
  };
};

module.exports = { getOutputPemerintahanDesa, KOLOM_PROFIL };
