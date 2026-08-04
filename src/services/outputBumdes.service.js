// src/services/outputBumdes.service.js
// Prolap — rekap OUTPUT BUMDes. Pemilik output: bidang SPKED.
//
// Tabel `bumdes` menyimpan angka keuangan sebagai KOLOM PER TAHUN
// (`Omset2023`, `Omset2024`, `PenyertaanModal2019`…). Bentuk itu tidak bisa
// dibaca sebagai deret waktu, dan setiap tahun baru menuntut kolom baru. Di
// sini kolom-kolom tersebut dibalik (unpivot) jadi deret {tahun, nilai} sekali
// di satu tempat, sehingga halaman Prolap tidak ikut berubah tiap ganti tahun.
//
// Dua kenyataan data yang WAJIB ikut dilaporkan, bukan disembunyikan:
//  1. Tidak semua desa punya baris BUMDes. Desa tanpa baris berarti BELUM
//     TERDATA — bukan bukti bahwa desanya tidak punya BUMDes. Dua hal berbeda
//     yang tidak bisa dipisahkan dari data sekarang.
//  2. Kolom keuangan banyak yang kosong. Setiap angka disertai jumlah BUMDes
//     yang benar-benar mengisinya, supaya rata-rata tidak dibaca seolah
//     mewakili semua.
//
// Dua jebakan sumber data yang sudah terbukti dan tidak boleh terulang:
//  - `bumdes.desa_id` KOSONG di seluruh baris. Penghubung ke desa yang benar
//    adalah `kode_desa`, yang cocok 187/187 dengan `desas.kode`.
//  - Ada nilai salah ketik ekstrem (mis. penyertaan modal Rp 1.000.000.002.018
//    di satu BUMDes, sementara nilai wajar tertinggi ±Rp 562 juta). Nilai
//    semacam itu dipisahkan dari penjumlahan DAN dilaporkan, bukan diam-diam
//    dibuang atau diam-diam ikut menjadi angka utama.
const prisma = require('../config/prisma');

const toNumber = (value) => {
  if (value === null || value === undefined) return 0;
  const numeric = typeof value === 'bigint' ? Number(value) : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const persen = (bagian, total) => (total > 0 ? Math.round((bagian / total) * 1000) / 10 : 0);

// Kelompok kolom-per-tahun yang akan dibalik jadi deret waktu.
// `awalan` + tahun = nama kolom di basis data.
const DERET = [
  { key: 'penyertaan_modal', label: 'Penyertaan Modal Desa', awalan: 'PenyertaanModal', tahun: [2019, 2020, 2021, 2022, 2023, 2024], slot: 1 },
  { key: 'omset', label: 'Omset', awalan: 'Omset', tahun: [2023, 2024], slot: 2 },
  { key: 'laba', label: 'Laba', awalan: 'Laba', tahun: [2023, 2024], slot: 3 },
  { key: 'kontribusi_pades', label: 'Kontribusi terhadap PADes', awalan: 'KontribusiTerhadapPADes', tahun: [2021, 2022, 2023, 2024], slot: 4 },
];

/** Nama kolom untuk satu deret pada satu tahun. */
const namaKolom = (deret, tahun) => `${deret.awalan}${tahun}`;

/**
 * Nilai yang lebih dari 100x nilai tengah dianggap salah ketik, bukan angka
 * asli. Ambang relatif dipakai — bukan batas rupiah tetap — supaya aturannya
 * tetap masuk akal saat besaran datanya berubah.
 */
const BATAS_JANGGAL = 100;

const median = (angka) => {
  if (!angka.length) return 0;
  const urut = [...angka].sort((a, b) => a - b);
  const tengah = Math.floor(urut.length / 2);
  return urut.length % 2 ? urut[tengah] : (urut[tengah - 1] + urut[tengah]) / 2;
};

const fetchBumdes = async () => {
  const kolomDeret = DERET.flatMap((deret) => deret.tahun.map((tahun) => `b.\`${namaKolom(deret, tahun)}\``));
  return prisma.$queryRawUnsafe(
    `SELECT b.id, b.desa_id, b.namabumdesa, b.status, b.badanhukum, b.NIB, b.NPWP, b.LKPP,
            b.TahunPendirian, b.TotalTenagaKerja, b.JenisUsahaUtama, b.DesaWisata,
            b.NilaiAset, b.NomorPerdes, b.Perdes, b.SK_BUM_Desa,
            b.LaporanKeuangan2021, b.LaporanKeuangan2022, b.LaporanKeuangan2023, b.LaporanKeuangan2024,
            ${kolomDeret.join(', ')},
            b.desa AS desa_teks, b.kecamatan AS kecamatan_teks,
            d.id AS desa_ref, d.nama AS nama_desa, k.nama AS nama_kecamatan
     FROM bumdes b
     LEFT JOIN desas d ON REPLACE(d.kode, '.', '') = REPLACE(b.kode_desa, '.', '')
     LEFT JOIN kecamatans k ON k.id = d.kecamatan_id`
  );
};

const fetchJumlahDesa = async () => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS total FROM desas WHERE status_pemerintahan = 'desa'`
  );
  return toNumber(rows[0]?.total);
};

const terisi = (nilai) => nilai !== null && nilai !== undefined && String(nilai).trim() !== '';

const getOutputBumdes = async () => {
  const [rows, totalDesaSistem] = await Promise.all([fetchBumdes(), fetchJumlahDesa()]);

  const aktif = rows.filter((row) => row.status === 'aktif').length;
  const berBadanHukum = rows.filter((row) => terisi(row.badanhukum)).length;

  // ---------- Unpivot kolom-per-tahun ----------
  // Ambang kejanggalan dihitung sekali per deret dari seluruh tahunnya, supaya
  // satu tahun yang kebetulan sepi tidak punya ambang sendiri yang aneh.
  const janggal = [];
  const deret = DERET.map((item) => {
    const semuaNilai = [];
    for (const row of rows) {
      for (const tahun of item.tahun) {
        const nilai = toNumber(row[namaKolom(item, tahun)]);
        if (nilai > 0) semuaNilai.push(nilai);
      }
    }
    const nilaiTengah = median(semuaNilai);
    const ambang = nilaiTengah > 0 ? nilaiTengah * BATAS_JANGGAL : Infinity;

    const perTahun = item.tahun.map((tahun) => {
      const kolom = namaKolom(item, tahun);
      let jumlah = 0;
      let pengisi = 0;
      let dikecualikan = 0;
      for (const row of rows) {
        const nilai = toNumber(row[kolom]);
        if (nilai <= 0) continue;
        if (nilai > ambang) {
          dikecualikan += 1;
          janggal.push({
            deret: item.key,
            deret_label: item.label,
            tahun,
            nama: row.namabumdesa,
            desa: row.nama_desa || row.desa_teks,
            nilai,
          });
          continue;
        }
        jumlah += nilai;
        pengisi += 1;
      }
      return {
        tahun,
        nilai: jumlah,
        pengisi,
        dikecualikan,
        persen_pengisi: persen(pengisi, rows.length),
        rata_rata: pengisi > 0 ? Math.round(jumlah / pengisi) : 0,
      };
    });
    return {
      key: item.key,
      label: item.label,
      slot: item.slot,
      per_tahun: perTahun,
      total: perTahun.reduce((total, tahun) => total + tahun.nilai, 0),
      tahun_terakhir: perTahun[perTahun.length - 1] || null,
    };
  });

  // ---------- Kelengkapan legalitas & dokumen ----------
  const kelengkapan = [
    { key: 'badan_hukum', label: 'Badan hukum', jumlah: berBadanHukum },
    { key: 'nib', label: 'NIB', jumlah: rows.filter((row) => terisi(row.NIB)).length },
    { key: 'npwp', label: 'NPWP', jumlah: rows.filter((row) => terisi(row.NPWP)).length },
    { key: 'lkpp', label: 'Terdaftar LKPP', jumlah: rows.filter((row) => terisi(row.LKPP)).length },
    { key: 'perdes', label: 'Perdes pendirian', jumlah: rows.filter((row) => terisi(row.Perdes) || terisi(row.NomorPerdes)).length },
    { key: 'sk', label: 'SK BUM Desa', jumlah: rows.filter((row) => terisi(row.SK_BUM_Desa)).length },
    {
      key: 'laporan_keuangan',
      label: 'Laporan keuangan terakhir (2024)',
      jumlah: rows.filter((row) => terisi(row.LaporanKeuangan2024)).length,
    },
  ].map((item) => ({ ...item, persen: persen(item.jumlah, rows.length) }));

  // ---------- Sebaran ----------
  const perKecamatan = new Map();
  for (const row of rows) {
    const nama = row.nama_kecamatan || row.kecamatan_teks || 'Tidak Diketahui';
    if (!perKecamatan.has(nama)) {
      perKecamatan.set(nama, { nama, total: 0, aktif: 0, badan_hukum: 0, tenaga_kerja: 0, aset: 0 });
    }
    const kecamatan = perKecamatan.get(nama);
    kecamatan.total += 1;
    if (row.status === 'aktif') kecamatan.aktif += 1;
    if (terisi(row.badanhukum)) kecamatan.badan_hukum += 1;
    kecamatan.tenaga_kerja += toNumber(row.TotalTenagaKerja);
    kecamatan.aset += toNumber(row.NilaiAset);
  }

  const jenisUsaha = new Map();
  for (const row of rows) {
    const jenis = terisi(row.JenisUsahaUtama) ? String(row.JenisUsahaUtama).trim() : 'Belum diisi';
    jenisUsaha.set(jenis, (jenisUsaha.get(jenis) || 0) + 1);
  }

  const tenagaKerja = rows.reduce((total, row) => total + toNumber(row.TotalTenagaKerja), 0);
  const pengisiTenagaKerja = rows.filter((row) => toNumber(row.TotalTenagaKerja) > 0).length;
  const aset = rows.reduce((total, row) => total + toNumber(row.NilaiAset), 0);
  const pengisiAset = rows.filter((row) => toNumber(row.NilaiAset) > 0).length;

  return {
    ringkasan: {
      terdata: rows.length,
      aktif,
      tidak_aktif: rows.length - aktif,
      badan_hukum: berBadanHukum,
      persen_badan_hukum: persen(berBadanHukum, rows.length),
      desa_sistem: totalDesaSistem,
      desa_terdata: new Set(rows.filter((row) => row.desa_ref).map((row) => toNumber(row.desa_ref))).size,
      // Sengaja disebut "belum terdata", bukan "tidak punya BUMDes".
      desa_belum_terdata: Math.max(
        totalDesaSistem - new Set(rows.filter((row) => row.desa_ref).map((row) => toNumber(row.desa_ref))).size,
        0
      ),
      tenaga_kerja: tenagaKerja,
      pengisi_tenaga_kerja: pengisiTenagaKerja,
      aset: aset,
      pengisi_aset: pengisiAset,
      desa_wisata: rows.filter((row) => terisi(row.DesaWisata)).length,
    },
    deret,
    kelengkapan,
    jenis_usaha: [...jenisUsaha.entries()]
      .map(([jenis, jumlah]) => ({ jenis, jumlah }))
      .sort((a, b) => b.jumlah - a.jumlah)
      .slice(0, 12),
    per_kecamatan: [...perKecamatan.values()].sort((a, b) => b.total - a.total),
    daftar: rows
      .map((row) => ({
        id: toNumber(row.id),
        nama: row.namabumdesa,
        nama_desa: row.nama_desa || row.desa_teks,
        nama_kecamatan: row.nama_kecamatan || row.kecamatan_teks || 'Tidak Diketahui',
        desa_dikenali: Boolean(row.desa_ref),
        status: row.status,
        badan_hukum: terisi(row.badanhukum),
        tahun_pendirian: row.TahunPendirian || null,
        jenis_usaha: terisi(row.JenisUsahaUtama) ? row.JenisUsahaUtama : null,
        tenaga_kerja: toNumber(row.TotalTenagaKerja),
        aset: toNumber(row.NilaiAset),
        omset_terakhir: toNumber(row.Omset2024),
        laba_terakhir: toNumber(row.Laba2024),
        kontribusi_pades_terakhir: toNumber(row.KontribusiTerhadapPADes2024),
      }))
      .sort((a, b) => b.omset_terakhir - a.omset_terakhir),
    catatan_data: {
      // Nilai yang dikecualikan dari penjumlahan karena besarnya tidak masuk
      // akal. Ditampilkan supaya bisa diperbaiki di sumbernya, bukan dipendam.
      nilai_janggal: janggal.sort((a, b) => b.nilai - a.nilai),
      bumdes_tanpa_desa_dikenali: rows.filter((row) => !row.desa_ref).length,
      // Kolom-per-tahun: batas tahun yang tersedia berasal dari struktur tabel,
      // bukan dari data. Menambah tahun berarti menambah kolom + memperbarui DERET.
      tahun_tersedia: DERET.map((item) => ({
        key: item.key,
        label: item.label,
        dari: item.tahun[0],
        sampai: item.tahun[item.tahun.length - 1],
      })),
    },
    generated_at: new Date().toISOString(),
  };
};

module.exports = { getOutputBumdes, DERET };
