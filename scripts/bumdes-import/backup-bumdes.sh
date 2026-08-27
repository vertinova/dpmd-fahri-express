#!/usr/bin/env bash
# Backup tabel `bumdes` sebelum impor CSV.
#
# Menghasilkan 4 berkas di /root/backup-bumdes/<stempel>/ :
#   bumdes_struktur_data.sql.gz  -> DROP+CREATE+INSERT, dipakai untuk rollback
#   bumdes_data_saja.sql.gz      -> INSERT saja, tanpa DROP (untuk tambal sebagian)
#   bumdes_snapshot.csv          -> versi yang bisa dibaca manusia / dibuka di Excel
#   dokumen_terpakai.txt         -> daftar path file dokumen yang sedang dirujuk baris bumdes
#
# Kredensial dibaca dari .env backend, tidak ditulis di sini.
set -euo pipefail

ENV_FILE="${ENV_FILE:-/var/www/backend/.env}"
DEST_ROOT="${DEST_ROOT:-/root/backup-bumdes}"

[ -r "$ENV_FILE" ] || { echo "Tidak bisa membaca $ENV_FILE"; exit 1; }

ambil() { grep -E "^\s*$1\s*=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'"'"' ' ; }

DB_URL="$(ambil DATABASE_URL || true)"
if [ -n "$DB_URL" ]; then
  # mysql://user:pass@host:port/nama?opsi
  CRED="${DB_URL#mysql://}"; CRED="${CRED%%\?*}"
  DB_USER="${CRED%%:*}"
  REST="${CRED#*:}"
  DB_PASS="${REST%%@*}"
  REST="${REST#*@}"
  DB_HOST="${REST%%:*}"
  REST="${REST#*:}"
  DB_PORT="${REST%%/*}"
  DB_NAME="${REST#*/}"
else
  DB_HOST="$(ambil DB_HOST)"; DB_PORT="$(ambil DB_PORT)"
  DB_USER="$(ambil DB_USER)"; DB_PASS="$(ambil DB_PASSWORD)"
  DB_NAME="$(ambil DB_NAME)"
fi
DB_PORT="${DB_PORT:-3306}"

STAMP="$(date +%Y%m%d_%H%M%S)"
DEST="$DEST_ROOT/$STAMP"
mkdir -p "$DEST"
chmod 700 "$DEST_ROOT"

export MYSQL_PWD="$DB_PASS"
MYSQL_ARGS=(-h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME")

echo "== Database : $DB_NAME @ $DB_HOST:$DB_PORT"
echo "== Tujuan   : $DEST"

JUM="$(mysql "${MYSQL_ARGS[@]}" -N -B -e 'SELECT COUNT(*) FROM bumdes;')"
echo "== Baris bumdes sekarang: $JUM"

echo "-- struktur + data"
mysqldump "${MYSQL_ARGS[@]}" --single-transaction --add-drop-table bumdes \
  | gzip > "$DEST/bumdes_struktur_data.sql.gz"

echo "-- data saja"
mysqldump "${MYSQL_ARGS[@]}" --single-transaction --no-create-info --skip-add-drop-table bumdes \
  | gzip > "$DEST/bumdes_data_saja.sql.gz"

echo "-- snapshot CSV"
mysql "${MYSQL_ARGS[@]}" -B -e 'SELECT * FROM bumdes ORDER BY id;' > "$DEST/bumdes_snapshot.csv"

echo "-- daftar dokumen yang dirujuk"
mysql "${MYSQL_ARGS[@]}" -N -B -e "
  SELECT CONCAT(id, ' | ', COALESCE(kode_desa,''), ' | ', kolom, ' | ', berkas) FROM (
    SELECT id, kode_desa, 'LaporanKeuangan2021' AS kolom, LaporanKeuangan2021 AS berkas FROM bumdes WHERE LaporanKeuangan2021 <> ''
    UNION ALL SELECT id, kode_desa, 'LaporanKeuangan2022', LaporanKeuangan2022 FROM bumdes WHERE LaporanKeuangan2022 <> ''
    UNION ALL SELECT id, kode_desa, 'LaporanKeuangan2023', LaporanKeuangan2023 FROM bumdes WHERE LaporanKeuangan2023 <> ''
    UNION ALL SELECT id, kode_desa, 'LaporanKeuangan2024', LaporanKeuangan2024 FROM bumdes WHERE LaporanKeuangan2024 <> ''
    UNION ALL SELECT id, kode_desa, 'Perdes', Perdes FROM bumdes WHERE Perdes <> ''
    UNION ALL SELECT id, kode_desa, 'ProfilBUMDesa', ProfilBUMDesa FROM bumdes WHERE ProfilBUMDesa <> ''
    UNION ALL SELECT id, kode_desa, 'BeritaAcara', BeritaAcara FROM bumdes WHERE BeritaAcara <> ''
    UNION ALL SELECT id, kode_desa, 'AnggaranDasar', AnggaranDasar FROM bumdes WHERE AnggaranDasar <> ''
    UNION ALL SELECT id, kode_desa, 'AnggaranRumahTangga', AnggaranRumahTangga FROM bumdes WHERE AnggaranRumahTangga <> ''
    UNION ALL SELECT id, kode_desa, 'ProgramKerja', ProgramKerja FROM bumdes WHERE ProgramKerja <> ''
    UNION ALL SELECT id, kode_desa, 'SK_BUM_Desa', SK_BUM_Desa FROM bumdes WHERE SK_BUM_Desa <> ''
  ) x ORDER BY id;" > "$DEST/dokumen_terpakai.txt"

unset MYSQL_PWD
chmod 600 "$DEST"/*
echo
echo "SELESAI. Isi backup:"
ls -lh "$DEST"
echo
echo "Baris ter-backup : $JUM"
echo "Dokumen dirujuk  : $(wc -l < "$DEST/dokumen_terpakai.txt")"
echo
echo "Untuk rollback:"
echo "  bash $(dirname "$0")/rollback-bumdes.sh $DEST/bumdes_struktur_data.sql.gz"
