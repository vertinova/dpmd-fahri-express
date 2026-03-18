const prisma = require('../config/prisma');

/**
 * Get all aparatur desa across all desas (for bidang/pemdes users)
 * Supports search, filtering by kecamatan/desa/jabatan/gender/status, and pagination
 */
const getAllAparaturDesa = async (req, res) => {
	try {
		const {
			search,
			kecamatan_id,
			desa_id,
			jabatan,
			jenis_kelamin,
			status,
			page = 1,
			limit = 20
		} = req.query;

		const pageNum = Math.max(1, parseInt(page) || 1);
		const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
		const skip = (pageNum - 1) * limitNum;

		const where = {};

		if (search) {
			where.OR = [
				{ nama_lengkap: { contains: search } },
				{ jabatan: { contains: search } },
			];
		}

		if (desa_id) {
			where.desa_id = parseInt(desa_id);
		} else if (kecamatan_id) {
			where.desas = {
				kecamatan_id: parseInt(kecamatan_id),
			};
		}

		if (jabatan) {
			where.jabatan = { contains: jabatan };
		}

		if (jenis_kelamin) {
			where.jenis_kelamin = jenis_kelamin;
		}

		if (status) {
			where.status = status;
		}

		const [data, totalItems] = await Promise.all([
			prisma.aparatur_desa.findMany({
				where,
				include: {
					desas: {
						select: {
							id: true,
							nama: true,
							kecamatans: {
								select: {
									id: true,
									nama: true,
								},
							},
						},
					},
				},
				orderBy: [
					{ desas: { kecamatans: { nama: 'asc' } } },
					{ desas: { nama: 'asc' } },
					{ nama_lengkap: 'asc' },
				],
				skip,
				take: limitNum,
			}),
			prisma.aparatur_desa.count({ where }),
		]);

		const totalPages = Math.ceil(totalItems / limitNum);

		res.json({
			success: true,
			message: 'Daftar Aparatur Desa',
			data,
			meta: {
				page: pageNum,
				limit: limitNum,
				totalItems,
				totalPages,
			},
		});
	} catch (error) {
		console.error('Error fetching aparatur desa (pemdes):', error);
		res.status(500).json({
			success: false,
			message: 'Gagal mengambil data aparatur desa',
			error: error.message,
		});
	}
};

/**
 * Get single aparatur desa by ID (no desa_id scoping - for bidang users)
 */
const getAparaturDesaById = async (req, res) => {
	try {
		const { id } = req.params;

		const aparatur = await prisma.aparatur_desa.findUnique({
			where: { id },
			include: {
				desas: {
					select: {
						id: true,
						nama: true,
						kecamatans: {
							select: {
								id: true,
								nama: true,
							},
						},
					},
				},
				produk_hukums: {
					select: {
						id: true,
						uuid: true,
						judul: true,
						nomor: true,
						tahun: true,
					},
				},
			},
		});

		if (!aparatur) {
			return res.status(404).json({
				success: false,
				message: 'Data aparatur desa tidak ditemukan',
			});
		}

		res.json({
			success: true,
			data: aparatur,
		});
	} catch (error) {
		console.error('Error fetching aparatur desa detail:', error);
		res.status(500).json({
			success: false,
			message: 'Gagal mengambil data aparatur desa',
			error: error.message,
		});
	}
};

/**
 * Get statistics for aparatur desa (for dashboard)
 */
const getStats = async (req, res) => {
	try {
		const [
			totalAparatur,
			totalAktif,
			totalLakiLaki,
			totalPerempuan,
			totalDesaDenganAparatur,
			allAparatur,
			pendidikanGroups,
			jabatanGroups,
		] = await Promise.all([
			prisma.aparatur_desa.count(),
			prisma.aparatur_desa.count({ where: { status: 'Aktif' } }),
			prisma.aparatur_desa.count({ where: { jenis_kelamin: 'Laki_laki' } }),
			prisma.aparatur_desa.count({ where: { jenis_kelamin: 'Perempuan' } }),
			prisma.aparatur_desa.groupBy({
				by: ['desa_id'],
				_count: true,
			}).then(groups => groups.length),
			prisma.aparatur_desa.findMany({
				select: { tanggal_lahir: true },
			}),
			prisma.aparatur_desa.groupBy({
				by: ['pendidikan_terakhir'],
				_count: { _all: true },
				orderBy: { _count: { pendidikan_terakhir: 'desc' } },
			}),
			prisma.aparatur_desa.groupBy({
				by: ['jabatan'],
				_count: { _all: true },
				orderBy: { _count: { jabatan: 'desc' } },
			}),
		]);

		// Age range calculation
		const now = new Date();
		const ageRanges = { '< 25': 0, '25-34': 0, '35-44': 0, '45-54': 0, '55+': 0 };
		for (const row of allAparatur) {
			if (!row.tanggal_lahir) continue;
			const age = Math.floor((now - new Date(row.tanggal_lahir)) / (365.25 * 24 * 60 * 60 * 1000));
			if (age < 25) ageRanges['< 25']++;
			else if (age < 35) ageRanges['25-34']++;
			else if (age < 45) ageRanges['35-44']++;
			else if (age < 55) ageRanges['45-54']++;
			else ageRanges['55+']++;
		}
		const rentang_usia = Object.entries(ageRanges).map(([name, value]) => ({ name, value }));

		// Education distribution
		const pendidikan = pendidikanGroups.map(g => ({
			name: g.pendidikan_terakhir || 'Tidak Diketahui',
			value: g._count._all,
		}));

		// Jabatan categorization: Pemdes vs BPD
		let totalPemdes = 0;
		let totalBPD = 0;
		for (const g of jabatanGroups) {
			const jab = (g.jabatan || '').toLowerCase();
			if (jab.includes('bpd') || jab.includes('badan permusyawaratan')) {
				totalBPD += g._count._all;
			} else {
				totalPemdes += g._count._all;
			}
		}

		res.json({
			success: true,
			data: {
				total: totalAparatur,
				aktif: totalAktif,
				tidak_aktif: totalAparatur - totalAktif,
				laki_laki: totalLakiLaki,
				perempuan: totalPerempuan,
				desa_count: totalDesaDenganAparatur,
				total_pemdes: totalPemdes,
				total_bpd: totalBPD,
				rentang_usia,
				pendidikan,
			},
		});
	} catch (error) {
		console.error('Error fetching aparatur stats:', error);
		res.status(500).json({
			success: false,
			message: 'Gagal mengambil statistik aparatur desa',
			error: error.message,
		});
	}
};

module.exports = {
	getAllAparaturDesa,
	getAparaturDesaById,
	getStats,
};
