# ValueMitra v2 — notes for Claude

Read docs/STATUS.md first (built / left / environments / runbook), then README.md. Specs: `PLAN.md`; product design document and prototype are the source of truth
for behaviour. The v1 codebase is not used for anything (only its database was replaced).

## Rules

- MySQL only. Schema changes = a new file in `apps/api/migrations/` (never edit an applied migration once
  deployed), then `sh apps/api/scripts/db-types.sh` to regenerate `src/db/types.ts`. Avoid MySQL reserved
  words as column names (`last_value` bit us).
- Tenancy: every case-scoped service checks `firm_id` (use `assertCase` / `loadCase`). Never trust an id
  from the URL without a firm check. Platform rows have `firm_id IS NULL`; firms never modify them.
- Business behaviour belongs in configuration (dictionary, rule set, checks, wording, profiles), not code.
  Expressions use `packages/shared/src/expr.ts`; identifiers resolve with own-property lookups only.
- Audit log is append-only. Every user-visible action writes an `audit()` row with a plain summary.
- Uploads are accepted by content (`lib/sniff.ts`), never by name or browser MIME.
- AI calls go through `src/ai/claude.ts` (structured output via Zod, server-side refusal fallback) and
  `src/ai/vision.ts`. Default model `claude-opus-5-5`.
- Template tags use `⟪ ⟫` delimiters; each tag must sit in its own run (image module requirement).
  Header/footer part names must not contain underscores (image module derives rels names from them).

## Running

- `npm run dev -w apps/api` (tsx watch, port 3010) and `npm run dev -w apps/web` (5173, proxies /api).
- Demo logins after seeding: valuer@ / coordinator@ / accounts@ / admin@demo.valuemitra.in.
- Tests: `cd apps/api && npx vitest run`.
- Dev scripts that need the API package's modules go in `apps/api/scripts/dev/` (gitignored).

## Environment

- Local MySQL is AMPPS; EC2 is 13.200.199.101 (see the valuemitra-ec2 skill). EC2's `~/.my.cnf` points at
  another user — use `--defaults-file` when scripting mysql there.
- LibreOffice on this Mac: `/Applications/LibreOffice.app/Contents/MacOS/soffice`.
