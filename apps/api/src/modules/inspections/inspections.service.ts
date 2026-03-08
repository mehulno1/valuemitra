/**
 * Inspections Service — Phase B of the valuation workflow
 *
 * Flow:
 * 1. Admin/Valuer assigns an inspector (any tenant user) + optional scheduled date
 *    → status: DATA_VERIFIED → INSPECTION_SCHEDULED
 * 2. Inspector fills fields + uploads photos (via documents module with INSPECTION_PHOTO type)
 * 3. Inspector submits → isComplete = true, inspectionDate copied to Assignment
 *    → status: INSPECTION_SCHEDULED → INSPECTION_DONE
 */

import { prisma } from '../../config/database.js';
import { Prisma } from '@prisma/client';
import { createAuditLog } from '../../middleware/audit.middleware.js';
import { NotFoundError, AppError, ForbiddenError } from '../../middleware/error.middleware.js';
import { AssignmentStatus, ASSIGNMENT_STATUS_TRANSITIONS, UserRole } from '@valuemitra/shared';
import type { AssignInspectionInput, SaveInspectionInput } from '@valuemitra/shared';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

async function getAssignmentOrThrow(assignmentId: string, tenantId: string) {
  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, tenantId },
    include: { property: true, inspection: { include: { inspector: { select: { id: true, fullName: true, email: true, role: true } } } } },
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
// 1. Assign inspector
// ─────────────────────────────────────────────

export async function assignInspection(
  assignmentId: string,
  tenantId: string,
  assignedByUserId: string,
  input: AssignInspectionInput,
): Promise<void> {
  const assignment = await getAssignmentOrThrow(assignmentId, tenantId);

  // Allow assignment from any pre-inspection status
  const validFromStatuses: AssignmentStatus[] = [
    AssignmentStatus.INITIATED,
    AssignmentStatus.ASSIGNED,
    AssignmentStatus.OCR_COMPLETE,
    AssignmentStatus.DATA_VERIFIED,
    AssignmentStatus.INSPECTION_SCHEDULED, // re-assignment
  ];
  if (!validFromStatuses.includes(assignment.status as AssignmentStatus)) {
    throw new AppError(
      422,
      `Cannot assign inspection when assignment is in ${assignment.status} status.`,
    );
  }

  // Validate inspector user exists in tenant
  const inspector = await prisma.user.findFirst({
    where: { id: input.inspectorId, tenantId, isActive: true },
    select: { id: true, fullName: true, email: true, role: true },
  });
  if (!inspector) throw new NotFoundError('Inspector user');

  const scheduledDate = input.scheduledDate ? new Date(input.scheduledDate) : null;

  // Upsert inspection record
  await prisma.inspection.upsert({
    where: { assignmentId },
    create: {
      tenantId,
      assignmentId,
      inspectorId: input.inspectorId,
      scheduledDate,
    },
    update: {
      inspectorId: input.inspectorId,
      scheduledDate,
      // If re-assigning, reset completion (admin decision to re-inspect)
      isComplete: false,
      submittedAt: null,
    },
  });

  // Advance status to INSPECTION_SCHEDULED if not already there
  if (assignment.status !== AssignmentStatus.INSPECTION_SCHEDULED) {
    validateTransition(assignment.status, AssignmentStatus.INSPECTION_SCHEDULED);
    await prisma.assignment.update({
      where: { id: assignmentId },
      data: { status: AssignmentStatus.INSPECTION_SCHEDULED },
    });
  }

  // Queue email notification to inspector
  await prisma.notification.create({
    data: {
      tenantId,
      assignmentId,
      recipientEmail: inspector.email,
      recipientName: inspector.fullName,
      channel: 'EMAIL',
      type: 'INSPECTION_ASSIGNED',
      subject: `Inspection assigned: ${assignment.assignmentNo}`,
      body: `You have been assigned to conduct a site inspection for assignment ${assignment.assignmentNo}${scheduledDate ? ` scheduled on ${scheduledDate.toLocaleDateString('en-IN')}` : ''}.`,
      status: 'PENDING',
    },
  });

  await createAuditLog({
    tenantId,
    userId: assignedByUserId,
    action: 'inspection.assigned',
    entityType: 'Assignment',
    entityId: assignmentId,
    before: { status: assignment.status, inspectorId: assignment.inspection?.inspectorId },
    after: { status: AssignmentStatus.INSPECTION_SCHEDULED, inspectorId: input.inspectorId },
  });
}

// ─────────────────────────────────────────────
// 2. Get inspection
// ─────────────────────────────────────────────

export async function getInspection(assignmentId: string, tenantId: string) {
  const inspection = await prisma.inspection.findUnique({
    where: { assignmentId },
    include: {
      inspector: { select: { id: true, fullName: true, email: true, role: true } },
    },
  });

  // Verify it belongs to this tenant
  if (inspection && inspection.tenantId !== tenantId) {
    throw new ForbiddenError();
  }

  return inspection;
}

// ─────────────────────────────────────────────
// 3. Update inspection fields (save draft)
// ─────────────────────────────────────────────

export async function updateInspection(
  assignmentId: string,
  tenantId: string,
  userId: string,
  userRole: string,
  data: SaveInspectionInput,
): Promise<void> {
  const inspection = await prisma.inspection.findUnique({ where: { assignmentId } });
  if (!inspection || inspection.tenantId !== tenantId) throw new NotFoundError('Inspection');

  // Validate caller: must be the assigned inspector OR admin/valuer
  const isAdmin = [UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN].includes(userRole as UserRole);
  const isAssignedInspector = inspection.inspectorId === userId;
  if (!isAdmin && !isAssignedInspector) {
    throw new ForbiddenError('Only the assigned inspector or an admin can update this inspection.');
  }

  if (inspection.isComplete && !isAdmin) {
    throw new AppError(409, 'Inspection has already been submitted. Contact admin to re-open.');
  }

  const before = { ...inspection };

  await prisma.inspection.update({
    where: { assignmentId },
    data: {
      inspectionDate: data.inspectionDate ? new Date(data.inspectionDate) : undefined,
      propertyShownBy: data.propertyShownBy || null,
      propertyShownByPhone: data.propertyShownByPhone || null,
      propertyShownByDesignation: data.propertyShownByDesignation || null,

      // Occupancy details
      occupancyStatus: data.occupancyStatus ?? null,
      occupantName: data.occupantName || null,
      occupantRelation: data.occupantRelation || null,
      occupiedSince: data.occupiedSince || null,

      // Identification
      flatNumberDisplayed: data.flatNumberDisplayed ?? null,
      flatNumberAsDisplayed: data.flatNumberAsDisplayed || null,
      nameOnBoard: data.nameOnBoard || null,

      // Construction & condition
      constructionQuality: data.constructionQuality ?? null,
      maintenanceCondition: data.maintenanceCondition ?? null,

      // Amenities
      amenities: data.amenities ?? undefined,

      // Unit finishes
      flooringType: data.flooringType || null,
      wallFinishing: data.wallFinishing || null,
      ceilingHeightFt: data.ceilingHeightFt != null ? String(data.ceilingHeightFt) : null,
      doorsWindowsType: data.doorsWindowsType || null,
      electricalFittings: data.electricalFittings || null,
      sanitaryFittings: data.sanitaryFittings || null,
      acType: data.acType || null,
      leaseholdDetails: data.leaseholdDetails || null,

      // INS_003–008: Distances
      nearestStationName: data.nearestStationName || null,
      distanceFromStationKm: data.distanceFromStationKm != null ? String(data.distanceFromStationKm) : null,
      nearestBusStopName: data.nearestBusStopName || null,
      distanceFromBusStopKm: data.distanceFromBusStopKm != null ? String(data.distanceFromBusStopKm) : null,
      distanceFromSchoolKm: data.distanceFromSchoolKm != null ? String(data.distanceFromSchoolKm) : null,
      distanceFromHospitalKm: data.distanceFromHospitalKm != null ? String(data.distanceFromHospitalKm) : null,

      // INS_009–013
      groundFloorType: data.groundFloorType ?? null,
      storeyHeightFt: data.storeyHeightFt != null ? String(data.storeyHeightFt) : null,
      flatsPerFloor: data.flatsPerFloor ?? null,
      numberOfWings: data.numberOfWings ?? null,
      numberOfLifts: data.numberOfLifts ?? null,

      // INS_014
      compoundWallGateType: data.compoundWallGateType || null,

      // INS_016–023 additional finishes
      flooringExternal: data.flooringExternal || null,
      flooringStaircase: data.flooringStaircase || null,
      flooringLobby: data.flooringLobby || null,
      waterSupplyType: data.waterSupplyType || null,
      waterSupplyQuality: data.waterSupplyQuality ?? null,
      electrificationType: data.electrificationType || null,
      plumbingType: data.plumbingType ?? null,
      externalWallFinish: data.externalWallFinish || null,
      roofType: data.roofType || null,
      doorType: data.doorType || null,
      windowType: data.windowType || null,
      kitchenPlatformMaterial: data.kitchenPlatformMaterial || null,

      // INS_028–032
      numberOfRooms: data.numberOfRooms ?? null,
      numberOfToilets: data.numberOfToilets ?? null,
      numberOfBalconies: data.numberOfBalconies ?? null,
      numberOfTerraces: data.numberOfTerraces ?? null,
      accommodationDescription: data.accommodationDescription || null,

      // INS_033–044 UC stage tracking
      rccSlabCompleteFloor: data.rccSlabCompleteFloor || null,
      brickworkCompleteFloor: data.brickworkCompleteFloor || null,
      internalPlasterStatus: data.internalPlasterStatus ?? null,
      externalPlasterStatus: data.externalPlasterStatus ?? null,
      flooringWorkStatus: data.flooringWorkStatus ?? null,
      woodworkStatus: data.woodworkStatus ?? null,
      internalPaintingStatus: data.internalPaintingStatus ?? null,
      externalPaintingStatus: data.externalPaintingStatus ?? null,
      plumbingWorkStatus: data.plumbingWorkStatus ?? null,
      electrificationWorkStatus: data.electrificationWorkStatus ?? null,
      liftInstallationStatus: data.liftInstallationStatus ?? null,
      finalFinishingStatus: data.finalFinishingStatus ?? null,

      // INS_045–050
      observedRateCarpet: data.observedRateCarpet != null ? String(data.observedRateCarpet) : null,
      observedRateSuba: data.observedRateSuba != null ? String(data.observedRateSuba) : null,
      inspectorValueEstimate: data.inspectorValueEstimate != null ? String(data.inspectorValueEstimate) : null,
      brokerName: data.brokerName || null,
      brokerPhone: data.brokerPhone || null,
      brokerFirmName: data.brokerFirmName || null,

      // Neighbourhood
      neighborhoodType: data.neighborhoodType || null,
      approachRoadWidth: data.approachRoadWidth || null,
      observationRemarks: data.observationRemarks || null,

      // New fields
      useOfProperty: data.useOfProperty || null,
      parkingType: data.parkingType || null,
      parkingCount: data.parkingCount ?? null,
      documentsAvailableAtSite: data.documentsAvailableAtSite ?? Prisma.JsonNull,
      otherDocumentsNote: data.otherDocumentsNote || null,
      internalAccessAllowed: data.internalAccessAllowed ?? null,
      observedBoundaries: data.observedBoundaries ?? Prisma.JsonNull,

      // Actual site measurements
      builtUpAreaActualSqM: data.builtUpAreaActualSqM != null ? String(data.builtUpAreaActualSqM) : null,
      builtUpAreaActualSqFt: data.builtUpAreaActualSqFt != null ? String(data.builtUpAreaActualSqFt) : null,
      carpetAreaActualSqM: data.carpetAreaActualSqM != null ? String(data.carpetAreaActualSqM) : null,
      carpetAreaActualSqFt: data.carpetAreaActualSqFt != null ? String(data.carpetAreaActualSqFt) : null,
      landAreaActualSqM: data.landAreaActualSqM != null ? String(data.landAreaActualSqM) : null,
      landAreaActualSqFt: data.landAreaActualSqFt != null ? String(data.landAreaActualSqFt) : null,
    },
  });

  // Sync actual measurements to Property model so Property Data tab auto-populates
  const hasAnyActual = data.builtUpAreaActualSqM != null || data.builtUpAreaActualSqFt != null
    || data.carpetAreaActualSqM != null || data.carpetAreaActualSqFt != null
    || data.landAreaActualSqM != null || data.landAreaActualSqFt != null;
  if (hasAnyActual) {
    await prisma.property.updateMany({
      where: { assignmentId },
      data: {
        ...(data.builtUpAreaActualSqM != null && { builtUpAreaActualSqM: String(data.builtUpAreaActualSqM) }),
        ...(data.builtUpAreaActualSqFt != null && { builtUpAreaActualSqFt: String(data.builtUpAreaActualSqFt) }),
        ...(data.carpetAreaActualSqM != null && { carpetAreaActualSqM: String(data.carpetAreaActualSqM) }),
        ...(data.carpetAreaActualSqFt != null && { carpetAreaActualSqFt: String(data.carpetAreaActualSqFt) }),
        ...(data.landAreaActualSqM != null && { landAreaActualSqM: String(data.landAreaActualSqM) }),
        ...(data.landAreaActualSqFt != null && { landAreaActualSqFt: String(data.landAreaActualSqFt) }),
      },
    });
  }

  await createAuditLog({
    tenantId,
    userId,
    action: 'inspection.updated',
    entityType: 'Inspection',
    entityId: inspection.id,
    before: before as unknown as Record<string, unknown>,
    after: data as unknown as Record<string, unknown>,
  });
}

// ─────────────────────────────────────────────
// 4. Submit inspection → mark complete + advance status
// ─────────────────────────────────────────────

export async function submitInspection(
  assignmentId: string,
  tenantId: string,
  userId: string,
  userRole: string,
): Promise<void> {
  const inspection = await prisma.inspection.findUnique({ where: { assignmentId } });
  if (!inspection || inspection.tenantId !== tenantId) throw new NotFoundError('Inspection');

  const isAdmin = [UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN].includes(userRole as UserRole);
  const isAssignedInspector = inspection.inspectorId === userId;
  if (!isAdmin && !isAssignedInspector) {
    throw new ForbiddenError('Only the assigned inspector or an admin can submit this inspection.');
  }

  if (inspection.isComplete) {
    throw new AppError(409, 'Inspection has already been submitted.');
  }

  // inspectionDate is mandatory (IBBI compliance)
  if (!inspection.inspectionDate) {
    throw new AppError(400, 'Inspection date must be set before submitting.');
  }

  const assignment = await getAssignmentOrThrow(assignmentId, tenantId);
  validateTransition(assignment.status, AssignmentStatus.INSPECTION_DONE);

  const now = new Date();

  await prisma.$transaction([
    prisma.inspection.update({
      where: { assignmentId },
      data: { isComplete: true, submittedAt: now },
    }),
    prisma.assignment.update({
      where: { id: assignmentId },
      data: {
        status: AssignmentStatus.INSPECTION_DONE,
        inspectionDate: inspection.inspectionDate,
      },
    }),
  ]);

  await createAuditLog({
    tenantId,
    userId,
    action: 'inspection.submitted',
    entityType: 'Assignment',
    entityId: assignmentId,
    before: { status: assignment.status, isComplete: false },
    after: { status: AssignmentStatus.INSPECTION_DONE, isComplete: true },
  });
}

// ─────────────────────────────────────────────
// 5. Get inspector's own pending assignments
// ─────────────────────────────────────────────

export async function getMyInspections(tenantId: string, userId: string) {
  return prisma.inspection.findMany({
    where: {
      tenantId,
      inspectorId: userId,
      isComplete: false,
    },
    include: {
      assignment: {
        select: {
          id: true,
          assignmentNo: true,
          status: true,
          propertyType: true,
          property: {
            select: {
              addressLine1: true,
              city: true,
              state: true,
            },
          },
        },
      },
    },
    orderBy: [{ scheduledDate: 'asc' }, { createdAt: 'asc' }],
  });
}
