#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# ValueMitra — Deployment Script
# Runs on EC2 after every git pull (manually OR via GitHub Actions).
# Usage: bash /var/www/valuemitra/infrastructure/scripts/deploy.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e  # Exit immediately on any error

APP_DIR="/var/www/valuemitra"
LOG_DIR="/var/log/valuemitra"
PM2_CONFIG="$APP_DIR/infrastructure/pm2/ecosystem.config.cjs"

echo "======================================================"
echo "  ValueMitra — Deploy  $(date '+%Y-%m-%d %H:%M:%S')"
echo "======================================================"

cd "$APP_DIR"

# ── 1. Install dependencies ────────────────────────────────
echo ""
echo "→ Installing dependencies..."
npm ci --include=dev

# Ensure root node_modules/.bin is on PATH (npm workspaces may not resolve it otherwise)
export PATH="$APP_DIR/node_modules/.bin:$PATH"

# ── 2. Build all workspaces ────────────────────────────────
echo ""
echo "→ Building shared package..."
npm run build -w packages/shared

echo "→ Building API..."
npm run build -w apps/api

echo "→ Building web frontend..."
npm run build -w apps/web

# ── 3. Generate Prisma client ──────────────────────────────
echo ""
echo "→ Generating Prisma client..."
cd "$APP_DIR/apps/api"
npx prisma generate

# ── 4. Apply DB schema changes ─────────────────────────────
# FIRST DEPLOY: uses db push (no migration history in dev)
# SUBSEQUENT:   uses migrate deploy (idempotent, safe for prod)
echo ""
echo "→ Applying database schema changes..."
if [ -d "$APP_DIR/apps/api/prisma/migrations" ] && [ "$(ls -A $APP_DIR/apps/api/prisma/migrations)" ]; then
    echo "  Using prisma migrate deploy..."
    npx prisma migrate deploy
else
    echo "  No migration history found — using prisma db push..."
    npx prisma db push --accept-data-loss
fi

cd "$APP_DIR"

# ── 5. Seed report templates (uploads processed .docx to S3/local + upserts DB rows) ──
echo ""
echo "→ Seeding report templates..."
cd "$APP_DIR"
node scripts/seed-report-templates.js || echo "  ⚠ Template seed failed — check manually"

# ── 7. Ensure Playwright Chromium is installed ────────────
echo ""
echo "→ Checking Playwright browser..."
cd "$APP_DIR/apps/api"
npx playwright install chromium --with-deps 2>/dev/null || true
cd "$APP_DIR"

# ── 8. Start or reload PM2 ────────────────────────────────
echo ""
echo "→ Reloading PM2 process..."
if pm2 list | grep -q "valuemitra-api"; then
    # Already running — zero-downtime reload
    pm2 reload valuemitra-api
else
    # First start
    pm2 start "$PM2_CONFIG"
fi

# Save PM2 process list so it survives reboots
pm2 save

# ── 7. Health check ───────────────────────────────────────
echo ""
echo "→ Running health check (waiting 5s for API to start)..."
sleep 5
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3006/health || echo "000")

if [ "$HTTP_STATUS" = "200" ]; then
    echo "  ✅ API is healthy (HTTP $HTTP_STATUS)"
else
    echo "  ❌ Health check failed (HTTP $HTTP_STATUS)"
    echo "  Check logs: pm2 logs valuemitra-api --lines 50"
    exit 1
fi

echo ""
echo "======================================================"
echo "  ✅ Deploy complete!  $(date '+%Y-%m-%d %H:%M:%S')"
echo "======================================================"
pm2 list
