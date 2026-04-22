const prisma = require('../config/prisma');

/**
 * Get all produk hukum across all desas (for bidang/pemdes users)
 * Supports search, filtering, and pagination
 */
const getAllProdukHukum = async (req, res) => {
	try {
		const {
			search,
			kecamatan_id,
			desa_id,
			jenis,
			singkatan_jenis,
			tahun,
			status_peraturan,
			page = 1,
			limit = 20,
		} = req.query;

		const pageNum = Math.max(1, parseInt(page) || 1);
		const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
		const skip = (pageNum - 1) * limitNum;

		const where = {};

		if (search) {
			where.OR = [
				{ judul: { contains: search } },
				{ nomor: { contains: search } },
				{ subjek: { contains: search } },
			];
		}

		if (desa_id) {
			where.desa_id = BigInt(desa_id);
		} else if (kecamatan_id) {
			where.desas = {
				kecamatan_id: BigInt(kecamatan_id),
			};
		}

		if (jenis) {
			where.jenis = jenis;
		}

		if (singkatan_jenis) {
			where.singkatan_jenis = singkatan_jenis;
		}

		if (tahun) {
			where.tahun = parseInt(tahun);
		}

		if (status_peraturan) {
			where.status_peraturan = status_peraturan;
		}

		const [data, totalItems] = await Promise.all([
			prisma.produk_hukums.findMany({
				where,
				include: {
					desas: {
						select: {
							id: true,
							nama: true,
							kode: true,
							kecamatans: {
								select: {
									id: true,
									nama: true,
								},
							},
						},
					},
				},
				orderBy: { created_at: 'desc' },
				skip,
				take: limitNum,
			}),
			prisma.produk_hukums.count({ where }),
		]);

		const totalPages = Math.ceil(totalItems / limitNum);

		const serializedData = data.map((item) => ({
			...item,
			id: item.id,
			desa_id: item.desa_id?.toString(),
			tahun: item.tahun,
			jenis_label: item.jenis?.replace(/_/g, ' '),
			desa: item.desas
				? {
						id: item.desas.id?.toString(),
						nama: item.desas.nama,
						kode: item.desas.kode,
						kecamatan: item.desas.kecamatans
							? {
									id: item.desas.kecamatans.id?.toString(),
									nama: item.desas.kecamatans.nama,
								}
							: null,
					}
				: null,
			desas: undefined,
		}));

		return res.json({
			success: true,
			data: serializedData,
			pagination: {
				currentPage: pageNum,
				totalPages,
				totalItems,
				perPage: limitNum,
			},
		});
	} catch (error) {
		console.error('Error in getAllProdukHukum:', error);
		return res.status(500).json({
			success: false,
			message: 'Gagal mengambil data produk hukum',
			error: error.message,
		});
	}
};

/**
 * Get produk hukum statistics for charts
 */
const getStats = async (req, res) => {
	try {
		const { kecamatan_id, desa_id } = req.query;

		const where = {};
		if (desa_id) {
			where.desa_id = BigInt(desa_id);
		} else if (kecamatan_id) {
			where.desas = { kecamatan_id: BigInt(kecamatan_id) };
		}

		const [total, byJenis, byStatus, byTahun] = await Promise.all([
			prisma.produk_hukums.count({ where }),
			prisma.produk_hukums.groupBy({
				by: ['singkatan_jenis'],
				where,
				_count: { id: true },
			}),
			prisma.produk_hukums.groupBy({
				by: ['status_peraturan'],
				where,
				_count: { id: true },
			}),
			prisma.produk_hukums.groupBy({
				by: ['tahun'],
				where,
				_count: { id: true },
				orderBy: { tahun: 'desc' },
				take: 10,
			}),
		]);

		const jenisData = byJenis.map((item) => ({
			name: item.singkatan_jenis,
			value: item._count.id,
		}));

		const statusData = byStatus.map((item) => ({
			name: item.status_peraturan === 'berlaku' ? 'Berlaku' : 'Dicabut',
			value: item._count.id,
		}));

		const tahunData = byTahun
			.map((item) => ({
				name: String(item.tahun),
				value: item._count.id,
			}))
			.sort((a, b) => a.name.localeCompare(b.name));

		const berlaku = statusData.find((s) => s.name === 'Berlaku')?.value || 0;
		const dicabut = statusData.find((s) => s.name === 'Dicabut')?.value || 0;

		return res.json({
			success: true,
			data: {
				total,
				berlaku,
				dicabut,
				jenis: jenisData,
				status: statusData,
				tahun: tahunData,
			},
		});
	} catch (error) {
		console.error('Error in getStats:', error);
		return res.status(500).json({
			success: false,
			message: 'Gagal mengambil statistik produk hukum',
			error: error.message,
		});
	}
};

/**
 * Get single produk hukum by id
 */
const getById = async (req, res) => {
	try {
		const { id } = req.params;

		const produkHukum = await prisma.produk_hukums.findUnique({
			where: { id },
			include: {
				desas: {
					select: {
						id: true,
						nama: true,
						kode: true,
						kecamatans: {
							select: {
								id: true,
								nama: true,
							},
						},
					},
				},
			},
		});

		if (!produkHukum) {
			return res.status(404).json({
				success: false,
				message: 'Produk hukum tidak ditemukan',
			});
		}

		const serialized = {
			...produkHukum,
			desa_id: produkHukum.desa_id?.toString(),
			jenis_label: produkHukum.jenis?.replace(/_/g, ' '),
			desa: produkHukum.desas
				? {
						id: produkHukum.desas.id?.toString(),
						nama: produkHukum.desas.nama,
						kode: produkHukum.desas.kode,
						kecamatan: produkHukum.desas.kecamatans
							? {
									id: produkHukum.desas.kecamatans.id?.toString(),
									nama: produkHukum.desas.kecamatans.nama,
								}
							: null,
					}
				: null,
			desas: undefined,
		};

		return res.json({
			success: true,
			data: serialized,
		});
	} catch (error) {
		console.error('Error in getById:', error);
		return res.status(500).json({
			success: false,
			message: 'Gagal mengambil detail produk hukum',
			error: error.message,
		});
	}
};

const getRelated = async (req, res) => {
	try {
		const { id } = req.params;

		const ph = await prisma.produk_hukums.findUnique({
			where: { id },
			select: {
				rws: {
					select: {
						id: true,
						nomor: true,
						status_kelembagaan: true,
						desas: { select: { nama: true } },
					},
				},
				rts: {
					select: {
						id: true,
						nomor: true,
						status_kelembagaan: true,
						rws: { select: { nomor: true } },
						desas: { select: { nama: true } },
					},
				},
				posyandus: {
					select: {
						id: true,
						nama: true,
						status_kelembagaan: true,
						desas: { select: { nama: true } },
					},
				},
				karang_tarunas: {
					select: {
						id: true,
						nama: true,
						status_kelembagaan: true,
						desas: { select: { nama: true } },
					},
				},
				lpms: {
					select: {
						id: true,
						nama: true,
						status_kelembagaan: true,
						desas: { select: { nama: true } },
					},
				},
				pkks: {
					select: {
						id: true,
						nama: true,
						status_kelembagaan: true,
						desas: { select: { nama: true } },
					},
				},
				satlinmas: {
					select: {
						id: true,
						status_kelembagaan: true,
						desas: { select: { nama: true } },
					},
				},
				lembaga_lainnyas: {
					select: {
						id: true,
						nama: true,
						status_kelembagaan: true,
						desas: { select: { nama: true } },
					},
				},
				aparatur_desa: {
					select: {
						id: true,
						nama_lengkap: true,
						jabatan: true,
						desas: { select: { nama: true } },
					},
				},
			},
		});

		if (!ph) {
			return res.status(404).json({ success: false, message: 'Produk hukum tidak ditemukan' });
		}

		const pengurusList = await prisma.pengurus.findMany({
			where: { produk_hukum_id: id },
			select: {
				id: true,
				nama_lengkap: true,
				jabatan: true,
				pengurusable_type: true,
				pengurusable_id: true,
				status_jabatan: true,
				desas: { select: { nama: true } },
			},
		});

		return res.json({
			success: true,
			data: {
				kelembagaan: {
					rws: ph.rws || [],
					rts: ph.rts || [],
					posyandus: ph.posyandus || [],
					karang_tarunas: ph.karang_tarunas || [],
					lpms: ph.lpms || [],
					pkks: ph.pkks || [],
					satlinmas: ph.satlinmas || [],
					lembaga_lainnyas: ph.lembaga_lainnyas || [],
				},
				aparatur_desa: ph.aparatur_desa || [],
				pengurus: pengurusList,
			},
		});
	} catch (error) {
		console.error('Error in getRelated:', error);
		return res.status(500).json({
			success: false,
			message: 'Gagal mengambil data terkait',
			error: error.message,
		});
	}
};

module.exports = { getAllProdukHukum, getStats, getById, getRelated };
