/**
 * Kerja Sama Desa — sisi DPMD (Bidang SPKED).
 *
 * Hanya MEMANTAU. Tidak ada tulis apa pun di berkas ini: tidak ada verifikasi,
 * tidak ada persetujuan, tidak ada perubahan data desa. Entri yang tampil di
 * dashboard adalah apa adanya yang diisi desa.
 *
 * Empat angka di kepala dashboard dan dua grafiknya dihitung di sini, bukan di
 * layar. Alasannya bukan selera: menghitung di frontend berarti seluruh baris
 * kerja sama se-kabupaten harus dikirim dulu ke peramban hanya untuk
 * menghasilkan empat angka — dan angkanya akan berbeda begitu tabelnya
 * dipaginasi.
 */

const prisma = require('../config/prisma');
const logger = require('../utils/logger');
const {
  BIDANG_KERJASAMA,
  JENIS_KERJASAMA,
  BIDANG_KEYS,
  JENIS_KEYS,
  dokumenUntukJenis,
  dokumenLengkap,
  katalog,
} = require('../config/kerjasamaDesa');

const teks = (nilai) => String(nilai ?? '').trim();

const parseId = (nilai) => {
  try {
    const id = BigInt(String(nilai));
    return id > 0n ? id : null;
  } catch {
    return null;
  }
};

/**
 * Susun klausa penyaring dari query.
 *
 * Dipakai tabel monitoring MAUPUN statistik, supaya angka di kartu selalu
 * menghitung himpunan yang sama dengan isi tabel di bawahnya. Kalau keduanya
 * menyusun penyaringnya sendiri, "Total 177" bisa berdampingan dengan tabel
 * berisi 40 baris tanpa ada yang salah ketik di mana pun.
 */
const susunPenyaring = async (query) => {
  const where = {};

  const tahun = parseInt(query.tahun, 10);
  if (Number.isInteger(tahun)) where.tahun = tahun;

  if (JENIS_KEYS.includes(query.jenis)) where.jenis = query.jenis;
  if (BIDANG_KEYS.includes(query.bidang)) where.bidang = query.bidang;

  const kecamatanId = query.kecamatan_id ? parseId(query.kecamatan_id) : null;
  if (kecamatanId) {
    const desa = await prisma.desas.findMany({ where: { kecamatan_id: kecamatanId }, select: { id: true } });
    where.desa_id = { in: desa.map((d) => d.id) };
  }

  const q = teks(query.q);
  if (q) {
    const desaCocok = await prisma.desas.findMany({ where: { nama: { contains: q } }, select: { id: true } });
    where.OR = [
      { mitra: { contains: q } },
      { sub_bidang: { contains: q } },
      ...(desaCocok.length > 0 ? [{ desa_id: { in: desaCocok.map((d) => d.id) } }] : []),
    ];
  }

  return where;
};

const RELASI_DESA = {
  select: {
    id: true,
    nama: true,
    status_pemerintahan: true,
    kecamatans: { select: { id: true, nama: true } },
  },
};

const bentukBaris = (baris) => ({
  id: String(baris.id),
  tahun: baris.tahun,
  jenis: baris.jenis,
  bidang: baris.bidang,
  sub_bidang: baris.sub_bidang,
  mitra: baris.mitra,
  ruang_lingkup: baris.ruang_lingkup,
  tanggal_mulai: baris.tanggal_mulai,
  tanggal_selesai: baris.tanggal_selesai,
  pelaksanaan: baris.pelaksanaan,
  updated_at: baris.updated_at,
  desa: baris.desas
    ? {
        id: String(baris.desas.id),
        nama: baris.desas.nama,
        status_pemerintahan: baris.desas.status_pemerintahan,
        kecamatan: baris.desas.kecamatans
          ? { id: String(baris.desas.kecamatans.id), nama: baris.desas.kecamatans.nama }
          : null,
      }
    : null,
  dokumen: dokumenUntukJenis(baris.jenis).map((d) => ({
    field: d.field,
    label: d.label,
    singkat: d.singkat,
    file: baris[d.field] || null,
  })),
  dokumen_lengkap: dokumenLengkap(baris),
});

class KerjasamaDesaMonitoringController {
  /**
   * Angka kepala + dua grafik.
   *
   * Cakupan Perdes sengaja TIDAK ikut penyaring tahun/jenis/bidang: ia mengukur
   * kesiapan legalitas desa, yang tidak punya tahun dan tidak berubah karena
   * seseorang memilih "Antar Desa" di dropdown.
   */
  async statistik(req, res, next) {
    try {
      const where = await susunPenyaring(req.query);

      const [total, perJenis, perBidang, perDesa] = await Promise.all([
        prisma.kerjasama_desa.count({ where }),
        prisma.kerjasama_desa.groupBy({ by: ['jenis'], where, _count: { jenis: true } }),
        prisma.kerjasama_desa.groupBy({ by: ['bidang'], where, _count: { bidang: true } }),
        prisma.kerjasama_desa.groupBy({ by: ['desa_id'], where, _count: { desa_id: true } }),
      ]);

      const hitungJenis = new Map(perJenis.map((r) => [r.jenis, r._count.jenis]));
      const hitungBidang = new Map(perBidang.map((r) => [r.bidang, r._count.bidang]));

      /**
       * Peringkat kecamatan dihitung di JS, bukan lewat SQL mentah.
       *
       * Prisma tidak bisa groupBy kolom relasi, dan jumlah desa se-kabupaten
       * hanya ratusan — memetakan desa_id ke kecamatannya di memori jauh lebih
       * murah daripada query mentah yang harus ikut dirawat sendiri.
       */
      const desaIds = perDesa.map((r) => r.desa_id);
      const desaTerkait = desaIds.length
        ? await prisma.desas.findMany({
            where: { id: { in: desaIds } },
            select: { id: true, kecamatan_id: true, kecamatans: { select: { id: true, nama: true } } },
          })
        : [];

      const petaDesa = new Map(desaTerkait.map((d) => [String(d.id), d]));
      const perKecamatan = new Map();
      perDesa.forEach((baris) => {
        const desa = petaDesa.get(String(baris.desa_id));
        if (!desa?.kecamatans) return;
        const kunci = String(desa.kecamatans.id);
        const sebelumnya = perKecamatan.get(kunci) || {
          id: kunci,
          nama: desa.kecamatans.nama,
          jumlah: 0,
          desa: 0,
        };
        sebelumnya.jumlah += baris._count.desa_id;
        sebelumnya.desa += 1;
        perKecamatan.set(kunci, sebelumnya);
      });

      // Cakupan legalitas: hanya DESA. Kelurahan tidak menerbitkan Peraturan
      // Desa, jadi memasukkannya ke penyebut membuat cakupan mustahil 100%.
      const [totalDesa, sudahLegalitas] = await Promise.all([
        prisma.desas.count({ where: { status_pemerintahan: 'desa' } }),
        prisma.kerjasama_desa_legalitas.count({
          where: { produk_hukum_id: { not: null }, desas: { status_pemerintahan: 'desa' } },
        }),
      ]);

      res.json({
        success: true,
        data: {
          total,
          per_jenis: JENIS_KERJASAMA.map((j) => ({
            key: j.key,
            kode: j.kode,
            label: j.label,
            jumlah: hitungJenis.get(j.key) || 0,
          })),
          per_bidang: BIDANG_KERJASAMA.map((b) => ({
            key: b.key,
            nomor: b.nomor,
            label: b.label,
            jumlah: hitungBidang.get(b.key) || 0,
          })),
          top_kecamatan: [...perKecamatan.values()].sort((a, b) => b.jumlah - a.jumlah).slice(0, 10),
          cakupan_legalitas: {
            total_desa: totalDesa,
            sudah: sudahLegalitas,
            belum: Math.max(totalDesa - sudahLegalitas, 0),
            persen: totalDesa > 0 ? Math.round((sudahLegalitas / totalDesa) * 100) : null,
          },
          desa_terlibat: perDesa.length,
        },
      });
    } catch (error) {
      logger.error('Gagal memuat statistik kerja sama desa:', error);
      next(error);
    }
  }

  /** Tabel monitoring transaksi, berhalaman. */
  async daftar(req, res, next) {
    try {
      const where = await susunPenyaring(req.query);

      const halaman = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const perHalaman = Math.min(Math.max(parseInt(req.query.per_page, 10) || 25, 1), 200);

      const [total, baris] = await Promise.all([
        prisma.kerjasama_desa.count({ where }),
        prisma.kerjasama_desa.findMany({
          where,
          include: { desas: RELASI_DESA },
          orderBy: [{ tahun: 'desc' }, { id: 'desc' }],
          skip: (halaman - 1) * perHalaman,
          take: perHalaman,
        }),
      ]);

      res.json({
        success: true,
        data: baris.map(bentukBaris),
        meta: {
          total,
          page: halaman,
          per_page: perHalaman,
          total_halaman: Math.max(Math.ceil(total / perHalaman), 1),
        },
      });
    } catch (error) {
      logger.error('Gagal memuat daftar kerja sama desa:', error);
      next(error);
    }
  }

  /**
   * Desa yang belum mengunggah Perdes payung — isi tombol "Lihat Desa Belum
   * Upload" di kartu cakupan.
   *
   * Yang dihitung "sudah" adalah yang berkasnya benar-benar ada, bukan yang
   * nomornya terisi: baris legalitas tanpa produk_hukum_id berarti desa mengetik
   * nomor Perdes tapi dokumennya belum pernah masuk.
   */
  async desaBelumLegalitas(req, res, next) {
    try {
      const kecamatanId = req.query.kecamatan_id ? parseId(req.query.kecamatan_id) : null;

      const desa = await prisma.desas.findMany({
        where: {
          status_pemerintahan: 'desa',
          ...(kecamatanId ? { kecamatan_id: kecamatanId } : {}),
          OR: [
            { kerjasama_desa_legalitas: { is: null } },
            { kerjasama_desa_legalitas: { produk_hukum_id: null } },
          ],
        },
        select: {
          id: true,
          nama: true,
          kecamatans: { select: { id: true, nama: true } },
          kerjasama_desa_legalitas: { select: { nomor_perdes: true, updated_at: true } },
          _count: { select: { kerjasama_desa: true } },
        },
        orderBy: [{ kecamatan_id: 'asc' }, { nama: 'asc' }],
      });

      res.json({
        success: true,
        data: desa.map((d) => ({
          id: String(d.id),
          nama: d.nama,
          kecamatan: d.kecamatans ? { id: String(d.kecamatans.id), nama: d.kecamatans.nama } : null,
          // Desa yang sudah mengetik nomornya tapi belum mengunggah berkas
          // dibedakan dari yang belum menyentuh sama sekali — keduanya perlu
          // ditagih dengan kalimat yang berbeda.
          nomor_perdes: d.kerjasama_desa_legalitas?.nomor_perdes || null,
          jumlah_kerjasama: d._count.kerjasama_desa,
        })),
      });
    } catch (error) {
      logger.error('Gagal memuat daftar desa belum legalitas:', error);
      next(error);
    }
  }

  /** Bahan penyaring: katalog bidang/jenis, daftar kecamatan, dan tahun yang ada datanya. */
  async meta(req, res, next) {
    try {
      const [kecamatan, tahun] = await Promise.all([
        prisma.kecamatans.findMany({ select: { id: true, nama: true }, orderBy: { nama: 'asc' } }),
        prisma.kerjasama_desa.groupBy({ by: ['tahun'], orderBy: { tahun: 'desc' } }),
      ]);

      res.json({
        success: true,
        data: {
          ...katalog(),
          kecamatan: kecamatan.map((k) => ({ id: String(k.id), nama: k.nama })),
          // Tahun diturunkan dari data yang ADA, bukan deret tetap 2020–2030:
          // dropdown berisi tahun yang pasti kosong hanya melelahkan.
          tahun: tahun.map((t) => t.tahun),
        },
      });
    } catch (error) {
      logger.error('Gagal memuat meta monitoring kerja sama desa:', error);
      next(error);
    }
  }
}

module.exports = new KerjasamaDesaMonitoringController();
