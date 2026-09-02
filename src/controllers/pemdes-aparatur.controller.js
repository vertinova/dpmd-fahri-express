const prisma = require('../config/prisma');

// Tabel aparatur_desa tidak punya kolom pembeda perangkat desa vs BPD —
// satu-satunya penanda ada di teks jabatan. Aturannya ditulis sekali di sini
// supaya daftar dan statistik tidak pernah memakai definisi yang berbeda.
const KATA_BPD = ['bpd', 'badan permusyawaratan'];

/** `jenis`: 'bpd' | 'perangkat'. Nilai lain (atau kosong) = tanpa penyaringan. */
const filterJenis = (jenis) => {
	if (jenis === 'bpd') return { OR: KATA_BPD.map((kata) => ({ jabatan: { contains: kata } })) };
	if (jenis === 'perangkat') return { AND: KATA_BPD.map((kata) => ({ jabatan: { not: { contains: kata } } })) };
	return null;
};

/**
 * Penyaring daftar aparatur — dipakai mode tabel maupun mode per wilayah,
 * supaya dua mode tidak pernah menampilkan populasi yang berbeda.
 */
const bangunWhere = ({ search, kecamatan_id, desa_id, jabatan, jenis, jenis_kelamin, status, pendidikan }) => {
	const where = {};

	// Dibungkus AND supaya tidak bertabrakan dengan `where.OR` milik pencarian.
	const whereJenis = filterJenis(jenis);
	if (whereJenis) where.AND = [whereJenis];

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

	// Kolomnya VarChar bebas dan isinya berasal dari dua sumber data dengan
	// penulisan berbeda ("S1" vs "STRATA I / DIPLOMA IV"). UI mengelompokkan
	// ejaan-ejaan itu jadi satu pilihan lalu mengirimkannya dipisah koma,
	// jadi di sini diterima sebagai daftar.
	if (pendidikan) {
		const nilai = String(pendidikan)
			.split(',')
			.map((v) => v.trim())
			.filter(Boolean);
		if (nilai.length === 1) {
			where.pendidikan_terakhir = nilai[0];
		} else if (nilai.length > 1) {
			where.pendidikan_terakhir = { in: nilai };
		}
	}

	return where;
};

/**
 * Get all aparatur desa across all desas (for bidang/pemdes users)
 * Supports search, filtering by kecamatan/desa/jabatan/gender/status, and pagination
 */
const getAllAparaturDesa = async (req, res) => {
	try {
		const { page = 1, limit = 20 } = req.query;

		const pageNum = Math.max(1, parseInt(page) || 1);
		const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
		const skip = (pageNum - 1) * limitNum;

		const where = bangunWhere(req.query);

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

// Urutan jabatan di dalam satu desa. Dicocokkan dari atas ke bawah, jadi yang
// lebih khusus harus lebih dulu ("wakil ketua" sebelum "ketua"). Dua gaya
// penulisan yang hidup berdampingan di data ("KAUR KEUANGAN" dan "Kepala
// Urusan Keuangan") sengaja ditampung satu pola yang sama.
const URUTAN_JABATAN = [
	{ pola: /kepala\s*desa|^\s*kades\b/i, urutan: 10 },
	{ pola: /sekretaris\s*desa|^\s*sekdes\b/i, urutan: 20 },
	{ pola: /^\s*(kaur|kepala\s*urusan)/i, urutan: 30 },
	{ pola: /^\s*(kasi|kepala\s*seksi)/i, urutan: 40 },
	{ pola: /^\s*(kadus|kepala\s*dusun)/i, urutan: 50 },
	{ pola: /wakil\s*ketua/i, urutan: 70 },
	{ pola: /ketua/i, urutan: 60 },
	{ pola: /sekretaris/i, urutan: 80 },
	{ pola: /anggota/i, urutan: 90 },
	{ pola: /staf/i, urutan: 95 },
];

// "KADUS I" … "KADUS IX" berbagi satu peringkat; angka Romawi di ujung nama
// jabatan jadi penentu urutan di antara mereka — urut abjad akan menaruh
// "KADUS IX" sebelum "KADUS V".
const angkaRomawi = (teks) => {
	const NILAI = { I: 1, V: 5, X: 10 };
	const huruf = teks.toUpperCase();
	let total = 0;
	for (let i = 0; i < huruf.length; i++) {
		const nilai = NILAI[huruf[i]];
		if (!nilai) return 0;
		total += NILAI[huruf[i + 1]] > nilai ? -nilai : nilai;
	}
	return total;
};

const peringkatJabatan = (jabatan = '') => {
	const cocok = URUTAN_JABATAN.find((item) => item.pola.test(jabatan));
	const romawi = jabatan.match(/\b([IVX]+)\s*$/i);
	return { urutan: cocok ? cocok.urutan : 99, nomor: romawi ? angkaRomawi(romawi[1]) : 0 };
};

/**
 * Daftar aparatur dikelompokkan Kecamatan → Desa, isinya urut jabatan
 * (kepala desa dulu, lalu sekdes, dst; BPD dari ketua ke anggota).
 *
 * Tanpa halaman: mode ini memang memperlihatkan seluruh wilayah sekaligus,
 * jadi kolom yang diambil dipangkas seperlunya agar muatannya tetap ringan.
 */
const getGrouped = async (req, res) => {
	try {
		const where = bangunWhere(req.query);

		const rows = await prisma.aparatur_desa.findMany({
			where,
			select: {
				id: true,
				nama_lengkap: true,
				jabatan: true,
				status: true,
				jenis_kelamin: true,
				file_pas_foto: true,
				dpmd_verified_at: true,
				desas: {
					select: {
						id: true,
						nama: true,
						kecamatans: { select: { id: true, nama: true } },
					},
				},
			},
		});

		const kecamatans = new Map();
		for (const row of rows) {
			const desa = row.desas;
			const kec = desa?.kecamatans;
			// Aparatur tanpa desa/kecamatan tidak punya tempat di pohon wilayah.
			if (!desa || !kec) continue;

			const idKec = String(kec.id);
			let kecamatan = kecamatans.get(idKec);
			if (!kecamatan) {
				kecamatan = { id: idKec, nama: kec.nama, total: 0, desa: new Map() };
				kecamatans.set(idKec, kecamatan);
			}

			const idDesa = String(desa.id);
			let entriDesa = kecamatan.desa.get(idDesa);
			if (!entriDesa) {
				entriDesa = { id: idDesa, nama: desa.nama, total: 0, aparatur: [] };
				kecamatan.desa.set(idDesa, entriDesa);
			}

			const { urutan, nomor } = peringkatJabatan(row.jabatan || '');
			entriDesa.aparatur.push({
				id: row.id,
				nama_lengkap: row.nama_lengkap,
				jabatan: row.jabatan,
				status: row.status,
				jenis_kelamin: row.jenis_kelamin,
				file_pas_foto: row.file_pas_foto,
				dpmd_verified_at: row.dpmd_verified_at,
				urutan,
				nomor,
			});
			entriDesa.total += 1;
			kecamatan.total += 1;
		}

		const perNama = (a, b) => a.nama.localeCompare(b.nama, 'id');
		const data = [...kecamatans.values()]
			.map((kecamatan) => ({
				...kecamatan,
				desa: [...kecamatan.desa.values()]
					.map((desa) => ({
						...desa,
						aparatur: desa.aparatur.sort(
							(a, b) =>
								a.urutan - b.urutan ||
								a.nomor - b.nomor ||
								a.nama_lengkap.localeCompare(b.nama_lengkap, 'id')
						),
					}))
					.sort(perNama),
			}))
			.sort(perNama);

		res.json({
			success: true,
			message: 'Aparatur Desa per wilayah',
			data,
			meta: {
				totalItems: rows.length,
				totalKecamatan: data.length,
				totalDesa: data.reduce((jumlah, kecamatan) => jumlah + kecamatan.desa.length, 0),
			},
		});
	} catch (error) {
		console.error('Error fetching aparatur desa per wilayah:', error);
		res.status(500).json({
			success: false,
			message: 'Gagal mengambil data aparatur desa per wilayah',
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

		// Nama pemverifikasi diambil terpisah — kolomnya sengaja tidak direlasikan
		// ke `users`, dan hanya layar detail yang membutuhkan namanya.
		let dpmd_verified_nama = null;
		if (aparatur.dpmd_verified_by) {
			const pemverifikasi = await prisma.users.findUnique({
				where: { id: aparatur.dpmd_verified_by },
				select: { name: true },
			});
			dpmd_verified_nama = pemverifikasi?.name || null;
		}

		res.json({
			success: true,
			data: { ...aparatur, dpmd_verified_nama },
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

// Kolom yang boleh disunting dari sisi bidang. Berkas (file_*) sengaja TIDAK
// ikut: unggahannya tetap kewenangan desa, bidang hanya membetulkan isian.
const KOLOM_TEKS = [
	'nama_lengkap',
	'jabatan',
	'nipd',
	'niap',
	'tempat_lahir',
	'jenis_kelamin',
	'pendidikan_terakhir',
	'agama',
	'pangkat_golongan',
	'nomor_sk_pengangkatan',
	'nomor_sk_pemberhentian',
	'keterangan',
	'status',
];
const KOLOM_TANGGAL = ['tanggal_lahir', 'tanggal_pengangkatan', 'tanggal_pemberhentian'];
// Kolom NOT NULL di tabel — boleh diubah, tidak boleh dikosongkan.
const KOLOM_WAJIB = ['nama_lengkap', 'jabatan', 'tempat_lahir', 'tanggal_lahir', 'jenis_kelamin', 'pendidikan_terakhir', 'agama', 'tanggal_pengangkatan', 'nomor_sk_pengangkatan'];

/**
 * Update satu aparatur dari sisi Bidang Pemerintahan Desa.
 * Hanya kolom yang dikirim yang disentuh, jadi form parsial tetap aman.
 */
const updateAparaturDesa = async (req, res) => {
	try {
		const { id } = req.params;
		const ada = await prisma.aparatur_desa.findUnique({ where: { id }, select: { id: true } });
		if (!ada) {
			return res.status(404).json({ success: false, message: 'Data aparatur desa tidak ditemukan' });
		}

		const data = {};
		for (const kolom of KOLOM_TEKS) {
			if (!(kolom in req.body)) continue;
			const nilai = req.body[kolom];
			data[kolom] = nilai === '' || nilai === null ? null : String(nilai).trim();
		}
		for (const kolom of KOLOM_TANGGAL) {
			if (!(kolom in req.body)) continue;
			const nilai = req.body[kolom];
			if (!nilai) {
				data[kolom] = null;
				continue;
			}
			const tanggal = new Date(nilai);
			if (Number.isNaN(tanggal.getTime())) {
				return res.status(400).json({ success: false, message: `Tanggal tidak valid pada kolom ${kolom}` });
			}
			data[kolom] = tanggal;
		}

		const kosong = KOLOM_WAJIB.filter((kolom) => kolom in data && !data[kolom]);
		if (kosong.length) {
			return res.status(400).json({
				success: false,
				message: `Kolom wajib tidak boleh dikosongkan: ${kosong.join(', ')}`,
			});
		}

		if (Object.keys(data).length === 0) {
			return res.status(400).json({ success: false, message: 'Tidak ada perubahan yang dikirim' });
		}

		data.updated_at = new Date();
		const aparatur = await prisma.aparatur_desa.update({ where: { id }, data });

		res.json({ success: true, message: 'Data aparatur desa diperbarui', data: aparatur });
	} catch (error) {
		console.error('Error updating aparatur desa (pemdes):', error);
		res.status(500).json({
			success: false,
			message: 'Gagal memperbarui data aparatur desa',
			error: error.message,
		});
	}
};

/**
 * Tandai / batalkan verifikasi satu aparatur oleh Bidang Pemerintahan Desa.
 */
const verifikasiAparaturDesa = async (req, res) => {
	try {
		const { id } = req.params;
		const ada = await prisma.aparatur_desa.findUnique({ where: { id }, select: { id: true } });
		if (!ada) {
			return res.status(404).json({ success: false, message: 'Data aparatur desa tidak ditemukan' });
		}

		// Default true supaya tombol "Verifikasi" cukup mengirim body kosong.
		const terverifikasi = req.body?.terverifikasi !== false;
		const catatan = req.body?.catatan ? String(req.body.catatan).trim() : null;

		const aparatur = await prisma.aparatur_desa.update({
			where: { id },
			data: {
				dpmd_verified_at: terverifikasi ? new Date() : null,
				dpmd_verified_by: terverifikasi ? BigInt(req.user.id) : null,
				catatan_verifikasi: catatan,
				updated_at: new Date(),
			},
		});

		res.json({
			success: true,
			message: terverifikasi ? 'Data aparatur desa terverifikasi' : 'Verifikasi dibatalkan',
			data: aparatur,
		});
	} catch (error) {
		console.error('Error verifying aparatur desa:', error);
		res.status(500).json({
			success: false,
			message: 'Gagal memperbarui status verifikasi',
			error: error.message,
		});
	}
};

/**
 * Get statistics for aparatur desa (for dashboard)
 */
const getStats = async (req, res) => {
	try {
		// Kartu angka harus memakai penyaringan yang sama dengan tabelnya, kalau
		// tidak halaman BPD akan memamerkan total se-kabupaten.
		const where = filterJenis(req.query.jenis) || {};
		const dengan = (extra) => ({ ...where, ...extra });

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
			prisma.aparatur_desa.count({ where }),
			prisma.aparatur_desa.count({ where: dengan({ status: 'Aktif' }) }),
			prisma.aparatur_desa.count({ where: dengan({ jenis_kelamin: 'Laki_laki' }) }),
			prisma.aparatur_desa.count({ where: dengan({ jenis_kelamin: 'Perempuan' }) }),
			prisma.aparatur_desa.groupBy({
				by: ['desa_id'],
				where,
				_count: true,
			}).then(groups => groups.length),
			prisma.aparatur_desa.findMany({
				where,
				select: { tanggal_lahir: true },
			}),
			prisma.aparatur_desa.groupBy({
				by: ['pendidikan_terakhir'],
				where,
				_count: { _all: true },
				orderBy: { _count: { pendidikan_terakhir: 'desc' } },
			}),
			prisma.aparatur_desa.groupBy({
				by: ['jabatan'],
				where,
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
	getGrouped,
	updateAparaturDesa,
	verifikasiAparaturDesa,
	filterJenis,
};
