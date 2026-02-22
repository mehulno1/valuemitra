import { prisma } from '../../config/database.js';
import {
  NotFoundError,
  ForbiddenError,
  AppError,
} from '../../middleware/error.middleware.js';
import { createAuditLog } from '../../middleware/audit.middleware.js';
import {
  AssignmentStatus,
  PropertyType,
  ValuationPurpose,
  ASSIGNMENT_STATUS_TRANSITIONS,
  DOCUMENT_CHECKLISTS,
  getCurrentFinancialYear,
} from '@valuemitra/shared';

// ─────────────────────────────────────────────
// Assignment number generation
// Format: {FIRM_CODE}/{FY}/{4-digit-seq}
// ─────────────────────────────────────────────

async function generateAssignmentNo(tenantId: string, firmCode: string): Promise<string> {
  const fy = getCurrentFinancialYear();

  const result = await prisma.$queryRaw<[{ maxSeq: number | null }]>`
    SELECT MAX(CAST(SUBSTRING_INDEX(assignmentNo, '/', -1) AS UNSIGNED)) as maxSeq
    FROM assignments
    WHERE tenantId = ${tenantId}
      AND assignmentNo LIKE ${`%/${fy}/%`}
    FOR UPDATE
  `;

  const nextSeq = (result[0]?.maxSeq ?? 0) + 1;
  const seq = String(nextSeq).padStart(4, '0');
  return `${firmCode}/${fy}/${seq}`;
}

// ─────────────────────────────────────────────
// List assignments
// ─────────────────────────────────────────────

export async function listAssignments(
  tenantId: string,
  filters: {
    status?: AssignmentStatus;
    assignedToId?: string;
    clientId?: string;
    propertyType?: PropertyType;
    search?: string;
    page?: number;
    limit?: number;
  },
) {
  const page = filters.page ?? 1;
  const limit = Math.min(filters.limit ?? 20, 100);
  const skip = (page - 1) * limit;

  const where = {
    tenantId,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.assignedToId ? { assignedToId: filters.assignedToId } : {}),
    ...(filters.clientId ? { clientId: filters.clientId } : {}),
    ...(filters.propertyType ? { propertyType: filters.propertyType } : {}),
    ...(filters.search
      ? {
          OR: [
            { assignmentNo: { contains: filters.search } },
            { firmReferenceNo: { contains: filters.search } },
          ],
        }
      : {}),
  };

  const [assignments, total] = await Promise.all([
    prisma.assignment.findMany({
      where,
      include: {
        client: { select: { fullName: true, companyName: true, bankName: true, bankCode: true } },
        assignedTo: { select: { id: true, fullName: true, email: true } },
        property: { select: { addressLine1: true, city: true, state: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.assignment.count({ where }),
  ]);

  return {
    data: assignments,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

// ─────────────────────────────────────────────
// Get single assignment (full detail)
// ─────────────────────────────────────────────

export async function getAssignment(tenantId: string, assignmentId: string) {
  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, tenantId },
    include: {
      client: true,
      assignedTo: {
        select: {
          id: true,
          fullName: true,
          email: true,
          ibbiRegNo: true,
          ibbiRegCategory: true,
          ibbiRegValidUpto: true,
          signatureUrl: true,
        },
      },
      property: true,
      documents: { where: { isDeleted: false } },
      checklist: true,
      valuationRuns: { orderBy: { createdAt: 'desc' }, take: 1 },
      reports: { where: { isLatest: true }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });

  if (!assignment) throw new NotFoundError('Assignment not found');
  return assignment;
}

// ─────────────────────────────────────────────
// Create assignment
// Property address is stored in the Property model
// ─────────────────────────────────────────────

export async function createAssignment(
  tenantId: string,
  actorId: string,
  firmCode: string,
  input: {
    clientId: string;
    propertyType: PropertyType;
    purposeOfValuation: ValuationPurpose;
    propertyAddress: string;
    propertyCity: string;
    propertyState: string;
    propertyPincode?: string;
    assignedToId?: string;
    inspectionDate?: Date;
    isUnderConstruction?: boolean;
    percentageCompletion?: number;
    expectedHandoverDate?: Date;
    remarks?: string;
  },
) {
  const client = await prisma.client.findFirst({ where: { id: input.clientId, tenantId } });
  if (!client) throw new NotFoundError('Client not found');

  return prisma.$transaction(async (tx) => {
    const assignmentNo = await generateAssignmentNo(tenantId, firmCode);

    const assignment = await tx.assignment.create({
      data: {
        tenantId,
        assignmentNo,
        firmReferenceNo: assignmentNo,
        clientId: input.clientId,
        createdById: actorId,
        propertyType: input.propertyType,
        purposeOfValuation: input.purposeOfValuation,
        status: AssignmentStatus.INITIATED,
        assignedToId: input.assignedToId,
        inspectionDate: input.inspectionDate,
        isUnderConstruction: input.isUnderConstruction ?? false,
        percentageCompletion: input.percentageCompletion,
        expectedHandoverDate: input.expectedHandoverDate,
        referenceNote: input.remarks,
      },
    });

    // Property address stored in Property model
    await tx.property.create({
      data: {
        assignmentId: assignment.id,
        tenantId,
        addressLine1: input.propertyAddress,
        city: input.propertyCity,
        state: input.propertyState,
        pincode: input.propertyPincode,
      },
    });

    // Auto-generate checklist
    const checklist = DOCUMENT_CHECKLISTS[input.propertyType] ?? [];
    if (checklist.length > 0) {
      await tx.checklistItem.createMany({
        data: checklist.map((item) => ({
          assignmentId: assignment.id,
          documentType: item.documentType,
          label: item.label,
          isMandatory: item.isMandatory,
          status: 'PENDING',
        })),
      });
    }

    await createAuditLog({
      tenantId,
      userId: actorId,
      action: 'assignment.created',
      entityType: 'Assignment',
      entityId: assignment.id,
      after: {
        assignmentNo,
        propertyType: input.propertyType,
        status: AssignmentStatus.INITIATED,
      },
    });

    return assignment;
  });
}

// ─────────────────────────────────────────────
// Update assignment status (lifecycle transitions)
// ─────────────────────────────────────────────

export async function updateAssignmentStatus(
  tenantId: string,
  actorId: string,
  actorRole: string,
  assignmentId: string,
  newStatus: AssignmentStatus,
  comment?: string,
) {
  const assignment = await prisma.assignment.findFirst({ where: { id: assignmentId, tenantId } });
  if (!assignment) throw new NotFoundError('Assignment not found');

  const currentStatus = assignment.status as AssignmentStatus;
  const allowed = ASSIGNMENT_STATUS_TRANSITIONS[currentStatus] ?? [];

  if (!allowed.includes(newStatus)) {
    throw new AppError(
      422,
      `Cannot transition from ${currentStatus} to ${newStatus}. Allowed: ${allowed.join(', ')}`,
    );
  }

  if (
    newStatus === AssignmentStatus.APPROVED &&
    actorRole !== 'VALUER' &&
    actorRole !== 'TENANT_ADMIN' &&
    actorRole !== 'SUPER_ADMIN'
  ) {
    throw new ForbiddenError('Only a Registered Valuer or admin can approve a report');
  }

  const updated = await prisma.assignment.update({
    where: { id: assignmentId },
    data: { status: newStatus },
  });

  await createAuditLog({
    tenantId,
    userId: actorId,
    action: 'assignment.status_changed',
    entityType: 'Assignment',
    entityId: assignmentId,
    before: { status: currentStatus },
    after: { status: newStatus, comment },
  });

  return updated;
}

// ─────────────────────────────────────────────
// Update assignment details
// ─────────────────────────────────────────────

export async function updateAssignment(
  tenantId: string,
  actorId: string,
  assignmentId: string,
  data: {
    assignedToId?: string;
    inspectionDate?: Date;
    isUnderConstruction?: boolean;
    percentageCompletion?: number;
    expectedHandoverDate?: Date;
    remarks?: string;
    propertyAddress?: string;
    propertyCity?: string;
    propertyState?: string;
    propertyPincode?: string;
  },
) {
  const existing = await prisma.assignment.findFirst({ where: { id: assignmentId, tenantId } });
  if (!existing) throw new NotFoundError('Assignment not found');

  const {
    propertyAddress, propertyCity, propertyState, propertyPincode,
    remarks, ...assignmentData
  } = data;

  const updated = await prisma.$transaction(async (tx) => {
    const asgn = await tx.assignment.update({
      where: { id: assignmentId },
      data: {
        ...assignmentData,
        ...(remarks !== undefined ? { referenceNote: remarks } : {}),
      },
    });

    if (propertyAddress !== undefined || propertyCity !== undefined || propertyState !== undefined || propertyPincode !== undefined) {
      await tx.property.upsert({
        where: { assignmentId },
        create: { assignmentId, tenantId, addressLine1: propertyAddress, city: propertyCity, state: propertyState, pincode: propertyPincode },
        update: {
          ...(propertyAddress !== undefined ? { addressLine1: propertyAddress } : {}),
          ...(propertyCity !== undefined ? { city: propertyCity } : {}),
          ...(propertyState !== undefined ? { state: propertyState } : {}),
          ...(propertyPincode !== undefined ? { pincode: propertyPincode } : {}),
        },
      });
    }

    return asgn;
  });

  await createAuditLog({
    tenantId,
    userId: actorId,
    action: 'assignment.updated',
    entityType: 'Assignment',
    entityId: assignmentId,
    before: existing as Record<string, unknown>,
    after: updated as Record<string, unknown>,
  });

  return updated;
}

// ─────────────────────────────────────────────
// Update property details (from OCR or manual entry)
// Maps front-end field names to schema field names
// ─────────────────────────────────────────────

export async function updateProperty(
  tenantId: string,
  actorId: string,
  assignmentId: string,
  data: {
    surveyNo?: string;
    ctsSurveyNo?: string;
    municipalNo?: string;
    landAreaSqM?: number;
    builtUpAreaSqFt?: number;
    carpetAreaSqFt?: number;
    yearOfConstruction?: number;
    flatNo?: string;
    numberOfFloors?: number;
    landTenure?: string;
    zoningClassification?: string;
    structureType?: string;
    extractedData?: Record<string, unknown>;
    ownerNames?: string[];
  },
) {
  const assignment = await prisma.assignment.findFirst({ where: { id: assignmentId, tenantId } });
  if (!assignment) throw new NotFoundError('Assignment not found');

  const property = await prisma.property.upsert({
    where: { assignmentId },
    create: {
      assignmentId,
      tenantId,
      surveyNo: data.surveyNo,
      ctsSurveyNo: data.ctsSurveyNo,
      municipalNo: data.municipalNo,
      landAreaSqM: data.landAreaSqM,
      builtUpAreaSqFt: data.builtUpAreaSqFt,
      carpetAreaSqFt: data.carpetAreaSqFt,
      yearOfConstruction: data.yearOfConstruction,
      flatNo: data.flatNo,
      numberOfFloors: data.numberOfFloors,
      landTenure: data.landTenure,
      zoningClassification: data.zoningClassification,
      structureType: data.structureType,
      extractedData: data.extractedData as object | undefined,
      ownerNames: data.ownerNames as object | undefined,
    },
    update: {
      surveyNo: data.surveyNo,
      ctsSurveyNo: data.ctsSurveyNo,
      municipalNo: data.municipalNo,
      landAreaSqM: data.landAreaSqM,
      builtUpAreaSqFt: data.builtUpAreaSqFt,
      carpetAreaSqFt: data.carpetAreaSqFt,
      yearOfConstruction: data.yearOfConstruction,
      flatNo: data.flatNo,
      numberOfFloors: data.numberOfFloors,
      landTenure: data.landTenure,
      zoningClassification: data.zoningClassification,
      structureType: data.structureType,
      extractedData: data.extractedData as object | undefined,
      ownerNames: data.ownerNames as object | undefined,
    },
  });

  await createAuditLog({
    tenantId,
    userId: actorId,
    action: 'property.updated',
    entityType: 'Property',
    entityId: property.id,
    after: data as Record<string, unknown>,
  });

  return property;
}
