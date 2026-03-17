const prisma = require('../config/prisma');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs').promises;
const axios = require('axios');
const externalApiService = require('../services/externalApiProxy.service');

/**
 * Download photo from URL and save to aparatur_desa_files directory
 * Returns the filename if successful, null otherwise
 */
const downloadPhoto = async (photoUrl, personName) => {
	if (!photoUrl) return null;
	try {
		const response = await axios.get(photoUrl, {
			responseType: 'arraybuffer',
			timeout: 15000,
		});
		const contentType = response.headers['content-type'] || '';
		let ext = '.jpg';
		if (contentType.includes('png')) ext = '.png';
		else if (contentType.includes('webp')) ext = '.webp';
		const safeName = (personName || 'photo').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
		const filename = `${Date.now()}_${safeName}${ext}`;
		const uploadDir = path.join(__dirname, '../../storage/uploads/aparatur_desa_files');
		await fs.mkdir(uploadDir, { recursive: true });
		await fs.writeFile(path.join(uploadDir, filename), response.data);
		return filename;
	} catch (err) {
		console.error(`[Import] Failed to download photo for ${personName}:`, err.message);
		return null;
	}
};

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

/**
 * Import aparatur desa from external Dapur Desa API
 * Maps external API fields to local database columns
 */
const importFromExternal = async (req, res) => {
	try {
		const { desa_id } = req.user;
		const desa = await prisma.desas.findFirst({
			where: { id: parseInt(desa_id) },
			select: { id: true, kode: true, nama: true },
		});

		if (!desa || !desa.kode) {
			return res.status(400).json({
				success: false,
				message: 'Kode desa tidak ditemukan',
			});
		}

		const villageCode = desa.kode.replace(/\./g, '');

		// Fetch all external data (both Perangkat Desa and BPD)
		const fetchAll = async (jobType) => {
			let allData = [];
			let page = 1;
			let hasMore = true;
			while (hasMore) {
				const result = await externalApiService.fetchAparaturDesa({
					master_village_id: villageCode,
					job_type: jobType,
					page,
					limit: 100,
				});
				const items = result.data || [];
				allData = allData.concat(items);
				const totalPage = result.meta?.totalPage || 1;
				hasMore = page < totalPage;
				page++;
			}
			return allData;
		};

		const [perangkat, bpd] = await Promise.all([
			fetchAll('Perangkat Desa'),
			fetchAll('BPD'),
		]);
		const externalData = [...perangkat, ...bpd];

		if (externalData.length === 0) {
			return res.json({
				success: true,
				message: 'Tidak ada data dari Dapur Desa untuk diimpor',
				imported: 0,
			});
		}

		// Map gender: external "L"/"P" -> DB enum "Laki_laki"/"Perempuan"
		const mapGender = (g) => {
			if (g === 'L') return 'Laki_laki';
			if (g === 'P') return 'Perempuan';
			return 'Laki_laki';
		};

		// Estimate birth date from usia (age)
		const estimateBirthDate = (usia) => {
			if (!usia) return new Date('2000-01-01');
			const year = new Date().getFullYear() - parseInt(usia);
			return new Date(`${year}-01-01`);
		};

		let imported = 0;
		let skipped = 0;
		const errors = [];

		for (const ext of externalData) {
			try {
				// Check duplicate by nama_lengkap + jabatan for this desa
				const existing = await prisma.aparatur_desa.findFirst({
					where: {
						desa_id: parseInt(desa_id),
						nama_lengkap: ext.name || '',
						jabatan: ext.master_job_level_name || '-',
					},
				});

				if (existing) {
					skipped++;
					continue;
				}

				// Download photo if available
				const photoFilename = await downloadPhoto(ext.photo, ext.name);

				await prisma.aparatur_desa.create({
					data: {
						id: uuidv4(),
						desa_id: parseInt(desa_id),
						nama_lengkap: ext.name || '-',
						jabatan: ext.master_job_level_name || '-',
						tempat_lahir: '-',
						tanggal_lahir: estimateBirthDate(ext.usia),
						jenis_kelamin: mapGender(ext.gender),
						pendidikan_terakhir: ext.master_degree_name || '-',
						agama: ext.agama || '-',
						pangkat_golongan: ext.status_pns === 'PNS' ? 'PNS' : null,
						tanggal_pengangkatan: ext.sk_date ? new Date(ext.sk_date) : new Date(),
						nomor_sk_pengangkatan: ext.no_sk || '-',
						status: 'Aktif',
						file_pas_foto: photoFilename,
						keterangan: `Diimpor dari Dapur Desa (ID: ${ext.id || '-'})`,
					},
				});
				imported++;
			} catch (err) {
				errors.push({ name: ext.name, error: err.message });
			}
		}

		res.json({
			success: true,
			message: `Berhasil mengimpor ${imported} data aparatur desa${skipped > 0 ? `, ${skipped} data sudah ada (dilewati)` : ''}`,
			imported,
			skipped,
			total: externalData.length,
			errors: errors.length > 0 ? errors : undefined,
		});
	} catch (error) {
		console.error('Error importing from external:', error);
		res.status(500).json({
			success: false,
			message: 'Gagal mengimpor data dari Dapur Desa',
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
	importFromExternal,
};
