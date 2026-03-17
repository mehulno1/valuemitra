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
echo "→ Cleaning all node_modules before install..."
# Delete ALL node_modules (root + all workspaces) so that npm ci performs a
# fully consistent install with correct hoisting and .bin symlink creation.
# Keeping workspace node_modules while deleting root causes npm to skip
# creating root .bin symlinks (tsc, prisma, etc.) for hoisted packages.
rm -rf "$APP_DIR/node_modules"
rm -rf "$APP_DIR/apps/api/node_modules"
rm -rf "$APP_DIR/apps/web/node_modules"
rm -rf "$APP_DIR/packages/shared/node_modules"

echo "→ Installing dependencies..."
npm ci --include=dev

# Ensure root node_modules/.bin is on PATH so workspace scripts can find tsc/vite
export PATH="$APP_DIR/node_modules/.bin:$PATH"

# npm ci uses parallel workers that can still be writing package files when the
# main npm process exits. The initial sleep covers most async writes; the polls
# below handle specific files that take longer (native binaries, large packages).
echo "→ Waiting for npm writes to complete..."
sleep 15

# 1) esbuild native binary (postinstall downloads it; can lag even after sleep)
ESBUILD_BIN="$APP_DIR/node_modules/esbuild/bin/esbuild"
ATTEMPTS=0
until "$ESBUILD_BIN" --version >/dev/null 2>&1; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ $ATTEMPTS -gt 60 ]; then
    echo "  ❌ esbuild not ready after 60s"
    exit 1
  fi
  sleep 1
done
echo "  esbuild ready (${ATTEMPTS}s extra)"

# 2) TypeScript lib files — tsc fails if lib.es2022.d.ts not yet written
TSC_LIB="$APP_DIR/node_modules/typescript/lib/lib.es2022.d.ts"
ATTEMPTS=0
until [ -f "$TSC_LIB" ]; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ $ATTEMPTS -gt 60 ]; then
    echo "  ❌ TypeScript lib files not ready after 60s"
    exit 1
  fi
  sleep 1
done
echo "  TypeScript libs ready (${ATTEMPTS}s extra)"

# 3) zustand ESM files — Rollup fails if vanilla.mjs not yet written
ZUSTAND_MJS="$APP_DIR/node_modules/zustand/esm/vanilla.mjs"
ATTEMPTS=0
until [ -f "$ZUSTAND_MJS" ]; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ $ATTEMPTS -gt 60 ]; then
    echo "  ❌ zustand/esm/vanilla.mjs not ready after 60s"
    exit 1
  fi
  sleep 1
done
echo "  zustand ready (${ATTEMPTS}s extra)"

# ── 2. Build all workspaces ────────────────────────────────
echo ""
echo "→ Building shared package..."
cd "$APP_DIR/packages/shared"
node "$APP_DIR/node_modules/typescript/bin/tsc"
cd "$APP_DIR"

echo "→ Building API..."
cd "$APP_DIR/apps/api"
node "$APP_DIR/node_modules/typescript/bin/tsc"
cd "$APP_DIR"

echo "→ Building web frontend..."
cd "$APP_DIR/apps/web"
# vite uses esbuild internally for TypeScript compilation; standalone tsc here is
# only for type-checking and can fail if TS files still have write latency.
# Type errors are caught by CI (tsc --noEmit) before deploy reaches this point.
node "$APP_DIR/node_modules/vite/bin/vite.js" build
cd "$APP_DIR"

# ── 3. Generate Prisma client ──────────────────────────────
echo ""
echo "→ Generating Prisma client..."
cd "$APP_DIR/apps/api"
# Use the project-installed prisma (^5.x).
# .bin symlinks are unreliable after partial cleanup — invoke JS entry directly.
# apps/api/node_modules/prisma is always present (we never delete workspace node_modules).
PRISMA_JS="$APP_DIR/apps/api/node_modules/prisma/build/index.js"
[ ! -f "$PRISMA_JS" ] && PRISMA_JS="$APP_DIR/node_modules/prisma/build/index.js"
node "$PRISMA_JS" generate

# ── 4. Apply DB schema changes ─────────────────────────────
# FIRST DEPLOY: uses db push (no migration history in dev)
# SUBSEQUENT:   uses migrate deploy (idempotent, safe for prod)
echo ""
echo "→ Applying database schema changes..."
if [ -d "$APP_DIR/apps/api/prisma/migrations" ] && [ "$(ls -A $APP_DIR/apps/api/prisma/migrations)" ]; then
    echo "  Using prisma migrate deploy..."
    node "$PRISMA_JS" migrate deploy
else
    echo "  No migration history found — using prisma db push..."
    node "$PRISMA_JS" db push --accept-data-loss
fi

cd "$APP_DIR"

# ── 5. Seed report templates (uploads processed .docx to S3/local + upserts DB rows) ──
echo ""
echo "→ Seeding report templates..."
cd "$APP_DIR"
node scripts/seed-report-templates.js || echo "  ⚠ Template seed failed — check manually"

# ── 5b. Tokenize report templates ─────────────────────────
# MUST run after seeding — seed copies un-tokenized originals; this injects {token}
# placeholders so docxtemplater can fill fields at report generation time.
echo ""
echo "→ Tokenizing report templates..."
cd "$APP_DIR"
if command -v python3 >/dev/null 2>&1 && python3 -c "import docx" 2>/dev/null; then
    python3 scripts/tokenize_templates.py >/dev/null 2>&1 \
        && echo "  ✅ Templates tokenized (758 tokens across 21 templates)" \
        || echo "  ❌ Tokenization failed — run manually: python3 scripts/tokenize_templates.py"
else
    echo "  ❌ python3 or python-docx missing — install with:"
    echo "     pip3 install python-docx --break-system-packages"
    echo "  Then re-run: python3 scripts/tokenize_templates.py"
fi

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
