#!/bin/bash
# Pasang layanan deteksi Smart CCTV (cctv-ai) di CT 100. Aman diulang.
#
#   Dari laptop (PowerShell):
#     ssh root@192.168.101.74 "pct exec 100 -- bash /var/www/backend/cctv-ai/pasang.sh"
#
# Yang dilakukan:
#   1. Membuat CCTV_SERVICE_API_KEY & CCTV_INTERNAL_TOKEN di .env backend bila
#      belum ada (acak 64 heksa), lalu me-restart backend agar memuatnya.
#   2. npm install dependensi layanan (model Human ikut di paket npm; model
#      YOLOX-s diunduh sendiri oleh layanan ke cctv-ai/models/ saat berjalan).
#   3. Memasang & menyalakan systemd dpmd-cctv-ai (127.0.0.1:8001, prioritas
#      CPU rendah supaya aplikasi utama tetap didahulukan).
# Pembaruan berikutnya ikut deploy otomatis (lihat webhook-handler.js).
set -euo pipefail

BACKEND=/var/www/backend
LAYANAN="$BACKEND/cctv-ai"
NODE_BIN=/root/.local/share/fnm/node-versions/v24.22.1/installation/bin
ENVF="$BACKEND/.env"

[ -f "$LAYANAN/src/index.js" ] || { echo "❌ $LAYANAN belum ada — deploy backend dulu."; exit 1; }

echo "▸ 1. Kunci layanan di .env backend"
kunci_baru=0
for k in CCTV_SERVICE_API_KEY CCTV_INTERNAL_TOKEN; do
  if grep -qE "^${k}=.{32,}" "$ENVF"; then
    echo "  $k sudah ada"
  else
    sed -i "/^${k}=/d" "$ENVF"
    echo "${k}=$(openssl rand -hex 32)" >> "$ENVF"
    echo "  $k dibuat"
    kunci_baru=1
  fi
done
grep -qE '^GO2RTC_URL=' "$ENVF" || echo 'GO2RTC_URL=http://127.0.0.1:1984' >> "$ENVF"
grep -qE '^PYTHON_AI_URL=' "$ENVF" || echo 'PYTHON_AI_URL=http://127.0.0.1:8001' >> "$ENVF"
if [ "$kunci_baru" = 1 ]; then
  echo "  restart backend agar kunci termuat"
  PATH="$NODE_BIN:$PATH" "$NODE_BIN/pm2" restart dpmd-backend --update-env >/dev/null
fi

echo "▸ 2. Dependensi layanan"
cd "$LAYANAN"
ONNXRUNTIME_NODE_INSTALL=skip PATH="$NODE_BIN:$PATH" "$NODE_BIN/npm" install --omit=dev --no-audit --no-fund 2>&1 | tail -2

echo "▸ 3. Layanan systemd"
cat > /etc/systemd/system/dpmd-cctv-ai.service <<UNIT
[Unit]
Description=DPMD Smart CCTV - deteksi wajah & jatuh
After=network-online.target go2rtc.service
Wants=network-online.target

[Service]
WorkingDirectory=$LAYANAN
ExecStart=$NODE_BIN/node $LAYANAN/src/index.js
Restart=always
RestartSec=5
Nice=10
CPUQuota=200%
MemoryMax=2G
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable dpmd-cctv-ai >/dev/null 2>&1
systemctl restart dpmd-cctv-ai

echo "▸ 4. Pemeriksaan"
sleep 15
systemctl is-active dpmd-cctv-ai
curl -s -m 5 http://127.0.0.1:8001/health | head -c 400; echo
echo "✅ Selesai. Log: journalctl -u dpmd-cctv-ai -f"
