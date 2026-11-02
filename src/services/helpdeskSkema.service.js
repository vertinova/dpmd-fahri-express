/**
 * Menyiapkan skema Helpdesk saat server start: menjalankan
 * migrations/20261102_create_helpdesk.sql (semua pernyataannya idempoten) lalu
 * mengisi kategori, FAQ, dan pengaturan awal.
 *
 * Dijalankan di startup — bukan hanya lewat run-migrations — supaya deploy
 * tidak bergantung pada langkah migrasi manual; fitur yang tabelnya belum ada
 * hanya akan membalas 500 tanpa kabar.
 *
 * Kategori & FAQ bawaan HANYA diisi saat tabel masih kosong, supaya yang diubah
 * atau dihapus petugas tidak muncul kembali setiap restart.
 */
const fs = require('fs');
const path = require('path');
const Helpdesk = require('./helpdesk.service');
const logger = require('../utils/logger');

const BERKAS = path.join(__dirname, '..', '..', 'migrations', '20261102_create_helpdesk.sql');

/* [nama, slug, deskripsi, ikon, tingkat awal, bidang, kata kunci] — urutan = urutan tampil.
   Tingkat awal 'kecamatan' dipakai untuk urusan yang memang diverifikasi
   kecamatan lebih dulu; bidangnya menjadi tujuan bila diteruskan. */
const KATEGORI_BAWAAN = [
	['Bantuan Keuangan (Bankeu)', 'bankeu', 'Proposal Bankeu & Bankeu Perubahan, verifikasi, revisi', 'uang', 'kecamatan', 3,
		'bankeu,bantuan keuangan,proposal,bankeu perubahan,verifikasi proposal,surat pengantar,surat permohonan,berita acara,revisi proposal'],
	['Dana Desa, ADD & BHPRD', 'keuangan', 'Penyaluran ADD, Dana Desa, dan BHPRD', 'dompet', 'bidang', 4,
		'dana desa,dd,add,alokasi dana desa,bhprd,bagi hasil,pencairan,penyaluran,earmarked,insentif'],
	['BUMDes', 'bumdes', 'Data BUMDes, produk, dan katalog', 'toko', 'bidang', 3,
		'bumdes,badan usaha milik desa,unit usaha,badan hukum,produk bumdes,katalog,pasar bumdes'],
	['LPJ Bantuan Provinsi', 'banprov', 'Unggah & verifikasi LPJ Bantuan Keuangan Provinsi', 'dokumen', 'bidang', 3,
		'lpj,bantuan provinsi,banprov,laporan pertanggungjawaban,lpj provinsi'],
	['Kerja Sama Desa', 'kerjasama', 'Kerja sama antardesa dan dengan pihak ketiga', 'jabat', 'bidang', 3,
		'kerja sama,kerjasama,antardesa,pihak ketiga,perdes kerja sama'],
	['Kelembagaan Desa', 'kelembagaan', 'RT, RW, LPM, Posyandu, PKK, Karang Taruna & pengurusnya', 'orang', 'kecamatan', 5,
		'kelembagaan,rt,rw,lpm,posyandu,pkk,karang taruna,lembaga desa,pengurus,sk pengurus'],
	['Aparatur Desa', 'aparatur', 'Data perangkat desa, SK jabatan, verifikasi & NIPD', 'lencana', 'kecamatan', 6,
		'aparatur,perangkat desa,kepala desa,kades,sekdes,kaur,kasi,nipd,sk jabatan,sk perangkat,bpd'],
	['Profil & Produk Hukum Desa', 'pemdes', 'Profil desa, perdes, perkades, dan SK kepala desa', 'buku', 'bidang', 6,
		'profil desa,produk hukum,perdes,perkades,peraturan desa,sk kepala desa,data desa'],
	['Akun & Kendala Aplikasi', 'akun', 'Login, kata sandi, hak akses menu, error aplikasi', 'kunci', 'dpmd', 2,
		'login,masuk,password,sandi,lupa,akun,operator,hak akses,menu tidak muncul,error,gagal,tidak bisa,upload,unggah'],
	['Informasi Umum DPMD', 'umum', 'Tentang DPMD, alamat, kontak, dan layanan', 'info', 'dpmd', 2,
		'dpmd,dinas,alamat,kontak,jam layanan,kepala dinas,struktur,informasi,pengaduan'],
];

/* FAQ awal sengaja sedikit dan hanya berisi alur yang memang ada di aplikasi.
   Sisanya diisi petugas dari panel — bot hanya menjawab dari sini, jadi lebih
   baik sedikit tapi benar daripada banyak tapi menebak.
   [slug kategori, pertanyaan, jawaban, kata kunci, audiens, label tombol, tautan] */
const FAQ_BAWAAN = [
	['bankeu', 'Bagaimana alur pengajuan proposal Bantuan Keuangan Perubahan?',
		'Alurnya berjenjang:\n1. Desa mengunggah proposal di menu **Bankeu Perubahan** pada akun desa, lalu mengirimkannya ke kecamatan.\n2. **Kecamatan** memverifikasi proposal. Bila ada catatan, proposal dikembalikan ke desa untuk diperbaiki.\n3. Setelah lolos kecamatan, proposal diteruskan ke **DPMD** untuk diverifikasi.\nTahapan setiap proposal tampil di halaman Bankeu Perubahan akun desa.',
		'alur bankeu,alur proposal,cara ajukan bankeu,cara mengajukan proposal,proses bankeu,tahapan bankeu', 'semua', 'Buka Bankeu Perubahan', '/desa/bankeu-perubahan'],
	['bankeu', 'Proposal Bankeu dikembalikan untuk revisi, apa yang harus dilakukan?',
		'Buka proposal di menu **Bankeu Perubahan** dan baca catatan dari kecamatan atau DPMD. Perbaiki dokumen sesuai catatan, unggah ulang, lalu kirim kembali. Proposal yang sudah diperbaiki akan diperiksa ulang oleh pihak yang mengembalikannya.',
		'proposal revisi,proposal ditolak,dikembalikan,perbaiki proposal,catatan revisi,kirim ulang', 'akun', 'Buka Bankeu Perubahan', '/desa/bankeu-perubahan'],
	['bankeu', 'Di mana masyarakat bisa melihat informasi Bantuan Keuangan desa?',
		'Informasi Bantuan Keuangan desa dapat dilihat di halaman publik **Bantuan Keuangan** dan **Bantuan Keuangan Perubahan** pada situs DPMD, tanpa perlu masuk akun.',
		'informasi bankeu,transparansi,data bantuan keuangan,lihat bankeu,publik', 'semua', 'Lihat Bankeu Perubahan', '/bantuan-keuangan-perubahan'],
	['aparatur', 'Bagaimana alur verifikasi data aparatur desa?',
		'Desa mengisi data aparatur di menu **Aparatur Desa** beserta SK jabatan terakhir. **Bidang Pemerintahan Desa DPMD** memverifikasi setiap data; hasilnya **terverifikasi** atau **perlu perbaikan** dengan catatan per item. Bila perlu perbaikan, lengkapi data atau berkas sesuai catatan lalu simpan kembali. Kecamatan dapat memantau data aparatur desa di wilayahnya.',
		'verifikasi aparatur,alur aparatur,data perangkat,sk jabatan,nipd,perangkat desa ditolak', 'semua', 'Buka Aparatur Desa', '/desa/aparatur-desa'],
	['kelembagaan', 'Bagaimana mendata lembaga desa dan pengurusnya?',
		'Data lembaga desa (RT, RW, LPM, Posyandu, PKK, Karang Taruna, dan lainnya) beserta pengurusnya diisi di menu **Kelembagaan** pada akun desa. SK pengurus diunggah lebih dulu ke menu **Produk Hukum**, lalu ditautkan ke lembaganya. Data kelembagaan diverifikasi oleh kecamatan.',
		'data rt rw,input lembaga,pengurus lembaga,sk pengurus,posyandu,karang taruna,pkk,lpm', 'semua', 'Buka Kelembagaan', '/desa/kelembagaan'],
	['bumdes', 'Bagaimana memperbarui data BUMDes dan produknya?',
		'Data BUMDes diperbarui di menu **BUMDes** pada akun desa. Produk BUMDes dikelola di menu **Katalog BUMDes** dan tampil di halaman publik **Pasar BUMDes**.',
		'update bumdes,data bumdes,produk bumdes,katalog bumdes,pasar bumdes,jual produk', 'semua', 'Lihat Pasar BUMDes', '/pasar-bumdes'],
	['banprov', 'Bagaimana mengunggah LPJ Bantuan Keuangan Provinsi?',
		'LPJ Bantuan Keuangan Provinsi diunggah desa di menu **Bantuan Provinsi LPJ** pada akun desa, lalu diverifikasi oleh Bidang SPKED DPMD. Bila ada catatan, perbaiki dan unggah ulang dari menu yang sama.',
		'upload lpj,unggah lpj,lpj banprov,lpj provinsi,laporan bantuan provinsi', 'akun', 'Buka LPJ Bantuan Provinsi', '/desa/bantuan-provinsi-lpj'],
	['akun', 'Saya lupa kata sandi akun desa/kecamatan, bagaimana cara masuk?',
		'Akun desa dan kecamatan dikelola DPMD. Bila lupa kata sandi, buat **tiket Helpdesk** kategori Akun & Kendala Aplikasi dengan menyebutkan nama desa/kecamatan Anda, dan petugas akan membantu menyetel ulang kata sandi.',
		'lupa password,lupa sandi,reset password,tidak bisa login,tidak bisa masuk,kata sandi salah', 'semua', null, null],
	['akun', 'Menu yang saya butuhkan tidak muncul di akun desa, kenapa?',
		'Menu di akun operator desa mengikuti **hak akses** yang diberikan bidang DPMD sesuai urusannya (misalnya Bankeu dan BUMDes oleh Bidang SPKED, Kelembagaan oleh Bidang PMD, Aparatur dan Produk Hukum oleh Bidang Pemerintahan Desa). Bila menu yang dibutuhkan belum ada, minta bidang terkait menambahkan hak akses akun Anda.',
		'menu tidak muncul,menu hilang,hak akses,akses fitur,operator desa,tidak ada menu', 'akun', null, null],
	['akun', 'Bagaimana kecamatan menambah akun operator untuk petugasnya?',
		'Akun utama kecamatan dapat membuat akun operator untuk petugasnya di menu **Akun Operator**, sekaligus mengatur fitur yang boleh dibuka tiap operator. Dengan begitu setiap verifikasi tercatat atas nama petugasnya dan kata sandi akun utama tidak perlu dibagikan.',
		'akun operator kecamatan,tambah operator,operator kecamatan,petugas kecamatan', 'akun', 'Buka Akun Operator', '/kecamatan/akun-operator'],
	['akun', 'Unggahan dokumen gagal atau koneksi terputus, apa yang harus dilakukan?',
		'Coba langkah berikut:\n1. Gunakan internet yang stabil, sebaiknya Wi-Fi.\n2. Pastikan ukuran dan format berkas sesuai yang diminta di formulir. Perkecil PDF atau foto yang terlalu besar.\n3. Simpan berkas ke penyimpanan perangkat dulu bila dibuka langsung dari WhatsApp atau Google Drive.\n4. Coba browser lain (misalnya Chrome) atau gunakan laptop.\nBila masih gagal, buat tiket Helpdesk dan sebutkan menu serta jam kejadiannya.',
		'gagal upload,upload gagal,gagal unggah,koneksi terputus,tidak bisa upload,error unggah,gagal kirim', 'semua', null, null],
	['umum', 'Bagaimana cara berkomunikasi dengan DPMD dari akun desa?',
		'Selain Helpdesk ini, akun desa dapat memakai menu **Pesan** untuk bercakap dengan DPMD, kecamatan, dan dinas terkait.',
		'chat dpmd,hubungi dpmd,kirim pesan,komunikasi dpmd', 'akun', 'Buka Pesan', '/desa/pesan'],
];

const PENGATURAN_BAWAAN = [
	['salam', 'Halo! Saya asisten Helpdesk DPMD Kabupaten Bogor. Pilih topik atau langsung ketik pertanyaan Anda.'],
	['dpmd_nama', 'DPMD Kabupaten Bogor'],
	['dpmd_whatsapp', ''],
	['dpmd_profil', ''],
];

/** Pernyataan SQL dari berkas migrasi; komentar baris dibuang dulu. */
function pernyataan() {
	return fs.readFileSync(BERKAS, 'utf8')
		.split('\n').filter((b) => !b.trim().startsWith('--')).join('\n')
		.split(';').map((s) => s.trim()).filter(Boolean);
}

async function siapkanHelpdesk() {
	try {
		for (const sql of pernyataan()) await Helpdesk.q(sql);

		for (const [k, v] of PENGATURAN_BAWAAN) {
			await Helpdesk.q('INSERT IGNORE INTO helpdesk_settings (setting_key, setting_value) VALUES (?, ?)', [k, v]);
		}

		const { total } = await Helpdesk.satu('SELECT COUNT(*) AS total FROM helpdesk_categories');
		if (Number(total) === 0) {
			for (const [i, [name, slug, desc, icon, tingkat, bidang, kunci]] of KATEGORI_BAWAAN.entries()) {
				await Helpdesk.q(
					`INSERT INTO helpdesk_categories (name, slug, description, icon, target_level, bidang_id, keywords, sort_order)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
					[name, slug, desc, icon, tingkat, bidang, kunci, i + 1]
				);
			}
			const kategori = await Helpdesk.q('SELECT id, slug FROM helpdesk_categories');
			const idDari = new Map(kategori.map((k) => [k.slug, k.id]));
			for (const [slug, tanya, jawab, kunci, audiens, label, url] of FAQ_BAWAAN) {
				await Helpdesk.q(
					`INSERT INTO helpdesk_faqs (category_id, question, answer, keywords, audience, action_label, action_url)
					 VALUES (?, ?, ?, ?, ?, ?, ?)`,
					[idDari.get(slug), tanya, jawab, kunci, audiens, label, url]
				);
			}
			logger.info(`🛟 Helpdesk: ${KATEGORI_BAWAAN.length} kategori & ${FAQ_BAWAAN.length} FAQ awal diisi`);
		}
		logger.info('🛟 Skema Helpdesk siap');
	} catch (err) {
		logger.error(`🛟 Gagal menyiapkan skema Helpdesk: ${err.message}`);
	}
}

module.exports = { siapkanHelpdesk };
