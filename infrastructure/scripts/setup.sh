#!/usr/bin/env bash
# One-time server setup (Ubuntu 24.04). Run as a sudo-capable user.
set -euo pipefail
APP_DIR=${APP_DIR:-/var/www/valuemitra-v2}

sudo apt-get update
# LibreOffice (Word → PDF), poppler (PDF → page images), fonts for English and Devanagari reports
sudo apt-get install -y --no-install-recommends libreoffice-writer-nogui poppler-utils fonts-liberation fonts-noto-core fonts-noto-ui-core fonts-crosextra-carlito fonts-crosextra-caladea
node -v | grep -qE '^v(2[0-9])' || { echo "Node 20+ required"; exit 1; }
command -v pm2 >/dev/null || sudo npm i -g pm2
sudo mkdir -p /var/log/valuemitra-v2 "$APP_DIR"
sudo chown -R "$USER" /var/log/valuemitra-v2 "$APP_DIR"
echo "Next: clone the repo into $APP_DIR, create $APP_DIR/.env (see .env.example), copy secrets/google-vision.json,"
echo "      then run infrastructure/scripts/deploy.sh and as MySQL root: mysql valuemitra < infrastructure/mysql/audit_triggers.sql"
