/**
 * Ingatan percakapan Gema.
 *
 * MASALAH YANG DIPECAHKAN BERKAS INI. Sebelumnya tiap pertanyaan dikirim ke
 * model sebagai percakapan baru — satu pesan, tanpa apa pun sebelumnya. Model
 * jadi tidak punya cara menjawab "kalau yang maju berapa?", "siapa kepala
 * desanya?", atau "bandingkan dengan Jonggol", karena "yang", "nya", dan
 * "bandingkan" merujuk ke sesuatu yang sudah dibuang. Setiap kalimat harus
 * ditulis lengkap dari nol, dan itu persis lawan dari mengobrol.
 *
 * Yang disimpan BUKAN cuma teksnya, melainkan seluruh larik pesan yang dipakai
 * model — termasuk blok tool_use dan tool_result. Itu penting: model jadi ingat
 * ALAT MANA yang sudah ia panggil dan APA hasilnya, sehingga pertanyaan
 * lanjutan bisa dijawab tanpa mengulang pencarian yang sama, dan angka yang
 * disebut di giliran kedua tetap angka yang sama dengan giliran pertama.
 *
 * DI MEMORI, BUKAN DI BASIS DATA. Percakapan suara berumur menit, bukan hari;
 * menuliskannya ke tabel hanya menambah beban tulis untuk data yang tidak
 * pernah dibaca lagi. Konsekuensinya jujur: server yang di-restart melupakan
 * semua percakapan, dan pada penyebaran banyak proses tiap proses punya
 * ingatannya sendiri. Untuk purwarupa satu proses ini, itu pertukaran yang
 * benar.
 *
 * KUNCINYA GABUNGAN id pengguna dan id sesi dari peramban. Bukan id sesi saja:
 * kalau begitu, id yang tertebak orang lain akan membuka percakapan milik
 * pengguna lain. Dengan id pengguna ikut jadi kunci, percakapan tidak pernah
 * bisa menyeberang antar akun.
 */

const logger = require('../utils/logger');

/** Percakapan dilupakan setelah sekian lama tidak disentuh. */
const UMUR_MS = 30 * 60 * 1000;

/**
 * Berapa GILIRAN PENGGUNA terakhir yang dipertahankan.
 *
 * Dipotong per giliran, bukan per pesan, karena satu giliran bisa berisi
 * beberapa pesan yang tidak boleh terpisah: blok tool_use di pesan asisten
 * WAJIB diikuti tool_result di pesan berikutnya. Memotong di tengah pasangan
 * itu membuat API menolak seluruh permintaan.
 */
const GILIRAN_DISIMPAN = 10;

/** Batas jumlah percakapan hidup, supaya memori tidak tumbuh tanpa batas. */
const MAKS_PERCAKAPAN = 500;

const simpanan = new Map();

const kunciDari = (idPengguna, sesi) => `${idPengguna || 'tanpa-id'}::${sesi || 'tanpa-sesi'}`;

/** Buang percakapan yang sudah lewat umurnya. */
const sapu = () => {
	const batas = Date.now() - UMUR_MS;
	for (const [kunci, isi] of simpanan) {
		if (isi.sentuh < batas) simpanan.delete(kunci);
	}

	// Masih terlalu banyak walau yang basi sudah dibuang — buang yang paling
	// lama tidak disentuh sampai muat.
	if (simpanan.size <= MAKS_PERCAKAPAN) return;
	const urut = [...simpanan.entries()].sort((a, b) => a[1].sentuh - b[1].sentuh);
	for (const [kunci] of urut.slice(0, simpanan.size - MAKS_PERCAKAPAN)) {
		simpanan.delete(kunci);
	}
};

/**
 * Apakah pesan ini awal sebuah giliran pengguna?
 *
 * Giliran pengguna yang sebenarnya berisi teks biasa. Pesan peran 'user' yang
 * isinya blok tool_result BUKAN giliran baru — itu balasan alat di tengah
 * giliran yang sama, dan memotong di situ akan memisahkannya dari tool_use
 * pasangannya.
 */
const awalGiliran = (pesan) => {
	if (!pesan || pesan.role !== 'user') return false;
	if (typeof pesan.content === 'string') return true;
	if (!Array.isArray(pesan.content)) return false;
	return pesan.content.every((b) => b?.type === 'text');
};

/** Sisakan beberapa giliran terakhir saja, dipotong tepat di batas giliran. */
const pangkas = (pesan) => {
	const awal = [];
	pesan.forEach((p, i) => { if (awalGiliran(p)) awal.push(i); });
	if (awal.length <= GILIRAN_DISIMPAN) return pesan;
	return pesan.slice(awal[awal.length - GILIRAN_DISIMPAN]);
};

/** Ambil riwayat pesan sebuah sesi. Selalu larik — kosong bila belum ada. */
const ambil = (idPengguna, sesi) => {
	if (!sesi) return [];
	const isi = simpanan.get(kunciDari(idPengguna, sesi));
	if (!isi) return [];
	if (Date.now() - isi.sentuh > UMUR_MS) {
		simpanan.delete(kunciDari(idPengguna, sesi));
		return [];
	}
	isi.sentuh = Date.now();
	return isi.pesan;
};

/** Simpan riwayat pesan hasil satu giliran. */
const simpan = (idPengguna, sesi, pesan) => {
	if (!sesi || !Array.isArray(pesan) || !pesan.length) return;
	sapu();
	simpanan.set(kunciDari(idPengguna, sesi), {
		pesan: pangkas(pesan),
		sentuh: Date.now(),
	});
};

/** Lupakan satu percakapan — dipakai tombol "mulai percakapan baru". */
const lupakan = (idPengguna, sesi) => {
	if (!sesi) return false;
	return simpanan.delete(kunciDari(idPengguna, sesi));
};

/**
 * Berapa giliran yang sudah tersimpan di sesi ini.
 *
 * Dipakai halaman depan untuk memberi tahu pengguna bahwa Gema masih ingat
 * konteks sebelumnya — dan supaya tombol "mulai baru" tidak muncul percuma.
 */
const jumlahGiliran = (idPengguna, sesi) => ambil(idPengguna, sesi).filter(awalGiliran).length;

/** Dipanggil saat proses dimatikan; sekadar catatan, tidak ada yang perlu ditutup. */
const ringkasan = () => ({ percakapan_hidup: simpanan.size });

// Sapu berkala supaya percakapan yang ditinggalkan tidak menetap sampai ada
// permintaan berikutnya. unref() supaya penjadwal ini tidak menahan proses
// Node keluar saat server dihentikan.
const jam = setInterval(() => {
	try { sapu(); } catch (e) { logger.error('Gema: gagal menyapu percakapan:', e.message); }
}, 5 * 60 * 1000);
jam.unref?.();

module.exports = { ambil, simpan, lupakan, jumlahGiliran, ringkasan, UMUR_MS, GILIRAN_DISIMPAN };
