/**
 * Konfigurasi pencadangan sistem.
 *
 * Tujuannya satu: menghasilkan berkas yang bisa dibawa pulang lalu dipasang
 * ulang di localhost — `.sql` yang tinggal diimpor, dan `.zip` yang tinggal
 * diekstrak ke folder `storage/`. Karena itu struktur di dalam zip sengaja
 * dibuat identik dengan struktur folder aslinya, bukan diratakan.
 */

const path = require('path');

/** Akar seluruh berkas unggahan. Semua backup berkas/foto bersumber dari sini. */
const STORAGE_ROOT = path.join(__dirname, '../../storage');

/**
 * Ekstensi yang dihitung sebagai FOTO.
 *
 * Pemisahan foto dan berkas dilakukan per ekstensi, bukan per folder, karena
 * folder di sini bercampur: `uploads/berita` berisi gambar sekaligus lampiran,
 * dan `uploads/messaging` berisi keduanya. Memisah per folder akan membuat
 * "backup foto" diam-diam membawa PDF, dan sebaliknya.
 */
const EKSTENSI_FOTO = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.heic', '.heif', '.avif', '.ico',
]);

/**
 * Folder di dalam storage yang TIDAK ikut dicadangkan.
 *
 * `temp` berisi sisa unggahan yang gagal atau belum selesai — tidak dirujuk
 * baris mana pun di basis data, jadi memulihkannya tidak ada gunanya dan hanya
 * membengkakkan berkas. `hls` adalah pecahan rekaman video meeting yang
 * dihasilkan ulang oleh sistem.
 */
const FOLDER_DILEWATI = new Set(['temp', 'hls']);

const JENIS_BACKUP = ['database', 'berkas', 'foto', 'semua'];

const adalahFoto = (namaBerkas) => EKSTENSI_FOTO.has(path.extname(namaBerkas).toLowerCase());

/**
 * Baca kredensial basis data dari DATABASE_URL.
 *
 * Sengaja dari DATABASE_URL, bukan dari DB_HOST/DB_USER/DB_PASSWORD yang juga
 * ada di .env: Prisma memakai DATABASE_URL, dan pencadangan yang membaca sumber
 * berbeda dari aplikasinya berisiko mencadangkan basis data yang salah ketika
 * kedua kelompok nilai itu tidak sinkron.
 */
const bacaKoneksiDatabase = () => {
  const mentah = process.env.DATABASE_URL;
  if (!mentah) {
    throw new Error('DATABASE_URL belum diatur, pencadangan basis data tidak dapat dijalankan');
  }

  let url;
  try {
    url = new URL(mentah);
  } catch {
    throw new Error('DATABASE_URL tidak dapat dibaca (format bukan URL yang sah)');
  }

  const namaDatabase = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!namaDatabase) {
    throw new Error('DATABASE_URL tidak menyebutkan nama basis data');
  }

  return {
    host: url.hostname || '127.0.0.1',
    port: url.port || '3306',
    user: decodeURIComponent(url.username || 'root'),
    // Kata sandi kosong itu sah (bawaan Laragon), jadi jangan diganti nilai lain.
    password: url.password ? decodeURIComponent(url.password) : '',
    database: namaDatabase,
  };
};

/**
 * Lokasi mysqldump. Di Windows/Laragon ia tidak ada di PATH, sedangkan di VPS
 * biasanya ada — maka jalurnya bisa ditimpa lewat env tanpa mengubah kode.
 */
const jalurMysqldump = () => process.env.MYSQLDUMP_PATH || 'mysqldump';

/**
 * Opsi mysqldump yang berguna tapi TIDAK ada di semua varian.
 *
 * `--set-gtid-purged` hanya dikenal mysqldump bawaan MySQL; mysqldump bawaan
 * MariaDB menolaknya dengan "unknown option" dan gagal seketika. `--events`,
 * `--no-tablespaces`, dan `--column-statistics` juga berbeda-beda antar versi.
 * Karena server produksi bisa memakai varian mana pun, opsi-opsi ini disaring
 * dulu terhadap keluaran `mysqldump --help` alih-alih dipasang membabi buta.
 */
const OPSI_OPSIONAL = [
  '--single-transaction',
  '--quick',
  '--routines',
  '--triggers',
  '--events',
  '--no-tablespaces',
  '--set-gtid-purged=OFF',
  '--default-character-set=utf8mb4',
];

// Hasil probe dicache: `mysqldump --help` dipanggil sekali per proses, bukan
// setiap kali seseorang menekan tombol unduh.
let cacheOpsiDidukung = null;

const namaOpsi = (opsi) => opsi.split('=')[0];

/**
 * Tanya mysqldump opsi apa saja yang ia kenal, lalu kembalikan hanya yang
 * didukung. Bila probe gagal (mysqldump tidak ada, atau --help tak terbaca),
 * kembalikan daftar paling aman yang dikenal SEMUA varian sejak lama.
 */
const opsiMysqldumpDidukung = async () => {
  if (cacheOpsiDidukung) return cacheOpsiDidukung;

  const { execFile } = require('child_process');
  const bantuan = await new Promise((resolve) => {
    execFile(
      jalurMysqldump(),
      ['--help'],
      { maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => resolve(err && !stdout ? '' : `${stdout || ''}${stderr || ''}`),
    );
  });

  if (!bantuan) {
    // Probe gagal. Jangan menebak: pakai opsi yang sudah ada di MySQL 5.x
    // maupun MariaDB sejak lama. Kalau mysqldump-nya memang tidak ada,
    // kegagalan sebenarnya akan muncul saat dump dijalankan, dengan pesan
    // yang jauh lebih jelas daripada "unknown option".
    cacheOpsiDidukung = ['--single-transaction', '--quick', '--routines', '--triggers'];
    return cacheOpsiDidukung;
  }

  cacheOpsiDidukung = OPSI_OPSIONAL.filter((opsi) => bantuan.includes(namaOpsi(opsi)));
  return cacheOpsiDidukung;
};

/**
 * Periksa apakah mysqldump benar-benar bisa dijalankan, DAN kembalikan versinya.
 *
 * Dipanggil saat halaman backup dibuka, bukan saat tombol ditekan. Alasannya:
 * unduhan berjalan lewat navigasi peramban, sehingga badan respons galat tidak
 * pernah sampai ke JavaScript halaman — kalau mysqldump tidak ada, yang terjadi
 * hanyalah unduhan gagal tanpa keterangan. Memeriksanya di awal membuat
 * penyebabnya terbaca sebelum siapa pun menunggu sia-sia.
 */
const periksaMysqldump = () =>
  new Promise((resolve) => {
    const { execFile } = require('child_process');
    execFile(
      jalurMysqldump(),
      ['--version'],
      { timeout: 10000, windowsHide: true },
      (err, stdout, stderr) => {
        if (!err) {
          return resolve({ tersedia: true, versi: String(stdout || stderr).trim(), catatan: null });
        }
        const takAda = err.code === 'ENOENT';
        resolve({
          tersedia: false,
          versi: null,
          catatan: takAda
            ? `mysqldump tidak ditemukan di "${jalurMysqldump()}". Pasang klien MySQL/MariaDB di server, lalu isi MYSQLDUMP_PATH di .env dengan jalur lengkapnya.`
            : `mysqldump tidak dapat dijalankan: ${err.message}`,
        });
      },
    );
  });

/**
 * Nama berkas unduhan: jenis + stempel waktu.
 *
 * Waktunya waktu LOKAL server, bukan UTC. Nama berkas dibaca manusia yang baru
 * saja menekan tombol unduh, dan stempel yang meleset tujuh jam dari jam
 * dinding membuat orang ragu apakah yang terunduh cadangan hari ini atau
 * cadangan lama. Urutannya tetap benar karena formatnya menurun dari tahun.
 */
const namaBerkasBackup = (jenis, ekstensi) => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const waktu =
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
  return `dpmd-${jenis}-${waktu}.${ekstensi}`;
};

module.exports = {
  STORAGE_ROOT,
  EKSTENSI_FOTO,
  FOLDER_DILEWATI,
  JENIS_BACKUP,
  adalahFoto,
  bacaKoneksiDatabase,
  jalurMysqldump,
  opsiMysqldumpDidukung,
  periksaMysqldump,
  namaBerkasBackup,
};
