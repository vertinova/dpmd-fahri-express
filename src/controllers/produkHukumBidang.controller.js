/**
 * Produk hukum tingkat kabupaten, dipegang per bidang DPMD.
 *
 * KEPEMILIKAN. Satu baris selalu milik satu bidang. Membaca boleh lintas
 * bidang — Core Dashboard memang menyatukan semuanya — tetapi menulis hanya
 * boleh oleh pegawai bidang itu sendiri, atau superadmin. Pemeriksaannya di
 * sini, bukan di UI: menyembunyikan tombol bukan penguncian.
 *
 * BERKAS. PDF disimpan di `storage/produk_hukum_bidang/` dan disajikan
 * express.static tanpa autentikasi, sama seperti produk hukum desa. Itu memang
 * disengaja: produk hukum adalah dokumen publik. Jangan menaruh dokumen yang
 * butuh kontrol akses di sini.
 */

const fs = require('fs');
const path = require('path');
const prisma = require('../config/prisma');
const logger = require('../utils/logger');

const FOLDER_BERKAS = path.join(__dirname, '../../storage/produk_hukum_bidang');

/**
 * Jenis produk hukum tingkat kabupaten yang sah, beserta singkatannya.
 * Disimpan di sini, bukan sebagai ENUM database, supaya menambah jenis baru
 * tidak menuntut ALTER TABLE yang mengunci tabel.
 */
const JENIS = [
	{ jenis: 'Peraturan Daerah', singkatan: 'PERDA' },
	{ jenis: 'Peraturan Bupati', singkatan: 'PERBUP' },
	{ jenis: 'Keputusan Bupati', singkatan: 'SK BUPATI' },
	{ jenis: 'Instruksi Bupati', singkatan: 'INBUP' },
	{ jenis: 'Keputusan Kepala Dinas', singkatan: 'SK KADIS' },
	{ jenis: 'Surat Edaran', singkatan: 'SE' },
	{ jenis: 'Nota Kesepahaman', singkatan: 'MOU' },
];

const STATUS = ['berlaku', 'diubah', 'dicabut'];

const cariJenis = (nilai) =>
	JENIS.find((j) => j.jenis === nilai || j.singkatan === nilai);

/* ------------------------------------------------------------------ bantu -- */

const serialize = (row) => ({
	...row,
	id: row.id?.toString(),
	bidang_id: row.bidang_id?.toString(),
	created_by: row.created_by?.toString() || null,
	updated_by: row.updated_by?.toString() || null,
	bidang: row.bidangs ? { id: row.bidangs.id?.toString(), nama: row.bidangs.nama } : null,
	// Jalur relatif; frontend yang merangkainya dengan origin penyimpanan.
	file_url: row.file ? `/storage/produk_hukum_bidang/${row.file}` : null,
	bidangs: undefined,
});

/** Bidang yang boleh ditulisi user ini. `null` berarti semua (superadmin). */
const bidangYangBolehDitulis = (user) => {
	if (user?.role === 'superadmin') return null;
	return user?.bidang_id ? Number(user.bidang_id) : undefined;
};

const bolehTulis = (user, bidangId) => {
	const milik = bidangYangBolehDitulis(user);
	if (milik === null) return true;
	if (milik === undefined) return false;
	return milik === Number(bidangId);
};

/** Buang berkas yang terlanjur terunggah saat validasi gagal. */
const buangBerkas = (file) => {
	if (!file?.filename) return;
	fs.unlink(path.join(FOLDER_BERKAS, file.filename), () => {});
};

const tahunValid = (nilai) => {
	const t = parseInt(nilai, 10);
	return Number.isInteger(t) && t >= 1945 && t <= new Date().getFullYear() + 1 ? t : null;
};

/* ------------------------------------------------------------------ daftar -- */

/**
 * GET /api/produk-hukum-bidang
 * Tanpa `bidang_id` daftarnya lintas bidang — dipakai Core Dashboard.
 */
const index = async (req, res) => {
	try {
		const {
			bidang_id, search, singkatan_jenis, tahun, status_peraturan,
			page = 1, limit = 20,
		} = req.query;

		const pageNum = Math.max(1, parseInt(page, 10) || 1);
		const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

		const where = {};
		if (bidang_id) where.bidang_id = BigInt(bidang_id);
		if (singkatan_jenis) where.singkatan_jenis = singkatan_jenis;
		if (tahun) where.tahun = parseInt(tahun, 10);
		if (status_peraturan) where.status_peraturan = status_peraturan;
		if (search) {
			where.OR = [
				{ judul: { contains: search } },
				{ nomor: { contains: search } },
				{ tentang: { contains: search } },
			];
		}

		const [data, totalItems] = await Promise.all([
			prisma.produk_hukum_bidang.findMany({
				where,
				include: { bidangs: { select: { id: true, nama: true } } },
				orderBy: [{ tahun: 'desc' }, { created_at: 'desc' }],
				skip: (pageNum - 1) * limitNum,
				take: limitNum,
			}),
			prisma.produk_hukum_bidang.count({ where }),
		]);

		return res.json({
			success: true,
			data: data.map(serialize),
			pagination: {
				currentPage: pageNum,
				totalPages: Math.ceil(totalItems / limitNum),
				totalItems,
				perPage: limitNum,
			},
		});
	} catch (error) {
		logger.error('produkHukumBidang.index', error);
		return res.status(500).json({
			success: false,
			message: 'Gagal mengambil produk hukum bidang',
			error: error.message,
		});
	}
};

/** GET /api/produk-hukum-bidang/opsi — daftar jenis yang sah, untuk formulir. */
const opsi = (req, res) =>
	res.json({ success: true, data: { jenis: JENIS, status: STATUS } });

/** GET /api/produk-hukum-bidang/stats */
const stats = async (req, res) => {
	try {
		const where = req.query.bidang_id ? { bidang_id: BigInt(req.query.bidang_id) } : {};

		const [total, adaBerkas, perJenis, perStatus, perTahun, perBidang] = await Promise.all([
			prisma.produk_hukum_bidang.count({ where }),
			prisma.produk_hukum_bidang.count({ where: { ...where, NOT: { file: null } } }),
			prisma.produk_hukum_bidang.groupBy({ by: ['singkatan_jenis'], where, _count: { id: true } }),
			prisma.produk_hukum_bidang.groupBy({ by: ['status_peraturan'], where, _count: { id: true } }),
			prisma.produk_hukum_bidang.groupBy({
				by: ['tahun'], where, _count: { id: true }, orderBy: { tahun: 'desc' }, take: 10,
			}),
			prisma.produk_hukum_bidang.groupBy({ by: ['bidang_id'], where, _count: { id: true } }),
		]);

		const bidangs = await prisma.bidangs.findMany({ select: { id: true, nama: true } });
		const namaBidang = new Map(bidangs.map((b) => [b.id.toString(), b.nama]));

		return res.json({
			success: true,
			data: {
				total,
				adaBerkas,
				tanpaBerkas: total - adaBerkas,
				perJenis: perJenis.map((r) => ({ name: r.singkatan_jenis, value: r._count.id })),
				perStatus: perStatus.map((r) => ({ name: r.status_peraturan, value: r._count.id })),
				perTahun: perTahun
					.map((r) => ({ name: String(r.tahun), value: r._count.id }))
					.sort((a, b) => a.name.localeCompare(b.name)),
				perBidang: perBidang.map((r) => ({
					bidang_id: r.bidang_id.toString(),
					name: namaBidang.get(r.bidang_id.toString()) || 'Tidak diketahui',
					value: r._count.id,
				})),
			},
		});
	} catch (error) {
		logger.error('produkHukumBidang.stats', error);
		return res.status(500).json({
			success: false,
			message: 'Gagal mengambil statistik produk hukum bidang',
			error: error.message,
		});
	}
};

/** GET /api/produk-hukum-bidang/:id */
const show = async (req, res) => {
	try {
		const row = await prisma.produk_hukum_bidang.findUnique({
			where: { id: BigInt(req.params.id) },
			include: { bidangs: { select: { id: true, nama: true } } },
		});
		if (!row) {
			return res.status(404).json({ success: false, message: 'Produk hukum tidak ditemukan' });
		}
		return res.json({ success: true, data: serialize(row) });
	} catch (error) {
		logger.error('produkHukumBidang.show', error);
		return res.status(500).json({ success: false, message: 'Gagal mengambil produk hukum', error: error.message });
	}
};

/* ------------------------------------------------------------------ tulis -- */

/**
 * Kumpulkan dan validasi isian dari body. Mengembalikan `{ data }` atau
 * `{ pesan }` — bukan melempar, supaya pemanggilnya bisa membuang berkas yang
 * terlanjur terunggah sebelum membalas.
 */
const susunData = (body, { wajibLengkap }) => {
	const jenisTerpilih = cariJenis(body.jenis);
	if (wajibLengkap && !jenisTerpilih) return { pesan: 'Jenis produk hukum tidak dikenal' };

	const tahun = body.tahun !== undefined ? tahunValid(body.tahun) : undefined;
	if ((wajibLengkap || body.tahun !== undefined) && !tahun) {
		return { pesan: 'Tahun wajib diisi dan harus di antara 1945 sampai tahun depan' };
	}

	if (body.status_peraturan && !STATUS.includes(body.status_peraturan)) {
		return { pesan: 'Status peraturan tidak dikenal' };
	}

	const judul = body.judul?.trim();
	const nomor = body.nomor?.trim();
	if (wajibLengkap && !judul) return { pesan: 'Judul wajib diisi' };
	if (wajibLengkap && !nomor) return { pesan: 'Nomor wajib diisi' };

	const data = {};
	if (jenisTerpilih) {
		data.jenis = jenisTerpilih.jenis;
		data.singkatan_jenis = jenisTerpilih.singkatan;
	}
	if (judul !== undefined) data.judul = judul;
	if (nomor !== undefined) data.nomor = nomor;
	if (tahun !== undefined) data.tahun = tahun;
	if (body.tentang !== undefined) data.tentang = body.tentang?.trim() || null;
	if (body.tempat_penetapan !== undefined) data.tempat_penetapan = body.tempat_penetapan?.trim() || null;
	if (body.tanggal_penetapan !== undefined) {
		data.tanggal_penetapan = body.tanggal_penetapan ? new Date(body.tanggal_penetapan) : null;
	}
	if (body.sumber !== undefined) data.sumber = body.sumber?.trim() || null;
	if (body.status_peraturan !== undefined) data.status_peraturan = body.status_peraturan;
	if (body.keterangan_status !== undefined) data.keterangan_status = body.keterangan_status?.trim() || null;
	if (body.bidang_hukum !== undefined && body.bidang_hukum?.trim()) data.bidang_hukum = body.bidang_hukum.trim();
	if (body.url_sumber !== undefined) data.url_sumber = body.url_sumber?.trim() || null;

	return { data };
};

/** POST /api/produk-hukum-bidang */
const store = async (req, res) => {
	try {
		// Bidang tujuan: superadmin boleh menyebut bidang mana pun, pegawai
		// selalu menulis ke bidangnya sendiri walau body-nya mengaku lain.
		const bidangId = req.user?.role === 'superadmin' && req.body.bidang_id
			? Number(req.body.bidang_id)
			: Number(req.user?.bidang_id);

		if (!bidangId) {
			buangBerkas(req.file);
			return res.status(400).json({
				success: false,
				message: 'Akun Anda belum terhubung ke bidang mana pun',
			});
		}
		if (!bolehTulis(req.user, bidangId)) {
			buangBerkas(req.file);
			return res.status(403).json({
				success: false,
				message: 'Anda hanya boleh menambah produk hukum di bidang Anda sendiri',
			});
		}

		const { data, pesan } = susunData(req.body, { wajibLengkap: true });
		if (pesan) {
			buangBerkas(req.file);
			return res.status(400).json({ success: false, message: pesan });
		}

		const row = await prisma.produk_hukum_bidang.create({
			data: {
				...data,
				bidang_id: BigInt(bidangId),
				file: req.file?.filename || null,
				created_by: req.user?.id ? BigInt(req.user.id) : null,
				updated_by: req.user?.id ? BigInt(req.user.id) : null,
			},
			include: { bidangs: { select: { id: true, nama: true } } },
		});

		return res.status(201).json({ success: true, data: serialize(row) });
	} catch (error) {
		buangBerkas(req.file);
		if (error.code === 'P2002') {
			return res.status(409).json({
				success: false,
				message: 'Produk hukum dengan jenis, nomor, dan tahun yang sama sudah ada di bidang ini',
			});
		}
		logger.error('produkHukumBidang.store', error);
		return res.status(500).json({ success: false, message: 'Gagal menyimpan produk hukum', error: error.message });
	}
};

/** PUT /api/produk-hukum-bidang/:id */
const update = async (req, res) => {
	try {
		const lama = await prisma.produk_hukum_bidang.findUnique({ where: { id: BigInt(req.params.id) } });
		if (!lama) {
			buangBerkas(req.file);
			return res.status(404).json({ success: false, message: 'Produk hukum tidak ditemukan' });
		}
		if (!bolehTulis(req.user, lama.bidang_id)) {
			buangBerkas(req.file);
			return res.status(403).json({
				success: false,
				message: 'Anda hanya boleh mengubah produk hukum di bidang Anda sendiri',
			});
		}

		const { data, pesan } = susunData(req.body, { wajibLengkap: false });
		if (pesan) {
			buangBerkas(req.file);
			return res.status(400).json({ success: false, message: pesan });
		}

		if (req.file) data.file = req.file.filename;
		data.updated_by = req.user?.id ? BigInt(req.user.id) : null;

		const row = await prisma.produk_hukum_bidang.update({
			where: { id: lama.id },
			data,
			include: { bidangs: { select: { id: true, nama: true } } },
		});

		// Berkas lama baru dibuang SETELAH penyimpanan berhasil: kalau update
		// gagal, dokumen yang sudah ada tidak ikut hilang.
		if (req.file && lama.file && lama.file !== req.file.filename) {
			fs.unlink(path.join(FOLDER_BERKAS, lama.file), () => {});
		}

		return res.json({ success: true, data: serialize(row) });
	} catch (error) {
		buangBerkas(req.file);
		if (error.code === 'P2002') {
			return res.status(409).json({
				success: false,
				message: 'Produk hukum dengan jenis, nomor, dan tahun yang sama sudah ada di bidang ini',
			});
		}
		logger.error('produkHukumBidang.update', error);
		return res.status(500).json({ success: false, message: 'Gagal mengubah produk hukum', error: error.message });
	}
};

/** DELETE /api/produk-hukum-bidang/:id */
const destroy = async (req, res) => {
	try {
		const row = await prisma.produk_hukum_bidang.findUnique({ where: { id: BigInt(req.params.id) } });
		if (!row) {
			return res.status(404).json({ success: false, message: 'Produk hukum tidak ditemukan' });
		}
		if (!bolehTulis(req.user, row.bidang_id)) {
			return res.status(403).json({
				success: false,
				message: 'Anda hanya boleh menghapus produk hukum di bidang Anda sendiri',
			});
		}

		await prisma.produk_hukum_bidang.delete({ where: { id: row.id } });
		if (row.file) fs.unlink(path.join(FOLDER_BERKAS, row.file), () => {});

		return res.json({ success: true, message: 'Produk hukum dihapus' });
	} catch (error) {
		logger.error('produkHukumBidang.destroy', error);
		return res.status(500).json({ success: false, message: 'Gagal menghapus produk hukum', error: error.message });
	}
};

module.exports = { index, opsi, stats, show, store, update, destroy, JENIS, STATUS };
