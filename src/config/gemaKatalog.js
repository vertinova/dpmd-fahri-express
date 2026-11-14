/**
 * Katalog tabel yang boleh dijelajahi Gema lewat alat cari_tabel / kueri_data.
 *
 * Ini daftar KURASI, bukan daftar izin: penjaga utamanya tetap hak akses user
 * DB gema_ro. Katalog hanya menentukan tabel mana yang DITAWARKAN ke model.
 * Tabel sensitif (user_totp, push_subscriptions, login_histories, activity_logs,
 * server_*, _migration_history, rollback_*) sengaja tidak masuk.
 */

const t = (domain, deskripsi, sinonim = []) => ({ domain, deskripsi, sinonim });

const KATALOG = {
	// wilayah & profil desa
	kecamatans: t('wilayah', 'daftar kecamatan', ['kecamatan', 'wilayah']),
	desas: t('wilayah', 'daftar desa: status, klasifikasi, tipologi, kecamatan', ['desa', 'status desa', 'tipologi']),
	kelurahan: t('wilayah', 'daftar kelurahan', ['kelurahan']),
	profil_desas: t('wilayah', 'profil desa: penduduk, luas, batas wilayah', ['penduduk', 'profil', 'luas']),

	// aparatur
	aparatur_desa: t('aparatur', 'aparatur desa: nama, jabatan, status, desa', ['kades', 'sekdes', 'perangkat', 'bpd', 'jabatan']),
	aparatur_dapur_desa: t('aparatur', 'aparatur dapur desa', ['dapur']),
	pengurus: t('aparatur', 'pengurus lembaga', ['pengurus', 'ketua']),

	// BUM Desa
	bumdes: t('bumdes', 'BUM Desa: status, badan hukum, aset, omset', ['bum desa', 'bumdes', 'usaha desa']),
	bumdes_produk: t('bumdes', 'produk usaha BUM Desa', ['produk', 'usaha']),
	kerjasama_desa: t('bumdes', 'kerja sama antar desa', ['kerjasama']),
	kerjasama_desa_legalitas: t('bumdes', 'legalitas kerja sama desa', ['legalitas']),

	// kelembagaan
	rts: t('kelembagaan', 'data RT', ['rt', 'rukun tetangga']),
	rws: t('kelembagaan', 'data RW', ['rw', 'rukun warga']),
	posyandus: t('kelembagaan', 'data posyandu', ['posyandu']),
	lpms: t('kelembagaan', 'data LPM', ['lpm']),
	pkks: t('kelembagaan', 'data PKK', ['pkk']),
	karang_tarunas: t('kelembagaan', 'data karang taruna', ['karang taruna', 'pemuda']),
	satlinmas: t('kelembagaan', 'data satlinmas', ['linmas', 'hansip']),
	lembaga_lainnyas: t('kelembagaan', 'lembaga desa lainnya', ['lembaga']),

	// produk hukum
	produk_hukums: t('produk hukum', 'produk hukum desa: perdes, perkades, SK', ['perdes', 'perkades', 'peraturan', 'sk']),
	produk_hukum_bidang: t('produk hukum', 'bidang produk hukum', ['bidang']),
	produk_hukum_referensi: t('produk hukum', 'referensi produk hukum', ['referensi']),

	// bankeu
	bankeu_proposals: t('bankeu', 'proposal bantuan keuangan desa per tahun', ['bankeu', 'proposal', 'bantuan keuangan']),
	bankeu_proposal_kegiatan: t('bankeu', 'kegiatan dalam proposal bankeu', ['kegiatan', 'anggaran']),
	bankeu_master_kegiatan: t('bankeu', 'master kegiatan bankeu', ['master kegiatan']),
	bankeu_verification_questionnaires: t('bankeu', 'kuesioner verifikasi bankeu', ['verifikasi']),
	bankeu_lpj: t('bankeu', 'LPJ bankeu', ['lpj', 'laporan pertanggungjawaban']),
	bantuan_provinsi_lpj: t('bankeu', 'LPJ bantuan provinsi', ['bp', 'bantuan provinsi']),
	tim_verifikasi_kecamatan: t('bankeu', 'tim verifikasi tingkat kecamatan', ['tim verifikasi']),
	kecamatan_bankeu_config: t('bankeu', 'pengaturan bankeu per kecamatan', ['konfigurasi']),

	// penyaluran dana
	pencairan: t('penyaluran dana', 'pencairan dana', ['pencairan', 'penyaluran', 'cair', 'sipanda']),
	pencairan_items: t('penyaluran dana', 'rincian item pencairan', ['rincian']),
	anggaran_pagu: t('penyaluran dana', 'pagu anggaran', ['pagu', 'anggaran']),

	// kepegawaian
	pegawai: t('kepegawaian', 'pegawai DPMD: nama, NIP, jabatan, bidang', ['pegawai', 'nip', 'staf']),
	bidangs: t('kepegawaian', 'bidang di DPMD', ['bidang']),
	perjadin_grup: t('kepegawaian', 'perjalanan dinas (grup)', ['perjadin', 'perjalanan dinas']),
	perjadin_pegawai: t('kepegawaian', 'pegawai peserta perjalanan dinas', ['peserta perjadin']),
	disposisi: t('kepegawaian', 'disposisi surat', ['disposisi']),
	surat_masuk: t('kepegawaian', 'surat masuk', ['surat']),
	absensi_pegawai: t('kepegawaian', 'presensi harian pegawai', ['presensi', 'absen', 'kehadiran']),
	kegiatan: t('kepegawaian', 'kegiatan DPMD', ['agenda']),
	kegiatan_pegawai: t('kepegawaian', 'pegawai pada kegiatan', ['peserta kegiatan']),
};

const GLOSARIUM = {
	DD: 'Dana Desa',
	ADD: 'Alokasi Dana Desa',
	BHPRD: 'Bagi Hasil Pajak dan Retribusi Daerah',
	Bankeu: 'Bantuan Keuangan',
	BP: 'Bantuan Provinsi',
	perjadin: 'perjalanan dinas',
	disposisi: 'arahan pimpinan atas surat masuk',
	TA: 'tahun anggaran',
	SIPANDA: 'sistem informasi penyaluran dana desa',
	'BUM Desa': 'Badan Usaha Milik Desa',
	Kades: 'Kepala Desa',
	Sekdes: 'Sekretaris Desa',
	BPD: 'Badan Permusyawaratan Desa',
	LPM: 'Lembaga Pemberdayaan Masyarakat',
	PKK: 'Pemberdayaan Kesejahteraan Keluarga',
};

/** Teks pendek untuk prompt sistem: tabel per domain + glosarium. */
const ringkasKatalog = () => {
	const perDomain = {};
	for (const [tabel, { domain }] of Object.entries(KATALOG)) (perDomain[domain] ||= []).push(tabel);
	const baris = Object.entries(perDomain).map(([d, ts]) => `${d}: ${ts.join(', ')}`);
	const istilah = Object.entries(GLOSARIUM).map(([k, v]) => `${k} = ${v}`);
	return [...baris, 'Istilah:', ...istilah].join('\n');
};

module.exports = { KATALOG, GLOSARIUM, ringkasKatalog };
