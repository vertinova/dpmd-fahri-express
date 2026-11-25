/**
 * Ringkasan Core Dashboard
 * Menggabungkan data lintas modul per desa (profil, aparatur, BUM Desa, produk hukum,
 * penyaluran dana SIPANDA) untuk beranda ringkasan dan halaman Rapor Desa/Kecamatan.
 * Fungsi olah/skor/hitung/susun murni (dites tanpa DB); hanya ambilBarisDesa yang menyentuh DB.
 */

const prisma = require('../config/prisma');
const { fetchSipandaRows, SIPANDA_TAHUN } = require('./sipanda.service');

// Baris SIPANDA dicocokkan lewat kode, bukan nama: `id_desa` SIPANDA (3201022001) sama
// dengan desas.kode (32.01.02.2001) tanpa titik. Lewat nama, 6 dari 416 desa lolos karena
// beda ejaan (Cileubut/Cilebut Barat, Pasirbuncir/Pasir Buncir) — diukur 25 Nov 2026.
const kunciKode = (kode) => String(kode || '').replace(/\D/g, '');
const num = (v) => (v === null || v === undefined ? null : Number(v));
const terisi = (v) => typeof v === 'string' && v.trim() !== '';

const peta = (arr, fn) => new Map((arr || []).map((r) => [Number(r.desa_id), fn(r)]));

// Bila beberapa baris per desa: utamakan 'aktif', lalu id terkecil.
const pilihBumdes = (daftar) =>
  [...daftar].sort(
    (a, b) => (a.status === 'aktif' ? 0 : 1) - (b.status === 'aktif' ? 0 : 1) || a.id - b.id
  )[0];

const skorDesa = (b) => {
  if (b.jenis !== 'desa') return null;
  const lulus = [b.profil_lengkap, !!b.kades, b.bumdes?.status === 'aktif', b.perdes > 0].filter(Boolean).length;
  return (lulus / 4) * 100;
};

const olahDesa = (mentah) => {
  const { desas, profil, aparaturAktif, kades, bumdes, produkHukum, perdes, sipanda } = mentah;
  const profilMap = peta(profil, (r) => r);
  const aparaturMap = peta(aparaturAktif, (r) => Number(r._count?._all || 0));
  const kadesMap = new Map();
  for (const k of kades || []) {
    const id = Number(k.desa_id);
    if (!kadesMap.has(id)) kadesMap.set(id, k.nama_lengkap);
  }
  const bumdesGrup = new Map();
  for (const b of bumdes || []) {
    const id = Number(b.desa_id);
    if (!bumdesGrup.has(id)) bumdesGrup.set(id, []);
    bumdesGrup.get(id).push(b);
  }
  const phMap = peta(produkHukum, (r) => Number(r._count?._all || 0));
  const perdesMap = peta(perdes, (r) => Number(r._count?._all || 0));

  const danaMap = new Map();
  if (Array.isArray(sipanda)) {
    for (const r of sipanda) {
      const k = kunciKode(r.id_desa);
      const d = danaMap.get(k) || { pagu: 0, cair: 0 };
      const nilai = parseFloat(r.anggaran) || 0;
      d.pagu += nilai;
      if (String(r.sudah_cair).toUpperCase() === 'Y') d.cair += nilai;
      danaMap.set(k, d);
    }
  }

  return (desas || []).map((d) => {
    const id = Number(d.id);
    const p = profilMap.get(id);
    const namaKec = d.kecamatans?.nama ?? d.kecamatan ?? null;
    const daftarBumdes = bumdesGrup.get(id);
    const b = daftarBumdes ? pilihBumdes(daftarBumdes) : null;
    const ada = (v) => v !== null && v !== undefined;
    const baris = {
      id,
      nama: d.nama,
      kode: d.kode,
      kecamatan_id: Number(d.kecamatan_id),
      kecamatan: namaKec,
      jenis: d.status_pemerintahan === 'kelurahan' ? 'kelurahan' : 'desa',
      penduduk: p ? num(p.jumlah_penduduk) : null,
      profil_lengkap: !!(
        p && terisi(p.status_desa) && terisi(p.klasifikasi_desa) &&
        Number(p.jumlah_penduduk) > 0 && ada(p.latitude) && ada(p.longitude)
      ),
      kades: kadesMap.get(id) ?? null,
      aparatur: aparaturMap.get(id) || 0,
      bumdes: b
        ? {
            id: b.id,
            nama: b.namabumdesa,
            status: b.status === 'aktif' ? 'aktif' : 'tidak_aktif',
            badan_hukum: terisi(b.badanhukum),
          }
        : null,
      produk_hukum: phMap.get(id) || 0,
      perdes: perdesMap.get(id) || 0,
      dana: danaMap.get(kunciKode(d.kode)) || null,
    };
    return { ...baris, skor: skorDesa(baris) };
  });
};

const hitungTotal = (baris) => {
  const desa = baris.filter((b) => b.jenis === 'desa');
  const adaDana = baris.filter((b) => b.dana);
  const skor = desa.length
    ? Math.round((desa.reduce((s, b) => s + skorDesa(b), 0) / desa.length) * 10) / 10
    : null;
  return {
    desa: desa.length,
    kelurahan: baris.length - desa.length,
    penduduk: baris.reduce((s, b) => s + (b.penduduk || 0), 0),
    aparatur: baris.reduce((s, b) => s + b.aparatur, 0),
    profil_lengkap: desa.filter((b) => b.profil_lengkap).length,
    kades: desa.filter((b) => b.kades).length,
    bumdes: desa.filter((b) => b.bumdes).length,
    bumdes_aktif: desa.filter((b) => b.bumdes?.status === 'aktif').length,
    bumdes_berbadan_hukum: desa.filter((b) => b.bumdes?.badan_hukum).length,
    desa_punya_perdes: desa.filter((b) => b.perdes > 0).length,
    produk_hukum: baris.reduce((s, b) => s + b.produk_hukum, 0),
    dana: adaDana.length
      ? {
          pagu: adaDana.reduce((s, b) => s + b.dana.pagu, 0),
          cair: adaDana.reduce((s, b) => s + b.dana.cair, 0),
          desa_belum_cair: desa.filter((b) => b.dana && b.dana.pagu > 0 && b.dana.cair === 0).length,
        }
      : null,
    skor,
  };
};

const susunPerhatian = (baris, { tahunDana } = {}) => {
  const desa = baris.filter((b) => b.jenis === 'desa');
  const adaDana = baris.some((b) => b.dana);
  const aturan = [
    adaDana && [
      'dana_belum_cair',
      'Dana belum cair sama sekali',
      `Pagu TA ${tahunDana} sudah tercatat di SIPANDA, tetapi belum satu pun yang cair.`,
      (b) => b.dana && b.dana.pagu > 0 && b.dana.cair === 0,
    ],
    [
      'tanpa_kades',
      'Belum ada kepala desa aktif tercatat',
      'Tidak ada aparatur aktif berjabatan kepala desa di data aparatur.',
      (b) => !b.kades,
    ],
    ['tanpa_bumdes', 'Belum punya BUM Desa', 'Desa belum terdaftar di data BUM Desa.', (b) => !b.bumdes],
    [
      'bumdes_tidak_aktif',
      'BUM Desa tidak aktif',
      'BUM Desa terdaftar tetapi berstatus tidak aktif.',
      (b) => b.bumdes && b.bumdes.status !== 'aktif',
    ],
    [
      'tanpa_perdes',
      'Belum ada Peraturan Desa',
      'Belum satu pun Peraturan Desa diunggah ke produk hukum.',
      (b) => b.perdes === 0,
    ],
    [
      'profil_belum_lengkap',
      'Profil desa belum lengkap',
      'Status, klasifikasi, jumlah penduduk, atau koordinat kantor belum diisi.',
      (b) => !b.profil_lengkap,
    ],
  ].filter(Boolean);
  const urut = (a, b) =>
    (a.kecamatan || '').localeCompare(b.kecamatan || '', 'id') || a.nama.localeCompare(b.nama, 'id');
  return aturan.map(([kunci, judul, keterangan, cocok]) => ({
    kunci,
    judul,
    keterangan,
    desa: desa
      .filter(cocok)
      .sort(urut)
      .map(({ id, nama, kecamatan_id, kecamatan }) => ({ id, nama, kecamatan_id, kecamatan })),
  }));
};

const ambilBarisDesa = async (whereDesas) => {
  const desas = await prisma.desas.findMany({
    where: whereDesas,
    select: {
      id: true, nama: true, kode: true, kecamatan_id: true, status_pemerintahan: true,
      kecamatans: { select: { nama: true } },
    },
    orderBy: [{ kecamatan_id: 'asc' }, { nama: 'asc' }],
  });
  const ids = desas.map((d) => d.id);
  const f = { desa_id: { in: ids } };
  const [profil, aparaturAktif, kades, bumdes, produkHukum, perdes, sipanda] = await Promise.all([
    prisma.profil_desas.findMany({
      where: f,
      select: { desa_id: true, status_desa: true, klasifikasi_desa: true, jumlah_penduduk: true, latitude: true, longitude: true },
    }),
    prisma.aparatur_desa.groupBy({ by: ['desa_id'], where: { ...f, status: 'Aktif' }, _count: { _all: true } }),
    prisma.aparatur_desa.findMany({
      where: { ...f, status: 'Aktif', jabatan: { contains: 'kepala desa', mode: 'insensitive' } },
      select: { desa_id: true, nama_lengkap: true },
      orderBy: { tanggal_pengangkatan: 'desc' },
    }),
    prisma.bumdes.findMany({
      where: { desa_id: { in: ids.map(Number) } },
      select: { id: true, desa_id: true, namabumdesa: true, status: true, badanhukum: true },
    }),
    prisma.produk_hukums.groupBy({ by: ['desa_id'], where: f, _count: { _all: true } }),
    prisma.produk_hukums.groupBy({ by: ['desa_id'], where: { ...f, jenis: 'Peraturan_Desa' }, _count: { _all: true } }),
    fetchSipandaRows({ timeoutMs: 8000 }).catch(() => null),
  ]);
  return {
    baris: olahDesa({ desas, profil, aparaturAktif, kades, bumdes, produkHukum, perdes, sipanda }),
    sipanda,
    sipandaGagal: sipanda === null,
  };
};

module.exports = {
  kunciKode, olahDesa, skorDesa, hitungTotal, susunPerhatian, ambilBarisDesa,
  tahunDana: String(SIPANDA_TAHUN),
};
