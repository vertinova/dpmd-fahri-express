-- Presensi perangkat desa: akun login NIPD memakai mesin absensi pegawai,
-- terpisah lewat role 'perangkat_desa' dan kunci pengaturan berawalan.
-- Idempoten: aman dijalankan berulang.

-- 1. Akun diikat ke aparatur_desa.id (bukan angka NIPD yang bisa berubah).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "aparatur_desa_id" CITEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "users_aparatur_desa_id_unique" ON "users"("aparatur_desa_id");

DO $$
BEGIN
  ALTER TABLE "users"
    ADD CONSTRAINT "users_aparatur_desa_id_foreign"
    FOREIGN KEY ("aparatur_desa_id") REFERENCES "aparatur_desa"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Login mencari NIPD terkini.
CREATE INDEX IF NOT EXISTS "aparatur_desa_nipd_index" ON "aparatur_desa"("nipd");

-- 3. Role baru; warna/kategori/needs_entity meniru admin_desa bila ada.
INSERT INTO "roles" ("name", "label", "color", "description", "category", "is_system", "needs_entity", "created_at", "updated_at")
SELECT 'perangkat_desa', 'Perangkat Desa',
       COALESCE(r."color", 'gray'),
       'Akun presensi perangkat desa (login dengan NIPD)',
       COALESCE(r."category", 'other'),
       true,
       COALESCE(r."needs_entity", true),
       now(), now()
FROM (SELECT 1) AS x
LEFT JOIN "roles" r ON r."name" = 'admin_desa'
WHERE NOT EXISTS (SELECT 1 FROM "roles" WHERE "name" = 'perangkat_desa');

-- 4. Pengaturan absensi perangkat desa: salinan nilai pegawai saat ini.
INSERT INTO "absensi_settings" ("key", "value", "description", "created_at", "updated_at")
SELECT 'perangkat_desa.' || s."key", s."value", s."description", now(), now()
FROM "absensi_settings" s
WHERE s."key" IN ('jam_masuk', 'jam_pulang', 'toleransi_terlambat', 'jam_buka_absen', 'jam_tutup_absen')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "absensi_settings" ("key", "value", "description", "created_at", "updated_at")
VALUES ('perangkat_desa.radius_meter', '200', 'Radius absen perangkat desa dari kantor desa (meter)', now(), now())
ON CONFLICT ("key") DO NOTHING;

-- 5. Pesan sukses & template pengingat berawalan pd_ (gambar tidak disalin:
--    mengganti gambar menghapus berkasnya, jangan sampai merusak milik pegawai).
INSERT INTO "absensi_success_messages" ("type", "title", "message", "image_path", "is_active", "created_at", "updated_at")
SELECT 'pd_' || m."type", m."title", m."message", NULL, m."is_active", now(), now()
FROM "absensi_success_messages" m
WHERE m."type" NOT LIKE 'pd\_%' AND char_length(m."type") <= 47
ON CONFLICT ("type") DO NOTHING;

INSERT INTO "absensi_reminder_templates" ("type", "title", "message", "is_active", "created_at", "updated_at")
SELECT 'pd_' || t."type", t."title", t."message", t."is_active", now(), now()
FROM "absensi_reminder_templates" t
WHERE t."type" NOT LIKE 'pd\_%' AND char_length(t."type") <= 47
ON CONFLICT ("type") DO NOTHING;
