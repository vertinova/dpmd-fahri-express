/**
 * Pencadangan sistem untuk superadmin.
 *
 * Empat jenis, semuanya dialirkan (stream) langsung ke unduhan peramban:
 *   database → .sql hasil mysqldump, tinggal diimpor di localhost
 *   berkas   → .zip berisi dokumen di storage/ (PDF, Office, dsb)
 *   foto     → .zip berisi gambar di storage/
 *   semua    → .zip berisi ketiganya sekaligus
 *
 * Kenapa dialirkan dan tidak ditulis dulu ke berkas sementara: cadangan produksi
 * bisa berukuran giga, dan menuliskannya lebih dulu berarti butuh ruang disk
 * dua kali lipat plus pekerjaan pembersihan kalau prosesnya putus di tengah.
 *
 * Kenapa pakai tiket, bukan header Authorization: unduhan dijalankan peramban
 * lewat navigasi biasa supaya pengguna dapat bilah progres dan berkasnya
 * langsung ditulis ke disk. Navigasi tidak membawa header, jadi izinnya
 * dititipkan pada tiket berumur pendek — lihat buatTiket().
 */

const { spawn } = require('child_process');
const fsp = require('fs/promises');
const path = require('path');
const jwt = require('jsonwebtoken');
const archiver = require('archiver');
const logger = require('../utils/logger');
const ActivityLogger = require('../utils/activityLogger');
const {
  STORAGE_ROOT,
  FOLDER_DILEWATI,
  JENIS_BACKUP,
  adalahFoto,
  bacaKoneksiDatabase,
  jalurMysqldump,
  OPSI_ABAIKAN_KONFIG,
  opsiMysqldumpDidukung,
  periksaMysqldump,
  namaBerkasBackup,
} = require('../config/backup');

const JWT_SECRET = process.env.JWT_SECRET;

// Tiket sengaja berumur sangat pendek. Ia melewati URL, jadi ikut tercatat di
// riwayat peramban dan log proxy — cukup untuk memulai satu unduhan, tidak
// cukup untuk dipakai ulang orang lain esok hari. Unduhan yang sudah berjalan
// tidak terputus saat tiketnya kedaluwarsa; yang diperiksa hanya saat memulai.
const UMUR_TIKET_DETIK = 120;

const LOG_MODULE = 'backup_sistem';

const badRequest = (res, message) => res.status(400).json({ success: false, message });

/**
 * Telusuri storage/ dan kumpulkan berkas sesuai saringan.
 * Mengembalikan jalur absolut + jalur relatif (untuk nama di dalam zip).
 */
const kumpulkanBerkas = async (saring) => {
  const hasil = [];

  const telusuri = async (dirAbsolut, dirRelatif) => {
    let isi;
    try {
      isi = await fsp.readdir(dirAbsolut, { withFileTypes: true });
    } catch {
      return; // folder hilang atau tak terbaca — lewati, jangan gagalkan seluruh backup
    }

    for (const entri of isi) {
      if (entri.isDirectory()) {
        if (FOLDER_DILEWATI.has(entri.name)) continue;
        await telusuri(path.join(dirAbsolut, entri.name), path.posix.join(dirRelatif, entri.name));
        continue;
      }
      if (!entri.isFile()) continue; // symlink/socket tidak ikut
      if (!saring(entri.name)) continue;

      const absolut = path.join(dirAbsolut, entri.name);
      let ukuran = 0;
      try {
        ukuran = (await fsp.stat(absolut)).size;
      } catch {
        continue; // berkas lenyap di tengah penelusuran
      }
      hasil.push({ absolut, relatif: path.posix.join(dirRelatif, entri.name), ukuran });
    }
  };

  await telusuri(STORAGE_ROOT, 'storage');
  return hasil;
};

const formatUkuran = (byte) => {
  if (byte < 1024) return `${byte} B`;
  const satuan = ['KB', 'MB', 'GB', 'TB'];
  let nilai = byte / 1024;
  let i = 0;
  while (nilai >= 1024 && i < satuan.length - 1) {
    nilai /= 1024;
    i += 1;
  }
  return `${nilai.toFixed(nilai >= 100 ? 0 : 1)} ${satuan[i]}`;
};

/**
 * Jalankan mysqldump dan kembalikan prosesnya. Sandi lewat env, bukan argumen.
 *
 * Opsi tambahannya hasil probe (lihat config/backup.js): mysqldump MySQL dan
 * MariaDB tidak mengenal opsi yang sama persis, dan satu opsi asing membuatnya
 * berhenti sebelum mengeluarkan sebaris SQL pun.
 */
const jalankanMysqldump = (koneksi, opsiTambahan) => {
  const argumen = [
    // HARUS pertama — klien MySQL menolak --no-defaults di posisi lain.
    // Lihat OPSI_ABAIKAN_KONFIG di config/backup.js untuk alasannya.
    OPSI_ABAIKAN_KONFIG,
    `--host=${koneksi.host}`,
    `--port=${koneksi.port}`,
    `--user=${koneksi.user}`,
    // --single-transaction: tidak mengunci tabel, aplikasi tetap melayani.
    // --quick: baris dialirkan, tidak ditampung dulu di memori mysqldump.
    // --no-tablespaces: tanpa ini mysqldump 8 menuntut hak PROCESS.
    ...opsiTambahan,
    koneksi.database,
  ];

  // Sandi TIDAK boleh lewat argumen (`-p...`): argumen proses terbaca oleh
  // siapa pun yang bisa menjalankan `ps`/Task Manager di server yang sama.
  // MYSQL_PWD hanya terlihat oleh proses anak ini sendiri.
  const env = { ...process.env };
  if (koneksi.password) env.MYSQL_PWD = koneksi.password;
  else delete env.MYSQL_PWD;

  return spawn(jalurMysqldump(), argumen, { env, windowsHide: true });
};

const catatAksi = (req, jenis, keterangan) => {
  ActivityLogger.log({
    userId: BigInt(String(req.user.id)),
    userName: req.user.name,
    userRole: req.user.role,
    module: LOG_MODULE,
    action: 'download',
    entityType: 'sistem',
    entityId: null,
    entityName: jenis,
    description: keterangan,
    ipAddress: ActivityLogger.getIpFromRequest(req),
    userAgent: ActivityLogger.getUserAgentFromRequest(req),
  }).catch(() => {});
};

class BackupController {
  /**
   * Ringkasan isi cadangan — dipakai halaman superadmin untuk menampilkan
   * berapa banyak dan sebesar apa sebelum tombol unduh ditekan, supaya tidak
   * ada yang menunggu berkas 4 GB tanpa tahu.
   */
  async getRingkasan(req, res) {
    try {
      const [foto, berkas] = await Promise.all([
        kumpulkanBerkas(adalahFoto),
        kumpulkanBerkas((nama) => !adalahFoto(nama)),
      ]);

      const jumlahkan = (daftar) => daftar.reduce((t, f) => t + f.ukuran, 0);
      const ukuranFoto = jumlahkan(foto);
      const ukuranBerkas = jumlahkan(berkas);

      // Kesiapan cadangan basis data butuh DUA syarat, dan keduanya diperiksa
      // di sini — bukan saat tombol ditekan. Unduhan berjalan lewat navigasi
      // peramban, sehingga badan respons galat tidak pernah terbaca JavaScript
      // halaman; tanpa pemeriksaan awal, kegagalan hanya tampak sebagai unduhan
      // yang tidak pernah datang.
      let database;
      try {
        const koneksi = bacaKoneksiDatabase();
        const alat = await periksaMysqldump();
        database = {
          tersedia: alat.tersedia,
          nama: koneksi.database,
          host: koneksi.host,
          mysqldump: alat.versi,
          catatan: alat.catatan,
        };
      } catch (error) {
        // DATABASE_URL sendiri bermasalah — mysqldump tidak relevan lagi.
        database = { tersedia: false, mysqldump: null, catatan: error.message };
      }

      res.json({
        success: true,
        data: {
          database,
          foto: { jumlah: foto.length, ukuran: ukuranFoto, ukuran_teks: formatUkuran(ukuranFoto) },
          berkas: {
            jumlah: berkas.length,
            ukuran: ukuranBerkas,
            ukuran_teks: formatUkuran(ukuranBerkas),
          },
          semua: {
            jumlah: foto.length + berkas.length,
            ukuran: ukuranFoto + ukuranBerkas,
            ukuran_teks: formatUkuran(ukuranFoto + ukuranBerkas),
          },
        },
      });
    } catch (error) {
      logger.error('Gagal menyusun ringkasan backup:', error);
      res.status(500).json({ success: false, message: 'Gagal membaca isi penyimpanan' });
    }
  }

  /**
   * Terbitkan tiket unduhan sekali pakai (berumur pendek).
   *
   * Ini tetap endpoint ber-Authorization biasa, jadi pemeriksaan peran terjadi
   * di sini — bukan di jalur unduhan yang hanya membawa tiket.
   */
  async buatTiket(req, res) {
    const jenis = String(req.body.jenis || '').trim();
    if (!JENIS_BACKUP.includes(jenis)) {
      return badRequest(res, `Jenis backup tidak dikenal. Pilih: ${JENIS_BACKUP.join(', ')}`);
    }

    const tiket = jwt.sign(
      {
        tipe: 'backup',
        jenis,
        uid: String(req.user.id),
        nama: req.user.name,
        email: req.user.email,
        peran: req.user.role,
      },
      JWT_SECRET,
      { expiresIn: UMUR_TIKET_DETIK },
    );

    res.json({ success: true, data: { tiket, jenis, berlaku_detik: UMUR_TIKET_DETIK } });
  }

  /**
   * Alirkan berkas cadangan.
   *
   * Setelah header terkirim, kegagalan TIDAK bisa lagi dijawab dengan JSON —
   * peramban sudah menganggapnya unduhan. Maka setiap penanganan galat di sini
   * memeriksa res.headersSent lebih dulu; kalau sudah terkirim, satu-satunya
   * hal jujur yang bisa dilakukan adalah memutus koneksi supaya berkas separuh
   * jadi tampak rusak, bukan tampak selesai.
   */
  async unduh(req, res) {
    const { jenis } = req.params;
    if (!JENIS_BACKUP.includes(jenis)) return badRequest(res, 'Jenis backup tidak dikenal');

    try {
      if (jenis === 'database') return await this.alirkanDatabase(req, res);
      return await this.alirkanArsip(req, res, jenis);
    } catch (error) {
      logger.error(`Gagal menyiapkan backup ${jenis}:`, error);
      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          message: error.message || 'Gagal menyiapkan berkas cadangan',
        });
      }
      return res.destroy(error);
    }
  }

  /** database → .sql mentah, langsung dari mysqldump. */
  async alirkanDatabase(req, res) {
    const koneksi = bacaKoneksiDatabase();
    const namaBerkas = namaBerkasBackup('database', 'sql');

    const dump = jalankanMysqldump(koneksi, await opsiMysqldumpDidukung());

    // Kumpulkan stderr: kalau mysqldump gagal SEBELUM mengeluarkan sebaris SQL,
    // pesannya inilah satu-satunya keterangan yang berguna bagi pengguna.
    let galat = '';
    dump.stderr.on('data', (potongan) => {
      galat += potongan.toString();
      if (galat.length > 4000) galat = galat.slice(-4000);
    });

    dump.on('error', (error) => {
      logger.error('mysqldump gagal dijalankan:', error.message);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message:
            error.code === 'ENOENT'
              ? 'mysqldump tidak ditemukan di server. Atur MYSQLDUMP_PATH di .env ke lokasi mysqldump.'
              : `mysqldump gagal dijalankan: ${error.message}`,
        });
      } else {
        res.destroy(error);
      }
    });

    // Header baru dipasang setelah byte pertama benar-benar keluar. Kalau
    // dipasang lebih awal, kegagalan mysqldump (sandi salah, database tidak ada)
    // akan terunduh sebagai berkas .sql berisi pesan galat — tampak berhasil.
    let sudahMulai = false;
    dump.stdout.once('data', (potongan) => {
      sudahMulai = true;
      res.setHeader('Content-Type', 'application/sql; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${namaBerkas}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.write(potongan);
      dump.stdout.pipe(res);
    });

    dump.on('close', (kode) => {
      if (kode === 0) {
        if (!sudahMulai && !res.headersSent) {
          // Basis data benar-benar kosong tanpa satu tabel pun.
          res.setHeader('Content-Type', 'application/sql; charset=utf-8');
          res.setHeader('Content-Disposition', `attachment; filename="${namaBerkas}"`);
          res.end('-- Basis data kosong, tidak ada yang dicadangkan.\n');
        }
        logger.info(`✅ Backup database diunduh oleh ${req.user.email}`);
        catatAksi(req, 'database', `${req.user.name} mengunduh cadangan basis data ${koneksi.database}`);
        return;
      }

      logger.error(`mysqldump keluar dengan kode ${kode}: ${galat.trim()}`);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: `mysqldump gagal (kode ${kode}): ${galat.trim().split('\n').pop() || 'tanpa keterangan'}`,
        });
      } else {
        res.destroy(new Error(`mysqldump gagal di tengah jalan (kode ${kode})`));
      }
    });

    // Pengguna membatalkan unduhan: hentikan mysqldump, jangan biarkan ia
    // menghabiskan koneksi basis data untuk hasil yang tak lagi dibaca siapa pun.
    res.on('close', () => {
      if (!dump.killed && dump.exitCode === null) dump.kill();
    });
  }

  /** berkas / foto / semua → .zip. */
  async alirkanArsip(req, res, jenis) {
    const saring =
      jenis === 'foto' ? adalahFoto : jenis === 'berkas' ? (nama) => !adalahFoto(nama) : () => true;

    const daftar = await kumpulkanBerkas(saring);
    const namaBerkas = namaBerkasBackup(jenis, 'zip');

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${namaBerkas}"`);
    res.setHeader('Cache-Control', 'no-store');

    // Level 6: kompresi penuh (9) hampir tidak mengecilkan JPEG/PDF yang sudah
    // terkompresi, tapi memakan CPU server jauh lebih lama.
    const zip = archiver('zip', { zlib: { level: 6 } });

    zip.on('warning', (err) => {
      // ENOENT = berkas terhapus setelah didaftar. Bukan alasan menggagalkan
      // seluruh cadangan; cukup dicatat.
      if (err.code === 'ENOENT') logger.warn(`Backup ${jenis}: berkas hilang saat diarsipkan — ${err.message}`);
      else logger.warn(`Backup ${jenis}: ${err.message}`);
    });

    zip.on('error', (err) => {
      logger.error(`Gagal menyusun arsip ${jenis}:`, err.message);
      res.destroy(err);
    });

    res.on('close', () => {
      if (!res.writableFinished) zip.abort();
    });

    zip.pipe(res);

    for (const berkas of daftar) {
      zip.file(berkas.absolut, { name: berkas.relatif });
    }

    // "semua" ikut membawa dump basis data di dalam zip yang sama, supaya satu
    // unduhan cukup untuk memulihkan seluruh sistem.
    if (jenis === 'semua') {
      try {
        const koneksi = bacaKoneksiDatabase();
        const dump = jalankanMysqldump(koneksi, await opsiMysqldumpDidukung());
        dump.stderr.resume(); // dibuang: galatnya sudah tercermin pada isi .sql yang kosong/terpotong
        dump.on('error', (err) => {
          logger.error(`mysqldump dalam arsip gagal: ${err.message}`);
          zip.abort();
          res.destroy(err);
        });
        res.on('close', () => {
          if (!dump.killed && dump.exitCode === null) dump.kill();
        });
        zip.append(dump.stdout, { name: 'database.sql' });
      } catch (error) {
        // Basis data tak terbaca bukan alasan membatalkan cadangan berkas;
        // sisipkan keterangannya agar yang memulihkan tahu apa yang hilang.
        zip.append(`-- Cadangan basis data gagal dibuat: ${error.message}\n`, {
          name: 'database.sql',
        });
      }
    }

    zip.append(
      [
        'Cara memulihkan di localhost',
        '============================',
        '',
        `Jenis cadangan : ${jenis}`,
        `Dibuat         : ${new Date().toISOString()}`,
        `Oleh           : ${req.user.name} (${req.user.email})`,
        `Jumlah berkas  : ${daftar.length}`,
        '',
        '1. Basis data (bila ada database.sql di arsip ini):',
        '   mysql -u root -p nama_database < database.sql',
        '   Buat dulu basis datanya bila belum ada:',
        '   CREATE DATABASE nama_database CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;',
        '',
        '2. Berkas unggahan:',
        '   Ekstrak arsip ini di folder backend. Isinya sudah memakai struktur',
        '   folder aslinya, jadi folder "storage" akan jatuh tepat di tempatnya.',
        '',
        'Catatan: folder storage/uploads/temp dan storage/hls sengaja tidak ikut —',
        'isinya berkas sementara yang tidak dirujuk basis data.',
        '',
      ].join('\n'),
      { name: 'CARA-RESTORE.txt' },
    );

    await zip.finalize();

    logger.info(`✅ Backup ${jenis} (${daftar.length} berkas) diunduh oleh ${req.user.email}`);
    catatAksi(
      req,
      jenis,
      `${req.user.name} mengunduh cadangan ${jenis} berisi ${daftar.length} berkas`,
    );
  }
}

const controller = new BackupController();

// Metode dipanggil lewat router, sehingga `this` di dalam unduh() akan hilang
// kalau referensinya dilepas dari objeknya. Diikat sekali di sini.
controller.unduh = controller.unduh.bind(controller);
controller.getRingkasan = controller.getRingkasan.bind(controller);
controller.buatTiket = controller.buatTiket.bind(controller);

module.exports = controller;
