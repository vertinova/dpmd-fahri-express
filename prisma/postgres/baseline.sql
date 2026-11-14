-- Baseline PostgreSQL DPMD. DIBANGKITKAN oleh scripts/pg/buat-skema-pg.js; jangan disunting tangan.
-- (a) citext + operator citext/text (spike E4)
CREATE EXTENSION IF NOT EXISTS citext;
CREATE FUNCTION citext_eq_text(citext, text) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS 'SELECT $1 = $2::citext';
CREATE FUNCTION text_eq_citext(text, citext) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS 'SELECT $1::citext = $2';
CREATE FUNCTION citext_ne_text(citext, text) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS 'SELECT $1 <> $2::citext';
CREATE OPERATOR = (LEFTARG = citext, RIGHTARG = text, FUNCTION = citext_eq_text, COMMUTATOR = =, NEGATOR = <>, RESTRICT = eqsel, JOIN = eqjoinsel);
CREATE OPERATOR = (LEFTARG = text, RIGHTARG = citext, FUNCTION = text_eq_citext, COMMUTATOR = =, RESTRICT = eqsel, JOIN = eqjoinsel);
CREATE OPERATOR <> (LEFTARG = citext, RIGHTARG = text, FUNCTION = citext_ne_text, NEGATOR = =, RESTRICT = neqsel, JOIN = neqjoinsel);

-- (b) fungsi trigger pengganti ON UPDATE CURRENT_TIMESTAMP (dibuat per nama kolom pada bagian (f))
CREATE FUNCTION set_ran_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.*) IS DISTINCT FROM ROW(OLD.*)
     AND NEW."ran_at" IS NOT DISTINCT FROM OLD."ran_at" THEN
    NEW."ran_at" := CURRENT_TIMESTAMP;
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.*) IS DISTINCT FROM ROW(OLD.*)
     AND NEW."updated_at" IS NOT DISTINCT FROM OLD."updated_at" THEN
    NEW."updated_at" := CURRENT_TIMESTAMP;
  END IF;
  RETURN NEW;
END $$;

-- (c) DDL Prisma (prisma migrate diff --from-empty)
-- CreateEnum
CREATE TYPE "bankeu_perubahan_proposal_versions_source" AS ENUM ('initial', 'revision');

-- CreateEnum
CREATE TYPE "bankeu_perubahan_revisions_decision" AS ENUM ('revision', 'rejected');

-- CreateEnum
CREATE TYPE "anggaran_jenis_sht" AS ENUM ('SSH', 'SBU', 'ASB', 'HSPK', 'Lainnya');

-- CreateEnum
CREATE TYPE "pegawai_jenis_kelamin" AS ENUM ('L', 'P');

-- CreateEnum
CREATE TYPE "pegawai_status_kepegawaian" AS ENUM ('PNS', 'PPPK', 'PPPK Paruh Waktu', 'Honorer', 'THL', 'Kontrak', 'Tenaga Alih Daya', 'Tenaga Keamanan', 'Tenaga Kebersihan');

-- CreateEnum
CREATE TYPE "absensi_pegawai_status" AS ENUM ('hadir', 'izin', 'sakit', 'alpha', 'cuti', 'dinas_luar', 'wfh', 'wfa');

-- CreateEnum
CREATE TYPE "lembaga_lainnyas_status_kelembagaan" AS ENUM ('aktif', 'nonaktif');

-- CreateEnum
CREATE TYPE "lembaga_lainnyas_status_verifikasi" AS ENUM ('verified', 'unverified', 'ditolak');

-- CreateEnum
CREATE TYPE "bankeu_master_kegiatan_jenis_kegiatan" AS ENUM ('infrastruktur', 'non_infrastruktur');

-- CreateEnum
CREATE TYPE "pejabat_ttd_jenis_pejabat" AS ENUM ('camat', 'tim_verifikasi');

-- CreateEnum
CREATE TYPE "perjadin_grup_jenis_tujuan" AS ENUM ('desa', 'instansi', 'luar_daerah', 'lainnya');

-- CreateEnum
CREATE TYPE "bankeu_verification_questionnaires_verifikasi_type" AS ENUM ('kecamatan', 'dinas', 'kecamatan_tim');

-- CreateEnum
CREATE TYPE "desas_status_pemerintahan" AS ENUM ('desa', 'kelurahan');

-- CreateEnum
CREATE TYPE "karang_tarunas_status_kelembagaan" AS ENUM ('aktif', 'nonaktif');

-- CreateEnum
CREATE TYPE "lpms_status_kelembagaan" AS ENUM ('aktif', 'nonaktif');

-- CreateEnum
CREATE TYPE "pkks_status_kelembagaan" AS ENUM ('aktif', 'nonaktif');

-- CreateEnum
CREATE TYPE "posyandus_status_kelembagaan" AS ENUM ('aktif', 'nonaktif');

-- CreateEnum
CREATE TYPE "rws_status_kelembagaan" AS ENUM ('aktif', 'nonaktif');

-- CreateEnum
CREATE TYPE "satlinmas_status_kelembagaan" AS ENUM ('aktif', 'nonaktif');

-- CreateEnum
CREATE TYPE "karang_tarunas_status_verifikasi" AS ENUM ('verified', 'unverified', 'ditolak');

-- CreateEnum
CREATE TYPE "lpms_status_verifikasi" AS ENUM ('verified', 'unverified', 'ditolak');

-- CreateEnum
CREATE TYPE "pkks_status_verifikasi" AS ENUM ('verified', 'unverified', 'ditolak');

-- CreateEnum
CREATE TYPE "posyandus_status_verifikasi" AS ENUM ('verified', 'unverified', 'ditolak');

-- CreateEnum
CREATE TYPE "rts_status_kelembagaan" AS ENUM ('aktif', 'nonaktif');

-- CreateEnum
CREATE TYPE "rws_status_verifikasi" AS ENUM ('verified', 'unverified', 'ditolak');

-- CreateEnum
CREATE TYPE "satlinmas_status_verifikasi" AS ENUM ('verified', 'unverified', 'ditolak');

-- CreateEnum
CREATE TYPE "berita_kategori" AS ENUM ('umum', 'bumdes', 'perjadin', 'musdesus', 'pengumuman');

-- CreateEnum
CREATE TYPE "bumdes_status" AS ENUM ('aktif', 'tidak aktif');

-- CreateEnum
CREATE TYPE "disposisi_status" AS ENUM ('pending', 'dibaca', 'proses', 'selesai', 'teruskan', 'ditarik');

-- CreateEnum
CREATE TYPE "rts_status_verifikasi" AS ENUM ('verified', 'unverified', 'ditolak');

-- CreateEnum
CREATE TYPE "surat_masuk_jenis_surat" AS ENUM ('biasa', 'penting', 'segera', 'rahasia');

-- CreateEnum
CREATE TYPE "berita_status" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "desa_bankeu_surat_kecamatan_status" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "pengurus_status_jabatan" AS ENUM ('aktif', 'selesai', 'nonaktif');

-- CreateEnum
CREATE TYPE "produk_hukums_jenis" AS ENUM ('Peraturan Desa', 'Peraturan Kepala Desa', 'Keputusan Kepala Desa', 'Keputusan Camat');

-- CreateEnum
CREATE TYPE "aparatur_desa_jenis_kelamin" AS ENUM ('Laki-laki', 'Perempuan');

-- CreateEnum
CREATE TYPE "pengurus_status_verifikasi" AS ENUM ('verified', 'unverified', 'ditolak');

-- CreateEnum
CREATE TYPE "produk_hukums_singkatan_jenis" AS ENUM ('PERDES', 'PERKADES', 'SK KADES', 'SK CAMAT');

-- CreateEnum
CREATE TYPE "surat_masuk_status" AS ENUM ('draft', 'dikirim', 'selesai');

-- CreateEnum
CREATE TYPE "jadwal_kegiatan_status" AS ENUM ('draft', 'pending', 'approved', 'rejected', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "jadwal_kegiatan_prioritas" AS ENUM ('rendah', 'sedang', 'tinggi', 'urgent');

-- CreateEnum
CREATE TYPE "jadwal_kegiatan_kategori" AS ENUM ('rapat', 'pelatihan', 'monitoring', 'kunjungan', 'acara', 'lainnya');

-- CreateEnum
CREATE TYPE "produk_hukums_status_peraturan" AS ENUM ('berlaku', 'dicabut');

-- CreateEnum
CREATE TYPE "pengurus_jenis_kelamin" AS ENUM ('Laki-laki', 'Perempuan');

-- CreateEnum
CREATE TYPE "bankeu_proposals_status" AS ENUM ('pending', 'verified', 'rejected', 'revision');

-- CreateEnum
CREATE TYPE "bankeu_proposals_dinas_status" AS ENUM ('pending', 'in_review', 'approved', 'rejected', 'revision');

-- CreateEnum
CREATE TYPE "aparatur_desa_status" AS ENUM ('Aktif', 'Tidak Aktif');

-- CreateEnum
CREATE TYPE "bankeu_proposals_kecamatan_status" AS ENUM ('pending', 'in_review', 'approved', 'rejected', 'revision');

-- CreateEnum
CREATE TYPE "bankeu_proposals_dpmd_status" AS ENUM ('pending', 'in_review', 'approved', 'rejected', 'revision');

-- CreateEnum
CREATE TYPE "bankeu_lpj_status" AS ENUM ('pending', 'approved', 'rejected', 'revision');

-- CreateEnum
CREATE TYPE "bantuan_provinsi_lpj_status" AS ENUM ('pending', 'approved', 'rejected', 'revision');

-- CreateEnum
CREATE TYPE "bankeu_perubahan_master_kegiatan_kategori" AS ENUM ('wajib', 'pilihan_infrastruktur', 'pilihan_non_infrastruktur');

-- CreateEnum
CREATE TYPE "bankeu_perubahan_proposals_jenis_kegiatan" AS ENUM ('wajib', 'pilihan_infrastruktur', 'pilihan_non_infrastruktur');

-- CreateEnum
CREATE TYPE "bankeu_perubahan_proposals_status" AS ENUM ('pending', 'verified', 'rejected', 'revision', 'draft');

-- CreateEnum
CREATE TYPE "bankeu_perubahan_proposals_kecamatan_status" AS ENUM ('pending', 'in_review', 'approved', 'rejected', 'revision');

-- CreateEnum
CREATE TYPE "bankeu_perubahan_proposals_dpmd_status" AS ENUM ('pending', 'in_review', 'approved', 'rejected', 'revision');

-- CreateEnum
CREATE TYPE "bankeu_perubahan_lpj_status" AS ENUM ('pending', 'verified', 'rejected', 'revision');

-- CreateEnum
CREATE TYPE "bankeu_verification_questionnaires_overall_recommendation" AS ENUM ('disetujui', 'ditolak', 'revisi', 'layak', 'tidak_layak');

-- CreateEnum
CREATE TYPE "bankeu_verification_questionnaires_status" AS ENUM ('draft', 'submitted');

-- CreateEnum
CREATE TYPE "perjadin_pegawai_status" AS ENUM ('draft', 'diajukan', 'disetujui', 'ditolak', 'selesai');

-- CreateEnum
CREATE TYPE "berita_acara_history_status" AS ENUM ('active', 'superseded', 'revoked');

-- CreateEnum
CREATE TYPE "video_meeting_chats_message_type" AS ENUM ('text', 'file', 'system');

-- CreateEnum
CREATE TYPE "video_meeting_invitations_status" AS ENUM ('pending', 'accepted', 'declined');

-- CreateEnum
CREATE TYPE "video_meeting_participants_role" AS ENUM ('host', 'co-host', 'participant');

-- CreateEnum
CREATE TYPE "video_meeting_recordings_status" AS ENUM ('recording', 'processing', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "video_meetings_status" AS ENUM ('scheduled', 'active', 'ended', 'cancelled');

-- CreateEnum
CREATE TYPE "conversation_participants_role" AS ENUM ('admin', 'member');

-- CreateEnum
CREATE TYPE "conversations_type" AS ENUM ('dpmd_desa', 'dinas_desa', 'kecamatan_desa', 'dpmd_dinas', 'dpmd_kecamatan', 'dpmd_internal', 'group');

-- CreateEnum
CREATE TYPE "conversations_reference_type" AS ENUM ('bankeu_lpj', 'bankeu_proposal', 'bantuan_provinsi_lpj', 'helpdesk');

-- CreateEnum
CREATE TYPE "messages_message_type" AS ENUM ('text', 'file', 'image', 'system', 'status_reply');

-- CreateEnum
CREATE TYPE "pencairan_jenis_pencairan" AS ENUM ('atk', 'cetak', 'makmin', 'perjadin', 'jasa', 'hibah', 'lainnya');

-- CreateEnum
CREATE TYPE "pencairan_pemeriksa_peran" AS ENUM ('ketua', 'anggota');

-- CreateEnum
CREATE TYPE "pencairan_items_status_pemeriksaan" AS ENUM ('baik', 'kurang_baik');

-- CreateEnum
CREATE TYPE "pencairan_status" AS ENUM ('draft', 'finalized', 'cancelled');

-- CreateEnum
CREATE TYPE "arsip_barang_mutasi_jenis" AS ENUM ('lokasi', 'kondisi', 'pemegang', 'status', 'lainnya');

-- CreateEnum
CREATE TYPE "arsip_barang_scan_log_source" AS ENUM ('public', 'internal');

-- CreateEnum
CREATE TYPE "arsip_barang_kondisi" AS ENUM ('baik', 'kurang_baik', 'rusak_ringan', 'rusak_berat');

-- CreateEnum
CREATE TYPE "arsip_barang_sumber_dana" AS ENUM ('apbd', 'apbn', 'hibah', 'lainnya');

-- CreateEnum
CREATE TYPE "arsip_barang_status" AS ENUM ('aktif', 'dihapuskan');

-- CreateEnum
CREATE TYPE "drive_share_objek_tipe" AS ENUM ('folder', 'file');

-- CreateEnum
CREATE TYPE "drive_share_penerima_tipe" AS ENUM ('bidang', 'user');

-- CreateEnum
CREATE TYPE "drive_share_izin" AS ENUM ('lihat', 'ubah');

-- CreateEnum
CREATE TYPE "video_desa_kiriman_proses" AS ENUM ('antre', 'diproses', 'siap', 'gagal');

-- CreateEnum
CREATE TYPE "video_desa_permintaan_status" AS ENUM ('dibuka', 'ditutup');

-- CreateEnum
CREATE TYPE "video_desa_permintaan_orientasi" AS ENUM ('bebas', 'lanskap', 'potret');

-- CreateEnum
CREATE TYPE "video_desa_kiriman_status" AS ENUM ('masuk', 'disetujui', 'ditolak');

-- CreateEnum
CREATE TYPE "formulir_status" AS ENUM ('draf', 'terbit', 'ditutup');

-- CreateEnum
CREATE TYPE "formulir_pertanyaan_tipe" AS ENUM ('bagian', 'jawaban_singkat', 'paragraf', 'pilihan_ganda', 'kotak_centang', 'dropdown', 'skala_linier', 'tanggal', 'waktu', 'unggah_berkas');

-- CreateEnum
CREATE TYPE "produk_hukum_bidang_status_peraturan" AS ENUM ('berlaku', 'diubah', 'dicabut');

-- CreateEnum
CREATE TYPE "produk_hukum_referensi_tingkat" AS ENUM ('nasional', 'provinsi', 'kabupaten');

-- CreateEnum
CREATE TYPE "produk_hukum_referensi_status_peraturan" AS ENUM ('berlaku', 'diubah', 'dicabut');

-- CreateEnum
CREATE TYPE "kerjasama_desa_jenis" AS ENUM ('antar_desa', 'pihak_ketiga');

-- CreateEnum
CREATE TYPE "kerjasama_desa_bidang" AS ENUM ('penyelenggaraan_pemerintahan', 'pelaksanaan_pembangunan', 'pembinaan_kemasyarakatan', 'pemberdayaan_masyarakat');

-- CreateEnum
CREATE TYPE "cctv_camera_status" AS ENUM ('active', 'inactive', 'maintenance', 'offline');

-- CreateEnum
CREATE TYPE "cctv_event_type" AS ENUM ('known', 'unknown', 'fall', 'fall_warning', 'immobility', 'other', 'person');

-- CreateEnum
CREATE TYPE "cctv_event_severity" AS ENUM ('info', 'warning', 'critical');

-- CreateEnum
CREATE TYPE "cctv_event_status" AS ENUM ('active', 'acknowledged', 'resolved');

-- CreateTable
CREATE TABLE "aparatur_desa_logs" (
    "id" BIGSERIAL NOT NULL,
    "aparatur_id" CITEXT NOT NULL,
    "aksi" CITEXT NOT NULL,
    "keterangan" CITEXT,
    "oleh_id" BIGINT,
    "oleh_nama" CITEXT,
    "oleh_peran" CITEXT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aparatur_desa_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "user_name" CITEXT,
    "user_role" CITEXT,
    "bidang_id" BIGINT,
    "module" CITEXT NOT NULL,
    "action" CITEXT NOT NULL,
    "entity_type" CITEXT NOT NULL,
    "entity_id" BIGINT,
    "entity_name" CITEXT,
    "description" CITEXT NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "ip_address" CITEXT,
    "user_agent" CITEXT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_histories" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "ip_address" CITEXT,
    "user_agent" CITEXT,
    "device_id" CITEXT,
    "device_type" CITEXT,
    "browser" CITEXT,
    "os" CITEXT,
    "status" CITEXT NOT NULL DEFAULT 'success',
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),

    CONSTRAINT "login_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aparatur_desa" (
    "id" CITEXT NOT NULL,
    "desa_id" BIGINT NOT NULL,
    "nama_lengkap" CITEXT NOT NULL,
    "jabatan" CITEXT NOT NULL,
    "nipd" CITEXT,
    "niap" CITEXT,
    "nik" CITEXT,
    "whatsapp" CITEXT,
    "tempat_lahir" CITEXT NOT NULL,
    "tanggal_lahir" DATE NOT NULL,
    "tanggal_lahir_taksiran" BOOLEAN NOT NULL DEFAULT false,
    "jenis_kelamin" "aparatur_desa_jenis_kelamin" NOT NULL,
    "pendidikan_terakhir" CITEXT NOT NULL,
    "agama" CITEXT NOT NULL,
    "pangkat_golongan" CITEXT,
    "tanggal_pengangkatan" DATE NOT NULL,
    "nomor_sk_pengangkatan" CITEXT NOT NULL,
    "tanggal_pemberhentian" DATE,
    "nomor_sk_pemberhentian" CITEXT,
    "keterangan" CITEXT,
    "status" "aparatur_desa_status" NOT NULL DEFAULT 'Aktif',
    "sumber_data" CITEXT NOT NULL DEFAULT 'desa',
    "dapur_id" INTEGER,
    "produk_hukum_id" CITEXT,
    "bpjs_kesehatan_nomor" CITEXT,
    "bpjs_ketenagakerjaan_nomor" CITEXT,
    "file_bpjs_kesehatan" CITEXT,
    "file_bpjs_ketenagakerjaan" CITEXT,
    "file_pas_foto" CITEXT,
    "file_ktp" CITEXT,
    "file_kk" CITEXT,
    "file_akta_kelahiran" CITEXT,
    "file_ijazah_terakhir" CITEXT,
    "file_sk_terakhir" CITEXT,
    "status_verifikasi" CITEXT,
    "dpmd_verified_at" TIMESTAMP(0),
    "dpmd_verified_by" BIGINT,
    "catatan_verifikasi" CITEXT,
    "verifikasi_item" JSONB,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "aparatur_desa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aparatur_dapur_desa" (
    "id" BIGSERIAL NOT NULL,
    "dapur_id" INTEGER NOT NULL,
    "desa_id" BIGINT,
    "kode_desa" CITEXT,
    "kode_kecamatan" CITEXT,
    "nama_desa_sumber" CITEXT,
    "nama_kecamatan_sumber" CITEXT,
    "nama" CITEXT NOT NULL,
    "nama_normal" CITEXT NOT NULL,
    "jabatan" CITEXT,
    "jenis_kelamin" CITEXT,
    "usia" INTEGER,
    "agama" CITEXT,
    "status_kawin" CITEXT,
    "status_pns" CITEXT,
    "pendidikan" CITEXT,
    "no_sk" CITEXT,
    "tgl_sk" DATE,
    "no_sk_pertama" CITEXT,
    "tgl_sk_pertama" DATE,
    "tahun_lulus" CITEXT,
    "foto_url" CITEXT,
    "foto_lokal" CITEXT,
    "status_rekonsiliasi" CITEXT NOT NULL DEFAULT 'baru',
    "aparatur_desa_id" CITEXT,
    "keputusan" CITEXT,
    "diputuskan_oleh" BIGINT,
    "diputuskan_pada" TIMESTAMP(0),
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aparatur_dapur_desa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "id" SERIAL NOT NULL,
    "setting_key" CITEXT NOT NULL,
    "setting_value" CITEXT NOT NULL,
    "description" CITEXT,
    "updated_by_user_id" BIGINT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bankeu_master_kegiatan" (
    "id" SMALLSERIAL NOT NULL,
    "jenis_kegiatan" "bankeu_master_kegiatan_jenis_kegiatan" NOT NULL,
    "urutan" SMALLINT NOT NULL,
    "nama_kegiatan" CITEXT NOT NULL,
    "dinas_terkait" CITEXT,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bankeu_master_kegiatan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bankeu_proposal_2025" (
    "id" BIGSERIAL NOT NULL,
    "desa_id" BIGINT NOT NULL,
    "tahun_anggaran" INTEGER NOT NULL DEFAULT 2025,
    "nama_file" CITEXT NOT NULL,
    "file_path" CITEXT NOT NULL,
    "file_size" INTEGER,
    "keterangan" CITEXT,
    "uploaded_by" BIGINT NOT NULL,
    "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bankeu_proposal_2025_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bankeu_proposal_kegiatan" (
    "id" BIGSERIAL NOT NULL,
    "proposal_id" BIGINT NOT NULL,
    "kegiatan_id" SMALLINT NOT NULL,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bankeu_proposal_kegiatan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bankeu_lpj" (
    "id" BIGSERIAL NOT NULL,
    "desa_id" BIGINT NOT NULL,
    "tahun_anggaran" INTEGER NOT NULL DEFAULT 2025,
    "nama_file" CITEXT NOT NULL,
    "file_path" CITEXT NOT NULL,
    "file_size" INTEGER,
    "keterangan" CITEXT,
    "uploaded_by" BIGINT NOT NULL,
    "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dpmd_catatan" CITEXT,
    "dpmd_verified_at" TIMESTAMP(0),
    "dpmd_verified_by" BIGINT,
    "status" "bankeu_lpj_status" NOT NULL DEFAULT 'pending',

    CONSTRAINT "bankeu_lpj_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bankeu_lpj_video" (
    "id" BIGSERIAL NOT NULL,
    "desa_id" BIGINT NOT NULL,
    "tahun_anggaran" INTEGER NOT NULL,
    "dayeuh_pajajaran" JSONB NOT NULL,
    "infrastruktur" JSONB NOT NULL,
    "updated_by" BIGINT NOT NULL,
    "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bankeu_lpj_video_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bankeu_lpj_sts" (
    "id" BIGSERIAL NOT NULL,
    "desa_id" BIGINT NOT NULL,
    "tahun_anggaran" INTEGER NOT NULL,
    "nominal" BIGINT NOT NULL,
    "tanggal_setor" DATE NOT NULL,
    "nama_file" CITEXT NOT NULL,
    "file_path" CITEXT NOT NULL,
    "file_size" INTEGER,
    "uploaded_by" BIGINT NOT NULL,
    "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bankeu_lpj_sts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bantuan_provinsi_lpj" (
    "id" BIGSERIAL NOT NULL,
    "desa_id" BIGINT NOT NULL,
    "tahun_anggaran" INTEGER NOT NULL DEFAULT 2026,
    "nama_file" CITEXT NOT NULL,
    "file_path" CITEXT NOT NULL,
    "file_size" INTEGER,
    "keterangan" CITEXT,
    "status" "bantuan_provinsi_lpj_status" NOT NULL DEFAULT 'pending',
    "dpmd_catatan" CITEXT,
    "dpmd_verified_by" BIGINT,
    "dpmd_verified_at" TIMESTAMP(0),
    "uploaded_by" BIGINT NOT NULL,
    "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bantuan_provinsi_lpj_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bankeu_proposals" (
    "id" BIGSERIAL NOT NULL,
    "desa_id" BIGINT NOT NULL,
    "kegiatan_id" SMALLINT,
    "judul_proposal" CITEXT NOT NULL,
    "nama_kegiatan_spesifik" CITEXT,
    "volume" CITEXT,
    "lokasi" CITEXT,
    "deskripsi" CITEXT,
    "file_proposal" CITEXT NOT NULL,
    "surat_pengantar" CITEXT,
    "surat_permohonan" CITEXT,
    "dinas_reviewed_file" CITEXT,
    "dinas_reviewed_at" TIMESTAMP(0),
    "file_size" INTEGER,
    "anggaran_usulan" DECIMAL(15,2),
    "status" "bankeu_proposals_status" DEFAULT 'pending',
    "dinas_status" "bankeu_proposals_dinas_status",
    "submitted_to_dinas_at" TIMESTAMP(0),
    "dinas_verified_at" TIMESTAMP(0),
    "dinas_verified_by" INTEGER,
    "dinas_catatan" CITEXT,
    "kecamatan_status" "bankeu_proposals_kecamatan_status",
    "kecamatan_catatan" CITEXT,
    "kecamatan_verified_at" TIMESTAMP(0),
    "kecamatan_verified_by" BIGINT,
    "dpmd_status" "bankeu_proposals_dpmd_status",
    "dpmd_catatan" CITEXT,
    "dpmd_verified_at" TIMESTAMP(0),
    "dpmd_verified_by" BIGINT,
    "submitted_to_kecamatan" BOOLEAN DEFAULT false,
    "submitted_at" TIMESTAMP(0),
    "submitted_to_dpmd" BOOLEAN DEFAULT false,
    "submitted_to_dpmd_at" TIMESTAMP(0),
    "catatan_verifikasi" CITEXT,
    "verified_by" BIGINT,
    "verified_at" TIMESTAMP(0),
    "berita_acara_path" CITEXT,
    "berita_acara_generated_at" TIMESTAMP(0),
    "created_by" BIGINT NOT NULL,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "tahun_anggaran" INTEGER NOT NULL DEFAULT 2026,
    "troubleshoot_catatan" CITEXT,
    "troubleshoot_by" BIGINT,
    "troubleshoot_at" TIMESTAMP(0),

    CONSTRAINT "bankeu_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bankeu_verification_questionnaires" (
    "id" BIGSERIAL NOT NULL,
    "proposal_id" BIGINT NOT NULL,
    "tim_verifikasi_id" BIGINT,
    "verifikasi_type" "bankeu_verification_questionnaires_verifikasi_type" DEFAULT 'kecamatan',
    "dinas_id" INTEGER,
    "q1" BOOLEAN,
    "q2" BOOLEAN,
    "q3" BOOLEAN,
    "q4" BOOLEAN,
    "q5" BOOLEAN,
    "q6" BOOLEAN,
    "q7" BOOLEAN,
    "q8" BOOLEAN,
    "q9" BOOLEAN,
    "q10" BOOLEAN,
    "q11" BOOLEAN,
    "q12" BOOLEAN,
    "q13" BOOLEAN,
    "q1_keterangan" CITEXT,
    "q2_keterangan" CITEXT,
    "q3_keterangan" CITEXT,
    "q4_keterangan" CITEXT,
    "q5_keterangan" CITEXT,
    "q6_keterangan" CITEXT,
    "q7_keterangan" CITEXT,
    "q8_keterangan" CITEXT,
    "q9_keterangan" CITEXT,
    "q10_keterangan" CITEXT,
    "q11_keterangan" CITEXT,
    "q12_keterangan" CITEXT,
    "q13_keterangan" CITEXT,
    "overall_recommendation" "bankeu_verification_questionnaires_overall_recommendation",
    "overall_notes" CITEXT,
    "status" "bankeu_verification_questionnaires_status" NOT NULL DEFAULT 'draft',
    "submitted_at" TIMESTAMP(0),
    "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bankeu_verification_questionnaires_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bankeu_perubahan_master_kegiatan" (
    "id" SMALLSERIAL NOT NULL,
    "kategori" "bankeu_perubahan_master_kegiatan_kategori" NOT NULL,
    "urutan" SMALLINT NOT NULL,
    "nama_kegiatan" CITEXT NOT NULL,
    "deskripsi" CITEXT,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bankeu_perubahan_master_kegiatan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bankeu_perubahan_proposal_kegiatan" (
    "id" BIGSERIAL NOT NULL,
    "proposal_id" BIGINT NOT NULL,
    "kegiatan_id" SMALLINT NOT NULL,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bankeu_perubahan_proposal_kegiatan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bankeu_perubahan_proposals" (
    "id" BIGSERIAL NOT NULL,
    "desa_id" BIGINT NOT NULL,
    "kecamatan_id" BIGINT NOT NULL,
    "tahun_anggaran" INTEGER NOT NULL DEFAULT 2026,
    "jenis_kegiatan" "bankeu_perubahan_proposals_jenis_kegiatan" NOT NULL,
    "kegiatan_id" SMALLINT,
    "kegiatan_nama" CITEXT,
    "nama_kegiatan_spesifik" CITEXT,
    "volume" CITEXT,
    "lokasi" CITEXT,
    "judul_proposal" CITEXT NOT NULL,
    "deskripsi" CITEXT,
    "file_proposal" CITEXT NOT NULL,
    "file_size" INTEGER,
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "latest_revision_id" BIGINT,
    "kecamatan_annotation_draft" JSONB,
    "anggaran_usulan" DECIMAL(15,2),
    "status" "bankeu_perubahan_proposals_status" DEFAULT 'draft',
    "kecamatan_status" "bankeu_perubahan_proposals_kecamatan_status" DEFAULT 'pending',
    "kecamatan_catatan" CITEXT,
    "kecamatan_verified_by" BIGINT,
    "kecamatan_verified_at" TIMESTAMP(0),
    "dpmd_status" "bankeu_perubahan_proposals_dpmd_status" DEFAULT 'pending',
    "dpmd_catatan" CITEXT,
    "dpmd_verified_by" BIGINT,
    "dpmd_verified_at" TIMESTAMP(0),
    "submitted_to_kecamatan" BOOLEAN DEFAULT false,
    "submitted_at" TIMESTAMP(0),
    "submitted_to_dpmd" BOOLEAN DEFAULT false,
    "submitted_to_dpmd_at" TIMESTAMP(0),
    "surat_pengantar" CITEXT,
    "surat_permohonan" CITEXT,
    "berita_acara_path" CITEXT,
    "berita_acara_generated_at" TIMESTAMP(0),
    "berita_acara_qr_code" CITEXT,
    "berita_acara_version" INTEGER DEFAULT 1,
    "surat_pengantar_kecamatan_path" CITEXT,
    "surat_pengantar_kecamatan_nomor" CITEXT,
    "surat_pengantar_kecamatan_generated_at" TIMESTAMP(0),
    "quisioner_completed" BOOLEAN DEFAULT false,
    "catatan_verifikasi" CITEXT,
    "troubleshoot_catatan" CITEXT,
    "troubleshoot_by" BIGINT,
    "troubleshoot_at" TIMESTAMP(0),
    "verified_by" BIGINT,
    "verified_at" TIMESTAMP(0),
    "created_by" BIGINT NOT NULL,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bankeu_perubahan_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bankeu_perubahan_proposal_versions" (
    "id" BIGSERIAL NOT NULL,
    "proposal_id" BIGINT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "file_proposal" CITEXT NOT NULL,
    "file_size" INTEGER,
    "source" "bankeu_perubahan_proposal_versions_source" NOT NULL DEFAULT 'initial',
    "uploaded_by" BIGINT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bankeu_perubahan_proposal_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bankeu_perubahan_revisions" (
    "id" BIGSERIAL NOT NULL,
    "proposal_id" BIGINT NOT NULL,
    "version_id" BIGINT NOT NULL,
    "round_number" INTEGER NOT NULL,
    "annotation_data" JSONB,
    "annotated_pdf_path" CITEXT,
    "catatan" CITEXT,
    "decision" "bankeu_perubahan_revisions_decision" NOT NULL DEFAULT 'revision',
    "annotated_by" BIGINT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bankeu_perubahan_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kecamatan_bankeu_perubahan_config" (
    "id" BIGSERIAL NOT NULL,
    "kecamatan_id" BIGINT NOT NULL,
    "nama_camat" CITEXT NOT NULL,
    "nip_camat" CITEXT,
    "jabatan_penandatangan" CITEXT NOT NULL DEFAULT 'Camat',
    "logo_path" CITEXT,
    "ttd_camat_path" CITEXT,
    "stempel_path" CITEXT,
    "alamat" CITEXT,
    "telepon" CITEXT,
    "email" CITEXT,
    "website" CITEXT,
    "kode_pos" CITEXT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kecamatan_bankeu_perubahan_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tim_verifikasi_bankeu_perubahan" (
    "id" BIGSERIAL NOT NULL,
    "kecamatan_id" BIGINT NOT NULL,
    "proposal_id" BIGINT,
    "jabatan" CITEXT NOT NULL,
    "jabatan_label" CITEXT,
    "nama" CITEXT NOT NULL,
    "nip" CITEXT,
    "ttd_path" CITEXT,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tim_verifikasi_bankeu_perubahan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bankeu_perubahan_questionnaires" (
    "id" BIGSERIAL NOT NULL,
    "proposal_id" BIGINT NOT NULL,
    "tim_verifikasi_id" BIGINT,
    "verifikasi_type" CITEXT NOT NULL DEFAULT 'kecamatan_tim',
    "q1" BOOLEAN,
    "q2" BOOLEAN,
    "q3" BOOLEAN,
    "q4" BOOLEAN,
    "q5" BOOLEAN,
    "q6" BOOLEAN,
    "q7" BOOLEAN,
    "q8" BOOLEAN,
    "q9" BOOLEAN,
    "q10" BOOLEAN,
    "q11" BOOLEAN,
    "q12" BOOLEAN,
    "overall_notes" CITEXT,
    "status" CITEXT NOT NULL DEFAULT 'draft',
    "submitted_at" TIMESTAMP(0),
    "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bankeu_perubahan_questionnaires_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bankeu_perubahan_lpj" (
    "id" BIGSERIAL NOT NULL,
    "desa_id" BIGINT NOT NULL,
    "tahun_anggaran" INTEGER NOT NULL DEFAULT 2026,
    "nama_file" CITEXT NOT NULL,
    "file_path" CITEXT NOT NULL,
    "file_size" INTEGER,
    "keterangan" CITEXT,
    "status" "bankeu_perubahan_lpj_status" NOT NULL DEFAULT 'pending',
    "dpmd_catatan" CITEXT,
    "dpmd_verified_by" BIGINT,
    "dpmd_verified_at" TIMESTAMP(0),
    "uploaded_by" BIGINT NOT NULL,
    "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bankeu_perubahan_lpj_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "berita" (
    "id_berita" SERIAL NOT NULL,
    "judul" CITEXT NOT NULL,
    "slug" CITEXT NOT NULL,
    "konten" CITEXT NOT NULL,
    "ringkasan" CITEXT,
    "gambar" CITEXT,
    "dokumen_pdf" CITEXT,
    "kategori" "berita_kategori" DEFAULT 'umum',
    "status" "berita_status" DEFAULT 'draft',
    "tanggal_publish" TIMESTAMP(0),
    "penulis" CITEXT,
    "views" INTEGER DEFAULT 0,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "berita_pkey" PRIMARY KEY ("id_berita")
);

-- CreateTable
CREATE TABLE "informasi" (
    "id" SERIAL NOT NULL,
    "judul" CITEXT NOT NULL,
    "deskripsi" CITEXT,
    "gambar" CITEXT NOT NULL,
    "link" CITEXT,
    "urutan" SMALLINT NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "informasi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bidangs" (
    "id" BIGSERIAL NOT NULL,
    "nama" CITEXT NOT NULL,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "bidangs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anggaran_bidang_units" (
    "id" BIGSERIAL NOT NULL,
    "bidang_id" BIGINT NOT NULL,
    "nama" CITEXT NOT NULL,
    "kode" CITEXT,
    "urutan" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anggaran_bidang_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anggaran_master_kegiatan" (
    "id" BIGSERIAL NOT NULL,
    "bidang_id" BIGINT NOT NULL,
    "bidang_unit_id" BIGINT,
    "kode_program" CITEXT,
    "nama_program" CITEXT NOT NULL,
    "kode_kegiatan" CITEXT,
    "nama_kegiatan" CITEXT NOT NULL,
    "kode_sub_kegiatan" CITEXT,
    "nama_sub_kegiatan" CITEXT,
    "id_giat" INTEGER,
    "id_sub_giat" INTEGER,
    "urutan" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" BIGINT NOT NULL,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anggaran_master_kegiatan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anggaran_pagu" (
    "id" BIGSERIAL NOT NULL,
    "master_kegiatan_id" BIGINT NOT NULL,
    "tahun" INTEGER NOT NULL,
    "pagu" DECIMAL(20,2) NOT NULL DEFAULT 0.00,
    "pagu_indikatif" DECIMAL(20,2) DEFAULT 0.00,
    "created_by" BIGINT NOT NULL,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anggaran_pagu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rekening_ref" (
    "id" BIGSERIAL NOT NULL,
    "kode_rekening" CITEXT NOT NULL,
    "nama" CITEXT NOT NULL,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rekening_ref_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anggaran_kas" (
    "id" BIGSERIAL NOT NULL,
    "pagu_id" BIGINT NOT NULL,
    "kode_rekening" CITEXT NOT NULL DEFAULT '',
    "m1" DECIMAL(20,2) NOT NULL DEFAULT 0.00,
    "m2" DECIMAL(20,2) NOT NULL DEFAULT 0.00,
    "m3" DECIMAL(20,2) NOT NULL DEFAULT 0.00,
    "m4" DECIMAL(20,2) NOT NULL DEFAULT 0.00,
    "m5" DECIMAL(20,2) NOT NULL DEFAULT 0.00,
    "m6" DECIMAL(20,2) NOT NULL DEFAULT 0.00,
    "m7" DECIMAL(20,2) NOT NULL DEFAULT 0.00,
    "m8" DECIMAL(20,2) NOT NULL DEFAULT 0.00,
    "m9" DECIMAL(20,2) NOT NULL DEFAULT 0.00,
    "m10" DECIMAL(20,2) NOT NULL DEFAULT 0.00,
    "m11" DECIMAL(20,2) NOT NULL DEFAULT 0.00,
    "m12" DECIMAL(20,2) NOT NULL DEFAULT 0.00,
    "keterangan" CITEXT,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anggaran_kas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anggaran_rka_items" (
    "id" BIGSERIAL NOT NULL,
    "pagu_id" BIGINT NOT NULL,
    "nama_item" CITEXT NOT NULL,
    "kode_rekening" CITEXT,
    "satuan" CITEXT NOT NULL,
    "volume" DECIMAL(15,4) NOT NULL DEFAULT 1.0000,
    "harga_satuan" DECIMAL(20,2) NOT NULL DEFAULT 0.00,
    "jenis_sht" "anggaran_jenis_sht" NOT NULL DEFAULT 'SSH',
    "kode_sht" CITEXT,
    "keterangan" CITEXT,
    "koefisien" CITEXT,
    "grup" CITEXT,
    "urutan" INTEGER NOT NULL DEFAULT 1,
    "created_by" BIGINT NOT NULL,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anggaran_rka_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bumdes" (
    "id" SERIAL NOT NULL,
    "desa_id" INTEGER,
    "kode_desa" CITEXT,
    "kecamatan" CITEXT,
    "desa" CITEXT,
    "namabumdesa" CITEXT NOT NULL,
    "status" "bumdes_status" NOT NULL DEFAULT 'aktif',
    "keterangan_tidak_aktif" CITEXT,
    "NIB" CITEXT,
    "LKPP" CITEXT,
    "NPWP" CITEXT,
    "badanhukum" CITEXT,
    "NamaPenasihat" CITEXT,
    "JenisKelaminPenasihat" CITEXT,
    "HPPenasihat" CITEXT,
    "NamaPengawas" CITEXT,
    "JenisKelaminPengawas" CITEXT,
    "HPPengawas" CITEXT,
    "NamaDirektur" CITEXT,
    "JenisKelaminDirektur" CITEXT,
    "HPDirektur" CITEXT,
    "NamaSekretaris" CITEXT,
    "JenisKelaminSekretaris" CITEXT,
    "HPSekretaris" CITEXT,
    "NamaBendahara" CITEXT,
    "JenisKelaminBendahara" CITEXT,
    "HPBendahara" CITEXT,
    "TahunPendirian" CITEXT,
    "AlamatBumdesa" CITEXT,
    "Alamatemail" CITEXT,
    "TotalTenagaKerja" INTEGER,
    "TelfonBumdes" CITEXT,
    "JenisUsaha" CITEXT,
    "JenisUsahaUtama" CITEXT,
    "JenisUsahaLainnya" CITEXT,
    "Omset2023" DECIMAL(15,2),
    "Laba2023" DECIMAL(15,2),
    "Omset2024" DECIMAL(15,2),
    "Laba2024" DECIMAL(15,2),
    "PenyertaanModal2019" DECIMAL(15,2),
    "PenyertaanModal2020" DECIMAL(15,2),
    "PenyertaanModal2021" DECIMAL(15,2),
    "PenyertaanModal2022" DECIMAL(15,2),
    "PenyertaanModal2023" DECIMAL(15,2),
    "PenyertaanModal2024" DECIMAL(15,2),
    "SumberLain" DECIMAL(15,2),
    "JenisAset" CITEXT,
    "NilaiAset" DECIMAL(15,2),
    "KerjasamaPihakKetiga" CITEXT,
    "TahunMulai-TahunBerakhir" CITEXT,
    "KontribusiTerhadapPADes2021" DECIMAL(15,2),
    "KontribusiTerhadapPADes2022" DECIMAL(15,2),
    "KontribusiTerhadapPADes2023" DECIMAL(15,2),
    "KontribusiTerhadapPADes2024" DECIMAL(15,2),
    "Ketapang2024" CITEXT,
    "Ketapang2025" CITEXT,
    "BantuanKementrian" CITEXT,
    "BantuanLaptopShopee" CITEXT,
    "NomorPerdes" CITEXT,
    "DesaWisata" CITEXT,
    "LaporanKeuangan2021" CITEXT,
    "LaporanKeuangan2022" CITEXT,
    "LaporanKeuangan2023" CITEXT,
    "LaporanKeuangan2024" CITEXT,
    "Perdes" CITEXT,
    "produk_hukum_perdes_id" CITEXT,
    "ProfilBUMDesa" CITEXT,
    "BeritaAcara" CITEXT,
    "AnggaranDasar" CITEXT,
    "AnggaranRumahTangga" CITEXT,
    "ProgramKerja" CITEXT,
    "SK_BUM_Desa" CITEXT,
    "produk_hukum_sk_bumdes_id" CITEXT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),
    "Status2024" CITEXT,
    "KeteranganTidakAktif2024" CITEXT,
    "Pemeringkatan2022" CITEXT,
    "NilaiPemeringkatan2022" CITEXT,
    "Pemeringkatan2023" CITEXT,
    "NilaiPemeringkatan2023" CITEXT,
    "Pemeringkatan2024" CITEXT,
    "KetPemeringkatan2024" CITEXT,
    "Pemeringkatan2024Sem1" CITEXT,
    "PemeringkatanApp2023" CITEXT,
    "EvaluasiRPJMN2024" CITEXT,
    "PemeringkatanApp2024" CITEXT,
    "Pemeringkatan2026" CITEXT,
    "StatusBadanHukum2026" CITEXT,
    "StatusBadanHukum2026Feb" CITEXT,
    "StatusBadanHukum2025Pembinaan" CITEXT,
    "StatusBadanHukum2025" CITEXT,
    "StatusBadanHukum2024" CITEXT,
    "StatusBadanHukum2023" CITEXT,
    "StatusBadanHukum2022" CITEXT,
    "NamaStafLainnya" CITEXT,
    "JenisKelaminStafLainnya" CITEXT,
    "HPStafLainnya" CITEXT,
    "JenisUsaha2021" CITEXT,
    "JenisUsahaKetahananPangan" CITEXT,
    "KeteranganUsahaKetahananPangan" CITEXT,
    "VolumeKetahananPangan" CITEXT,
    "AnggaranModalKetahananPangan" DECIMAL(15,2),
    "Omset2024Sem1" DECIMAL(15,2),
    "Laba2024Sem1" DECIMAL(15,2),
    "Omset2025" DECIMAL(15,2),
    "Laba2025" DECIMAL(15,2),
    "PenganggaranPenyertaanModal2025" DECIMAL(15,2),
    "PenyertaanModalTPKK" DECIMAL(15,2),
    "TotalRealisasiPenyertaanModal20192025" DECIMAL(15,2),
    "JumlahModalAwal" DECIMAL(15,2),
    "KontribusiTerhadapPADes2025" DECIMAL(15,2),
    "KontribusiKemitraanPADes2024" DECIMAL(15,2),
    "KontribusiKemitraanPADes2025" DECIMAL(15,2),
    "DesaWisataStatus" CITEXT,
    "PeranMBG" CITEXT,
    "MekanismeKerjaSamaMBG" CITEXT,
    "JumlahSPPG" INTEGER,
    "TahunKerjaSamaMBG" CITEXT,
    "BantuanLainnya" CITEXT,
    "Pelatihan2022" CITEXT,
    "Pelatihan2023" CITEXT,
    "PelatihanBUMDesa2024" CITEXT,
    "PelatihanPenasehatPengawas2024" CITEXT,
    "Pelatihan2025Pertama" CITEXT,
    "PelatihanBusinessPlanUI2023" CITEXT,
    "SABISA" CITEXT,
    "FGDUI2024" CITEXT,
    "FGDBRIN2024" CITEXT,
    "ToTSTAN" CITEXT,
    "SosialisasiELearningUI" CITEXT,
    "PesertaPelatihanBalaiBesarKemendesa" CITEXT,
    "Pembinaan2022" CITEXT,
    "Pembinaan2023" CITEXT,
    "Pembinaan2024" CITEXT,
    "ProgressHasilPembinaan2024" CITEXT,
    "DeskPendataan2025" CITEXT,
    "KehadiranDesk2026" CITEXT,
    "PermintaanDataKPK" CITEXT,
    "MasalahPendirianPenyertaanModal" CITEXT,
    "TahunPenyertaanModalBermasalah" CITEXT,
    "SuratKonfirmasi" CITEXT,
    "BerkasSurat" CITEXT,
    "PermasalahanLainnya" CITEXT,
    "ECommerce" CITEXT,
    "LinkSK" CITEXT,
    "LinkLapKeuangan2021" CITEXT,
    "LinkSKKepengurusan2021" CITEXT,
    "CatatanTambahan" CITEXT,
    "KategoriUsaha" CITEXT,
    "KategoriUsahaPangan" CITEXT,
    "UnitUsaha" CITEXT,
    "RiwayatPermodalan" CITEXT,
    "RiwayatAset" CITEXT,
    "RiwayatOmsetLaba" CITEXT,
    "RiwayatKontribusiPADes" CITEXT,
    "RiwayatKemitraan" CITEXT,
    "PeranProgram" CITEXT,
    "LaporanPertanggungjawaban" CITEXT,
    "MediaSosial" CITEXT,
    "StudiKelayakanUsaha" CITEXT,
    "RABKetahananPangan" CITEXT,
    "DokumentasiGeotagging" CITEXT,
    "DokumenKetahananPangan" CITEXT,
    "diisi_desa_at" TIMESTAMP(0),
    "diisi_desa_oleh" BIGINT,

    CONSTRAINT "bumdes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bumdes_produk" (
    "id" BIGSERIAL NOT NULL,
    "bumdes_id" INTEGER NOT NULL,
    "desa_id" BIGINT,
    "nama" CITEXT NOT NULL,
    "kategori" CITEXT,
    "deskripsi" CITEXT,
    "harga" DECIMAL(15,2),
    "satuan" CITEXT,
    "foto" CITEXT,
    "tautan" CITEXT,
    "whatsapp" CITEXT,
    "unggulan" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "bumdes_produk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desa_bankeu_surat" (
    "id" BIGSERIAL NOT NULL,
    "desa_id" BIGINT NOT NULL,
    "tahun" INTEGER NOT NULL DEFAULT 2025,
    "surat_pengantar" CITEXT,
    "surat_permohonan" CITEXT,
    "submitted_to_kecamatan" BOOLEAN NOT NULL DEFAULT false,
    "submitted_at" TIMESTAMP(0),
    "kecamatan_status" "desa_bankeu_surat_kecamatan_status" DEFAULT 'pending',
    "kecamatan_reviewed_by" BIGINT,
    "kecamatan_reviewed_at" TIMESTAMP(0),
    "kecamatan_catatan" CITEXT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "desa_bankeu_surat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desas" (
    "id" BIGSERIAL NOT NULL,
    "kecamatan_id" BIGINT NOT NULL,
    "kode" CITEXT NOT NULL,
    "nama" CITEXT NOT NULL,
    "status_pemerintahan" "desas_status_pemerintahan" NOT NULL DEFAULT 'desa',
    "is_musdesus_target" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "desas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dinas" (
    "id" BIGSERIAL NOT NULL,
    "nama" CITEXT NOT NULL,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "dinas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dinas_config" (
    "id" BIGSERIAL NOT NULL,
    "dinas_id" BIGINT NOT NULL,
    "nama_pic" CITEXT,
    "nip_pic" CITEXT,
    "jabatan_pic" CITEXT,
    "ttd_path" CITEXT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dinas_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dinas_verifikator" (
    "id" BIGSERIAL NOT NULL,
    "dinas_id" INTEGER NOT NULL,
    "user_id" BIGINT NOT NULL,
    "nama" CITEXT NOT NULL,
    "nip" CITEXT,
    "jabatan" CITEXT NOT NULL,
    "pangkat_golongan" CITEXT,
    "email" CITEXT NOT NULL,
    "ttd_path" CITEXT,
    "is_active" BOOLEAN DEFAULT true,
    "created_by" BIGINT NOT NULL,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "dinas_verifikator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disposisi" (
    "id" BIGSERIAL NOT NULL,
    "surat_id" BIGINT NOT NULL,
    "dari_user_id" BIGINT NOT NULL,
    "ke_user_id" BIGINT NOT NULL,
    "catatan" CITEXT,
    "instruksi" CITEXT,
    "status" "disposisi_status" DEFAULT 'pending',
    "level_disposisi" SMALLINT NOT NULL,
    "tanggal_disposisi" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "tanggal_dibaca" TIMESTAMP(0),
    "tanggal_selesai" TIMESTAMP(0),
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disposisi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hero_galleries" (
    "id" BIGSERIAL NOT NULL,
    "image_path" CITEXT NOT NULL,
    "title" CITEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "hero_galleries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jadwal_kegiatan" (
    "id" BIGSERIAL NOT NULL,
    "judul" CITEXT NOT NULL,
    "deskripsi" CITEXT NOT NULL,
    "bidang_id" BIGINT,
    "tanggal_mulai" TIMESTAMP(0) NOT NULL,
    "tanggal_selesai" TIMESTAMP(0) NOT NULL,
    "lokasi" CITEXT,
    "asal_kegiatan" CITEXT,
    "pic_name" CITEXT,
    "pic_contact" CITEXT,
    "status" "jadwal_kegiatan_status" NOT NULL DEFAULT 'draft',
    "prioritas" "jadwal_kegiatan_prioritas" NOT NULL DEFAULT 'sedang',
    "kategori" "jadwal_kegiatan_kategori" NOT NULL DEFAULT 'lainnya',
    "anggaran" DECIMAL(15,2),
    "catatan_approval" CITEXT,
    "created_by" BIGINT NOT NULL,
    "approved_by" BIGINT,
    "approved_at" TIMESTAMP(0),
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "sub_bidang_pelaksana" CITEXT,
    "surat_masuk_id" BIGINT,

    CONSTRAINT "jadwal_kegiatan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jadwal_kegiatan_bidang" (
    "id" BIGSERIAL NOT NULL,
    "jadwal_kegiatan_id" BIGINT NOT NULL,
    "bidang_id" BIGINT NOT NULL,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jadwal_kegiatan_bidang_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jadwal_kegiatan_views" (
    "id" BIGSERIAL NOT NULL,
    "jadwal_kegiatan_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "viewed_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jadwal_kegiatan_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jadwal_kegiatan_reactions" (
    "id" BIGSERIAL NOT NULL,
    "jadwal_kegiatan_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "emoji" CITEXT NOT NULL,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jadwal_kegiatan_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jadwal_kegiatan_comments" (
    "id" BIGSERIAL NOT NULL,
    "jadwal_kegiatan_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "content" CITEXT NOT NULL,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jadwal_kegiatan_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "karang_tarunas" (
    "id" CITEXT NOT NULL,
    "desa_id" BIGINT NOT NULL,
    "nama" CITEXT NOT NULL,
    "alamat" CITEXT,
    "status_kelembagaan" "karang_tarunas_status_kelembagaan" DEFAULT 'aktif',
    "status_verifikasi" "karang_tarunas_status_verifikasi" DEFAULT 'unverified',
    "imported" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "produk_hukum_id" CITEXT,
    "catatan_verifikasi" CITEXT,
    "nonaktif_at" TIMESTAMP(0),
    "produk_hukum_penonaktifan_id" CITEXT,
    "alasan_nonaktif" CITEXT,
    "keterangan_nonaktif" CITEXT,
    "verified_at" TIMESTAMP(0),
    "verifikator_nama" CITEXT,

    CONSTRAINT "karang_tarunas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lembaga_lainnyas" (
    "id" CITEXT NOT NULL,
    "desa_id" BIGINT NOT NULL,
    "nama" CITEXT NOT NULL,
    "alamat" CITEXT,
    "status_kelembagaan" "lembaga_lainnyas_status_kelembagaan" DEFAULT 'aktif',
    "status_verifikasi" "lembaga_lainnyas_status_verifikasi" DEFAULT 'unverified',
    "imported" BOOLEAN NOT NULL DEFAULT false,
    "catatan_verifikasi" CITEXT,
    "verifikator_nama" CITEXT,
    "verified_at" TIMESTAMP(0),
    "produk_hukum_id" CITEXT,
    "produk_hukum_penonaktifan_id" CITEXT,
    "nonaktif_at" TIMESTAMP(0),
    "alasan_nonaktif" CITEXT,
    "keterangan_nonaktif" CITEXT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lembaga_lainnyas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kecamatan_bankeu_config" (
    "id" BIGSERIAL NOT NULL,
    "kecamatan_id" BIGINT NOT NULL,
    "nama_camat" CITEXT NOT NULL,
    "nip_camat" CITEXT,
    "jabatan_penandatangan" CITEXT NOT NULL DEFAULT 'Camat',
    "logo_path" CITEXT,
    "alamat" CITEXT,
    "telepon" CITEXT,
    "email" CITEXT,
    "website" CITEXT,
    "kode_pos" CITEXT,
    "ttd_camat_path" CITEXT,
    "stempel_path" CITEXT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kecamatan_bankeu_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kecamatans" (
    "id" BIGSERIAL NOT NULL,
    "kode" CITEXT NOT NULL,
    "nama" CITEXT NOT NULL,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),
    "alamat" CITEXT,
    "logo_path" CITEXT,
    "nama_camat" CITEXT,
    "nip_camat" CITEXT,

    CONSTRAINT "kecamatans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kegiatan" (
    "id_kegiatan" SERIAL NOT NULL,
    "nama_kegiatan" CITEXT NOT NULL,
    "nomor_sp" CITEXT NOT NULL,
    "tanggal_mulai" DATE NOT NULL,
    "tanggal_selesai" DATE NOT NULL,
    "lokasi" CITEXT NOT NULL,
    "keterangan" CITEXT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "kegiatan_pkey" PRIMARY KEY ("id_kegiatan")
);

-- CreateTable
CREATE TABLE "kegiatan_bidang" (
    "id_kegiatan_bidang" SERIAL NOT NULL,
    "id_kegiatan" INTEGER NOT NULL,
    "id_bidang" BIGINT NOT NULL,
    "pegawai" CITEXT NOT NULL,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "kegiatan_bidang_pkey" PRIMARY KEY ("id_kegiatan_bidang")
);

-- CreateTable
CREATE TABLE "kegiatan_pegawai" (
    "id" SERIAL NOT NULL,
    "id_kegiatan" INTEGER NOT NULL,
    "id_kegiatan_bidang" INTEGER NOT NULL,
    "id_pegawai" BIGINT NOT NULL,
    "status" CITEXT NOT NULL DEFAULT 'aktif',
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kegiatan_pegawai_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kelembagaan_activity_logs" (
    "id" CITEXT NOT NULL,
    "kelembagaan_type" CITEXT NOT NULL,
    "kelembagaan_id" CITEXT NOT NULL,
    "kelembagaan_nama" CITEXT,
    "desa_id" BIGINT NOT NULL,
    "activity_type" CITEXT NOT NULL,
    "entity_type" CITEXT NOT NULL,
    "entity_id" CITEXT,
    "entity_name" CITEXT,
    "action_description" CITEXT NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "user_id" BIGINT NOT NULL,
    "user_name" CITEXT,
    "user_role" CITEXT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kelembagaan_activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kelurahan" (
    "id_kelurahan" SERIAL NOT NULL,
    "kelurahan" CITEXT NOT NULL,
    "id_kecamatan" INTEGER,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "kelurahan_pkey" PRIMARY KEY ("id_kelurahan")
);

-- CreateTable
CREATE TABLE "lampiran_surat" (
    "id" BIGSERIAL NOT NULL,
    "surat_id" BIGINT NOT NULL,
    "nama_file" CITEXT NOT NULL,
    "file_path" CITEXT NOT NULL,
    "ukuran_file" INTEGER,
    "tipe_file" CITEXT,
    "uploaded_by" BIGINT NOT NULL,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lampiran_surat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lpms" (
    "id" CITEXT NOT NULL,
    "desa_id" BIGINT NOT NULL,
    "nama" CITEXT NOT NULL,
    "alamat" CITEXT,
    "status_kelembagaan" "lpms_status_kelembagaan" DEFAULT 'aktif',
    "status_verifikasi" "lpms_status_verifikasi" DEFAULT 'unverified',
    "imported" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "produk_hukum_id" CITEXT,
    "catatan_verifikasi" CITEXT,
    "nonaktif_at" TIMESTAMP(0),
    "produk_hukum_penonaktifan_id" CITEXT,
    "alasan_nonaktif" CITEXT,
    "keterangan_nonaktif" CITEXT,
    "verified_at" TIMESTAMP(0),
    "verifikator_nama" CITEXT,

    CONSTRAINT "lpms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "title" CITEXT NOT NULL,
    "message" CITEXT,
    "type" CITEXT NOT NULL DEFAULT 'general',
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "data" JSONB,
    "sent_by" BIGINT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMP(0),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" BIGSERIAL NOT NULL,
    "title" CITEXT NOT NULL,
    "body" CITEXT NOT NULL,
    "target_type" CITEXT NOT NULL,
    "target_value" CITEXT,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "sender_id" BIGINT NOT NULL,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_dinas" (
    "id" SERIAL NOT NULL,
    "kode_dinas" CITEXT NOT NULL,
    "nama_dinas" CITEXT NOT NULL,
    "singkatan" CITEXT NOT NULL,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "master_dinas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pegawai" (
    "id_pegawai" BIGSERIAL NOT NULL,
    "id_bidang" BIGINT NOT NULL,
    "nama_pegawai" CITEXT NOT NULL,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),
    "alamat" CITEXT,
    "eselon" CITEXT,
    "golongan" CITEXT,
    "jabatan" CITEXT,
    "jenis_kelamin" "pegawai_jenis_kelamin",
    "nip" CITEXT,
    "no_hp" CITEXT,
    "pangkat" CITEXT,
    "pendidikan_terakhir" CITEXT,
    "status_kepegawaian" "pegawai_status_kepegawaian",
    "tanggal_lahir" DATE,
    "tempat_lahir" CITEXT,
    "tmt_jabatan" DATE,
    "unit_kerja" CITEXT,
    "sub_bidang" CITEXT,

    CONSTRAINT "pegawai_pkey" PRIMARY KEY ("id_pegawai")
);

-- CreateTable
CREATE TABLE "absensi_pegawai" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "tanggal" DATE NOT NULL,
    "jam_masuk" TIME(0),
    "jam_keluar" TIME(0),
    "status" "absensi_pegawai_status" NOT NULL DEFAULT 'hadir',
    "keterangan" CITEXT,
    "foto_masuk" CITEXT,
    "foto_keluar" CITEXT,
    "latitude_masuk" DOUBLE PRECISION,
    "longitude_masuk" DOUBLE PRECISION,
    "jarak_masuk" DOUBLE PRECISION,
    "latitude_keluar" DOUBLE PRECISION,
    "longitude_keluar" DOUBLE PRECISION,
    "jarak_keluar" DOUBLE PRECISION,
    "lokasi_masuk" CITEXT,
    "lokasi_keluar" CITEXT,
    "titik_absen_khusus" CITEXT,
    "device_id" CITEXT,
    "tujuan_dinas" CITEXT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "absensi_pegawai_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "absensi_settings" (
    "id" BIGSERIAL NOT NULL,
    "key" CITEXT NOT NULL,
    "value" CITEXT NOT NULL,
    "description" CITEXT,
    "updated_by" BIGINT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "absensi_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "absensi_success_messages" (
    "id" BIGSERIAL NOT NULL,
    "type" CITEXT NOT NULL,
    "title" CITEXT NOT NULL DEFAULT '',
    "message" CITEXT,
    "image_path" CITEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_by" BIGINT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "absensi_success_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "absensi_reminder_templates" (
    "id" BIGSERIAL NOT NULL,
    "type" CITEXT NOT NULL,
    "title" CITEXT NOT NULL DEFAULT '',
    "message" CITEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_by" BIGINT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "absensi_reminder_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "absensi_weekly_awards" (
    "id" BIGSERIAL NOT NULL,
    "week_key" CITEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "month_label" CITEXT NOT NULL,
    "winners" JSONB NOT NULL,
    "generated_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notified_at" TIMESTAMP(0),

    CONSTRAINT "absensi_weekly_awards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pejabat_ttd" (
    "id" BIGSERIAL NOT NULL,
    "kecamatan_id" BIGINT NOT NULL,
    "jenis_pejabat" "pejabat_ttd_jenis_pejabat" NOT NULL,
    "pejabat_id" BIGINT,
    "nama_pejabat" CITEXT NOT NULL,
    "ttd_path" CITEXT NOT NULL,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pejabat_ttd_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pengurus" (
    "id" CITEXT NOT NULL,
    "desa_id" BIGINT NOT NULL,
    "pengurusable_id" CITEXT NOT NULL,
    "pengurusable_type" CITEXT NOT NULL,
    "jabatan" CITEXT NOT NULL,
    "tanggal_mulai_jabatan" DATE,
    "tanggal_akhir_jabatan" DATE,
    "status_jabatan" "pengurus_status_jabatan" DEFAULT 'aktif',
    "status_verifikasi" "pengurus_status_verifikasi" DEFAULT 'unverified',
    "imported" BOOLEAN NOT NULL DEFAULT false,
    "produk_hukum_id" CITEXT,
    "nama_lengkap" CITEXT NOT NULL,
    "nik" CITEXT,
    "tempat_lahir" CITEXT,
    "tanggal_lahir" DATE,
    "jenis_kelamin" "pengurus_jenis_kelamin",
    "status_perkawinan" CITEXT,
    "alamat" CITEXT,
    "no_telepon" CITEXT,
    "nama_bank" CITEXT,
    "nomor_rekening" CITEXT,
    "nama_rekening" CITEXT,
    "pendidikan" CITEXT,
    "avatar" CITEXT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "catatan_verifikasi" CITEXT,
    "verified_at" TIMESTAMP(0),
    "verifikator_nama" CITEXT,
    "agama" CITEXT,
    "golongan_darah" CITEXT,
    "nomor_buku_nikah" CITEXT,

    CONSTRAINT "pengurus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "perjadin_grup" (
    "id" BIGSERIAL NOT NULL,
    "nama_grup" CITEXT,
    "jenis_tujuan" "perjadin_grup_jenis_tujuan" NOT NULL DEFAULT 'desa',
    "desa_tujuan_id" BIGINT,
    "lokasi_tujuan" CITEXT NOT NULL,
    "alamat_tujuan" CITEXT,
    "tanggal_berangkat" DATE NOT NULL,
    "tanggal_kembali" DATE NOT NULL,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "keterangan" CITEXT,
    "nomor_sp_grup" CITEXT,

    CONSTRAINT "perjadin_grup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "petugas_monitoring" (
    "id" BIGSERIAL NOT NULL,
    "nama_desa" CITEXT NOT NULL,
    "nama_kecamatan" CITEXT NOT NULL,
    "nama_petugas" CITEXT NOT NULL,
    "desa_id" BIGINT,
    "kecamatan_id" BIGINT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "petugas_monitoring_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pkks" (
    "id" CITEXT NOT NULL,
    "desa_id" BIGINT NOT NULL,
    "nama" CITEXT NOT NULL,
    "alamat" CITEXT,
    "status_kelembagaan" "pkks_status_kelembagaan" DEFAULT 'aktif',
    "status_verifikasi" "pkks_status_verifikasi" DEFAULT 'unverified',
    "imported" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "produk_hukum_id" CITEXT,
    "catatan_verifikasi" CITEXT,
    "nonaktif_at" TIMESTAMP(0),
    "produk_hukum_penonaktifan_id" CITEXT,
    "alasan_nonaktif" CITEXT,
    "keterangan_nonaktif" CITEXT,
    "verified_at" TIMESTAMP(0),
    "verifikator_nama" CITEXT,

    CONSTRAINT "pkks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posyandus" (
    "id" CITEXT NOT NULL,
    "desa_id" BIGINT NOT NULL,
    "nama" CITEXT NOT NULL,
    "alamat" CITEXT,
    "status_kelembagaan" "posyandus_status_kelembagaan" DEFAULT 'aktif',
    "status_verifikasi" "posyandus_status_verifikasi" DEFAULT 'unverified',
    "imported" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "produk_hukum_id" CITEXT,
    "catatan_verifikasi" CITEXT,
    "nonaktif_at" TIMESTAMP(0),
    "produk_hukum_penonaktifan_id" CITEXT,
    "alasan_nonaktif" CITEXT,
    "keterangan_nonaktif" CITEXT,
    "verified_at" TIMESTAMP(0),
    "verifikator_nama" CITEXT,

    CONSTRAINT "posyandus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" BIGSERIAL NOT NULL,
    "name" CITEXT NOT NULL,
    "description" CITEXT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "produk_hukums" (
    "id" CITEXT NOT NULL,
    "uuid" CITEXT,
    "desa_id" BIGINT NOT NULL,
    "tipe_dokumen" CITEXT NOT NULL DEFAULT 'Peraturan Perundang-undangan',
    "judul" CITEXT NOT NULL,
    "nomor" CITEXT NOT NULL,
    "tahun" INTEGER NOT NULL,
    "jenis" "produk_hukums_jenis" NOT NULL,
    "singkatan_jenis" "produk_hukums_singkatan_jenis" NOT NULL,
    "tempat_penetapan" CITEXT NOT NULL,
    "tanggal_penetapan" DATE NOT NULL,
    "sumber" CITEXT,
    "subjek" CITEXT,
    "status_peraturan" "produk_hukums_status_peraturan" NOT NULL DEFAULT 'berlaku',
    "keterangan_status" CITEXT,
    "bahasa" CITEXT NOT NULL DEFAULT 'Indonesia',
    "bidang_hukum" CITEXT NOT NULL DEFAULT 'Tata Negara',
    "file" CITEXT NOT NULL,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "produk_hukums_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "produk_hukum_bidang" (
    "id" BIGSERIAL NOT NULL,
    "bidang_id" BIGINT NOT NULL,
    "jenis" CITEXT NOT NULL,
    "singkatan_jenis" CITEXT NOT NULL,
    "judul" CITEXT NOT NULL,
    "nomor" CITEXT NOT NULL,
    "tahun" INTEGER NOT NULL,
    "tentang" CITEXT,
    "tempat_penetapan" CITEXT,
    "tanggal_penetapan" DATE,
    "sumber" CITEXT,
    "status_peraturan" "produk_hukum_bidang_status_peraturan" NOT NULL DEFAULT 'berlaku',
    "keterangan_status" CITEXT,
    "bidang_hukum" CITEXT NOT NULL DEFAULT 'Tata Negara',
    "file" CITEXT,
    "url_sumber" CITEXT,
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "produk_hukum_bidang_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "produk_hukum_referensi" (
    "id" BIGSERIAL NOT NULL,
    "tingkat" "produk_hukum_referensi_tingkat" NOT NULL DEFAULT 'nasional',
    "jenis" CITEXT NOT NULL,
    "singkatan_jenis" CITEXT NOT NULL,
    "nomor" CITEXT NOT NULL,
    "tahun" INTEGER NOT NULL,
    "judul" CITEXT NOT NULL,
    "tentang" CITEXT NOT NULL,
    "topik" CITEXT,
    "url" CITEXT,
    "sumber_situs" CITEXT,
    "status_peraturan" "produk_hukum_referensi_status_peraturan" NOT NULL DEFAULT 'berlaku',
    "keterangan_status" CITEXT,
    "urutan" INTEGER NOT NULL DEFAULT 0,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "produk_hukum_referensi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profil_desas" (
    "id" BIGSERIAL NOT NULL,
    "desa_id" BIGINT NOT NULL,
    "klasifikasi_desa" CITEXT,
    "status_desa" CITEXT,
    "tipologi_desa" CITEXT,
    "jumlah_penduduk" INTEGER,
    "sejarah_desa" CITEXT,
    "demografi" CITEXT,
    "potensi_desa" CITEXT,
    "no_telp" CITEXT,
    "email" CITEXT,
    "instagram_url" CITEXT,
    "youtube_url" CITEXT,
    "luas_wilayah" CITEXT,
    "alamat_kantor" CITEXT,
    "radius_ke_kecamatan" CITEXT,
    "foto_kantor_desa_path" CITEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "profil_desas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "endpoint" CITEXT NOT NULL,
    "subscription" JSONB NOT NULL,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rts" (
    "id" CITEXT NOT NULL,
    "rw_id" CITEXT NOT NULL,
    "desa_id" BIGINT NOT NULL,
    "nomor" CITEXT NOT NULL,
    "alamat" CITEXT,
    "status_kelembagaan" "rts_status_kelembagaan" DEFAULT 'aktif',
    "status_verifikasi" "rts_status_verifikasi" DEFAULT 'unverified',
    "imported" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "produk_hukum_id" CITEXT,
    "catatan_verifikasi" CITEXT,
    "jumlah_jiwa" INTEGER,
    "jumlah_kk" INTEGER,
    "nonaktif_at" TIMESTAMP(0),
    "produk_hukum_penonaktifan_id" CITEXT,
    "alasan_nonaktif" CITEXT,
    "keterangan_nonaktif" CITEXT,
    "verified_at" TIMESTAMP(0),
    "verifikator_nama" CITEXT,

    CONSTRAINT "rts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rws" (
    "id" CITEXT NOT NULL,
    "desa_id" BIGINT NOT NULL,
    "nomor" CITEXT NOT NULL,
    "alamat" CITEXT,
    "status_kelembagaan" "rws_status_kelembagaan" NOT NULL DEFAULT 'aktif',
    "status_verifikasi" "rws_status_verifikasi" NOT NULL DEFAULT 'unverified',
    "imported" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),
    "produk_hukum_id" CITEXT,
    "catatan_verifikasi" CITEXT,
    "nonaktif_at" TIMESTAMP(0),
    "produk_hukum_penonaktifan_id" CITEXT,
    "alasan_nonaktif" CITEXT,
    "keterangan_nonaktif" CITEXT,
    "verified_at" TIMESTAMP(0),
    "verifikator_nama" CITEXT,

    CONSTRAINT "rws_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "satlinmas" (
    "id" CITEXT NOT NULL,
    "desa_id" BIGINT NOT NULL,
    "nama" CITEXT NOT NULL,
    "alamat" CITEXT,
    "status_kelembagaan" "satlinmas_status_kelembagaan" NOT NULL DEFAULT 'aktif',
    "status_verifikasi" "satlinmas_status_verifikasi" NOT NULL DEFAULT 'unverified',
    "imported" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),
    "produk_hukum_id" CITEXT,
    "catatan_verifikasi" CITEXT,
    "produk_hukum_penonaktifan_id" CITEXT,
    "nonaktif_at" TIMESTAMP(0),
    "alasan_nonaktif" CITEXT,
    "keterangan_nonaktif" CITEXT,
    "verified_at" TIMESTAMP(0),
    "verifikator_nama" CITEXT,

    CONSTRAINT "satlinmas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surat_masuk" (
    "id" BIGSERIAL NOT NULL,
    "nomor_surat" CITEXT NOT NULL,
    "tanggal_surat" DATE NOT NULL,
    "tanggal_terima" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "pengirim" CITEXT NOT NULL,
    "perihal" CITEXT NOT NULL,
    "jenis_surat" "surat_masuk_jenis_surat" DEFAULT 'biasa',
    "file_path" CITEXT,
    "file_disposisi_path" CITEXT,
    "keterangan" CITEXT,
    "status" "surat_masuk_status" DEFAULT 'draft',
    "created_by" BIGINT NOT NULL,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "jam_kegiatan" CITEXT,
    "lokasi_kegiatan" CITEXT,
    "tanggal_kegiatan" DATE,

    CONSTRAINT "surat_masuk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tim_verifikasi_kecamatan" (
    "id" BIGSERIAL NOT NULL,
    "kecamatan_id" BIGINT NOT NULL,
    "proposal_id" BIGINT,
    "jabatan" CITEXT NOT NULL,
    "jabatan_label" CITEXT,
    "nama" CITEXT NOT NULL,
    "nip" CITEXT,
    "ttd_path" CITEXT,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tim_verifikasi_kecamatan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" SERIAL NOT NULL,
    "name" CITEXT NOT NULL,
    "label" CITEXT NOT NULL,
    "color" CITEXT DEFAULT 'gray',
    "description" CITEXT,
    "category" CITEXT DEFAULT 'other',
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "needs_entity" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tugas_pribadi" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "judul" CITEXT NOT NULL,
    "selesai" BOOLEAN NOT NULL DEFAULT false,
    "tanggal_pengingat" DATE,
    "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tugas_pribadi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catatan_pribadi" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "judul" CITEXT NOT NULL DEFAULT '',
    "isi" CITEXT NOT NULL,
    "disematkan" BOOLEAN NOT NULL DEFAULT false,
    "versi" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catatan_pribadi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_totp" (
    "user_id" BIGINT NOT NULL,
    "rahasia" CITEXT NOT NULL,
    "aktif_at" TIMESTAMP(0),
    "langkah_terakhir" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_totp_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" BIGSERIAL NOT NULL,
    "name" CITEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "email_verified_at" TIMESTAMP(0),
    "password" CITEXT NOT NULL,
    "plain_password" CITEXT,
    "role" CITEXT NOT NULL DEFAULT 'desa',
    "kecamatan_id" INTEGER,
    "operator_kecamatan" BOOLEAN NOT NULL DEFAULT false,
    "desa_id" BIGINT,
    "jabatan_desa" CITEXT,
    "no_hp" CITEXT,
    "bidang_id" INTEGER,
    "dinas_id" INTEGER,
    "avatar" CITEXT,
    "remember_token" CITEXT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "pegawai_id" BIGINT,
    "device_id" CITEXT,
    "last_active_at" TIMESTAMP(0),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desa_user_permissions" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "permission_key" CITEXT NOT NULL,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "desa_user_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cctv_akses" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "izin" CITEXT NOT NULL,
    "berlaku_sampai" TIMESTAMP(0),
    "diberi_oleh" BIGINT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cctv_akses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kecamatan_user_permissions" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "permission_key" CITEXT NOT NULL,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kecamatan_user_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifikator_akses_desa" (
    "id" BIGSERIAL NOT NULL,
    "verifikator_id" BIGINT NOT NULL,
    "desa_id" BIGINT NOT NULL,
    "kecamatan_id" BIGINT NOT NULL,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verifikator_akses_desa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "berita_acara_history" (
    "id" BIGSERIAL NOT NULL,
    "proposal_id" BIGINT NOT NULL,
    "desa_id" BIGINT NOT NULL,
    "kecamatan_id" BIGINT NOT NULL,
    "kegiatan_id" SMALLINT,
    "file_path" CITEXT NOT NULL,
    "file_name" CITEXT NOT NULL,
    "file_size" INTEGER,
    "qr_code" CITEXT NOT NULL,
    "qr_code_path" CITEXT,
    "generated_by" BIGINT NOT NULL,
    "generated_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checklist_summary" JSONB,
    "tim_verifikasi_data" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_latest" BOOLEAN DEFAULT true,
    "replaced_by" BIGINT,
    "status" "berita_acara_history_status" NOT NULL DEFAULT 'active',
    "revoked_at" TIMESTAMP(0),
    "revoked_by" BIGINT,
    "revoked_reason" CITEXT,
    "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "berita_acara_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "perjadin_pegawai" (
    "id" BIGSERIAL NOT NULL,
    "pegawai_id" BIGINT NOT NULL,
    "desa_tujuan_id" BIGINT,
    "lokasi_tujuan" CITEXT NOT NULL,
    "alamat_tujuan" CITEXT,
    "tujuan_perjalanan" CITEXT NOT NULL,
    "tanggal_berangkat" DATE NOT NULL,
    "tanggal_kembali" DATE NOT NULL,
    "nomor_sppd" CITEXT,
    "status" "perjadin_pegawai_status" NOT NULL DEFAULT 'draft',
    "catatan_approval" CITEXT,
    "approved_by" BIGINT,
    "approved_at" TIMESTAMP(0),
    "keterangan" CITEXT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "perjadin_pegawai_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "info_banners" (
    "id" BIGSERIAL NOT NULL,
    "judul" CITEXT NOT NULL,
    "deskripsi" CITEXT,
    "gambar" CITEXT NOT NULL,
    "link" CITEXT,
    "urutan" INTEGER NOT NULL DEFAULT 0,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "tanggal_mulai" TIMESTAMP(0),
    "tanggal_selesai" TIMESTAMP(0),
    "created_by" BIGINT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "info_banners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_meeting_chats" (
    "id" BIGSERIAL NOT NULL,
    "meeting_id" BIGINT NOT NULL,
    "participant_id" BIGINT NOT NULL,
    "message" CITEXT NOT NULL,
    "message_type" "video_meeting_chats_message_type" DEFAULT 'text',
    "file_url" CITEXT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_meeting_chats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_meeting_invitations" (
    "id" BIGSERIAL NOT NULL,
    "meeting_id" BIGINT NOT NULL,
    "user_id" BIGINT,
    "email" CITEXT,
    "status" "video_meeting_invitations_status" DEFAULT 'pending',
    "invited_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMP(0),

    CONSTRAINT "video_meeting_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_meeting_participants" (
    "id" BIGSERIAL NOT NULL,
    "meeting_id" BIGINT NOT NULL,
    "user_id" BIGINT,
    "guest_name" CITEXT,
    "role" "video_meeting_participants_role" DEFAULT 'participant',
    "hand_raised" BOOLEAN DEFAULT false,
    "on_stage" BOOLEAN DEFAULT false,
    "hand_raised_at" TIMESTAMP(0),
    "joined_at" TIMESTAMP(0),
    "left_at" TIMESTAMP(0),
    "is_muted" BOOLEAN DEFAULT false,
    "is_video_on" BOOLEAN DEFAULT true,
    "is_screen_sharing" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_meeting_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_meeting_recordings" (
    "id" BIGSERIAL NOT NULL,
    "meeting_id" BIGINT NOT NULL,
    "file_path" CITEXT NOT NULL,
    "file_size" BIGINT,
    "duration" INTEGER,
    "status" "video_meeting_recordings_status" DEFAULT 'recording',
    "started_at" TIMESTAMP(0) NOT NULL,
    "ended_at" TIMESTAMP(0),
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_meeting_recordings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_meetings" (
    "id" BIGSERIAL NOT NULL,
    "uuid" CITEXT NOT NULL,
    "room_id" CITEXT NOT NULL,
    "title" CITEXT NOT NULL,
    "description" CITEXT,
    "host_id" BIGINT NOT NULL,
    "bidang_id" BIGINT,
    "status" "video_meetings_status" DEFAULT 'scheduled',
    "mode" CITEXT NOT NULL DEFAULT 'meeting',
    "scheduled_start" TIMESTAMP(0),
    "scheduled_end" TIMESTAMP(0),
    "actual_start" TIMESTAMP(0),
    "actual_end" TIMESTAMP(0),
    "max_participants" INTEGER DEFAULT 50,
    "is_recording_enabled" BOOLEAN DEFAULT false,
    "is_screen_share_enabled" BOOLEAN DEFAULT true,
    "is_chat_enabled" BOOLEAN DEFAULT true,
    "password" CITEXT,
    "waiting_room_enabled" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_statuses" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "content" CITEXT NOT NULL,
    "background_color" CITEXT DEFAULT '#059669',
    "media_path" CITEXT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(0) NOT NULL,

    CONSTRAINT "user_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_views" (
    "id" BIGSERIAL NOT NULL,
    "status_id" BIGINT NOT NULL,
    "viewer_id" BIGINT NOT NULL,
    "viewed_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "klasifikasi_arsip" (
    "id" BIGSERIAL NOT NULL,
    "kode" CITEXT NOT NULL,
    "nama" CITEXT NOT NULL,
    "parent_kode" CITEXT,
    "level" SMALLINT NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "klasifikasi_arsip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nomor_surat_requests" (
    "id" BIGSERIAL NOT NULL,
    "klasifikasi_kode" CITEXT NOT NULL,
    "nomor_registrasi" INTEGER NOT NULL,
    "nomor_surat_generated" CITEXT NOT NULL,
    "perihal" CITEXT NOT NULL,
    "bidang_id" INTEGER NOT NULL,
    "bidang_nama" CITEXT NOT NULL,
    "requested_by" BIGINT NOT NULL,
    "requested_by_name" CITEXT NOT NULL,
    "catatan" CITEXT,
    "tahun" INTEGER NOT NULL,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nomor_surat_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" BIGSERIAL NOT NULL,
    "type" "conversations_type" NOT NULL,
    "reference_type" "conversations_reference_type",
    "reference_id" BIGINT,
    "participant_one_id" BIGINT,
    "participant_two_id" BIGINT,
    "last_message_id" BIGINT,
    "last_message_at" TIMESTAMP(0),
    "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "group_avatar" CITEXT,
    "group_name" CITEXT,
    "is_group" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" BIGSERIAL NOT NULL,
    "conversation_id" BIGINT NOT NULL,
    "sender_id" BIGINT NOT NULL,
    "content" CITEXT NOT NULL,
    "message_type" "messages_message_type" NOT NULL DEFAULT 'text',
    "file_path" CITEXT,
    "file_name" CITEXT,
    "file_size" INTEGER,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMP(0),
    "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reply_to_id" BIGINT,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_reactions" (
    "id" BIGSERIAL NOT NULL,
    "message_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "emoji" CITEXT NOT NULL,
    "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_participants" (
    "id" BIGSERIAL NOT NULL,
    "conversation_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "role" "conversation_participants_role" NOT NULL DEFAULT 'member',
    "joined_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_read_at" TIMESTAMP(0),

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pencairan" (
    "id" BIGSERIAL NOT NULL,
    "jenis_pencairan" "pencairan_jenis_pencairan" NOT NULL DEFAULT 'atk',
    "master_kegiatan_id" BIGINT NOT NULL,
    "pagu_id" BIGINT NOT NULL,
    "tahun_anggaran" INTEGER NOT NULL,
    "bidang_id" BIGINT NOT NULL,
    "uraian_kegiatan" CITEXT,
    "penyedia_id" BIGINT,
    "ppk_id" BIGINT,
    "kpa_id" BIGINT,
    "pptk_id" BIGINT,
    "bendahara_pengeluaran_id" BIGINT,
    "pengurus_barang_id" BIGINT,
    "atasan_pengurus_barang_id" BIGINT,
    "penerima_faktur_id" BIGINT,
    "tgl_pesanan" DATE,
    "tgl_surat_perintah_tugas" DATE,
    "tgl_faktur" DATE,
    "tgl_kwitansi" DATE,
    "tgl_ba_pemeriksaan" DATE,
    "tgl_bast" DATE,
    "tgl_basthp" DATE,
    "no_pesanan_a" CITEXT,
    "no_pesanan_b" CITEXT,
    "no_faktur" CITEXT,
    "no_kwitansi" CITEXT,
    "no_ba_pemeriksaan" CITEXT,
    "no_bast" CITEXT,
    "no_basthp" CITEXT,
    "no_bappbj" CITEXT,
    "no_lampiran_bat" CITEXT,
    "no_surat_perintah_tugas" CITEXT,
    "no_sk_bupati_kpa" CITEXT,
    "no_sk_kadis_ppk" CITEXT,
    "total_nilai" DECIMAL(20,2) NOT NULL DEFAULT 0.00,
    "total_terbilang" CITEXT,
    "metadata" JSONB,
    "status" "pencairan_status" NOT NULL DEFAULT 'draft',
    "finalized_at" TIMESTAMP(0),
    "finalized_by" BIGINT,
    "created_by" BIGINT NOT NULL,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pencairan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pencairan_items" (
    "id" BIGSERIAL NOT NULL,
    "pencairan_id" BIGINT NOT NULL,
    "rka_item_id" BIGINT,
    "nama_barang" CITEXT NOT NULL,
    "spesifikasi" CITEXT,
    "kode_rekening" CITEXT,
    "qty" DECIMAL(15,4) NOT NULL DEFAULT 1.0000,
    "satuan" CITEXT NOT NULL,
    "harga_satuan" DECIMAL(20,2) NOT NULL DEFAULT 0.00,
    "ppn" DECIMAL(20,2) NOT NULL DEFAULT 0.00,
    "total" DECIMAL(20,2) NOT NULL DEFAULT 0.00,
    "status_pemeriksaan" "pencairan_items_status_pemeriksaan" NOT NULL DEFAULT 'baik',
    "urutan" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pencairan_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pencairan_pemeriksa" (
    "id" BIGSERIAL NOT NULL,
    "pencairan_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "peran" "pencairan_pemeriksa_peran" NOT NULL DEFAULT 'anggota',
    "urutan" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pencairan_pemeriksa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "penyedia" (
    "id" BIGSERIAL NOT NULL,
    "nama" CITEXT NOT NULL,
    "alamat" CITEXT,
    "npwp" CITEXT,
    "nama_direktur" CITEXT,
    "jabatan_direktur" CITEXT DEFAULT 'Direktur',
    "no_rekening" CITEXT,
    "nama_bank" CITEXT,
    "telepon" CITEXT,
    "email" CITEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "penyedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arsip_barang" (
    "id" BIGSERIAL NOT NULL,
    "kode_barang" CITEXT NOT NULL,
    "public_token" CITEXT NOT NULL,
    "nama" CITEXT NOT NULL,
    "kategori_id" BIGINT,
    "merk_tipe" CITEXT,
    "nomor_seri" CITEXT,
    "foto" CITEXT,
    "jumlah" INTEGER NOT NULL DEFAULT 1,
    "satuan" CITEXT NOT NULL DEFAULT 'Unit',
    "kondisi" "arsip_barang_kondisi" NOT NULL DEFAULT 'baik',
    "lokasi" CITEXT,
    "pemegang_user_id" BIGINT,
    "pemegang_nama" CITEXT,
    "tanggal_perolehan" DATE,
    "sumber_dana" "arsip_barang_sumber_dana",
    "nilai_perolehan" DECIMAL(18,2),
    "nomor_kontrak" CITEXT,
    "nomor_faktur" CITEXT,
    "status" "arsip_barang_status" NOT NULL DEFAULT 'aktif',
    "tanggal_penghapusan" DATE,
    "alasan_penghapusan" CITEXT,
    "nomor_ba_penghapusan" CITEXT,
    "keterangan" CITEXT,
    "bidang_id" BIGINT DEFAULT 2,
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "arsip_barang_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arsip_barang_kategori" (
    "id" BIGSERIAL NOT NULL,
    "nama" CITEXT NOT NULL,
    "kode" CITEXT NOT NULL,
    "deskripsi" CITEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "arsip_barang_kategori_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arsip_barang_mutasi" (
    "id" BIGSERIAL NOT NULL,
    "barang_id" BIGINT NOT NULL,
    "jenis" "arsip_barang_mutasi_jenis" NOT NULL,
    "nilai_lama" CITEXT,
    "nilai_baru" CITEXT,
    "catatan" CITEXT,
    "user_id" BIGINT,
    "user_name" CITEXT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "arsip_barang_mutasi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arsip_barang_scan_log" (
    "id" BIGSERIAL NOT NULL,
    "barang_id" BIGINT NOT NULL,
    "source" "arsip_barang_scan_log_source" NOT NULL DEFAULT 'public',
    "user_id" BIGINT,
    "user_name" CITEXT,
    "ip_address" CITEXT,
    "user_agent" CITEXT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "arsip_barang_scan_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "absensi_lokasi_khusus" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "radius_meter" INTEGER NOT NULL DEFAULT 500,
    "berlaku_mulai" DATE,
    "berlaku_sampai" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "absensi_lokasi_khusus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pencairan_sk_ref" (
    "id" BIGSERIAL NOT NULL,
    "jenis" CITEXT NOT NULL,
    "tahun" INTEGER NOT NULL,
    "nomor" CITEXT NOT NULL,
    "tanggal" DATE,
    "keterangan" CITEXT,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pencairan_sk_ref_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drive_folder" (
    "id" BIGSERIAL NOT NULL,
    "bidang_id" BIGINT NOT NULL,
    "parent_id" BIGINT,
    "nama" CITEXT NOT NULL,
    "jalur" CITEXT NOT NULL DEFAULT '/',
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(0),
    "deleted_by" BIGINT,

    CONSTRAINT "drive_folder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drive_file" (
    "id" BIGSERIAL NOT NULL,
    "bidang_id" BIGINT NOT NULL,
    "folder_id" BIGINT,
    "nama" CITEXT NOT NULL,
    "nama_asli" CITEXT NOT NULL,
    "mime" CITEXT,
    "ekstensi" CITEXT,
    "ukuran" BIGINT NOT NULL DEFAULT 0,
    "nama_disk" CITEXT NOT NULL,
    "jalur_disk" CITEXT NOT NULL,
    "checksum" CITEXT,
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(0),
    "deleted_by" BIGINT,

    CONSTRAINT "drive_file_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drive_share" (
    "id" BIGSERIAL NOT NULL,
    "objek_tipe" "drive_share_objek_tipe" NOT NULL,
    "objek_id" BIGINT NOT NULL,
    "bidang_pemilik" BIGINT NOT NULL,
    "penerima_tipe" "drive_share_penerima_tipe" NOT NULL,
    "penerima_id" BIGINT NOT NULL,
    "izin" "drive_share_izin" NOT NULL DEFAULT 'lihat',
    "created_by" BIGINT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drive_share_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drive_kuota" (
    "bidang_id" BIGINT NOT NULL,
    "batas_bytes" BIGINT NOT NULL DEFAULT 26843545600,
    "terpakai_bytes" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drive_kuota_pkey" PRIMARY KEY ("bidang_id")
);

-- CreateTable
CREATE TABLE "formulir" (
    "id" BIGSERIAL NOT NULL,
    "bidang_id" BIGINT NOT NULL,
    "judul" CITEXT NOT NULL,
    "deskripsi" CITEXT,
    "token" CITEXT NOT NULL,
    "status" "formulir_status" NOT NULL DEFAULT 'draf',
    "butuh_login" BOOLEAN NOT NULL DEFAULT false,
    "satu_respons" BOOLEAN NOT NULL DEFAULT false,
    "kumpulkan_email" BOOLEAN NOT NULL DEFAULT false,
    "acak_pertanyaan" BOOLEAN NOT NULL DEFAULT false,
    "respons_terbuka" BOOLEAN NOT NULL DEFAULT false,
    "pesan_konfirmasi" CITEXT,
    "tutup_pada" TIMESTAMP(0),
    "batas_respons" INTEGER,
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(0),
    "deleted_by" BIGINT,

    CONSTRAINT "formulir_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formulir_pertanyaan" (
    "id" BIGSERIAL NOT NULL,
    "formulir_id" BIGINT NOT NULL,
    "tipe" "formulir_pertanyaan_tipe" NOT NULL DEFAULT 'jawaban_singkat',
    "label" CITEXT NOT NULL,
    "deskripsi" CITEXT,
    "wajib" BOOLEAN NOT NULL DEFAULT false,
    "urutan" INTEGER NOT NULL DEFAULT 0,
    "opsi" JSONB,
    "pengaturan" JSONB,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "formulir_pertanyaan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formulir_respons" (
    "id" BIGSERIAL NOT NULL,
    "formulir_id" BIGINT NOT NULL,
    "user_id" BIGINT,
    "nama_responden" CITEXT,
    "email" CITEXT,
    "ip" CITEXT,
    "dikirim_pada" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "formulir_respons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formulir_jawaban" (
    "id" BIGSERIAL NOT NULL,
    "respons_id" BIGINT NOT NULL,
    "pertanyaan_id" BIGINT NOT NULL,
    "nilai" CITEXT,
    "nilai_json" JSONB,

    CONSTRAINT "formulir_jawaban_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formulir_berkas" (
    "id" BIGSERIAL NOT NULL,
    "respons_id" BIGINT NOT NULL,
    "pertanyaan_id" BIGINT NOT NULL,
    "nama" CITEXT NOT NULL,
    "mime" CITEXT,
    "ukuran" BIGINT NOT NULL DEFAULT 0,
    "nama_disk" CITEXT NOT NULL,
    "jalur_disk" CITEXT NOT NULL,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "formulir_berkas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_desa_permintaan" (
    "id" BIGSERIAL NOT NULL,
    "bidang_id" BIGINT NOT NULL,
    "judul" CITEXT NOT NULL,
    "deskripsi" CITEXT,
    "token" CITEXT NOT NULL,
    "status" "video_desa_permintaan_status" NOT NULL DEFAULT 'dibuka',
    "orientasi" "video_desa_permintaan_orientasi" NOT NULL DEFAULT 'bebas',
    "maks_durasi_detik" INTEGER,
    "maks_per_desa" INTEGER NOT NULL DEFAULT 2,
    "tutup_pada" TIMESTAMP(0),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(0),
    "deleted_by" BIGINT,

    CONSTRAINT "video_desa_permintaan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_desa_kiriman" (
    "id" BIGSERIAL NOT NULL,
    "permintaan_id" BIGINT NOT NULL,
    "desa_id" BIGINT NOT NULL,
    "nama_pengirim" CITEXT NOT NULL,
    "no_hp" CITEXT,
    "keterangan" CITEXT,
    "nama_berkas" CITEXT NOT NULL,
    "mime" CITEXT,
    "ukuran" BIGINT NOT NULL DEFAULT 0,
    "ukuran_asli" BIGINT NOT NULL DEFAULT 0,
    "sha256" CITEXT,
    "durasi_detik" DECIMAL(10,2),
    "lebar" INTEGER,
    "tinggi" INTEGER,
    "codec" CITEXT,
    "nama_disk" CITEXT NOT NULL,
    "jalur_disk" CITEXT NOT NULL,
    "status" "video_desa_kiriman_status" NOT NULL DEFAULT 'masuk',
    "pemrosesan" "video_desa_kiriman_proses" NOT NULL DEFAULT 'antre',
    "pesan_proses" CITEXT,
    "catatan" CITEXT,
    "ditinjau_oleh" BIGINT,
    "ditinjau_pada" TIMESTAMP(0),
    "ip" CITEXT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_desa_kiriman_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_desa_tautan" (
    "id" INTEGER NOT NULL,
    "token" CITEXT NOT NULL,
    "status" "video_desa_permintaan_status" NOT NULL DEFAULT 'dibuka',
    "updated_by" BIGINT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_desa_tautan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kerjasama_desa_legalitas" (
    "id" BIGSERIAL NOT NULL,
    "desa_id" BIGINT NOT NULL,
    "nomor_perdes" CITEXT,
    "tahun_perdes" INTEGER,
    "produk_hukum_id" CITEXT,
    "keterangan" CITEXT,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "kerjasama_desa_legalitas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kerjasama_desa" (
    "id" BIGSERIAL NOT NULL,
    "desa_id" BIGINT NOT NULL,
    "tahun" INTEGER NOT NULL,
    "jenis" "kerjasama_desa_jenis" NOT NULL,
    "bidang" "kerjasama_desa_bidang" NOT NULL,
    "sub_bidang" CITEXT,
    "mitra" CITEXT NOT NULL,
    "ruang_lingkup" CITEXT,
    "tanggal_mulai" DATE,
    "tanggal_selesai" DATE,
    "file_permakades" CITEXT,
    "file_sk_bkd" CITEXT,
    "file_pks_mou" CITEXT,
    "pelaksanaan" CITEXT,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "kerjasama_desa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cctv_cameras" (
    "id" BIGSERIAL NOT NULL,
    "name" CITEXT NOT NULL,
    "lokasi" CITEXT,
    "rtsp_url" CITEXT NOT NULL,
    "rtsp_url_main" CITEXT,
    "rtsp_url_sub" CITEXT,
    "username" CITEXT,
    "password_enc" CITEXT,
    "desa_id" BIGINT,
    "kecamatan_id" BIGINT,
    "status" "cctv_camera_status" NOT NULL DEFAULT 'inactive',
    "recognition_enabled" BOOLEAN NOT NULL DEFAULT true,
    "fall_detection_enabled" BOOLEAN NOT NULL DEFAULT true,
    "go2rtc_src" CITEXT,
    "last_online_at" TIMESTAMP(0),
    "created_by" BIGINT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cctv_cameras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cctv_faces" (
    "id" BIGSERIAL NOT NULL,
    "nama" CITEXT NOT NULL,
    "kode_pegawai" CITEXT,
    "departemen" CITEXT,
    "foto_path" CITEXT,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cctv_faces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cctv_face_embeddings" (
    "id" BIGSERIAL NOT NULL,
    "face_id" BIGINT NOT NULL,
    "image_path" CITEXT NOT NULL,
    "embedding" JSONB NOT NULL,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cctv_face_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cctv_events" (
    "id" BIGSERIAL NOT NULL,
    "event_uuid" CITEXT NOT NULL,
    "camera_id" BIGINT NOT NULL,
    "type" "cctv_event_type" NOT NULL,
    "severity" "cctv_event_severity" NOT NULL DEFAULT 'info',
    "face_id" BIGINT,
    "nama" CITEXT,
    "similarity" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION,
    "bbox" JSONB,
    "track_id" CITEXT,
    "snapshot_path" CITEXT,
    "status" "cctv_event_status" NOT NULL DEFAULT 'active',
    "metadata" JSONB,
    "acknowledged_by" BIGINT,
    "acknowledged_at" TIMESTAMP(0),
    "occurred_at" TIMESTAMP(0) NOT NULL,
    "created_at" TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cctv_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "aparatur_desa_logs_aparatur_id_index" ON "aparatur_desa_logs"("aparatur_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_action" ON "activity_logs"("action");

-- CreateIndex
CREATE INDEX "activity_logs_idx_bidang_id" ON "activity_logs"("bidang_id");

-- CreateIndex
CREATE INDEX "activity_logs_idx_created_at" ON "activity_logs"("created_at");

-- CreateIndex
CREATE INDEX "idx_module" ON "activity_logs"("module");

-- CreateIndex
CREATE INDEX "idx_module_action" ON "activity_logs"("module", "action");

-- CreateIndex
CREATE INDEX "activity_logs_idx_user_id" ON "activity_logs"("user_id");

-- CreateIndex
CREATE INDEX "idx_login_histories_user_id" ON "login_histories"("user_id");

-- CreateIndex
CREATE INDEX "idx_login_histories_created_at" ON "login_histories"("created_at");

-- CreateIndex
CREATE INDEX "idx_login_histories_ip_address" ON "login_histories"("ip_address");

-- CreateIndex
CREATE INDEX "aparatur_desa_desa_id_foreign" ON "aparatur_desa"("desa_id");

-- CreateIndex
CREATE INDEX "aparatur_desa_produk_hukum_id_foreign" ON "aparatur_desa"("produk_hukum_id");

-- CreateIndex
CREATE INDEX "aparatur_desa_dapur_id_index" ON "aparatur_desa"("dapur_id");

-- CreateIndex
CREATE INDEX "aparatur_desa_nik_index" ON "aparatur_desa"("nik");

-- CreateIndex
CREATE UNIQUE INDEX "aparatur_dapur_desa_dapur_id_unique" ON "aparatur_dapur_desa"("dapur_id");

-- CreateIndex
CREATE INDEX "aparatur_dapur_desa_desa_id_index" ON "aparatur_dapur_desa"("desa_id");

-- CreateIndex
CREATE INDEX "aparatur_dapur_desa_nama_normal_index" ON "aparatur_dapur_desa"("nama_normal");

-- CreateIndex
CREATE INDEX "aparatur_dapur_desa_status_index" ON "aparatur_dapur_desa"("status_rekonsiliasi");

-- CreateIndex
CREATE UNIQUE INDEX "app_settings_setting_key_key" ON "app_settings"("setting_key");

-- CreateIndex
CREATE INDEX "fk_app_settings_user_idx" ON "app_settings"("updated_by_user_id");

-- CreateIndex
CREATE INDEX "idx_setting_key" ON "app_settings"("setting_key");

-- CreateIndex
CREATE INDEX "idx_dinas_terkait" ON "bankeu_master_kegiatan"("dinas_terkait");

-- CreateIndex
CREATE INDEX "bankeu_master_kegiatan_idx_jenis" ON "bankeu_master_kegiatan"("jenis_kegiatan");

-- CreateIndex
CREATE INDEX "idx_bankeu_proposal_2025_desa_id" ON "bankeu_proposal_2025"("desa_id");

-- CreateIndex
CREATE INDEX "idx_bankeu_proposal_2025_tahun" ON "bankeu_proposal_2025"("tahun_anggaran");

-- CreateIndex
CREATE INDEX "idx_bankeu_proposal_2025_desa_tahun" ON "bankeu_proposal_2025"("desa_id", "tahun_anggaran");

-- CreateIndex
CREATE INDEX "idx_bankeu_proposal_2025_uploaded_by" ON "bankeu_proposal_2025"("uploaded_by");

-- CreateIndex
CREATE INDEX "idx_kegiatan_id" ON "bankeu_proposal_kegiatan"("kegiatan_id");

-- CreateIndex
CREATE INDEX "bankeu_proposal_kegiatan_idx_proposal_id" ON "bankeu_proposal_kegiatan"("proposal_id");

-- CreateIndex
CREATE UNIQUE INDEX "unique_proposal_kegiatan" ON "bankeu_proposal_kegiatan"("proposal_id", "kegiatan_id");

-- CreateIndex
CREATE INDEX "idx_bankeu_lpj_desa_tahun" ON "bankeu_lpj"("desa_id", "tahun_anggaran");

-- CreateIndex
CREATE INDEX "idx_bankeu_lpj_desa_id" ON "bankeu_lpj"("desa_id");

-- CreateIndex
CREATE INDEX "idx_bankeu_lpj_tahun" ON "bankeu_lpj"("tahun_anggaran");

-- CreateIndex
CREATE INDEX "idx_bankeu_lpj_status" ON "bankeu_lpj"("status");

-- CreateIndex
CREATE INDEX "fk_bankeu_lpj_user" ON "bankeu_lpj"("uploaded_by");

-- CreateIndex
CREATE UNIQUE INDEX "uq_bankeu_lpj_video_desa_tahun" ON "bankeu_lpj_video"("desa_id", "tahun_anggaran");

-- CreateIndex
CREATE INDEX "idx_bankeu_lpj_sts_desa_tahun" ON "bankeu_lpj_sts"("desa_id", "tahun_anggaran");

-- CreateIndex
CREATE INDEX "fk_bankeu_lpj_sts_user" ON "bankeu_lpj_sts"("uploaded_by");

-- CreateIndex
CREATE INDEX "idx_bantuan_provinsi_lpj_desa_id" ON "bantuan_provinsi_lpj"("desa_id");

-- CreateIndex
CREATE INDEX "idx_bantuan_provinsi_lpj_tahun" ON "bantuan_provinsi_lpj"("tahun_anggaran");

-- CreateIndex
CREATE INDEX "idx_bantuan_provinsi_lpj_status" ON "bantuan_provinsi_lpj"("status");

-- CreateIndex
CREATE INDEX "idx_bantuan_provinsi_lpj_uploaded_by" ON "bantuan_provinsi_lpj"("uploaded_by");

-- CreateIndex
CREATE INDEX "idx_bantuan_provinsi_lpj_verified_by" ON "bantuan_provinsi_lpj"("dpmd_verified_by");

-- CreateIndex
CREATE INDEX "bankeu_proposals_idx_created_by" ON "bankeu_proposals"("created_by");

-- CreateIndex
CREATE INDEX "idx_desa" ON "bankeu_proposals"("desa_id");

-- CreateIndex
CREATE INDEX "idx_dinas_status" ON "bankeu_proposals"("dinas_status");

-- CreateIndex
CREATE INDEX "idx_dinas_verified_by" ON "bankeu_proposals"("dinas_verified_by");

-- CreateIndex
CREATE INDEX "idx_dpmd_status" ON "bankeu_proposals"("dpmd_status");

-- CreateIndex
CREATE INDEX "idx_dpmd_verified_by" ON "bankeu_proposals"("dpmd_verified_by");

-- CreateIndex
CREATE INDEX "bankeu_proposals_idx_kecamatan_status" ON "bankeu_proposals"("kecamatan_status");

-- CreateIndex
CREATE INDEX "idx_kecamatan_verified_by" ON "bankeu_proposals"("kecamatan_verified_by");

-- CreateIndex
CREATE INDEX "bankeu_proposals_idx_status" ON "bankeu_proposals"("status");

-- CreateIndex
CREATE INDEX "idx_submitted_to_dpmd" ON "bankeu_proposals"("submitted_to_dpmd");

-- CreateIndex
CREATE INDEX "idx_submitted_to_kecamatan" ON "bankeu_proposals"("submitted_to_kecamatan");

-- CreateIndex
CREATE INDEX "idx_troubleshoot_by" ON "bankeu_proposals"("troubleshoot_by");

-- CreateIndex
CREATE INDEX "idx_verified_by" ON "bankeu_proposals"("verified_by");

-- CreateIndex
CREATE INDEX "bankeu_verification_questionnaires_idx_dinas_id" ON "bankeu_verification_questionnaires"("dinas_id");

-- CreateIndex
CREATE INDEX "idx_questionnaire_proposal" ON "bankeu_verification_questionnaires"("proposal_id");

-- CreateIndex
CREATE INDEX "idx_questionnaire_tim" ON "bankeu_verification_questionnaires"("tim_verifikasi_id");

-- CreateIndex
CREATE INDEX "idx_verifikasi_type" ON "bankeu_verification_questionnaires"("verifikasi_type");

-- CreateIndex
CREATE UNIQUE INDEX "idx_questionnaire_proposal_tim" ON "bankeu_verification_questionnaires"("proposal_id", "tim_verifikasi_id");

-- CreateIndex
CREATE INDEX "idx_bpmk_kategori" ON "bankeu_perubahan_master_kegiatan"("kategori");

-- CreateIndex
CREATE INDEX "idx_bpmk_active" ON "bankeu_perubahan_master_kegiatan"("is_active");

-- CreateIndex
CREATE INDEX "idx_bppk_kegiatan" ON "bankeu_perubahan_proposal_kegiatan"("kegiatan_id");

-- CreateIndex
CREATE INDEX "idx_bppk_proposal" ON "bankeu_perubahan_proposal_kegiatan"("proposal_id");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_bppk_proposal_kegiatan" ON "bankeu_perubahan_proposal_kegiatan"("proposal_id", "kegiatan_id");

-- CreateIndex
CREATE INDEX "idx_bp_per_desa" ON "bankeu_perubahan_proposals"("desa_id");

-- CreateIndex
CREATE INDEX "idx_bp_per_kecamatan" ON "bankeu_perubahan_proposals"("kecamatan_id");

-- CreateIndex
CREATE INDEX "idx_bp_per_tahun" ON "bankeu_perubahan_proposals"("tahun_anggaran");

-- CreateIndex
CREATE INDEX "idx_bp_per_status" ON "bankeu_perubahan_proposals"("status");

-- CreateIndex
CREATE INDEX "idx_bp_per_kec_status" ON "bankeu_perubahan_proposals"("kecamatan_status");

-- CreateIndex
CREATE INDEX "idx_bp_per_dpmd_status" ON "bankeu_perubahan_proposals"("dpmd_status");

-- CreateIndex
CREATE INDEX "idx_bp_per_submitted_kec" ON "bankeu_perubahan_proposals"("submitted_to_kecamatan");

-- CreateIndex
CREATE INDEX "idx_bp_per_submitted_dpmd" ON "bankeu_perubahan_proposals"("submitted_to_dpmd");

-- CreateIndex
CREATE INDEX "idx_bp_per_created_by" ON "bankeu_perubahan_proposals"("created_by");

-- CreateIndex
CREATE INDEX "idx_bp_per_kec_verified_by" ON "bankeu_perubahan_proposals"("kecamatan_verified_by");

-- CreateIndex
CREATE INDEX "idx_bp_per_dpmd_verified_by" ON "bankeu_perubahan_proposals"("dpmd_verified_by");

-- CreateIndex
CREATE INDEX "idx_bp_per_verified_by" ON "bankeu_perubahan_proposals"("verified_by");

-- CreateIndex
CREATE INDEX "idx_bppv_proposal" ON "bankeu_perubahan_proposal_versions"("proposal_id");

-- CreateIndex
CREATE INDEX "idx_bppv_uploaded_by" ON "bankeu_perubahan_proposal_versions"("uploaded_by");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_bppv_proposal_version" ON "bankeu_perubahan_proposal_versions"("proposal_id", "version_number");

-- CreateIndex
CREATE INDEX "idx_bpr_proposal" ON "bankeu_perubahan_revisions"("proposal_id");

-- CreateIndex
CREATE INDEX "idx_bpr_version" ON "bankeu_perubahan_revisions"("version_id");

-- CreateIndex
CREATE INDEX "idx_bpr_annotated_by" ON "bankeu_perubahan_revisions"("annotated_by");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_kecamatan_perubahan" ON "kecamatan_bankeu_perubahan_config"("kecamatan_id");

-- CreateIndex
CREATE INDEX "idx_kbpc_kecamatan" ON "kecamatan_bankeu_perubahan_config"("kecamatan_id");

-- CreateIndex
CREATE INDEX "idx_tvbp_kecamatan" ON "tim_verifikasi_bankeu_perubahan"("kecamatan_id");

-- CreateIndex
CREATE INDEX "idx_tvbp_proposal" ON "tim_verifikasi_bankeu_perubahan"("proposal_id");

-- CreateIndex
CREATE INDEX "idx_tvbp_jabatan" ON "tim_verifikasi_bankeu_perubahan"("jabatan");

-- CreateIndex
CREATE INDEX "idx_tvbp_active" ON "tim_verifikasi_bankeu_perubahan"("is_active");

-- CreateIndex
CREATE INDEX "idx_bpq_proposal" ON "bankeu_perubahan_questionnaires"("proposal_id");

-- CreateIndex
CREATE INDEX "idx_bpq_tim" ON "bankeu_perubahan_questionnaires"("tim_verifikasi_id");

-- CreateIndex
CREATE INDEX "idx_bpq_type" ON "bankeu_perubahan_questionnaires"("verifikasi_type");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_bpq_proposal_tim" ON "bankeu_perubahan_questionnaires"("proposal_id", "tim_verifikasi_id");

-- CreateIndex
CREATE INDEX "idx_bplp_desa_tahun" ON "bankeu_perubahan_lpj"("desa_id", "tahun_anggaran");

-- CreateIndex
CREATE INDEX "idx_bplp_desa" ON "bankeu_perubahan_lpj"("desa_id");

-- CreateIndex
CREATE INDEX "idx_bplp_tahun" ON "bankeu_perubahan_lpj"("tahun_anggaran");

-- CreateIndex
CREATE INDEX "idx_bplp_status" ON "bankeu_perubahan_lpj"("status");

-- CreateIndex
CREATE INDEX "fk_bplp_uploaded_by" ON "bankeu_perubahan_lpj"("uploaded_by");

-- CreateIndex
CREATE INDEX "fk_bplp_dpmd_verified_by" ON "bankeu_perubahan_lpj"("dpmd_verified_by");

-- CreateIndex
CREATE UNIQUE INDEX "slug" ON "berita"("slug");

-- CreateIndex
CREATE INDEX "idx_kategori" ON "berita"("kategori");

-- CreateIndex
CREATE INDEX "idx_slug" ON "berita"("slug");

-- CreateIndex
CREATE INDEX "berita_idx_status" ON "berita"("status");

-- CreateIndex
CREATE INDEX "idx_tanggal_publish" ON "berita"("tanggal_publish");

-- CreateIndex
CREATE INDEX "informasi_idx_is_active" ON "informasi"("is_active");

-- CreateIndex
CREATE INDEX "idx_urutan" ON "informasi"("urutan");

-- CreateIndex
CREATE INDEX "informasi_idx_created_by" ON "informasi"("created_by");

-- CreateIndex
CREATE INDEX "anggaran_bidang_units_idx_bidang_id" ON "anggaran_bidang_units"("bidang_id");

-- CreateIndex
CREATE INDEX "anggaran_master_kegiatan_idx_bidang_id" ON "anggaran_master_kegiatan"("bidang_id");

-- CreateIndex
CREATE INDEX "idx_bidang_unit_id" ON "anggaran_master_kegiatan"("bidang_unit_id");

-- CreateIndex
CREATE INDEX "idx_kode_kegiatan" ON "anggaran_master_kegiatan"("kode_kegiatan");

-- CreateIndex
CREATE INDEX "anggaran_master_kegiatan_idx_is_active" ON "anggaran_master_kegiatan"("is_active");

-- CreateIndex
CREATE INDEX "fk_amk_user" ON "anggaran_master_kegiatan"("created_by");

-- CreateIndex
CREATE INDEX "anggaran_pagu_idx_tahun" ON "anggaran_pagu"("tahun");

-- CreateIndex
CREATE INDEX "fk_ap_user" ON "anggaran_pagu"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "uk_pagu_kegiatan_tahun" ON "anggaran_pagu"("master_kegiatan_id", "tahun");

-- CreateIndex
CREATE UNIQUE INDEX "uq_rekening_ref_kode" ON "rekening_ref"("kode_rekening");

-- CreateIndex
CREATE INDEX "idx_angkas_pagu" ON "anggaran_kas"("pagu_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_angkas_pagu_rekening" ON "anggaran_kas"("pagu_id", "kode_rekening");

-- CreateIndex
CREATE INDEX "idx_pagu_id" ON "anggaran_rka_items"("pagu_id");

-- CreateIndex
CREATE INDEX "fk_ari_user" ON "anggaran_rka_items"("created_by");

-- CreateIndex
CREATE INDEX "bumdes_idx_desa_id" ON "bumdes"("desa_id");

-- CreateIndex
CREATE INDEX "bumdes_idx_kecamatan" ON "bumdes"("kecamatan");

-- CreateIndex
CREATE INDEX "idx_kode_desa" ON "bumdes"("kode_desa");

-- CreateIndex
CREATE INDEX "idx_produk_hukum_perdes_id" ON "bumdes"("produk_hukum_perdes_id");

-- CreateIndex
CREATE INDEX "idx_produk_hukum_sk_bumdes_id" ON "bumdes"("produk_hukum_sk_bumdes_id");

-- CreateIndex
CREATE INDEX "bumdes_idx_status" ON "bumdes"("status");

-- CreateIndex
CREATE INDEX "idx_bumdes_diisi_desa_at" ON "bumdes"("diisi_desa_at");

-- CreateIndex
CREATE INDEX "bumdes_produk_bumdes_index" ON "bumdes_produk"("bumdes_id");

-- CreateIndex
CREATE INDEX "bumdes_produk_desa_index" ON "bumdes_produk"("desa_id");

-- CreateIndex
CREATE INDEX "bumdes_produk_kategori_index" ON "bumdes_produk"("kategori");

-- CreateIndex
CREATE INDEX "fk_desa_bankeu_surat_reviewer" ON "desa_bankeu_surat"("kecamatan_reviewed_by");

-- CreateIndex
CREATE INDEX "desa_bankeu_surat_idx_desa_id" ON "desa_bankeu_surat"("desa_id");

-- CreateIndex
CREATE INDEX "desa_bankeu_surat_idx_kecamatan_status" ON "desa_bankeu_surat"("kecamatan_status");

-- CreateIndex
CREATE INDEX "idx_submitted" ON "desa_bankeu_surat"("submitted_to_kecamatan");

-- CreateIndex
CREATE INDEX "desa_bankeu_surat_idx_tahun" ON "desa_bankeu_surat"("tahun");

-- CreateIndex
CREATE UNIQUE INDEX "unique_desa_tahun" ON "desa_bankeu_surat"("desa_id", "tahun");

-- CreateIndex
CREATE UNIQUE INDEX "desas_kode_unique" ON "desas"("kode");

-- CreateIndex
CREATE INDEX "desas_kecamatan_id_foreign" ON "desas"("kecamatan_id");

-- CreateIndex
CREATE UNIQUE INDEX "unique_dinas_id" ON "dinas_config"("dinas_id");

-- CreateIndex
CREATE INDEX "dinas_verifikator_idx_dinas_id" ON "dinas_verifikator"("dinas_id");

-- CreateIndex
CREATE INDEX "idx_is_active_dv" ON "dinas_verifikator"("is_active");

-- CreateIndex
CREATE INDEX "dinas_verifikator_idx_user_id" ON "dinas_verifikator"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "unique_user_per_dinas" ON "dinas_verifikator"("dinas_id", "user_id");

-- CreateIndex
CREATE INDEX "idx_dari_user" ON "disposisi"("dari_user_id");

-- CreateIndex
CREATE INDEX "idx_disposisi_ke_status" ON "disposisi"("ke_user_id", "status");

-- CreateIndex
CREATE INDEX "idx_disposisi_surat_level" ON "disposisi"("surat_id", "level_disposisi");

-- CreateIndex
CREATE INDEX "idx_ke_user" ON "disposisi"("ke_user_id");

-- CreateIndex
CREATE INDEX "disposisi_idx_level" ON "disposisi"("level_disposisi");

-- CreateIndex
CREATE INDEX "disposisi_idx_status" ON "disposisi"("status");

-- CreateIndex
CREATE INDEX "disposisi_idx_surat_id" ON "disposisi"("surat_id");

-- CreateIndex
CREATE INDEX "idx_jadwal_kegiatan_approved_by" ON "jadwal_kegiatan"("approved_by");

-- CreateIndex
CREATE INDEX "idx_jadwal_kegiatan_bidang_id" ON "jadwal_kegiatan"("bidang_id");

-- CreateIndex
CREATE INDEX "idx_jadwal_kegiatan_created_by" ON "jadwal_kegiatan"("created_by");

-- CreateIndex
CREATE INDEX "idx_jadwal_kegiatan_kategori" ON "jadwal_kegiatan"("kategori");

-- CreateIndex
CREATE INDEX "idx_jadwal_kegiatan_prioritas" ON "jadwal_kegiatan"("prioritas");

-- CreateIndex
CREATE INDEX "idx_jadwal_kegiatan_status" ON "jadwal_kegiatan"("status");

-- CreateIndex
CREATE INDEX "idx_jk_surat_masuk" ON "jadwal_kegiatan"("surat_masuk_id");

-- CreateIndex
CREATE INDEX "idx_jadwal_kegiatan_tanggal_mulai" ON "jadwal_kegiatan"("tanggal_mulai");

-- CreateIndex
CREATE INDEX "idx_jadwal_kegiatan_tanggal_selesai" ON "jadwal_kegiatan"("tanggal_selesai");

-- CreateIndex
CREATE INDEX "idx_jadwal_kegiatan_bidang_jadwal" ON "jadwal_kegiatan_bidang"("jadwal_kegiatan_id");

-- CreateIndex
CREATE INDEX "idx_jadwal_kegiatan_bidang_bidang" ON "jadwal_kegiatan_bidang"("bidang_id");

-- CreateIndex
CREATE UNIQUE INDEX "uk_jadwal_bidang" ON "jadwal_kegiatan_bidang"("jadwal_kegiatan_id", "bidang_id");

-- CreateIndex
CREATE INDEX "idx_jkv_user" ON "jadwal_kegiatan_views"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uk_jadwal_view" ON "jadwal_kegiatan_views"("jadwal_kegiatan_id", "user_id");

-- CreateIndex
CREATE INDEX "idx_jkr_user" ON "jadwal_kegiatan_reactions"("user_id");

-- CreateIndex
CREATE INDEX "idx_jkr_emoji" ON "jadwal_kegiatan_reactions"("emoji");

-- CreateIndex
CREATE UNIQUE INDEX "uk_jadwal_reaction" ON "jadwal_kegiatan_reactions"("jadwal_kegiatan_id", "user_id", "emoji");

-- CreateIndex
CREATE INDEX "idx_jkc_jadwal" ON "jadwal_kegiatan_comments"("jadwal_kegiatan_id");

-- CreateIndex
CREATE INDEX "idx_jkc_user" ON "jadwal_kegiatan_comments"("user_id");

-- CreateIndex
CREATE INDEX "karang_tarunas_desa_id_foreign" ON "karang_tarunas"("desa_id");

-- CreateIndex
CREATE INDEX "karang_tarunas_produk_hukum_id_foreign" ON "karang_tarunas"("produk_hukum_id");

-- CreateIndex
CREATE INDEX "karang_tarunas_imported_index" ON "karang_tarunas"("imported");

-- CreateIndex
CREATE INDEX "lembaga_lainnyas_desa_id_foreign" ON "lembaga_lainnyas"("desa_id");

-- CreateIndex
CREATE INDEX "lembaga_lainnyas_produk_hukum_id_foreign" ON "lembaga_lainnyas"("produk_hukum_id");

-- CreateIndex
CREATE INDEX "lembaga_lainnyas_imported_index" ON "lembaga_lainnyas"("imported");

-- CreateIndex
CREATE UNIQUE INDEX "kecamatan_id" ON "kecamatan_bankeu_config"("kecamatan_id");

-- CreateIndex
CREATE INDEX "kecamatan_bankeu_config_idx_kecamatan" ON "kecamatan_bankeu_config"("kecamatan_id");

-- CreateIndex
CREATE UNIQUE INDEX "kecamatans_kode_unique" ON "kecamatans"("kode");

-- CreateIndex
CREATE INDEX "kegiatan_bidang_id_bidang_foreign" ON "kegiatan_bidang"("id_bidang");

-- CreateIndex
CREATE INDEX "kegiatan_bidang_id_kegiatan_foreign" ON "kegiatan_bidang"("id_kegiatan");

-- CreateIndex
CREATE INDEX "kegiatan_pegawai_id_kegiatan_bidang_foreign" ON "kegiatan_pegawai"("id_kegiatan_bidang");

-- CreateIndex
CREATE INDEX "kegiatan_pegawai_id_kegiatan_foreign" ON "kegiatan_pegawai"("id_kegiatan");

-- CreateIndex
CREATE INDEX "kegiatan_pegawai_id_pegawai_foreign" ON "kegiatan_pegawai"("id_pegawai");

-- CreateIndex
CREATE UNIQUE INDEX "unique_kegiatan_bidang_pegawai" ON "kegiatan_pegawai"("id_kegiatan_bidang", "id_pegawai");

-- CreateIndex
CREATE INDEX "idx_activity_type" ON "kelembagaan_activity_logs"("activity_type");

-- CreateIndex
CREATE INDEX "kelembagaan_activity_logs_idx_created_at" ON "kelembagaan_activity_logs"("created_at");

-- CreateIndex
CREATE INDEX "kelembagaan_activity_logs_idx_desa_id" ON "kelembagaan_activity_logs"("desa_id");

-- CreateIndex
CREATE INDEX "idx_entity_type" ON "kelembagaan_activity_logs"("entity_type");

-- CreateIndex
CREATE INDEX "idx_kelembagaan_type_id" ON "kelembagaan_activity_logs"("kelembagaan_type", "kelembagaan_id");

-- CreateIndex
CREATE INDEX "kelembagaan_activity_logs_idx_user_id" ON "kelembagaan_activity_logs"("user_id");

-- CreateIndex
CREATE INDEX "kelurahan_idx_kecamatan" ON "kelurahan"("id_kecamatan");

-- CreateIndex
CREATE INDEX "idx_kelurahan" ON "kelurahan"("kelurahan");

-- CreateIndex
CREATE INDEX "lampiran_surat_idx_surat_id" ON "lampiran_surat"("surat_id");

-- CreateIndex
CREATE INDEX "lampiran_surat_uploaded_by_fkey" ON "lampiran_surat"("uploaded_by");

-- CreateIndex
CREATE INDEX "lpms_desa_id_foreign" ON "lpms"("desa_id");

-- CreateIndex
CREATE INDEX "lpms_produk_hukum_id_foreign" ON "lpms"("produk_hukum_id");

-- CreateIndex
CREATE INDEX "lpms_imported_index" ON "lpms"("imported");

-- CreateIndex
CREATE INDEX "idx_notifications_user_id" ON "notifications"("user_id");

-- CreateIndex
CREATE INDEX "idx_notifications_user_read" ON "notifications"("user_id", "is_read");

-- CreateIndex
CREATE INDEX "idx_notifications_created" ON "notifications"("created_at");

-- CreateIndex
CREATE INDEX "idx_notifications_type" ON "notifications"("type");

-- CreateIndex
CREATE INDEX "fk_notifications_sent_by" ON "notifications"("sent_by");

-- CreateIndex
CREATE INDEX "notification_logs_sender_id_index" ON "notification_logs"("sender_id");

-- CreateIndex
CREATE INDEX "notification_logs_created_at_index" ON "notification_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "kode_dinas" ON "master_dinas"("kode_dinas");

-- CreateIndex
CREATE INDEX "master_dinas_idx_is_active" ON "master_dinas"("is_active");

-- CreateIndex
CREATE INDEX "idx_kode_dinas" ON "master_dinas"("kode_dinas");

-- CreateIndex
CREATE INDEX "pegawai_id_bidang_foreign" ON "pegawai"("id_bidang");

-- CreateIndex
CREATE INDEX "absensi_pegawai_user_id_index" ON "absensi_pegawai"("user_id");

-- CreateIndex
CREATE INDEX "absensi_pegawai_tanggal_index" ON "absensi_pegawai"("tanggal");

-- CreateIndex
CREATE UNIQUE INDEX "absensi_pegawai_user_tanggal_unique" ON "absensi_pegawai"("user_id", "tanggal");

-- CreateIndex
CREATE UNIQUE INDEX "absensi_settings_key_key" ON "absensi_settings"("key");

-- CreateIndex
CREATE UNIQUE INDEX "absensi_success_messages_type_key" ON "absensi_success_messages"("type");

-- CreateIndex
CREATE INDEX "idx_type" ON "absensi_success_messages"("type");

-- CreateIndex
CREATE INDEX "idx_active" ON "absensi_success_messages"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "absensi_reminder_templates_type_key" ON "absensi_reminder_templates"("type");

-- CreateIndex
CREATE UNIQUE INDEX "absensi_weekly_awards_week_key_key" ON "absensi_weekly_awards"("week_key");

-- CreateIndex
CREATE INDEX "idx_absensi_awards_period_end" ON "absensi_weekly_awards"("period_end");

-- CreateIndex
CREATE INDEX "idx_absensi_awards_generated_at" ON "absensi_weekly_awards"("generated_at");

-- CreateIndex
CREATE INDEX "pejabat_ttd_idx_jenis" ON "pejabat_ttd"("jenis_pejabat");

-- CreateIndex
CREATE INDEX "pejabat_ttd_idx_kecamatan" ON "pejabat_ttd"("kecamatan_id");

-- CreateIndex
CREATE INDEX "idx_pejabat" ON "pejabat_ttd"("pejabat_id");

-- CreateIndex
CREATE INDEX "idx_pengurusable" ON "pengurus"("pengurusable_type", "pengurusable_id");

-- CreateIndex
CREATE INDEX "idx_status_jabatan" ON "pengurus"("status_jabatan");

-- CreateIndex
CREATE INDEX "pengurus_desa_id_foreign" ON "pengurus"("desa_id");

-- CreateIndex
CREATE INDEX "pengurus_imported_index" ON "pengurus"("imported");

-- CreateIndex
CREATE INDEX "fk_perjadin_grup_creator" ON "perjadin_grup"("created_by");

-- CreateIndex
CREATE INDEX "idx_perjadin_grup_desa" ON "perjadin_grup"("desa_tujuan_id");

-- CreateIndex
CREATE INDEX "idx_perjadin_grup_tanggal" ON "perjadin_grup"("tanggal_berangkat", "tanggal_kembali");

-- CreateIndex
CREATE INDEX "petugas_monitoring_desa_id_kecamatan_id_index" ON "petugas_monitoring"("desa_id", "kecamatan_id");

-- CreateIndex
CREATE INDEX "petugas_monitoring_kecamatan_id_foreign" ON "petugas_monitoring"("kecamatan_id");

-- CreateIndex
CREATE INDEX "pkks_desa_id_foreign" ON "pkks"("desa_id");

-- CreateIndex
CREATE INDEX "pkks_produk_hukum_id_foreign" ON "pkks"("produk_hukum_id");

-- CreateIndex
CREATE INDEX "pkks_imported_index" ON "pkks"("imported");

-- CreateIndex
CREATE INDEX "posyandus_desa_id_foreign" ON "posyandus"("desa_id");

-- CreateIndex
CREATE INDEX "posyandus_produk_hukum_id_foreign" ON "posyandus"("produk_hukum_id");

-- CreateIndex
CREATE INDEX "posyandus_imported_index" ON "posyandus"("imported");

-- CreateIndex
CREATE UNIQUE INDEX "produk_hukums_uuid_unique" ON "produk_hukums"("uuid");

-- CreateIndex
CREATE INDEX "produk_hukums_desa_id_foreign" ON "produk_hukums"("desa_id");

-- CreateIndex
CREATE INDEX "idx_phb_bidang" ON "produk_hukum_bidang"("bidang_id", "tahun");

-- CreateIndex
CREATE INDEX "idx_phb_jenis" ON "produk_hukum_bidang"("singkatan_jenis");

-- CreateIndex
CREATE INDEX "idx_phb_status" ON "produk_hukum_bidang"("status_peraturan");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_produk_hukum_bidang" ON "produk_hukum_bidang"("bidang_id", "singkatan_jenis", "nomor", "tahun");

-- CreateIndex
CREATE INDEX "idx_phr_tingkat" ON "produk_hukum_referensi"("tingkat", "urutan");

-- CreateIndex
CREATE INDEX "idx_phr_topik" ON "produk_hukum_referensi"("topik");

-- CreateIndex
CREATE INDEX "idx_phr_aktif" ON "produk_hukum_referensi"("aktif");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_produk_hukum_referensi" ON "produk_hukum_referensi"("singkatan_jenis", "nomor", "tahun");

-- CreateIndex
CREATE UNIQUE INDEX "profil_desas_desa_id_unique" ON "profil_desas"("desa_id");

-- CreateIndex
CREATE INDEX "push_subscriptions_user_id_index" ON "push_subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "rts_desa_id_foreign" ON "rts"("desa_id");

-- CreateIndex
CREATE INDEX "rts_produk_hukum_id_foreign" ON "rts"("produk_hukum_id");

-- CreateIndex
CREATE INDEX "rts_imported_index" ON "rts"("imported");

-- CreateIndex
CREATE UNIQUE INDEX "unique_rw_nomor" ON "rts"("rw_id", "nomor");

-- CreateIndex
CREATE INDEX "rws_produk_hukum_id_foreign" ON "rws"("produk_hukum_id");

-- CreateIndex
CREATE INDEX "rws_imported_index" ON "rws"("imported");

-- CreateIndex
CREATE UNIQUE INDEX "rws_desa_id_nomor_unique" ON "rws"("desa_id", "nomor");

-- CreateIndex
CREATE INDEX "satlinmas_desa_id_foreign" ON "satlinmas"("desa_id");

-- CreateIndex
CREATE INDEX "satlinmas_produk_hukum_id_foreign" ON "satlinmas"("produk_hukum_id");

-- CreateIndex
CREATE INDEX "satlinmas_imported_index" ON "satlinmas"("imported");

-- CreateIndex
CREATE UNIQUE INDEX "surat_masuk_nomor_surat_key" ON "surat_masuk"("nomor_surat");

-- CreateIndex
CREATE INDEX "surat_masuk_idx_created_by" ON "surat_masuk"("created_by");

-- CreateIndex
CREATE INDEX "surat_masuk_idx_status" ON "surat_masuk"("status");

-- CreateIndex
CREATE INDEX "idx_surat_status_tanggal" ON "surat_masuk"("status", "tanggal_surat" DESC);

-- CreateIndex
CREATE INDEX "idx_tanggal_surat" ON "surat_masuk"("tanggal_surat");

-- CreateIndex
CREATE INDEX "idx_jabatan" ON "tim_verifikasi_kecamatan"("jabatan");

-- CreateIndex
CREATE INDEX "tim_verifikasi_kecamatan_idx_kecamatan" ON "tim_verifikasi_kecamatan"("kecamatan_id");

-- CreateIndex
CREATE INDEX "tim_verifikasi_kecamatan_idx_proposal_id" ON "tim_verifikasi_kecamatan"("proposal_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_unique" ON "roles"("name");

-- CreateIndex
CREATE INDEX "tugas_pribadi_user_selesai_index" ON "tugas_pribadi"("user_id", "selesai", "tanggal_pengingat");

-- CreateIndex
CREATE INDEX "catatan_pribadi_user_index" ON "catatan_pribadi"("user_id", "disematkan", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_unique" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_pegawai_id_index" ON "users"("pegawai_id");

-- CreateIndex
CREATE INDEX "desa_user_permissions_user_id_index" ON "desa_user_permissions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "desa_user_permissions_unique" ON "desa_user_permissions"("user_id", "permission_key");

-- CreateIndex
CREATE INDEX "cctv_akses_user_index" ON "cctv_akses"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "cctv_akses_user_izin_unique" ON "cctv_akses"("user_id", "izin");

-- CreateIndex
CREATE INDEX "kecamatan_user_permissions_user_id_index" ON "kecamatan_user_permissions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "kecamatan_user_permissions_unique" ON "kecamatan_user_permissions"("user_id", "permission_key");

-- CreateIndex
CREATE INDEX "verifikator_akses_desa_idx_desa_id" ON "verifikator_akses_desa"("desa_id");

-- CreateIndex
CREATE INDEX "idx_kecamatan_id" ON "verifikator_akses_desa"("kecamatan_id");

-- CreateIndex
CREATE INDEX "idx_verifikator_id" ON "verifikator_akses_desa"("verifikator_id");

-- CreateIndex
CREATE UNIQUE INDEX "unique_verifikator_desa" ON "verifikator_akses_desa"("verifikator_id", "desa_id");

-- CreateIndex
CREATE UNIQUE INDEX "qr_code" ON "berita_acara_history"("qr_code");

-- CreateIndex
CREATE INDEX "fk_ba_history_generator" ON "berita_acara_history"("generated_by");

-- CreateIndex
CREATE INDEX "fk_ba_history_kegiatan" ON "berita_acara_history"("kegiatan_id");

-- CreateIndex
CREATE INDEX "idx_ba_history_desa" ON "berita_acara_history"("desa_id");

-- CreateIndex
CREATE INDEX "idx_ba_history_generated" ON "berita_acara_history"("generated_at");

-- CreateIndex
CREATE INDEX "idx_ba_history_kecamatan" ON "berita_acara_history"("kecamatan_id");

-- CreateIndex
CREATE INDEX "idx_ba_history_latest" ON "berita_acara_history"("desa_id", "is_latest");

-- CreateIndex
CREATE INDEX "idx_ba_history_proposal" ON "berita_acara_history"("proposal_id");

-- CreateIndex
CREATE INDEX "idx_ba_history_qr" ON "berita_acara_history"("qr_code");

-- CreateIndex
CREATE INDEX "fk_perjadin_approved_by" ON "perjadin_pegawai"("approved_by");

-- CreateIndex
CREATE INDEX "idx_perjadin_desa_tujuan" ON "perjadin_pegawai"("desa_tujuan_id");

-- CreateIndex
CREATE INDEX "idx_perjadin_pegawai_id" ON "perjadin_pegawai"("pegawai_id");

-- CreateIndex
CREATE INDEX "idx_perjadin_status" ON "perjadin_pegawai"("status");

-- CreateIndex
CREATE INDEX "idx_perjadin_tanggal" ON "perjadin_pegawai"("tanggal_berangkat", "tanggal_kembali");

-- CreateIndex
CREATE INDEX "idx_aktif_urutan" ON "info_banners"("aktif", "urutan");

-- CreateIndex
CREATE INDEX "idx_tanggal" ON "info_banners"("tanggal_mulai", "tanggal_selesai");

-- CreateIndex
CREATE INDEX "video_meeting_chats_idx_meeting_id" ON "video_meeting_chats"("meeting_id");

-- CreateIndex
CREATE INDEX "participant_id" ON "video_meeting_chats"("participant_id");

-- CreateIndex
CREATE INDEX "video_meeting_invitations_idx_meeting_id" ON "video_meeting_invitations"("meeting_id");

-- CreateIndex
CREATE INDEX "video_meeting_invitations_idx_user_id" ON "video_meeting_invitations"("user_id");

-- CreateIndex
CREATE INDEX "video_meeting_participants_idx_meeting_id" ON "video_meeting_participants"("meeting_id");

-- CreateIndex
CREATE INDEX "video_meeting_participants_idx_user_id" ON "video_meeting_participants"("user_id");

-- CreateIndex
CREATE INDEX "video_meeting_recordings_idx_meeting_id" ON "video_meeting_recordings"("meeting_id");

-- CreateIndex
CREATE UNIQUE INDEX "uuid" ON "video_meetings"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "room_id" ON "video_meetings"("room_id");

-- CreateIndex
CREATE INDEX "video_meetings_idx_bidang_id" ON "video_meetings"("bidang_id");

-- CreateIndex
CREATE INDEX "idx_host_id" ON "video_meetings"("host_id");

-- CreateIndex
CREATE INDEX "idx_room_id" ON "video_meetings"("room_id");

-- CreateIndex
CREATE INDEX "idx_scheduled_start" ON "video_meetings"("scheduled_start");

-- CreateIndex
CREATE INDEX "video_meetings_idx_status" ON "video_meetings"("status");

-- CreateIndex
CREATE INDEX "idx_us_user" ON "user_statuses"("user_id");

-- CreateIndex
CREATE INDEX "idx_us_expires" ON "user_statuses"("expires_at");

-- CreateIndex
CREATE INDEX "idx_sv_viewer" ON "status_views"("viewer_id");

-- CreateIndex
CREATE UNIQUE INDEX "uk_status_view" ON "status_views"("status_id", "viewer_id");

-- CreateIndex
CREATE UNIQUE INDEX "klasifikasi_arsip_kode_key" ON "klasifikasi_arsip"("kode");

-- CreateIndex
CREATE INDEX "idx_parent" ON "klasifikasi_arsip"("parent_kode");

-- CreateIndex
CREATE INDEX "klasifikasi_arsip_idx_level" ON "klasifikasi_arsip"("level");

-- CreateIndex
CREATE INDEX "idx_klasifikasi" ON "nomor_surat_requests"("klasifikasi_kode");

-- CreateIndex
CREATE INDEX "idx_nomorsurat_bidang" ON "nomor_surat_requests"("bidang_id");

-- CreateIndex
CREATE INDEX "idx_nomorsurat_requested_by" ON "nomor_surat_requests"("requested_by");

-- CreateIndex
CREATE INDEX "idx_nomorsurat_tahun" ON "nomor_surat_requests"("tahun");

-- CreateIndex
CREATE INDEX "idx_tahun_kode" ON "nomor_surat_requests"("tahun", "klasifikasi_kode");

-- CreateIndex
CREATE UNIQUE INDEX "uq_nomor_tahun" ON "nomor_surat_requests"("nomor_registrasi", "klasifikasi_kode", "tahun");

-- CreateIndex
CREATE INDEX "idx_conv_participant_one" ON "conversations"("participant_one_id");

-- CreateIndex
CREATE INDEX "idx_conv_participant_two" ON "conversations"("participant_two_id");

-- CreateIndex
CREATE INDEX "idx_conv_last_message_at" ON "conversations"("last_message_at");

-- CreateIndex
CREATE INDEX "idx_conv_type" ON "conversations"("type");

-- CreateIndex
CREATE INDEX "idx_conv_reference" ON "conversations"("reference_type", "reference_id");

-- CreateIndex
CREATE INDEX "idx_conv_is_group" ON "conversations"("is_group");

-- CreateIndex
CREATE UNIQUE INDEX "uk_conversation_context" ON "conversations"("participant_one_id", "participant_two_id", "reference_type", "reference_id");

-- CreateIndex
CREATE INDEX "idx_msg_conversation" ON "messages"("conversation_id");

-- CreateIndex
CREATE INDEX "idx_msg_sender" ON "messages"("sender_id");

-- CreateIndex
CREATE INDEX "idx_msg_reply_to" ON "messages"("reply_to_id");

-- CreateIndex
CREATE INDEX "idx_msg_created_at" ON "messages"("created_at");

-- CreateIndex
CREATE INDEX "idx_msg_is_read" ON "messages"("is_read");

-- CreateIndex
CREATE INDEX "idx_msg_reaction_message" ON "message_reactions"("message_id");

-- CreateIndex
CREATE INDEX "idx_msg_reaction_user" ON "message_reactions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uk_msg_reaction_user_emoji" ON "message_reactions"("message_id", "user_id", "emoji");

-- CreateIndex
CREATE INDEX "idx_cp_user" ON "conversation_participants"("user_id");

-- CreateIndex
CREATE INDEX "idx_cp_conversation" ON "conversation_participants"("conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "uk_cp_conv_user" ON "conversation_participants"("conversation_id", "user_id");

-- CreateIndex
CREATE INDEX "fk_pc_atasan_pb" ON "pencairan"("atasan_pengurus_barang_id");

-- CreateIndex
CREATE INDEX "fk_pc_bendahara" ON "pencairan"("bendahara_pengeluaran_id");

-- CreateIndex
CREATE INDEX "fk_pc_creator" ON "pencairan"("created_by");

-- CreateIndex
CREATE INDEX "fk_pc_finalized_by" ON "pencairan"("finalized_by");

-- CreateIndex
CREATE INDEX "fk_pc_kpa" ON "pencairan"("kpa_id");

-- CreateIndex
CREATE INDEX "fk_pc_penerima_fak" ON "pencairan"("penerima_faktur_id");

-- CreateIndex
CREATE INDEX "fk_pc_pengurus" ON "pencairan"("pengurus_barang_id");

-- CreateIndex
CREATE INDEX "fk_pc_ppk" ON "pencairan"("ppk_id");

-- CreateIndex
CREATE INDEX "fk_pc_pptk" ON "pencairan"("pptk_id");

-- CreateIndex
CREATE INDEX "idx_pc_bidang" ON "pencairan"("bidang_id");

-- CreateIndex
CREATE INDEX "idx_pc_jenis" ON "pencairan"("jenis_pencairan");

-- CreateIndex
CREATE INDEX "idx_pc_master" ON "pencairan"("master_kegiatan_id");

-- CreateIndex
CREATE INDEX "idx_pc_pagu" ON "pencairan"("pagu_id");

-- CreateIndex
CREATE INDEX "idx_pc_penyedia" ON "pencairan"("penyedia_id");

-- CreateIndex
CREATE INDEX "idx_pc_status" ON "pencairan"("status");

-- CreateIndex
CREATE INDEX "idx_pc_tahun" ON "pencairan"("tahun_anggaran");

-- CreateIndex
CREATE INDEX "idx_pci_pc" ON "pencairan_items"("pencairan_id");

-- CreateIndex
CREATE INDEX "idx_pci_rka" ON "pencairan_items"("rka_item_id");

-- CreateIndex
CREATE INDEX "idx_pcp_user" ON "pencairan_pemeriksa"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uk_pcp_pc_urutan" ON "pencairan_pemeriksa"("pencairan_id", "urutan");

-- CreateIndex
CREATE INDEX "fk_penyedia_creator" ON "penyedia"("created_by");

-- CreateIndex
CREATE INDEX "idx_penyedia_active" ON "penyedia"("is_active");

-- CreateIndex
CREATE INDEX "idx_penyedia_nama" ON "penyedia"("nama");

-- CreateIndex
CREATE UNIQUE INDEX "uq_arsip_barang_kode" ON "arsip_barang"("kode_barang");

-- CreateIndex
CREATE UNIQUE INDEX "uq_arsip_barang_token" ON "arsip_barang"("public_token");

-- CreateIndex
CREATE INDEX "fk_arsip_barang_creator" ON "arsip_barang"("created_by");

-- CreateIndex
CREATE INDEX "fk_arsip_barang_updater" ON "arsip_barang"("updated_by");

-- CreateIndex
CREATE INDEX "idx_arsip_barang_kategori" ON "arsip_barang"("kategori_id");

-- CreateIndex
CREATE INDEX "idx_arsip_barang_kondisi" ON "arsip_barang"("kondisi");

-- CreateIndex
CREATE INDEX "idx_arsip_barang_lokasi" ON "arsip_barang"("lokasi");

-- CreateIndex
CREATE INDEX "idx_arsip_barang_nama" ON "arsip_barang"("nama");

-- CreateIndex
CREATE INDEX "idx_arsip_barang_pemegang" ON "arsip_barang"("pemegang_user_id");

-- CreateIndex
CREATE INDEX "idx_arsip_barang_status" ON "arsip_barang"("status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_arsip_barang_kategori_kode" ON "arsip_barang_kategori"("kode");

-- CreateIndex
CREATE INDEX "idx_arsip_barang_kategori_active" ON "arsip_barang_kategori"("is_active");

-- CreateIndex
CREATE INDEX "fk_arsip_barang_mutasi_user" ON "arsip_barang_mutasi"("user_id");

-- CreateIndex
CREATE INDEX "idx_arsip_barang_mutasi_barang" ON "arsip_barang_mutasi"("barang_id", "created_at");

-- CreateIndex
CREATE INDEX "fk_arsip_barang_scan_user" ON "arsip_barang_scan_log"("user_id");

-- CreateIndex
CREATE INDEX "idx_arsip_barang_scan_barang" ON "arsip_barang_scan_log"("barang_id", "created_at");

-- CreateIndex
CREATE INDEX "fk_alk_creator" ON "absensi_lokasi_khusus"("created_by");

-- CreateIndex
CREATE INDEX "idx_alk_berlaku" ON "absensi_lokasi_khusus"("berlaku_mulai", "berlaku_sampai");

-- CreateIndex
CREATE INDEX "idx_alk_user_aktif" ON "absensi_lokasi_khusus"("user_id", "is_active");

-- CreateIndex
CREATE INDEX "idx_sk_ref_jenis_tahun" ON "pencairan_sk_ref"("jenis", "tahun");

-- CreateIndex
CREATE UNIQUE INDEX "uq_sk_ref_jenis_tahun_nomor" ON "pencairan_sk_ref"("jenis", "tahun", "nomor");

-- CreateIndex
CREATE INDEX "idx_drive_folder_bidang" ON "drive_folder"("bidang_id", "parent_id", "deleted_at");

-- CreateIndex
CREATE INDEX "idx_drive_folder_sampah" ON "drive_folder"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_drive_file_disk" ON "drive_file"("nama_disk");

-- CreateIndex
CREATE INDEX "idx_drive_file_bidang" ON "drive_file"("bidang_id", "folder_id", "deleted_at");

-- CreateIndex
CREATE INDEX "idx_drive_file_checksum" ON "drive_file"("bidang_id", "checksum");

-- CreateIndex
CREATE INDEX "idx_drive_file_sampah" ON "drive_file"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_drive_share_penerima" ON "drive_share"("penerima_tipe", "penerima_id");

-- CreateIndex
CREATE INDEX "idx_drive_share_objek" ON "drive_share"("objek_tipe", "objek_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_drive_share" ON "drive_share"("objek_tipe", "objek_id", "penerima_tipe", "penerima_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_formulir_token" ON "formulir"("token");

-- CreateIndex
CREATE INDEX "idx_formulir_bidang" ON "formulir"("bidang_id", "deleted_at");

-- CreateIndex
CREATE INDEX "idx_formulir_status" ON "formulir"("status", "deleted_at");

-- CreateIndex
CREATE INDEX "idx_formulir_pertanyaan_urut" ON "formulir_pertanyaan"("formulir_id", "urutan");

-- CreateIndex
CREATE INDEX "idx_formulir_respons_form" ON "formulir_respons"("formulir_id", "dikirim_pada");

-- CreateIndex
CREATE INDEX "idx_formulir_respons_user" ON "formulir_respons"("formulir_id", "user_id");

-- CreateIndex
CREATE INDEX "idx_formulir_jawaban_pertanyaan" ON "formulir_jawaban"("pertanyaan_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_formulir_jawaban" ON "formulir_jawaban"("respons_id", "pertanyaan_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_formulir_berkas_disk" ON "formulir_berkas"("nama_disk");

-- CreateIndex
CREATE INDEX "idx_formulir_berkas_respons" ON "formulir_berkas"("respons_id", "pertanyaan_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_video_desa_permintaan_token" ON "video_desa_permintaan"("token");

-- CreateIndex
CREATE INDEX "idx_video_desa_permintaan_bidang" ON "video_desa_permintaan"("bidang_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_video_desa_kiriman_disk" ON "video_desa_kiriman"("nama_disk");

-- CreateIndex
CREATE INDEX "idx_video_desa_kiriman_permintaan" ON "video_desa_kiriman"("permintaan_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_video_desa_kiriman_desa" ON "video_desa_kiriman"("permintaan_id", "desa_id");

-- CreateIndex
CREATE INDEX "idx_video_desa_kiriman_proses" ON "video_desa_kiriman"("pemrosesan");

-- CreateIndex
CREATE UNIQUE INDEX "uq_video_desa_tautan_token" ON "video_desa_tautan"("token");

-- CreateIndex
CREATE UNIQUE INDEX "kerjasama_desa_legalitas_desa_unique" ON "kerjasama_desa_legalitas"("desa_id");

-- CreateIndex
CREATE INDEX "kerjasama_desa_legalitas_produk_hukum_index" ON "kerjasama_desa_legalitas"("produk_hukum_id");

-- CreateIndex
CREATE INDEX "kerjasama_desa_desa_tahun_index" ON "kerjasama_desa"("desa_id", "tahun");

-- CreateIndex
CREATE INDEX "kerjasama_desa_bidang_index" ON "kerjasama_desa"("bidang");

-- CreateIndex
CREATE INDEX "kerjasama_desa_jenis_index" ON "kerjasama_desa"("jenis");

-- CreateIndex
CREATE UNIQUE INDEX "cctv_cameras_go2rtc_src_key" ON "cctv_cameras"("go2rtc_src");

-- CreateIndex
CREATE INDEX "idx_cctv_cameras_status" ON "cctv_cameras"("status");

-- CreateIndex
CREATE INDEX "idx_cctv_cameras_desa" ON "cctv_cameras"("desa_id");

-- CreateIndex
CREATE INDEX "idx_cctv_cameras_kecamatan" ON "cctv_cameras"("kecamatan_id");

-- CreateIndex
CREATE INDEX "idx_cctv_faces_nama" ON "cctv_faces"("nama");

-- CreateIndex
CREATE INDEX "idx_cctv_faces_kode" ON "cctv_faces"("kode_pegawai");

-- CreateIndex
CREATE INDEX "idx_cctv_face_embeddings_face" ON "cctv_face_embeddings"("face_id");

-- CreateIndex
CREATE UNIQUE INDEX "cctv_events_event_uuid_key" ON "cctv_events"("event_uuid");

-- CreateIndex
CREATE INDEX "idx_cctv_events_camera_time" ON "cctv_events"("camera_id", "occurred_at");

-- CreateIndex
CREATE INDEX "idx_cctv_events_time" ON "cctv_events"("occurred_at");

-- CreateIndex
CREATE INDEX "idx_cctv_events_status" ON "cctv_events"("status");

-- CreateIndex
CREATE INDEX "idx_cctv_events_type" ON "cctv_events"("type");

-- CreateIndex
CREATE INDEX "idx_cctv_events_severity" ON "cctv_events"("severity");

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_histories" ADD CONSTRAINT "fk_login_histories_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aparatur_desa" ADD CONSTRAINT "aparatur_desa_desa_id_foreign_fk" FOREIGN KEY ("desa_id") REFERENCES "desas"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "aparatur_desa" ADD CONSTRAINT "aparatur_desa_produk_hukum_id_foreign_fk" FOREIGN KEY ("produk_hukum_id") REFERENCES "produk_hukums"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "app_settings" ADD CONSTRAINT "fk_app_settings_user" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bankeu_proposal_2025" ADD CONSTRAINT "fk_bankeu_proposal_2025_desa" FOREIGN KEY ("desa_id") REFERENCES "desas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bankeu_proposal_2025" ADD CONSTRAINT "fk_bankeu_proposal_2025_user" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bankeu_proposal_kegiatan" ADD CONSTRAINT "fk_proposal_kegiatan_kegiatan" FOREIGN KEY ("kegiatan_id") REFERENCES "bankeu_master_kegiatan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bankeu_proposal_kegiatan" ADD CONSTRAINT "fk_proposal_kegiatan_proposal" FOREIGN KEY ("proposal_id") REFERENCES "bankeu_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bankeu_lpj" ADD CONSTRAINT "fk_bankeu_lpj_desa" FOREIGN KEY ("desa_id") REFERENCES "desas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bankeu_lpj" ADD CONSTRAINT "fk_bankeu_lpj_user_fk" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bankeu_lpj_video" ADD CONSTRAINT "fk_bankeu_lpj_video_desa" FOREIGN KEY ("desa_id") REFERENCES "desas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bankeu_lpj_sts" ADD CONSTRAINT "fk_bankeu_lpj_sts_desa" FOREIGN KEY ("desa_id") REFERENCES "desas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bankeu_lpj_sts" ADD CONSTRAINT "fk_bankeu_lpj_sts_user_fk" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bantuan_provinsi_lpj" ADD CONSTRAINT "fk_bantuan_provinsi_lpj_desa" FOREIGN KEY ("desa_id") REFERENCES "desas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bantuan_provinsi_lpj" ADD CONSTRAINT "fk_bantuan_provinsi_lpj_user" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bantuan_provinsi_lpj" ADD CONSTRAINT "fk_bantuan_provinsi_lpj_verified_by" FOREIGN KEY ("dpmd_verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bankeu_proposals" ADD CONSTRAINT "fk_bankeu_dpmd_verified_by" FOREIGN KEY ("dpmd_verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bankeu_proposals" ADD CONSTRAINT "fk_bankeu_kecamatan_verified_by" FOREIGN KEY ("kecamatan_verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bankeu_proposals" ADD CONSTRAINT "fk_bankeu_proposals_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bankeu_proposals" ADD CONSTRAINT "fk_bankeu_proposals_desa" FOREIGN KEY ("desa_id") REFERENCES "desas"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bankeu_proposals" ADD CONSTRAINT "fk_bankeu_proposals_verified_by" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bankeu_proposals" ADD CONSTRAINT "fk_bankeu_troubleshoot_by" FOREIGN KEY ("troubleshoot_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bankeu_verification_questionnaires" ADD CONSTRAINT "fk_questionnaire_dinas" FOREIGN KEY ("dinas_id") REFERENCES "master_dinas"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bankeu_verification_questionnaires" ADD CONSTRAINT "fk_questionnaire_proposal" FOREIGN KEY ("proposal_id") REFERENCES "bankeu_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bankeu_verification_questionnaires" ADD CONSTRAINT "fk_questionnaire_tim" FOREIGN KEY ("tim_verifikasi_id") REFERENCES "tim_verifikasi_kecamatan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bankeu_perubahan_proposal_kegiatan" ADD CONSTRAINT "fk_bppk_kegiatan" FOREIGN KEY ("kegiatan_id") REFERENCES "bankeu_perubahan_master_kegiatan"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bankeu_perubahan_proposal_kegiatan" ADD CONSTRAINT "fk_bppk_proposal" FOREIGN KEY ("proposal_id") REFERENCES "bankeu_perubahan_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bankeu_perubahan_proposals" ADD CONSTRAINT "fk_bp_perubahan_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bankeu_perubahan_proposals" ADD CONSTRAINT "fk_bp_perubahan_desa" FOREIGN KEY ("desa_id") REFERENCES "desas"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bankeu_perubahan_proposals" ADD CONSTRAINT "fk_bp_perubahan_dpmd_verified_by" FOREIGN KEY ("dpmd_verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bankeu_perubahan_proposals" ADD CONSTRAINT "fk_bp_perubahan_kec_verified_by" FOREIGN KEY ("kecamatan_verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bankeu_perubahan_proposals" ADD CONSTRAINT "fk_bp_perubahan_kecamatan" FOREIGN KEY ("kecamatan_id") REFERENCES "kecamatans"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bankeu_perubahan_proposals" ADD CONSTRAINT "fk_bp_perubahan_verified_by" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bankeu_perubahan_proposal_versions" ADD CONSTRAINT "fk_bppv_proposal" FOREIGN KEY ("proposal_id") REFERENCES "bankeu_perubahan_proposals"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bankeu_perubahan_proposal_versions" ADD CONSTRAINT "fk_bppv_uploaded_by" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bankeu_perubahan_revisions" ADD CONSTRAINT "fk_bpr_annotated_by" FOREIGN KEY ("annotated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bankeu_perubahan_revisions" ADD CONSTRAINT "fk_bpr_proposal" FOREIGN KEY ("proposal_id") REFERENCES "bankeu_perubahan_proposals"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bankeu_perubahan_revisions" ADD CONSTRAINT "fk_bpr_version" FOREIGN KEY ("version_id") REFERENCES "bankeu_perubahan_proposal_versions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "kecamatan_bankeu_perubahan_config" ADD CONSTRAINT "fk_kbpc_kecamatan" FOREIGN KEY ("kecamatan_id") REFERENCES "kecamatans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tim_verifikasi_bankeu_perubahan" ADD CONSTRAINT "fk_tvbp_kecamatan" FOREIGN KEY ("kecamatan_id") REFERENCES "kecamatans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tim_verifikasi_bankeu_perubahan" ADD CONSTRAINT "fk_tvbp_proposal" FOREIGN KEY ("proposal_id") REFERENCES "bankeu_perubahan_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bankeu_perubahan_questionnaires" ADD CONSTRAINT "fk_bpq_proposal" FOREIGN KEY ("proposal_id") REFERENCES "bankeu_perubahan_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bankeu_perubahan_questionnaires" ADD CONSTRAINT "fk_bpq_tim" FOREIGN KEY ("tim_verifikasi_id") REFERENCES "tim_verifikasi_bankeu_perubahan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bankeu_perubahan_lpj" ADD CONSTRAINT "fk_bplp_desa" FOREIGN KEY ("desa_id") REFERENCES "desas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bankeu_perubahan_lpj" ADD CONSTRAINT "fk_bplp_dpmd_verified_by_fk" FOREIGN KEY ("dpmd_verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bankeu_perubahan_lpj" ADD CONSTRAINT "fk_bplp_uploaded_by_fk" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "informasi" ADD CONSTRAINT "fk_informasi_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anggaran_bidang_units" ADD CONSTRAINT "fk_anggaran_bidang_units_bidang" FOREIGN KEY ("bidang_id") REFERENCES "bidangs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anggaran_master_kegiatan" ADD CONSTRAINT "fk_amk_bidang" FOREIGN KEY ("bidang_id") REFERENCES "bidangs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anggaran_master_kegiatan" ADD CONSTRAINT "fk_amk_unit" FOREIGN KEY ("bidang_unit_id") REFERENCES "anggaran_bidang_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anggaran_master_kegiatan" ADD CONSTRAINT "fk_amk_user_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anggaran_pagu" ADD CONSTRAINT "fk_ap_master" FOREIGN KEY ("master_kegiatan_id") REFERENCES "anggaran_master_kegiatan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anggaran_pagu" ADD CONSTRAINT "fk_ap_user_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anggaran_kas" ADD CONSTRAINT "fk_angkas_pagu" FOREIGN KEY ("pagu_id") REFERENCES "anggaran_pagu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anggaran_rka_items" ADD CONSTRAINT "fk_ari_pagu" FOREIGN KEY ("pagu_id") REFERENCES "anggaran_pagu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anggaran_rka_items" ADD CONSTRAINT "fk_ari_user_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_produk_hukum_perdes_id_foreign" FOREIGN KEY ("produk_hukum_perdes_id") REFERENCES "produk_hukums"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_produk_hukum_sk_bumdes_id_foreign" FOREIGN KEY ("produk_hukum_sk_bumdes_id") REFERENCES "produk_hukums"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bumdes_produk" ADD CONSTRAINT "fk_bumdes_produk_bumdes" FOREIGN KEY ("bumdes_id") REFERENCES "bumdes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desa_bankeu_surat" ADD CONSTRAINT "fk_desa_bankeu_surat_desa" FOREIGN KEY ("desa_id") REFERENCES "desas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desa_bankeu_surat" ADD CONSTRAINT "fk_desa_bankeu_surat_reviewer_fk" FOREIGN KEY ("kecamatan_reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desas" ADD CONSTRAINT "desas_kecamatan_id_foreign_fk" FOREIGN KEY ("kecamatan_id") REFERENCES "kecamatans"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "dinas_verifikator" ADD CONSTRAINT "dinas_verifikator_dinas_id_fkey" FOREIGN KEY ("dinas_id") REFERENCES "master_dinas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disposisi" ADD CONSTRAINT "disposisi_dari_user_id_fkey" FOREIGN KEY ("dari_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disposisi" ADD CONSTRAINT "disposisi_ke_user_id_fkey" FOREIGN KEY ("ke_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disposisi" ADD CONSTRAINT "disposisi_surat_id_fkey" FOREIGN KEY ("surat_id") REFERENCES "surat_masuk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jadwal_kegiatan" ADD CONSTRAINT "fk_jadwal_kegiatan_approved_by" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "jadwal_kegiatan" ADD CONSTRAINT "fk_jadwal_kegiatan_bidang" FOREIGN KEY ("bidang_id") REFERENCES "bidangs"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "jadwal_kegiatan" ADD CONSTRAINT "fk_jadwal_kegiatan_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "jadwal_kegiatan" ADD CONSTRAINT "fk_jk_surat_masuk" FOREIGN KEY ("surat_masuk_id") REFERENCES "surat_masuk"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "jadwal_kegiatan_bidang" ADD CONSTRAINT "fk_jkb_bidang" FOREIGN KEY ("bidang_id") REFERENCES "bidangs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jadwal_kegiatan_bidang" ADD CONSTRAINT "fk_jkb_jadwal" FOREIGN KEY ("jadwal_kegiatan_id") REFERENCES "jadwal_kegiatan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jadwal_kegiatan_views" ADD CONSTRAINT "fk_jkv_jadwal" FOREIGN KEY ("jadwal_kegiatan_id") REFERENCES "jadwal_kegiatan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jadwal_kegiatan_views" ADD CONSTRAINT "fk_jkv_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jadwal_kegiatan_reactions" ADD CONSTRAINT "fk_jkr_jadwal" FOREIGN KEY ("jadwal_kegiatan_id") REFERENCES "jadwal_kegiatan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jadwal_kegiatan_reactions" ADD CONSTRAINT "fk_jkr_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jadwal_kegiatan_comments" ADD CONSTRAINT "fk_jkc_jadwal" FOREIGN KEY ("jadwal_kegiatan_id") REFERENCES "jadwal_kegiatan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jadwal_kegiatan_comments" ADD CONSTRAINT "fk_jkc_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "karang_tarunas" ADD CONSTRAINT "karang_tarunas_desa_id_foreign_fk" FOREIGN KEY ("desa_id") REFERENCES "desas"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "karang_tarunas" ADD CONSTRAINT "karang_tarunas_produk_hukum_id_foreign_fk" FOREIGN KEY ("produk_hukum_id") REFERENCES "produk_hukums"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lembaga_lainnyas" ADD CONSTRAINT "lembaga_lainnyas_desa_id_foreign_fk" FOREIGN KEY ("desa_id") REFERENCES "desas"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lembaga_lainnyas" ADD CONSTRAINT "lembaga_lainnyas_produk_hukum_id_foreign_fk" FOREIGN KEY ("produk_hukum_id") REFERENCES "produk_hukums"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "kegiatan_bidang" ADD CONSTRAINT "kegiatan_bidang_id_bidang_foreign_fk" FOREIGN KEY ("id_bidang") REFERENCES "bidangs"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "kegiatan_bidang" ADD CONSTRAINT "kegiatan_bidang_id_kegiatan_foreign_fk" FOREIGN KEY ("id_kegiatan") REFERENCES "kegiatan"("id_kegiatan") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "kegiatan_pegawai" ADD CONSTRAINT "kegiatan_pegawai_id_kegiatan_bidang_foreign_fk" FOREIGN KEY ("id_kegiatan_bidang") REFERENCES "kegiatan_bidang"("id_kegiatan_bidang") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "kegiatan_pegawai" ADD CONSTRAINT "kegiatan_pegawai_id_kegiatan_foreign_fk" FOREIGN KEY ("id_kegiatan") REFERENCES "kegiatan"("id_kegiatan") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "kegiatan_pegawai" ADD CONSTRAINT "kegiatan_pegawai_id_pegawai_foreign_fk" FOREIGN KEY ("id_pegawai") REFERENCES "pegawai"("id_pegawai") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "kelembagaan_activity_logs" ADD CONSTRAINT "kelembagaan_logs_desa_id_foreign" FOREIGN KEY ("desa_id") REFERENCES "desas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kelembagaan_activity_logs" ADD CONSTRAINT "kelembagaan_logs_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lampiran_surat" ADD CONSTRAINT "lampiran_surat_surat_id_fkey" FOREIGN KEY ("surat_id") REFERENCES "surat_masuk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lampiran_surat" ADD CONSTRAINT "lampiran_surat_uploaded_by_fkey_fk" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lpms" ADD CONSTRAINT "lpms_desa_id_foreign_fk" FOREIGN KEY ("desa_id") REFERENCES "desas"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lpms" ADD CONSTRAINT "lpms_produk_hukum_id_foreign_fk" FOREIGN KEY ("produk_hukum_id") REFERENCES "produk_hukums"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "fk_notifications_sent_by_fk" FOREIGN KEY ("sent_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "fk_notifications_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pegawai" ADD CONSTRAINT "pegawai_id_bidang_foreign_fk" FOREIGN KEY ("id_bidang") REFERENCES "bidangs"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "absensi_pegawai" ADD CONSTRAINT "absensi_pegawai_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pengurus" ADD CONSTRAINT "pengurus_desa_id_foreign_fk" FOREIGN KEY ("desa_id") REFERENCES "desas"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "perjadin_grup" ADD CONSTRAINT "fk_perjadin_grup_creator_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perjadin_grup" ADD CONSTRAINT "fk_perjadin_grup_desa" FOREIGN KEY ("desa_tujuan_id") REFERENCES "desas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "petugas_monitoring" ADD CONSTRAINT "petugas_monitoring_desa_id_foreign" FOREIGN KEY ("desa_id") REFERENCES "desas"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "petugas_monitoring" ADD CONSTRAINT "petugas_monitoring_kecamatan_id_foreign_fk" FOREIGN KEY ("kecamatan_id") REFERENCES "kecamatans"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pkks" ADD CONSTRAINT "pkks_desa_id_foreign_fk" FOREIGN KEY ("desa_id") REFERENCES "desas"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pkks" ADD CONSTRAINT "pkks_produk_hukum_id_foreign_fk" FOREIGN KEY ("produk_hukum_id") REFERENCES "produk_hukums"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "posyandus" ADD CONSTRAINT "posyandus_desa_id_foreign_fk" FOREIGN KEY ("desa_id") REFERENCES "desas"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "posyandus" ADD CONSTRAINT "posyandus_produk_hukum_id_foreign_fk" FOREIGN KEY ("produk_hukum_id") REFERENCES "produk_hukums"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "produk_hukums" ADD CONSTRAINT "produk_hukums_desa_id_foreign_fk" FOREIGN KEY ("desa_id") REFERENCES "desas"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "produk_hukum_bidang" ADD CONSTRAINT "fk_produk_hukum_bidang_bidang" FOREIGN KEY ("bidang_id") REFERENCES "bidangs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profil_desas" ADD CONSTRAINT "profil_desas_desa_id_foreign" FOREIGN KEY ("desa_id") REFERENCES "desas"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rts" ADD CONSTRAINT "rts_desa_id_foreign_fk" FOREIGN KEY ("desa_id") REFERENCES "desas"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "rts" ADD CONSTRAINT "rts_produk_hukum_id_foreign_fk" FOREIGN KEY ("produk_hukum_id") REFERENCES "produk_hukums"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "rts" ADD CONSTRAINT "rts_rw_id_foreign" FOREIGN KEY ("rw_id") REFERENCES "rws"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "rws" ADD CONSTRAINT "rws_desa_id_foreign" FOREIGN KEY ("desa_id") REFERENCES "desas"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "rws" ADD CONSTRAINT "rws_produk_hukum_id_foreign_fk" FOREIGN KEY ("produk_hukum_id") REFERENCES "produk_hukums"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "satlinmas" ADD CONSTRAINT "satlinmas_desa_id_foreign_fk" FOREIGN KEY ("desa_id") REFERENCES "desas"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "satlinmas" ADD CONSTRAINT "satlinmas_produk_hukum_id_foreign_fk" FOREIGN KEY ("produk_hukum_id") REFERENCES "produk_hukums"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "surat_masuk" ADD CONSTRAINT "surat_masuk_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tugas_pribadi" ADD CONSTRAINT "tugas_pribadi_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catatan_pribadi" ADD CONSTRAINT "catatan_pribadi_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_pegawai_id_foreign" FOREIGN KEY ("pegawai_id") REFERENCES "pegawai"("id_pegawai") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "desa_user_permissions" ADD CONSTRAINT "fk_desa_user_permissions_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cctv_akses" ADD CONSTRAINT "fk_cctv_akses_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kecamatan_user_permissions" ADD CONSTRAINT "fk_kecamatan_user_permissions_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verifikator_akses_desa" ADD CONSTRAINT "fk_verifikator_akses_desa" FOREIGN KEY ("desa_id") REFERENCES "desas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verifikator_akses_desa" ADD CONSTRAINT "fk_verifikator_akses_kecamatan" FOREIGN KEY ("kecamatan_id") REFERENCES "kecamatans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verifikator_akses_desa" ADD CONSTRAINT "fk_verifikator_akses_verifikator" FOREIGN KEY ("verifikator_id") REFERENCES "dinas_verifikator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "berita_acara_history" ADD CONSTRAINT "fk_ba_history_desa" FOREIGN KEY ("desa_id") REFERENCES "desas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "berita_acara_history" ADD CONSTRAINT "fk_ba_history_generator_fk" FOREIGN KEY ("generated_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "berita_acara_history" ADD CONSTRAINT "fk_ba_history_kecamatan" FOREIGN KEY ("kecamatan_id") REFERENCES "kecamatans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "berita_acara_history" ADD CONSTRAINT "fk_ba_history_kegiatan_fk" FOREIGN KEY ("kegiatan_id") REFERENCES "bankeu_master_kegiatan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "berita_acara_history" ADD CONSTRAINT "fk_ba_history_proposal" FOREIGN KEY ("proposal_id") REFERENCES "bankeu_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perjadin_pegawai" ADD CONSTRAINT "fk_perjadin_approved_by_fk" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "perjadin_pegawai" ADD CONSTRAINT "fk_perjadin_desa_tujuan" FOREIGN KEY ("desa_tujuan_id") REFERENCES "desas"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "perjadin_pegawai" ADD CONSTRAINT "fk_perjadin_pegawai" FOREIGN KEY ("pegawai_id") REFERENCES "pegawai"("id_pegawai") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "video_meeting_chats" ADD CONSTRAINT "video_meeting_chats_ibfk_1" FOREIGN KEY ("meeting_id") REFERENCES "video_meetings"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "video_meeting_chats" ADD CONSTRAINT "video_meeting_chats_ibfk_2" FOREIGN KEY ("participant_id") REFERENCES "video_meeting_participants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "video_meeting_invitations" ADD CONSTRAINT "video_meeting_invitations_ibfk_1" FOREIGN KEY ("meeting_id") REFERENCES "video_meetings"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "video_meeting_participants" ADD CONSTRAINT "video_meeting_participants_ibfk_1" FOREIGN KEY ("meeting_id") REFERENCES "video_meetings"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "video_meeting_recordings" ADD CONSTRAINT "video_meeting_recordings_ibfk_1" FOREIGN KEY ("meeting_id") REFERENCES "video_meetings"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_statuses" ADD CONSTRAINT "fk_us_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_views" ADD CONSTRAINT "fk_sv_status" FOREIGN KEY ("status_id") REFERENCES "user_statuses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_views" ADD CONSTRAINT "fk_sv_viewer" FOREIGN KEY ("viewer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nomor_surat_requests" ADD CONSTRAINT "fk_nomorsurat_user" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "fk_conv_participant_one" FOREIGN KEY ("participant_one_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "fk_conv_participant_two" FOREIGN KEY ("participant_two_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "fk_msg_conversation" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "fk_msg_reply_to" FOREIGN KEY ("reply_to_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "fk_msg_sender" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_reactions" ADD CONSTRAINT "fk_msg_reaction_message" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_reactions" ADD CONSTRAINT "fk_msg_reaction_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "fk_cp_conversation" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "fk_cp_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pencairan" ADD CONSTRAINT "fk_pc_atasan_pb_fk" FOREIGN KEY ("atasan_pengurus_barang_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pencairan" ADD CONSTRAINT "fk_pc_bendahara_fk" FOREIGN KEY ("bendahara_pengeluaran_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pencairan" ADD CONSTRAINT "fk_pc_bidang" FOREIGN KEY ("bidang_id") REFERENCES "bidangs"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pencairan" ADD CONSTRAINT "fk_pc_creator_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pencairan" ADD CONSTRAINT "fk_pc_finalized_by_fk" FOREIGN KEY ("finalized_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pencairan" ADD CONSTRAINT "fk_pc_kpa_fk" FOREIGN KEY ("kpa_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pencairan" ADD CONSTRAINT "fk_pc_master" FOREIGN KEY ("master_kegiatan_id") REFERENCES "anggaran_master_kegiatan"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pencairan" ADD CONSTRAINT "fk_pc_pagu" FOREIGN KEY ("pagu_id") REFERENCES "anggaran_pagu"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pencairan" ADD CONSTRAINT "fk_pc_penerima_fak_fk" FOREIGN KEY ("penerima_faktur_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pencairan" ADD CONSTRAINT "fk_pc_pengurus_fk" FOREIGN KEY ("pengurus_barang_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pencairan" ADD CONSTRAINT "fk_pc_penyedia" FOREIGN KEY ("penyedia_id") REFERENCES "penyedia"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pencairan" ADD CONSTRAINT "fk_pc_ppk_fk" FOREIGN KEY ("ppk_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pencairan" ADD CONSTRAINT "fk_pc_pptk_fk" FOREIGN KEY ("pptk_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pencairan_items" ADD CONSTRAINT "fk_pci_pc" FOREIGN KEY ("pencairan_id") REFERENCES "pencairan"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pencairan_items" ADD CONSTRAINT "fk_pci_rka" FOREIGN KEY ("rka_item_id") REFERENCES "anggaran_rka_items"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pencairan_pemeriksa" ADD CONSTRAINT "fk_pcp_pc" FOREIGN KEY ("pencairan_id") REFERENCES "pencairan"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pencairan_pemeriksa" ADD CONSTRAINT "fk_pcp_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "penyedia" ADD CONSTRAINT "fk_penyedia_creator_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "arsip_barang" ADD CONSTRAINT "fk_arsip_barang_creator_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "arsip_barang" ADD CONSTRAINT "fk_arsip_barang_kategori" FOREIGN KEY ("kategori_id") REFERENCES "arsip_barang_kategori"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "arsip_barang" ADD CONSTRAINT "fk_arsip_barang_pemegang" FOREIGN KEY ("pemegang_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "arsip_barang" ADD CONSTRAINT "fk_arsip_barang_updater_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "arsip_barang_mutasi" ADD CONSTRAINT "fk_arsip_barang_mutasi_barang" FOREIGN KEY ("barang_id") REFERENCES "arsip_barang"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "arsip_barang_mutasi" ADD CONSTRAINT "fk_arsip_barang_mutasi_user_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "arsip_barang_scan_log" ADD CONSTRAINT "fk_arsip_barang_scan_barang" FOREIGN KEY ("barang_id") REFERENCES "arsip_barang"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "arsip_barang_scan_log" ADD CONSTRAINT "fk_arsip_barang_scan_user_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "absensi_lokasi_khusus" ADD CONSTRAINT "fk_alk_creator_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "absensi_lokasi_khusus" ADD CONSTRAINT "fk_alk_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "kerjasama_desa_legalitas" ADD CONSTRAINT "fk_kerjasama_legalitas_desa" FOREIGN KEY ("desa_id") REFERENCES "desas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kerjasama_desa_legalitas" ADD CONSTRAINT "fk_kerjasama_legalitas_produk_hukum" FOREIGN KEY ("produk_hukum_id") REFERENCES "produk_hukums"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kerjasama_desa" ADD CONSTRAINT "fk_kerjasama_desa_desa" FOREIGN KEY ("desa_id") REFERENCES "desas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cctv_face_embeddings" ADD CONSTRAINT "fk_cctv_face_embeddings_face" FOREIGN KEY ("face_id") REFERENCES "cctv_faces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cctv_events" ADD CONSTRAINT "fk_cctv_events_camera" FOREIGN KEY ("camera_id") REFERENCES "cctv_cameras"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cctv_events" ADD CONSTRAINT "fk_cctv_events_face" FOREIGN KEY ("face_id") REFERENCES "cctv_faces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- (d) CHECK panjang untuk kolom VarChar(n)/Char(n) model Prisma (citext tidak punya batas)
ALTER TABLE "aparatur_desa_logs" ADD CONSTRAINT "aparatur_desa_logs_aparatur_id_len" CHECK (char_length("aparatur_id") <= 36);
ALTER TABLE "aparatur_desa_logs" ADD CONSTRAINT "aparatur_desa_logs_aksi_len" CHECK (char_length("aksi") <= 30);
ALTER TABLE "aparatur_desa_logs" ADD CONSTRAINT "aparatur_desa_logs_oleh_nama_len" CHECK (char_length("oleh_nama") <= 255);
ALTER TABLE "aparatur_desa_logs" ADD CONSTRAINT "aparatur_desa_logs_oleh_peran_len" CHECK (char_length("oleh_peran") <= 50);
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_name_len" CHECK (char_length("user_name") <= 255);
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_role_len" CHECK (char_length("user_role") <= 50);
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_module_len" CHECK (char_length("module") <= 50);
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_action_len" CHECK (char_length("action") <= 50);
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_entity_type_len" CHECK (char_length("entity_type") <= 100);
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_entity_name_len" CHECK (char_length("entity_name") <= 255);
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_ip_address_len" CHECK (char_length("ip_address") <= 45);
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_agent_len" CHECK (char_length("user_agent") <= 500);
ALTER TABLE "login_histories" ADD CONSTRAINT "login_histories_ip_address_len" CHECK (char_length("ip_address") <= 45);
ALTER TABLE "login_histories" ADD CONSTRAINT "login_histories_user_agent_len" CHECK (char_length("user_agent") <= 500);
ALTER TABLE "login_histories" ADD CONSTRAINT "login_histories_device_id_len" CHECK (char_length("device_id") <= 100);
ALTER TABLE "login_histories" ADD CONSTRAINT "login_histories_device_type_len" CHECK (char_length("device_type") <= 50);
ALTER TABLE "login_histories" ADD CONSTRAINT "login_histories_browser_len" CHECK (char_length("browser") <= 100);
ALTER TABLE "login_histories" ADD CONSTRAINT "login_histories_os_len" CHECK (char_length("os") <= 100);
ALTER TABLE "login_histories" ADD CONSTRAINT "login_histories_status_len" CHECK (char_length("status") <= 20);
ALTER TABLE "aparatur_desa" ADD CONSTRAINT "aparatur_desa_id_len" CHECK (char_length("id") <= 36);
ALTER TABLE "aparatur_desa" ADD CONSTRAINT "aparatur_desa_nama_lengkap_len" CHECK (char_length("nama_lengkap") <= 255);
ALTER TABLE "aparatur_desa" ADD CONSTRAINT "aparatur_desa_jabatan_len" CHECK (char_length("jabatan") <= 255);
ALTER TABLE "aparatur_desa" ADD CONSTRAINT "aparatur_desa_nipd_len" CHECK (char_length("nipd") <= 255);
ALTER TABLE "aparatur_desa" ADD CONSTRAINT "aparatur_desa_niap_len" CHECK (char_length("niap") <= 255);
ALTER TABLE "aparatur_desa" ADD CONSTRAINT "aparatur_desa_nik_len" CHECK (char_length("nik") <= 16);
ALTER TABLE "aparatur_desa" ADD CONSTRAINT "aparatur_desa_whatsapp_len" CHECK (char_length("whatsapp") <= 20);
ALTER TABLE "aparatur_desa" ADD CONSTRAINT "aparatur_desa_tempat_lahir_len" CHECK (char_length("tempat_lahir") <= 255);
ALTER TABLE "aparatur_desa" ADD CONSTRAINT "aparatur_desa_pendidikan_terakhir_len" CHECK (char_length("pendidikan_terakhir") <= 255);
ALTER TABLE "aparatur_desa" ADD CONSTRAINT "aparatur_desa_agama_len" CHECK (char_length("agama") <= 255);
ALTER TABLE "aparatur_desa" ADD CONSTRAINT "aparatur_desa_pangkat_golongan_len" CHECK (char_length("pangkat_golongan") <= 255);
ALTER TABLE "aparatur_desa" ADD CONSTRAINT "aparatur_desa_nomor_sk_pengangkatan_len" CHECK (char_length("nomor_sk_pengangkatan") <= 255);
ALTER TABLE "aparatur_desa" ADD CONSTRAINT "aparatur_desa_nomor_sk_pemberhentian_len" CHECK (char_length("nomor_sk_pemberhentian") <= 255);
ALTER TABLE "aparatur_desa" ADD CONSTRAINT "aparatur_desa_keterangan_len" CHECK (char_length("keterangan") <= 255);
ALTER TABLE "aparatur_desa" ADD CONSTRAINT "aparatur_desa_sumber_data_len" CHECK (char_length("sumber_data") <= 20);
ALTER TABLE "aparatur_desa" ADD CONSTRAINT "aparatur_desa_produk_hukum_id_len" CHECK (char_length("produk_hukum_id") <= 36);
ALTER TABLE "aparatur_desa" ADD CONSTRAINT "aparatur_desa_bpjs_kesehatan_nomor_len" CHECK (char_length("bpjs_kesehatan_nomor") <= 255);
ALTER TABLE "aparatur_desa" ADD CONSTRAINT "aparatur_desa_bpjs_ketenagakerjaan_nomor_len" CHECK (char_length("bpjs_ketenagakerjaan_nomor") <= 255);
ALTER TABLE "aparatur_desa" ADD CONSTRAINT "aparatur_desa_file_bpjs_kesehatan_len" CHECK (char_length("file_bpjs_kesehatan") <= 255);
ALTER TABLE "aparatur_desa" ADD CONSTRAINT "aparatur_desa_file_bpjs_ketenagakerjaan_len" CHECK (char_length("file_bpjs_ketenagakerjaan") <= 255);
ALTER TABLE "aparatur_desa" ADD CONSTRAINT "aparatur_desa_file_pas_foto_len" CHECK (char_length("file_pas_foto") <= 255);
ALTER TABLE "aparatur_desa" ADD CONSTRAINT "aparatur_desa_file_ktp_len" CHECK (char_length("file_ktp") <= 255);
ALTER TABLE "aparatur_desa" ADD CONSTRAINT "aparatur_desa_file_kk_len" CHECK (char_length("file_kk") <= 255);
ALTER TABLE "aparatur_desa" ADD CONSTRAINT "aparatur_desa_file_akta_kelahiran_len" CHECK (char_length("file_akta_kelahiran") <= 255);
ALTER TABLE "aparatur_desa" ADD CONSTRAINT "aparatur_desa_file_ijazah_terakhir_len" CHECK (char_length("file_ijazah_terakhir") <= 255);
ALTER TABLE "aparatur_desa" ADD CONSTRAINT "aparatur_desa_file_sk_terakhir_len" CHECK (char_length("file_sk_terakhir") <= 255);
ALTER TABLE "aparatur_desa" ADD CONSTRAINT "aparatur_desa_status_verifikasi_len" CHECK (char_length("status_verifikasi") <= 20);
ALTER TABLE "aparatur_dapur_desa" ADD CONSTRAINT "aparatur_dapur_desa_kode_desa_len" CHECK (char_length("kode_desa") <= 20);
ALTER TABLE "aparatur_dapur_desa" ADD CONSTRAINT "aparatur_dapur_desa_kode_kecamatan_len" CHECK (char_length("kode_kecamatan") <= 20);
ALTER TABLE "aparatur_dapur_desa" ADD CONSTRAINT "aparatur_dapur_desa_nama_desa_sumber_len" CHECK (char_length("nama_desa_sumber") <= 255);
ALTER TABLE "aparatur_dapur_desa" ADD CONSTRAINT "aparatur_dapur_desa_nama_kecamatan_sumber_len" CHECK (char_length("nama_kecamatan_sumber") <= 255);
ALTER TABLE "aparatur_dapur_desa" ADD CONSTRAINT "aparatur_dapur_desa_nama_len" CHECK (char_length("nama") <= 255);
ALTER TABLE "aparatur_dapur_desa" ADD CONSTRAINT "aparatur_dapur_desa_nama_normal_len" CHECK (char_length("nama_normal") <= 255);
ALTER TABLE "aparatur_dapur_desa" ADD CONSTRAINT "aparatur_dapur_desa_jabatan_len" CHECK (char_length("jabatan") <= 255);
ALTER TABLE "aparatur_dapur_desa" ADD CONSTRAINT "aparatur_dapur_desa_jenis_kelamin_len" CHECK (char_length("jenis_kelamin") <= 5);
ALTER TABLE "aparatur_dapur_desa" ADD CONSTRAINT "aparatur_dapur_desa_agama_len" CHECK (char_length("agama") <= 50);
ALTER TABLE "aparatur_dapur_desa" ADD CONSTRAINT "aparatur_dapur_desa_status_kawin_len" CHECK (char_length("status_kawin") <= 50);
ALTER TABLE "aparatur_dapur_desa" ADD CONSTRAINT "aparatur_dapur_desa_status_pns_len" CHECK (char_length("status_pns") <= 20);
ALTER TABLE "aparatur_dapur_desa" ADD CONSTRAINT "aparatur_dapur_desa_pendidikan_len" CHECK (char_length("pendidikan") <= 255);
ALTER TABLE "aparatur_dapur_desa" ADD CONSTRAINT "aparatur_dapur_desa_no_sk_len" CHECK (char_length("no_sk") <= 255);
ALTER TABLE "aparatur_dapur_desa" ADD CONSTRAINT "aparatur_dapur_desa_no_sk_pertama_len" CHECK (char_length("no_sk_pertama") <= 255);
ALTER TABLE "aparatur_dapur_desa" ADD CONSTRAINT "aparatur_dapur_desa_tahun_lulus_len" CHECK (char_length("tahun_lulus") <= 10);
ALTER TABLE "aparatur_dapur_desa" ADD CONSTRAINT "aparatur_dapur_desa_foto_lokal_len" CHECK (char_length("foto_lokal") <= 500);
ALTER TABLE "aparatur_dapur_desa" ADD CONSTRAINT "aparatur_dapur_desa_status_rekonsiliasi_len" CHECK (char_length("status_rekonsiliasi") <= 20);
ALTER TABLE "aparatur_dapur_desa" ADD CONSTRAINT "aparatur_dapur_desa_aparatur_desa_id_len" CHECK (char_length("aparatur_desa_id") <= 36);
ALTER TABLE "aparatur_dapur_desa" ADD CONSTRAINT "aparatur_dapur_desa_keputusan_len" CHECK (char_length("keputusan") <= 20);
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_setting_key_len" CHECK (char_length("setting_key") <= 100);
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_description_len" CHECK (char_length("description") <= 255);
ALTER TABLE "bankeu_master_kegiatan" ADD CONSTRAINT "bankeu_master_kegiatan_dinas_terkait_len" CHECK (char_length("dinas_terkait") <= 255);
ALTER TABLE "bankeu_proposal_2025" ADD CONSTRAINT "bankeu_proposal_2025_nama_file_len" CHECK (char_length("nama_file") <= 255);
ALTER TABLE "bankeu_proposal_2025" ADD CONSTRAINT "bankeu_proposal_2025_file_path_len" CHECK (char_length("file_path") <= 500);
ALTER TABLE "bankeu_lpj" ADD CONSTRAINT "bankeu_lpj_nama_file_len" CHECK (char_length("nama_file") <= 255);
ALTER TABLE "bankeu_lpj" ADD CONSTRAINT "bankeu_lpj_file_path_len" CHECK (char_length("file_path") <= 500);
ALTER TABLE "bankeu_lpj_sts" ADD CONSTRAINT "bankeu_lpj_sts_nama_file_len" CHECK (char_length("nama_file") <= 255);
ALTER TABLE "bankeu_lpj_sts" ADD CONSTRAINT "bankeu_lpj_sts_file_path_len" CHECK (char_length("file_path") <= 500);
ALTER TABLE "bantuan_provinsi_lpj" ADD CONSTRAINT "bantuan_provinsi_lpj_nama_file_len" CHECK (char_length("nama_file") <= 255);
ALTER TABLE "bantuan_provinsi_lpj" ADD CONSTRAINT "bantuan_provinsi_lpj_file_path_len" CHECK (char_length("file_path") <= 500);
ALTER TABLE "bankeu_proposals" ADD CONSTRAINT "bankeu_proposals_judul_proposal_len" CHECK (char_length("judul_proposal") <= 255);
ALTER TABLE "bankeu_proposals" ADD CONSTRAINT "bankeu_proposals_nama_kegiatan_spesifik_len" CHECK (char_length("nama_kegiatan_spesifik") <= 255);
ALTER TABLE "bankeu_proposals" ADD CONSTRAINT "bankeu_proposals_volume_len" CHECK (char_length("volume") <= 255);
ALTER TABLE "bankeu_proposals" ADD CONSTRAINT "bankeu_proposals_lokasi_len" CHECK (char_length("lokasi") <= 255);
ALTER TABLE "bankeu_proposals" ADD CONSTRAINT "bankeu_proposals_file_proposal_len" CHECK (char_length("file_proposal") <= 255);
ALTER TABLE "bankeu_proposals" ADD CONSTRAINT "bankeu_proposals_surat_pengantar_len" CHECK (char_length("surat_pengantar") <= 255);
ALTER TABLE "bankeu_proposals" ADD CONSTRAINT "bankeu_proposals_surat_permohonan_len" CHECK (char_length("surat_permohonan") <= 255);
ALTER TABLE "bankeu_proposals" ADD CONSTRAINT "bankeu_proposals_dinas_reviewed_file_len" CHECK (char_length("dinas_reviewed_file") <= 255);
ALTER TABLE "bankeu_proposals" ADD CONSTRAINT "bankeu_proposals_berita_acara_path_len" CHECK (char_length("berita_acara_path") <= 255);
ALTER TABLE "bankeu_perubahan_master_kegiatan" ADD CONSTRAINT "bankeu_perubahan_master_kegiatan_nama_kegiatan_len" CHECK (char_length("nama_kegiatan") <= 500);
ALTER TABLE "bankeu_perubahan_proposals" ADD CONSTRAINT "bankeu_perubahan_proposals_kegiatan_nama_len" CHECK (char_length("kegiatan_nama") <= 255);
ALTER TABLE "bankeu_perubahan_proposals" ADD CONSTRAINT "bankeu_perubahan_proposals_nama_kegiatan_spesifik_len" CHECK (char_length("nama_kegiatan_spesifik") <= 500);
ALTER TABLE "bankeu_perubahan_proposals" ADD CONSTRAINT "bankeu_perubahan_proposals_volume_len" CHECK (char_length("volume") <= 255);
ALTER TABLE "bankeu_perubahan_proposals" ADD CONSTRAINT "bankeu_perubahan_proposals_lokasi_len" CHECK (char_length("lokasi") <= 500);
ALTER TABLE "bankeu_perubahan_proposals" ADD CONSTRAINT "bankeu_perubahan_proposals_judul_proposal_len" CHECK (char_length("judul_proposal") <= 255);
ALTER TABLE "bankeu_perubahan_proposals" ADD CONSTRAINT "bankeu_perubahan_proposals_file_proposal_len" CHECK (char_length("file_proposal") <= 255);
ALTER TABLE "bankeu_perubahan_proposals" ADD CONSTRAINT "bankeu_perubahan_proposals_surat_pengantar_len" CHECK (char_length("surat_pengantar") <= 255);
ALTER TABLE "bankeu_perubahan_proposals" ADD CONSTRAINT "bankeu_perubahan_proposals_surat_permohonan_len" CHECK (char_length("surat_permohonan") <= 255);
ALTER TABLE "bankeu_perubahan_proposals" ADD CONSTRAINT "bankeu_perubahan_proposals_berita_acara_path_len" CHECK (char_length("berita_acara_path") <= 255);
ALTER TABLE "bankeu_perubahan_proposals" ADD CONSTRAINT "bankeu_perubahan_proposals_berita_acara_qr_code_len" CHECK (char_length("berita_acara_qr_code") <= 255);
ALTER TABLE "bankeu_perubahan_proposals" ADD CONSTRAINT "bankeu_perubahan_proposals_surat_pengantar_kecamatan_path_len" CHECK (char_length("surat_pengantar_kecamatan_path") <= 255);
ALTER TABLE "bankeu_perubahan_proposals" ADD CONSTRAINT "bankeu_perubahan_proposals_surat_pengantar_kecamatan_nomor_len" CHECK (char_length("surat_pengantar_kecamatan_nomor") <= 100);
ALTER TABLE "bankeu_perubahan_proposal_versions" ADD CONSTRAINT "bankeu_perubahan_proposal_versions_file_proposal_len" CHECK (char_length("file_proposal") <= 255);
ALTER TABLE "bankeu_perubahan_revisions" ADD CONSTRAINT "bankeu_perubahan_revisions_annotated_pdf_path_len" CHECK (char_length("annotated_pdf_path") <= 255);
ALTER TABLE "kecamatan_bankeu_perubahan_config" ADD CONSTRAINT "kecamatan_bankeu_perubahan_config_nama_camat_len" CHECK (char_length("nama_camat") <= 255);
ALTER TABLE "kecamatan_bankeu_perubahan_config" ADD CONSTRAINT "kecamatan_bankeu_perubahan_config_nip_camat_len" CHECK (char_length("nip_camat") <= 50);
ALTER TABLE "kecamatan_bankeu_perubahan_config" ADD CONSTRAINT "kecamatan_bankeu_perubahan_config_jabatan_penandatangan_len" CHECK (char_length("jabatan_penandatangan") <= 50);
ALTER TABLE "kecamatan_bankeu_perubahan_config" ADD CONSTRAINT "kecamatan_bankeu_perubahan_config_logo_path_len" CHECK (char_length("logo_path") <= 255);
ALTER TABLE "kecamatan_bankeu_perubahan_config" ADD CONSTRAINT "kecamatan_bankeu_perubahan_config_ttd_camat_path_len" CHECK (char_length("ttd_camat_path") <= 255);
ALTER TABLE "kecamatan_bankeu_perubahan_config" ADD CONSTRAINT "kecamatan_bankeu_perubahan_config_stempel_path_len" CHECK (char_length("stempel_path") <= 255);
ALTER TABLE "kecamatan_bankeu_perubahan_config" ADD CONSTRAINT "kecamatan_bankeu_perubahan_config_telepon_len" CHECK (char_length("telepon") <= 50);
ALTER TABLE "kecamatan_bankeu_perubahan_config" ADD CONSTRAINT "kecamatan_bankeu_perubahan_config_email_len" CHECK (char_length("email") <= 100);
ALTER TABLE "kecamatan_bankeu_perubahan_config" ADD CONSTRAINT "kecamatan_bankeu_perubahan_config_website_len" CHECK (char_length("website") <= 150);
ALTER TABLE "kecamatan_bankeu_perubahan_config" ADD CONSTRAINT "kecamatan_bankeu_perubahan_config_kode_pos_len" CHECK (char_length("kode_pos") <= 10);
ALTER TABLE "tim_verifikasi_bankeu_perubahan" ADD CONSTRAINT "tim_verifikasi_bankeu_perubahan_jabatan_len" CHECK (char_length("jabatan") <= 50);
ALTER TABLE "tim_verifikasi_bankeu_perubahan" ADD CONSTRAINT "tim_verifikasi_bankeu_perubahan_jabatan_label_len" CHECK (char_length("jabatan_label") <= 255);
ALTER TABLE "tim_verifikasi_bankeu_perubahan" ADD CONSTRAINT "tim_verifikasi_bankeu_perubahan_nama_len" CHECK (char_length("nama") <= 255);
ALTER TABLE "tim_verifikasi_bankeu_perubahan" ADD CONSTRAINT "tim_verifikasi_bankeu_perubahan_nip_len" CHECK (char_length("nip") <= 50);
ALTER TABLE "tim_verifikasi_bankeu_perubahan" ADD CONSTRAINT "tim_verifikasi_bankeu_perubahan_ttd_path_len" CHECK (char_length("ttd_path") <= 255);
ALTER TABLE "bankeu_perubahan_questionnaires" ADD CONSTRAINT "bankeu_perubahan_questionnaires_verifikasi_type_len" CHECK (char_length("verifikasi_type") <= 30);
ALTER TABLE "bankeu_perubahan_questionnaires" ADD CONSTRAINT "bankeu_perubahan_questionnaires_status_len" CHECK (char_length("status") <= 20);
ALTER TABLE "bankeu_perubahan_lpj" ADD CONSTRAINT "bankeu_perubahan_lpj_nama_file_len" CHECK (char_length("nama_file") <= 255);
ALTER TABLE "bankeu_perubahan_lpj" ADD CONSTRAINT "bankeu_perubahan_lpj_file_path_len" CHECK (char_length("file_path") <= 500);
ALTER TABLE "berita" ADD CONSTRAINT "berita_judul_len" CHECK (char_length("judul") <= 255);
ALTER TABLE "berita" ADD CONSTRAINT "berita_slug_len" CHECK (char_length("slug") <= 255);
ALTER TABLE "berita" ADD CONSTRAINT "berita_ringkasan_len" CHECK (char_length("ringkasan") <= 500);
ALTER TABLE "berita" ADD CONSTRAINT "berita_gambar_len" CHECK (char_length("gambar") <= 255);
ALTER TABLE "berita" ADD CONSTRAINT "berita_dokumen_pdf_len" CHECK (char_length("dokumen_pdf") <= 255);
ALTER TABLE "berita" ADD CONSTRAINT "berita_penulis_len" CHECK (char_length("penulis") <= 100);
ALTER TABLE "informasi" ADD CONSTRAINT "informasi_judul_len" CHECK (char_length("judul") <= 255);
ALTER TABLE "informasi" ADD CONSTRAINT "informasi_gambar_len" CHECK (char_length("gambar") <= 255);
ALTER TABLE "informasi" ADD CONSTRAINT "informasi_link_len" CHECK (char_length("link") <= 500);
ALTER TABLE "bidangs" ADD CONSTRAINT "bidangs_nama_len" CHECK (char_length("nama") <= 255);
ALTER TABLE "anggaran_bidang_units" ADD CONSTRAINT "anggaran_bidang_units_nama_len" CHECK (char_length("nama") <= 255);
ALTER TABLE "anggaran_bidang_units" ADD CONSTRAINT "anggaran_bidang_units_kode_len" CHECK (char_length("kode") <= 50);
ALTER TABLE "anggaran_master_kegiatan" ADD CONSTRAINT "anggaran_master_kegiatan_kode_program_len" CHECK (char_length("kode_program") <= 100);
ALTER TABLE "anggaran_master_kegiatan" ADD CONSTRAINT "anggaran_master_kegiatan_nama_program_len" CHECK (char_length("nama_program") <= 500);
ALTER TABLE "anggaran_master_kegiatan" ADD CONSTRAINT "anggaran_master_kegiatan_kode_kegiatan_len" CHECK (char_length("kode_kegiatan") <= 100);
ALTER TABLE "anggaran_master_kegiatan" ADD CONSTRAINT "anggaran_master_kegiatan_nama_kegiatan_len" CHECK (char_length("nama_kegiatan") <= 500);
ALTER TABLE "anggaran_master_kegiatan" ADD CONSTRAINT "anggaran_master_kegiatan_kode_sub_kegiatan_len" CHECK (char_length("kode_sub_kegiatan") <= 100);
ALTER TABLE "anggaran_master_kegiatan" ADD CONSTRAINT "anggaran_master_kegiatan_nama_sub_kegiatan_len" CHECK (char_length("nama_sub_kegiatan") <= 500);
ALTER TABLE "rekening_ref" ADD CONSTRAINT "rekening_ref_kode_rekening_len" CHECK (char_length("kode_rekening") <= 500);
ALTER TABLE "rekening_ref" ADD CONSTRAINT "rekening_ref_nama_len" CHECK (char_length("nama") <= 255);
ALTER TABLE "anggaran_kas" ADD CONSTRAINT "anggaran_kas_kode_rekening_len" CHECK (char_length("kode_rekening") <= 500);
ALTER TABLE "anggaran_kas" ADD CONSTRAINT "anggaran_kas_keterangan_len" CHECK (char_length("keterangan") <= 255);
ALTER TABLE "anggaran_rka_items" ADD CONSTRAINT "anggaran_rka_items_nama_item_len" CHECK (char_length("nama_item") <= 500);
ALTER TABLE "anggaran_rka_items" ADD CONSTRAINT "anggaran_rka_items_kode_rekening_len" CHECK (char_length("kode_rekening") <= 500);
ALTER TABLE "anggaran_rka_items" ADD CONSTRAINT "anggaran_rka_items_satuan_len" CHECK (char_length("satuan") <= 100);
ALTER TABLE "anggaran_rka_items" ADD CONSTRAINT "anggaran_rka_items_kode_sht_len" CHECK (char_length("kode_sht") <= 100);
ALTER TABLE "anggaran_rka_items" ADD CONSTRAINT "anggaran_rka_items_grup_len" CHECK (char_length("grup") <= 200);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_kode_desa_len" CHECK (char_length("kode_desa") <= 50);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_kecamatan_len" CHECK (char_length("kecamatan") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_desa_len" CHECK (char_length("desa") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_namabumdesa_len" CHECK (char_length("namabumdesa") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_NIB_len" CHECK (char_length("NIB") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_LKPP_len" CHECK (char_length("LKPP") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_NPWP_len" CHECK (char_length("NPWP") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_badanhukum_len" CHECK (char_length("badanhukum") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_NamaPenasihat_len" CHECK (char_length("NamaPenasihat") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_JenisKelaminPenasihat_len" CHECK (char_length("JenisKelaminPenasihat") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_HPPenasihat_len" CHECK (char_length("HPPenasihat") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_NamaPengawas_len" CHECK (char_length("NamaPengawas") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_JenisKelaminPengawas_len" CHECK (char_length("JenisKelaminPengawas") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_HPPengawas_len" CHECK (char_length("HPPengawas") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_NamaDirektur_len" CHECK (char_length("NamaDirektur") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_JenisKelaminDirektur_len" CHECK (char_length("JenisKelaminDirektur") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_HPDirektur_len" CHECK (char_length("HPDirektur") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_NamaSekretaris_len" CHECK (char_length("NamaSekretaris") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_JenisKelaminSekretaris_len" CHECK (char_length("JenisKelaminSekretaris") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_HPSekretaris_len" CHECK (char_length("HPSekretaris") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_NamaBendahara_len" CHECK (char_length("NamaBendahara") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_JenisKelaminBendahara_len" CHECK (char_length("JenisKelaminBendahara") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_HPBendahara_len" CHECK (char_length("HPBendahara") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_TahunPendirian_len" CHECK (char_length("TahunPendirian") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_Alamatemail_len" CHECK (char_length("Alamatemail") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_TelfonBumdes_len" CHECK (char_length("TelfonBumdes") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_JenisUsahaUtama_len" CHECK (char_length("JenisUsahaUtama") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_JenisAset_len" CHECK (char_length("JenisAset") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_TahunMulai-TahunBerakhir_len" CHECK (char_length("TahunMulai-TahunBerakhir") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_Ketapang2024_len" CHECK (char_length("Ketapang2024") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_Ketapang2025_len" CHECK (char_length("Ketapang2025") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_NomorPerdes_len" CHECK (char_length("NomorPerdes") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_DesaWisata_len" CHECK (char_length("DesaWisata") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_LaporanKeuangan2021_len" CHECK (char_length("LaporanKeuangan2021") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_LaporanKeuangan2022_len" CHECK (char_length("LaporanKeuangan2022") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_LaporanKeuangan2023_len" CHECK (char_length("LaporanKeuangan2023") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_LaporanKeuangan2024_len" CHECK (char_length("LaporanKeuangan2024") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_Perdes_len" CHECK (char_length("Perdes") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_produk_hukum_perdes_id_len" CHECK (char_length("produk_hukum_perdes_id") <= 36);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_ProfilBUMDesa_len" CHECK (char_length("ProfilBUMDesa") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_BeritaAcara_len" CHECK (char_length("BeritaAcara") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_AnggaranDasar_len" CHECK (char_length("AnggaranDasar") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_AnggaranRumahTangga_len" CHECK (char_length("AnggaranRumahTangga") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_ProgramKerja_len" CHECK (char_length("ProgramKerja") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_SK_BUM_Desa_len" CHECK (char_length("SK_BUM_Desa") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_produk_hukum_sk_bumdes_id_len" CHECK (char_length("produk_hukum_sk_bumdes_id") <= 36);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_Status2024_len" CHECK (char_length("Status2024") <= 20);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_KeteranganTidakAktif2024_len" CHECK (char_length("KeteranganTidakAktif2024") <= 20);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_Pemeringkatan2022_len" CHECK (char_length("Pemeringkatan2022") <= 30);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_NilaiPemeringkatan2022_len" CHECK (char_length("NilaiPemeringkatan2022") <= 10);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_Pemeringkatan2023_len" CHECK (char_length("Pemeringkatan2023") <= 30);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_NilaiPemeringkatan2023_len" CHECK (char_length("NilaiPemeringkatan2023") <= 10);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_Pemeringkatan2024_len" CHECK (char_length("Pemeringkatan2024") <= 30);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_KetPemeringkatan2024_len" CHECK (char_length("KetPemeringkatan2024") <= 10);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_Pemeringkatan2024Sem1_len" CHECK (char_length("Pemeringkatan2024Sem1") <= 30);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_PemeringkatanApp2023_len" CHECK (char_length("PemeringkatanApp2023") <= 30);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_EvaluasiRPJMN2024_len" CHECK (char_length("EvaluasiRPJMN2024") <= 30);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_PemeringkatanApp2024_len" CHECK (char_length("PemeringkatanApp2024") <= 30);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_Pemeringkatan2026_len" CHECK (char_length("Pemeringkatan2026") <= 30);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_StatusBadanHukum2026_len" CHECK (char_length("StatusBadanHukum2026") <= 60);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_StatusBadanHukum2026Feb_len" CHECK (char_length("StatusBadanHukum2026Feb") <= 60);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_StatusBadanHukum2025Pembinaan_len" CHECK (char_length("StatusBadanHukum2025Pembinaan") <= 60);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_StatusBadanHukum2025_len" CHECK (char_length("StatusBadanHukum2025") <= 60);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_StatusBadanHukum2024_len" CHECK (char_length("StatusBadanHukum2024") <= 60);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_StatusBadanHukum2023_len" CHECK (char_length("StatusBadanHukum2023") <= 60);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_StatusBadanHukum2022_len" CHECK (char_length("StatusBadanHukum2022") <= 60);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_NamaStafLainnya_len" CHECK (char_length("NamaStafLainnya") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_JenisKelaminStafLainnya_len" CHECK (char_length("JenisKelaminStafLainnya") <= 20);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_HPStafLainnya_len" CHECK (char_length("HPStafLainnya") <= 50);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_DesaWisataStatus_len" CHECK (char_length("DesaWisataStatus") <= 20);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_TahunKerjaSamaMBG_len" CHECK (char_length("TahunKerjaSamaMBG") <= 20);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_DeskPendataan2025_len" CHECK (char_length("DeskPendataan2025") <= 20);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_KehadiranDesk2026_len" CHECK (char_length("KehadiranDesk2026") <= 20);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_StudiKelayakanUsaha_len" CHECK (char_length("StudiKelayakanUsaha") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_RABKetahananPangan_len" CHECK (char_length("RABKetahananPangan") <= 255);
ALTER TABLE "bumdes" ADD CONSTRAINT "bumdes_DokumentasiGeotagging_len" CHECK (char_length("DokumentasiGeotagging") <= 255);
ALTER TABLE "bumdes_produk" ADD CONSTRAINT "bumdes_produk_nama_len" CHECK (char_length("nama") <= 255);
ALTER TABLE "bumdes_produk" ADD CONSTRAINT "bumdes_produk_kategori_len" CHECK (char_length("kategori") <= 100);
ALTER TABLE "bumdes_produk" ADD CONSTRAINT "bumdes_produk_satuan_len" CHECK (char_length("satuan") <= 50);
ALTER TABLE "bumdes_produk" ADD CONSTRAINT "bumdes_produk_foto_len" CHECK (char_length("foto") <= 255);
ALTER TABLE "bumdes_produk" ADD CONSTRAINT "bumdes_produk_tautan_len" CHECK (char_length("tautan") <= 500);
ALTER TABLE "bumdes_produk" ADD CONSTRAINT "bumdes_produk_whatsapp_len" CHECK (char_length("whatsapp") <= 20);
ALTER TABLE "desa_bankeu_surat" ADD CONSTRAINT "desa_bankeu_surat_surat_pengantar_len" CHECK (char_length("surat_pengantar") <= 255);
ALTER TABLE "desa_bankeu_surat" ADD CONSTRAINT "desa_bankeu_surat_surat_permohonan_len" CHECK (char_length("surat_permohonan") <= 255);
ALTER TABLE "desas" ADD CONSTRAINT "desas_kode_len" CHECK (char_length("kode") <= 255);
ALTER TABLE "desas" ADD CONSTRAINT "desas_nama_len" CHECK (char_length("nama") <= 255);
ALTER TABLE "dinas" ADD CONSTRAINT "dinas_nama_len" CHECK (char_length("nama") <= 255);
ALTER TABLE "dinas_config" ADD CONSTRAINT "dinas_config_nama_pic_len" CHECK (char_length("nama_pic") <= 255);
ALTER TABLE "dinas_config" ADD CONSTRAINT "dinas_config_nip_pic_len" CHECK (char_length("nip_pic") <= 50);
ALTER TABLE "dinas_config" ADD CONSTRAINT "dinas_config_jabatan_pic_len" CHECK (char_length("jabatan_pic") <= 255);
ALTER TABLE "dinas_config" ADD CONSTRAINT "dinas_config_ttd_path_len" CHECK (char_length("ttd_path") <= 255);
ALTER TABLE "dinas_verifikator" ADD CONSTRAINT "dinas_verifikator_nama_len" CHECK (char_length("nama") <= 255);
ALTER TABLE "dinas_verifikator" ADD CONSTRAINT "dinas_verifikator_nip_len" CHECK (char_length("nip") <= 50);
ALTER TABLE "dinas_verifikator" ADD CONSTRAINT "dinas_verifikator_jabatan_len" CHECK (char_length("jabatan") <= 255);
ALTER TABLE "dinas_verifikator" ADD CONSTRAINT "dinas_verifikator_pangkat_golongan_len" CHECK (char_length("pangkat_golongan") <= 100);
ALTER TABLE "dinas_verifikator" ADD CONSTRAINT "dinas_verifikator_email_len" CHECK (char_length("email") <= 255);
ALTER TABLE "dinas_verifikator" ADD CONSTRAINT "dinas_verifikator_ttd_path_len" CHECK (char_length("ttd_path") <= 255);
ALTER TABLE "disposisi" ADD CONSTRAINT "disposisi_instruksi_len" CHECK (char_length("instruksi") <= 255);
ALTER TABLE "hero_galleries" ADD CONSTRAINT "hero_galleries_image_path_len" CHECK (char_length("image_path") <= 255);
ALTER TABLE "hero_galleries" ADD CONSTRAINT "hero_galleries_title_len" CHECK (char_length("title") <= 255);
ALTER TABLE "jadwal_kegiatan" ADD CONSTRAINT "jadwal_kegiatan_judul_len" CHECK (char_length("judul") <= 255);
ALTER TABLE "jadwal_kegiatan" ADD CONSTRAINT "jadwal_kegiatan_lokasi_len" CHECK (char_length("lokasi") <= 255);
ALTER TABLE "jadwal_kegiatan" ADD CONSTRAINT "jadwal_kegiatan_asal_kegiatan_len" CHECK (char_length("asal_kegiatan") <= 255);
ALTER TABLE "jadwal_kegiatan" ADD CONSTRAINT "jadwal_kegiatan_pic_name_len" CHECK (char_length("pic_name") <= 255);
ALTER TABLE "jadwal_kegiatan" ADD CONSTRAINT "jadwal_kegiatan_pic_contact_len" CHECK (char_length("pic_contact") <= 50);
ALTER TABLE "jadwal_kegiatan" ADD CONSTRAINT "jadwal_kegiatan_sub_bidang_pelaksana_len" CHECK (char_length("sub_bidang_pelaksana") <= 500);
ALTER TABLE "jadwal_kegiatan_reactions" ADD CONSTRAINT "jadwal_kegiatan_reactions_emoji_len" CHECK (char_length("emoji") <= 10);
ALTER TABLE "karang_tarunas" ADD CONSTRAINT "karang_tarunas_id_len" CHECK (char_length("id") <= 36);
ALTER TABLE "karang_tarunas" ADD CONSTRAINT "karang_tarunas_nama_len" CHECK (char_length("nama") <= 255);
ALTER TABLE "karang_tarunas" ADD CONSTRAINT "karang_tarunas_alamat_len" CHECK (char_length("alamat") <= 255);
ALTER TABLE "karang_tarunas" ADD CONSTRAINT "karang_tarunas_produk_hukum_id_len" CHECK (char_length("produk_hukum_id") <= 36);
ALTER TABLE "karang_tarunas" ADD CONSTRAINT "karang_tarunas_produk_hukum_penonaktifan_id_len" CHECK (char_length("produk_hukum_penonaktifan_id") <= 36);
ALTER TABLE "karang_tarunas" ADD CONSTRAINT "karang_tarunas_alasan_nonaktif_len" CHECK (char_length("alasan_nonaktif") <= 100);
ALTER TABLE "karang_tarunas" ADD CONSTRAINT "karang_tarunas_verifikator_nama_len" CHECK (char_length("verifikator_nama") <= 255);
ALTER TABLE "lembaga_lainnyas" ADD CONSTRAINT "lembaga_lainnyas_id_len" CHECK (char_length("id") <= 36);
ALTER TABLE "lembaga_lainnyas" ADD CONSTRAINT "lembaga_lainnyas_nama_len" CHECK (char_length("nama") <= 255);
ALTER TABLE "lembaga_lainnyas" ADD CONSTRAINT "lembaga_lainnyas_alamat_len" CHECK (char_length("alamat") <= 255);
ALTER TABLE "lembaga_lainnyas" ADD CONSTRAINT "lembaga_lainnyas_verifikator_nama_len" CHECK (char_length("verifikator_nama") <= 255);
ALTER TABLE "lembaga_lainnyas" ADD CONSTRAINT "lembaga_lainnyas_produk_hukum_id_len" CHECK (char_length("produk_hukum_id") <= 36);
ALTER TABLE "lembaga_lainnyas" ADD CONSTRAINT "lembaga_lainnyas_produk_hukum_penonaktifan_id_len" CHECK (char_length("produk_hukum_penonaktifan_id") <= 36);
ALTER TABLE "lembaga_lainnyas" ADD CONSTRAINT "lembaga_lainnyas_alasan_nonaktif_len" CHECK (char_length("alasan_nonaktif") <= 100);
ALTER TABLE "kecamatan_bankeu_config" ADD CONSTRAINT "kecamatan_bankeu_config_nama_camat_len" CHECK (char_length("nama_camat") <= 255);
ALTER TABLE "kecamatan_bankeu_config" ADD CONSTRAINT "kecamatan_bankeu_config_nip_camat_len" CHECK (char_length("nip_camat") <= 50);
ALTER TABLE "kecamatan_bankeu_config" ADD CONSTRAINT "kecamatan_bankeu_config_jabatan_penandatangan_len" CHECK (char_length("jabatan_penandatangan") <= 50);
ALTER TABLE "kecamatan_bankeu_config" ADD CONSTRAINT "kecamatan_bankeu_config_logo_path_len" CHECK (char_length("logo_path") <= 255);
ALTER TABLE "kecamatan_bankeu_config" ADD CONSTRAINT "kecamatan_bankeu_config_telepon_len" CHECK (char_length("telepon") <= 50);
ALTER TABLE "kecamatan_bankeu_config" ADD CONSTRAINT "kecamatan_bankeu_config_email_len" CHECK (char_length("email") <= 100);
ALTER TABLE "kecamatan_bankeu_config" ADD CONSTRAINT "kecamatan_bankeu_config_website_len" CHECK (char_length("website") <= 150);
ALTER TABLE "kecamatan_bankeu_config" ADD CONSTRAINT "kecamatan_bankeu_config_kode_pos_len" CHECK (char_length("kode_pos") <= 10);
ALTER TABLE "kecamatan_bankeu_config" ADD CONSTRAINT "kecamatan_bankeu_config_ttd_camat_path_len" CHECK (char_length("ttd_camat_path") <= 255);
ALTER TABLE "kecamatan_bankeu_config" ADD CONSTRAINT "kecamatan_bankeu_config_stempel_path_len" CHECK (char_length("stempel_path") <= 255);
ALTER TABLE "kecamatans" ADD CONSTRAINT "kecamatans_kode_len" CHECK (char_length("kode") <= 255);
ALTER TABLE "kecamatans" ADD CONSTRAINT "kecamatans_nama_len" CHECK (char_length("nama") <= 255);
ALTER TABLE "kecamatans" ADD CONSTRAINT "kecamatans_logo_path_len" CHECK (char_length("logo_path") <= 255);
ALTER TABLE "kecamatans" ADD CONSTRAINT "kecamatans_nama_camat_len" CHECK (char_length("nama_camat") <= 255);
ALTER TABLE "kecamatans" ADD CONSTRAINT "kecamatans_nip_camat_len" CHECK (char_length("nip_camat") <= 50);
ALTER TABLE "kegiatan" ADD CONSTRAINT "kegiatan_nama_kegiatan_len" CHECK (char_length("nama_kegiatan") <= 255);
ALTER TABLE "kegiatan" ADD CONSTRAINT "kegiatan_nomor_sp_len" CHECK (char_length("nomor_sp") <= 255);
ALTER TABLE "kegiatan" ADD CONSTRAINT "kegiatan_lokasi_len" CHECK (char_length("lokasi") <= 255);
ALTER TABLE "kegiatan_pegawai" ADD CONSTRAINT "kegiatan_pegawai_status_len" CHECK (char_length("status") <= 50);
ALTER TABLE "kelembagaan_activity_logs" ADD CONSTRAINT "kelembagaan_activity_logs_id_len" CHECK (char_length("id") <= 36);
ALTER TABLE "kelembagaan_activity_logs" ADD CONSTRAINT "kelembagaan_activity_logs_kelembagaan_type_len" CHECK (char_length("kelembagaan_type") <= 50);
ALTER TABLE "kelembagaan_activity_logs" ADD CONSTRAINT "kelembagaan_activity_logs_kelembagaan_id_len" CHECK (char_length("kelembagaan_id") <= 36);
ALTER TABLE "kelembagaan_activity_logs" ADD CONSTRAINT "kelembagaan_activity_logs_kelembagaan_nama_len" CHECK (char_length("kelembagaan_nama") <= 255);
ALTER TABLE "kelembagaan_activity_logs" ADD CONSTRAINT "kelembagaan_activity_logs_activity_type_len" CHECK (char_length("activity_type") <= 50);
ALTER TABLE "kelembagaan_activity_logs" ADD CONSTRAINT "kelembagaan_activity_logs_entity_type_len" CHECK (char_length("entity_type") <= 50);
ALTER TABLE "kelembagaan_activity_logs" ADD CONSTRAINT "kelembagaan_activity_logs_entity_id_len" CHECK (char_length("entity_id") <= 36);
ALTER TABLE "kelembagaan_activity_logs" ADD CONSTRAINT "kelembagaan_activity_logs_entity_name_len" CHECK (char_length("entity_name") <= 255);
ALTER TABLE "kelembagaan_activity_logs" ADD CONSTRAINT "kelembagaan_activity_logs_user_name_len" CHECK (char_length("user_name") <= 255);
ALTER TABLE "kelembagaan_activity_logs" ADD CONSTRAINT "kelembagaan_activity_logs_user_role_len" CHECK (char_length("user_role") <= 50);
ALTER TABLE "kelurahan" ADD CONSTRAINT "kelurahan_kelurahan_len" CHECK (char_length("kelurahan") <= 255);
ALTER TABLE "lampiran_surat" ADD CONSTRAINT "lampiran_surat_nama_file_len" CHECK (char_length("nama_file") <= 255);
ALTER TABLE "lampiran_surat" ADD CONSTRAINT "lampiran_surat_file_path_len" CHECK (char_length("file_path") <= 500);
ALTER TABLE "lampiran_surat" ADD CONSTRAINT "lampiran_surat_tipe_file_len" CHECK (char_length("tipe_file") <= 50);
ALTER TABLE "lpms" ADD CONSTRAINT "lpms_id_len" CHECK (char_length("id") <= 36);
ALTER TABLE "lpms" ADD CONSTRAINT "lpms_nama_len" CHECK (char_length("nama") <= 255);
ALTER TABLE "lpms" ADD CONSTRAINT "lpms_alamat_len" CHECK (char_length("alamat") <= 255);
ALTER TABLE "lpms" ADD CONSTRAINT "lpms_produk_hukum_id_len" CHECK (char_length("produk_hukum_id") <= 36);
ALTER TABLE "lpms" ADD CONSTRAINT "lpms_produk_hukum_penonaktifan_id_len" CHECK (char_length("produk_hukum_penonaktifan_id") <= 36);
ALTER TABLE "lpms" ADD CONSTRAINT "lpms_alasan_nonaktif_len" CHECK (char_length("alasan_nonaktif") <= 100);
ALTER TABLE "lpms" ADD CONSTRAINT "lpms_verifikator_nama_len" CHECK (char_length("verifikator_nama") <= 255);
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_title_len" CHECK (char_length("title") <= 255);
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_len" CHECK (char_length("type") <= 50);
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_title_len" CHECK (char_length("title") <= 255);
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_target_type_len" CHECK (char_length("target_type") <= 50);
ALTER TABLE "master_dinas" ADD CONSTRAINT "master_dinas_kode_dinas_len" CHECK (char_length("kode_dinas") <= 50);
ALTER TABLE "master_dinas" ADD CONSTRAINT "master_dinas_nama_dinas_len" CHECK (char_length("nama_dinas") <= 255);
ALTER TABLE "master_dinas" ADD CONSTRAINT "master_dinas_singkatan_len" CHECK (char_length("singkatan") <= 100);
ALTER TABLE "pegawai" ADD CONSTRAINT "pegawai_nama_pegawai_len" CHECK (char_length("nama_pegawai") <= 255);
ALTER TABLE "pegawai" ADD CONSTRAINT "pegawai_eselon_len" CHECK (char_length("eselon") <= 10);
ALTER TABLE "pegawai" ADD CONSTRAINT "pegawai_golongan_len" CHECK (char_length("golongan") <= 20);
ALTER TABLE "pegawai" ADD CONSTRAINT "pegawai_jabatan_len" CHECK (char_length("jabatan") <= 255);
ALTER TABLE "pegawai" ADD CONSTRAINT "pegawai_nip_len" CHECK (char_length("nip") <= 30);
ALTER TABLE "pegawai" ADD CONSTRAINT "pegawai_no_hp_len" CHECK (char_length("no_hp") <= 20);
ALTER TABLE "pegawai" ADD CONSTRAINT "pegawai_pangkat_len" CHECK (char_length("pangkat") <= 100);
ALTER TABLE "pegawai" ADD CONSTRAINT "pegawai_pendidikan_terakhir_len" CHECK (char_length("pendidikan_terakhir") <= 50);
ALTER TABLE "pegawai" ADD CONSTRAINT "pegawai_tempat_lahir_len" CHECK (char_length("tempat_lahir") <= 100);
ALTER TABLE "pegawai" ADD CONSTRAINT "pegawai_unit_kerja_len" CHECK (char_length("unit_kerja") <= 255);
ALTER TABLE "pegawai" ADD CONSTRAINT "pegawai_sub_bidang_len" CHECK (char_length("sub_bidang") <= 255);
ALTER TABLE "absensi_pegawai" ADD CONSTRAINT "absensi_pegawai_foto_masuk_len" CHECK (char_length("foto_masuk") <= 255);
ALTER TABLE "absensi_pegawai" ADD CONSTRAINT "absensi_pegawai_foto_keluar_len" CHECK (char_length("foto_keluar") <= 255);
ALTER TABLE "absensi_pegawai" ADD CONSTRAINT "absensi_pegawai_lokasi_masuk_len" CHECK (char_length("lokasi_masuk") <= 255);
ALTER TABLE "absensi_pegawai" ADD CONSTRAINT "absensi_pegawai_lokasi_keluar_len" CHECK (char_length("lokasi_keluar") <= 255);
ALTER TABLE "absensi_pegawai" ADD CONSTRAINT "absensi_pegawai_titik_absen_khusus_len" CHECK (char_length("titik_absen_khusus") <= 64);
ALTER TABLE "absensi_pegawai" ADD CONSTRAINT "absensi_pegawai_device_id_len" CHECK (char_length("device_id") <= 100);
ALTER TABLE "absensi_pegawai" ADD CONSTRAINT "absensi_pegawai_tujuan_dinas_len" CHECK (char_length("tujuan_dinas") <= 500);
ALTER TABLE "absensi_settings" ADD CONSTRAINT "absensi_settings_key_len" CHECK (char_length("key") <= 100);
ALTER TABLE "absensi_settings" ADD CONSTRAINT "absensi_settings_value_len" CHECK (char_length("value") <= 255);
ALTER TABLE "absensi_settings" ADD CONSTRAINT "absensi_settings_description_len" CHECK (char_length("description") <= 500);
ALTER TABLE "absensi_success_messages" ADD CONSTRAINT "absensi_success_messages_type_len" CHECK (char_length("type") <= 50);
ALTER TABLE "absensi_success_messages" ADD CONSTRAINT "absensi_success_messages_title_len" CHECK (char_length("title") <= 255);
ALTER TABLE "absensi_success_messages" ADD CONSTRAINT "absensi_success_messages_image_path_len" CHECK (char_length("image_path") <= 500);
ALTER TABLE "absensi_reminder_templates" ADD CONSTRAINT "absensi_reminder_templates_type_len" CHECK (char_length("type") <= 50);
ALTER TABLE "absensi_reminder_templates" ADD CONSTRAINT "absensi_reminder_templates_title_len" CHECK (char_length("title") <= 255);
ALTER TABLE "absensi_weekly_awards" ADD CONSTRAINT "absensi_weekly_awards_week_key_len" CHECK (char_length("week_key") <= 20);
ALTER TABLE "absensi_weekly_awards" ADD CONSTRAINT "absensi_weekly_awards_month_label_len" CHECK (char_length("month_label") <= 50);
ALTER TABLE "pejabat_ttd" ADD CONSTRAINT "pejabat_ttd_nama_pejabat_len" CHECK (char_length("nama_pejabat") <= 255);
ALTER TABLE "pejabat_ttd" ADD CONSTRAINT "pejabat_ttd_ttd_path_len" CHECK (char_length("ttd_path") <= 255);
ALTER TABLE "pengurus" ADD CONSTRAINT "pengurus_id_len" CHECK (char_length("id") <= 36);
ALTER TABLE "pengurus" ADD CONSTRAINT "pengurus_pengurusable_id_len" CHECK (char_length("pengurusable_id") <= 36);
ALTER TABLE "pengurus" ADD CONSTRAINT "pengurus_pengurusable_type_len" CHECK (char_length("pengurusable_type") <= 255);
ALTER TABLE "pengurus" ADD CONSTRAINT "pengurus_jabatan_len" CHECK (char_length("jabatan") <= 255);
ALTER TABLE "pengurus" ADD CONSTRAINT "pengurus_produk_hukum_id_len" CHECK (char_length("produk_hukum_id") <= 36);
ALTER TABLE "pengurus" ADD CONSTRAINT "pengurus_nama_lengkap_len" CHECK (char_length("nama_lengkap") <= 255);
ALTER TABLE "pengurus" ADD CONSTRAINT "pengurus_nik_len" CHECK (char_length("nik") <= 32);
ALTER TABLE "pengurus" ADD CONSTRAINT "pengurus_tempat_lahir_len" CHECK (char_length("tempat_lahir") <= 255);
ALTER TABLE "pengurus" ADD CONSTRAINT "pengurus_status_perkawinan_len" CHECK (char_length("status_perkawinan") <= 255);
ALTER TABLE "pengurus" ADD CONSTRAINT "pengurus_no_telepon_len" CHECK (char_length("no_telepon") <= 32);
ALTER TABLE "pengurus" ADD CONSTRAINT "pengurus_nama_bank_len" CHECK (char_length("nama_bank") <= 100);
ALTER TABLE "pengurus" ADD CONSTRAINT "pengurus_nomor_rekening_len" CHECK (char_length("nomor_rekening") <= 100);
ALTER TABLE "pengurus" ADD CONSTRAINT "pengurus_nama_rekening_len" CHECK (char_length("nama_rekening") <= 255);
ALTER TABLE "pengurus" ADD CONSTRAINT "pengurus_pendidikan_len" CHECK (char_length("pendidikan") <= 255);
ALTER TABLE "pengurus" ADD CONSTRAINT "pengurus_avatar_len" CHECK (char_length("avatar") <= 255);
ALTER TABLE "pengurus" ADD CONSTRAINT "pengurus_verifikator_nama_len" CHECK (char_length("verifikator_nama") <= 255);
ALTER TABLE "pengurus" ADD CONSTRAINT "pengurus_agama_len" CHECK (char_length("agama") <= 50);
ALTER TABLE "pengurus" ADD CONSTRAINT "pengurus_golongan_darah_len" CHECK (char_length("golongan_darah") <= 5);
ALTER TABLE "pengurus" ADD CONSTRAINT "pengurus_nomor_buku_nikah_len" CHECK (char_length("nomor_buku_nikah") <= 100);
ALTER TABLE "perjadin_grup" ADD CONSTRAINT "perjadin_grup_nama_grup_len" CHECK (char_length("nama_grup") <= 255);
ALTER TABLE "perjadin_grup" ADD CONSTRAINT "perjadin_grup_lokasi_tujuan_len" CHECK (char_length("lokasi_tujuan") <= 255);
ALTER TABLE "perjadin_grup" ADD CONSTRAINT "perjadin_grup_nomor_sp_grup_len" CHECK (char_length("nomor_sp_grup") <= 100);
ALTER TABLE "petugas_monitoring" ADD CONSTRAINT "petugas_monitoring_nama_desa_len" CHECK (char_length("nama_desa") <= 255);
ALTER TABLE "petugas_monitoring" ADD CONSTRAINT "petugas_monitoring_nama_kecamatan_len" CHECK (char_length("nama_kecamatan") <= 255);
ALTER TABLE "petugas_monitoring" ADD CONSTRAINT "petugas_monitoring_nama_petugas_len" CHECK (char_length("nama_petugas") <= 255);
ALTER TABLE "pkks" ADD CONSTRAINT "pkks_id_len" CHECK (char_length("id") <= 36);
ALTER TABLE "pkks" ADD CONSTRAINT "pkks_nama_len" CHECK (char_length("nama") <= 255);
ALTER TABLE "pkks" ADD CONSTRAINT "pkks_alamat_len" CHECK (char_length("alamat") <= 255);
ALTER TABLE "pkks" ADD CONSTRAINT "pkks_produk_hukum_id_len" CHECK (char_length("produk_hukum_id") <= 36);
ALTER TABLE "pkks" ADD CONSTRAINT "pkks_produk_hukum_penonaktifan_id_len" CHECK (char_length("produk_hukum_penonaktifan_id") <= 36);
ALTER TABLE "pkks" ADD CONSTRAINT "pkks_alasan_nonaktif_len" CHECK (char_length("alasan_nonaktif") <= 100);
ALTER TABLE "pkks" ADD CONSTRAINT "pkks_verifikator_nama_len" CHECK (char_length("verifikator_nama") <= 255);
ALTER TABLE "posyandus" ADD CONSTRAINT "posyandus_id_len" CHECK (char_length("id") <= 36);
ALTER TABLE "posyandus" ADD CONSTRAINT "posyandus_nama_len" CHECK (char_length("nama") <= 255);
ALTER TABLE "posyandus" ADD CONSTRAINT "posyandus_alamat_len" CHECK (char_length("alamat") <= 255);
ALTER TABLE "posyandus" ADD CONSTRAINT "posyandus_produk_hukum_id_len" CHECK (char_length("produk_hukum_id") <= 36);
ALTER TABLE "posyandus" ADD CONSTRAINT "posyandus_produk_hukum_penonaktifan_id_len" CHECK (char_length("produk_hukum_penonaktifan_id") <= 36);
ALTER TABLE "posyandus" ADD CONSTRAINT "posyandus_alasan_nonaktif_len" CHECK (char_length("alasan_nonaktif") <= 100);
ALTER TABLE "posyandus" ADD CONSTRAINT "posyandus_verifikator_nama_len" CHECK (char_length("verifikator_nama") <= 255);
ALTER TABLE "products" ADD CONSTRAINT "products_name_len" CHECK (char_length("name") <= 255);
ALTER TABLE "produk_hukums" ADD CONSTRAINT "produk_hukums_id_len" CHECK (char_length("id") <= 36);
ALTER TABLE "produk_hukums" ADD CONSTRAINT "produk_hukums_uuid_len" CHECK (char_length("uuid") <= 36);
ALTER TABLE "produk_hukums" ADD CONSTRAINT "produk_hukums_tipe_dokumen_len" CHECK (char_length("tipe_dokumen") <= 255);
ALTER TABLE "produk_hukums" ADD CONSTRAINT "produk_hukums_judul_len" CHECK (char_length("judul") <= 255);
ALTER TABLE "produk_hukums" ADD CONSTRAINT "produk_hukums_nomor_len" CHECK (char_length("nomor") <= 255);
ALTER TABLE "produk_hukums" ADD CONSTRAINT "produk_hukums_tempat_penetapan_len" CHECK (char_length("tempat_penetapan") <= 255);
ALTER TABLE "produk_hukums" ADD CONSTRAINT "produk_hukums_sumber_len" CHECK (char_length("sumber") <= 255);
ALTER TABLE "produk_hukums" ADD CONSTRAINT "produk_hukums_subjek_len" CHECK (char_length("subjek") <= 255);
ALTER TABLE "produk_hukums" ADD CONSTRAINT "produk_hukums_keterangan_status_len" CHECK (char_length("keterangan_status") <= 255);
ALTER TABLE "produk_hukums" ADD CONSTRAINT "produk_hukums_bahasa_len" CHECK (char_length("bahasa") <= 255);
ALTER TABLE "produk_hukums" ADD CONSTRAINT "produk_hukums_bidang_hukum_len" CHECK (char_length("bidang_hukum") <= 255);
ALTER TABLE "produk_hukums" ADD CONSTRAINT "produk_hukums_file_len" CHECK (char_length("file") <= 255);
ALTER TABLE "produk_hukum_bidang" ADD CONSTRAINT "produk_hukum_bidang_jenis_len" CHECK (char_length("jenis") <= 100);
ALTER TABLE "produk_hukum_bidang" ADD CONSTRAINT "produk_hukum_bidang_singkatan_jenis_len" CHECK (char_length("singkatan_jenis") <= 30);
ALTER TABLE "produk_hukum_bidang" ADD CONSTRAINT "produk_hukum_bidang_judul_len" CHECK (char_length("judul") <= 500);
ALTER TABLE "produk_hukum_bidang" ADD CONSTRAINT "produk_hukum_bidang_nomor_len" CHECK (char_length("nomor") <= 100);
ALTER TABLE "produk_hukum_bidang" ADD CONSTRAINT "produk_hukum_bidang_tentang_len" CHECK (char_length("tentang") <= 500);
ALTER TABLE "produk_hukum_bidang" ADD CONSTRAINT "produk_hukum_bidang_tempat_penetapan_len" CHECK (char_length("tempat_penetapan") <= 255);
ALTER TABLE "produk_hukum_bidang" ADD CONSTRAINT "produk_hukum_bidang_sumber_len" CHECK (char_length("sumber") <= 255);
ALTER TABLE "produk_hukum_bidang" ADD CONSTRAINT "produk_hukum_bidang_keterangan_status_len" CHECK (char_length("keterangan_status") <= 500);
ALTER TABLE "produk_hukum_bidang" ADD CONSTRAINT "produk_hukum_bidang_bidang_hukum_len" CHECK (char_length("bidang_hukum") <= 100);
ALTER TABLE "produk_hukum_bidang" ADD CONSTRAINT "produk_hukum_bidang_file_len" CHECK (char_length("file") <= 255);
ALTER TABLE "produk_hukum_bidang" ADD CONSTRAINT "produk_hukum_bidang_url_sumber_len" CHECK (char_length("url_sumber") <= 1000);
ALTER TABLE "produk_hukum_referensi" ADD CONSTRAINT "produk_hukum_referensi_jenis_len" CHECK (char_length("jenis") <= 100);
ALTER TABLE "produk_hukum_referensi" ADD CONSTRAINT "produk_hukum_referensi_singkatan_jenis_len" CHECK (char_length("singkatan_jenis") <= 30);
ALTER TABLE "produk_hukum_referensi" ADD CONSTRAINT "produk_hukum_referensi_nomor_len" CHECK (char_length("nomor") <= 50);
ALTER TABLE "produk_hukum_referensi" ADD CONSTRAINT "produk_hukum_referensi_judul_len" CHECK (char_length("judul") <= 500);
ALTER TABLE "produk_hukum_referensi" ADD CONSTRAINT "produk_hukum_referensi_tentang_len" CHECK (char_length("tentang") <= 500);
ALTER TABLE "produk_hukum_referensi" ADD CONSTRAINT "produk_hukum_referensi_topik_len" CHECK (char_length("topik") <= 100);
ALTER TABLE "produk_hukum_referensi" ADD CONSTRAINT "produk_hukum_referensi_url_len" CHECK (char_length("url") <= 1000);
ALTER TABLE "produk_hukum_referensi" ADD CONSTRAINT "produk_hukum_referensi_sumber_situs_len" CHECK (char_length("sumber_situs") <= 255);
ALTER TABLE "produk_hukum_referensi" ADD CONSTRAINT "produk_hukum_referensi_keterangan_status_len" CHECK (char_length("keterangan_status") <= 500);
ALTER TABLE "profil_desas" ADD CONSTRAINT "profil_desas_klasifikasi_desa_len" CHECK (char_length("klasifikasi_desa") <= 255);
ALTER TABLE "profil_desas" ADD CONSTRAINT "profil_desas_status_desa_len" CHECK (char_length("status_desa") <= 255);
ALTER TABLE "profil_desas" ADD CONSTRAINT "profil_desas_tipologi_desa_len" CHECK (char_length("tipologi_desa") <= 255);
ALTER TABLE "profil_desas" ADD CONSTRAINT "profil_desas_no_telp_len" CHECK (char_length("no_telp") <= 255);
ALTER TABLE "profil_desas" ADD CONSTRAINT "profil_desas_email_len" CHECK (char_length("email") <= 255);
ALTER TABLE "profil_desas" ADD CONSTRAINT "profil_desas_instagram_url_len" CHECK (char_length("instagram_url") <= 255);
ALTER TABLE "profil_desas" ADD CONSTRAINT "profil_desas_youtube_url_len" CHECK (char_length("youtube_url") <= 255);
ALTER TABLE "profil_desas" ADD CONSTRAINT "profil_desas_luas_wilayah_len" CHECK (char_length("luas_wilayah") <= 255);
ALTER TABLE "profil_desas" ADD CONSTRAINT "profil_desas_radius_ke_kecamatan_len" CHECK (char_length("radius_ke_kecamatan") <= 255);
ALTER TABLE "profil_desas" ADD CONSTRAINT "profil_desas_foto_kantor_desa_path_len" CHECK (char_length("foto_kantor_desa_path") <= 255);
ALTER TABLE "rts" ADD CONSTRAINT "rts_id_len" CHECK (char_length("id") <= 36);
ALTER TABLE "rts" ADD CONSTRAINT "rts_rw_id_len" CHECK (char_length("rw_id") <= 36);
ALTER TABLE "rts" ADD CONSTRAINT "rts_nomor_len" CHECK (char_length("nomor") <= 255);
ALTER TABLE "rts" ADD CONSTRAINT "rts_alamat_len" CHECK (char_length("alamat") <= 255);
ALTER TABLE "rts" ADD CONSTRAINT "rts_produk_hukum_id_len" CHECK (char_length("produk_hukum_id") <= 36);
ALTER TABLE "rts" ADD CONSTRAINT "rts_produk_hukum_penonaktifan_id_len" CHECK (char_length("produk_hukum_penonaktifan_id") <= 36);
ALTER TABLE "rts" ADD CONSTRAINT "rts_alasan_nonaktif_len" CHECK (char_length("alasan_nonaktif") <= 100);
ALTER TABLE "rts" ADD CONSTRAINT "rts_verifikator_nama_len" CHECK (char_length("verifikator_nama") <= 255);
ALTER TABLE "rws" ADD CONSTRAINT "rws_id_len" CHECK (char_length("id") <= 36);
ALTER TABLE "rws" ADD CONSTRAINT "rws_nomor_len" CHECK (char_length("nomor") <= 255);
ALTER TABLE "rws" ADD CONSTRAINT "rws_alamat_len" CHECK (char_length("alamat") <= 255);
ALTER TABLE "rws" ADD CONSTRAINT "rws_produk_hukum_id_len" CHECK (char_length("produk_hukum_id") <= 36);
ALTER TABLE "rws" ADD CONSTRAINT "rws_produk_hukum_penonaktifan_id_len" CHECK (char_length("produk_hukum_penonaktifan_id") <= 36);
ALTER TABLE "rws" ADD CONSTRAINT "rws_alasan_nonaktif_len" CHECK (char_length("alasan_nonaktif") <= 100);
ALTER TABLE "rws" ADD CONSTRAINT "rws_verifikator_nama_len" CHECK (char_length("verifikator_nama") <= 255);
ALTER TABLE "satlinmas" ADD CONSTRAINT "satlinmas_id_len" CHECK (char_length("id") <= 36);
ALTER TABLE "satlinmas" ADD CONSTRAINT "satlinmas_nama_len" CHECK (char_length("nama") <= 255);
ALTER TABLE "satlinmas" ADD CONSTRAINT "satlinmas_alamat_len" CHECK (char_length("alamat") <= 255);
ALTER TABLE "satlinmas" ADD CONSTRAINT "satlinmas_produk_hukum_id_len" CHECK (char_length("produk_hukum_id") <= 36);
ALTER TABLE "satlinmas" ADD CONSTRAINT "satlinmas_produk_hukum_penonaktifan_id_len" CHECK (char_length("produk_hukum_penonaktifan_id") <= 36);
ALTER TABLE "satlinmas" ADD CONSTRAINT "satlinmas_alasan_nonaktif_len" CHECK (char_length("alasan_nonaktif") <= 100);
ALTER TABLE "satlinmas" ADD CONSTRAINT "satlinmas_verifikator_nama_len" CHECK (char_length("verifikator_nama") <= 255);
ALTER TABLE "surat_masuk" ADD CONSTRAINT "surat_masuk_nomor_surat_len" CHECK (char_length("nomor_surat") <= 100);
ALTER TABLE "surat_masuk" ADD CONSTRAINT "surat_masuk_pengirim_len" CHECK (char_length("pengirim") <= 255);
ALTER TABLE "surat_masuk" ADD CONSTRAINT "surat_masuk_file_path_len" CHECK (char_length("file_path") <= 500);
ALTER TABLE "surat_masuk" ADD CONSTRAINT "surat_masuk_file_disposisi_path_len" CHECK (char_length("file_disposisi_path") <= 500);
ALTER TABLE "surat_masuk" ADD CONSTRAINT "surat_masuk_jam_kegiatan_len" CHECK (char_length("jam_kegiatan") <= 10);
ALTER TABLE "surat_masuk" ADD CONSTRAINT "surat_masuk_lokasi_kegiatan_len" CHECK (char_length("lokasi_kegiatan") <= 255);
ALTER TABLE "tim_verifikasi_kecamatan" ADD CONSTRAINT "tim_verifikasi_kecamatan_jabatan_len" CHECK (char_length("jabatan") <= 50);
ALTER TABLE "tim_verifikasi_kecamatan" ADD CONSTRAINT "tim_verifikasi_kecamatan_jabatan_label_len" CHECK (char_length("jabatan_label") <= 255);
ALTER TABLE "tim_verifikasi_kecamatan" ADD CONSTRAINT "tim_verifikasi_kecamatan_nama_len" CHECK (char_length("nama") <= 255);
ALTER TABLE "tim_verifikasi_kecamatan" ADD CONSTRAINT "tim_verifikasi_kecamatan_nip_len" CHECK (char_length("nip") <= 50);
ALTER TABLE "tim_verifikasi_kecamatan" ADD CONSTRAINT "tim_verifikasi_kecamatan_ttd_path_len" CHECK (char_length("ttd_path") <= 255);
ALTER TABLE "roles" ADD CONSTRAINT "roles_name_len" CHECK (char_length("name") <= 50);
ALTER TABLE "roles" ADD CONSTRAINT "roles_label_len" CHECK (char_length("label") <= 100);
ALTER TABLE "roles" ADD CONSTRAINT "roles_color_len" CHECK (char_length("color") <= 30);
ALTER TABLE "roles" ADD CONSTRAINT "roles_description_len" CHECK (char_length("description") <= 255);
ALTER TABLE "roles" ADD CONSTRAINT "roles_category_len" CHECK (char_length("category") <= 50);
ALTER TABLE "tugas_pribadi" ADD CONSTRAINT "tugas_pribadi_judul_len" CHECK (char_length("judul") <= 160);
ALTER TABLE "catatan_pribadi" ADD CONSTRAINT "catatan_pribadi_judul_len" CHECK (char_length("judul") <= 120);
ALTER TABLE "user_totp" ADD CONSTRAINT "user_totp_rahasia_len" CHECK (char_length("rahasia") <= 255);
ALTER TABLE "users" ADD CONSTRAINT "users_name_len" CHECK (char_length("name") <= 255);
ALTER TABLE "users" ADD CONSTRAINT "users_email_len" CHECK (char_length("email") <= 255);
ALTER TABLE "users" ADD CONSTRAINT "users_password_len" CHECK (char_length("password") <= 255);
ALTER TABLE "users" ADD CONSTRAINT "users_plain_password_len" CHECK (char_length("plain_password") <= 255);
ALTER TABLE "users" ADD CONSTRAINT "users_role_len" CHECK (char_length("role") <= 50);
ALTER TABLE "users" ADD CONSTRAINT "users_jabatan_desa_len" CHECK (char_length("jabatan_desa") <= 100);
ALTER TABLE "users" ADD CONSTRAINT "users_no_hp_len" CHECK (char_length("no_hp") <= 20);
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_len" CHECK (char_length("avatar") <= 255);
ALTER TABLE "users" ADD CONSTRAINT "users_remember_token_len" CHECK (char_length("remember_token") <= 100);
ALTER TABLE "users" ADD CONSTRAINT "users_device_id_len" CHECK (char_length("device_id") <= 100);
ALTER TABLE "desa_user_permissions" ADD CONSTRAINT "desa_user_permissions_permission_key_len" CHECK (char_length("permission_key") <= 50);
ALTER TABLE "cctv_akses" ADD CONSTRAINT "cctv_akses_izin_len" CHECK (char_length("izin") <= 20);
ALTER TABLE "kecamatan_user_permissions" ADD CONSTRAINT "kecamatan_user_permissions_permission_key_len" CHECK (char_length("permission_key") <= 50);
ALTER TABLE "berita_acara_history" ADD CONSTRAINT "berita_acara_history_file_path_len" CHECK (char_length("file_path") <= 255);
ALTER TABLE "berita_acara_history" ADD CONSTRAINT "berita_acara_history_file_name_len" CHECK (char_length("file_name") <= 255);
ALTER TABLE "berita_acara_history" ADD CONSTRAINT "berita_acara_history_qr_code_len" CHECK (char_length("qr_code") <= 100);
ALTER TABLE "berita_acara_history" ADD CONSTRAINT "berita_acara_history_qr_code_path_len" CHECK (char_length("qr_code_path") <= 255);
ALTER TABLE "perjadin_pegawai" ADD CONSTRAINT "perjadin_pegawai_lokasi_tujuan_len" CHECK (char_length("lokasi_tujuan") <= 255);
ALTER TABLE "perjadin_pegawai" ADD CONSTRAINT "perjadin_pegawai_nomor_sppd_len" CHECK (char_length("nomor_sppd") <= 100);
ALTER TABLE "info_banners" ADD CONSTRAINT "info_banners_judul_len" CHECK (char_length("judul") <= 255);
ALTER TABLE "info_banners" ADD CONSTRAINT "info_banners_gambar_len" CHECK (char_length("gambar") <= 500);
ALTER TABLE "info_banners" ADD CONSTRAINT "info_banners_link_len" CHECK (char_length("link") <= 500);
ALTER TABLE "video_meeting_chats" ADD CONSTRAINT "video_meeting_chats_file_url_len" CHECK (char_length("file_url") <= 500);
ALTER TABLE "video_meeting_invitations" ADD CONSTRAINT "video_meeting_invitations_email_len" CHECK (char_length("email") <= 255);
ALTER TABLE "video_meeting_participants" ADD CONSTRAINT "video_meeting_participants_guest_name_len" CHECK (char_length("guest_name") <= 255);
ALTER TABLE "video_meeting_recordings" ADD CONSTRAINT "video_meeting_recordings_file_path_len" CHECK (char_length("file_path") <= 500);
ALTER TABLE "video_meetings" ADD CONSTRAINT "video_meetings_uuid_len" CHECK (char_length("uuid") <= 36);
ALTER TABLE "video_meetings" ADD CONSTRAINT "video_meetings_room_id_len" CHECK (char_length("room_id") <= 100);
ALTER TABLE "video_meetings" ADD CONSTRAINT "video_meetings_title_len" CHECK (char_length("title") <= 255);
ALTER TABLE "video_meetings" ADD CONSTRAINT "video_meetings_mode_len" CHECK (char_length("mode") <= 20);
ALTER TABLE "video_meetings" ADD CONSTRAINT "video_meetings_password_len" CHECK (char_length("password") <= 100);
ALTER TABLE "user_statuses" ADD CONSTRAINT "user_statuses_background_color_len" CHECK (char_length("background_color") <= 20);
ALTER TABLE "user_statuses" ADD CONSTRAINT "user_statuses_media_path_len" CHECK (char_length("media_path") <= 500);
ALTER TABLE "klasifikasi_arsip" ADD CONSTRAINT "klasifikasi_arsip_kode_len" CHECK (char_length("kode") <= 20);
ALTER TABLE "klasifikasi_arsip" ADD CONSTRAINT "klasifikasi_arsip_nama_len" CHECK (char_length("nama") <= 500);
ALTER TABLE "klasifikasi_arsip" ADD CONSTRAINT "klasifikasi_arsip_parent_kode_len" CHECK (char_length("parent_kode") <= 20);
ALTER TABLE "nomor_surat_requests" ADD CONSTRAINT "nomor_surat_requests_klasifikasi_kode_len" CHECK (char_length("klasifikasi_kode") <= 20);
ALTER TABLE "nomor_surat_requests" ADD CONSTRAINT "nomor_surat_requests_nomor_surat_generated_len" CHECK (char_length("nomor_surat_generated") <= 255);
ALTER TABLE "nomor_surat_requests" ADD CONSTRAINT "nomor_surat_requests_perihal_len" CHECK (char_length("perihal") <= 500);
ALTER TABLE "nomor_surat_requests" ADD CONSTRAINT "nomor_surat_requests_bidang_nama_len" CHECK (char_length("bidang_nama") <= 100);
ALTER TABLE "nomor_surat_requests" ADD CONSTRAINT "nomor_surat_requests_requested_by_name_len" CHECK (char_length("requested_by_name") <= 255);
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_group_avatar_len" CHECK (char_length("group_avatar") <= 500);
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_group_name_len" CHECK (char_length("group_name") <= 100);
ALTER TABLE "messages" ADD CONSTRAINT "messages_file_path_len" CHECK (char_length("file_path") <= 500);
ALTER TABLE "messages" ADD CONSTRAINT "messages_file_name_len" CHECK (char_length("file_name") <= 255);
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_emoji_len" CHECK (char_length("emoji") <= 32);
ALTER TABLE "pencairan" ADD CONSTRAINT "pencairan_no_pesanan_a_len" CHECK (char_length("no_pesanan_a") <= 150);
ALTER TABLE "pencairan" ADD CONSTRAINT "pencairan_no_pesanan_b_len" CHECK (char_length("no_pesanan_b") <= 150);
ALTER TABLE "pencairan" ADD CONSTRAINT "pencairan_no_faktur_len" CHECK (char_length("no_faktur") <= 150);
ALTER TABLE "pencairan" ADD CONSTRAINT "pencairan_no_kwitansi_len" CHECK (char_length("no_kwitansi") <= 150);
ALTER TABLE "pencairan" ADD CONSTRAINT "pencairan_no_ba_pemeriksaan_len" CHECK (char_length("no_ba_pemeriksaan") <= 150);
ALTER TABLE "pencairan" ADD CONSTRAINT "pencairan_no_bast_len" CHECK (char_length("no_bast") <= 150);
ALTER TABLE "pencairan" ADD CONSTRAINT "pencairan_no_basthp_len" CHECK (char_length("no_basthp") <= 150);
ALTER TABLE "pencairan" ADD CONSTRAINT "pencairan_no_bappbj_len" CHECK (char_length("no_bappbj") <= 150);
ALTER TABLE "pencairan" ADD CONSTRAINT "pencairan_no_lampiran_bat_len" CHECK (char_length("no_lampiran_bat") <= 150);
ALTER TABLE "pencairan" ADD CONSTRAINT "pencairan_no_surat_perintah_tugas_len" CHECK (char_length("no_surat_perintah_tugas") <= 150);
ALTER TABLE "pencairan" ADD CONSTRAINT "pencairan_no_sk_bupati_kpa_len" CHECK (char_length("no_sk_bupati_kpa") <= 150);
ALTER TABLE "pencairan" ADD CONSTRAINT "pencairan_no_sk_kadis_ppk_len" CHECK (char_length("no_sk_kadis_ppk") <= 150);
ALTER TABLE "pencairan" ADD CONSTRAINT "pencairan_total_terbilang_len" CHECK (char_length("total_terbilang") <= 500);
ALTER TABLE "pencairan_items" ADD CONSTRAINT "pencairan_items_nama_barang_len" CHECK (char_length("nama_barang") <= 500);
ALTER TABLE "pencairan_items" ADD CONSTRAINT "pencairan_items_kode_rekening_len" CHECK (char_length("kode_rekening") <= 500);
ALTER TABLE "pencairan_items" ADD CONSTRAINT "pencairan_items_satuan_len" CHECK (char_length("satuan") <= 100);
ALTER TABLE "penyedia" ADD CONSTRAINT "penyedia_nama_len" CHECK (char_length("nama") <= 255);
ALTER TABLE "penyedia" ADD CONSTRAINT "penyedia_npwp_len" CHECK (char_length("npwp") <= 50);
ALTER TABLE "penyedia" ADD CONSTRAINT "penyedia_nama_direktur_len" CHECK (char_length("nama_direktur") <= 255);
ALTER TABLE "penyedia" ADD CONSTRAINT "penyedia_jabatan_direktur_len" CHECK (char_length("jabatan_direktur") <= 100);
ALTER TABLE "penyedia" ADD CONSTRAINT "penyedia_no_rekening_len" CHECK (char_length("no_rekening") <= 50);
ALTER TABLE "penyedia" ADD CONSTRAINT "penyedia_nama_bank_len" CHECK (char_length("nama_bank") <= 100);
ALTER TABLE "penyedia" ADD CONSTRAINT "penyedia_telepon_len" CHECK (char_length("telepon") <= 30);
ALTER TABLE "penyedia" ADD CONSTRAINT "penyedia_email_len" CHECK (char_length("email") <= 150);
ALTER TABLE "arsip_barang" ADD CONSTRAINT "arsip_barang_kode_barang_len" CHECK (char_length("kode_barang") <= 50);
ALTER TABLE "arsip_barang" ADD CONSTRAINT "arsip_barang_public_token_len" CHECK (char_length("public_token") <= 32);
ALTER TABLE "arsip_barang" ADD CONSTRAINT "arsip_barang_nama_len" CHECK (char_length("nama") <= 255);
ALTER TABLE "arsip_barang" ADD CONSTRAINT "arsip_barang_merk_tipe_len" CHECK (char_length("merk_tipe") <= 255);
ALTER TABLE "arsip_barang" ADD CONSTRAINT "arsip_barang_nomor_seri_len" CHECK (char_length("nomor_seri") <= 120);
ALTER TABLE "arsip_barang" ADD CONSTRAINT "arsip_barang_foto_len" CHECK (char_length("foto") <= 255);
ALTER TABLE "arsip_barang" ADD CONSTRAINT "arsip_barang_satuan_len" CHECK (char_length("satuan") <= 30);
ALTER TABLE "arsip_barang" ADD CONSTRAINT "arsip_barang_lokasi_len" CHECK (char_length("lokasi") <= 255);
ALTER TABLE "arsip_barang" ADD CONSTRAINT "arsip_barang_pemegang_nama_len" CHECK (char_length("pemegang_nama") <= 255);
ALTER TABLE "arsip_barang" ADD CONSTRAINT "arsip_barang_nomor_kontrak_len" CHECK (char_length("nomor_kontrak") <= 120);
ALTER TABLE "arsip_barang" ADD CONSTRAINT "arsip_barang_nomor_faktur_len" CHECK (char_length("nomor_faktur") <= 120);
ALTER TABLE "arsip_barang" ADD CONSTRAINT "arsip_barang_nomor_ba_penghapusan_len" CHECK (char_length("nomor_ba_penghapusan") <= 120);
ALTER TABLE "arsip_barang_kategori" ADD CONSTRAINT "arsip_barang_kategori_nama_len" CHECK (char_length("nama") <= 150);
ALTER TABLE "arsip_barang_kategori" ADD CONSTRAINT "arsip_barang_kategori_kode_len" CHECK (char_length("kode") <= 10);
ALTER TABLE "arsip_barang_kategori" ADD CONSTRAINT "arsip_barang_kategori_deskripsi_len" CHECK (char_length("deskripsi") <= 255);
ALTER TABLE "arsip_barang_mutasi" ADD CONSTRAINT "arsip_barang_mutasi_nilai_lama_len" CHECK (char_length("nilai_lama") <= 255);
ALTER TABLE "arsip_barang_mutasi" ADD CONSTRAINT "arsip_barang_mutasi_nilai_baru_len" CHECK (char_length("nilai_baru") <= 255);
ALTER TABLE "arsip_barang_mutasi" ADD CONSTRAINT "arsip_barang_mutasi_user_name_len" CHECK (char_length("user_name") <= 255);
ALTER TABLE "arsip_barang_scan_log" ADD CONSTRAINT "arsip_barang_scan_log_user_name_len" CHECK (char_length("user_name") <= 255);
ALTER TABLE "arsip_barang_scan_log" ADD CONSTRAINT "arsip_barang_scan_log_ip_address_len" CHECK (char_length("ip_address") <= 45);
ALTER TABLE "arsip_barang_scan_log" ADD CONSTRAINT "arsip_barang_scan_log_user_agent_len" CHECK (char_length("user_agent") <= 500);
ALTER TABLE "pencairan_sk_ref" ADD CONSTRAINT "pencairan_sk_ref_jenis_len" CHECK (char_length("jenis") <= 20);
ALTER TABLE "pencairan_sk_ref" ADD CONSTRAINT "pencairan_sk_ref_nomor_len" CHECK (char_length("nomor") <= 255);
ALTER TABLE "pencairan_sk_ref" ADD CONSTRAINT "pencairan_sk_ref_keterangan_len" CHECK (char_length("keterangan") <= 255);
ALTER TABLE "drive_folder" ADD CONSTRAINT "drive_folder_nama_len" CHECK (char_length("nama") <= 255);
ALTER TABLE "drive_folder" ADD CONSTRAINT "drive_folder_jalur_len" CHECK (char_length("jalur") <= 1000);
ALTER TABLE "drive_file" ADD CONSTRAINT "drive_file_nama_len" CHECK (char_length("nama") <= 255);
ALTER TABLE "drive_file" ADD CONSTRAINT "drive_file_nama_asli_len" CHECK (char_length("nama_asli") <= 255);
ALTER TABLE "drive_file" ADD CONSTRAINT "drive_file_mime_len" CHECK (char_length("mime") <= 150);
ALTER TABLE "drive_file" ADD CONSTRAINT "drive_file_ekstensi_len" CHECK (char_length("ekstensi") <= 20);
ALTER TABLE "drive_file" ADD CONSTRAINT "drive_file_nama_disk_len" CHECK (char_length("nama_disk") <= 120);
ALTER TABLE "drive_file" ADD CONSTRAINT "drive_file_jalur_disk_len" CHECK (char_length("jalur_disk") <= 500);
ALTER TABLE "drive_file" ADD CONSTRAINT "drive_file_checksum_len" CHECK (char_length("checksum") <= 64);
ALTER TABLE "formulir" ADD CONSTRAINT "formulir_judul_len" CHECK (char_length("judul") <= 255);
ALTER TABLE "formulir" ADD CONSTRAINT "formulir_token_len" CHECK (char_length("token") <= 32);
ALTER TABLE "formulir_pertanyaan" ADD CONSTRAINT "formulir_pertanyaan_label_len" CHECK (char_length("label") <= 500);
ALTER TABLE "formulir_respons" ADD CONSTRAINT "formulir_respons_nama_responden_len" CHECK (char_length("nama_responden") <= 255);
ALTER TABLE "formulir_respons" ADD CONSTRAINT "formulir_respons_email_len" CHECK (char_length("email") <= 255);
ALTER TABLE "formulir_respons" ADD CONSTRAINT "formulir_respons_ip_len" CHECK (char_length("ip") <= 45);
ALTER TABLE "formulir_berkas" ADD CONSTRAINT "formulir_berkas_nama_len" CHECK (char_length("nama") <= 255);
ALTER TABLE "formulir_berkas" ADD CONSTRAINT "formulir_berkas_mime_len" CHECK (char_length("mime") <= 150);
ALTER TABLE "formulir_berkas" ADD CONSTRAINT "formulir_berkas_nama_disk_len" CHECK (char_length("nama_disk") <= 120);
ALTER TABLE "formulir_berkas" ADD CONSTRAINT "formulir_berkas_jalur_disk_len" CHECK (char_length("jalur_disk") <= 500);
ALTER TABLE "video_desa_permintaan" ADD CONSTRAINT "video_desa_permintaan_judul_len" CHECK (char_length("judul") <= 255);
ALTER TABLE "video_desa_permintaan" ADD CONSTRAINT "video_desa_permintaan_token_len" CHECK (char_length("token") <= 32);
ALTER TABLE "video_desa_kiriman" ADD CONSTRAINT "video_desa_kiriman_nama_pengirim_len" CHECK (char_length("nama_pengirim") <= 150);
ALTER TABLE "video_desa_kiriman" ADD CONSTRAINT "video_desa_kiriman_no_hp_len" CHECK (char_length("no_hp") <= 30);
ALTER TABLE "video_desa_kiriman" ADD CONSTRAINT "video_desa_kiriman_nama_berkas_len" CHECK (char_length("nama_berkas") <= 255);
ALTER TABLE "video_desa_kiriman" ADD CONSTRAINT "video_desa_kiriman_mime_len" CHECK (char_length("mime") <= 100);
ALTER TABLE "video_desa_kiriman" ADD CONSTRAINT "video_desa_kiriman_sha256_len" CHECK (char_length("sha256") <= 64);
ALTER TABLE "video_desa_kiriman" ADD CONSTRAINT "video_desa_kiriman_codec_len" CHECK (char_length("codec") <= 30);
ALTER TABLE "video_desa_kiriman" ADD CONSTRAINT "video_desa_kiriman_nama_disk_len" CHECK (char_length("nama_disk") <= 120);
ALTER TABLE "video_desa_kiriman" ADD CONSTRAINT "video_desa_kiriman_jalur_disk_len" CHECK (char_length("jalur_disk") <= 500);
ALTER TABLE "video_desa_kiriman" ADD CONSTRAINT "video_desa_kiriman_pesan_proses_len" CHECK (char_length("pesan_proses") <= 500);
ALTER TABLE "video_desa_kiriman" ADD CONSTRAINT "video_desa_kiriman_ip_len" CHECK (char_length("ip") <= 45);
ALTER TABLE "video_desa_tautan" ADD CONSTRAINT "video_desa_tautan_token_len" CHECK (char_length("token") <= 32);
ALTER TABLE "kerjasama_desa_legalitas" ADD CONSTRAINT "kerjasama_desa_legalitas_nomor_perdes_len" CHECK (char_length("nomor_perdes") <= 100);
ALTER TABLE "kerjasama_desa_legalitas" ADD CONSTRAINT "kerjasama_desa_legalitas_produk_hukum_id_len" CHECK (char_length("produk_hukum_id") <= 36);
ALTER TABLE "kerjasama_desa_legalitas" ADD CONSTRAINT "kerjasama_desa_legalitas_keterangan_len" CHECK (char_length("keterangan") <= 255);
ALTER TABLE "kerjasama_desa" ADD CONSTRAINT "kerjasama_desa_sub_bidang_len" CHECK (char_length("sub_bidang") <= 255);
ALTER TABLE "kerjasama_desa" ADD CONSTRAINT "kerjasama_desa_mitra_len" CHECK (char_length("mitra") <= 255);
ALTER TABLE "kerjasama_desa" ADD CONSTRAINT "kerjasama_desa_file_permakades_len" CHECK (char_length("file_permakades") <= 255);
ALTER TABLE "kerjasama_desa" ADD CONSTRAINT "kerjasama_desa_file_sk_bkd_len" CHECK (char_length("file_sk_bkd") <= 255);
ALTER TABLE "kerjasama_desa" ADD CONSTRAINT "kerjasama_desa_file_pks_mou_len" CHECK (char_length("file_pks_mou") <= 255);
ALTER TABLE "cctv_cameras" ADD CONSTRAINT "cctv_cameras_name_len" CHECK (char_length("name") <= 255);
ALTER TABLE "cctv_cameras" ADD CONSTRAINT "cctv_cameras_lokasi_len" CHECK (char_length("lokasi") <= 255);
ALTER TABLE "cctv_cameras" ADD CONSTRAINT "cctv_cameras_rtsp_url_len" CHECK (char_length("rtsp_url") <= 500);
ALTER TABLE "cctv_cameras" ADD CONSTRAINT "cctv_cameras_rtsp_url_main_len" CHECK (char_length("rtsp_url_main") <= 500);
ALTER TABLE "cctv_cameras" ADD CONSTRAINT "cctv_cameras_rtsp_url_sub_len" CHECK (char_length("rtsp_url_sub") <= 500);
ALTER TABLE "cctv_cameras" ADD CONSTRAINT "cctv_cameras_username_len" CHECK (char_length("username") <= 100);
ALTER TABLE "cctv_cameras" ADD CONSTRAINT "cctv_cameras_password_enc_len" CHECK (char_length("password_enc") <= 500);
ALTER TABLE "cctv_cameras" ADD CONSTRAINT "cctv_cameras_go2rtc_src_len" CHECK (char_length("go2rtc_src") <= 100);
ALTER TABLE "cctv_faces" ADD CONSTRAINT "cctv_faces_nama_len" CHECK (char_length("nama") <= 255);
ALTER TABLE "cctv_faces" ADD CONSTRAINT "cctv_faces_kode_pegawai_len" CHECK (char_length("kode_pegawai") <= 50);
ALTER TABLE "cctv_faces" ADD CONSTRAINT "cctv_faces_departemen_len" CHECK (char_length("departemen") <= 255);
ALTER TABLE "cctv_faces" ADD CONSTRAINT "cctv_faces_foto_path_len" CHECK (char_length("foto_path") <= 500);
ALTER TABLE "cctv_face_embeddings" ADD CONSTRAINT "cctv_face_embeddings_image_path_len" CHECK (char_length("image_path") <= 500);
ALTER TABLE "cctv_events" ADD CONSTRAINT "cctv_events_event_uuid_len" CHECK (char_length("event_uuid") <= 64);
ALTER TABLE "cctv_events" ADD CONSTRAINT "cctv_events_nama_len" CHECK (char_length("nama") <= 255);
ALTER TABLE "cctv_events" ADD CONSTRAINT "cctv_events_track_id_len" CHECK (char_length("track_id") <= 100);
ALTER TABLE "cctv_events" ADD CONSTRAINT "cctv_events_snapshot_path_len" CHECK (char_length("snapshot_path") <= 500);

-- (e) TABEL DI LUAR PRISMA (dibangkitkan dari information_schema MySQL lokal; FK dilewati)
CREATE TABLE "_migration_history" (
  "id" integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "filename" citext NOT NULL,
  "ran_at" timestamp(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
ALTER TABLE "_migration_history" ADD CONSTRAINT "_migration_history_filename_len" CHECK (char_length("filename") <= 255);
CREATE UNIQUE INDEX "filename" ON "_migration_history" ("filename");
CREATE TABLE "bankeu_surat_templates" (
  "id" integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "kode" citext NOT NULL,
  "nama" citext NOT NULL,
  "deskripsi" citext,
  "kategori" citext NOT NULL DEFAULT 'desa',
  "content_html" citext NOT NULL,
  "placeholders" jsonb,
  "is_active" boolean NOT NULL DEFAULT true,
  "updated_by_user_id" bigint,
  "created_at" timestamp(0) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp(0),
  PRIMARY KEY ("id")
);
ALTER TABLE "bankeu_surat_templates" ADD CONSTRAINT "bankeu_surat_templates_kode_len" CHECK (char_length("kode") <= 50);
ALTER TABLE "bankeu_surat_templates" ADD CONSTRAINT "bankeu_surat_templates_nama_len" CHECK (char_length("nama") <= 255);
ALTER TABLE "bankeu_surat_templates" ADD CONSTRAINT "bankeu_surat_templates_kategori_enum" CHECK ("kategori" IN ('desa', 'kecamatan'));
CREATE INDEX "fk_surat_template_user" ON "bankeu_surat_templates" ("updated_by_user_id");
CREATE INDEX "bankeu_surat_templates_idx_kategori" ON "bankeu_surat_templates" ("kategori");
CREATE UNIQUE INDEX "unique_kode" ON "bankeu_surat_templates" ("kode");
CREATE TABLE "bankeu_verification_questionnaire" (
  "id" bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "proposal_id" bigint NOT NULL,
  "verifier_type" citext NOT NULL,
  "verifier_id" bigint,
  "item_1" citext DEFAULT 'ok',
  "item_2" citext DEFAULT 'ok',
  "item_3" citext DEFAULT 'ok',
  "item_4" citext DEFAULT 'ok',
  "item_5" citext DEFAULT 'ok',
  "item_6" citext DEFAULT 'ok',
  "item_7" citext DEFAULT 'ok',
  "item_8" citext DEFAULT 'ok',
  "item_9" citext DEFAULT 'ok',
  "item_10" citext DEFAULT 'ok',
  "item_11" citext DEFAULT 'ok',
  "item_12" citext DEFAULT 'ok',
  "item_13" citext DEFAULT 'ok',
  "catatan" citext,
  "created_at" timestamp(0) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp(0) DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
ALTER TABLE "bankeu_verification_questionnaire" ADD CONSTRAINT "bankeu_verification_questionnaire_verifier_type_enum" CHECK ("verifier_type" IN ('dinas', 'ketua', 'sekretaris', 'anggota_1', 'anggota_2', 'anggota_3', 'kecamatan_tim'));
ALTER TABLE "bankeu_verification_questionnaire" ADD CONSTRAINT "bankeu_verification_questionnaire_item_1_enum" CHECK ("item_1" IN ('ok', 'not_ok'));
ALTER TABLE "bankeu_verification_questionnaire" ADD CONSTRAINT "bankeu_verification_questionnaire_item_2_enum" CHECK ("item_2" IN ('ok', 'not_ok'));
ALTER TABLE "bankeu_verification_questionnaire" ADD CONSTRAINT "bankeu_verification_questionnaire_item_3_enum" CHECK ("item_3" IN ('ok', 'not_ok'));
ALTER TABLE "bankeu_verification_questionnaire" ADD CONSTRAINT "bankeu_verification_questionnaire_item_4_enum" CHECK ("item_4" IN ('ok', 'not_ok'));
ALTER TABLE "bankeu_verification_questionnaire" ADD CONSTRAINT "bankeu_verification_questionnaire_item_5_enum" CHECK ("item_5" IN ('ok', 'not_ok'));
ALTER TABLE "bankeu_verification_questionnaire" ADD CONSTRAINT "bankeu_verification_questionnaire_item_6_enum" CHECK ("item_6" IN ('ok', 'not_ok'));
ALTER TABLE "bankeu_verification_questionnaire" ADD CONSTRAINT "bankeu_verification_questionnaire_item_7_enum" CHECK ("item_7" IN ('ok', 'not_ok'));
ALTER TABLE "bankeu_verification_questionnaire" ADD CONSTRAINT "bankeu_verification_questionnaire_item_8_enum" CHECK ("item_8" IN ('ok', 'not_ok'));
ALTER TABLE "bankeu_verification_questionnaire" ADD CONSTRAINT "bankeu_verification_questionnaire_item_9_enum" CHECK ("item_9" IN ('ok', 'not_ok'));
ALTER TABLE "bankeu_verification_questionnaire" ADD CONSTRAINT "bankeu_verification_questionnaire_item_10_enum" CHECK ("item_10" IN ('ok', 'not_ok'));
ALTER TABLE "bankeu_verification_questionnaire" ADD CONSTRAINT "bankeu_verification_questionnaire_item_11_enum" CHECK ("item_11" IN ('ok', 'not_ok'));
ALTER TABLE "bankeu_verification_questionnaire" ADD CONSTRAINT "bankeu_verification_questionnaire_item_12_enum" CHECK ("item_12" IN ('ok', 'not_ok'));
ALTER TABLE "bankeu_verification_questionnaire" ADD CONSTRAINT "bankeu_verification_questionnaire_item_13_enum" CHECK ("item_13" IN ('ok', 'not_ok'));
CREATE INDEX "idx_proposal" ON "bankeu_verification_questionnaire" ("proposal_id");
CREATE INDEX "idx_verifier" ON "bankeu_verification_questionnaire" ("verifier_type", "verifier_id");
CREATE UNIQUE INDEX "unique_proposal_verifier" ON "bankeu_verification_questionnaire" ("proposal_id", "verifier_type", "verifier_id");
CREATE TABLE "desa_bankeu_perubahan_surat" (
  "id" bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "desa_id" bigint NOT NULL,
  "tahun" integer NOT NULL DEFAULT 2026,
  "surat_pengantar" citext,
  "surat_permohonan" citext,
  "submitted_to_kecamatan" boolean DEFAULT false,
  "submitted_at" timestamp(0),
  "kecamatan_review_status" citext,
  "kecamatan_review_catatan" citext,
  "kecamatan_review_by" bigint,
  "kecamatan_review_at" timestamp(0),
  "created_at" timestamp(0) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp(0) DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
ALTER TABLE "desa_bankeu_perubahan_surat" ADD CONSTRAINT "desa_bankeu_perubahan_surat_surat_pengantar_len" CHECK (char_length("surat_pengantar") <= 255);
ALTER TABLE "desa_bankeu_perubahan_surat" ADD CONSTRAINT "desa_bankeu_perubahan_surat_surat_permohonan_len" CHECK (char_length("surat_permohonan") <= 255);
ALTER TABLE "desa_bankeu_perubahan_surat" ADD CONSTRAINT "desa_bankeu_perubahan_surat_kecamatan_review_status_enum" CHECK ("kecamatan_review_status" IN ('pending', 'approved', 'rejected', 'revision'));
CREATE INDEX "fk_dbps_kec_review_by" ON "desa_bankeu_perubahan_surat" ("kecamatan_review_by");
CREATE INDEX "idx_dbps_desa" ON "desa_bankeu_perubahan_surat" ("desa_id");
CREATE INDEX "idx_dbps_submitted" ON "desa_bankeu_perubahan_surat" ("submitted_to_kecamatan");
CREATE INDEX "idx_dbps_tahun" ON "desa_bankeu_perubahan_surat" ("tahun");
CREATE UNIQUE INDEX "uniq_desa_tahun_perubahan" ON "desa_bankeu_perubahan_surat" ("desa_id", "tahun");
CREATE TABLE "event_attendance_settings" (
  "id" bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "event_code" citext NOT NULL,
  "event_name" citext NOT NULL,
  "event_date" date,
  "location" citext,
  "qr_payload" citext NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp(0) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp(0) DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
ALTER TABLE "event_attendance_settings" ADD CONSTRAINT "event_attendance_settings_event_code_len" CHECK (char_length("event_code") <= 80);
ALTER TABLE "event_attendance_settings" ADD CONSTRAINT "event_attendance_settings_event_name_len" CHECK (char_length("event_name") <= 180);
ALTER TABLE "event_attendance_settings" ADD CONSTRAINT "event_attendance_settings_location_len" CHECK (char_length("location") <= 180);
ALTER TABLE "event_attendance_settings" ADD CONSTRAINT "event_attendance_settings_qr_payload_len" CHECK (char_length("qr_payload") <= 255);
CREATE UNIQUE INDEX "event_code" ON "event_attendance_settings" ("event_code");
CREATE TABLE "event_attendances" (
  "id" bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "event_code" citext NOT NULL,
  "full_name" citext NOT NULL,
  "origin" citext NOT NULL,
  "category" citext NOT NULL,
  "custom_category" citext,
  "duplicate_hash" citext NOT NULL,
  "scan_payload" citext,
  "device_id" citext,
  "user_agent" citext,
  "ip_address" citext,
  "created_at" timestamp(0) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp(0) DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
ALTER TABLE "event_attendances" ADD CONSTRAINT "event_attendances_event_code_len" CHECK (char_length("event_code") <= 80);
ALTER TABLE "event_attendances" ADD CONSTRAINT "event_attendances_full_name_len" CHECK (char_length("full_name") <= 160);
ALTER TABLE "event_attendances" ADD CONSTRAINT "event_attendances_origin_len" CHECK (char_length("origin") <= 180);
ALTER TABLE "event_attendances" ADD CONSTRAINT "event_attendances_category_len" CHECK (char_length("category") <= 80);
ALTER TABLE "event_attendances" ADD CONSTRAINT "event_attendances_custom_category_len" CHECK (char_length("custom_category") <= 120);
ALTER TABLE "event_attendances" ADD CONSTRAINT "event_attendances_duplicate_hash_len" CHECK (char_length("duplicate_hash") <= 64);
ALTER TABLE "event_attendances" ADD CONSTRAINT "event_attendances_scan_payload_len" CHECK (char_length("scan_payload") <= 255);
ALTER TABLE "event_attendances" ADD CONSTRAINT "event_attendances_device_id_len" CHECK (char_length("device_id") <= 120);
ALTER TABLE "event_attendances" ADD CONSTRAINT "event_attendances_ip_address_len" CHECK (char_length("ip_address") <= 80);
CREATE INDEX "idx_event_category" ON "event_attendances" ("event_code", "category");
CREATE INDEX "idx_event_created" ON "event_attendances" ("event_code", "created_at");
CREATE UNIQUE INDEX "unique_event_visitor" ON "event_attendances" ("event_code", "duplicate_hash");
CREATE TABLE "gema_pertanyaan" (
  "id" bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "user_id" bigint,
  "sesi" citext,
  "teks" citext NOT NULL,
  "pola" citext NOT NULL,
  "ditenagai" citext NOT NULL,
  "panggilan" jsonb,
  "tanda" citext,
  "kalimat" citext,
  "total" integer NOT NULL DEFAULT 0,
  "durasi_ms" integer NOT NULL DEFAULT 0,
  "nilai" smallint NOT NULL DEFAULT 0,
  "dinilai_at" timestamp(0),
  "created_at" timestamp(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
ALTER TABLE "gema_pertanyaan" ADD CONSTRAINT "gema_pertanyaan_sesi_len" CHECK (char_length("sesi") <= 64);
ALTER TABLE "gema_pertanyaan" ADD CONSTRAINT "gema_pertanyaan_teks_len" CHECK (char_length("teks") <= 1000);
ALTER TABLE "gema_pertanyaan" ADD CONSTRAINT "gema_pertanyaan_pola_len" CHECK (char_length("pola") <= 1000);
ALTER TABLE "gema_pertanyaan" ADD CONSTRAINT "gema_pertanyaan_ditenagai_len" CHECK (char_length("ditenagai") <= 20);
ALTER TABLE "gema_pertanyaan" ADD CONSTRAINT "gema_pertanyaan_tanda_len" CHECK (char_length("tanda") <= 40);
CREATE INDEX "idx_gema_pertanyaan_created" ON "gema_pertanyaan" ("created_at");
CREATE INDEX "idx_gema_pertanyaan_tanda" ON "gema_pertanyaan" ("tanda");
CREATE INDEX "idx_gema_pertanyaan_user_created" ON "gema_pertanyaan" ("user_id", "created_at");
CREATE TABLE "hari_libur" (
  "id" integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "tanggal" date NOT NULL,
  "keterangan" citext NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by" integer,
  "created_at" timestamp(0) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp(0) DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
ALTER TABLE "hari_libur" ADD CONSTRAINT "hari_libur_keterangan_len" CHECK (char_length("keterangan") <= 255);
CREATE UNIQUE INDEX "uq_hari_libur_tanggal" ON "hari_libur" ("tanggal");
CREATE TABLE "helpdesk_categories" (
  "id" integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "name" citext NOT NULL,
  "slug" citext NOT NULL,
  "description" citext,
  "icon" citext NOT NULL DEFAULT 'tanya',
  "target_level" citext NOT NULL DEFAULT 'dpmd',
  "bidang_id" integer,
  "keywords" citext,
  "sort_order" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
ALTER TABLE "helpdesk_categories" ADD CONSTRAINT "helpdesk_categories_name_len" CHECK (char_length("name") <= 100);
ALTER TABLE "helpdesk_categories" ADD CONSTRAINT "helpdesk_categories_slug_len" CHECK (char_length("slug") <= 100);
ALTER TABLE "helpdesk_categories" ADD CONSTRAINT "helpdesk_categories_description_len" CHECK (char_length("description") <= 255);
ALTER TABLE "helpdesk_categories" ADD CONSTRAINT "helpdesk_categories_icon_len" CHECK (char_length("icon") <= 40);
ALTER TABLE "helpdesk_categories" ADD CONSTRAINT "helpdesk_categories_target_level_enum" CHECK ("target_level" IN ('kecamatan', 'bidang', 'dpmd'));
ALTER TABLE "helpdesk_categories" ADD CONSTRAINT "helpdesk_categories_keywords_len" CHECK (char_length("keywords") <= 500);
CREATE UNIQUE INDEX "uq_helpdesk_kat_slug" ON "helpdesk_categories" ("slug");
CREATE TABLE "helpdesk_chat_logs" (
  "id" integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "user_id" bigint,
  "category_id" integer,
  "question" citext NOT NULL,
  "answered" boolean NOT NULL DEFAULT false,
  "source" citext NOT NULL DEFAULT 'none',
  "faq_id" integer,
  "helpful" boolean,
  "reviewed" boolean NOT NULL DEFAULT false,
  "created_at" timestamp(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
ALTER TABLE "helpdesk_chat_logs" ADD CONSTRAINT "helpdesk_chat_logs_question_len" CHECK (char_length("question") <= 1000);
ALTER TABLE "helpdesk_chat_logs" ADD CONSTRAINT "helpdesk_chat_logs_source_enum" CHECK ("source" IN ('ai', 'faq', 'akun', 'data', 'none'));
CREATE INDEX "idx_helpdesk_log_review" ON "helpdesk_chat_logs" ("answered", "reviewed", "created_at");
CREATE TABLE "helpdesk_faqs" (
  "id" integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "category_id" integer NOT NULL,
  "question" citext NOT NULL,
  "answer" citext NOT NULL,
  "keywords" citext,
  "audience" citext NOT NULL DEFAULT 'semua',
  "action_label" citext,
  "action_url" citext,
  "hits" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  "updated_by" bigint,
  "created_at" timestamp(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
ALTER TABLE "helpdesk_faqs" ADD CONSTRAINT "helpdesk_faqs_question_len" CHECK (char_length("question") <= 500);
ALTER TABLE "helpdesk_faqs" ADD CONSTRAINT "helpdesk_faqs_keywords_len" CHECK (char_length("keywords") <= 500);
ALTER TABLE "helpdesk_faqs" ADD CONSTRAINT "helpdesk_faqs_audience_enum" CHECK ("audience" IN ('semua', 'publik', 'akun'));
ALTER TABLE "helpdesk_faqs" ADD CONSTRAINT "helpdesk_faqs_action_label_len" CHECK (char_length("action_label") <= 60);
ALTER TABLE "helpdesk_faqs" ADD CONSTRAINT "helpdesk_faqs_action_url_len" CHECK (char_length("action_url") <= 255);
CREATE INDEX "idx_helpdesk_faq_kat" ON "helpdesk_faqs" ("category_id", "is_active");
CREATE TABLE "helpdesk_messages" (
  "id" integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "ticket_id" integer NOT NULL,
  "sender_type" citext NOT NULL,
  "sender_id" bigint,
  "sender_name" citext,
  "body" citext NOT NULL,
  "created_at" timestamp(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
ALTER TABLE "helpdesk_messages" ADD CONSTRAINT "helpdesk_messages_sender_type_enum" CHECK ("sender_type" IN ('pelapor', 'petugas', 'bot', 'sistem'));
ALTER TABLE "helpdesk_messages" ADD CONSTRAINT "helpdesk_messages_sender_name_len" CHECK (char_length("sender_name") <= 150);
CREATE INDEX "idx_helpdesk_msg_ticket" ON "helpdesk_messages" ("ticket_id", "id");
CREATE TABLE "helpdesk_settings" (
  "setting_key" citext NOT NULL,
  "setting_value" citext,
  "updated_at" timestamp(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("setting_key")
);
ALTER TABLE "helpdesk_settings" ADD CONSTRAINT "helpdesk_settings_setting_key_len" CHECK (char_length("setting_key") <= 60);
CREATE TABLE "helpdesk_tickets" (
  "id" integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "code" citext NOT NULL,
  "category_id" integer,
  "target_level" citext NOT NULL,
  "bidang_id" integer,
  "kecamatan_id" integer,
  "desa_id" bigint,
  "user_id" bigint,
  "reporter_name" citext NOT NULL,
  "reporter_whatsapp" citext,
  "subject" citext NOT NULL,
  "status" citext NOT NULL DEFAULT 'baru',
  "priority" citext NOT NULL DEFAULT 'normal',
  "handled_by" bigint,
  "first_response_at" timestamp(0),
  "rating" smallint,
  "rating_note" citext,
  "last_message_at" timestamp(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reminded_at" timestamp(0),
  "created_at" timestamp(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
ALTER TABLE "helpdesk_tickets" ADD CONSTRAINT "helpdesk_tickets_code_len" CHECK (char_length("code") <= 20);
ALTER TABLE "helpdesk_tickets" ADD CONSTRAINT "helpdesk_tickets_target_level_enum" CHECK ("target_level" IN ('kecamatan', 'bidang', 'dpmd'));
ALTER TABLE "helpdesk_tickets" ADD CONSTRAINT "helpdesk_tickets_reporter_name_len" CHECK (char_length("reporter_name") <= 150);
ALTER TABLE "helpdesk_tickets" ADD CONSTRAINT "helpdesk_tickets_reporter_whatsapp_len" CHECK (char_length("reporter_whatsapp") <= 20);
ALTER TABLE "helpdesk_tickets" ADD CONSTRAINT "helpdesk_tickets_subject_len" CHECK (char_length("subject") <= 255);
ALTER TABLE "helpdesk_tickets" ADD CONSTRAINT "helpdesk_tickets_status_enum" CHECK ("status" IN ('baru', 'diproses', 'dijawab', 'selesai'));
ALTER TABLE "helpdesk_tickets" ADD CONSTRAINT "helpdesk_tickets_priority_enum" CHECK ("priority" IN ('normal', 'tinggi'));
ALTER TABLE "helpdesk_tickets" ADD CONSTRAINT "helpdesk_tickets_rating_note_len" CHECK (char_length("rating_note") <= 500);
CREATE INDEX "idx_helpdesk_ticket_tujuan" ON "helpdesk_tickets" ("target_level", "bidang_id", "kecamatan_id", "status");
CREATE INDEX "idx_helpdesk_ticket_user" ON "helpdesk_tickets" ("user_id");
CREATE UNIQUE INDEX "uq_helpdesk_ticket_code" ON "helpdesk_tickets" ("code");
CREATE TABLE "kecamatan_bankeu_tim_config" (
  "id" integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "kecamatan_id" integer NOT NULL,
  "posisi" citext NOT NULL,
  "nama" citext NOT NULL,
  "nip" citext,
  "jabatan" citext NOT NULL,
  "ttd_path" citext,
  "created_at" timestamp(0) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp(0) DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
ALTER TABLE "kecamatan_bankeu_tim_config" ADD CONSTRAINT "kecamatan_bankeu_tim_config_posisi_enum" CHECK ("posisi" IN ('ketua', 'sekretaris', 'anggota_1', 'anggota_2', 'anggota_3'));
ALTER TABLE "kecamatan_bankeu_tim_config" ADD CONSTRAINT "kecamatan_bankeu_tim_config_nama_len" CHECK (char_length("nama") <= 255);
ALTER TABLE "kecamatan_bankeu_tim_config" ADD CONSTRAINT "kecamatan_bankeu_tim_config_nip_len" CHECK (char_length("nip") <= 50);
ALTER TABLE "kecamatan_bankeu_tim_config" ADD CONSTRAINT "kecamatan_bankeu_tim_config_jabatan_len" CHECK (char_length("jabatan") <= 255);
ALTER TABLE "kecamatan_bankeu_tim_config" ADD CONSTRAINT "kecamatan_bankeu_tim_config_ttd_path_len" CHECK (char_length("ttd_path") <= 255);
CREATE INDEX "idx_kecamatan" ON "kecamatan_bankeu_tim_config" ("kecamatan_id");
CREATE UNIQUE INDEX "unique_kecamatan_posisi" ON "kecamatan_bankeu_tim_config" ("kecamatan_id", "posisi");
CREATE TABLE "rollback_20260509_generated_pengurus" (
  "id" citext NOT NULL,
  "desa_id" bigint NOT NULL,
  "pengurusable_id" citext NOT NULL,
  "pengurusable_type" citext NOT NULL,
  "jabatan" citext NOT NULL,
  "tanggal_mulai_jabatan" date,
  "tanggal_akhir_jabatan" date,
  "status_jabatan" citext DEFAULT 'aktif',
  "status_verifikasi" citext DEFAULT 'unverified',
  "imported" boolean NOT NULL DEFAULT false,
  "produk_hukum_id" citext,
  "nama_lengkap" citext NOT NULL,
  "nik" citext,
  "tempat_lahir" citext,
  "tanggal_lahir" date,
  "jenis_kelamin" citext,
  "status_perkawinan" citext,
  "alamat" citext,
  "no_telepon" citext,
  "nama_bank" citext,
  "nomor_rekening" citext,
  "nama_rekening" citext,
  "pendidikan" citext,
  "avatar" citext,
  "created_at" timestamp(0) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp(0) DEFAULT CURRENT_TIMESTAMP,
  "catatan_verifikasi" citext,
  "verified_at" timestamp(0),
  "verifikator_nama" citext,
  "agama" citext,
  "golongan_darah" citext,
  "nomor_buku_nikah" citext,
  PRIMARY KEY ("id")
);
ALTER TABLE "rollback_20260509_generated_pengurus" ADD CONSTRAINT "rollback_20260509_generated_pengurus_id_len" CHECK (char_length("id") <= 36);
ALTER TABLE "rollback_20260509_generated_pengurus" ADD CONSTRAINT "rollback_20260509_generated_pengurus_pengurusable_id_len" CHECK (char_length("pengurusable_id") <= 36);
ALTER TABLE "rollback_20260509_generated_pengurus" ADD CONSTRAINT "rollback_20260509_generated_pengurus_pengurusable_type_len" CHECK (char_length("pengurusable_type") <= 255);
ALTER TABLE "rollback_20260509_generated_pengurus" ADD CONSTRAINT "rollback_20260509_generated_pengurus_jabatan_len" CHECK (char_length("jabatan") <= 255);
ALTER TABLE "rollback_20260509_generated_pengurus" ADD CONSTRAINT "rollback_20260509_generated_pengurus_status_jabatan_enum" CHECK ("status_jabatan" IN ('aktif', 'selesai', 'nonaktif'));
ALTER TABLE "rollback_20260509_generated_pengurus" ADD CONSTRAINT "rollback_20260509_generated_pengurus_status_verifikasi_enum" CHECK ("status_verifikasi" IN ('verified', 'unverified', 'ditolak'));
ALTER TABLE "rollback_20260509_generated_pengurus" ADD CONSTRAINT "rollback_20260509_generated_pengurus_produk_hukum_id_len" CHECK (char_length("produk_hukum_id") <= 36);
ALTER TABLE "rollback_20260509_generated_pengurus" ADD CONSTRAINT "rollback_20260509_generated_pengurus_nama_lengkap_len" CHECK (char_length("nama_lengkap") <= 255);
ALTER TABLE "rollback_20260509_generated_pengurus" ADD CONSTRAINT "rollback_20260509_generated_pengurus_nik_len" CHECK (char_length("nik") <= 32);
ALTER TABLE "rollback_20260509_generated_pengurus" ADD CONSTRAINT "rollback_20260509_generated_pengurus_tempat_lahir_len" CHECK (char_length("tempat_lahir") <= 255);
ALTER TABLE "rollback_20260509_generated_pengurus" ADD CONSTRAINT "rollback_20260509_generated_pengurus_jenis_kelamin_enum" CHECK ("jenis_kelamin" IN ('Laki-laki', 'Perempuan'));
ALTER TABLE "rollback_20260509_generated_pengurus" ADD CONSTRAINT "rollback_20260509_generated_pengurus_status_perkawinan_len" CHECK (char_length("status_perkawinan") <= 255);
ALTER TABLE "rollback_20260509_generated_pengurus" ADD CONSTRAINT "rollback_20260509_generated_pengurus_no_telepon_len" CHECK (char_length("no_telepon") <= 32);
ALTER TABLE "rollback_20260509_generated_pengurus" ADD CONSTRAINT "rollback_20260509_generated_pengurus_nama_bank_len" CHECK (char_length("nama_bank") <= 100);
ALTER TABLE "rollback_20260509_generated_pengurus" ADD CONSTRAINT "rollback_20260509_generated_pengurus_nomor_rekening_len" CHECK (char_length("nomor_rekening") <= 100);
ALTER TABLE "rollback_20260509_generated_pengurus" ADD CONSTRAINT "rollback_20260509_generated_pengurus_nama_rekening_len" CHECK (char_length("nama_rekening") <= 255);
ALTER TABLE "rollback_20260509_generated_pengurus" ADD CONSTRAINT "rollback_20260509_generated_pengurus_pendidikan_len" CHECK (char_length("pendidikan") <= 255);
ALTER TABLE "rollback_20260509_generated_pengurus" ADD CONSTRAINT "rollback_20260509_generated_pengurus_avatar_len" CHECK (char_length("avatar") <= 255);
ALTER TABLE "rollback_20260509_generated_pengurus" ADD CONSTRAINT "rollback_20260509_generated_pengurus_verifikator_nama_len" CHECK (char_length("verifikator_nama") <= 255);
ALTER TABLE "rollback_20260509_generated_pengurus" ADD CONSTRAINT "rollback_20260509_generated_pengurus_agama_len" CHECK (char_length("agama") <= 50);
ALTER TABLE "rollback_20260509_generated_pengurus" ADD CONSTRAINT "rollback_20260509_generated_pengurus_golongan_darah_len" CHECK (char_length("golongan_darah") <= 5);
ALTER TABLE "rollback_20260509_generated_pengurus" ADD CONSTRAINT "rollback_20260509_generated_pengurus_nomor_buku_nikah_len" CHECK (char_length("nomor_buku_nikah") <= 100);
CREATE INDEX "rollback_20260509_generated_pengurus_idx_pengurusable" ON "rollback_20260509_generated_pengurus" ("pengurusable_type", "pengurusable_id");
CREATE INDEX "rollback_20260509_generated_pengurus_idx_status_jabatan" ON "rollback_20260509_generated_pengurus" ("status_jabatan");
CREATE INDEX "rollback_20260509_generated_pengurus_pengurus_desa_id_foreign" ON "rollback_20260509_generated_pengurus" ("desa_id");
CREATE INDEX "rollback_20260509_generated_pengurus_pengurus_imported_index" ON "rollback_20260509_generated_pengurus" ("imported");
CREATE TABLE "rollback_20260509_generated_rts" (
  "id" citext NOT NULL,
  "rw_id" citext NOT NULL,
  "desa_id" bigint NOT NULL,
  "nomor" citext NOT NULL,
  "alamat" citext,
  "status_kelembagaan" citext DEFAULT 'aktif',
  "status_verifikasi" citext DEFAULT 'unverified',
  "imported" boolean NOT NULL DEFAULT false,
  "created_at" timestamp(0) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp(0) DEFAULT CURRENT_TIMESTAMP,
  "produk_hukum_id" citext,
  "catatan_verifikasi" citext,
  "jumlah_jiwa" integer,
  "jumlah_kk" integer,
  "nonaktif_at" timestamp(0),
  "produk_hukum_penonaktifan_id" citext,
  "verified_at" timestamp(0),
  "verifikator_nama" citext,
  PRIMARY KEY ("id")
);
ALTER TABLE "rollback_20260509_generated_rts" ADD CONSTRAINT "rollback_20260509_generated_rts_id_len" CHECK (char_length("id") <= 36);
ALTER TABLE "rollback_20260509_generated_rts" ADD CONSTRAINT "rollback_20260509_generated_rts_rw_id_len" CHECK (char_length("rw_id") <= 36);
ALTER TABLE "rollback_20260509_generated_rts" ADD CONSTRAINT "rollback_20260509_generated_rts_nomor_len" CHECK (char_length("nomor") <= 255);
ALTER TABLE "rollback_20260509_generated_rts" ADD CONSTRAINT "rollback_20260509_generated_rts_alamat_len" CHECK (char_length("alamat") <= 255);
ALTER TABLE "rollback_20260509_generated_rts" ADD CONSTRAINT "rollback_20260509_generated_rts_status_kelembagaan_enum" CHECK ("status_kelembagaan" IN ('aktif', 'nonaktif'));
ALTER TABLE "rollback_20260509_generated_rts" ADD CONSTRAINT "rollback_20260509_generated_rts_status_verifikasi_enum" CHECK ("status_verifikasi" IN ('verified', 'unverified', 'ditolak'));
ALTER TABLE "rollback_20260509_generated_rts" ADD CONSTRAINT "rollback_20260509_generated_rts_produk_hukum_id_len" CHECK (char_length("produk_hukum_id") <= 36);
ALTER TABLE "rollback_20260509_generated_rts" ADD CONSTRAINT "rollback_20260509_generated_rts_produk_hukum_penonakti_1d7f2a98" CHECK (char_length("produk_hukum_penonaktifan_id") <= 36);
ALTER TABLE "rollback_20260509_generated_rts" ADD CONSTRAINT "rollback_20260509_generated_rts_verifikator_nama_len" CHECK (char_length("verifikator_nama") <= 255);
CREATE INDEX "rollback_20260509_generated_rts_rts_desa_id_foreign" ON "rollback_20260509_generated_rts" ("desa_id");
CREATE INDEX "rollback_20260509_generated_rts_rts_imported_index" ON "rollback_20260509_generated_rts" ("imported");
CREATE INDEX "rollback_20260509_generated_rts_rts_produk_hukum_id_foreign" ON "rollback_20260509_generated_rts" ("produk_hukum_id");
CREATE UNIQUE INDEX "rollback_20260509_generated_rts_unique_rw_nomor" ON "rollback_20260509_generated_rts" ("rw_id", "nomor");
CREATE TABLE "rollback_20260509_generated_rws" (
  "id" citext NOT NULL,
  "desa_id" bigint NOT NULL,
  "nomor" citext NOT NULL,
  "alamat" citext,
  "status_kelembagaan" citext NOT NULL DEFAULT 'aktif',
  "status_verifikasi" citext NOT NULL DEFAULT 'unverified',
  "imported" boolean NOT NULL DEFAULT false,
  "created_at" timestamp(0),
  "updated_at" timestamp(0),
  "produk_hukum_id" citext,
  "catatan_verifikasi" citext,
  "nonaktif_at" timestamp(0),
  "produk_hukum_penonaktifan_id" citext,
  "verified_at" timestamp(0),
  "verifikator_nama" citext,
  PRIMARY KEY ("id")
);
ALTER TABLE "rollback_20260509_generated_rws" ADD CONSTRAINT "rollback_20260509_generated_rws_id_len" CHECK (char_length("id") <= 36);
ALTER TABLE "rollback_20260509_generated_rws" ADD CONSTRAINT "rollback_20260509_generated_rws_nomor_len" CHECK (char_length("nomor") <= 255);
ALTER TABLE "rollback_20260509_generated_rws" ADD CONSTRAINT "rollback_20260509_generated_rws_alamat_len" CHECK (char_length("alamat") <= 255);
ALTER TABLE "rollback_20260509_generated_rws" ADD CONSTRAINT "rollback_20260509_generated_rws_status_kelembagaan_enum" CHECK ("status_kelembagaan" IN ('aktif', 'nonaktif'));
ALTER TABLE "rollback_20260509_generated_rws" ADD CONSTRAINT "rollback_20260509_generated_rws_status_verifikasi_enum" CHECK ("status_verifikasi" IN ('verified', 'unverified', 'ditolak'));
ALTER TABLE "rollback_20260509_generated_rws" ADD CONSTRAINT "rollback_20260509_generated_rws_produk_hukum_id_len" CHECK (char_length("produk_hukum_id") <= 36);
ALTER TABLE "rollback_20260509_generated_rws" ADD CONSTRAINT "rollback_20260509_generated_rws_produk_hukum_penonakti_d010924b" CHECK (char_length("produk_hukum_penonaktifan_id") <= 36);
ALTER TABLE "rollback_20260509_generated_rws" ADD CONSTRAINT "rollback_20260509_generated_rws_verifikator_nama_len" CHECK (char_length("verifikator_nama") <= 255);
CREATE UNIQUE INDEX "rollback_20260509_generated_rws_rws_desa_id_nomor_unique" ON "rollback_20260509_generated_rws" ("desa_id", "nomor");
CREATE INDEX "rollback_20260509_generated_rws_rws_imported_index" ON "rollback_20260509_generated_rws" ("imported");
CREATE INDEX "rollback_20260509_generated_rws_rws_produk_hukum_id_foreign" ON "rollback_20260509_generated_rws" ("produk_hukum_id");
CREATE TABLE "rollback_20260509_generated_summary" (
  "table_name" citext NOT NULL,
  "candidate_ids" integer NOT NULL DEFAULT 0,
  "safe_rows" integer NOT NULL DEFAULT 0,
  "backup_rows" integer NOT NULL DEFAULT 0,
  "deleted_rows" integer NOT NULL DEFAULT 0,
  "ran_at" timestamp(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("table_name")
);
ALTER TABLE "rollback_20260509_generated_summary" ADD CONSTRAINT "rollback_20260509_generated_summary_table_name_len" CHECK (char_length("table_name") <= 64);
CREATE TABLE "server_ip_blocklist" (
  "id" integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "ip_address" citext NOT NULL,
  "reason" citext,
  "auto" boolean NOT NULL DEFAULT false,
  "hits" integer NOT NULL DEFAULT 0,
  "expires_at" timestamp(0),
  "created_by" citext,
  "created_at" timestamp(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
ALTER TABLE "server_ip_blocklist" ADD CONSTRAINT "server_ip_blocklist_ip_address_len" CHECK (char_length("ip_address") <= 45);
ALTER TABLE "server_ip_blocklist" ADD CONSTRAINT "server_ip_blocklist_reason_len" CHECK (char_length("reason") <= 500);
ALTER TABLE "server_ip_blocklist" ADD CONSTRAINT "server_ip_blocklist_created_by_len" CHECK (char_length("created_by") <= 191);
CREATE UNIQUE INDEX "uq_sib_ip" ON "server_ip_blocklist" ("ip_address");
CREATE TABLE "server_ip_geo" (
  "ip_address" citext NOT NULL,
  "country_code" citext,
  "country" citext,
  "region" citext,
  "city" citext,
  "lat" decimal(8,4),
  "lon" decimal(8,4),
  "isp" citext,
  "org" citext,
  "asn" citext,
  "proxy" boolean NOT NULL DEFAULT false,
  "hosting" boolean NOT NULL DEFAULT false,
  "updated_at" timestamp(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("ip_address")
);
ALTER TABLE "server_ip_geo" ADD CONSTRAINT "server_ip_geo_ip_address_len" CHECK (char_length("ip_address") <= 45);
ALTER TABLE "server_ip_geo" ADD CONSTRAINT "server_ip_geo_country_code_len" CHECK (char_length("country_code") <= 2);
ALTER TABLE "server_ip_geo" ADD CONSTRAINT "server_ip_geo_country_len" CHECK (char_length("country") <= 80);
ALTER TABLE "server_ip_geo" ADD CONSTRAINT "server_ip_geo_region_len" CHECK (char_length("region") <= 120);
ALTER TABLE "server_ip_geo" ADD CONSTRAINT "server_ip_geo_city_len" CHECK (char_length("city") <= 120);
ALTER TABLE "server_ip_geo" ADD CONSTRAINT "server_ip_geo_isp_len" CHECK (char_length("isp") <= 200);
ALTER TABLE "server_ip_geo" ADD CONSTRAINT "server_ip_geo_org_len" CHECK (char_length("org") <= 200);
ALTER TABLE "server_ip_geo" ADD CONSTRAINT "server_ip_geo_asn_len" CHECK (char_length("asn") <= 200);
CREATE INDEX "idx_sig_cc" ON "server_ip_geo" ("country_code");
CREATE TABLE "server_metric_snapshots" (
  "id" bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "cpu" decimal(5,2),
  "memory" decimal(5,2),
  "disk" decimal(5,2),
  "load1" decimal(8,2),
  "process_mb" integer,
  "requests" integer,
  "errors" integer,
  "avg_ms" integer,
  "net_rx" bigint,
  "net_tx" bigint,
  "attacks" integer,
  "online" integer,
  "created_at" timestamp(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE INDEX "idx_sms_created" ON "server_metric_snapshots" ("created_at");
CREATE TABLE "server_security_events" (
  "id" bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "ip_address" citext NOT NULL,
  "event_type" citext NOT NULL,
  "severity" citext NOT NULL DEFAULT 'low',
  "source" citext NOT NULL DEFAULT 'app',
  "method" citext,
  "path" citext,
  "user_agent" citext,
  "user_id" bigint,
  "detail" citext,
  "blocked" boolean NOT NULL DEFAULT false,
  "created_at" timestamp(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
ALTER TABLE "server_security_events" ADD CONSTRAINT "server_security_events_ip_address_len" CHECK (char_length("ip_address") <= 45);
ALTER TABLE "server_security_events" ADD CONSTRAINT "server_security_events_event_type_len" CHECK (char_length("event_type") <= 40);
ALTER TABLE "server_security_events" ADD CONSTRAINT "server_security_events_severity_len" CHECK (char_length("severity") <= 10);
ALTER TABLE "server_security_events" ADD CONSTRAINT "server_security_events_source_len" CHECK (char_length("source") <= 20);
ALTER TABLE "server_security_events" ADD CONSTRAINT "server_security_events_method_len" CHECK (char_length("method") <= 10);
ALTER TABLE "server_security_events" ADD CONSTRAINT "server_security_events_path_len" CHECK (char_length("path") <= 500);
ALTER TABLE "server_security_events" ADD CONSTRAINT "server_security_events_user_agent_len" CHECK (char_length("user_agent") <= 500);
ALTER TABLE "server_security_events" ADD CONSTRAINT "server_security_events_detail_len" CHECK (char_length("detail") <= 1000);
CREATE INDEX "idx_sse_created" ON "server_security_events" ("created_at");
CREATE INDEX "idx_sse_ip" ON "server_security_events" ("ip_address");
CREATE INDEX "idx_sse_type" ON "server_security_events" ("event_type");
-- FK dilewati pada tabel di luar Prisma: bankeu_surat_templates.fk_surat_template_user, bankeu_verification_questionnaire.bankeu_verification_questionnaire_ibfk_1, desa_bankeu_perubahan_surat.fk_dbps_desa, desa_bankeu_perubahan_surat.fk_dbps_kec_review_by

-- (f) trigger pengganti ON UPDATE CURRENT_TIMESTAMP (menurut EXTRA MySQL lokal)
CREATE TRIGGER "trg_absensi_lokasi_khusus_updated_at" BEFORE UPDATE ON "absensi_lokasi_khusus" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_anggaran_bidang_units_updated_at" BEFORE UPDATE ON "anggaran_bidang_units" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_anggaran_kas_updated_at" BEFORE UPDATE ON "anggaran_kas" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_anggaran_master_kegiatan_updated_at" BEFORE UPDATE ON "anggaran_master_kegiatan" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_anggaran_pagu_updated_at" BEFORE UPDATE ON "anggaran_pagu" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_anggaran_rka_items_updated_at" BEFORE UPDATE ON "anggaran_rka_items" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_aparatur_dapur_desa_updated_at" BEFORE UPDATE ON "aparatur_dapur_desa" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_arsip_barang_updated_at" BEFORE UPDATE ON "arsip_barang" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_arsip_barang_kategori_updated_at" BEFORE UPDATE ON "arsip_barang_kategori" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_bankeu_lpj_video_updated_at" BEFORE UPDATE ON "bankeu_lpj_video" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_bankeu_proposal_2025_updated_at" BEFORE UPDATE ON "bankeu_proposal_2025" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_bankeu_proposal_kegiatan_updated_at" BEFORE UPDATE ON "bankeu_proposal_kegiatan" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_bankeu_surat_templates_updated_at" BEFORE UPDATE ON "bankeu_surat_templates" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_bankeu_verification_questionnaire_updated_at" BEFORE UPDATE ON "bankeu_verification_questionnaire" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_bantuan_provinsi_lpj_updated_at" BEFORE UPDATE ON "bantuan_provinsi_lpj" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_berita_updated_at" BEFORE UPDATE ON "berita" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_catatan_pribadi_updated_at" BEFORE UPDATE ON "catatan_pribadi" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_desa_bankeu_surat_updated_at" BEFORE UPDATE ON "desa_bankeu_surat" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_dinas_config_updated_at" BEFORE UPDATE ON "dinas_config" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_drive_file_updated_at" BEFORE UPDATE ON "drive_file" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_drive_folder_updated_at" BEFORE UPDATE ON "drive_folder" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_drive_kuota_updated_at" BEFORE UPDATE ON "drive_kuota" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_event_attendance_settings_updated_at" BEFORE UPDATE ON "event_attendance_settings" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_event_attendances_updated_at" BEFORE UPDATE ON "event_attendances" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_formulir_updated_at" BEFORE UPDATE ON "formulir" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_formulir_pertanyaan_updated_at" BEFORE UPDATE ON "formulir_pertanyaan" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_hari_libur_updated_at" BEFORE UPDATE ON "hari_libur" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_helpdesk_categories_updated_at" BEFORE UPDATE ON "helpdesk_categories" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_helpdesk_faqs_updated_at" BEFORE UPDATE ON "helpdesk_faqs" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_helpdesk_settings_updated_at" BEFORE UPDATE ON "helpdesk_settings" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_helpdesk_tickets_updated_at" BEFORE UPDATE ON "helpdesk_tickets" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_jadwal_kegiatan_updated_at" BEFORE UPDATE ON "jadwal_kegiatan" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_karang_tarunas_updated_at" BEFORE UPDATE ON "karang_tarunas" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_kecamatan_bankeu_config_updated_at" BEFORE UPDATE ON "kecamatan_bankeu_config" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_kecamatan_bankeu_tim_config_updated_at" BEFORE UPDATE ON "kecamatan_bankeu_tim_config" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_lpms_updated_at" BEFORE UPDATE ON "lpms" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_pencairan_updated_at" BEFORE UPDATE ON "pencairan" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_pencairan_items_updated_at" BEFORE UPDATE ON "pencairan_items" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_pencairan_sk_ref_updated_at" BEFORE UPDATE ON "pencairan_sk_ref" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_pengurus_updated_at" BEFORE UPDATE ON "pengurus" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_penyedia_updated_at" BEFORE UPDATE ON "penyedia" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_pkks_updated_at" BEFORE UPDATE ON "pkks" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_posyandus_updated_at" BEFORE UPDATE ON "posyandus" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_produk_hukum_bidang_updated_at" BEFORE UPDATE ON "produk_hukum_bidang" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_produk_hukum_referensi_updated_at" BEFORE UPDATE ON "produk_hukum_referensi" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_push_subscriptions_updated_at" BEFORE UPDATE ON "push_subscriptions" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_rekening_ref_updated_at" BEFORE UPDATE ON "rekening_ref" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_rollback_20260509_generated_pengurus_updated_at" BEFORE UPDATE ON "rollback_20260509_generated_pengurus" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_rollback_20260509_generated_rts_updated_at" BEFORE UPDATE ON "rollback_20260509_generated_rts" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_rollback_20260509_generated_summary_ran_at" BEFORE UPDATE ON "rollback_20260509_generated_summary" FOR EACH ROW EXECUTE FUNCTION set_ran_at();
CREATE TRIGGER "trg_rts_updated_at" BEFORE UPDATE ON "rts" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_tugas_pribadi_updated_at" BEFORE UPDATE ON "tugas_pribadi" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_user_totp_updated_at" BEFORE UPDATE ON "user_totp" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_video_desa_permintaan_updated_at" BEFORE UPDATE ON "video_desa_permintaan" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "trg_video_desa_tautan_updated_at" BEFORE UPDATE ON "video_desa_tautan" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- (g) KOLOM YATIM: ada di MySQL tetapi tidak ada di model Prisma (agar tidak ada data hilang)
ALTER TABLE "bankeu_perubahan_proposal_versions" ALTER COLUMN "created_at" SET NOT NULL;
ALTER TABLE "bankeu_perubahan_revisions" ALTER COLUMN "created_at" SET NOT NULL;
ALTER TABLE "bankeu_proposal_kegiatan" ADD COLUMN "nama_kegiatan_spesifik" citext;
ALTER TABLE "bankeu_proposal_kegiatan" ADD CONSTRAINT "bankeu_proposal_kegiatan_nama_kegiatan_spesifik_len" CHECK (char_length("nama_kegiatan_spesifik") <= 500);
ALTER TABLE "bankeu_proposal_kegiatan" ADD COLUMN "volume" citext;
ALTER TABLE "bankeu_proposal_kegiatan" ADD CONSTRAINT "bankeu_proposal_kegiatan_volume_len" CHECK (char_length("volume") <= 255);
ALTER TABLE "bankeu_proposal_kegiatan" ADD COLUMN "lokasi" citext;
ALTER TABLE "bankeu_proposal_kegiatan" ADD CONSTRAINT "bankeu_proposal_kegiatan_lokasi_len" CHECK (char_length("lokasi") <= 500);
ALTER TABLE "bankeu_proposal_kegiatan" ADD COLUMN "anggaran_usulan" decimal(15,2);
ALTER TABLE "bankeu_proposal_kegiatan" ADD COLUMN "updated_at" timestamp(0) DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "user_totp" ADD COLUMN "kode_cadangan" citext;
ALTER TABLE "video_meeting_participants" ALTER COLUMN "hand_raised" SET NOT NULL;
ALTER TABLE "video_meeting_participants" ALTER COLUMN "on_stage" SET NOT NULL;
