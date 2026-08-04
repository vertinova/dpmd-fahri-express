// src/services/outputKelembagaan.service.js
// Prolap — rekap OUTPUT kelembagaan desa. Pemilik output: bidang PMD.
//
// Delapan tabel kelembagaan (posyandu, RT, RW, LPM, PKK, Karang Taruna,
// Satlinmas, lembaga lainnya) berkolom sama persis, jadi seluruhnya diolah satu
// jalur — bukan delapan query yang ditulis ulang.
//
// Tiga kenyataan data yang WAJIB ikut dilaporkan, bukan disembunyikan:
//  1. Verifikasi BELUM PERNAH DIPAKAI. Kolom `status_verifikasi` punya nilai
//     'verified', tapi per hari ini tidak ada satu pun baris memakainya di
//     seluruh sembilan tabel. Karena itu output utamanya adalah lembaga
//     TERDATA & AKTIF; status verifikasi dilaporkan terpisah apa adanya.
//  2. Sebagian besar baris berasal dari impor massal (`imported = 1`), bukan
//     input desa. Keduanya dihitung terpisah supaya capaian tidak terlihat
//     bagus hanya karena hasil impor.
//  3. `rts.jumlah_jiwa` / `jumlah_kk` hampir seluruhnya kosong (±1% terisi),
//     jadi tidak dijadikan output — hanya dilaporkan tingkat keterisiannya.
const prisma = require('../config/prisma');

// ============================================================
// Jenis lembaga
// ============================================================
// `pengurus_type` = nilai kolom `pengurus.pengurusable_type`. Perhatikan
// lembaga lainnya memakai 'lembaga-lainnya' (bertanda hubung), tidak sama
// dengan nama tabelnya — ketidakseragaman yang ada di data, bukan salah ketik.
const JENIS = {
  posyandu: { tabel: 'posyandus', label: 'Posyandu', pengurus_type: 'posyandus', slot: 1 },
  rt: { tabel: 'rts', label: 'Rukun Tetangga (RT)', pengurus_type: 'rts', slot: 2 },
  rw: { tabel: 'rws', label: 'Rukun Warga (RW)', pengurus_type: 'rws', slot: 3 },
  lpm: { tabel: 'lpms', label: 'Lembaga Pemberdayaan Masyarakat', pengurus_type: 'lpms', slot: 4 },
  pkk: { tabel: 'pkks', label: 'PKK', pengurus_type: 'pkks', slot: 5 },
  karang_taruna: { tabel: 'karang_tarunas', label: 'Karang Taruna', pengurus_type: 'karang_tarunas', slot: 6 },
  satlinmas: { tabel: 'satlinmas', label: 'Satlinmas', pengurus_type: 'satlinmas', slot: 7 },
  lembaga_lainnya: { tabel: 'lembaga_lainnyas', label: 'Lembaga Lainnya', pengurus_type: 'lembaga-lainnya', slot: 8 },
};

const toNumber = (value) => {
  if (value === null || value === undefined) return 0;
  const numeric = typeof value === 'bigint' ? Number(value) : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const persen = (bagian, total) => (total > 0 ? Math.round((bagian / total) * 1000) / 10 : 0);

// ============================================================
// Pengambilan data
// ============================================================
/**
 * Satu query UNION untuk kedelapan tabel, sudah teragregasi di sisi basis data
 * supaya yang berpindah ke Node hanya ribuan baris ringkas, bukan 24 ribu baris
 * lembaga mentah.
 */
const fetchLembaga = async () => {
  const bagian = Object.entries(JENIS).map(
    ([key, meta]) => `
      SELECT '${key}' AS jenis, desa_id,
             status_kelembagaan AS status,
             status_verifikasi AS verifikasi,
             imported,
             (produk_hukum_id IS NOT NULL) AS ber_sk,
             COUNT(*) AS jumlah
      FROM ${meta.tabel}
      GROUP BY desa_id, status_kelembagaan, status_verifikasi, imported, ber_sk`
  );
  return prisma.$queryRawUnsafe(bagian.join(' UNION ALL '));
};

const fetchPengurus = async () => {
  return prisma.$queryRawUnsafe(
    `SELECT pengurusable_type AS tipe, desa_id,
            status_jabatan AS status, status_verifikasi AS verifikasi,
            COUNT(*) AS jumlah
     FROM pengurus
     GROUP BY pengurusable_type, desa_id, status_jabatan, status_verifikasi`
  );
};

const fetchPetaDesa = async () => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT d.id, d.nama, d.status_pemerintahan, k.id AS kecamatan_id, k.nama AS nama_kecamatan
     FROM desas d
     LEFT JOIN kecamatans k ON k.id = d.kecamatan_id`
  );
  const peta = new Map();
  for (const row of rows) {
    peta.set(toNumber(row.id), {
      desa_id: toNumber(row.id),
      nama_desa: row.nama,
      kecamatan_id: toNumber(row.kecamatan_id),
      nama_kecamatan: row.nama_kecamatan || 'Tidak Diketahui',
      status_pemerintahan: row.status_pemerintahan,
    });
  }
  return peta;
};

/** Keterisian jumlah jiwa/KK pada RT — dilaporkan, tidak dijadikan output. */
const fetchKeterisianRt = async () => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS total,
            SUM(jumlah_jiwa > 0) AS ada_jiwa,
            SUM(jumlah_kk > 0) AS ada_kk,
            COALESCE(SUM(jumlah_jiwa), 0) AS jiwa,
            COALESCE(SUM(jumlah_kk), 0) AS kk
     FROM rts`
  );
  const row = rows[0] || {};
  return {
    rt_total: toNumber(row.total),
    rt_dengan_jiwa: toNumber(row.ada_jiwa),
    rt_dengan_kk: toNumber(row.ada_kk),
    jiwa_tercatat: toNumber(row.jiwa),
    kk_tercatat: toNumber(row.kk),
  };
};

// ============================================================
// Agregasi
// ============================================================
const wadah = () => ({
  total: 0,
  aktif: 0,
  nonaktif: 0,
  input_desa: 0,
  impor: 0,
  ber_sk: 0,
  verified: 0,
  unverified: 0,
  ditolak: 0,
});

const tambah = (bucket, row, jumlah) => {
  bucket.total += jumlah;
  if (row.status === 'nonaktif') bucket.nonaktif += jumlah;
  else bucket.aktif += jumlah;
  if (toNumber(row.imported) === 1) bucket.impor += jumlah;
  else bucket.input_desa += jumlah;
  if (toNumber(row.ber_sk) === 1) bucket.ber_sk += jumlah;
  if (row.verifikasi === 'verified') bucket.verified += jumlah;
  else if (row.verifikasi === 'ditolak') bucket.ditolak += jumlah;
  else bucket.unverified += jumlah;
};

const rapikan = (bucket, tambahan = {}) => ({
  ...bucket,
  persen_ber_sk: persen(bucket.ber_sk, bucket.total),
  persen_input_desa: persen(bucket.input_desa, bucket.total),
  ...tambahan,
});

/**
 * @param {{ jenis?: string }} options
 */
const getOutputKelembagaan = async (options = {}) => {
  const jenisFilter = options.jenis && JENIS[options.jenis] ? options.jenis : null;

  const [barisLembaga, barisPengurus, petaDesa, keterisianRt] = await Promise.all([
    fetchLembaga(),
    fetchPengurus(),
    fetchPetaDesa(),
    fetchKeterisianRt(),
  ]);

  const baris = jenisFilter ? barisLembaga.filter((row) => row.jenis === jenisFilter) : barisLembaga;

  const ringkasan = wadah();
  const perJenis = new Map();
  const perKecamatan = new Map();
  const perDesa = new Map();
  const desaPunyaJenis = new Map(); // jenis -> Set(desa_id)

  for (const row of baris) {
    const jumlah = toNumber(row.jumlah);
    const desaId = toNumber(row.desa_id);
    const lokal = petaDesa.get(desaId);
    const namaKecamatan = lokal ? lokal.nama_kecamatan : 'Tidak Diketahui';

    tambah(ringkasan, row, jumlah);

    if (!perJenis.has(row.jenis)) perJenis.set(row.jenis, wadah());
    tambah(perJenis.get(row.jenis), row, jumlah);

    if (!desaPunyaJenis.has(row.jenis)) desaPunyaJenis.set(row.jenis, new Set());
    desaPunyaJenis.get(row.jenis).add(desaId);

    if (!perKecamatan.has(namaKecamatan)) {
      perKecamatan.set(namaKecamatan, { ...wadah(), nama: namaKecamatan, desa: new Set() });
    }
    const kecamatan = perKecamatan.get(namaKecamatan);
    tambah(kecamatan, row, jumlah);
    kecamatan.desa.add(desaId);

    if (!perDesa.has(desaId)) {
      perDesa.set(desaId, {
        ...wadah(),
        desa_id: desaId,
        nama_desa: lokal ? lokal.nama_desa : `Desa #${desaId}`,
        nama_kecamatan: namaKecamatan,
        pengurus: 0,
      });
    }
    tambah(perDesa.get(desaId), row, jumlah);
  }

  // ---------- Pengurus ----------
  const tipeDipakai = new Set(
    Object.entries(JENIS)
      .filter(([key]) => !jenisFilter || key === jenisFilter)
      .map(([, meta]) => meta.pengurus_type)
  );
  const tipeKeJenis = new Map(Object.entries(JENIS).map(([key, meta]) => [meta.pengurus_type, key]));

  const pengurus = { total: 0, aktif: 0, selesai: 0, verified: 0 };
  const pengurusPerJenis = new Map();
  for (const row of barisPengurus) {
    if (!tipeDipakai.has(row.tipe)) continue;
    const jumlah = toNumber(row.jumlah);
    pengurus.total += jumlah;
    if (row.status === 'aktif') pengurus.aktif += jumlah;
    else pengurus.selesai += jumlah;
    if (row.verifikasi === 'verified') pengurus.verified += jumlah;

    const jenis = tipeKeJenis.get(row.tipe);
    pengurusPerJenis.set(jenis, (pengurusPerJenis.get(jenis) || 0) + jumlah);

    const desa = perDesa.get(toNumber(row.desa_id));
    if (desa) desa.pengurus += jumlah;
  }

  const desaSistem = [...petaDesa.values()];
  const totalDesaSistem = desaSistem.filter((desa) => desa.status_pemerintahan === 'desa').length;

  return {
    filter: { jenis: jenisFilter || 'semua' },
    opsi: {
      jenis: Object.entries(JENIS).map(([key, meta]) => ({
        key,
        label: meta.label,
        slot: meta.slot,
        jumlah: toNumber(perJenis.get(key)?.total),
      })),
    },
    ringkasan: rapikan(ringkasan, {
      pengurus: pengurus.total,
      pengurus_aktif: pengurus.aktif,
      desa_terjangkau: perDesa.size,
      desa_sistem: totalDesaSistem,
      jenis: perJenis.size,
    }),
    per_jenis: Object.entries(JENIS)
      .filter(([key]) => perJenis.has(key))
      .map(([key, meta]) => ({
        key,
        label: meta.label,
        slot: meta.slot,
        ...rapikan(perJenis.get(key), {
          pengurus: pengurusPerJenis.get(key) || 0,
          desa: desaPunyaJenis.get(key)?.size || 0,
          persen_desa: persen(desaPunyaJenis.get(key)?.size || 0, totalDesaSistem),
        }),
      }))
      .sort((a, b) => a.slot - b.slot),
    per_kecamatan: [...perKecamatan.values()]
      .map((kecamatan) => rapikan(kecamatan, { nama: kecamatan.nama, desa: kecamatan.desa.size }))
      .sort((a, b) => b.total - a.total),
    per_desa: [...perDesa.values()]
      .map((desa) => rapikan(desa))
      .sort((a, b) => b.total - a.total),
    verifikasi: {
      verified: ringkasan.verified,
      unverified: ringkasan.unverified,
      ditolak: ringkasan.ditolak,
      pengurus_verified: pengurus.verified,
      // Dipakai halaman untuk menjelaskan mengapa angka verifikasi nol: bukan
      // datanya gagal dibaca, tapi prosesnya memang belum pernah dijalankan.
      pernah_dipakai: ringkasan.verified > 0 || pengurus.verified > 0,
    },
    catatan_data: {
      ...keterisianRt,
      persen_rt_dengan_jiwa: persen(keterisianRt.rt_dengan_jiwa, keterisianRt.rt_total),
      impor_massal: ringkasan.impor,
      persen_impor: persen(ringkasan.impor, ringkasan.total),
    },
    generated_at: new Date().toISOString(),
  };
};

module.exports = { getOutputKelembagaan, JENIS };
