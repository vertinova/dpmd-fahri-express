-- Formulir: pembuat formulir mandiri (seperti Google Forms) milik bidang.
--
-- Dipakai untuk survei, pendaftaran kegiatan, dan pengumpulan data dari desa
-- tanpa harus menambah modul baru tiap kali ada kebutuhan pendataan. Satu
-- formulir dibagikan lewat tautan publik; respondennya bisa siapa saja atau
-- dibatasi pengguna yang login, diatur per formulir.
--
-- Semua statement dibungkus IF NOT EXISTS supaya idempoten: runner mengirim
-- file ini sebagai SATU batch, jadi CREATE yang gagal karena objeknya sudah ada
-- akan menghentikan statement di bawahnya.

-- ============================================================
-- 1. Formulir
-- ============================================================
CREATE TABLE IF NOT EXISTS `formulir` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `bidang_id`        BIGINT UNSIGNED NOT NULL,
  `judul`            VARCHAR(255) NOT NULL,
  `deskripsi`        TEXT NULL DEFAULT NULL,
  -- Kunci tautan publik. Sengaja BUKAN id: id berurutan bisa ditebak, sehingga
  -- formulir yang belum diumumkan gampang ditemukan orang yang tidak berhak.
  `token`            CHAR(32) NOT NULL,
  -- draf   : masih disusun, tautan publiknya belum melayani siapa pun.
  -- terbit : menerima respons.
  -- ditutup: tautan tetap hidup tapi hanya menampilkan pesan penutup.
  `status`           ENUM('draf','terbit','ditutup') NOT NULL DEFAULT 'draf',
  -- Responden harus login. Menyalakan ini satu-satunya cara mengetahui secara
  -- pasti siapa yang mengisi — isian nama bisa diisi apa saja.
  `butuh_login`      TINYINT(1) NOT NULL DEFAULT 0,
  -- Satu respons per akun. Hanya berarti bila `butuh_login` menyala: tanpa akun
  -- tidak ada identitas yang bisa dipakai membatasi.
  `satu_respons`     TINYINT(1) NOT NULL DEFAULT 0,
  -- Simpan alamat surel akun pengisi ke dalam respons.
  `kumpulkan_email`  TINYINT(1) NOT NULL DEFAULT 0,
  -- Acak urutan pertanyaan tiap kali formulir dibuka (mengurangi contek massal
  -- pada kuis/penilaian). Bagian dan pemisahnya tetap di tempat.
  `acak_pertanyaan`  TINYINT(1) NOT NULL DEFAULT 0,
  -- Izinkan responden melihat rekap jawaban seluruh responden setelah mengirim.
  `respons_terbuka`  TINYINT(1) NOT NULL DEFAULT 0,
  `pesan_konfirmasi` TEXT NULL DEFAULT NULL,
  -- Penutupan otomatis. Dicek saat formulir dibuka DAN saat respons dikirim,
  -- bukan lewat cron: tidak ada gunanya menutup tepat waktu kalau yang penting
  -- hanyalah menolak respons yang telat.
  `tutup_pada`       DATETIME NULL DEFAULT NULL,
  `batas_respons`    INT UNSIGNED NULL DEFAULT NULL,
  `created_by`       BIGINT UNSIGNED NULL DEFAULT NULL,
  `updated_by`       BIGINT UNSIGNED NULL DEFAULT NULL,
  `created_at`       TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`       TIMESTAMP NULL DEFAULT NULL,
  `deleted_by`       BIGINT UNSIGNED NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_formulir_token` (`token`),
  KEY `idx_formulir_bidang` (`bidang_id`, `deleted_at`),
  KEY `idx_formulir_status` (`status`, `deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 2. Pertanyaan
-- ============================================================
-- `bagian` bukan pertanyaan, melainkan pemisah berjudul. Disimpan di tabel yang
-- sama supaya urutannya ikut satu deret dengan pertanyaan — kalau dipisah ke
-- tabel sendiri, menyisipkan bagian di tengah formulir berarti menomori ulang
-- dua tabel sekaligus.
CREATE TABLE IF NOT EXISTS `formulir_pertanyaan` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `formulir_id` BIGINT UNSIGNED NOT NULL,
  `tipe`        ENUM(
                  'bagian',
                  'jawaban_singkat',
                  'paragraf',
                  'pilihan_ganda',
                  'kotak_centang',
                  'dropdown',
                  'skala_linier',
                  'tanggal',
                  'waktu',
                  'unggah_berkas'
                ) NOT NULL DEFAULT 'jawaban_singkat',
  `label`       VARCHAR(500) NOT NULL,
  `deskripsi`   TEXT NULL DEFAULT NULL,
  `wajib`       TINYINT(1) NOT NULL DEFAULT 0,
  `urutan`      INT NOT NULL DEFAULT 0,
  -- Daftar pilihan untuk pilihan_ganda/kotak_centang/dropdown: ["A","B"].
  `opsi`        JSON NULL DEFAULT NULL,
  -- Setelan khusus per tipe, mis. {"min":1,"maks":5} untuk skala_linier atau
  -- {"validasi":"email"} untuk jawaban_singkat. Ditaruh di JSON, bukan kolom
  -- sendiri-sendiri, karena tiap tipe butuh setelan yang berbeda dan tipe baru
  -- tidak boleh memaksa migrasi kolom lagi.
  `pengaturan`  JSON NULL DEFAULT NULL,
  `created_at`  TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_formulir_pertanyaan_urut` (`formulir_id`, `urutan`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 3. Respons
-- ============================================================
CREATE TABLE IF NOT EXISTS `formulir_respons` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `formulir_id`    BIGINT UNSIGNED NOT NULL,
  -- NULL = responden anonim (formulir tidak mewajibkan login).
  `user_id`        BIGINT UNSIGNED NULL DEFAULT NULL,
  -- Disalin dari akun saat pengiriman. Nama akun bisa berubah di kemudian hari,
  -- sedangkan respons harus tetap mencerminkan keadaan saat diisi.
  `nama_responden` VARCHAR(255) NULL DEFAULT NULL,
  `email`          VARCHAR(255) NULL DEFAULT NULL,
  `ip`             VARCHAR(45) NULL DEFAULT NULL,
  `dikirim_pada`   TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_formulir_respons_form` (`formulir_id`, `dikirim_pada`),
  KEY `idx_formulir_respons_user` (`formulir_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 4. Jawaban
-- ============================================================
-- Satu baris = jawaban satu pertanyaan pada satu respons. Jawaban tunggal
-- masuk `nilai`; jawaban berganda (kotak centang, daftar berkas) masuk
-- `nilai_json`. Dipisah begitu supaya pencarian dan rekap jawaban tunggal —
-- yang jauh lebih sering — tidak perlu membongkar JSON dulu.
CREATE TABLE IF NOT EXISTS `formulir_jawaban` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `respons_id`    BIGINT UNSIGNED NOT NULL,
  `pertanyaan_id` BIGINT UNSIGNED NOT NULL,
  `nilai`         TEXT NULL DEFAULT NULL,
  `nilai_json`    JSON NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_formulir_jawaban` (`respons_id`, `pertanyaan_id`),
  KEY `idx_formulir_jawaban_pertanyaan` (`pertanyaan_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 5. Berkas lampiran jawaban
-- ============================================================
-- Sama seperti Drive: berkasnya di `private/formulir/`, di luar direktori yang
-- disajikan express.static. Lampiran formulir bisa berisi KTP, foto, atau data
-- pribadi lain — kalau ditaruh di `storage/`, siapa pun yang tahu URL-nya bisa
-- mengunduh tanpa login.
CREATE TABLE IF NOT EXISTS `formulir_berkas` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `respons_id`    BIGINT UNSIGNED NOT NULL,
  `pertanyaan_id` BIGINT UNSIGNED NOT NULL,
  `nama`          VARCHAR(255) NOT NULL,
  `mime`          VARCHAR(150) NULL DEFAULT NULL,
  `ukuran`        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  -- Nama acak di disk, bukan nama asli: menghindari tabrakan nama sekaligus
  -- membuat lintasannya tidak bisa ditebak dari luar.
  `nama_disk`     VARCHAR(120) NOT NULL,
  `jalur_disk`    VARCHAR(500) NOT NULL,
  `created_at`    TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_formulir_berkas_disk` (`nama_disk`),
  KEY `idx_formulir_berkas_respons` (`respons_id`, `pertanyaan_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
