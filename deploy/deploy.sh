#!/usr/bin/env bash
# ============================================================
#  One-shot deploy untuk VPS/Linux lab
#  Pakai:   chmod +x deploy/deploy.sh && sudo ./deploy/deploy.sh
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

PORTS_TCP="8080 3000 4000 5000 6060 9001 9002 9003 1337 10001 10002 10003"

echo "=== [1/4] Docker ==="
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker tidak ada, memasang Docker Engine..."
  curl -fsSL https://get.docker.com | sh
fi
if ! docker compose version >/dev/null 2>&1; then
  apt-get update -y && apt-get install -y docker-compose-plugin
fi
echo "OK: $(docker --version)"

echo "=== [2/4] Konfigurasi SERVER_IP ==="
if [ ! -f .env ]; then cp .env.example .env; fi
if grep -q '^SERVER_IP=$' .env || grep -q 'SERVER_IP=203.0.113.10' .env; then
  DETECTED="$(curl -4 -fsS --max-time 8 ifconfig.me || curl -4 -fsS --max-time 8 icanhazip.com || true)"
  if [ -n "${DETECTED}" ]; then
    sed -i "s#^SERVER_IP=.*#SERVER_IP=${DETECTED}#" .env
    echo "SERVER_IP diisi otomatis: ${DETECTED}"
  else
    echo "PERINGATAN: gagal deteksi IP publik. Isi manual file deploy/.env"
  fi
fi
grep '^SERVER_IP=' .env

echo "=== [3/4] Build & jalankan semua service ==="
docker compose up -d --build

echo "=== [4/4] Firewall UFW ==="
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null 2>&1 || true
  ufw allow 22/tcp >/dev/null 2>&1 || true
  for p in $PORTS_TCP; do ufw allow "$p/tcp" >/dev/null 2>&1 || true; done
  ufw --force enable >/dev/null 2>&1 || true
  echo "Port yang dibuka: $PORTS_TCP"
  echo "Catatan: 3306 (MySQL) SENGAJA TIDAK dibuka."
else
  echo "UFW tidak terpasang — buka port manual di firewall provider kamu."
fi

echo
echo "=== STATUS ==="
docker compose ps
echo
echo "Arena   : http://$(grep '^SERVER_IP=' .env | cut -d= -f2):8080"
echo "Selesai. Verifikasi dari komputer lain:  powershell -File deploy/verify.ps1 -Target <IP_VPS>"
