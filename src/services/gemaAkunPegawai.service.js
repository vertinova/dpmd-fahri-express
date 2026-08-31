/**
 * Gema — akun pegawai: mencari profilnya, dan menyetel ulang sandinya.
 *
 * INI SATU-SATUNYA BAGIAN GEMA YANG MENULIS KE BASIS DATA, jadi aturannya
 * dibuat ketat dan ditulis di satu tempat:
 *
 *   1. IZINNYA LEBIH SEMPIT DARI MANAJEMEN PENGGUNA. Menyetel ulang sandi lewat
 *      SUARA hanya untuk Super Admin, Kepala Dinas, dan Sekretaris Dinas
 *      (PERAN_SETEL_SANDI_SUARA di src/config/akunStaf.js). Staf lain tetap
 *      bisa melakukannya lewat halaman Manajemen Pengguna seperti biasa —
 *      yang dibatasi kemudahannya, bukan kewenangannya: lewat halaman butuh
 *      mencari orangnya dan menekan tombol, lewat suara cukup sekalimat.
 *   2. DUA LANGKAH, SELALU. Satu kalimat tidak pernah cukup untuk mengubah
 *      sandi orang. Perintahnya hanya MENYIAPKAN, lalu pengguna menegaskan
 *      lewat tombol. Pengenalan suara salah dengar itu biasa; "reset sandi
 *      Budi" yang langsung jalan ke Budi yang salah tidak bisa dibatalkan.
 *   3. MODEL BAHASA TIDAK PERNAH MENGEKSEKUSI. Alat yang dipegang model hanya
 *      bisa mencari dan menyiapkan konfirmasi. Yang benar-benar mengubah sandi
 *      adalah endpoint konfirmasi terpisah, yang memeriksa izin sendiri.
 *   4. SUPERADMIN TIDAK BISA DISENTUH dari sini, dan setiap penyetelan ulang
 *      dicatat ke activity log lengkap dengan siapa pelakunya.
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const prisma = require('../config/prisma');
const logger = require('../utils/logger');
const ActivityLogger = require('../utils/activityLogger');
const { PERAN_AKUN_PEGAWAI, bolehSetelSandiSuara, normalkan } = require('../config/akunStaf');
const { SANDI_DEFAULT } = require('../config/sandiDefault');

const MODULE_NAME = 'gema';

/** Berapa lama sebuah konfirmasi menunggu sebelum hangus. */
const UMUR_KONFIRMASI_MS = 5 * 60 * 1000;

/**
 * Konfirmasi yang masih menunggu, di memori proses.
 *
 * Sengaja tidak disimpan ke basis data: umurnya lima menit dan tidak ada
 * gunanya bertahan melewati restart — kalau server sempat mati di tengah,
 * pengguna cukup mengulang perintahnya, dan itu justru lebih aman daripada
 * konfirmasi lama yang tiba-tiba masih bisa dipakai.
 */
const konfirmasiTertunda = new Map();

const buangYangKedaluwarsa = () => {
	const kini = Date.now();
	for (const [token, data] of konfirmasiTertunda) {
		if (data.kedaluwarsa <= kini) konfirmasiTertunda.delete(token);
	}
};

const teks = (v) => {
	if (v === null || v === undefined) return '—';
	const t = String(v).trim();
	return t === '' || t === '-' ? '—' : t;
};

const tanggal = (v) => {
	if (!v) return '—';
	const d = new Date(v);
	return Number.isNaN(d.getTime())
		? '—'
		: d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
};

const waktu = (v) => {
	if (!v) return '—';
	const d = new Date(v);
	return Number.isNaN(d.getTime())
		? '—'
		: d.toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const LABEL_PERAN = {
	superadmin: 'Super Admin',
	kepala_dinas: 'Kepala Dinas',
	sekretaris_dinas: 'Sekretaris Dinas',
	kepala_bidang: 'Kepala Bidang',
	ketua_tim: 'Ketua Tim',
	bendahara: 'Bendahara',
	pegawai: 'Pegawai',
};
const sebutPeran = (peran) => LABEL_PERAN[normalkan(peran)] || teks(peran);

const PILIH_AKUN = {
	id: true,
	name: true,
	email: true,
	role: true,
	is_active: true,
	no_hp: true,
	bidang_id: true,
	created_at: true,
	last_active_at: true,
	password: true,
	pegawai: {
		select: {
			id_pegawai: true,
			nip: true,
			jabatan: true,
			pangkat: true,
			golongan: true,
			eselon: true,
			unit_kerja: true,
			sub_bidang: true,
			status_kepegawaian: true,
			tempat_lahir: true,
			tanggal_lahir: true,
			pendidikan_terakhir: true,
			bidangs: { select: { id: true, nama: true } },
		},
	},
};

/** Kata pemicu yang harus dibuang sebelum sisanya dipakai sebagai nama. */
const KATA_PERINTAH = [
	'setel ulang sandi', 'setel ulang password', 'reset password', 'reset sandi',
	'ubah password', 'ganti password', 'ubah sandi', 'ganti sandi',
	'ke password default', 'ke sandi default', 'password default', 'sandi default',
	'jadi default', 'ke default',
	'profil akun', 'akun pegawai', 'akun staf', 'akun dpmd', 'akun',
	'pegawai', 'staf', 'punya', 'milik', 'atas nama', 'bernama', 'nama',
];

/**
 * Ambil nama/email yang dicari dari kalimat, dengan membuang kata perintahnya.
 * "reset password akun pegawai Budi Santoso" -> "budi santoso".
 */
const ambilKataCari = (kalimat) => {
	let sisa = String(kalimat || '').toLowerCase();
	for (const kata of KATA_PERINTAH) sisa = sisa.split(kata).join(' ');
	return sisa.replace(/\s+/g, ' ').trim();
};

const namaBidang = async (akun) => {
	if (akun.pegawai?.bidangs?.nama) return akun.pegawai.bidangs.nama;
	if (!akun.bidang_id) return null;
	const bidang = await prisma.bidangs.findUnique({
		where: { id: Number(akun.bidang_id) },
		select: { nama: true },
	});
	return bidang?.nama || null;
};

/** Apakah akun ini masih memakai sandi bawaan? */
const masihSandiDefault = async (hash) => {
	try {
		return await bcrypt.compare(SANDI_DEFAULT, String(hash || ''));
	} catch {
		return false;
	}
};

/* ------------------------------------------------------------- pencarian -- */

const cariAkunMentah = async (kata) => {
	const q = String(kata || '').trim();
	if (q.length < 2) return [];

	return prisma.users.findMany({
		where: {
			role: { in: PERAN_AKUN_PEGAWAI },
			OR: [
				{ name: { contains: q } },
				{ email: { contains: q } },
				{ pegawai: { nip: { contains: q } } },
			],
		},
		select: PILIH_AKUN,
		orderBy: { name: 'asc' },
		take: 50,
	});
};

const profilAkun = async (akun) => {
	const p = akun.pegawai;
	const bidang = await namaBidang(akun);
	const sandiDefault = await masihSandiDefault(akun.password);

	return {
		maksud: 'akun-pegawai-profil',
		judul: akun.name,
		kalimat:
			`${akun.name}, ${sebutPeran(akun.role)}${bidang ? ` di ${bidang}` : ''}`
			+ `${p?.jabatan ? `, ${p.jabatan}` : ''}. Akunnya ${akun.is_active ? 'aktif' : 'nonaktif'}`
			+ `${sandiDefault ? ' dan sandinya masih sandi default' : ''}.`,
		rincian: [
			{ label: 'Nama akun', nilai: teks(akun.name) },
			{ label: 'Email', nilai: teks(akun.email) },
			{ label: 'Peran', nilai: sebutPeran(akun.role) },
			{ label: 'Status akun', nilai: akun.is_active ? 'Aktif' : 'Nonaktif' },
			{ label: 'Sandi', nilai: sandiDefault ? 'Masih sandi default' : 'Sudah diganti sendiri' },
			{ label: 'Bidang', nilai: teks(bidang) },
			{ label: 'NIP', nilai: teks(p?.nip) },
			{ label: 'Jabatan', nilai: teks(p?.jabatan) },
			{ label: 'Pangkat', nilai: teks(p?.pangkat) },
			{ label: 'Golongan', nilai: teks(p?.golongan) },
			{ label: 'Eselon', nilai: teks(p?.eselon) },
			{ label: 'Status kepegawaian', nilai: teks(String(p?.status_kepegawaian || '').replace(/_/g, ' ')) },
			{ label: 'Unit kerja', nilai: teks(p?.unit_kerja) },
			{ label: 'Sub bidang', nilai: teks(p?.sub_bidang) },
			{ label: 'Pendidikan terakhir', nilai: teks(p?.pendidikan_terakhir) },
			{ label: 'Tempat lahir', nilai: teks(p?.tempat_lahir) },
			{ label: 'Tanggal lahir', nilai: tanggal(p?.tanggal_lahir) },
			{ label: 'Nomor HP', nilai: teks(akun.no_hp) },
			{ label: 'Terakhir aktif', nilai: waktu(akun.last_active_at) },
			{ label: 'Akun dibuat', nilai: tanggal(akun.created_at) },
			{ label: 'Terhubung data pegawai', nilai: p ? 'Ya' : 'Belum' },
		],
		kolom: [],
		baris: [],
		total: 1,
		akun: { id: Number(akun.id), nama: akun.name, email: akun.email, sandi_default: sandiDefault },
	};
};

const daftarAkun = async (daftar, kata) => {
	const baris = [];
	for (const akun of daftar) {
		baris.push({
			nama: akun.name,
			email: akun.email,
			peran: sebutPeran(akun.role),
			bidang: teks(await namaBidang(akun)),
			jabatan: teks(akun.pegawai?.jabatan),
			status: akun.is_active ? 'Aktif' : 'Nonaktif',
		});
	}

	return {
		maksud: 'akun-pegawai-daftar',
		judul: kata ? `Akun pegawai yang cocok dengan "${kata}"` : 'Akun pegawai',
		kalimat: `Ada ${baris.length} akun pegawai yang cocok.`,
		kolom: [
			{ kunci: 'nama', label: 'Nama' },
			{ kunci: 'email', label: 'Email' },
			{ kunci: 'peran', label: 'Peran' },
			{ kunci: 'bidang', label: 'Bidang' },
			{ kunci: 'jabatan', label: 'Jabatan' },
			{ kunci: 'status', label: 'Status' },
		],
		baris,
		total: baris.length,
	};
};

const kosong = (kalimat) => ({
	maksud: 'akun-pegawai-daftar',
	kalimat,
	kolom: [],
	baris: [],
	total: 0,
});

/**
 * Cari profil akun pegawai. Satu hasil menjadi profil lengkap; banyak hasil
 * menjadi daftar supaya penanya bisa mempersempit.
 */
const cariAkun = async (kata) => {
	const q = String(kata || '').trim();
	if (q.length < 2) {
		return kosong('Sebutkan nama, email, atau NIP pegawainya ya, minimal dua huruf.');
	}

	const daftar = await cariAkunMentah(q);
	if (!daftar.length) return kosong(`Tidak ada akun pegawai yang cocok dengan "${q}".`);
	if (daftar.length === 1) return profilAkun(daftar[0]);
	return daftarAkun(daftar, q);
};

/* -------------------------------------------------- setel ulang sandi (2 langkah) -- */

const ditolak = (kalimat) => ({
	maksud: 'akun-pegawai-ditolak',
	kalimat,
	kolom: [],
	baris: [],
	total: 0,
});

/**
 * LANGKAH 1 — menyiapkan saja. Tidak ada sandi yang berubah di sini; yang
 * dikembalikan adalah profil targetnya plus tiket konfirmasi berumur pendek.
 */
const siapkanSetelUlangSandi = async ({ kata, pelaku }) => {
	if (!pelaku || !bolehSetelSandiSuara(pelaku.role)) {
		return ditolak(
			'Maaf, lewat Gema penyetelan ulang sandi hanya untuk Kepala Dinas, Sekretaris Dinas, '
			+ 'atau Super Admin. Lewat halaman Manajemen Pengguna Anda tetap bisa melakukannya sendiri.',
		);
	}

	const q = String(kata || '').trim();
	if (q.length < 2) {
		return ditolak('Sebutkan nama atau email pegawai yang sandinya mau disetel ulang ya.');
	}

	const daftar = await cariAkunMentah(q);
	if (!daftar.length) return kosong(`Tidak ada akun pegawai yang cocok dengan "${q}", jadi tidak ada yang saya setel ulang.`);

	if (daftar.length > 1) {
		const banyak = await daftarAkun(daftar, q);
		return {
			...banyak,
			kalimat: `Ada ${daftar.length} akun yang cocok dengan "${q}". Sebutkan lebih spesifik — nama lengkap atau emailnya — biar saya tidak salah orang.`,
		};
	}

	const target = daftar[0];
	const profil = await profilAkun(target);

	buangYangKedaluwarsa();
	const token = crypto.randomBytes(24).toString('hex');
	konfirmasiTertunda.set(token, {
		idAkun: Number(target.id),
		namaAkun: target.name,
		emailAkun: target.email,
		idPelaku: String(pelaku.id),
		kedaluwarsa: Date.now() + UMUR_KONFIRMASI_MS,
	});

	logger.info(`Gema: konfirmasi setel ulang sandi disiapkan untuk akun ${target.email} oleh user ${pelaku.id}`);

	return {
		...profil,
		maksud: 'akun-pegawai-konfirmasi',
		kalimat:
			`Saya menemukan ${target.name}, ${target.email}. Sandinya akan disetel ulang ke sandi default `
			+ 'dan dia wajib menggantinya saat login berikutnya. Tekan tombol konfirmasi di layar kalau memang orangnya benar.',
		konfirmasi: {
			token,
			aksi: 'setel-ulang-sandi',
			akun: { id: Number(target.id), nama: target.name, email: target.email },
			label: 'Ya, setel ulang sandinya',
			peringatan: `Sandi ${target.name} akan diganti menjadi sandi default dan wajib diganti saat login berikutnya.`,
			kedaluwarsa_detik: Math.round(UMUR_KONFIRMASI_MS / 1000),
		},
	};
};

/**
 * LANGKAH 2 — eksekusi. Dipanggil endpoint konfirmasi, bukan oleh model.
 */
const jalankanSetelUlangSandi = async ({ token, pelaku, req }) => {
	if (!pelaku || !bolehSetelSandiSuara(pelaku.role)) {
		return ditolak(
			'Maaf, lewat Gema penyetelan ulang sandi hanya untuk Kepala Dinas, Sekretaris Dinas, '
			+ 'atau Super Admin. Lewat halaman Manajemen Pengguna Anda tetap bisa melakukannya sendiri.',
		);
	}

	buangYangKedaluwarsa();
	const tertunda = konfirmasiTertunda.get(String(token || ''));
	if (!tertunda) {
		return ditolak('Konfirmasinya sudah kedaluwarsa atau tidak dikenali. Coba ulangi perintahnya ya.');
	}

	// Tiket terikat ke orang yang memintanya — konfirmasi milik orang lain
	// tidak bisa dipakai, bahkan oleh sesama staf DPMD.
	if (tertunda.idPelaku !== String(pelaku.id)) {
		konfirmasiTertunda.delete(String(token));
		return ditolak('Konfirmasi ini bukan milik akun Anda, jadi saya batalkan.');
	}

	konfirmasiTertunda.delete(String(token));

	const target = await prisma.users.findUnique({
		where: { id: BigInt(tertunda.idAkun) },
		select: PILIH_AKUN,
	});

	if (!target) return ditolak('Akunnya sudah tidak ada. Tidak ada yang saya ubah.');

	// Pemeriksaan ulang, bukan basa-basi: perannya bisa saja berubah di antara
	// perintah dan konfirmasi.
	if (!PERAN_AKUN_PEGAWAI.includes(normalkan(target.role))) {
		return ditolak(`Akun ${target.name} bukan akun pegawai DPMD, jadi tidak saya sentuh.`);
	}

	await prisma.users.update({
		where: { id: BigInt(tertunda.idAkun) },
		data: {
			password: await bcrypt.hash(SANDI_DEFAULT, 10),
			plain_password: SANDI_DEFAULT,
			updated_at: new Date(),
		},
	});

	logger.info(`Gema: sandi akun ${target.email} disetel ulang ke default oleh user ${pelaku.id}`);

	ActivityLogger.log({
		userId: pelaku.id,
		userName: pelaku.name || `User ${pelaku.id}`,
		userRole: pelaku.role,
		module: MODULE_NAME,
		action: 'reset_password',
		entityType: 'user',
		entityId: tertunda.idAkun,
		entityName: target.name,
		description: `${pelaku.name || 'Staf DPMD'} menyetel ulang sandi akun ${target.name} (${target.email}) ke sandi default lewat Gema`,
		newValue: { password: 'default', via: 'gema' },
		ipAddress: req ? ActivityLogger.getIpFromRequest(req) : null,
		userAgent: req ? ActivityLogger.getUserAgentFromRequest(req) : null,
	});

	const profil = await profilAkun({ ...target, password: null });

	return {
		...profil,
		maksud: 'akun-pegawai-disetel-ulang',
		kalimat:
			`Sudah. Sandi ${target.name} sekarang sandi default, dan dia akan diminta menggantinya `
			+ 'begitu login berikutnya.',
		rincian: profil.rincian.map((r) =>
			(r.label === 'Sandi' ? { ...r, nilai: 'Baru disetel ulang ke sandi default' } : r)),
	};
};

module.exports = {
	cariAkun,
	siapkanSetelUlangSandi,
	jalankanSetelUlangSandi,
	ambilKataCari,
	UMUR_KONFIRMASI_MS,
};
