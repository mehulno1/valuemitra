# ValueMitra v2 — Status and handover

Last updated: 23 Oct 2026 (Gate A review phase 1 live: sign-off safety fixes from Premal's 22 Oct review; WP11 billing live since 21 Oct). Read this first in a new session, then `CLAUDE.md` (rules) and `README.md` (how it fits together).
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
- Milestone 1 = Gate A (one SBI flat case end to end). Quick Estimate shown as "Coming soon".
- Prototype gaps resolved: evidence-backed rate = weighted median of adjusted comparables (range = weighted IQR, at least ±3%); 20% guideline check both directions; realizable/distress % per bank rule; IGST when the place of supply is out of state; a Signed stage; report serial per firm per FY, bank and branch codes from the case; reissue keeps the serial and adds /R1.
- Two-factor login built but switched off on the live site for testing (`REQUIRE_2FA=false`).

## 3. Built (Gate A, work packages 1–8)

- **Platform:** firms, users, roles (coordinator, valuer, accounts, admin), per-action permissions (sign only for valuers), JWT + rotating refresh cookie, TOTP 2FA, append-only audit log, domain events, MySQL job queue with retries, gap-free numbering, firm settings, feature flags, firm-scoped file storage, retention job (daily 02:30 IST).
- **Master data:** 144-field canonical dictionary (versioned, platform + firm overrides), config versions (profile `flat`, rule set `firm` with per-bank overrides, check set, wording, document types) — draft → publish → pinned per case. Safe expression language for derivations, checks and wording (`packages/shared/src/expr.ts`).
- **Case resolver** (`modules/casedata/resolver.ts`): every field from sources in priority order, derivations, wording, manual/report edits, conflicts, pending reasons.
- **Assignments:** intake, case IDs, stage machine (New → Awaiting documents → Site visit → Drafting → Ready for review → Signed → Sent → Billed → Paid; Billed/Paid are set by billing when the firm has it on), board, alerts with reminder messages.
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

## 3a. Built — WP11 Business modules (21 Oct 2026, live; billing on for the demo firm)

- **Billing** (feature flag `billing`, permission `bill`; migration `0006_billing.sql`, `modules/billing/`): Ready to bill (signed + sent, not on a tax invoice; fee and payer editable per case), tax invoices one per case or one per bank branch (borrower-paid cases always single), proformas for advances (converted to a tax invoice with the advance moved across), gap-free series per FY (`INV/{FY}/{N}`, `PI/…`, `CN/…`, next number settable), CGST+SGST or IGST by place of supply (branch GSTIN / state), total rounded with round-off, PDF with letterhead/signature/seal and UPI QR for the balance on borrower invoices, payments with TDS (default 10% of taxable for bank payers), part payments, credit notes (GST reversed; a full credit note can release cases to be billed again) and write-offs, ageing 0–30/31–60/61–90/90+, outstanding by party with reminder messages, GST charged / received / to collect by month, email with PDF and WhatsApp (wa.me link, logged). Stage: Sent → Billed on a tax invoice → Paid when every invoice covering the case is settled.
- **Accounting exports** for a period: Tally XML (sales, credit note, receipt vouchers; ledger names in Billing setup), Zoho Books CSV, invoices / receipts / credit notes CSV, GSTR-1 B2B, B2CS, CDNR and SAC summary CSVs, TDS by party (Form 26AS).
- **Engineer payouts**: submitted site visits per engineer per month × fee per visit (engineer's fee or default), marked paid with reference, CSV.
- **Reports & analytics**: reports per week, turnaround (created → sent) and time per stage, banks, localities, property types, engineers, FMV vs guideline; CSV per chart and all rows.
- **CSV imports** (Data import & export, preview then import): banks & branches, field engineers, comparable transactions, past valuation reports (both feed comparables); export in the same columns.
- Permissions: billing screens need `bill`; accounting exports and CSV exports need `exp`; imports need `set`; the bank account, UPI ID and PAN printed on invoices need `set` (so a billing-only user cannot redirect payments). CSV exports prefix text that starts with = + - @ so Excel does not run it as a formula.
- Wording for invoice emails and reminders is in the platform wording config (`invoice_bank`, `invoice_borrower`, `payment_reminder`).
- Fixed: text firm settings (place, UPI ID, changed number patterns) were read back as empty.
- Verified locally: 5 demo cases batch/single/proforma billed, payments with TDS, conversion, credit note release and rebill, stages Billed/Paid, every export generated, PDFs checked visually, imports with preview errors and re-import; 4 GST unit tests (15 total).

## 3b. Gate A review, phase 1 (23 Oct 2026, live)

Premal's review of 22 Oct (25 issues, 4 demo inputs, AI format conversion) is planned in `PLAN.md` (Gate A review). Phase 1 built:
- Earlier reports of the firm are guidance only: never in the evidence-backed rate or the printed range (rule `guidance_only_sources`, default `own_report`); a stale proposal is cleared when no evidence is left.
- Checks: low-confidence values get Confirm as read / Correct (check `acceptable: false`; also the default for cases pinned to older check sets); accepting any warning needs a listed reason or 15+ characters (check set `accept`); confirming a value is audited.
- Sign-off: pending count from the server with field names; Approve and sign asks for confirmation.
- SBI Format-A rev 3: annexure pages start with "page break before" (no blank page after a full page); annexure loop the same; pPr/rPr element order fixed for Word; ready reckoner page only when a page was captured.
- Documents marked ✕ (or n/a) close their fields as "Not provided" (not blocking, out of the legal documents list, printed as "Not provided"); wording can test `DOCSTATE.<TYPE>`; C.C. read from the agreement prints "(details as per agreement; copy not provided)".
- New check `rr_year` (ready reckoner year vs the report's financial year; expression function `fy()`).
- Billing: a credit note is written to each case's history; a fully credited invoice reads "Cancelled by credit note"; the Output tab lists it. (Case 0002 on live had a full credit note CN/26-27/0001, so its two invoices were correct.)
- Small: bank contact is a hint from the branch; visit links use unambiguous characters; link expiry in IST; photos without location read "Location removed (came via WhatsApp)"; Market tab window wording matches the code.

## 3c. Gate A review, phase 2: AI format conversion (23 Oct 2026)

- Upload (Bank formats) starts job `template.convert` (`modules/templates/aiconvert.ts`): the Word file as an outline with ids (`outline.ts`) plus the dictionary go to Claude in one structured call (effort high, ~1.5–2 min). The answer is checked (`check()`): cells and paragraphs must exist, field codes must exist or be proposed, bank-only fields get the bank's code (`NKGSB.CROPS`), sources limited to document types / site_sheet / manual, currency and units around money and area fields removed, overlapping ranges dropped.
- Mappings now carry a template (`location_json.template`, e.g. `{{CUST.NAME}}, {{CASE.BRANCH_NAME}}`), a status (match / new / needs / clear / fixed), section, note and the AI's question with choices. Slot kind `para` rewrites or removes paragraph ranges (earlier case text, earlier valuer identity, annexure sections with the earlier case's images; section bodies print a field).
- Compile: a single field prints its own tag; a template prints `TPL.<slot>` filled at render time (`codes.ts fillTemplate`: empty fields drop with their separator); paragraph ranges rewritten or removed (section properties kept); a single-field rewrite drops list numbering and justification; empty paragraphs at the end of the bank's text trimmed; images nothing references are removed from the package; author fields cleared; a bank footer that already numbers pages gets only the short signature.
- Review screen (`web/src/pages/FormatReview.tsx`): tiles, the bank's form as a list by section, details panel (what prints, where each value comes from, earlier text vs replacement), Accept all ready items (≥85% and cleared), answer the AI's questions, change a field, keep the bank's text; preview with a case (proposed fields show as "[New field: …]" or their default); the old table stays as "Advanced". Drafts made before the AI get "Read with the AI".
- Publish creates the proposed fields the version prints (firm-scoped; `origin_bank` for bank-only; default text as a derivation), adds site-sheet fields to the firm's profiles (new profile version), and deletes the uploaded original when earlier-case text was cleared (published versions render from the compiled file).
- Every field a format prints comes from `versionFieldCodes()` (checks, rendering, preview, field usage).
- Migration `0008_ai_formats.sql`. Tests: `test/aiformat.test.ts`. Dev helpers: `scripts/dev/t-aiformat.mts` (dry run), `t-aiformat-e2e.mts` (upload → publish → render a case), `t-aiformat-draft.mts`, `ui-format-review.mts`.
- Verified on the NKGSB Land & Building file (filled report of another firm): 56 questions found, 26 matched / 32 new fields first time (all matched on a second upload once the fields existed), 11–14 earlier-case items cleared (reference line, remarks, engineer line, valuer block, photographs, map, ready reckoner, comparables), 4–6 items below 85% to check, none needing a choice; rendered with a case: 13 pages, no earlier-case text or images, docx 5.6 MB → 0.9 MB.

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
| 11 Business | Fill in Billing setup on live (bank account, UPI ID, PAN, invoice note: needs admin or valuer); first live invoice test; validate Tally / Zoho / GSTR-1 files with a sample import (and the SAC code with the CA); verify the SES sender so email works; Quick Estimate conversion KPI in analytics |
| 12 Privacy | Consent flow for the shared pool |
| 13 Bank formats | AI conversion built (rename a proposed field before publishing, cost-approach block on the Valuation tab still to do); onboard SBI long, BoB, Union Bank, BoI, BoM, NKGSB, Federal, ValueMitra standard (need templates from Premal) |
| 14 Land & bungalow | Everything, tuned with sample cases |

Gates: A built (AI reading live; first real pilot case next) → B all property types → C all banks + months 0–3 learning targets → D second firm by configuration only.

## 5. Next actions

1. Internal testing with the team brief; triage feedback (config change vs code change).
2. First real pilot case (Gate A); measure how many auto-filled fields are accepted without edit (target 85%).
3. Billing on live: fill in Billing setup (admin or valuer), raise a first invoice from a sent case, record a payment, try the exports. Verify the SES sender identity (`no-response@valuemitra.com`) in AWS so report, invoice and reminder emails go out (needed before item 2 too).
4. Collect bank templates and land/bungalow samples from Premal → Gates B and C.
5. Turn 2FA back on (`REQUIRE_2FA=true`) before real firms use the live site.

## 6. Runbook

- Deploy: `ssh … "cd /var/www/valuemitra-v2 && bash infrastructure/scripts/deploy.sh"` (pull, build, migrate, platform seed, PM2 reload, health check) — or `/valuemitra-ec2 deploy`.
- Schema change: new `apps/api/migrations/000N_*.sql` → `npm run db:migrate -w apps/api` → `sh apps/api/scripts/db-types.sh`.
- Platform dictionary/config change: edit `apps/api/src/seed/{fields,config}.ts`; the seed (also run by deploy.sh) adds new fields, versions changed fields, and publishes a changed configuration as a new version. Cases keep the versions they pinned. Firm-specific changes go through Master data / Firm settings.
- New firm: `npm run firm:create -w apps/api -- --code ABC --name "…" --admin-name … --admin-email … --admin-password …`.
- Local reset (wipes data): `npm run db:reset -w apps/api`.
- Dev helpers live in `apps/api/scripts/dev/` (gitignored, local only): `e2e-pilot.mts` (pilot case end to end without AI; run with `RUN_JOBS=false`), `t-kyc.mts`, `ui-shots.mts` (Playwright screenshots via installed Chrome), `smoke.sh`, `t-billing.mts` (billing flow against the dev API: `send`, `setup`, `flow`, `files`, `mail <to>`), `ui-billing.mts` (billing / analytics / data screenshots), `q.mts` (ad-hoc SQL through the app's DB config).
- Logs on EC2: `pm2 logs valuemitra-v2`, `/var/log/valuemitra-v2/`.

## 7. Known issues and notes

- Email: Amazon SES rejects `no-response@valuemitra.com` (identity not verified in ap-south-1) locally and on EC2, so report, invoice and reminder emails fail with that message until the address or the domain is verified in SES (and, if SES is in sandbox, the recipients too).
- WhatsApp has no sending API: invoices and reminders open in WhatsApp with the text; the app records that it was sent.

- AI reading: handwritten entries come with low confidence (check `low_confidence` lists them); a 26-page bundle takes 1–3 minutes. A document left mid-read by a restart is requeued automatically.
- HEIC photos refused (sharp cannot decode); WhatsApp-forwarded photos lose GPS so the map page is skipped.
- The audit log is append-only in code; DB triggers not applied on EC2 (no root via `sudo mysql`).
- Every commit gets an automated security review; findings so far were fixed (tenant isolation, upload sniffing, platform templates, KYC redaction and locking, TOTP input).
- `storage/` in the local repo holds old test files from earlier resets (gitignored; safe to delete by hand).
