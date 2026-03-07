/**
 * Property Data Service — Phase A of the valuation workflow
 *
 * Flow:
 * 1. POST /extract  — reads OCR texts from all documents, calls Claude, returns structured JSON
 * 2. PATCH /        — user saves (possibly edited) property + legal fields to Property record
 * 3. POST /verify   — user marks data as verified → status advances to DATA_VERIFIED
 *
 * Claude output is NEVER saved automatically — user must review and click Save first.
 */

import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../../config/database.js';
import { createAuditLog } from '../../middleware/audit.middleware.js';
import { NotFoundError, AppError } from '../../middleware/error.middleware.js';
import { AssignmentStatus, ASSIGNMENT_STATUS_TRANSITIONS } from '@valuemitra/shared';
import type { SavePropertyDataInput, ExtractedPropertyData } from '@valuemitra/shared';
import { env } from '../../config/env.js';

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

async function getAssignmentOrThrow(assignmentId: string, tenantId: string) {
  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, tenantId },
    include: { property: true },
  });
  if (!assignment) throw new NotFoundError('Assignment');
  return assignment;
}

function validateTransition(current: string, target: AssignmentStatus): void {
  const allowed = ASSIGNMENT_STATUS_TRANSITIONS[current as AssignmentStatus] ?? [];
  if (!allowed.includes(target)) {
    throw new AppError(
      422,
      `Cannot transition from ${current} to ${target}. Allowed: ${allowed.join(', ') || 'none'}`,
    );
  }
}

// ─────────────────────────────────────────────
// 1. Extract property data from OCR texts via Claude
// ─────────────────────────────────────────────

export async function extractPropertyData(
  assignmentId: string,
  tenantId: string,
): Promise<ExtractedPropertyData> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new AppError(503, 'AI extraction service is not configured. Set ANTHROPIC_API_KEY.');
  }

  await getAssignmentOrThrow(assignmentId, tenantId);

  // Fetch all OCR-completed documents for this assignment
  const documents = await prisma.document.findMany({
    where: {
      assignmentId,
      tenantId,
      isDeleted: false,
      ocrStatus: { in: ['COMPLETED', 'NEEDS_REVIEW'] },
    },
    select: { documentType: true, ocrRawResponse: true },
  });

  if (documents.length === 0) {
    throw new AppError(400, 'No OCR-completed documents found for this assignment. Upload and wait for OCR to complete.');
  }

  // Build document sections for the prompt
  const docSections = documents
    .filter(d => {
      const raw = d.ocrRawResponse as Record<string, unknown> | null;
      return raw?.['fullText'] && String(raw['fullText']).trim().length > 20;
    })
    .map(d => {
      const raw = d.ocrRawResponse as Record<string, unknown>;
      const text = String(raw['fullText']).slice(0, 4000); // cap per doc to stay within context
      return `[${d.documentType}]:\n${text}`;
    });

  if (docSections.length === 0) {
    throw new AppError(400, 'OCR text is empty or too short to extract data. Verify documents were scanned correctly.');
  }

  const systemPrompt = `You are a specialist in extracting structured data from Indian property legal documents (Sale Deeds, Agreements, Index II, 7/12 extracts, OC, Share Certificates, Approved Plans, RERA certificates, NA Orders, MIDC documents).

Rules:
- Return ONLY a valid JSON object matching the requested schema exactly.
- Set null for any field you cannot find with reasonable confidence.
- Do NOT hallucinate or guess values — if uncertain, use null.
- For names, use the full form as written in the document.
- For areas, ALWAYS convert to square metres. Conversion: 1 sq.ft = 0.0929 sq.m.
- For dates, always output ISO format YYYY-MM-DD.
- For rupee amounts, output plain numbers (no ₹ symbol, no commas, no "lakhs/crores" text — convert to full rupees).`;

  const userMessage = `Extract all property data from the following OCR'd documents. Fill as many fields as possible.\n\n${docSections.join('\n\n---\n\n')}

Return this exact JSON structure (null for anything not found):
{
  "ownerNames": [],
  "ownershipNature": null,
  "ownerShareDetails": null,
  "developerName": null,
  "surveyNo": null,
  "hissaNo": null,
  "ctsSurveyNo": null,
  "municipalNo": null,
  "societyName": null,
  "buildingName": null,
  "wingName": null,
  "flatNo": null,
  "floor": null,
  "reraNo": null,
  "taluka": null,
  "village": null,
  "landmark": null,
  "municipalCorporation": null,
  "landAreaSqM": null,
  "builtUpAreaSqM": null,
  "carpetAreaSqM": null,
  "superBuiltUpAreaSqM": null,
  "unitConfiguration": null,
  "udsArea": null,
  "udsUnit": null,
  "numberOfFloors": null,
  "yearOfConstruction": null,
  "ageOfBuilding": null,
  "structureType": null,
  "zoningClassification": null,
  "dpZone": null,
  "naOrderDetails": null,
  "miDcPlotNo": null,
  "approvedPlanAuthority": null,
  "approvedPlanDate": null,
  "approvedPlanNo": null,
  "registrationNo": null,
  "registrationDate": null,
  "indexIINo": null,
  "agreementValue": null,
  "stampDutyPaid": null,
  "occupancyCertificateNo": null,
  "sharesCertificateNo": null
}

Field notes:
- ownerNames: array of full names of all purchasers/owners listed in the document
- ownershipNature: one of Individual / Joint / Company / HUF / Partnership (infer from number of owners and document context)
- ownerShareDetails: share split if joint ownership (e.g. "50% each", "1/3rd each")
- developerName: builder or developer company name (from OC, plan, agreement)
- surveyNo: Survey/Gat/Khasra number of the land parcel
- hissaNo: Hissa/sub-division number (appears on 7/12, property card, sale deed)
- ctsSurveyNo: City Survey / CTS number (urban Maharashtra, Pune, Mumbai)
- municipalNo: Municipal house/property number assigned by local body
- wingName: Wing, Tower, Block identifier (e.g. "Wing A", "Tower 2", "B Block")
- floor: integer — Ground Floor = 0, First Floor = 1, Basement = -1
- reraNo: RERA registration number of the project (P51900XXXXX format)
- taluka: Taluka or ward name
- village: Village / Mouje / Locality name (from 7/12 or sale deed)
- municipalCorporation: Name of municipal body (MCGM / NMMC / PMC / CIDCO / Gram Panchayat)
- landAreaSqM: Total land area in SQ METRES (convert if in sq.ft: × 0.0929)
- builtUpAreaSqM: Built-up area in SQ METRES
- carpetAreaSqM: Carpet area in SQ METRES (as per RERA = usable floor area excluding walls)
- superBuiltUpAreaSqM: Super built-up / saleable area in SQ METRES
- unitConfiguration: e.g. "2BHK+2T", "3BHK", "1RK", "Open Plan Office", "Shop"
- udsArea: Undivided Share of Land (for flats in co-op society or strata title); include numeric value only
- udsUnit: "Sq.Ft", "Sq.M", or "Fraction" — as stated in the document
- numberOfFloors: Total number of floors in the building (not the flat's floor)
- yearOfConstruction: Year the building was constructed / completion year
- ageOfBuilding: Age in years (if explicitly stated; do not compute from yearOfConstruction)
- structureType: e.g. RCC Frame, Load Bearing, Steel Frame, Composite
- zoningClassification: Residential / Commercial / Industrial / Mixed Use (from 7/12 or NA order)
- dpZone: Development Plan zone code or description (from DP / NA order)
- naOrderDetails: Non-agricultural order: order number, date, issuing authority
- miDcPlotNo: MIDC plot/allotment number (for industrial properties)
- approvedPlanAuthority: Authority that sanctioned building plan (MCGM / NMMC / CIDCO / Gram Panchayat)
- approvedPlanDate: Date of plan sanction in YYYY-MM-DD
- approvedPlanNo: Sanction plan number / IOD number
- registrationNo: Document registration number (from Sub-Registrar stamp)
- registrationDate: Date of document registration in YYYY-MM-DD
- indexIINo: Index II reference number
- agreementValue: Total consideration / agreement value in rupees (full number)
- stampDutyPaid: Stamp duty paid in rupees (full number)
- occupancyCertificateNo: OC / Completion Certificate number
- sharesCertificateNo: Share certificate number (co-operative society)`;

  let message;
  try {
    message = await client.messages.create({
      model: env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes('credit balance') || errMsg.includes('billing')) {
      throw new AppError(503, 'Anthropic API credit balance is insufficient. Please top up at console.anthropic.com → Plans & Billing.');
    }
    if (errMsg.includes('invalid_api_key') || errMsg.includes('authentication')) {
      throw new AppError(503, 'Anthropic API key is invalid. Check ANTHROPIC_API_KEY in server config.');
    }
    throw new AppError(502, `AI service error: ${errMsg}`);
  }

  const textBlock = message.content.find(b => b.type === 'text');
  const rawText = textBlock?.type === 'text' ? textBlock.text : '';

  // Extract JSON from response (may be wrapped in ```json ... ```)
  let parsed: ExtractedPropertyData;
  try {
    const jsonMatch = rawText.match(/```json\s*([\s\S]*?)\s*```/) ?? rawText.match(/(\{[\s\S]*\})/);
    const jsonStr = jsonMatch?.[1] ?? rawText;
    parsed = JSON.parse(jsonStr) as ExtractedPropertyData;
  } catch {
    throw new AppError(502, 'AI extraction returned an unparseable response. Try again or enter data manually.');
  }

  return parsed;
}

// ─────────────────────────────────────────────
// 2. Save property data (user-verified, may be edited from Claude output)
// ─────────────────────────────────────────────

export async function savePropertyData(
  assignmentId: string,
  tenantId: string,
  userId: string,
  data: SavePropertyDataInput,
): Promise<void> {
  const assignment = await getAssignmentOrThrow(assignmentId, tenantId);
  const before = assignment.property;

  const updateData: Record<string, unknown> = {
    // Ownership (OWN_001–008)
    ownerNames: data.ownerNames ?? undefined,
    ownerAddress: data.ownerAddress || null,
    ownerContact: data.ownerContact || null,
    ownerPan: data.ownerPan || null,
    ownershipNature: data.ownershipNature || null,
    ownerShareDetails: data.ownerShareDetails || null,
    borrowerName: data.borrowerName || null,
    developerName: data.developerName || null,
    reraNo: data.reraNo || null,

    // Identification
    surveyNo: data.surveyNo || null,
    hissaNo: data.hissaNo || null,
    ctsSurveyNo: data.ctsSurveyNo || null,
    municipalNo: data.municipalNo || null,
    societyName: data.societyName || null,
    buildingName: data.buildingName || null,
    wingName: data.wingName || null,
    flatNo: data.flatNo || null,
    floor: data.floor ?? null,

    // Address / Location (LOC_001–017)
    ...(data.addressLine1 !== undefined && { addressLine1: data.addressLine1 || null }),
    ...(data.addressLine2 !== undefined && { addressLine2: data.addressLine2 || null }),
    ...(data.city !== undefined && { city: data.city || null }),
    ...(data.state !== undefined && { state: data.state || null }),
    ...(data.pincode !== undefined && { pincode: data.pincode || null }),
    streetName: data.streetName || null,
    district: data.district || null,
    taluka: data.taluka || null,
    village: data.village || null,
    landmark: data.landmark || null,
    municipalCorporation: data.municipalCorporation || null,
    latitude: data.latitude != null ? String(data.latitude) : null,
    longitude: data.longitude != null ? String(data.longitude) : null,

    // Areas (document values)
    landAreaSqM: data.landAreaSqM != null ? String(data.landAreaSqM) : null,
    builtUpAreaSqM: data.builtUpAreaSqM != null ? String(data.builtUpAreaSqM) : null,
    carpetAreaSqM: data.carpetAreaSqM != null ? String(data.carpetAreaSqM) : null,
    landAreaSqFt: data.landAreaSqFt != null ? String(data.landAreaSqFt) : null,
    builtUpAreaSqFt: data.builtUpAreaSqFt != null ? String(data.builtUpAreaSqFt) : null,
    carpetAreaSqFt: data.carpetAreaSqFt != null ? String(data.carpetAreaSqFt) : null,
    superBuiltUpAreaSqM: data.superBuiltUpAreaSqM != null ? String(data.superBuiltUpAreaSqM) : null,
    superBuiltUpAreaSqFt: data.superBuiltUpAreaSqFt != null ? String(data.superBuiltUpAreaSqFt) : null,
    unitConfiguration: data.unitConfiguration || null,

    // Building
    numberOfFloors: data.numberOfFloors ?? null,
    yearOfConstruction: data.yearOfConstruction ?? null,
    ageOfBuilding: data.ageOfBuilding ?? null,
    structureType: data.structureType || null,
    zoningClassification: data.zoningClassification || null,

    // Actual site-measured areas
    builtUpAreaActualSqM: data.builtUpAreaActualSqM != null ? String(data.builtUpAreaActualSqM) : null,
    builtUpAreaActualSqFt: data.builtUpAreaActualSqFt != null ? String(data.builtUpAreaActualSqFt) : null,
    carpetAreaActualSqM: data.carpetAreaActualSqM != null ? String(data.carpetAreaActualSqM) : null,
    carpetAreaActualSqFt: data.carpetAreaActualSqFt != null ? String(data.carpetAreaActualSqFt) : null,
    landAreaActualSqM: data.landAreaActualSqM != null ? String(data.landAreaActualSqM) : null,
    landAreaActualSqFt: data.landAreaActualSqFt != null ? String(data.landAreaActualSqFt) : null,

    // UDS + land details (LND_001–008)
    udsArea: data.udsArea != null ? String(data.udsArea) : null,
    udsUnit: data.udsUnit || null,
    dpZone: data.dpZone || null,
    fsi: data.fsi != null ? String(data.fsi) : null,
    permissibleUse: data.permissibleUse || null,
    naOrderDetails: data.naOrderDetails || null,
    miDcPlotNo: data.miDcPlotNo || null,
    landAreaAcre: data.landAreaAcre != null ? String(data.landAreaAcre) : null,
    landAreaHectare: data.landAreaHectare != null ? String(data.landAreaHectare) : null,
    landTenure: data.landTenure || null,
    leaseExpiryDate: data.leaseExpiryDate ? new Date(data.leaseExpiryDate) : null,

    // Building fields (BLDG_001–016)
    buildingCompletionStatus: data.buildingCompletionStatus || null,
    roofType: data.roofType || null,
    exteriorCondition: data.exteriorCondition || null,
    interiorCondition: data.interiorCondition || null,

    // External development (BLDA_001–006)
    externalDevAreaSqM: data.externalDevAreaSqM != null ? String(data.externalDevAreaSqM) : null,
    externalDevAreaSqFt: data.externalDevAreaSqFt != null ? String(data.externalDevAreaSqFt) : null,
    industrialStructures: data.industrialStructures || null,

    // Building compliance
    approvedPlanAuthority: data.approvedPlanAuthority || null,
    approvedPlanDate: data.approvedPlanDate ? new Date(data.approvedPlanDate) : null,
    approvedPlanValidity: data.approvedPlanValidity ? new Date(data.approvedPlanValidity) : null,
    planGenuinenessVerified: data.planGenuinenessVerified ?? null,
    remainingLifeYears: data.remainingLifeYears ?? null,
    unauthorizedConstruction: data.unauthorizedConstruction ?? null,
    unauthorizedConstructionNotes: data.unauthorizedConstructionNotes || null,
    demolitionProceedings: data.demolitionProceedings ?? null,
    demolitionProceedingsNotes: data.demolitionProceedingsNotes || null,

    // Legal document references
    registrationNo: data.registrationNo || null,
    registrationDate: data.registrationDate ? new Date(data.registrationDate) : null,
    indexIINo: data.indexIINo || null,
    agreementValue: data.agreementValue != null ? String(data.agreementValue) : null,
    stampDutyPaid: data.stampDutyPaid != null ? String(data.stampDutyPaid) : null,
    occupancyCertificateNo: data.occupancyCertificateNo || null,
    approvedPlanNo: data.approvedPlanNo || null,
    sharesCertificateNo: data.sharesCertificateNo || null,

    // Grouped JSON fields (only update if provided)
    ...(data.areaClassification !== undefined && { areaClassification: data.areaClassification }),
    ...(data.physicalDetails !== undefined && { physicalDetails: data.physicalDetails }),
    ...(data.boundaryDetails !== undefined && { boundaryDetails: data.boundaryDetails }),
    ...(data.buildingFloors !== undefined && { buildingFloors: data.buildingFloors }),

    missingDocuments: data.missingDocuments ?? null,
  };

  await prisma.property.update({
    where: { assignmentId },
    data: updateData,
  });

  await createAuditLog({
    tenantId,
    userId,
    action: 'property_data.saved',
    entityType: 'Property',
    entityId: assignment.property?.id ?? assignmentId,
    before: before as unknown as Record<string, unknown>,
    after: updateData,
  });
}

// ─────────────────────────────────────────────
// 3. Verify property data → advance status to DATA_VERIFIED
// ─────────────────────────────────────────────

export async function verifyPropertyData(
  assignmentId: string,
  tenantId: string,
  userId: string,
): Promise<void> {
  const assignment = await getAssignmentOrThrow(assignmentId, tenantId);

  // Allow verify from OCR_COMPLETE or re-verify from DATA_VERIFIED
  const validFromStatuses = [AssignmentStatus.OCR_COMPLETE, AssignmentStatus.DATA_VERIFIED];
  if (!validFromStatuses.includes(assignment.status as AssignmentStatus)) {
    throw new AppError(422, `Property data can only be verified when assignment is in OCR_COMPLETE or DATA_VERIFIED status. Current: ${assignment.status}`);
  }

  // Mark property as verified
  await prisma.property.update({
    where: { assignmentId },
    data: {
      dataVerifiedAt: new Date(),
      dataVerifiedById: userId,
    },
  });

  // Advance status to DATA_VERIFIED (only if currently OCR_COMPLETE)
  if (assignment.status === AssignmentStatus.OCR_COMPLETE) {
    validateTransition(assignment.status, AssignmentStatus.DATA_VERIFIED);
    await prisma.assignment.update({
      where: { id: assignmentId },
      data: { status: AssignmentStatus.DATA_VERIFIED },
    });
  }

  await createAuditLog({
    tenantId,
    userId,
    action: 'property_data.verified',
    entityType: 'Assignment',
    entityId: assignmentId,
    before: { status: assignment.status },
    after: { status: AssignmentStatus.DATA_VERIFIED },
  });
}

// ─────────────────────────────────────────────
// 4. Get property data (for display on Property Data tab)
// ─────────────────────────────────────────────

export async function getPropertyData(
  assignmentId: string,
  tenantId: string,
) {
  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, tenantId },
    include: { property: true },
  });
  if (!assignment) throw new NotFoundError('Assignment');

  // Count OCR-ready documents
  const ocrReadyCount = await prisma.document.count({
    where: {
      assignmentId,
      tenantId,
      isDeleted: false,
      ocrStatus: { in: ['COMPLETED', 'NEEDS_REVIEW'] },
    },
  });

  return {
    property: assignment.property,
    assignmentStatus: assignment.status,
    ocrReadyDocumentCount: ocrReadyCount,
  };
}
