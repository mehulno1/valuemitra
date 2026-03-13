import { prisma } from '../../config/database.js';
import { NotFoundError, AppError } from '../../middleware/error.middleware.js';
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
  const subjectAreaSqFt = assignment?.property?.builtUpAreaSqM
    ? Number(assignment.property.builtUpAreaSqM) * 10.764    // convert sq.m. to sq.ft.
    : 0;

  const result = computeMarketComparison(input.comparables, subjectAreaSqFt, input.correlatedValue);

  return prisma.valuationRun.update({
    where: { id },
    data: {
      comparables: result.comparables as unknown as object,
      adjustedValues: { min: result.minAdjustedRate, max: result.maxAdjustedRate, avg: result.simpleAvgRate } as unknown as object,
      correlatedValue: String(result.correlatedValue),
      // Market analysis fields (MKT_009-012)
      marketabilityRating: input.marketabilityRating ?? null,
      positiveFactors: input.positiveFactors || null,
      negativeFactors: input.negativeFactors || null,
      marketAnalysisNarrative: input.marketAnalysisNarrative || null,
      inputSnapshot: { marketComparison: { input, result } } as unknown as object,
      computedAt: new Date(),
    },
  });
}

// ─────────────────────────────────────────────
// Update — Cost Approach (auto-compute on save)
// ─────────────────────────────────────────────

export async function updateCostApproach(
  id: string,
  tenantId: string,
  input: UpdateCostApproachInput,
) {
  await getRunOrThrow(id, tenantId);
  const result = computeCostApproach(input);

  // Compute govt guideline value = RR rate × land area (if both provided)
  const rrRatePerSqM = input.rrRatePerSqM;
  const rrRatePerSqFt = rrRatePerSqM != null ? rrRatePerSqM / 10.764 : undefined;
  const landAreaForGovt = input.landArea;
  const govtGuidelineValue =
    rrRatePerSqM != null && landAreaForGovt != null
      ? rrRatePerSqM * landAreaForGovt
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
    weightedValue = Math.round(effectiveNumerator / effectiveDenominator / 1000) * 1000;
  } else {
    // Auto: use the single available value, or average of all computed
    const available = [marketVal, costVal, incomeVal].filter((v): v is number => v !== null);
    if (available.length === 0) throw new AppError(422, 'No approach values computed yet — update at least one approach before finalizing');
    weightedValue = Math.round(available.reduce((s, v) => s + v, 0) / available.length / 1000) * 1000;
  }

  const roundedValue = weightedValue; // already rounded to 1000

  // Derived value outputs
  const realizableValue = Math.round(roundedValue * 0.90 / 1000) * 1000;
  const distressValue   = Math.round(roundedValue * 0.80 / 1000) * 1000;

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
