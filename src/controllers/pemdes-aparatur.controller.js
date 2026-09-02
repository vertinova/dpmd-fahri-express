const prisma = require('../config/prisma');
const { AKSI, catatLogAparatur, ambilLogAparatur } = require('../utils/aparaturLog');

// Tabel aparatur_desa tidak punya kolom pembeda perangkat desa vs BPD —
// satu-satunya penanda ada di teks jabatan. Aturannya ditulis sekali di sini
// supaya daftar dan statistik tidak pernah memakai definisi yang berbeda.
const KATA_BPD = ['bpd', 'badan permusyawaratan'];

/** Jenis satu baris, dari aturan yang sama dengan penyaring di bawah. */
const jenisAparatur = (jabatan = '') => {
	const teks = String(jabatan).toLowerCase();
	return KATA_BPD.some((kata) => teks.includes(kata)) ? 'bpd' : 'perangkat';
};

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
				nipd: true,
				status: true,
				jenis_kelamin: true,
				file_pas_foto: true,
				status_verifikasi: true,
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
				nipd: row.nipd,
				status: row.status,
				jenis_kelamin: row.jenis_kelamin,
				file_pas_foto: row.file_pas_foto,
				status_verifikasi: row.status_verifikasi,
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
						// Yang aktif dulu — seluruh susunan jabatan dari kepala desa ke
						// bawah — baru yang nonaktif dengan susunan yang sama di
						// bawahnya. Bukan sekadar mengurut jabatan lalu menyelipkan
						// yang nonaktif di tengah-tengah jajarannya.
						aparatur: desa.aparatur.sort(
							(a, b) =>
								(a.status === 'Aktif' ? 0 : 1) - (b.status === 'Aktif' ? 0 : 1) ||
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
 * Dua hal yang perlu ditindaklanjuti bidang, untuk kolom notifikasi:
 * aparatur yang sudah lewat 60 tahun dan yang belum diputus verifikasinya.
 *
 * Keduanya sengaja dibatasi yang berstatus Aktif — yang sudah nonaktif tidak
 * menuntut tindakan apa pun, dan ikut menghitungnya hanya menggelembungkan
 * angka sampai notifikasinya diabaikan orang.
 */
const USIA_LANJUT = 60;

const getNotifikasi = async (req, res) => {
	try {
		const jenis = ['bpd', 'perangkat'].includes(req.query.jenis) ? req.query.jenis : null;
		const dasar = { ...bangunWhere({ jenis }), status: 'Aktif' };

		const batasLahir = new Date();
		batasLahir.setFullYear(batasLahir.getFullYear() - USIA_LANJUT);

		const pilih = {
			id: true,
			nama_lengkap: true,
			jabatan: true,
			tanggal_lahir: true,
			desas: { select: { nama: true } },
		};
		const urut = { desas: { nama: 'asc' } };

		const whereUsia = { ...dasar, tanggal_lahir: { lt: batasLahir } };
		const whereVerifikasi = { ...dasar, status_verifikasi: null };

		const [totalUsia, contohUsia, totalVerifikasi, contohVerifikasi] = await Promise.all([
			prisma.aparatur_desa.count({ where: whereUsia }),
			prisma.aparatur_desa.findMany({ where: whereUsia, select: pilih, orderBy: { tanggal_lahir: 'asc' }, take: 5 }),
			prisma.aparatur_desa.count({ where: whereVerifikasi }),
			prisma.aparatur_desa.findMany({ where: whereVerifikasi, select: pilih, orderBy: urut, take: 5 }),
		]);

		const ringkas = (rows) =>
			rows.map((row) => ({
				id: row.id,
				nama_lengkap: row.nama_lengkap,
				jabatan: row.jabatan,
				desa: row.desas?.nama || null,
				tanggal_lahir: row.tanggal_lahir,
			}));

		res.json({
			success: true,
			data: {
				batas_usia: USIA_LANJUT,
				usia_lanjut: { total: totalUsia, contoh: ringkas(contohUsia) },
				menunggu_verifikasi: { total: totalVerifikasi, contoh: ringkas(contohVerifikasi) },
			},
		});
	} catch (error) {
		console.error('Error fetching notifikasi aparatur:', error);
		res.status(500).json({
			success: false,
			message: 'Gagal mengambil notifikasi aparatur',
			error: error.message,
		});
	}
};

/**
 * Riwayat terbaru lintas desa — untuk kolom aktivitas di halaman bidang.
 *
 * Log disimpan tanpa relasi Prisma ke `aparatur_desa` (id-nya UUID), jadi
 * identitas orangnya diambil lewat satu query menyusul, bukan join.
 */
const getRiwayatTerbaru = async (req, res) => {
	try {
		const batas = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
		const jenis = ['bpd', 'perangkat'].includes(req.query.jenis) ? req.query.jenis : null;

		// Halaman berikutnya ditunjuk id log terakhir yang sudah dikirim, bukan
		// offset: dengan begitu server tidak perlu melompati baris yang sudah
		// lewat, dan catatan baru yang masuk di tengah penelusuran tidak membuat
		// baris tergeser atau terlewat.
		const cursor = req.query.cursor ? BigInt(String(req.query.cursor)) : null;

		// Jenis tidak tersimpan di tabel log — hanya bisa dibaca dari jabatan
		// orangnya. Jadi log diambil berlebih lalu disaring, memakai aturan yang
		// sama dengan filterJenis.
		// ponytail: pengambilan berlebih 5x; kalau satu jenis nyaris tak pernah
		// disentuh dan halamannya sering terisi kurang, ganti ke query gabungan.
		const ambil = jenis ? Math.min(batas * 5, 250) : batas;
		const logs = await prisma.aparatur_desa_logs.findMany({
			where: cursor ? { id: { lt: cursor } } : {},
			orderBy: { id: 'desc' },
			take: ambil,
		});

		const idAparatur = [...new Set(logs.map((log) => log.aparatur_id))];
		const orang = idAparatur.length
			? await prisma.aparatur_desa.findMany({
					where: { id: { in: idAparatur } },
					select: {
						id: true,
						nama_lengkap: true,
						jabatan: true,
						desas: { select: { nama: true, kecamatans: { select: { nama: true } } } },
					},
			  })
			: [];
		const petaOrang = new Map(orang.map((row) => [row.id, row]));

		const tersaring = logs
			.filter((log) => {
				if (!jenis) return true;
				const aparatur = petaOrang.get(log.aparatur_id);
				// Baris yang sudah terhapus tidak bisa ditentukan jenisnya, jadi
				// tidak ikut di panel yang memang khusus satu jenis.
				return aparatur ? jenisAparatur(aparatur.jabatan) === jenis : false;
			});

		const data = tersaring
			.slice(0, batas)
			.map((log) => {
			const aparatur = petaOrang.get(log.aparatur_id);
			return {
				id: String(log.id),
				aksi: log.aksi,
				keterangan: log.keterangan,
				oleh_nama: log.oleh_nama,
				oleh_peran: log.oleh_peran,
				created_at: log.created_at,
				aparatur_id: log.aparatur_id,
				// Baris yang sudah dihapus tetap ditampilkan apa adanya, tidak
				// disembunyikan — penghapusan justru kejadian yang perlu terlihat.
				nama_lengkap: aparatur?.nama_lengkap || null,
				jabatan: aparatur?.jabatan || null,
				desa: aparatur?.desas?.nama || null,
				kecamatan: aparatur?.desas?.kecamatans?.nama || null,
			};
			});

		// Penunjuk halaman berikutnya diambil dari baris terakhir yang dikirim.
		// Kalau satu halaman habis tersaring, penunjuknya jatuh ke baris mentah
		// terakhir yang sempat diperiksa supaya penelusuran tetap maju.
		const terakhir = data.length ? data[data.length - 1].id : logs.length ? String(logs[logs.length - 1].id) : null;
		const adaLagi = tersaring.length > batas || logs.length === ambil;

		res.json({
			success: true,
			data,
			meta: { nextCursor: adaLagi ? terakhir : null, hasMore: adaLagi },
		});
	} catch (error) {
		console.error('Error fetching riwayat aparatur terbaru:', error);
		res.status(500).json({
			success: false,
			message: 'Gagal mengambil riwayat aparatur',
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

		const riwayat = await ambilLogAparatur(id);

		res.json({
			success: true,
			data: { ...aparatur, dpmd_verified_nama, riwayat },
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

		// Perubahan status punya kalimatnya sendiri: itu kejadian yang dicari
		// orang saat membaca riwayat, bukan sekadar "kolom status ikut berubah".
		const kolomBerubah = Object.keys(data).filter((kolom) => kolom !== 'updated_at');
		const keteranganLog =
			'status' in data
				? `Status diubah menjadi ${data.status === 'Tidak_Aktif' ? 'Tidak Aktif' : 'Aktif'}` +
				  (data.keterangan ? ` — ${data.keterangan}` : '')
				: `Data diperbarui oleh Bidang Pemdes (${kolomBerubah.join(', ')})`;

		await catatLogAparatur({
			aparaturId: id,
			aksi: AKSI.diubah,
			keterangan: keteranganLog,
			user: req.user,
		});

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
 * Keputusan verifikasi oleh Bidang Pemerintahan Desa: setujui, tolak, atau
 * batalkan keputusan sebelumnya. Keterangan wajib saat menolak — itulah yang
 * dibaca desa untuk tahu apa yang harus dibetulkan.
 */
const STATUS_VERIFIKASI = ['terverifikasi', 'ditolak', 'batal'];

const verifikasiAparaturDesa = async (req, res) => {
	try {
		const { id } = req.params;
		const ada = await prisma.aparatur_desa.findUnique({ where: { id }, select: { id: true } });
		if (!ada) {
			return res.status(404).json({ success: false, message: 'Data aparatur desa tidak ditemukan' });
		}

		const status = String(req.body?.status || '').trim();
		if (!STATUS_VERIFIKASI.includes(status)) {
			return res.status(400).json({
				success: false,
				message: `Status verifikasi harus salah satu dari: ${STATUS_VERIFIKASI.join(', ')}`,
			});
		}

		const catatan = req.body?.catatan ? String(req.body.catatan).trim() : null;
		if (status === 'ditolak' && !catatan) {
			return res.status(400).json({
				success: false,
				message: 'Keterangan wajib diisi saat menolak verifikasi',
			});
		}

		const dibatalkan = status === 'batal';
		const aparatur = await prisma.aparatur_desa.update({
			where: { id },
			data: {
				status_verifikasi: dibatalkan ? null : status,
				dpmd_verified_at: dibatalkan ? null : new Date(),
				dpmd_verified_by: dibatalkan ? null : BigInt(req.user.id),
				catatan_verifikasi: dibatalkan ? null : catatan,
				updated_at: new Date(),
			},
		});

		const pesan = {
			terverifikasi: 'Data aparatur desa terverifikasi',
			ditolak: 'Verifikasi ditolak',
			batal: 'Keputusan verifikasi dibatalkan',
		};

		await catatLogAparatur({
			aparaturId: id,
			aksi: dibatalkan ? AKSI.verifikasi_dibatalkan : status,
			keterangan: catatan,
			user: req.user,
		});

		res.json({ success: true, message: pesan[status], data: aparatur });
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
	getRiwayatTerbaru,
	getNotifikasi,
	updateAparaturDesa,
	verifikasiAparaturDesa,
	filterJenis,
};
