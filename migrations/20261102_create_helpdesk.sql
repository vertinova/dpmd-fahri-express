-- Helpdesk DPMD: chatbot FAQ + AI, tiket, dan penerusan ke penanggung jawab.
--
-- Pertanyaan masyarakat, operator desa, dan kecamatan dijawab bot dari FAQ dan
-- data resmi. Yang belum terjawab menjadi tiket untuk penanggung jawab menurut
-- kategori: kecamatan penanya -> bidang DPMD -> DPMD (sekretariat/pimpinan).
--
-- Berkas ini juga dijalankan otomatis saat server start
-- (src/services/helpdeskSkema.service.js), jadi setiap pernyataan WAJIB
-- idempoten. Kategori dan FAQ awal diisi dari sana, bukan dari sini.

CREATE TABLE IF NOT EXISTS helpdesk_categories (
  id INT NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  description VARCHAR(255) NULL,
  icon VARCHAR(40) NOT NULL DEFAULT 'tanya',
  target_level ENUM('kecamatan','bidang','dpmd') NOT NULL DEFAULT 'dpmd',
  bidang_id INT NULL COMMENT 'Bidang penanggung jawab, untuk tingkat kecamatan = tujuan bila diteruskan',
  keywords VARCHAR(500) NULL COMMENT 'Kata kunci dipisah koma, membantu menebak kategori',
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_helpdesk_kat_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- audience: 'semua' tampil ke siapa saja, 'publik' hanya tamu, 'akun' hanya
-- akun yang login (desa/kecamatan) — supaya jawaban internal tidak bocor.
CREATE TABLE IF NOT EXISTS helpdesk_faqs (
  id INT NOT NULL AUTO_INCREMENT,
  category_id INT NOT NULL,
  question VARCHAR(500) NOT NULL,
  answer TEXT NOT NULL,
  keywords VARCHAR(500) NULL,
  audience ENUM('semua','publik','akun') NOT NULL DEFAULT 'semua',
  action_label VARCHAR(60) NULL COMMENT 'Teks tombol aksi di bawah jawaban',
  action_url VARCHAR(255) NULL COMMENT 'Jalur internal (/...) atau https://',
  hits INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  updated_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_helpdesk_faq_kat (category_id, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- target_level/bidang_id/kecamatan_id adalah tujuan SETELAH dialihkan (mis.
-- kecamatan belum punya akun -> naik ke bidang), jadi yang tersimpan selalu
-- pihak yang benar-benar menerima tiket.
CREATE TABLE IF NOT EXISTS helpdesk_tickets (
  id INT NOT NULL AUTO_INCREMENT,
  code VARCHAR(20) NOT NULL,
  category_id INT NULL,
  target_level ENUM('kecamatan','bidang','dpmd') NOT NULL,
  bidang_id INT NULL,
  kecamatan_id INT NULL,
  desa_id BIGINT UNSIGNED NULL,
  user_id BIGINT UNSIGNED NULL COMMENT 'NULL = tamu',
  reporter_name VARCHAR(150) NOT NULL,
  reporter_whatsapp VARCHAR(20) NULL,
  subject VARCHAR(255) NOT NULL,
  status ENUM('baru','diproses','dijawab','selesai') NOT NULL DEFAULT 'baru',
  priority ENUM('normal','tinggi') NOT NULL DEFAULT 'normal',
  handled_by BIGINT UNSIGNED NULL,
  first_response_at DATETIME NULL COMMENT 'Balasan petugas pertama — dasar statistik waktu tanggap',
  rating TINYINT NULL COMMENT 'Penilaian pelapor 1-5',
  rating_note VARCHAR(500) NULL,
  last_message_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reminded_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_helpdesk_ticket_code (code),
  KEY idx_helpdesk_ticket_tujuan (target_level, bidang_id, kecamatan_id, status),
  KEY idx_helpdesk_ticket_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS helpdesk_messages (
  id INT NOT NULL AUTO_INCREMENT,
  ticket_id INT NOT NULL,
  sender_type ENUM('pelapor','petugas','bot','sistem') NOT NULL,
  sender_id BIGINT UNSIGNED NULL,
  sender_name VARCHAR(150) NULL,
  body TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_helpdesk_msg_ticket (ticket_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Jejak pertanyaan ke bot. Yang tidak terjawab / dinilai tidak membantu
-- menjadi bahan petugas menambah FAQ — cara bot makin tepat.
CREATE TABLE IF NOT EXISTS helpdesk_chat_logs (
  id INT NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NULL,
  category_id INT NULL,
  question VARCHAR(1000) NOT NULL,
  answered TINYINT(1) NOT NULL DEFAULT 0,
  source ENUM('ai','faq','akun','data','none') NOT NULL DEFAULT 'none',
  faq_id INT NULL,
  helpful TINYINT(1) NULL COMMENT '1 membantu, 0 tidak, NULL belum dinilai',
  reviewed TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_helpdesk_log_review (answered, reviewed, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS helpdesk_settings (
  setting_key VARCHAR(60) NOT NULL,
  setting_value TEXT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
