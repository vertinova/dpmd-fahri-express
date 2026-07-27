const prisma = require('../config/prisma');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs').promises;
const { keAparaturDesa, bandingkanDenganAparatur } = require('../config/dapurDesa');

/**
 * Get all aparatur desa for logged in user's desa
 */
const getAllAparaturDesa = async (req, res) => {
	try {
		const { desa_id } = req.user;
		const { search } = req.query;

		const where = {
			desa_id: parseInt(desa_id),
		};

		if (search) {
			where.OR = [
				{ nama_lengkap: { contains: search } },
				{ jabatan: { contains: search } },
			];
		}

		const aparatur = await prisma.aparatur_desa.findMany({
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
			orderBy: {
				created_at: 'desc',
			},
		});

		res.json({
			success: true,
			message: 'Daftar Aparatur Desa',
			data: aparatur,
		});
	} catch (error) {
		console.error('Error fetching aparatur desa:', error);
		res.status(500).json({
			success: false,
			message: 'Gagal mengambil data aparatur desa',
			error: error.message,
		});
	}
};

/**
 * Get single aparatur desa by ID
 */
const getAparaturDesaById = async (req, res) => {
	try {
		const { id } = req.params;
		const { desa_id } = req.user;

		const aparatur = await prisma.aparatur_desa.findFirst({
			where: {
				id,
				desa_id: parseInt(desa_id),
			},
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
		console.error('Error fetching aparatur desa:', error);
		res.status(500).json({
			success: false,
			message: 'Gagal mengambil data aparatur desa',
			error: error.message,
		});
	}
};

/**
 * Create new aparatur desa
 */
const createAparaturDesa = async (req, res) => {
	try {
		const { desa_id } = req.user;

		// Normalize empty strings to null for nullable fields
		const data = { ...req.body };
		const nullableFields = [
			'nipd',
			'niap',
			'pangkat_golongan',
			'tanggal_pemberhentian',
			'nomor_sk_pemberhentian',
			'keterangan',
			'produk_hukum_id',
			'bpjs_kesehatan_nomor',
			'bpjs_ketenagakerjaan_nomor',
		];

		nullableFields.forEach((field) => {
			if (data[field] === '') {
				data[field] = null;
			}
		});

		// Convert date strings to Date objects
		if (data.tanggal_lahir) {
			data.tanggal_lahir = new Date(data.tanggal_lahir);
		}
		if (data.tanggal_pengangkatan) {
			data.tanggal_pengangkatan = new Date(data.tanggal_pengangkatan);
		}
		if (data.tanggal_pemberhentian) {
			data.tanggal_pemberhentian = new Date(data.tanggal_pemberhentian);
		}

		// Map jenis_kelamin to match Prisma enum (Laki-laki -> Laki_laki)
		if (data.jenis_kelamin) {
			data.jenis_kelamin = data.jenis_kelamin.replace(/-/g, '_');
		}

		// Map status to match Prisma enum (Tidak Aktif -> Tidak_Aktif)
		if (data.status) {
			data.status = data.status.replace(/ /g, '_');
		}

		// Handle file uploads (multer stores files in req.files as arrays)
		const fileFields = [
			'file_bpjs_kesehatan',
			'file_bpjs_ketenagakerjaan',
			'file_pas_foto',
			'file_ktp',
			'file_kk',
			'file_akta_kelahiran',
			'file_ijazah_terakhir',
		];

		for (const field of fileFields) {
			if (req.files && req.files[field] && req.files[field][0]) {
				data[field] = req.files[field][0].filename;
			} else {
				data[field] = null;
			}
		}

		const aparatur = await prisma.aparatur_desa.create({
			data: {
				id: uuidv4(),
				desa_id: parseInt(desa_id),
				nama_lengkap: data.nama_lengkap,
				jabatan: data.jabatan,
				nipd: data.nipd,
				niap: data.niap,
				tempat_lahir: data.tempat_lahir,
				tanggal_lahir: data.tanggal_lahir,
				jenis_kelamin: data.jenis_kelamin,
				pendidikan_terakhir: data.pendidikan_terakhir,
				agama: data.agama,
				pangkat_golongan: data.pangkat_golongan,
				tanggal_pengangkatan: data.tanggal_pengangkatan,
				nomor_sk_pengangkatan: data.nomor_sk_pengangkatan,
				tanggal_pemberhentian: data.tanggal_pemberhentian,
				nomor_sk_pemberhentian: data.nomor_sk_pemberhentian,
				keterangan: data.keterangan,
				status: data.status || 'Aktif',
				produk_hukum_id: data.produk_hukum_id,
				bpjs_kesehatan_nomor: data.bpjs_kesehatan_nomor,
				bpjs_ketenagakerjaan_nomor: data.bpjs_ketenagakerjaan_nomor,
				file_bpjs_kesehatan: data.file_bpjs_kesehatan,
				file_bpjs_ketenagakerjaan: data.file_bpjs_ketenagakerjaan,
				file_pas_foto: data.file_pas_foto,
				file_ktp: data.file_ktp,
				file_kk: data.file_kk,
				file_akta_kelahiran: data.file_akta_kelahiran,
				file_ijazah_terakhir: data.file_ijazah_terakhir,
			},
			include: {
				desas: {
					select: {
						id: true,
						nama: true,
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

		res.status(201).json({
			success: true,
			message: 'Aparatur desa berhasil ditambahkan',
			data: aparatur,
		});
	} catch (error) {
		console.error('Error creating aparatur desa:', error);
		res.status(500).json({
			success: false,
			message: 'Gagal menambahkan aparatur desa',
			error: error.message,
		});
	}
};

/**
 * Update aparatur desa
 */
const updateAparaturDesa = async (req, res) => {
	try {
		const { id } = req.params;
		const { desa_id } = req.user;

		// Check if aparatur exists and belongs to user's desa
		const existing = await prisma.aparatur_desa.findFirst({
			where: {
				id,
				desa_id: parseInt(desa_id),
			},
		});

		if (!existing) {
			return res.status(404).json({
				success: false,
				message: 'Data aparatur desa tidak ditemukan',
			});
		}

		// Normalize empty strings to null for nullable fields
		const data = { ...req.body };
		const nullableFields = [
			'nipd',
			'niap',
			'pangkat_golongan',
			'tanggal_pemberhentian',
			'nomor_sk_pemberhentian',
			'keterangan',
			'produk_hukum_id',
			'bpjs_kesehatan_nomor',
			'bpjs_ketenagakerjaan_nomor',
		];

		nullableFields.forEach((field) => {
			if (data[field] === '') {
				data[field] = null;
			}
		});

		// Convert date strings to Date objects
		if (data.tanggal_lahir) {
			data.tanggal_lahir = new Date(data.tanggal_lahir);
		}
		if (data.tanggal_pengangkatan) {
			data.tanggal_pengangkatan = new Date(data.tanggal_pengangkatan);
		}
		if (data.tanggal_pemberhentian) {
			data.tanggal_pemberhentian = new Date(data.tanggal_pemberhentian);
		}

		// Map jenis_kelamin to match Prisma enum (Laki-laki -> Laki_laki)
		if (data.jenis_kelamin) {
			data.jenis_kelamin = data.jenis_kelamin.replace(/-/g, '_');
		}

		// Map status to match Prisma enum (Tidak Aktif -> Tidak_Aktif)
		if (data.status) {
			data.status = data.status.replace(/ /g, '_');
		}

		// Handle file uploads (multer stores files in req.files as arrays)
		const fileFields = [
			'file_bpjs_kesehatan',
			'file_bpjs_ketenagakerjaan',
			'file_pas_foto',
			'file_ktp',
			'file_kk',
			'file_akta_kelahiran',
			'file_ijazah_terakhir',
		];

		for (const field of fileFields) {
			if (req.files && req.files[field] && req.files[field][0]) {
				// Delete old file if exists
				if (existing[field]) {
					const oldPath = path.join(
						__dirname,
						'../../storage/uploads/aparatur_desa_files',
						existing[field]
					);
					try {
						await fs.unlink(oldPath);
					} catch (err) {
						console.error(`Error deleting old file ${field}:`, err);
					}
				}

				// Use the filename from multer upload
				data[field] = req.files[field][0].filename;
			}
		}

		const aparatur = await prisma.aparatur_desa.update({
			where: { id },
			data: {
				nama_lengkap: data.nama_lengkap,
				jabatan: data.jabatan,
				nipd: data.nipd,
				niap: data.niap,
				tempat_lahir: data.tempat_lahir,
				tanggal_lahir: data.tanggal_lahir,
				jenis_kelamin: data.jenis_kelamin,
				pendidikan_terakhir: data.pendidikan_terakhir,
				agama: data.agama,
				pangkat_golongan: data.pangkat_golongan,
				tanggal_pengangkatan: data.tanggal_pengangkatan,
				nomor_sk_pengangkatan: data.nomor_sk_pengangkatan,
				tanggal_pemberhentian: data.tanggal_pemberhentian,
				nomor_sk_pemberhentian: data.nomor_sk_pemberhentian,
				keterangan: data.keterangan,
				status: data.status,
				produk_hukum_id: data.produk_hukum_id,
				bpjs_kesehatan_nomor: data.bpjs_kesehatan_nomor,
				bpjs_ketenagakerjaan_nomor: data.bpjs_ketenagakerjaan_nomor,
				file_bpjs_kesehatan: data.file_bpjs_kesehatan || existing.file_bpjs_kesehatan,
				file_bpjs_ketenagakerjaan: data.file_bpjs_ketenagakerjaan || existing.file_bpjs_ketenagakerjaan,
				file_pas_foto: data.file_pas_foto || existing.file_pas_foto,
				file_ktp: data.file_ktp || existing.file_ktp,
				file_kk: data.file_kk || existing.file_kk,
				file_akta_kelahiran: data.file_akta_kelahiran || existing.file_akta_kelahiran,
				file_ijazah_terakhir: data.file_ijazah_terakhir || existing.file_ijazah_terakhir,
			},
			include: {
				desas: {
					select: {
						id: true,
						nama: true,
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

		res.json({
			success: true,
			message: 'Aparatur desa berhasil diupdate',
			data: aparatur,
		});
	} catch (error) {
		console.error('Error updating aparatur desa:', error);
		res.status(500).json({
			success: false,
			message: 'Gagal mengupdate aparatur desa',
			error: error.message,
		});
	}
};

/**
 * Delete aparatur desa
 */
const deleteAparaturDesa = async (req, res) => {
	try {
		const { id } = req.params;
		const { desa_id } = req.user;

		// Check if aparatur exists and belongs to user's desa
		const existing = await prisma.aparatur_desa.findFirst({
			where: {
				id,
				desa_id: parseInt(desa_id),
			},
		});

		if (!existing) {
			return res.status(404).json({
				success: false,
				message: 'Data aparatur desa tidak ditemukan',
			});
		}

		// Delete all associated files
		const fileFields = [
			'file_bpjs_kesehatan',
			'file_bpjs_ketenagakerjaan',
			'file_pas_foto',
			'file_ktp',
			'file_kk',
			'file_akta_kelahiran',
			'file_ijazah_terakhir',
		];

		for (const field of fileFields) {
			if (existing[field]) {
				const filePath = path.join(
					__dirname,
					'../../storage/uploads/aparatur_desa_files',
					existing[field]
				);
				try {
					await fs.unlink(filePath);
				} catch (err) {
					console.error(`Error deleting file ${field}:`, err);
				}
			}
		}

		await prisma.aparatur_desa.delete({
			where: { id },
		});

		res.json({
			success: true,
			message: 'Aparatur desa berhasil dihapus',
		});
	} catch (error) {
		console.error('Error deleting aparatur desa:', error);
		res.status(500).json({
			success: false,
			message: 'Gagal menghapus aparatur desa',
			error: error.message,
		});
	}
};

// ============================================================
// REKONSILIASI ARSIP DAPUR DESA
//
// Arsip Dapur Desa sudah dimuat ke tabel `aparatur_dapur_desa` oleh
// scripts/import-dapur-desa.js. Desa yang saat impor belum punya data apa pun
// sudah langsung disuntik (status `otomatis`); sisanya menunggu keputusan desa:
//   konflik → nama yang sama sudah ada di data desa, pilih mana yang dipakai.
//   baru    → orang ini belum ada di data desa, desa boleh menambahkannya.
// ============================================================

/** Kolom staging yang perlu dilihat desa saat membandingkan. */
const KOLOM_STAGING = {
	id: true,
	dapur_id: true,
	nama: true,
	jabatan: true,
	jenis_kelamin: true,
	usia: true,
	agama: true,
	pendidikan: true,
	status_pns: true,
	status_kawin: true,
	no_sk: true,
	tgl_sk: true,
	no_sk_pertama: true,
	tgl_sk_pertama: true,
	foto_url: true,
	status_rekonsiliasi: true,
	aparatur_desa_id: true,
};

/**
 * Daftar rekonsiliasi arsip Dapur Desa untuk desa yang sedang login.
 * GET /api/desa/aparatur-desa/dapur-desa
 */
const getRekonsiliasiDapurDesa = async (req, res) => {
	try {
		const desaId = BigInt(String(req.user.desa_id));

		const [konflik, baru, ringkasanMentah] = await Promise.all([
			prisma.aparatur_dapur_desa.findMany({
				where: { desa_id: desaId, status_rekonsiliasi: 'konflik' },
				select: KOLOM_STAGING,
				orderBy: { nama: 'asc' },
			}),
			prisma.aparatur_dapur_desa.findMany({
				where: { desa_id: desaId, status_rekonsiliasi: 'baru' },
				select: KOLOM_STAGING,
				orderBy: { nama: 'asc' },
			}),
			prisma.aparatur_dapur_desa.groupBy({
				by: ['status_rekonsiliasi'],
				where: { desa_id: desaId },
				_count: { id: true },
			}),
		]);

		// Pasangan data desa untuk setiap konflik, supaya bisa ditampilkan berdampingan.
		const idAparatur = konflik.map((k) => k.aparatur_desa_id).filter(Boolean);
		const pasangan = idAparatur.length
			? await prisma.aparatur_desa.findMany({
					where: { id: { in: idAparatur } },
					select: {
						id: true,
						nama_lengkap: true,
						jabatan: true,
						jenis_kelamin: true,
						tempat_lahir: true,
						tanggal_lahir: true,
						pendidikan_terakhir: true,
						agama: true,
						pangkat_golongan: true,
						tanggal_pengangkatan: true,
						nomor_sk_pengangkatan: true,
						file_pas_foto: true,
					},
			  })
			: [];
		const pasanganById = new Map(pasangan.map((p) => [p.id, p]));

		const ringkasan = ringkasanMentah.reduce(
			(acc, r) => ({ ...acc, [r.status_rekonsiliasi]: r._count.id }),
			{ otomatis: 0, sama: 0, konflik: 0, baru: 0, selesai: 0, ditolak: 0 }
		);

		// Kolom yang benar-benar berbeda dihitung ulang di sini: dipakai UI untuk
		// menandai baris, sekaligus jaring pengaman kalau ada baris lama yang
		// tercatat konflik padahal isinya sama (mis. hasil impor sebelum
		// pembanding ini ada). Yang ternyata identik tidak usah ditanyakan.
		const konflikNyata = konflik
			.map((k) => {
				const dataDesa = pasanganById.get(k.aparatur_desa_id) || null;
				return {
					...k,
					id: String(k.id),
					data_desa: dataDesa,
					kolom_beda: dataDesa ? bandingkanDenganAparatur(k, dataDesa).beda : [],
				};
			})
			.filter((k) => !k.data_desa || k.kolom_beda.length > 0);

		res.json({
			success: true,
			data: {
				ringkasan,
				konflik: konflikNyata,
				baru: baru.map((b) => ({ ...b, id: String(b.id) })),
			},
		});
	} catch (error) {
		console.error('Error fetching rekonsiliasi Dapur Desa:', error);
		res.status(500).json({
			success: false,
			message: 'Gagal memuat data rekonsiliasi Dapur Desa',
			error: error.message,
		});
	}
};

/**
 * Terapkan satu baris arsip ke data desa.
 *
 * Sengaja TIDAK menimpa kolom yang tidak dimiliki arsip (tempat/tanggal lahir,
 * NIPD, NIAP, BPJS, berkas) — isian desa untuk kolom itu jauh lebih tepercaya
 * daripada nilai taksiran, jadi dipertahankan apa adanya.
 */
const terapkanArsipKeAparatur = async (baris, desaId, aparaturId) => {
	const data = keAparaturDesa(baris, desaId, { id: aparaturId || undefined });

	if (aparaturId) {
		const { id, desa_id, tempat_lahir, tanggal_lahir, ...bolehDitimpa } = data;
		return prisma.aparatur_desa.update({
			where: { id: aparaturId },
			data: { ...bolehDitimpa, updated_at: new Date() },
		});
	}

	return prisma.aparatur_desa.create({
		data: { ...data, created_at: new Date(), updated_at: new Date() },
	});
};

/**
 * Tetapkan data mana yang dipakai untuk satu baris arsip.
 * POST /api/desa/aparatur-desa/dapur-desa/:dapurId/putuskan  { keputusan: 'dapur' | 'desa' }
 */
const putuskanDapurDesa = async (req, res) => {
	try {
		const desaId = BigInt(String(req.user.desa_id));
		const dapurId = parseInt(req.params.dapurId, 10);
		const keputusan = String(req.body?.keputusan || '').toLowerCase();

		if (!['dapur', 'desa'].includes(keputusan)) {
			return res.status(400).json({ success: false, message: "Keputusan harus 'dapur' atau 'desa'" });
		}

		const baris = await prisma.aparatur_dapur_desa.findUnique({ where: { dapur_id: dapurId } });
		if (!baris || String(baris.desa_id) !== String(desaId)) {
			return res.status(404).json({ success: false, message: 'Data arsip tidak ditemukan untuk desa ini' });
		}
		if (!['konflik', 'baru'].includes(baris.status_rekonsiliasi)) {
			return res.status(409).json({
				success: false,
				message: `Data ini sudah diputuskan sebelumnya (status: ${baris.status_rekonsiliasi})`,
			});
		}

		let aparaturId = baris.aparatur_desa_id;
		if (keputusan === 'dapur') {
			const hasil = await terapkanArsipKeAparatur(baris, desaId, baris.aparatur_desa_id);
			aparaturId = hasil.id;
		}

		await prisma.aparatur_dapur_desa.update({
			where: { dapur_id: dapurId },
			data: {
				// 'desa' berarti arsip tidak dipakai — ditandai ditolak supaya tidak muncul lagi.
				status_rekonsiliasi: keputusan === 'dapur' ? 'selesai' : 'ditolak',
				keputusan,
				aparatur_desa_id: aparaturId,
				diputuskan_oleh: BigInt(String(req.user.id)),
				diputuskan_pada: new Date(),
				updated_at: new Date(),
			},
		});

		res.json({
			success: true,
			message:
				keputusan === 'dapur'
					? `Data ${baris.nama} diambil dari arsip Dapur Desa`
					: `Data desa untuk ${baris.nama} dipertahankan`,
		});
	} catch (error) {
		console.error('Error memutuskan data Dapur Desa:', error);
		res.status(500).json({
			success: false,
			message: 'Gagal menetapkan data',
			error: error.message,
		});
	}
};

/**
 * Tambahkan sekaligus semua orang yang ada di arsip tapi belum ada di data desa.
 * Hanya menyentuh status `baru` — konflik tetap harus diputuskan satu per satu
 * supaya tidak ada isian desa yang tertimpa tanpa sengaja.
 * POST /api/desa/aparatur-desa/dapur-desa/tambah-semua-baru
 */
const tambahSemuaBaruDapurDesa = async (req, res) => {
	try {
		const desaId = BigInt(String(req.user.desa_id));
		const daftar = await prisma.aparatur_dapur_desa.findMany({
			where: { desa_id: desaId, status_rekonsiliasi: 'baru' },
		});

		let ditambah = 0;
		const gagal = [];
		for (const baris of daftar) {
			try {
				const hasil = await terapkanArsipKeAparatur(baris, desaId, null);
				await prisma.aparatur_dapur_desa.update({
					where: { dapur_id: baris.dapur_id },
					data: {
						status_rekonsiliasi: 'selesai',
						keputusan: 'dapur',
						aparatur_desa_id: hasil.id,
						diputuskan_oleh: BigInt(String(req.user.id)),
						diputuskan_pada: new Date(),
						updated_at: new Date(),
					},
				});
				ditambah++;
			} catch (err) {
				gagal.push({ nama: baris.nama, pesan: err.message });
			}
		}

		res.json({
			success: true,
			message: `${ditambah} data ditambahkan dari arsip Dapur Desa`,
			ditambah,
			gagal: gagal.length ? gagal : undefined,
		});
	} catch (error) {
		console.error('Error menambah semua data Dapur Desa:', error);
		res.status(500).json({
			success: false,
			message: 'Gagal menambahkan data dari arsip',
			error: error.message,
		});
	}
};

module.exports = {
	getAllAparaturDesa,
	getAparaturDesaById,
	createAparaturDesa,
	updateAparaturDesa,
	deleteAparaturDesa,
	getRekonsiliasiDapurDesa,
	putuskanDapurDesa,
	tambahSemuaBaruDapurDesa,
};
