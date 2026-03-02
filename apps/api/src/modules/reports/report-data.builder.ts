/**
 * Report Data Builder
 * Assembles a flat ReportData object from all Prisma relations.
 * This snapshot is stored in Report.reportData for IBBI audit trail.
 */

import { prisma } from '../../config/database.js';
import { NotFoundError, AppError, ForbiddenError } from '../../middleware/error.middleware.js';
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
): Promise<ReportData> {
  // Fetch assignment with all required relations
  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, tenantId },
    include: {
      property: true,
      client: true,
      assignedTo: true,
      createdBy: true,
    },
  });

  if (!assignment) throw new NotFoundError('Assignment');

  // Determine the RV (the assigned valuer or the creator)
  const valuer = assignment.assignedTo ?? assignment.createdBy;

  // Fetch tenant (firm details)
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new NotFoundError('Tenant');

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

  // Resolve client display name
  let clientName = '';
  if (client.clientType === 'INDIVIDUAL') {
    clientName = client.fullName ?? '';
  } else if (client.clientType === 'BANK' || client.isBank) {
    clientName = client.bankName ?? client.companyName ?? '';
  } else {
    clientName = client.companyName ?? client.fullName ?? '';
  }

  // Build full property address string
  const propertyAddressParts = [
    property?.flatNo,
    property?.buildingName,
    property?.societyName,
    property?.addressLine1,
    property?.addressLine2,
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

  // Market value variants (standard practice)
  const fairMarketValue = finalValueNum;
  const realizableValue = Math.round(finalValueNum * 0.90); // 90%
  const distressSaleValue = Math.round(finalValueNum * 0.75); // 75%

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

  const reportData: ReportData = {
    // Reference & dates
    referenceNo: fmt(assignment.assignmentNo),
    firmReferenceNo: fmt(assignment.firmReferenceNo),
    reportDate: fmtDate(assignment.reportDate ?? new Date()),
    inspectionDate: fmtDate(assignment.inspectionDate),
    valuationDate: fmtDate(assignment.inspectionDate ?? new Date()),

    // RV / Valuer details
    rvFullName: fmt(valuer.fullName),
    rvIbbiRegNo: fmt(valuer.ibbiRegNo),
    rvIbbiRegCategory: fmt(valuer.ibbiRegCategory),
    rvIbbiRegValidUpto: fmtDate(valuer.ibbiRegValidUpto),
    rvQualifications: fmt(valuer.qualifications),
    rvRvoName: fmt(tenant.rvoName),
    rvPhone: fmt(valuer.phone),
    rvEmail: fmt(valuer.email),

    // Firm details
    firmName: fmt(tenant.name),
    firmAddress,
    firmCity: fmt(tenant.city),
    firmGstin: fmt(tenant.gstin),
    firmPhone: fmt(tenant.phone),
    firmEmail: fmt(tenant.email),

    // Bank / Client details
    bankName: client.isBank ? fmt(client.bankName) : '',
    bankBranch: fmt(client.bankBranch),
    bankRefNo: fmt(assignment.bankRefNo),
    clientName,
    loanAccountNo: fmt(client.loanAccountNo),

    // Purpose
    purposeOfValuation: fmt(assignment.purposeOfValuation),
    propertyTypeLabel: fmt(assignment.propertyType).replace(/_/g, ' '),

    // Property identification
    ownerName: clientName,
    propertyAddress,
    surveyNo: fmt(property?.surveyNo),
    ctsSurveyNo: fmt(property?.ctsSurveyNo),
    municipalNo: fmt(property?.municipalNo),
    societyName: fmt(property?.societyName),
    flatNo: fmt(property?.flatNo),
    floor: fmt(property?.floor),
    buildingName: fmt(property?.buildingName),
    district: fmt(property?.district),
    taluka: '',
    pincode: fmt(property?.pincode),

    // Land
    landAreaSqFt: property?.landAreaSqFt ? fmtDecimal(property.landAreaSqFt) : '',
    landAreaSqM: property?.landAreaSqM ? fmtDecimal(property.landAreaSqM) : '',
    landTenure: fmt(property?.landTenure),
    zoningClassification: fmt(property?.zoningClassification),

    // Building
    builtUpAreaSqFt: property?.builtUpAreaSqFt ? fmtDecimal(property.builtUpAreaSqFt) : '',
    builtUpAreaSqM: property?.builtUpAreaSqM ? fmtDecimal(property.builtUpAreaSqM) : '',
    carpetAreaSqFt: property?.carpetAreaSqFt ? fmtDecimal(property.carpetAreaSqFt) : '',
    carpetAreaSqM: property?.carpetAreaSqM ? fmtDecimal(property.carpetAreaSqM) : '',
    numberOfFloors: property?.numberOfFloors ? fmt(property.numberOfFloors) : '',
    yearOfConstruction: property?.yearOfConstruction ? fmt(property.yearOfConstruction) : '',
    ageOfBuilding: property?.ageOfBuilding ? `${fmt(property.ageOfBuilding)} Years` : '',
    structureType: fmt(property?.structureType).replace(/_/g, ' '),
    condition: fmt(property?.exteriorCondition),

    // Under-construction
    percentageCompletion: assignment.percentageCompletion ? `${assignment.percentageCompletion}%` : undefined,
    expectedHandoverDate: assignment.expectedHandoverDate ? fmtDate(assignment.expectedHandoverDate) : undefined,

    // Government rates
    govtRateYear,
    govtRatePerSqFt,
    govtRatePerSqM,
    govtRateSource,

    // Valuation results
    landValue: landValueNum > 0 ? fmtCurrency(landValueNum) : '',
    buildingValue: buildingValueNum > 0 ? fmtCurrency(buildingValueNum) : '',
    finalValue: fmtCurrency(finalValueNum),
    finalValueWords: rupeesToWords(finalValueNum),
    fairMarketValue: fmtCurrency(fairMarketValue),
    realizableValue: fmtCurrency(realizableValue),
    distressSaleValue: fmtCurrency(distressSaleValue),

    // Extended valuation fields (computed where possible)
    compositeRatePerSqFt: (() => {
      if (finalValueNum > 0 && property?.builtUpAreaSqFt) {
        const sqft = Number(property.builtUpAreaSqFt);
        if (sqft > 0) return fmtDecimal(finalValueNum / sqft, 0);
      }
      return undefined;
    })(),
    carParkingCount: undefined,
    carParkingValuePerUnit: undefined,
    carParkingTotalValue: undefined,
    presentStageValue: (() => {
      if (assignment.percentageCompletion && finalValueNum > 0) {
        const pct = Number(assignment.percentageCompletion);
        return fmtCurrency(Math.round(finalValueNum * pct / 100));
      }
      return undefined;
    })(),

    // Images (URLs to be resolved at generation time)
    rvSignature: valuer.signatureUrl ? fmt(valuer.signatureUrl) : undefined,
    rvStamp: valuer.stampUrl ? fmt(valuer.stampUrl) : undefined,

    // Comparable transactions narrative
    comparablesNarrative,

    // IBBI legal text
    ibbiCertificateText: IBBI_CERTIFICATE_TEXT,
    independenceDeclaration: IBBI_INDEPENDENCE_DECLARATION,
    limitingConditions: IBBI_LIMITING_CONDITIONS,
  };

  return reportData;
}
