/**
 * Core Dashboard: ringkasan lintas modul dan rapor wilayah.
 * Logika olah data ada di services/coreRingkasan.service.js.
 */

const prisma = require('../config/prisma');
const {
  kunciKode, hitungTotal, susunPerhatian, ambilBarisDesa, tahunDana,
} = require('../services/coreRingkasan.service');

const num = (v) => (v === null || v === undefined ? null : Number(v));
const urutNama = (a, b) => a.nama.localeCompare(b.nama, 'id');
const idValid = (id) => /^\d+$/.test(String(id));
const tidakValid = (res) => res.status(400).json({ success: false, message: 'ID tidak valid' });

// groupBy -> [{ [kunci]: nilai, jumlah }] urut jumlah turun
const kelompok = (rows, kunci, ubah = (x) => x) =>
  rows
    .map((r) => ({ [kunci]: ubah(r[kunci]), jumlah: Number(r._count._all) }))
    .sort((a, b) => b.jumlah - a.jumlah);

const getRingkasan = async (req, res, next) => {
  try {
    const [kecamatans, { baris, sipandaGagal }] = await Promise.all([
      prisma.kecamatans.findMany({ select: { id: true, nama: true } }),
      ambilBarisDesa({}),
    ]);
    const total = hitungTotal(baris);
    res.json({
      success: true,
      data: {
        diperbarui: new Date().toISOString(),
        tahun_dana: tahunDana,
        sumber_gagal: sipandaGagal ? ['sipanda'] : [],
        wilayah: { kecamatan: kecamatans.length, desa: total.desa, kelurahan: total.kelurahan },
        total,
        per_kecamatan: kecamatans
          .map((k) => ({
            id: Number(k.id),
            nama: k.nama,
            ...hitungTotal(baris.filter((b) => b.kecamatan_id === Number(k.id))),
          }))
          .sort(urutNama),
        perhatian: susunPerhatian(baris, { tahunDana }),
      },
    });
  } catch (err) {
    next(err);
  }
};

const getWilayah = async (req, res, next) => {
  try {
    const [kecamatans, desas] = await Promise.all([
      prisma.kecamatans.findMany({ select: { id: true, nama: true } }),
      prisma.desas.findMany({ select: { id: true, nama: true, kecamatan_id: true, status_pemerintahan: true } }),
    ]);
    const data = kecamatans
      .map((k) => ({
        id: Number(k.id),
        nama: k.nama,
        desa: desas
          .filter((d) => Number(d.kecamatan_id) === Number(k.id))
          .map((d) => ({ id: Number(d.id), nama: d.nama, jenis: d.status_pemerintahan === 'kelurahan' ? 'kelurahan' : 'desa' }))
          .sort(urutNama),
      }))
      .sort(urutNama);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

const getRaporKecamatan = async (req, res, next) => {
  try {
    if (!idValid(req.params.id)) return tidakValid(res);
    const id = BigInt(req.params.id);
    const kec = await prisma.kecamatans.findUnique({ where: { id }, select: { id: true, nama: true, nama_camat: true } });
    if (!kec) return res.status(404).json({ success: false, message: 'Kecamatan tidak ditemukan' });
    const { baris, sipandaGagal } = await ambilBarisDesa({ kecamatan_id: id });
    res.json({
      success: true,
      data: {
        kecamatan: { id: Number(kec.id), nama: kec.nama, nama_camat: kec.nama_camat },
        tahun_dana: tahunDana,
        sumber_gagal: sipandaGagal ? ['sipanda'] : [],
        total: hitungTotal(baris),
        desa: baris,
        perhatian: susunPerhatian(baris, { tahunDana }),
      },
    });
  } catch (err) {
    next(err);
  }
};

// Nilai pertama yang tak-null dari daftar [tahun, nilai]
const pertamaAda = (pasangan) => {
  const p = pasangan.find(([, v]) => v !== null && v !== undefined);
  return p ? { tahun: p[0], nilai: Number(p[1]) } : null;
};

const getRaporDesa = async (req, res, next) => {
  try {
    if (!idValid(req.params.id)) return tidakValid(res);
    const id = BigInt(req.params.id);
    const { baris, sipanda, sipandaGagal } = await ambilBarisDesa({ id });
    if (!baris.length) return res.status(404).json({ success: false, message: 'Desa tidak ditemukan' });
    const desa = baris[0];

    const f = { desa_id: id };
    const aktif = { ...f, status_kelembagaan: 'aktif' };
    const [kec, profil, jk, jabatan, pendidikan, bd, phJenis, phTerbaru,
      rw, rt, posyandu, lpm, pkk, karangTaruna, satlinmas, lainnya, kerjasama] = await Promise.all([
      prisma.kecamatans.findUnique({ where: { id: BigInt(desa.kecamatan_id) }, select: { id: true, nama: true, nama_camat: true } }),
      prisma.profil_desas.findUnique({
        where: { desa_id: id },
        select: {
          status_desa: true, klasifikasi_desa: true, tipologi_desa: true, jumlah_penduduk: true, luas_wilayah: true,
          alamat_kantor: true, no_telp: true, email: true, latitude: true, longitude: true,
          foto_kantor_desa_path: true, updated_at: true,
        },
      }),
      prisma.aparatur_desa.groupBy({ by: ['jenis_kelamin'], where: { ...f, status: 'Aktif' }, _count: { _all: true } }),
      prisma.aparatur_desa.groupBy({ by: ['jabatan'], where: { ...f, status: 'Aktif' }, _count: { _all: true } }),
      prisma.aparatur_desa.groupBy({ by: ['pendidikan_terakhir'], where: { ...f, status: 'Aktif' }, _count: { _all: true } }),
      desa.bumdes ? prisma.bumdes.findUnique({ where: { id: desa.bumdes.id } }) : null,
      prisma.produk_hukums.groupBy({ by: ['jenis'], where: f, _count: { _all: true } }),
      prisma.produk_hukums.findMany({
        where: f,
        select: { id: true, judul: true, nomor: true, tahun: true, jenis: true },
        orderBy: { tanggal_penetapan: 'desc' },
        take: 5,
      }),
      prisma.rws.count({ where: aktif }),
      prisma.rts.count({ where: aktif }),
      prisma.posyandus.count({ where: aktif }),
      prisma.lpms.count({ where: aktif }),
      prisma.pkks.count({ where: aktif }),
      prisma.karang_tarunas.count({ where: aktif }),
      prisma.satlinmas.count({ where: aktif }),
      prisma.lembaga_lainnyas.count({ where: aktif }),
      prisma.kerjasama_desa.count({ where: f }),
    ]);

    // Dana per sumber dari baris SIPANDA desa ini (pencocokan sama dengan olahDesa)
    let dana = null;
    if (Array.isArray(sipanda)) {
      const kunci = kunciKode(desa.kode);
      const milik = sipanda.filter((r) => kunciKode(r.id_desa) === kunci);
      if (milik.length) {
        const sumber = new Map();
        for (const r of milik) {
          const s = sumber.get(r.sumber_dana) || { sumber: r.sumber_dana, pagu: 0, cair: 0 };
          const nilai = parseFloat(r.anggaran) || 0;
          s.pagu += nilai;
          if (String(r.sudah_cair).toUpperCase() === 'Y') s.cair += nilai;
          sumber.set(r.sumber_dana, s);
        }
        dana = {
          pagu: desa.dana.pagu,
          cair: desa.dana.cair,
          per_sumber: [...sumber.values()].sort((a, b) => String(a.sumber).localeCompare(String(b.sumber), 'id')),
        };
      }
    }

    res.json({
      success: true,
      data: {
        desa,
        kecamatan: { id: Number(kec.id), nama: kec.nama, nama_camat: kec.nama_camat },
        tahun_dana: tahunDana,
        sumber_gagal: sipandaGagal ? ['sipanda'] : [],
        profil: profil
          ? { ...profil, jumlah_penduduk: num(profil.jumlah_penduduk), latitude: num(profil.latitude), longitude: num(profil.longitude) }
          : null,
        aparatur: {
          aktif: desa.aparatur,
          per_jenis_kelamin: kelompok(jk, 'jenis_kelamin', (v) => (v === 'Laki_laki' ? 'Laki-laki' : v)),
          per_jabatan: kelompok(jabatan, 'jabatan'),
          per_pendidikan: kelompok(pendidikan, 'pendidikan_terakhir').map(({ pendidikan_terakhir, jumlah }) => ({
            pendidikan: pendidikan_terakhir,
            jumlah,
          })),
        },
        bumdes: bd
          ? {
              id: bd.id,
              nama: bd.namabumdesa,
              status: desa.bumdes.status,
              badan_hukum: desa.bumdes.badan_hukum,
              jenis_usaha: bd.JenisUsahaUtama,
              tenaga_kerja: bd.TotalTenagaKerja,
              nilai_aset: num(bd.NilaiAset),
              omset: pertamaAda([[2025, bd.Omset2025], [2024, bd.Omset2024], [2023, bd.Omset2023]]),
              laba: pertamaAda([[2025, bd.Laba2025], [2024, bd.Laba2024], [2023, bd.Laba2023]]),
            }
          : null,
        produk_hukum: {
          total: desa.produk_hukum,
          per_jenis: kelompok(phJenis, 'jenis', (v) => String(v).replace(/_/g, ' ')),
          terbaru: phTerbaru.map((p) => ({
            id: p.id, judul: p.judul, nomor: p.nomor, tahun: p.tahun, jenis: String(p.jenis).replace(/_/g, ' '),
          })),
        },
        kelembagaan: { rw, rt, posyandu, lpm, pkk, karang_taruna: karangTaruna, satlinmas, lainnya },
        kerjasama,
        dana,
        perhatian: susunPerhatian([desa], { tahunDana })
          .filter((p) => p.desa.length)
          .map(({ kunci, judul }) => ({ kunci, judul })),
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { getRingkasan, getWilayah, getRaporKecamatan, getRaporDesa };
