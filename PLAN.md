# ValueMitra v2 — Build Plan (Milestone 1: Gate A)

Sources: *ValueMitra — Product Design Document (Phase 1)*, *ValueMitra_Prototype_v2.html*, *Prototype Testing Guide*.
Nothing is carried over from the v1 codebase except the MySQL database (which is replaced).

## Decisions
| Area | Choice |
|---|---|
| Database | MySQL 8 only. Replaces the `valuemitra` DB (local AMPPS + EC2) at cut-over |
| API | Node 20 + TypeScript + Fastify, Kysely (typed SQL) + versioned SQL migrations, Zod |
| Web | React 18 + Vite + Tailwind + TanStack Query, prototype's visual language |
| Jobs | MySQL-backed job queue (OCR, extraction, rendering) with retry |
| AI | Google Vision OCR → Claude for classify / split / extract (field, value, page, snippet, confidence) behind an adapter |
| Reports | Word template filled by the template engine → LibreOffice → PDF |
| Repo | Old main tagged `v1-legacy`; fresh history on main of mehulno1/valuemitra |
| Deploy | New folder + port on the same EC2, then switch vmapps.techsahyogi.com |

## Gate A scope: one SBI Format-A flat case signed end to end
1. **WP1 Platform.** Firms (tenants), users, roles (Coordinator, Valuer, Accounts, Admin), per-action permissions, 2FA for valuer and admin, audit log, file storage per firm, events, feature flags, the config versioning framework.
2. **WP2 Master data and admin.** Canonical field dictionary (stable IDs such as `AREA.BUA`), property profile for flat, versioned rule sets per bank (loading, realizable/distress %, rounding, 20% trigger), checks, banks and branches, ready reckoner import.
3. **WP3 Assignments and documents.**
   - Case ID `VM-{FY}-{NNNN}`, stages, board, alerts.
   - Upload, PDF splitting, auto-labels with correction, checklist, KYC excluded, "seen before" matching.
4. **WP4 Extraction.** Values with source page, snippet and confidence; inline edits; conflicts; corrections recorded for the learning system.
5. **WP5 Template engine.** Upload, detect, auto-map, confirm, preview, publish an immutable version, pin it per case. SBI Format-A is rebuilt from the prototype's report pages.
6. **WP6 Site visit.** Signed, expiring engineer link; typed sheet read into fields; photo checks; 9–18 photo selection; captions.
7. **WP7 Evidence and valuation.** Ready reckoner lookup, comparables, adjustments, weighted proposal with range; FMV, realizable, distress, guideline, insurable and rental values; override with a reason.
8. **WP8 Checks, sign-off, output.**
   - Check engine with severities that blocks signing.
   - Live draft with in-place edits and valuer-only signing.
   - Report no. `{FIRM}/{BANK}/{BRANCH}/{FY}/{NNNN}`, given at signing; reopening adds `/R1`.
   - DOCX and PDF output, dispatch, report register.

Next milestones: Quick Estimate, billing and payouts, analytics, CSV import/export, retention and privacy, other property types and banks (Gates B–D).

## Prototype gaps and how they are resolved
- **Proposed rate:** weighted median of the adjusted comparables, filtered to the last 6 months (configurable) and 1–2 km.
- **20% guideline variation:** checked in both directions.
- **Realizable and distress %:** taken from each bank's rule version.
- **GST:** IGST when the place of supply is in another state.
- **Stages:** New → Awaiting documents → Site visit → Drafting → Ready for review → Signed → Sent → Billed → Paid.
- **Report numbering:** the serial is per firm per financial year; the bank and branch codes come from the case.

## Status
See `docs/STATUS.md` for what is built, what is left by work package, environments and the runbook.
