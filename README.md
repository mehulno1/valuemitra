# ValueMitra v2

Multi-firm SaaS that runs a valuer firm's lifecycle for bank property valuations: assignment intake,
documents read with source and confidence, site visit by link, market evidence, valuation, checks,
valuer sign-off, bank-format Word and PDF report, dispatch. Built from the *Product Design Document
(Phase 1)* and the clickable prototype; Milestone 1 is Gate A — one SBI Format-A flat case signed end to end.

Status, environments and what is left: [docs/STATUS.md](docs/STATUS.md).

## Stack

| Part | Choice |
|---|---|
| Database | MySQL 8 (plain SQL migrations in `apps/api/migrations`) |
| API | Node 22, TypeScript, Fastify, Kysely, Zod |
| Web | React 18, Vite, TanStack Query, Tailwind (prototype design tokens) |
| Reading | Google Vision OCR → Claude (`claude-opus-5-5`) structured extraction |
| Reports | Bank Word template → docxtemplater → LibreOffice → PDF |
| Jobs | MySQL job table + in-process worker; daily retention task |

## Layout

```
apps/api      Fastify API, job worker, migrations, seed (dictionary, configuration, SBI Format-A)
apps/web      React app (board, case workspace, bank formats, settings, master data, engineer link)
packages/shared  formatting (lakh/crore, words), domain vocabulary, the configuration expression language
infrastructure   nginx, pm2, setup and deploy scripts, privileged MySQL triggers
```

## Local development

```bash
cp .env.example .env            # fill DB, secrets, keys
npm install
npm run db:migrate -w apps/api   # add --reset only to wipe the database
npm run db:seed -w apps/api      # platform data + demo firm (password from SEED_PASSWORD)
npm run dev -w apps/api          # http://localhost:3010
npm run dev -w apps/web          # http://localhost:5173
npx vitest run --root apps/api   # unit tests
```

Requires LibreOffice (`SOFFICE_PATH`) and poppler's `pdftoppm` (`PDFTOPPM_PATH`).

## How it fits together

- **Canonical dictionary** (`canonical_fields`): every fact a report needs, by stable ID (`AREA.BUA`), with
  sources in priority order, derivation, validation and aliases. New fields and versions ship without a release.
- **Versioned configuration** (`config_versions`): property profiles, the valuation rule set (per-bank
  realizable/distress %, loading, adjustments, thresholds), checks, wording and document types. Published
  versions are immutable and each case pins the versions it was created with.
- **Case resolver** (`modules/casedata/resolver.ts`): resolves every field for a case from its sources,
  derivations and wording, with provenance, pending reasons and conflicts. Extracted details, checks and
  reports all read this one view.
- **Template engine** (`modules/templates`): upload a bank's Word file → detect labels / table cells /
  placeholders → auto-map to the dictionary (label similarity, section context, past confirmations) →
  confirm → publish an immutable compiled version. Rendering fills the bank's own file.
- **Learning loop**: every accept/edit, label correction, rate override, check acceptance and mapping
  confirmation is stored in `feedback_events`; every signed report becomes a firm comparable.
- **Billing** (`modules/billing`, optional per firm): invoices are immutable once issued; credit notes and
  write-offs reduce them. Each invoice keeps a snapshot of the firm's details as on its date. The case stage
  follows its tax invoices (Sent → Billed → Paid). Exports and the invoice PDF are built from the same rows.
- **Numbering**: case IDs at creation (`VM-{FYC}-{N}`); report numbers only at sign-off, gap-free per firm
  and FY (`{FIRM}/{BANK}/{BRANCH}/{FY}/{N}`); a reissue keeps the serial and adds `/R1`. Invoices, proformas and credit notes have their own gap-free
  series per FY (`INV/{FY}/{N}`, `PI/…`, `CN/…`).

## Deploy (EC2)

See `infrastructure/scripts/setup.sh` (once) and `infrastructure/scripts/deploy.sh` (every release).
Apply `infrastructure/mysql/audit_triggers.sql` as MySQL root after the first migration.
