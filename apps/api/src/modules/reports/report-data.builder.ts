/**
 * Report Data Builder
 * Assembles a flat ReportData object from all Prisma relations.
 * This snapshot is stored in Report.reportData for IBBI audit trail.
 */

import { prisma } from '../../config/database.js';
import { NotFoundError, AppError } from '../../middleware/error.middleware.js';
import { rupeesToWords } from './utils/number-to-words.js';
import {
  IBBI_CERTIFICATE_TEXT,
  IBBI_INDEPENDENCE_DECLARATION,
  IBBI_LIMITING_CONDITIONS,
  IBBI_MANDATORY_USER_FIELDS,
  IBBI_MANDATORY_ASSIGNMENT_FIELDS,
  IBBI_MANDATORY_PROPERTY_FIELDS,
} from '@valuemitra/shared';
import type { ReportData } from '@valuemitra/shared';

function fmt(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function fmtDate(value: unknown): string {
  if (!value) return '';
  try {
    return new Date(value as string).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'long', year: 'numeric',
    });
  } catch {
    return '';
  }
}

function fmtDecimal(value: unknown, decimals = 2): string {
  if (value === null || value === undefined) return '';
  const n = Number(value);
  if (isNaN(n)) return '';
  return n.toLocaleString('en-IN', { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

function fmtCurrency(value: unknown): string {
  if (value === null || value === undefined) return '';
  const n = Number(value);
  if (isNaN(n) || n === 0) return '';
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function fmtBool(value: unknown): string {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return '';
}

// ─────────────────────────────────────────────
// IBBI Compliance Gate
// ─────────────────────────────────────────────

interface ComplianceCheckInput {
  user: Record<string, unknown>;
  assignment: Record<string, unknown>;
  property: Record<string, unknown> | null;
  valuationRunId?: string;
}

export function assertIBBICompliance(input: ComplianceCheckInput): void {
  const errors: string[] = [];

  // User fields
  for (const field of IBBI_MANDATORY_USER_FIELDS) {
    if (!input.user[field]) {
      errors.push(`RV profile missing: ${field}`);
    }
  }

  // ibbiRegValidUpto must be in the future
  const validUpto = input.user['ibbiRegValidUpto'] as string | null;
  if (validUpto && new Date(validUpto) < new Date()) {
    errors.push('IBBI registration has expired — renew before generating report');
  }

  // Assignment fields
  for (const field of IBBI_MANDATORY_ASSIGNMENT_FIELDS) {
    if (!input.assignment[field]) {
      errors.push(`Assignment missing: ${field}`);
    }
  }

  // Property fields
  if (input.property) {
    for (const field of IBBI_MANDATORY_PROPERTY_FIELDS) {
      if (!input.property[field]) {
        errors.push(`Property missing: ${field}`);
      }
    }
  } else {
    errors.push('Property record not found for this assignment');
  }

  // Valuation run
  if (!input.valuationRunId) {
    errors.push('No finalized valuation run — finalize a valuation run before generating the report');
  }

  if (errors.length > 0) {
    throw new AppError(422, `IBBI compliance check failed:\n${errors.map(e => `• ${e}`).join('\n')}`);
  }
}

// ─────────────────────────────────────────────
// Build the flat ReportData snapshot
// ─────────────────────────────────────────────

export async function buildReportData(
  assignmentId: string,
  tenantId: string,
  userId: string,
  valuationRunId?: string,
  templateId?: string,
): Promise<ReportData> {
  // Fetch assignment with all required relations
  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, tenantId },
    include: {
      property: true,
      client: true,
      assignedTo: true,
      createdBy: true,
      inspection: true,
    },
  });

  if (!assignment) throw new NotFoundError('Assignment');

  // Determine the RV (the assigned valuer or the creator)
  const valuer = assignment.assignedTo ?? assignment.createdBy;
  if (!valuer) {
    throw new AppError(422, 'Assignment has no valuer assigned. Please assign a valuer before generating the report.');
  }

  // Fetch tenant (firm details)
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new NotFoundError('Tenant');

  // Load template for bank-conditional flags (if templateId provided)
  let realizableValuePct = 0.90;
  let showDualStageValuation = false;
  let showInsuranceValue = false;
  let showBookValue = false;
  let showRentalValue = false;
  let showPurchasePrice = false;

  if (templateId) {
    const template = await prisma.reportTemplate.findFirst({
      where: { id: templateId, OR: [{ tenantId }, { tenantId: null }] },
    });
    if (template) {
      realizableValuePct = template.realizableValuePct ? Number(template.realizableValuePct) : 0.90;
      showDualStageValuation = template.showDualStageValuation ?? false;
      showInsuranceValue = template.showInsuranceValue ?? false;
      showBookValue = template.showBookValue ?? false;
      showRentalValue = template.showRentalValue ?? false;
      showPurchasePrice = template.showPurchasePrice ?? false;
    }
  }

  // Fetch finalized valuation run
  let valuationRun: Record<string, unknown> | null = null;
  let resolvedRunId = valuationRunId;

  if (valuationRunId) {
    const run = await prisma.valuationRun.findFirst({
      where: { id: valuationRunId, assignment: { tenantId } },
    });
    if (!run) throw new NotFoundError('Valuation run');
    if (!run.isFinalized) throw new AppError(422, 'Valuation run is not yet finalized');
    valuationRun = run as unknown as Record<string, unknown>;
  } else {
    // Auto-pick the latest finalized run
    const run = await prisma.valuationRun.findFirst({
      where: { assignmentId, isFinalized: true },
      orderBy: { version: 'desc' },
    });
    if (run) {
      valuationRun = run as unknown as Record<string, unknown>;
      resolvedRunId = run.id;
    }
  }

  // IBBI compliance gate
  assertIBBICompliance({
    user: valuer as unknown as Record<string, unknown>,
    assignment: assignment as unknown as Record<string, unknown>,
    property: assignment.property as unknown as Record<string, unknown> | null,
    valuationRunId: resolvedRunId,
  });

  const property = assignment.property;
  const client = assignment.client;
  const inspection = assignment.inspection;

  // Resolve client display name
  let clientName = '';
  if (client.clientType === 'INDIVIDUAL') {
    clientName = client.fullName ?? '';
  } else if (client.clientType === 'BANK' || client.isBank) {
    clientName = client.bankName ?? client.companyName ?? '';
  } else {
    clientName = client.companyName ?? client.fullName ?? '';
  }

  // Resolve property owner name (from property.ownerNames array if available, else client name)
  const ownerNamesArr = property?.ownerNames as string[] | null | undefined;
  const ownerName = ownerNamesArr && ownerNamesArr.length > 0
    ? ownerNamesArr.join(', ')
    : clientName;

  // Build full property address string
  const propertyAddressParts = [
    property?.flatNo,
    property?.wingName,
    property?.buildingName,
    property?.societyName,
    property?.addressLine1,
    property?.addressLine2,
    property?.village,
    property?.city,
    property?.district,
    property?.state,
    property?.pincode,
  ].filter(Boolean);
  const propertyAddress = propertyAddressParts.join(', ');

  // Firm address
  const firmAddress = [
    tenant.registeredAddress,
    tenant.city,
    tenant.state,
    tenant.pincode,
  ].filter(Boolean).join(', ');

  // Final value from valuation run or assignment
  const finalValueNum = valuationRun?.['roundedValue']
    ? Number(valuationRun['roundedValue'])
    : assignment.finalValue
      ? Number(assignment.finalValue)
      : 0;

  const landValueNum = valuationRun?.['landValue'] ? Number(valuationRun['landValue']) : 0;
  const buildingValueNum = valuationRun?.['depreciatedValue'] ? Number(valuationRun['depreciatedValue']) : 0;

  // Market value variants — realizableValuePct from template (BOI/UBI: 95%, others: 90%)
  const fairMarketValue = finalValueNum;
  const realizableValueNum = Math.round(finalValueNum * realizableValuePct);
  const distressSaleValue = Math.round(finalValueNum * 0.75); // 75% fixed

  // Govt rate lookup (best match for property state/district)
  let govtRateYear = '', govtRatePerSqFt = '', govtRatePerSqM = '', govtRateSource = '';
  if (property?.state) {
    const govtRate = await prisma.governmentRate.findFirst({
      where: {
        tenantId,
        state: property.state,
        isActive: true,
        ...(property.district ? { district: property.district } : {}),
      },
      orderBy: { fetchedAt: 'desc' },
    });
    if (govtRate) {
      govtRateYear = fmt(govtRate.rateYear);
      govtRatePerSqFt = govtRate.ratePerSqFt ? fmtDecimal(govtRate.ratePerSqFt) : '';
      govtRatePerSqM = govtRate.ratePerSqM ? fmtDecimal(govtRate.ratePerSqM) : '';
      govtRateSource = govtRate.isManualOverride ? 'Manual Entry' : 'Govt. Portal';
    }
  }

  // Comparables narrative
  let comparablesNarrative = '';
  if (valuationRun?.['comparables']) {
    const comparables = valuationRun['comparables'] as Array<Record<string, unknown>>;
    if (Array.isArray(comparables) && comparables.length > 0) {
      comparablesNarrative = comparables.map((c, i) =>
        `${i + 1}. ${fmt(c['address'])}, ${fmt(c['locality'])} — ₹${Number(c['salePrice']).toLocaleString('en-IN')} total (Rate: ₹${fmtDecimal(c['ratePerSqFt'])} per sq.ft.), Transaction Date: ${fmtDate(c['transactionDate'])}`
      ).join('\n');
    }
  }

  // Unpack JSON blobs
  const bd = (property?.boundaryDetails ?? {}) as Record<string, string>;
  const ac = (property?.areaClassification ?? {}) as Record<string, string>;
  const ph = (property?.physicalDetails ?? {}) as Record<string, string>;

  // Composite rate per sq.ft (finalValue ÷ builtUpAreaSqFt)
  const compositeRatePerSqFtNum = (() => {
    if (finalValueNum > 0 && property?.builtUpAreaSqFt) {
      const sqft = Number(property.builtUpAreaSqFt);
      if (sqft > 0) return Math.round(finalValueNum / sqft);
    }
    return null;
  })();

  // Present stage value (for UC dual-stage valuation: BOI/UBI)
  const presentStageValueNum = (() => {
    if (assignment.isUnderConstruction && assignment.percentageCompletion && finalValueNum > 0) {
      return Math.round(finalValueNum * Number(assignment.percentageCompletion) / 100 / 1000) * 1000;
    }
    return null;
  })();

  // Bank-conditional optional outputs from ValuationRun
  const insuranceValueNum = valuationRun?.['insuranceValue'] ? Number(valuationRun['insuranceValue']) : null;
  const rentalValueMonthlyNum = valuationRun?.['rentalValueMonthly'] ? Number(valuationRun['rentalValueMonthly']) : null;
  const bookValueNum = valuationRun?.['bookValue'] ? Number(valuationRun['bookValue']) : null;

  const reportData: ReportData = {
    // ── Reference & dates ──────────────────────────────────
    referenceNo: fmt(assignment.assignmentNo),
    firmReferenceNo: fmt(assignment.firmReferenceNo),
    reportDate: fmtDate(assignment.reportDate ?? new Date()),
    inspectionDate: fmtDate(assignment.inspectionDate),
    valuationDate: fmtDate(assignment.inspectionDate ?? new Date()),

    // ── RV / Valuer details ────────────────────────────────
    rvFullName: fmt(valuer.fullName),
    rvIbbiRegNo: fmt(valuer.ibbiRegNo),
    rvIbbiRegCategory: fmt(valuer.ibbiRegCategory),
    rvIbbiRegValidUpto: fmtDate(valuer.ibbiRegValidUpto),
    rvQualifications: fmt(valuer.qualifications),
    rvRvoName: fmt(tenant.rvoName),
    rvPhone: fmt(valuer.phone),
    rvEmail: fmt(valuer.email),

    // ── Firm details ───────────────────────────────────────
    firmName: fmt(tenant.name),
    firmAddress,
    firmCity: fmt(tenant.city),
    firmGstin: fmt(tenant.gstin),
    firmPhone: fmt(tenant.phone),
    firmEmail: fmt(tenant.email),

    // ── Bank / Client details ──────────────────────────────
    bankName: client.isBank ? fmt(client.bankName) : '',
    bankBranch: fmt(client.bankBranch),
    bankRefNo: fmt(assignment.bankRefNo),
    clientName,
    loanAccountNo: fmt(client.loanAccountNo),

    // ── Purpose ────────────────────────────────────────────
    purposeOfValuation: fmt(assignment.purposeOfValuation),
    propertyTypeLabel: fmt(assignment.propertyType).replace(/_/g, ' '),
    freshOrRevaluation: fmt(assignment.freshOrRevaluation),

    // ── Property identification ────────────────────────────
    ownerName,
    ownershipNature: fmt(property?.ownershipNature),
    ownerShareDetails: fmt(property?.ownerShareDetails),
    developerName: fmt(property?.developerName),
    reraNo: fmt(property?.reraNo),
    propertyAddress,
    surveyNo: fmt(property?.surveyNo),
    hissaNo: fmt(property?.hissaNo),
    ctsSurveyNo: fmt(property?.ctsSurveyNo),
    municipalNo: fmt(property?.municipalNo),
    societyName: fmt(property?.societyName),
    flatNo: fmt(property?.flatNo),
    floor: fmt(property?.floor),
    wingName: fmt(property?.wingName),
    buildingName: fmt(property?.buildingName),
    district: fmt(property?.district),
    taluka: fmt(property?.taluka),
    village: fmt(property?.village),
    landmark: fmt(property?.landmark),
    municipalCorporation: fmt(property?.municipalCorporation),
    pincode: fmt(property?.pincode),

    // ── Area classification (from JSON blob) ───────────────
    areaType: fmt(ac['type']),
    areaClassificationGrade: fmt(ac['highMiddlePoor']),
    urbanRuralClass: fmt(ac['urbanRural']),
    municipalBodyType: fmt(ac['corpType']),
    govtEnactments: fmt(ac['govtEnactments']),

    // ── Physical / site description (from JSON blob) ───────
    landNature: fmt(ph['landNature']),
    plotShape: fmt(ph['plotShape']),
    directAccess: fmt(ph['directAccess']),
    boundaryNature: fmt(ph['boundaryNature']),
    possessionStatus: fmt(ph['possession']),

    // ── Boundary details (from JSON blob) ─────────────────
    northBoundaryDoc: fmt(bd['northDoc']),
    southBoundaryDoc: fmt(bd['southDoc']),
    eastBoundaryDoc: fmt(bd['eastDoc']),
    westBoundaryDoc: fmt(bd['westDoc']),
    northBoundaryActual: fmt(bd['northActual']),
    southBoundaryActual: fmt(bd['southActual']),
    eastBoundaryActual: fmt(bd['eastActual']),
    westBoundaryActual: fmt(bd['westActual']),

    // ── Land ───────────────────────────────────────────────
    landAreaSqFt: property?.landAreaSqFt ? fmtDecimal(property.landAreaSqFt) : '',
    landAreaSqM: property?.landAreaSqM ? fmtDecimal(property.landAreaSqM) : '',
    landTenure: fmt(property?.landTenure),
    zoningClassification: fmt(property?.zoningClassification),
    udsArea: property?.udsArea ? fmtDecimal(property.udsArea) : '',
    udsAreaFormatted: property?.udsArea ? fmtDecimal(property.udsArea) : '',
    udsUnit: fmt(property?.udsUnit),
    dpZone: fmt(property?.dpZone),
    fsi: property?.fsi ? fmtDecimal(property.fsi, 2) : '',
    permissibleUse: fmt(property?.permissibleUse),
    naOrderDetails: fmt(property?.naOrderDetails),
    miDcPlotNo: fmt(property?.miDcPlotNo),

    // ── Building ───────────────────────────────────────────
    builtUpAreaSqFt: property?.builtUpAreaSqFt ? fmtDecimal(property.builtUpAreaSqFt) : '',
    builtUpAreaSqM: property?.builtUpAreaSqM ? fmtDecimal(property.builtUpAreaSqM) : '',
    carpetAreaSqFt: property?.carpetAreaSqFt ? fmtDecimal(property.carpetAreaSqFt) : '',
    carpetAreaSqM: property?.carpetAreaSqM ? fmtDecimal(property.carpetAreaSqM) : '',
    superBuiltUpAreaSqFt: property?.superBuiltUpAreaSqFt ? fmtDecimal(property.superBuiltUpAreaSqFt) : '',
    superBuiltUpAreaSqM: property?.superBuiltUpAreaSqM ? fmtDecimal(property.superBuiltUpAreaSqM) : '',
    unitConfiguration: fmt(property?.unitConfiguration),
    numberOfFloors: property?.numberOfFloors ? fmt(property.numberOfFloors) : '',
    yearOfConstruction: property?.yearOfConstruction ? fmt(property.yearOfConstruction) : '',
    ageOfBuilding: property?.ageOfBuilding ? `${fmt(property.ageOfBuilding)} Years` : '',
    remainingLifeYears: property?.remainingLifeYears ? `${fmt(property.remainingLifeYears)} Years` : '',
    structureType: fmt(property?.structureType).replace(/_/g, ' '),
    condition: fmt(property?.exteriorCondition),

    // ── Actual site-measured areas ─────────────────────────
    builtUpAreaActualSqFt: property?.builtUpAreaActualSqFt ? fmtDecimal(property.builtUpAreaActualSqFt) : '',
    builtUpAreaActualSqM: property?.builtUpAreaActualSqM ? fmtDecimal(property.builtUpAreaActualSqM) : '',
    carpetAreaActualSqFt: property?.carpetAreaActualSqFt ? fmtDecimal(property.carpetAreaActualSqFt) : '',
    carpetAreaActualSqM: property?.carpetAreaActualSqM ? fmtDecimal(property.carpetAreaActualSqM) : '',
    landAreaActualSqFt: property?.landAreaActualSqFt ? fmtDecimal(property.landAreaActualSqFt) : '',
    landAreaActualSqM: property?.landAreaActualSqM ? fmtDecimal(property.landAreaActualSqM) : '',

    // ── Building compliance ────────────────────────────────
    approvedPlanAuthority: fmt(property?.approvedPlanAuthority),
    approvedPlanDateFormatted: fmtDate(property?.approvedPlanDate),
    approvedPlanValidityFormatted: fmtDate(property?.approvedPlanValidity),
    planGenuinenessVerified: fmtBool(property?.planGenuinenessVerified),
    unauthorizedConstruction: fmtBool(property?.unauthorizedConstruction),
    demolitionProceedings: fmtBool(property?.demolitionProceedings),

    // ── L&B building floors breakdown ──────────────────────
    buildingFloorsNarrative: (() => {
      const floors = property?.buildingFloors as Array<{floorLabel: string; useType: string; builtUpAreaSqFt?: number; builtUpAreaSqM?: number; remarks?: string}> | null;
      if (!floors || floors.length === 0) return '';
      return floors.map(f =>
        `${f.floorLabel}: ${f.useType}${f.builtUpAreaSqFt ? ` — ${fmtDecimal(f.builtUpAreaSqFt)} sq.ft.` : ''}${f.remarks ? ` (${f.remarks})` : ''}`
      ).join('\n');
    })(),

    // ── Unit finishes (from inspection) ───────────────────
    flooringType: fmt(inspection?.flooringType),
    wallFinishing: fmt(inspection?.wallFinishing),
    ceilingHeightFt: inspection?.ceilingHeightFt ? fmtDecimal(inspection.ceilingHeightFt, 1) : '',
    electricalFittings: fmt(inspection?.electricalFittings),
    sanitaryFittings: fmt(inspection?.sanitaryFittings),
    acType: fmt(inspection?.acType),
    leaseholdDetails: fmt(inspection?.leaseholdDetails),

    // ── Site occupancy (from inspection) ──────────────────
    occupantName: fmt(inspection?.occupantName),
    occupantRelation: fmt(inspection?.occupantRelation),
    occupiedSince: fmt(inspection?.occupiedSince),
    nameOnBoard: fmt(inspection?.nameOnBoard),

    // ── Under-construction ─────────────────────────────────
    percentageCompletion: assignment.percentageCompletion ? `${assignment.percentageCompletion}%` : undefined,
    expectedHandoverDate: assignment.expectedHandoverDate ? fmtDate(assignment.expectedHandoverDate) : undefined,

    // ── Government rates ───────────────────────────────────
    govtRateYear,
    govtRatePerSqFt,
    govtRatePerSqM,
    govtRateSource,

    // ── Valuation results ──────────────────────────────────
    landValue: landValueNum > 0 ? fmtCurrency(landValueNum) : '',
    buildingValue: buildingValueNum > 0 ? fmtCurrency(buildingValueNum) : '',
    finalValue: fmtCurrency(finalValueNum),
    finalValueWords: rupeesToWords(finalValueNum),
    fairMarketValue: fmtCurrency(fairMarketValue),
    realizableValue: fmtCurrency(realizableValueNum),
    realizableValueWords: rupeesToWords(realizableValueNum),
    realizableValuePct: `${Math.round(realizableValuePct * 100)}%`,
    distressSaleValue: fmtCurrency(distressSaleValue),

    // ── Market analysis (from ValuationRun) ───────────────
    marketabilityRating: fmt(valuationRun?.['marketabilityRating']),
    positiveFactors: fmt(valuationRun?.['positiveFactors']),
    negativeFactors: fmt(valuationRun?.['negativeFactors']),
    marketAnalysisNarrative: fmt(valuationRun?.['marketAnalysisNarrative']),

    // ── Extended valuation fields ──────────────────────────
    compositeRatePerSqFt: compositeRatePerSqFtNum !== null ? fmtDecimal(compositeRatePerSqFtNum, 0) : undefined,
    compositeRateFormatted: compositeRatePerSqFtNum !== null ? fmtCurrency(compositeRatePerSqFtNum) : undefined,
    carParkingCount: undefined,
    carParkingValuePerUnit: undefined,
    carParkingTotalValue: undefined,

    // ── Dual-stage UC valuation (BOI/UBI) ─────────────────
    presentStageValue: showDualStageValuation && presentStageValueNum !== null
      ? fmtCurrency(presentStageValueNum)
      : undefined,
    presentStageValueWords: showDualStageValuation && presentStageValueNum !== null
      ? rupeesToWords(presentStageValueNum)
      : undefined,

    // ── Bank-conditional output values ─────────────────────
    showDualStageValuation,
    showInsuranceValue,
    showBookValue,
    showRentalValue,
    showPurchasePrice,

    insuranceValue: showInsuranceValue && insuranceValueNum !== null ? fmtCurrency(insuranceValueNum) : undefined,
    insuranceValueWords: showInsuranceValue && insuranceValueNum !== null ? rupeesToWords(insuranceValueNum) : undefined,
    insuranceValueFormatted: showInsuranceValue && insuranceValueNum !== null ? fmtCurrency(insuranceValueNum) : undefined,

    rentalValueMonthly: showRentalValue && rentalValueMonthlyNum !== null ? fmtCurrency(rentalValueMonthlyNum) : undefined,
    rentalValueFormatted: showRentalValue && rentalValueMonthlyNum !== null ? fmtCurrency(rentalValueMonthlyNum) : undefined,

    bookValue: showBookValue && bookValueNum !== null ? fmtCurrency(bookValueNum) : undefined,
    bookValueFormatted: showBookValue && bookValueNum !== null ? fmtCurrency(bookValueNum) : undefined,
    bookValueWords: showBookValue && bookValueNum !== null ? rupeesToWords(bookValueNum) : undefined,

    // ── Images (URLs to be resolved at generation time) ────
    rvSignature: valuer.signatureUrl ? fmt(valuer.signatureUrl) : undefined,
    rvStamp: valuer.stampUrl ? fmt(valuer.stampUrl) : undefined,

    // ── Comparables narrative ──────────────────────────────
    comparablesNarrative,

    // ── IBBI legal text ────────────────────────────────────
    ibbiCertificateText: IBBI_CERTIFICATE_TEXT,
    independenceDeclaration: IBBI_INDEPENDENCE_DECLARATION,
    limitingConditions: IBBI_LIMITING_CONDITIONS,
  };

  return reportData;
}
