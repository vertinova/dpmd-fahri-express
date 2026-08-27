#!/usr/bin/env bash
# Kembalikan tabel `bumdes` ke isi backup.
#
#   bash rollback-bumdes.sh /root/backup-bumdes/<stempel>/bumdes_struktur_data.sql.gz
#
# Berkas itu memuat DROP TABLE + CREATE TABLE + INSERT, jadi kolom baru hasil
# ALTER ikut hilang dan tabel kembali persis seperti sebelum impor.
set -euo pipefail

BERKAS="${1:-}"
[ -n "$BERKAS" ] || { echo "Pemakaian: bash rollback-bumdes.sh <file .sql.gz>"; exit 1; }
[ -r "$BERKAS" ] || { echo "Tidak bisa membaca $BERKAS"; exit 1; }

ENV_FILE="${ENV_FILE:-/var/www/backend/.env}"
ambil() { grep -E "^\s*$1\s*=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'"'"' ' ; }

DB_URL="$(ambil DATABASE_URL || true)"
if [ -n "$DB_URL" ]; then
  CRED="${DB_URL#mysql://}"; CRED="${CRED%%\?*}"
  DB_USER="${CRED%%:*}"; REST="${CRED#*:}"
  DB_PASS="${REST%%@*}"; REST="${REST#*@}"
  DB_HOST="${REST%%:*}"; REST="${REST#*:}"
  DB_PORT="${REST%%/*}"; DB_NAME="${REST#*/}"
else
  DB_HOST="$(ambil DB_HOST)"; DB_PORT="$(ambil DB_PORT)"
  DB_USER="$(ambil DB_USER)"; DB_PASS="$(ambil DB_PASSWORD)"; DB_NAME="$(ambil DB_NAME)"
fi
DB_PORT="${DB_PORT:-3306}"

export MYSQL_PWD="$DB_PASS"
SEBELUM="$(mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME" -N -B -e 'SELECT COUNT(*) FROM bumdes;')"

echo "Database    : $DB_NAME"
echo "Baris kini  : $SEBELUM"
echo "Akan diganti isi dari: $BERKAS"
read -r -p "Ketik ROLLBACK untuk melanjutkan: " JAWAB
[ "$JAWAB" = "ROLLBACK" ] || { echo "Dibatalkan."; exit 1; }

gunzip -c "$BERKAS" | mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME"

SESUDAH="$(mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME" -N -B -e 'SELECT COUNT(*) FROM bumdes;')"
unset MYSQL_PWD

echo "Selesai. Baris sekarang: $SESUDAH (sebelumnya $SEBELUM)"
echo "Muat ulang backend bila perlu:  pm2 restart dpmd-backend"
