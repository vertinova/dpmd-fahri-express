/**
 * Ringkasan produk hukum lintas sumber, untuk Core Dashboard.
 *
 * Tiga sumber, tiga tabel, dan sengaja TIDAK di-UNION jadi satu daftar:
 *
 *   produk_hukums          — produk hukum desa (416 desa, punya kolom desa &
 *                            kecamatan)
 *   produk_hukum_bidang    — produk hukum kabupaten milik bidang DPMD
 *   produk_hukum_referensi — rujukan peraturan luar (UU, PP, Permendagri),
 *                            metadata + tautan, tanpa berkas
 *
 * Kolom pembedanya tidak sama dan cara membacanya juga berbeda: yang satu
 * ditelusuri per kecamatan, yang lain per bidang, yang ketiga per topik.
 * Memaksa ketiganya jadi satu tabel dengan separuh kolom kosong membuat
 * daftarnya lebih sulit dibaca, bukan lebih mudah. Yang disatukan di sini
 * hanyalah ANGKA-nya — daftar per sumber diambil dari endpoint masing-masing.
 */

const prisma = require('../config/prisma');
const logger = require('../utils/logger');

const hitungPerNama = (rows, kunci) =>
	rows.map((r) => ({ name: String(r[kunci]), value: r._count.id }));

/** GET /api/produk-hukum-gabungan/stats */
const stats = async (req, res) => {
	try {
		const [
			desaTotal, desaPerJenis, desaPerStatus, desaPerTahun, desaAdaBerkas,
			bidangTotal, bidangPerJenis, bidangPerStatus, bidangPerBidang, bidangAdaBerkas,
			referensiTotal, referensiPerTingkat, referensiPerTopik,
			jumlahDesa, desaPunyaProduk,
		] = await Promise.all([
			prisma.produk_hukums.count(),
			prisma.produk_hukums.groupBy({ by: ['singkatan_jenis'], _count: { id: true } }),
			prisma.produk_hukums.groupBy({ by: ['status_peraturan'], _count: { id: true } }),
			prisma.produk_hukums.groupBy({
				by: ['tahun'], _count: { id: true }, orderBy: { tahun: 'desc' }, take: 10,
			}),
			prisma.produk_hukums.count({ where: { NOT: { file: '' } } }),

			prisma.produk_hukum_bidang.count(),
			prisma.produk_hukum_bidang.groupBy({ by: ['singkatan_jenis'], _count: { id: true } }),
			prisma.produk_hukum_bidang.groupBy({ by: ['status_peraturan'], _count: { id: true } }),
			prisma.produk_hukum_bidang.groupBy({ by: ['bidang_id'], _count: { id: true } }),
			prisma.produk_hukum_bidang.count({ where: { NOT: { file: null } } }),

			prisma.produk_hukum_referensi.count({ where: { aktif: true } }),
			prisma.produk_hukum_referensi.groupBy({
				by: ['tingkat'], where: { aktif: true }, _count: { id: true },
			}),
			prisma.produk_hukum_referensi.groupBy({
				by: ['topik'], where: { aktif: true }, _count: { id: true },
			}),

			prisma.desas.count(),
			// Berapa desa yang sudah mengunggah setidaknya satu produk hukum —
			// angka yang lebih berarti bagi dinas daripada jumlah dokumennya,
			// karena yang dikejar adalah desa yang belum melapor sama sekali.
			prisma.produk_hukums.findMany({ distinct: ['desa_id'], select: { desa_id: true } }),
		]);

		const bidangs = await prisma.bidangs.findMany({ select: { id: true, nama: true } });
		const namaBidang = new Map(bidangs.map((b) => [b.id.toString(), b.nama]));

		return res.json({
			success: true,
			data: {
				total: desaTotal + bidangTotal,
				desa: {
					total: desaTotal,
					adaBerkas: desaAdaBerkas,
					perJenis: hitungPerNama(desaPerJenis, 'singkatan_jenis'),
					perStatus: hitungPerNama(desaPerStatus, 'status_peraturan'),
					perTahun: hitungPerNama(desaPerTahun, 'tahun')
						.sort((a, b) => a.name.localeCompare(b.name)),
					jumlahDesa,
					desaSudahUnggah: desaPunyaProduk.length,
					desaBelumUnggah: jumlahDesa - desaPunyaProduk.length,
				},
				bidang: {
					total: bidangTotal,
					adaBerkas: bidangAdaBerkas,
					tanpaBerkas: bidangTotal - bidangAdaBerkas,
					perJenis: hitungPerNama(bidangPerJenis, 'singkatan_jenis'),
					perStatus: hitungPerNama(bidangPerStatus, 'status_peraturan'),
					perBidang: bidangPerBidang.map((r) => ({
						bidang_id: r.bidang_id.toString(),
						name: namaBidang.get(r.bidang_id.toString()) || 'Tidak diketahui',
						value: r._count.id,
					})),
					jumlahBidang: bidangs.length,
					bidangSudahUnggah: bidangPerBidang.length,
				},
				referensi: {
					total: referensiTotal,
					perTingkat: hitungPerNama(referensiPerTingkat, 'tingkat'),
					perTopik: referensiPerTopik
						.filter((r) => r.topik)
						.map((r) => ({ name: r.topik, value: r._count.id })),
				},
			},
		});
	} catch (error) {
		logger.error('produkHukumGabungan.stats', error);
		return res.status(500).json({
			success: false,
			message: 'Gagal mengambil ringkasan produk hukum',
			error: error.message,
		});
	}
};

/**
 * GET /api/produk-hukum-gabungan/referensi
 * Daftar rujukan peraturan luar. Tanpa pagination: isinya puluhan, bukan
 * ribuan, dan dibaca sebagai satu daftar bertopik.
 */
const referensi = async (req, res) => {
	try {
		const { tingkat, topik, search } = req.query;

		const where = { aktif: true };
		if (tingkat) where.tingkat = tingkat;
		if (topik) where.topik = topik;
		if (search) {
			where.OR = [
				{ judul: { contains: search } },
				{ tentang: { contains: search } },
				{ nomor: { contains: search } },
			];
		}

		const data = await prisma.produk_hukum_referensi.findMany({
			where,
			orderBy: [{ urutan: 'asc' }, { tahun: 'desc' }],
		});

		return res.json({
			success: true,
			data: data.map((r) => ({ ...r, id: r.id.toString() })),
		});
	} catch (error) {
		logger.error('produkHukumGabungan.referensi', error);
		return res.status(500).json({
			success: false,
			message: 'Gagal mengambil referensi peraturan',
			error: error.message,
		});
	}
};

module.exports = { stats, referensi };
