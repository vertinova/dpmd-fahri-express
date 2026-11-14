/**
 * Konfigurasi pencadangan sistem.
 *
 * Tujuannya satu: menghasilkan berkas yang bisa dibawa pulang lalu dipasang
 * ulang di localhost — `.sql` yang tinggal diimpor, dan `.zip` yang tinggal
 * diekstrak ke folder `storage/`. Karena itu struktur di dalam zip sengaja
 * dibuat identik dengan struktur folder aslinya, bukan diratakan.
 */

const path = require('path');

/** Nama alat dump yang dipakai, untuk pesan galat/petunjuk. */
const NAMA_ALAT_DUMP = 'pg_dump';
/** Petunjuk impor berkas database.sql. */
const PERINTAH_IMPOR = 'psql -U postgres nama_database < database.sql';

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
    port: url.port || '5432',
    user: decodeURIComponent(url.username || 'root'),
    // Kata sandi kosong itu sah (bawaan Laragon), jadi jangan diganti nilai lain.
    password: url.password ? decodeURIComponent(url.password) : '',
    database: namaDatabase,
  };
};

/**
 * Lokasi pg_dump. Di Windows/Laragon ia tidak ada di PATH, sedangkan di VPS
 * biasanya ada — maka jalurnya bisa ditimpa lewat env tanpa mengubah kode.
 */
const jalurPgDump = () => process.env.PG_DUMP_PATH || 'pg_dump';

/** Argumen pg_dump (PostgreSQL). Sandi lewat PGPASSWORD (lihat envPgDump), bukan argumen. */
const argumenPgDump = (k) => ['-h', k.host, '-p', String(k.port), '-U', k.user, '-w', '--no-owner', '--no-privileges', '-Fp', k.database];

/** Env proses pg_dump: sandi hanya terlihat oleh proses anak. */
const envPgDump = (k) => {
  const env = { ...process.env };
  if (k.password) env.PGPASSWORD = k.password;
  else delete env.PGPASSWORD;
  return env;
};

/**
 * Periksa apakah pg_dump benar-benar bisa dijalankan, DAN kembalikan versinya.
 *
 * Dipanggil saat halaman backup dibuka, bukan saat tombol ditekan. Alasannya:
 * unduhan berjalan lewat navigasi peramban, sehingga badan respons galat tidak
 * pernah sampai ke JavaScript halaman — kalau pg_dump tidak ada, yang terjadi
 * hanyalah unduhan gagal tanpa keterangan. Memeriksanya di awal membuat
 * penyebabnya terbaca sebelum siapa pun menunggu sia-sia.
 */
const periksaPgDump = () =>
  new Promise((resolve) => {
    const { execFile } = require('child_process');
    execFile(
      jalurPgDump(),
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
            ? `pg_dump tidak ditemukan di "${jalurPgDump()}". Pasang klien PostgreSQL di server, lalu isi PG_DUMP_PATH di .env dengan jalur lengkapnya.`
            : `pg_dump tidak dapat dijalankan: ${err.message}`,
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
  jalurPgDump,
  argumenPgDump,
  envPgDump,
  NAMA_ALAT_DUMP,
  PERINTAH_IMPOR,
  periksaPgDump,
  namaBerkasBackup,
};
