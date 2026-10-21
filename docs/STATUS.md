# ValueMitra v2 — Status and handover

Last updated: 21 Oct 2026 (AI reading live). Read this first in a new session, then `CLAUDE.md` (rules) and `README.md` (how it fits together).
Team-facing testing brief (shareable): https://claude.ai/artifact/Ju3kDTMncFZGYQre2TK41T

## 1. Where things are

| What | Where |
|---|---|
| Live app | https://vmapps.techsahyogi.com (EC2 13.200.199.101, `/var/www/valuemitra-v2`, PM2 `valuemitra-v2`, port 3010) |
| Code | github.com/mehulno1/valuemitra `main` (public). Old v1 code: tag `v1-legacy` |
| Local dev | `~/Claude-projects/valuemitra`; API :3010 (`npm run dev -w apps/api`), web :5173 (`npm run dev -w apps/web`) |
| Database | MySQL 8, DB `valuemitra`, user `dbusr_valuem` (local AMPPS and EC2). v1 schema replaced on both |
| Specs | `~/Downloads/ValueMitra — Product Design Document (Phase 1).md`, `ValueMitra_Prototype_v2.html`, `ValueMitra_Prototype_Testing_Guide.docx` |
| Pilot test files | `~/Claude-projects/Valuemitra-old/Flat/SBI` (Nilesh Bapu flat: 26-page bundle, O.C., site sheet, 22 photos) — test input only |
| Backups | Local v1 DB: `~/Claude-projects/valuemitra-v1-db-backup/`. EC2: `~/backups/valuemitra-v1-*.sql.gz` and the v1 nginx config |
| Old v1 on EC2 | `/var/www/valuemitra`, PM2 `valuemitra-api` — stopped, not deleted |
| Secrets | `.env` at repo root (local) and `/var/www/valuemitra-v2/.env` (EC2), never committed. Google Vision key: `secrets/google-vision.json` (local), `/var/www/valuemitra/valuemitra-ocr-keys.json` (EC2). Anthropic key: `ANTHROPIC_API_KEY` in both `.env` files — copy local → EC2 over ssh stdin (never on a command line), then `pm2 restart valuemitra-v2 --update-env` |

Logins (demo firm DVA): valuer@ / coordinator@ / accounts@ / admin@demo.valuemitra.in. Local password `ValueMitra@2026`;
live password = `SEED_PASSWORD` in the EC2 `.env` (random, not in git).

## 2. Decisions taken (with the user)

- Rebuild from scratch; nothing reused from v1 except the database server. MySQL only.
- Stack: TypeScript — Fastify + Kysely API, React + Vite + Tailwind web, npm workspaces.
- Reading: Google Vision OCR → Claude (`claude-opus-5-5`, server-side refusal fallback) for sorting and extraction.
- SBI Format-A Word template recreated from the prototype's report pages (`apps/api/src/seed/sbi-format-a.ts`) and onboarded through the template engine like any bank upload.
- Milestone 1 = Gate A (one SBI flat case end to end). Quick Estimate, Billing, Analytics shown as "Coming soon".
- Prototype gaps resolved: evidence-backed rate = weighted median of adjusted comparables (range = weighted IQR, at least ±3%); 20% guideline check both directions; realizable/distress % per bank rule; IGST when supply is out of state (billing, not built yet); a Signed stage; report serial per firm per FY, bank and branch codes from the case; reissue keeps the serial and adds /R1.
- Two-factor login built but switched off on the live site for testing (`REQUIRE_2FA=false`).

## 3. Built (Gate A, work packages 1–8)

- **Platform:** firms, users, roles (coordinator, valuer, accounts, admin), per-action permissions (sign only for valuers), JWT + rotating refresh cookie, TOTP 2FA, append-only audit log, domain events, MySQL job queue with retries, gap-free numbering, firm settings, feature flags, firm-scoped file storage, retention job (daily 02:30 IST).
- **Master data:** 144-field canonical dictionary (versioned, platform + firm overrides), config versions (profile `flat`, rule set `firm` with per-bank overrides, check set, wording, document types) — draft → publish → pinned per case. Safe expression language for derivations, checks and wording (`packages/shared/src/expr.ts`).
- **Case resolver** (`modules/casedata/resolver.ts`): every field from sources in priority order, derivations, wording, manual/report edits, conflicts, pending reasons.
- **Assignments:** intake, case IDs, stage machine (New → Awaiting documents → Site visit → Drafting → Ready for review → Signed → Sent; Billed/Paid reserved for billing), board, alerts with reminder messages.
- **Documents:** upload (accepted by content), page images + Vision OCR, AI sorting into documents, AI extraction with page/snippet/confidence, label correction (re-extracts), checklist synced to documents, report pages, "seen before", KYC: excluded, stored copy redacted, page references renumbered, deleted per policy (`applyKyc`, per-document lock).
- **Site visit:** expiring hashed-token engineer link and mobile page, photo EXIF geo/time, perceptual-hash duplicates, AI captions/selfie/name-board flags, 9–18 selection, captions, typed sheet read into fields.
- **Evidence & valuation:** ready reckoner lookup by village spellings, assisted capture of IGR/listing pages, firm comparables (signed reports feed back), adjustments from rules, proposal, valuation by method (market comparison; cost approach in the engine), value history.
- **Checks:** built-in + expression checks from config, per-bank overrides, acceptance with reason, critical blocks signing.
- **Template engine:** detect (table cells, row×column grids, `{{FIELD}}` placeholders, inline blanks), auto-map (label similarity + section context + past confirmations), confirm/ignore/new field, compile with `⟪ ⟫` tags, annexure pages (photos 3×3, map, ready reckoner, listings, sale transactions, documents 9/4/1), letterhead header, draft marker, footer short signature + page no.
- **Reports:** live preview (docx in browser with click-to-edit markers), draft PDF (watermarked), share draft, send to valuer, sign (gap-free number, register, final Word + PDF via LibreOffice job), reopen /R1, dispatch checklist, email via SMTP, WhatsApp text, register.
- **Web:** every Gate A screen plus Bank formats, Firm settings, Master data, Data import & export, engineer page.
- **Ops:** PM2 + Nginx config, `infrastructure/scripts/{setup,deploy}.sh`, CI (typecheck, tests, web build), firm onboarding script (`npm run firm:create -w apps/api`).

AI reading verified (21 Oct 2026) with `claude-opus-5-5`: the real 26-page pilot bundle was sorted into 10 documents (Index II in Marathi, agreement, NOC, receipts, previous Index II, O.C., approved plan, site photo) with the KYC page removed; built-up area 465, agreement value 59,60,000, guideline value 53,74,030, Index II no./date and village read correctly with page and snippet; customer name conflict flagged between agreement and Index II; the handwritten O.C. date read at 50–60% confidence and caught by the low-confidence check. Also tested on the live site with the O.C. photo.

Verified: 11 unit tests (valuation engine reproduces the prototype: Rs. 12,800 proposal, FMV 69,75,000 at Rs. 15,000; expression language). End-to-end run on the pilot files (OCR, KYC, photos, evidence, conflict, valuation, checks, sign-off, 16-page signed report). Browser screenshots of every screen. Production smoke test (login, case, draft PDF).

## 4. Left — by work package

| WP | Left |
|---|---|
| 1 Platform | S3 storage adapter; DB audit triggers (`infrastructure/mysql/audit_triggers.sql`, needs MySQL root on EC2); 2FA back on |
| 2 Master data | Shop/office profiles tuned; open land and bungalow profiles |
| 3 Assignments | Forward-to-case email address; WhatsApp intake |
| 4 Extraction | Accuracy measured across more pilot cases (tested on one bundle + O.C.); handwritten entries; site sheet reading checked on a real sheet |
| 5 Template engine | Compare a rendered version with the bank's filled sample |
| 6 Site visit | Handwritten sheets (later) |
| 7 Evidence | Distance filter (needs geocoding / Google Maps key); land and bungalow methods in the screens |
| 9 Learning | Retrieval of past cases in extraction, evaluation sets, approved model/rule updates with rollback, shared anonymised pool, metrics |
| 10 Quick Estimate | Everything |
| 11 Business | Billing (per-case/batch, GST incl. IGST, proforma, payments with TDS, credit notes, ageing, Tally/Zoho/GSTR-1, engineer payouts), analytics, CSV imports |
| 12 Privacy | Consent flow for the shared pool |
| 13 Bank formats | SBI long, BoB, Union Bank, BoI, BoM, NKGSB, Federal, ValueMitra standard (need templates from Premal) |
| 14 Land & bungalow | Everything, tuned with sample cases |

Gates: A built (AI reading live; first real pilot case next) → B all property types → C all banks + months 0–3 learning targets → D second firm by configuration only.

## 5. Next actions

1. Internal testing with the team brief; triage feedback (config change vs code change).
2. First real pilot case (Gate A); measure how many auto-filled fields are accepted without edit (target 85%).
3. Billing & payouts (WP 11) — cases cannot reach Billed/Paid without it.
4. Collect bank templates and land/bungalow samples from Premal → Gates B and C.
5. Turn 2FA back on (`REQUIRE_2FA=true`) before real firms use the live site.

## 6. Runbook

- Deploy: `ssh … "cd /var/www/valuemitra-v2 && bash infrastructure/scripts/deploy.sh"` (pull, build, migrate, platform seed, PM2 reload, health check) — or `/valuemitra-ec2 deploy`.
- Schema change: new `apps/api/migrations/000N_*.sql` → `npm run db:migrate -w apps/api` → `sh apps/api/scripts/db-types.sh`.
- Platform dictionary/config change: edit `apps/api/src/seed/{fields,config}.ts`; the seed (also run by deploy.sh) adds new fields, versions changed fields, and publishes a changed configuration as a new version. Cases keep the versions they pinned. Firm-specific changes go through Master data / Firm settings.
- New firm: `npm run firm:create -w apps/api -- --code ABC --name "…" --admin-name … --admin-email … --admin-password …`.
- Local reset (wipes data): `npm run db:reset -w apps/api`.
- Dev helpers live in `apps/api/scripts/dev/` (gitignored, local only): `e2e-pilot.mts` (pilot case end to end without AI; run with `RUN_JOBS=false`), `t-kyc.mts`, `ui-shots.mts` (Playwright screenshots via installed Chrome), `smoke.sh`.
- Logs on EC2: `pm2 logs valuemitra-v2`, `/var/log/valuemitra-v2/`.

## 7. Known issues and notes

- AI reading: handwritten entries come with low confidence (check `low_confidence` lists them); a 26-page bundle takes 1–3 minutes. A document left mid-read by a restart is requeued automatically.
- HEIC photos refused (sharp cannot decode); WhatsApp-forwarded photos lose GPS so the map page is skipped.
- The audit log is append-only in code; DB triggers not applied on EC2 (no root via `sudo mysql`).
- Every commit gets an automated security review; findings so far were fixed (tenant isolation, upload sniffing, platform templates, KYC redaction and locking, TOTP input).
- `storage/` in the local repo holds old test files from earlier resets (gitignored; safe to delete by hand).
