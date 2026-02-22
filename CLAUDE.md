# ValueMitra — CLAUDE.md

## What This Project Is

ValueMitra is a multi-tenant SaaS platform for Indian Registered Valuers (RVs). It digitizes the end-to-end property valuation workflow: assignment intake → document upload + OCR → government rate fetching → AI-assisted valuation → report generation → review + delivery.

**Compliance**: IBBI (Insolvency and Bankruptcy Board of India) and RVO (Registered Valuers Organisation) requirements must be respected at all times. Audit logs are NEVER deleted.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js + Express + TypeScript |
| ORM | Prisma (MySQL provider) |
| Frontend | React 18 + TypeScript + Vite |
| UI | Tailwind CSS + shadcn/ui |
| State | TanStack Query (server) + Zustand (client) |
| Forms | React Hook Form + Zod |
| Report Gen | `docxtemplater` + `pizzip` + LibreOffice headless |
| OCR | Google Cloud Vision (primary) + Azure Form Recognizer (fallback) |
| AI Valuation | Claude API (`claude-sonnet-4-6`) — advisory only |
| Scraping | Playwright (Maharashtra IGR + Gujarat Jantri govt rates) |
| Auth | JWT access tokens (15 min) + MySQL refresh token rotation |
| Cache | `cache_entries` MySQL table with TTL (replaces Redis) |
| Jobs | `job_queue` MySQL table + `node-cron` (replaces Bull) |
| Storage | AWS S3 (prod) / local `uploads/` (dev) via abstraction layer |
| Email | AWS SES |

**Database: MySQL ONLY. No Redis, no PostgreSQL, no MongoDB.**

---

## Monorepo Structure

```
valuemitra/
├── package.json                      # npm workspaces root
├── tsconfig.base.json
├── .env                              # root .env (source of truth for credentials)
├── apps/
│   ├── api/                          # Express backend
│   │   ├── .env                      # MUST match root .env — copy manually
│   │   ├── cjs-loader.cjs            # .js→.ts resolver for ts-node-dev CJS mode
│   │   ├── prisma/schema.prisma      # SINGLE source of truth for DB schema
│   │   └── src/
│   │       ├── config/               # env.ts, database.ts, storage.ts
│   │       ├── middleware/           # auth, tenant (CRITICAL), audit, error
│   │       ├── modules/              # feature modules (each has service + controller + router)
│   │       │   ├── auth/
│   │       │   ├── users/
│   │       │   ├── tenants/
│   │       │   ├── clients/
│   │       │   ├── assignments/
│   │       │   ├── documents/
│   │       │   ├── government-rates/ # scrapers/ subdirectory
│   │       │   ├── valuation/        # engines/ subdirectory
│   │       │   ├── ai-valuation/
│   │       │   ├── reports/          # templates/ subdirectory
│   │       │   └── review/
│   │       ├── jobs/                 # ocr.job.ts, govt-rates.job.ts, scheduler.ts
│   │       └── utils/                # cache.util.ts
│   └── web/                          # React frontend (Stage 1 scaffold)
└── packages/
    └── shared/                       # @valuemitra/shared — types, schemas, constants
        └── src/
            ├── types/                # All TypeScript interfaces + enums
            ├── schemas/              # Zod schemas: auth, assignment, document,
            │                         #   government-rates, valuation
            └── constants/            # ibbi.constants.ts, india.constants.ts
```

---

## Critical Conventions

### Multi-Tenancy (MOST IMPORTANT)
Every service function receives `tenantId` as the first argument. All Prisma queries MUST include `where: { tenantId }`. The `tenant.middleware.ts` enforces this at the HTTP layer. Never query across tenant boundaries.

### Auth Flow
- Access token: JWT, 15 min expiry, contains `{ sub, email, role, tenantId }`
- Refresh token: 64-byte random hex, stored as SHA-256 hash in `refresh_tokens` table
- On refresh: old token is revoked, new token issued (rotation)
- On reuse detection: ALL tokens for that user are revoked
- RBAC helpers in `auth.middleware.ts`: `requireRoles(...roles)`, `requireAdmin`, `requireValuer`, `requireNotViewer`, `requireSuperAdmin`

### Module Structure
Each module follows the pattern:
```
modules/<name>/
  <name>.service.ts    ← business logic, calls Prisma, throws AppError subclasses
  <name>.controller.ts ← parses req with Zod, calls service, sends response
  <name>.router.ts     ← Express Router with auth/rbac middleware applied
```

### Error Handling
Use `AppError` subclasses from `middleware/error.middleware.ts`:
- `NotFoundError` (404)
- `UnauthorizedError` (401)
- `ForbiddenError` (403)
- `ConflictError` (409)
- `ValidationError` (400)
- `AppError(statusCode, message)` for custom codes — NOTE: statusCode is FIRST arg

`ZodError` is automatically caught and formatted as `VALIDATION_ERROR` by `errorHandler`.
Wrap async controller handlers in `asyncHandler()`.

### 404 + Error Handler Registration (CRITICAL)
The 404 and error handlers are registered in `src/index.ts` AFTER `await registerRoutes()`, NOT in `app.ts`. If they are added before routes, all requests hit 404. The order in `bootstrap()`:
```
await registerRoutes()
app.use(404 handler)
app.use(errorHandler)
await prisma.$connect()
startScheduler()
app.listen()
```

### ts-node-dev CJS Module Resolution
`ts-node-dev` with `--transpile-only` doesn't remap `.js`→`.ts` automatically in CJS mode.
Fix: `apps/api/cjs-loader.cjs` patches `Module._resolveFilename` to do the remapping.
Dev script: `ts-node-dev --respawn --transpile-only --exit-child --require ./cjs-loader.cjs src/index.ts`

### Prisma Migration (dbusr_valuem user)
`dbusr_valuem` lacks CREATE DATABASE privilege → `prisma migrate dev` fails with P3014.
**Use `prisma db push` for all schema changes in development** (no shadow DB needed).
```bash
cd apps/api && npx prisma db push
```

### Audit Logging
Every write operation must call `createAuditLog()` from `middleware/audit.middleware.ts`. Include `before` and `after` snapshots for updates. Audit logs are NEVER deleted (IBBI compliance).

### Assignment Status Transitions
Valid transitions are defined in `ASSIGNMENT_STATUS_TRANSITIONS` (packages/shared). Always validate transitions there — never hardcode status checks.

### Assignment Number Format
`{FIRM_CODE}/{FY}/{4-digit-seq}` — e.g. `UCVLLP/2025-26/0001`
`firmCode` is set per-tenant in the `Tenant.firmCode` field.

### Report Reference Number Format
`{FIRM_CODE}/{BANK_CODE}/{FY}/{SEQ}` — e.g. `UCVLLP/PNB/2025-26/468`

### Schema Field Conventions (IMPORTANT — match schema.prisma exactly)
- **User name**: `fullName` (single field) — NOT `firstName`/`lastName`
- **User IBBI fields**: `ibbiRegNo`, `ibbiRegCategory`, `ibbiRegValidUpto`, `rvoMembershipNo`, `qualifications`, `experienceYears` — no `designationTitle`
- **Client names**: `fullName` (individual), `companyName` (company/NBFC/HFC), `bankName` (bank) — NOT `name`
- **Client bank fields**: `bankBranch`, `ifscCode`, `gstin` — NOT `branchName`, `ifsc`, `gst`
- **Client**: no `isActive` field — filter by existence only
- **Tenant firm reg**: `ibbiFirmRegNo` — NOT `ibbiRegNo`; address: `registeredAddress` — NOT `address`
- **RegisterTenantSchema**: fields are `fullName`, `firmName`, `firmCode`, `ibbiFirmRegNo` — NOT firstName/lastName
- **Assignment**: no `propertyAddress` — stored in `Property.addressLine1`; API input uses `propertyAddress`/`propertyCity`/`propertyState` which service maps to Property model; `referenceNote` not `remarks`; relation is `checklist` not `checklistItems`; requires `createdById`
- **Property**: `municipalNo` (not `plotNo`), `flatNo` (not `floorNo`), `numberOfFloors` (not `totalFloors`), `zoningClassification` (not `propertyUse`), `structureType` (not `constructionType`)
- **Document**: `ocrStatus` uses `OCRStatus` enum; `storageProvider` is `"local"` or `"s3"`
- **Cache tags**: stored as comma-separated `String?` — use `FIND_IN_SET` for tag queries
- **JobStatus enum**: PENDING / LOCKED / COMPLETED / FAILED / CANCELLED (not PROCESSING)
- **GovernmentRate**: `ratePerSqM`/`ratePerSqFt`/`ratePerAcre` stored as `Decimal` strings in DB — convert with `String(number)` when writing, `parseFloat()` when reading

### Job Queue Pattern
All async jobs go through `job_queue` table:
- OCR: polled every 30s, batch of 5, lock TTL 10min
- Govt Rate Fetch: polled every 5min, batch of 3 (Playwright is heavy), lock TTL 15min
- Report Generate: polled every 30s (Stage 7)
- Exponential back-off: retry after `2^attempts` minutes, max 3 attempts

### Scheduler Job Order (scheduler.ts)
```
OCR: */30 * * * * *  (every 30s)
Govt rates: */5 * * * *  (every 5min)
Cache cleanup: 0 3 * * *  (daily 03:00)
```

---

## Database Setup

```bash
# DB user: dbusr_valuem (lacks CREATE DATABASE — use db push, not migrate)
cd apps/api
npx prisma db push          # push schema changes (dev)
npx prisma generate         # regenerate client after schema changes
```

AMPPS MySQL binary: `/Applications/AMPPS/apps/mysql/bin/mysql`
AMPPS MySQL socket: `/Applications/AMPPS/apps/mysql/var/mysql.sock`

---

## Development Commands

```bash
# Install all workspace dependencies (from root)
npm install

# Build shared package (REQUIRED before running API or after schema changes)
npm run build -w packages/shared

# Run API in dev mode (from apps/api directory)
cd apps/api && npm run dev
# OR from root:
npm run dev -w apps/api

# Run web in dev mode (from root)
npm run dev -w apps/web

# Schema changes
cd apps/api && npx prisma db push     # apply to dev DB
cd apps/api && npx prisma generate    # regenerate client

# Type-check (no emit)
npx tsc --noEmit -p apps/api/tsconfig.json

# Lint
npx eslint apps/api/src --ext .ts
```

**API runs on port 3006** (set in `apps/api/.env`).

---

## Government Rates Module (Stage 5)

- **Scrapers**: `modules/government-rates/scrapers/`
  - `base.scraper.ts` — abstract class, Playwright launch/close, retry with back-off
  - `igr-maharashtra.scraper.ts` — Maharashtra ASR (Annual Statement of Rates)
  - `jantri-gujarat.scraper.ts` — Gujarat Jantri (GARVI portal)
- **Job**: `jobs/govt-rates.job.ts` dispatches scrapers based on `StateCode` in job payload
- **Fallback**: If scraper breaks (govt sites change markup), use `POST /api/government-rates/manual`
- **Supported states for scraping**: `MAHARASHTRA`, `GUJARAT` only
- **`getRatesForProperty()`** in service: used by valuation engine to look up applicable rate by location + category, broadening scope (village→taluka→district) until a match is found

---

## Valuation Module (Stage 6 — in progress)

### Engines (`modules/valuation/engines/`)
- `depreciation.engine.ts` — Straight-Line, WDV, Observed Condition, CPWD Schedule methods
- `cost-approach.engine.ts` — Land value + depreciated building + services cost
- `market-comparison.engine.ts` — Comparable sales with adjustments → correlated value
- `income-approach.engine.ts` — NOI / cap rate

### ValuationRun lifecycle
1. `POST /api/valuation` — create run (choose approach)
2. `PATCH /api/valuation/:id/market` — save comparables
3. `PATCH /api/valuation/:id/cost` — save cost approach inputs (auto-computes)
4. `PATCH /api/valuation/:id/income` — save income approach inputs (auto-computes)
5. `POST /api/valuation/:id/finalize` — set weights, compute weighted value, lock run
6. Finalized run updates `Assignment.finalValue` and advances status to `ANALYSIS_IN_PROGRESS`

### AI Valuation (advisory only)
- `POST /api/ai-valuation/:assignmentId` — calls Claude API with property + valuation context
- Returns `AIValuationResult` stored in `ValuationRun.aiValuationResult`
- NEVER overrides RV's decision — purely advisory

---

## Report Templates

21 `.docx` templates across 8 banks — stored in `Report Templates/` in the project root.

Templates are **filled sample reports**, not blank files. Before going live, each template must be processed (developer one-time task):
1. Open in Word
2. Replace sample data in table cells with `{token}` syntax (e.g. `{ownerName}`, `{finalValue}`)
3. Mark image positions with `{%propertyPhoto1}` etc. (docxtemplater-image-module syntax)
4. Save processed templates to `apps/api/src/modules/reports/templates/processed/`
5. Upload to S3 under `templates/` prefix

Template mapping: `report_templates` DB table with `fieldMappings` JSON column.

---

## Key Environment Variables

Both `apps/api/.env` and root `.env` must be kept in sync (copy manually).

- `DATABASE_URL` — `mysql://dbusr_valuem:<pass>@localhost:3306/valuemitra`
- `JWT_SECRET` — 64-char random string, never commit the actual value
- `PORT` — `3006`
- `STORAGE_PROVIDER` — `"local"` (dev) or `"s3"` (prod)
- `LOCAL_UPLOAD_PATH` — `"./uploads"` (dev)
- `ANTHROPIC_API_KEY` — for AI valuation (Stage 6)
- `GOOGLE_APPLICATION_CREDENTIALS` — absolute path to GCP service account JSON (Stage 4 OCR)
- `AZURE_FORM_RECOGNIZER_ENDPOINT` + `AZURE_FORM_RECOGNIZER_KEY` — OCR fallback (optional)
- `SES_SMTP_HOST` / `SES_SMTP_PORT` / `SES_SMTP_USER` / `SES_SMTP_PASS` — AWS SES SMTP (Stage 8 email)
- `EMAIL_SENDER` — `"no-response@valuemitra.com"` (verified SES identity)
- `EMAIL_SENDER_NAME` — `"Valuemitra"`
- `EMAIL_BCC` — BCC address for all outbound emails (e.g. `mehul.pipalia@gmail.com`)
- `WORKER_ID` — `"worker-1"` (unique per instance for job locking)

---

## Implementation Status

| Stage | Status | Description |
|---|---|---|
| 1 — Foundation | ✅ Done | Monorepo, shared package, API scaffold |
| 2 — Auth | ✅ Done | Register, login, refresh, logout, JWT, RBAC |
| 3 — Clients & Assignments | ✅ Done | Client CRUD, assignment lifecycle, checklist auto-gen |
| 4 — Documents & OCR | ✅ Done | Multer upload, storage abstraction, Google Vision REST + Azure fallback, node-cron job scheduler, checklist auto-update |
| 5 — Govt Rates | ✅ Done | Playwright scrapers (IGR + Jantri), manual entry, override, job queue, `getRatesForProperty()` |
| 6 — AI & Analysis | ✅ Done | Valuation engines (cost, market, income, depreciation), Claude API advisory, `ai-valuation` module |
| 7 — Report Generation | ✅ Done | `report-data.builder.ts` (IBBI gate), `docx-generator.ts` (docxtemplater/pizzip), `pdf-converter.ts` (LibreOffice headless), `number-to-words.ts` (Indian lakh/crore), reports service/controller/router |
| 8 — Review & Delivery | ✅ Done | 3-step review workflow (INTERNAL→CLIENT_BANK→COMPLIANCE→APPROVED), SES SMTP via nodemailer, notification job (every 1 min), report delivery with PDF attachment |
| 9 — Deployment | ✅ Done | EC2 + Nginx + PM2 + GitHub Actions CI/CD + Let's Encrypt SSL |

---

## Deployment (Stage 9)

### Production URLs
- **Frontend + API**: `https://vmapps.techsahyogi.com`
- **EC2**: `13.200.199.101` (Ubuntu 24.04), user `ubuntu`
- **App dir**: `/var/www/valuemitra`
- **PM2 process**: `valuemitra-api` (id: 2)
- **API port**: `3006` (internal; Nginx proxies `/api/`)

### Infrastructure Files
- `infrastructure/pm2/ecosystem.config.cjs` — PM2 fork mode, 500MB limit, logs to `/var/log/valuemitra/`
- `infrastructure/nginx/valuemitra.conf` — SPA + `/api/` reverse proxy
- `infrastructure/scripts/setup.sh` — one-time EC2 setup (Node 20, PM2, Nginx, LibreOffice, Playwright deps)
- `infrastructure/scripts/deploy.sh` — full build + Prisma + PM2 reload + health check
- `.github/workflows/deploy.yml` — GitHub Actions: type-check → SSH → deploy.sh

### GitHub Actions CI Pipeline
1. `npm ci --include=dev`
2. `npm run build -w packages/shared` ← **must be before tsc** (shared dist required)
3. `npx tsc --noEmit -p apps/api/tsconfig.json`
4. SSH → EC2 → `git pull` → `deploy.sh`

Secrets: `EC2_HOST`, `EC2_USER`, `EC2_SSH_KEY` (in GitHub repo Settings → Secrets)

### EC2 Git Pull — SSH Remote Required
GitHub Actions runs non-interactively; HTTPS git remotes fail. EC2 uses SSH remote:
- Deploy key: `~/.ssh/valuemitra_deploy` (Ed25519, added to GitHub repo → Deploy Keys)
- Remote: `git@github.com:mehulno1/valuemitra.git`

### Known Fixes Applied
- `apps/api/tsconfig.json`: `"noImplicitAny": false` — Prisma callback inference fails strict mode
- `apps/web/vite.config.ts`: alias `@valuemitra/shared` → `../../packages/shared/src/index.ts` — Vite/Rollup can't analyze CJS named exports; alias points to TS source directly
- `apps/web/src/pages/auth/RegisterPage.tsx`: field names corrected (`fullName` not `firstName`/`lastName`; `ibbiFirmRegNo` not `ibbiRegNo`)
- OCR key file `valuemitra-ocr-keys.json` excluded from git (added to `.gitignore`); must be copied to EC2 manually via `scp`

### Manual Steps After Fresh EC2 Clone
```bash
# Copy secret files (not in git)
scp -i ~/.ssh/demo.pem valuemitra-ocr-keys.json ubuntu@13.200.199.101:/var/www/valuemitra/
# Set GOOGLE_APPLICATION_CREDENTIALS in .env to absolute path
```

---

## IBBI Compliance Checklist (for Report Generation)

Before generating/delivering a report, validate:
- `User.ibbiRegNo` — present and non-empty
- `User.ibbiRegValidUpto` — not expired (must be in the future)
- `User.signatureUrl` — RV digital signature uploaded
- `Assignment.inspectionDate` — set
- `Assignment.purposeOfValuation` — set
- All mandatory checklist items: status = `UPLOADED` or `VERIFIED` or `WAIVED`
- `ValuationRun` — exists and `isFinalized = true`

See `IBBI_MANDATORY_FIELDS` and `IBBI_CERTIFICATE_TEXT` in `packages/shared/src/constants/ibbi.constants.ts`.

