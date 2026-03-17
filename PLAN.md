# ValueMitra — Course Correction Plan

> **Last updated**: 2026-03-07
> **Status**: Phase 0 COMPLETE ✅ | Phase 1 IN PROGRESS

---

## Decision: Course-Correct, NOT Rebuild

The existing build's infrastructure is sound and aligned with the new vision:
- Multi-tenancy, auth/RBAC, assignment lifecycle, document+OCR pipeline ✅
- Government rate scraping (Maharashtra IGR + Gujarat Jantri) ✅
- Job queue, audit logs, report generation (21 bank templates) ✅
- Deployment (EC2 + Nginx + PM2 + GitHub Actions) ✅

**What's wrong**: The data model is too coarse-grained. The `Property` and `Inspection` DB models lack the ~200 canonical parameters defined in the new product spec.

---

## Confirmed Decisions

| Decision | Choice |
|---|---|
| Rebuild vs refactor | **Refactor existing build** |
| Property types | **All 6 simultaneously** (Flat, Shop, Office, Open Land, L&B, UC Flat) |
| Mobile app | **Web only** — no mobile app; INS_001–062 fields via web UI, manual photo/GPS upload |
| Prod DB | **All test data** — safe to `db push` without migration scripts |
| Bank label mapping | **Hardcoded constants** initially (not configurable in admin UI) |
| UC construction stages | **Individual DB columns** (not JSON) — already implemented in Phase 0 |
| Photo categories | **`photoCategory` tag on Document model** — already implemented in Phase 0 |
| OCR fields | **Editable/manually modifiable** by valuer post-extraction |

---

## Phased Refactor Roadmap

### ✅ Phase 0 — Database Schema Expansion (COMPLETE)

All 200+ canonical param fields are now in the DB:
- `Property` model: Added ~50 new fields (LOC, OWN, AREA, PHY, LND, BND, BLDG, UNIT, BLDA sections)
- `Inspection` model: Added ~48 new fields (INS_003–050, 12 UC stage columns, broker details, site measurements)
- `Assignment` model: Added `loanType`, `propertySubType`, `bankBranchAddress`, `bankRepresentative`
- `Document` model: Added `photoCategory String? @db.VarChar(50)`
- New enums: `PhotoCategory`, `LoanType`, `ConstructionStageStatus`, `LiftInstallationStatus`, `BuildingCompletionStatus`
- `prisma db push` succeeded, both API and web type-checks pass

---

### 🔄 Phase 1 — Frontend Tab Refactor (IN PROGRESS)

**Goal**: Replace the monolithic AssignmentDetailPage (2,722 lines, 7 fixed tabs) with dynamic, property-type-specific tab sets.

#### Target Tab Sets Per Property Type

| Property Type | Tabs |
|---|---|
| RESIDENTIAL_FLAT | General, Owner, Documents, Location, Area, Building, Unit, Site Visit, Valuation, Marketability, Report (11) |
| COMMERCIAL_SHOP | General, Owner, Documents, Location, Area, Building, Unit, Site Visit, Valuation, Marketability, Report, Annexures (12) |
| COMMERCIAL_OFFICE | General, Owner, Documents, Location, Area, Building, Unit, Site Visit, Valuation, Marketability, Report (11) |
| OPEN_LAND | General, Owner, Documents, Location, Area, Physical, Land, Boundary, Site Visit, Valuation, Marketability, Report, Annexures (13) |
| LAND_AND_BUILDING | General, Owner, Documents, Location, Area, Physical, Land, Boundary, Building, Unit, External Dev, Site Visit, Valuation, Marketability, Report, Annexures (17) |
| UC_FLAT | General, Owner, Documents, Location, Area, Building, Unit, Site Visit (+ UC Stages), Valuation, Marketability, Report, Annexures (13) |

#### Section → API Mapping

| Section | API | Model |
|---|---|---|
| General | `PATCH /api/assignments/:id/general` (**NEW**) | Assignment |
| Owner, Location, Area, Physical, Land, Boundary, Building, Unit, External Dev | `PATCH /api/property-data/:id` | Property |
| Documents | Existing | Document |
| Site Visit | `PATCH /api/inspections/:id` | Inspection |
| Valuation, Marketability | Existing valuation endpoints | ValuationRun |
| Report, Annexures | Existing reports endpoints | Report |

#### Implementation Steps

1. **Add UC_FLAT to PropertyType enum** (`packages/shared/src/types/enums.ts`)
2. **Create tab config** (`apps/web/src/lib/assignment-tabs.ts`) — `PROPERTY_TYPE_TABS` record
3. **Expand SavePropertyDataSchema** — add OWN (ownerAddress, ownerContact, ownerPan, borrowerName), LOC (streetName, district, lat/lng), LND (landAreaAcre/Hectare, leaseExpiryDate), BLDG (buildingCompletionStatus, roofType, exteriorCondition), BLDA (externalDevAreaSqM/SqFt, industrialStructures)
4. **Backend: Add PATCH /assignments/:id/general** — saves GEN fields (loanType, propertySubType, bankBranchAddress, bankRepresentative, freshOrRevaluation, bankRefNo, bankInstructionDate, agreedFee, feeGst)
5. **Frontend hook**: `useUpdateGeneralFields()` in `useAssignments.ts`
6. **Build section components** in `apps/web/src/components/assignment/sections/`:
   - `GeneralSection.tsx` (GEN_001–012)
   - `OwnerSection.tsx` (OWN_001–008)
   - `LocationSection.tsx` (LOC_001–017)
   - `AreaSection.tsx` (AREA_001–006)
   - `PhysicalSection.tsx` (PHY_001–012)
   - `LandSection.tsx` (LND_001–008)
   - `BoundarySection.tsx` (BND_001–008)
   - `BuildingSection.tsx` (BLDG_001–016)
   - `UnitSection.tsx` (UNIT_001–014)
   - `ExternalDevSection.tsx` (BLDA_001–006)
   - `SiteVisitSection.tsx` (INS_001–050 + photo upload grid)
7. **Refactor AssignmentDetailPage** — dynamic tabs + import section components

---

### Phase 2 — Valuation Logic Expansion (TODO)

- **L&B**: Split into VALUATION-LAND, VALUATION-BUILDING, VALUATION-EXTERNAL DEV, TOTAL sub-tabs
- **UC Flat**: UC method with dual-value (current vs 100% completion), RERA compliance
- **Open Land**: Land-only valuation

---

### Phase 3 — Report Data Mapping (TODO)

- Create `packages/shared/src/constants/param-bank-labels.ts` — canonical ID → per-bank label map
- Update `report-data.builder.ts` to use canonical params
- Update .docx templates for new fields

---

## Starting Point When Resuming

1. Phase 0 is done. Check `apps/api/prisma/schema.prisma` to confirm current DB state.
2. Phase 1 is in progress — check which section components exist in `apps/web/src/components/assignment/sections/`
3. The dynamic tab refactor is in `apps/web/src/pages/assignments/AssignmentDetailPage.tsx`
4. `apps/web/src/lib/assignment-tabs.ts` drives which tabs appear for each property type
