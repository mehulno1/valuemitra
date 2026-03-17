import { prisma } from '../../config/database.js';
import { NotFoundError, AppError, ForbiddenError } from '../../middleware/error.middleware.js';
import { computeCostApproach } from './engines/cost-approach.engine.js';
import { computeMarketComparison } from './engines/market-comparison.engine.js';
import { computeIncomeApproach } from './engines/income-approach.engine.js';
import { ValuationApproach } from '@valuemitra/shared';
import type {
  CreateValuationRunInput,
  UpdateMarketComparisonInput,
  UpdateCostApproachInput,
  UpdateIncomeApproachInput,
  FinalizeValuationInput,
} from '@valuemitra/shared';

// ─────────────────────────────────────────────
// Rounding
// ─────────────────────────────────────────────

/** Standard Indian valuation rounding: ≤₹1 Cr → nearest ₹50,000; >₹1 Cr → nearest ₹1,00,000 */
function roundFMV(value: number): number {
  const ONE_CRORE = 10_000_000;
  if (value <= ONE_CRORE) {
    return Math.round(value / 50_000) * 50_000;
  }
  return Math.round(value / 100_000) * 100_000;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

async function assertAssignmentAccess(assignmentId: string, tenantId: string) {
  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, tenantId },
    include: { property: true },
  });
  if (!assignment) throw new NotFoundError('Assignment');
  return assignment;
}

async function getRunOrThrow(id: string, tenantId: string) {
  const run = await prisma.valuationRun.findFirst({
    where: { id, assignment: { tenantId } },
    include: { assignment: true },
  });
  if (!run) throw new NotFoundError('Valuation run');
  if (run.isFinalized) throw new AppError(409, 'This valuation run is already finalized and cannot be modified');
  return run;
}

// ─────────────────────────────────────────────
// Delete a (non-finalized) ValuationRun
// ─────────────────────────────────────────────

export async function deleteValuationRun(id: string, tenantId: string) {
  const run = await prisma.valuationRun.findFirst({
    where: { id, assignment: { tenantId } },
  });
  if (!run) throw new NotFoundError('Valuation run');
  if (run.isFinalized) throw new AppError(409, 'Cannot delete a finalized valuation run');
  await prisma.valuationRun.delete({ where: { id } });
}

// ─────────────────────────────────────────────
// Create a new ValuationRun
// ─────────────────────────────────────────────

export async function createValuationRun(input: CreateValuationRunInput, tenantId: string, userId: string) {
  await assertAssignmentAccess(input.assignmentId, tenantId);

  // Count existing versions for this assignment
  const existingCount = await prisma.valuationRun.count({
    where: { assignmentId: input.assignmentId },
  });

  const run = await prisma.valuationRun.create({
    data: {
      assignmentId: input.assignmentId,
      approach: input.approach,
      version: existingCount + 1,
      computedById: userId,
    },
  });

  return run;
}

// ─────────────────────────────────────────────
// List runs for an assignment
// ─────────────────────────────────────────────

export async function listValuationRuns(assignmentId: string, tenantId: string) {
  await assertAssignmentAccess(assignmentId, tenantId);
  return prisma.valuationRun.findMany({
    where: { assignmentId },
    orderBy: { version: 'desc' },
  });
}

// ─────────────────────────────────────────────
// Get single run
// ─────────────────────────────────────────────

export async function getValuationRun(id: string, tenantId: string) {
  const run = await prisma.valuationRun.findFirst({
    where: { id, assignment: { tenantId } },
  });
  if (!run) throw new NotFoundError('Valuation run');
  return run;
}

// ─────────────────────────────────────────────
// Update — Market Comparison
// ─────────────────────────────────────────────

export async function updateMarketComparison(
  id: string,
  tenantId: string,
  input: UpdateMarketComparisonInput,
) {
  const run = await getRunOrThrow(id, tenantId);
  const assignment = await prisma.assignment.findUnique({
    where: { id: run.assignmentId },
    include: { property: true },
  });
  // Pick the right area: land properties use landArea, others use builtUpArea
  const LAND_TYPES = ['OPEN_LAND', 'AGRICULTURAL_LAND', 'RESIDENTIAL_PLOT', 'INDUSTRIAL_PLOT'];
  const propertyType = assignment?.propertyType ?? '';
  const isLandType = LAND_TYPES.includes(propertyType);
  const areaSqM = isLandType
    ? Number(assignment?.property?.landAreaActualSqM ?? assignment?.property?.landAreaSqM ?? 0)
    : Number(assignment?.property?.builtUpAreaActualSqM ?? assignment?.property?.builtUpAreaSqM ?? 0);
  const subjectAreaSqFt = areaSqM * 10.764;

  // Only run market computation when comparables are provided
  const hasComparables = input.comparables.length > 0;
  const result = hasComparables
    ? computeMarketComparison(input.comparables, subjectAreaSqFt, input.correlatedValue)
    : null;

  return prisma.valuationRun.update({
    where: { id },
    data: {
      ...(result && {
        comparables: result.comparables as unknown as object,
        adjustedValues: { min: result.minAdjustedRate, max: result.maxAdjustedRate, avg: result.simpleAvgRate } as unknown as object,
        correlatedValue: String(result.correlatedValue),
        inputSnapshot: { marketComparison: { input, result } } as unknown as object,
        computedAt: new Date(),
      }),
      // Market analysis fields (MKT_009-012) — always saved
      marketabilityRating: input.marketabilityRating ?? null,
      positiveFactors: input.positiveFactors || null,
      negativeFactors: input.negativeFactors || null,
      marketAnalysisNarrative: input.marketAnalysisNarrative || null,
    },
  });
}

// ─────────────────────────────────────────────
// Update — Cost Approach (auto-compute on save)
// ─────────────────────────────────────────────

export async function updateCostApproach(
  id: string,
  tenantId: string,
  rawInput: UpdateCostApproachInput,
) {
  const run = await getRunOrThrow(id, tenantId);

  // For flat property types: if landArea not explicitly provided, use UDS area from property
  const FLAT_TYPES = ['RESIDENTIAL_FLAT', 'UC_FLAT', 'COMMERCIAL_SHOP', 'COMMERCIAL_OFFICE', 'COMMERCIAL_SHOWROOM'];
  // For land-type properties: adoptedLandArea = MIN(doc area, actual area) per BOB/standard rules
  const LAND_TYPES = ['OPEN_LAND', 'AGRICULTURAL_LAND', 'RESIDENTIAL_PLOT', 'INDUSTRIAL_PLOT'];
  let input = rawInput;

  if (!input.landArea) {
    if (FLAT_TYPES.includes(run.assignment.propertyType)) {
      // Use UDS area as land component for flat valuations
      const property = await prisma.property.findUnique({
        where: { assignmentId: run.assignmentId },
        select: { udsArea: true, udsUnit: true },
      });
      if (property?.udsArea) {
        const udsAreaNum = Number(property.udsArea);
        const udsUnit = property.udsUnit ?? 'Sq.M';
        const udsAreaSqM = (udsUnit === 'Sq.Ft' || udsUnit === 'SqFt') ? udsAreaNum / 10.764 : udsAreaNum;
        input = { ...input, landArea: Math.round(udsAreaSqM * 1000) / 1000 };
      }
    } else if (LAND_TYPES.includes(run.assignment.propertyType)) {
      // Use MIN(doc area, actual area) for open land types — store result on Property for audit
      const property = await prisma.property.findUnique({
        where: { assignmentId: run.assignmentId },
        select: { landAreaSqM: true, landAreaActualSqM: true },
      });
      if (property) {
        const docSqM = property.landAreaSqM ? Number(property.landAreaSqM) : null;
        const actualSqM = property.landAreaActualSqM ? Number(property.landAreaActualSqM) : null;
        const adoptedSqM = docSqM !== null && actualSqM !== null
          ? Math.min(docSqM, actualSqM)
          : (actualSqM ?? docSqM ?? null);
        if (adoptedSqM !== null) {
          const adoptedSqFt = Math.round(adoptedSqM * 10.764 * 100) / 100;
          await prisma.property.update({
            where: { assignmentId: run.assignmentId },
            data: {
              adoptedLandAreaSqM: String(adoptedSqM),
              adoptedLandAreaSqFt: String(adoptedSqFt),
            },
          });
          input = { ...input, landArea: adoptedSqM };
        }
      }
    }
  }

  const result = computeCostApproach(input);

  // Compute govt guideline value = RR rate × land area (if both provided)
  // L&B: govtGuidelineValue = (landArea × rrLandRate) + (buildingArea × rrBuildingRate)
  const rrRatePerSqM = input.rrRatePerSqM;
  const rrRatePerSqFt = rrRatePerSqM != null ? rrRatePerSqM / 10.764 : undefined;
  const rrBuildingRatePerSqM = input.rrBuildingRatePerSqM;
  const rrBuildingRatePerSqFt = rrBuildingRatePerSqM != null
    ? (input.rrBuildingRatePerSqFt ?? rrBuildingRatePerSqM / 10.764)
    : undefined;
  const landAreaForGovt = input.landArea;
  const isLandAndBuilding = run.assignment.propertyType === 'LAND_AND_BUILDING';
  const govtGuidelineValue =
    rrRatePerSqM != null && landAreaForGovt != null
      ? isLandAndBuilding && rrBuildingRatePerSqM != null && result.buildingPlinthArea > 0
        ? (rrRatePerSqM * landAreaForGovt) + (rrBuildingRatePerSqM * result.buildingPlinthArea)
        : rrRatePerSqM * landAreaForGovt
      : undefined;

  // Total cost approach value includes external development value if provided
  const extDev = input.externalDevelopmentValue ?? 0;
  const totalCostValue = result.costApproachValue + extDev;

  return prisma.valuationRun.update({
    where: { id },
    data: {
      landValue: String(result.landValue),
      landRateUsed: String(result.landRatePerSqM),
      landRateSource: input.landRateSource,
      landGovtRateId: input.landGovtRateId,
      buildingPlinthArea: String(result.buildingPlinthArea),
      buildingRatePerSqM: String(result.buildingRatePerSqM),
      replacementCost: String(result.replacementCost),
      depreciationMethod: result.depreciationMethod,
      depreciationRate: String(result.depreciationRate),
      depreciationAmount: String(result.depreciationAmount),
      depreciatedValue: String(result.depreciatedValue),
      servicesCost: String(result.servicesCost),
      costApproachValue: String(totalCostValue),
      // Government rate fields
      rrRatePerSqM: rrRatePerSqM != null ? String(rrRatePerSqM) : undefined,
      rrRatePerSqFt: rrRatePerSqFt != null ? String(rrRatePerSqFt) : undefined,
      rrRateYear: input.rrRateYear ?? undefined,
      rrBuildingRatePerSqM: rrBuildingRatePerSqM != null ? String(rrBuildingRatePerSqM) : undefined,
      rrBuildingRatePerSqFt: rrBuildingRatePerSqFt != null ? String(rrBuildingRatePerSqFt) : undefined,
      govtGuidelineValue: govtGuidelineValue != null ? String(govtGuidelineValue) : undefined,
      // External development
      externalDevelopmentValue: extDev > 0 ? String(extDev) : undefined,
      inputSnapshot: { costApproach: { input, result } } as unknown as object,
      computedAt: new Date(),
    },
  });
}

// ─────────────────────────────────────────────
// Update — Income Approach (auto-compute on save)
// ─────────────────────────────────────────────

export async function updateIncomeApproach(
  id: string,
  tenantId: string,
  input: UpdateIncomeApproachInput,
) {
  await getRunOrThrow(id, tenantId);
  const result = computeIncomeApproach(input);

  return prisma.valuationRun.update({
    where: { id },
    data: {
      grossRent: String(result.grossRentAnnual / 12),   // store monthly
      vacancyRate: String(input.vacancyRate),
      effectiveGrossIncome: String(result.effectiveGrossIncome),
      operatingExpenses: String(result.operatingExpenses),
      netOperatingIncome: String(result.netOperatingIncome),
      capitalizationRate: String(result.capitalizationRate),
      incomeApproachValue: String(result.incomeApproachValue),
      inputSnapshot: { incomeApproach: { input, result } } as unknown as object,
      computedAt: new Date(),
    },
  });
}

// ─────────────────────────────────────────────
// Finalize — compute weighted value, lock run
// ─────────────────────────────────────────────

export async function finalizeValuationRun(
  id: string,
  tenantId: string,
  input: FinalizeValuationInput,
) {
  const run = await getRunOrThrow(id, tenantId);

  // Collect available approach values
  const marketVal = run.correlatedValue ? Number(run.correlatedValue) : null;
  const costVal = run.costApproachValue ? Number(run.costApproachValue) : null;
  const incomeVal = run.incomeApproachValue ? Number(run.incomeApproachValue) : null;

  let weightedValue: number;
  const mw = input.marketApproachWeight ?? 0;
  const cw = input.costApproachWeight ?? 0;
  const iw = input.incomeApproachWeight ?? 0;
  const totalWeight = mw + cw + iw;

  // Validate: market approach requires at least 3 comparable transactions
  const willUseMarketValue = mw > 0 || (totalWeight === 0 && marketVal !== null);
  if (willUseMarketValue) {
    const comparables = run.comparables as Array<unknown> | null;
    const comparableCount = Array.isArray(comparables) ? comparables.length : 0;
    if (comparableCount < 3) {
      throw new AppError(422, `Market comparison approach requires at least 3 comparable transactions. Only ${comparableCount} entered. Add more comparables before finalizing.`);
    }
  }

  if (totalWeight > 0) {
    // Weighted average — only count weights for approaches that have a computed value
    const effectiveNumerator =
      (marketVal !== null ? marketVal * mw : 0) +
      (costVal   !== null ? costVal   * cw : 0) +
      (incomeVal !== null ? incomeVal * iw : 0);
    const effectiveDenominator =
      (marketVal !== null ? mw : 0) +
      (costVal   !== null ? cw : 0) +
      (incomeVal !== null ? iw : 0);
    if (effectiveDenominator === 0) throw new AppError(422, 'No approach values computed yet — update at least one approach before finalizing');
    weightedValue = roundFMV(effectiveNumerator / effectiveDenominator);
  } else {
    // Auto: use the single available value, or average of all computed
    const available = [marketVal, costVal, incomeVal].filter((v): v is number => v !== null);
    if (available.length === 0) throw new AppError(422, 'No approach values computed yet — update at least one approach before finalizing');
    weightedValue = roundFMV(available.reduce((s, v) => s + v, 0) / available.length);
  }

  const roundedValue = weightedValue;

  // Derived value outputs
  const realizableValue = roundFMV(roundedValue * 0.90);
  const distressValue   = roundFMV(roundedValue * 0.80);

  // Update run + assignment final value atomically
  const [updated] = await prisma.$transaction([
    prisma.valuationRun.update({
      where: { id },
      data: {
        isFinalized: true,
        marketApproachWeight: mw > 0 ? String(mw) : null,
        costApproachWeight: cw > 0 ? String(cw) : null,
        incomeApproachWeight: iw > 0 ? String(iw) : null,
        weightedValue: String(weightedValue),
        roundedValue: String(roundedValue),
        realizableValue: String(realizableValue),
        distressValue: String(distressValue),
        reconciliationNotes: input.reconciliationNotes,
        // Bank-specific manual outputs
        insuranceValue: input.insuranceValue != null ? String(input.insuranceValue) : undefined,
        rentalValueMonthly: input.rentalValueMonthly != null ? String(input.rentalValueMonthly) : undefined,
        bookValue: input.bookValue != null ? String(input.bookValue) : undefined,
        compositeRatePerSqFt: input.compositeRatePerSqFt != null ? String(input.compositeRatePerSqFt) : undefined,
        stageDiscountPct: input.stageDiscountPct != null ? String(input.stageDiscountPct) : undefined,
        computedAt: new Date(),
      },
    }),
    prisma.assignment.update({
      where: { id: run.assignmentId },
      data: {
        finalValue: String(roundedValue),
        status: 'ANALYSIS_IN_PROGRESS',
      },
    }),
  ]);

  return updated;
}


// ─────────────────────────────────────────────
// Reopen a finalized run (admin only, blocked after DELIVERED)
// ─────────────────────────────────────────────

export async function reopenValuationRun(id: string, tenantId: string) {
  const run = await prisma.valuationRun.findFirst({
    where: { id, assignment: { tenantId } },
    include: { assignment: { select: { status: true } } },
  });
  if (!run) throw new NotFoundError('Valuation run');
  if (!run.isFinalized) throw new AppError(400, 'Valuation run is not finalized');
  if (run.assignment.status === 'DELIVERED') {
    throw new ForbiddenError('Cannot reopen valuation after assignment has been delivered');
  }
  return prisma.valuationRun.update({
    where: { id },
    data: { isFinalized: false },
  });
}
