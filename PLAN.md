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

## After Gate A
| Package | State |
|---|---|
| **WP11 Business modules** | Built and live (21 Oct 2026): billing to payment (per-case and batch GST invoices, proformas, payments with TDS, credit notes, write-offs, ageing, reminders, GST tracking), engineer payouts, accounting exports (Tally, Zoho, CSV, GSTR-1, TDS), analytics, CSV imports. Left: validate export files with a sample import, confirm SAC with the CA, verified SES sender for email. |
| WP10 Quick Estimate | Next to build |
| WP13 Bank formats, WP14 Land & bungalow | Waiting for templates and sample cases from Premal (Gates B and C) |
| WP9 Learning, WP12 Privacy (shared pool consent) | Later, with the months 0–3 learning targets (Gate C) |

Billing decisions: billing is optional per firm (feature flag); a report is billable once signed and sent; batch = one invoice per bank branch for bank-paid cases; place of supply from the branch GSTIN (else its state) decides CGST+SGST vs IGST; totals rounded to the rupee; a case is Paid when every tax invoice covering it is settled (payments + TDS + credit notes + write-offs); a full credit note can release cases to be billed again; WhatsApp opens a prepared message (no sending API).

## Gate A review (Premal, 22 Oct 2026) — plan
Review: 25 issues (8 high), 4 demo inputs from valuer Manoj Sharma, and AI conversion for bank formats.

| Phase | Scope | State |
|---|---|---|
| 1 Sign-off safety | High issues #1–#8 (earlier reports as guidance only, low-confidence confirm/correct, reasons for accepting, server pending count and sign confirmation, no blank pages or empty ready reckoner page, "Not provided" documents, C.C. wording, ready reckoner year check, credit-note visibility) and #10, #19, #20, #23, WhatsApp flag wording | Built and live 23 Oct 2026; Premal to retest |
| 2 AI format conversion | Upload a blank template or a past report; AI maps each question by meaning to the shared dictionary, creates missing fields (bank-only ones tagged to the bank), finds grids and text sections, clears the earlier case and valuer identity; review screen (matched / new / needs you / cleared), accept-all ≥85%, preview, publish adds site-sheet questions to the engineer checklist. Test file: NKGSB Land & Building | Next (~5–7 days) |
| 3 Demo inputs | Area basis per case worked out from any stated area by the bank's factors (stated beats worked out, measured never converted), rate per sq.ft. or sq.m., map screenshot found automatically in any picture, per-bank values for every rule (#18) | After phase 2 (~3 days) |
| 4 Remaining issues | #9 outliers, #11 date checks, #12 parking prefill, #13 name/abbreviation matching, #14 true source, #15 preview final PDF, #16 structured rate reasons, #17 status chip, #21 page numbering, #22 document types, #24 checklist from photos, #25 seen-before message | After phase 3 (~3 days) |

Decisions: earlier reports of the firm never set the rate or the printed range (rule `guidance_only_sources`); low-confidence values are confirmed or corrected, never accepted; a reissued report on a billed case still needs a full credit note first (accounting stays correct), and the cancellation now shows on the case. Shared field list grown by the AI; promotion of a bank-only field to the shared list is confirmed by an admin. Inputs needed from Premal: 2026-27 MMR ready reckoner, consent to store other valuers' reports for testing, more bank templates or past reports.

## Prototype gaps and how they are resolved
- **Proposed rate:** weighted median of the adjusted comparables; the last 6 months preferred (configurable), older ones up to 12 months used with a warning; the firm's earlier reports are guidance only. Distance filter waits for a maps key.
- **20% guideline variation:** checked in both directions.
- **Realizable and distress %:** taken from each bank's rule version.
- **GST:** IGST when the place of supply is in another state (place of supply = the bank branch's GSTIN state, else its state code).
- **Stages:** New → Awaiting documents → Site visit → Drafting → Ready for review → Signed → Sent → Billed → Paid.
- **Report numbering:** the serial is per firm per financial year; the bank and branch codes come from the case.

## Status
See `docs/STATUS.md` for what is built, what is left by work package, environments and the runbook.
