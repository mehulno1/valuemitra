#!/usr/bin/env bash
# Build and (re)start ValueMitra v2. Safe to run repeatedly.
set -euo pipefail
cd "$(dirname "$0")/../.."
git pull --ff-only
npm ci --include=dev
npm run build -w apps/api
npm run build -w apps/web
node --env-file=.env apps/api/dist/db/migrate.js
node --env-file=.env apps/api/dist/seed/index.js --platform-only
pm2 startOrReload infrastructure/pm2/ecosystem.config.cjs --update-env
pm2 save
PORT=$(grep -E '^PORT=' .env | cut -d= -f2)
for i in $(seq 1 30); do curl -fs "http://127.0.0.1:${PORT:-3010}/api/health" >/dev/null && { echo "Healthy"; exit 0; }; sleep 2; done
echo "Health check failed"; pm2 logs valuemitra-v2 --lines 50 --nostream; exit 1
