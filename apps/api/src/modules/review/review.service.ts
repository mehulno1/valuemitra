/**
 * Review Service — 3-Step Review Workflow
 *
 * Step 1: Valuer submits → REPORT_DRAFT → INTERNAL_REVIEW
 * Step 2: Admin advances → INTERNAL_REVIEW → CLIENT_BANK_REVIEW
 * Step 3: Admin advances → CLIENT_BANK_REVIEW → COMPLIANCE_CHECK
 * Step 4: Admin approves → COMPLIANCE_CHECK → APPROVED
 * Any step: Admin rejects → any → REPORT_DRAFT
 *
 * Each step optionally sends an email notification.
 */

import { prisma } from '../../config/database.js';
import { createAuditLog } from '../../middleware/audit.middleware.js';
import { NotFoundError, AppError, ForbiddenError } from '../../middleware/error.middleware.js';
import { AssignmentStatus, ASSIGNMENT_STATUS_TRANSITIONS } from '@valuemitra/shared';
import type {
  SubmitForReviewInput,
  AdvanceReviewInput,
  RejectReviewInput,
} from '@valuemitra/shared';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

async function getAssignmentOrThrow(assignmentId: string, tenantId: string) {
  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, tenantId },
    include: { property: true, client: true, assignedTo: true, createdBy: true },
  });
  if (!assignment) throw new NotFoundError('Assignment');
  return assignment;
}

function validateTransition(current: string, target: AssignmentStatus): void {
  const currentEnum = current as AssignmentStatus;
  const allowed = ASSIGNMENT_STATUS_TRANSITIONS[currentEnum] ?? [];
  if (!allowed.includes(target)) {
    throw new AppError(
      422,
      `Cannot transition assignment from ${current} to ${target}. Allowed: ${allowed.join(', ') || 'none'}`,
    );
  }
}

async function queueStatusNotification(params: {
  tenantId: string;
  assignmentId: string;
  assignmentNo: string;
  newStatus: string;
  recipientEmail?: string;
  recipientName?: string;
  notes?: string;
}): Promise<void> {
  if (!params.recipientEmail) return;

  await prisma.notification.create({
    data: {
      tenantId: params.tenantId,
      assignmentId: params.assignmentId,
      recipientEmail: params.recipientEmail,
      recipientName: params.recipientName,
      channel: 'EMAIL',
      type: 'assignment.status_changed',
      subject: `Assignment ${params.assignmentNo} — ${params.newStatus.replace(/_/g, ' ')}`,
      body: params.newStatus,
      status: 'PENDING',
    },
  });
}

// ─────────────────────────────────────────────
// Get current review status
// ─────────────────────────────────────────────

export async function getReviewStatus(assignmentId: string, tenantId: string) {
  const assignment = await getAssignmentOrThrow(assignmentId, tenantId);

  // Get the latest report
  const report = await prisma.report.findFirst({
    where: { assignmentId, isLatest: true },
    include: { template: { select: { name: true, bankCode: true } } },
    orderBy: { version: 'desc' },
  });

  return {
    assignmentId,
    assignmentNo: assignment.assignmentNo,
    currentStatus: assignment.status,
    reportId: report?.id,
    reportStatus: report?.status,
    reportVersion: report?.version,
    generatedAt: report?.generatedAt,
    deliveredAt: report?.deliveredAt,
    deliveredToEmail: report?.deliveredToEmail,
  };
}

// ─────────────────────────────────────────────
// Step 1: Submit for review (REPORT_DRAFT → INTERNAL_REVIEW)
// Called by VALUER after generating the report
// ─────────────────────────────────────────────

export async function submitForReview(
  assignmentId: string,
  tenantId: string,
  userId: string,
  input: SubmitForReviewInput,
) {
  const assignment = await getAssignmentOrThrow(assignmentId, tenantId);
  validateTransition(assignment.status, AssignmentStatus.INTERNAL_REVIEW);

  // Mark the linked report as UNDER_REVIEW
  await prisma.report.updateMany({
    where: { id: input.reportId, assignmentId, isLatest: true },
    data: { status: 'UNDER_REVIEW' },
  });

  const before = { status: assignment.status };
  const updated = await prisma.assignment.update({
    where: { id: assignmentId },
    data: { status: AssignmentStatus.INTERNAL_REVIEW },
  });

  await createAuditLog({
    tenantId,
    userId,
    action: 'assignment.status_changed',
    entityType: 'Assignment',
    entityId: assignmentId,
    before,
    after: { status: AssignmentStatus.INTERNAL_REVIEW, reportId: input.reportId, notes: input.notes },
  });

  await queueStatusNotification({
    tenantId,
    assignmentId,
    assignmentNo: assignment.assignmentNo,
    newStatus: AssignmentStatus.INTERNAL_REVIEW,
    recipientEmail: input.notifyEmail,
    recipientName: input.notifyName,
    notes: input.notes,
  });

  return updated;
}

// ─────────────────────────────────────────────
// Advance review step (INTERNAL_REVIEW → CLIENT_BANK_REVIEW → COMPLIANCE_CHECK → APPROVED)
// Called by TENANT_ADMIN at each gate
// ─────────────────────────────────────────────

const REVIEW_ADVANCE_MAP: Partial<Record<AssignmentStatus, AssignmentStatus>> = {
  [AssignmentStatus.INTERNAL_REVIEW]:    AssignmentStatus.CLIENT_BANK_REVIEW,
  [AssignmentStatus.CLIENT_BANK_REVIEW]: AssignmentStatus.COMPLIANCE_CHECK,
  [AssignmentStatus.COMPLIANCE_CHECK]:   AssignmentStatus.APPROVED,
};

export async function advanceReview(
  assignmentId: string,
  tenantId: string,
  userId: string,
  input: AdvanceReviewInput,
) {
  const assignment = await getAssignmentOrThrow(assignmentId, tenantId);
  const currentStatus = assignment.status as AssignmentStatus;

  const nextStatus = REVIEW_ADVANCE_MAP[currentStatus];
  if (!nextStatus) {
    throw new AppError(422, `Assignment is not in a reviewable state. Current status: ${currentStatus}`);
  }

  validateTransition(currentStatus, nextStatus);

  const before = { status: currentStatus };
  const updated = await prisma.assignment.update({
    where: { id: assignmentId },
    data: { status: nextStatus },
  });

  // When APPROVED, also update the latest report status
  if (nextStatus === AssignmentStatus.APPROVED) {
    await prisma.report.updateMany({
      where: { assignmentId, isLatest: true },
      data: { status: 'APPROVED' },
    });
  }

  await createAuditLog({
    tenantId,
    userId,
    action: 'assignment.status_changed',
    entityType: 'Assignment',
    entityId: assignmentId,
    before,
    after: { status: nextStatus, notes: input.notes },
  });

  await queueStatusNotification({
    tenantId,
    assignmentId,
    assignmentNo: assignment.assignmentNo,
    newStatus: nextStatus,
    recipientEmail: input.notifyEmail,
    recipientName: input.notifyName,
    notes: input.notes,
  });

  return updated;
}

// ─────────────────────────────────────────────
// Reject — send back to REPORT_DRAFT
// ─────────────────────────────────────────────

export async function rejectReview(
  assignmentId: string,
  tenantId: string,
  userId: string,
  input: RejectReviewInput,
) {
  const assignment = await getAssignmentOrThrow(assignmentId, tenantId);
  const reviewStatuses: string[] = [
    AssignmentStatus.INTERNAL_REVIEW,
    AssignmentStatus.CLIENT_BANK_REVIEW,
    AssignmentStatus.COMPLIANCE_CHECK,
  ];
  if (!reviewStatuses.includes(assignment.status)) {
    throw new AppError(422, `Cannot reject: assignment is not in a review state. Current: ${assignment.status}`);
  }

  const before = { status: assignment.status };
  const updated = await prisma.assignment.update({
    where: { id: assignmentId },
    data: { status: AssignmentStatus.REPORT_DRAFT },
  });

  // Revert report status to DRAFT
  await prisma.report.updateMany({
    where: { assignmentId, isLatest: true },
    data: { status: 'DRAFT' },
  });

  await createAuditLog({
    tenantId,
    userId,
    action: 'assignment.review_rejected',
    entityType: 'Assignment',
    entityId: assignmentId,
    before,
    after: { status: AssignmentStatus.REPORT_DRAFT, reason: input.reason },
  });

  await queueStatusNotification({
    tenantId,
    assignmentId,
    assignmentNo: assignment.assignmentNo,
    newStatus: `REJECTED — back to REPORT_DRAFT. Reason: ${input.reason}`,
    recipientEmail: input.notifyEmail,
    recipientName: input.notifyName,
  });

  return updated;
}

// ─────────────────────────────────────────────
// Deliver final approved report
// Updates assignment → DELIVERED and queues email with PDF attachment
// ─────────────────────────────────────────────

export async function deliverFinalReport(
  assignmentId: string,
  tenantId: string,
  userId: string,
  input: { recipientEmail: string; recipientName: string; message?: string },
) {
  const assignment = await getAssignmentOrThrow(assignmentId, tenantId);

  if (assignment.status !== AssignmentStatus.APPROVED) {
    throw new AppError(422, `Assignment must be in APPROVED status before delivery. Current: ${assignment.status}`);
  }

  const report = await prisma.report.findFirst({
    where: { assignmentId, isLatest: true, status: 'APPROVED' },
  });
  if (!report) throw new AppError(422, 'No approved report found for delivery');
  if (!report.pdfPath) throw new AppError(422, 'Report PDF not generated yet');

  // Transition assignment to DELIVERED
  validateTransition(AssignmentStatus.APPROVED, AssignmentStatus.DELIVERED);
  await prisma.assignment.update({
    where: { id: assignmentId },
    data: { status: AssignmentStatus.DELIVERED },
  });

  // Mark report as DELIVERED
  await prisma.report.update({
    where: { id: report.id },
    data: {
      status: 'DELIVERED',
      deliveredAt: new Date(),
      deliveredToEmail: input.recipientEmail,
    },
  });

  // Queue delivery email with PDF attachment
  await prisma.notification.create({
    data: {
      tenantId,
      assignmentId,
      recipientEmail: input.recipientEmail,
      recipientName: input.recipientName,
      channel: 'EMAIL',
      type: 'report.delivered',
      subject: `Valuation Report — ${assignment.assignmentNo}`,
      body: input.message ?? '',
      status: 'PENDING',
    },
  });

  await createAuditLog({
    tenantId,
    userId,
    action: 'report.delivered',
    entityType: 'Assignment',
    entityId: assignmentId,
    after: { status: AssignmentStatus.DELIVERED, recipientEmail: input.recipientEmail },
  });

  return { assignmentId, reportId: report.id, deliveredTo: input.recipientEmail };
}
