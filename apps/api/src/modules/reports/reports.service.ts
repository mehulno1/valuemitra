/**
 * Reports Service
 * Orchestrates: IBBI gate → data assembly → DOCX generation → PDF conversion
 *               → storage upload → DB record creation.
 */

import * as path from 'path';
import { prisma } from '../../config/database.js';
import { uploadFile, getSignedDownloadUrl, getFileBuffer } from '../../config/storage.js';
import { createAuditLog } from '../../middleware/audit.middleware.js';
import { NotFoundError, AppError } from '../../middleware/error.middleware.js';
import { buildReportData } from './report-data.builder.js';
import { generateDocx } from './docx-generator.js';
import { convertDocxToPdf } from './pdf-converter.js';
import type {
  GenerateReportInput,
  ListTemplatesInput,
  DeliverReportInput,
} from '@valuemitra/shared';

// ─────────────────────────────────────────────
// List report templates (with optional filters)
// ─────────────────────────────────────────────

export async function listTemplates(tenantId: string, filters: ListTemplatesInput) {
  return prisma.reportTemplate.findMany({
    where: {
      OR: [{ tenantId }, { tenantId: null }],
      isActive: true,
      ...(filters.bankCode ? { bankCode: filters.bankCode } : {}),
      ...(filters.propertyType ? { propertyType: filters.propertyType } : {}),
      ...(filters.isUnderConstruction !== undefined
        ? { isUnderConstruction: filters.isUnderConstruction }
        : {}),
    },
    orderBy: [{ bankCode: 'asc' }, { name: 'asc' }],
  });
}

// ─────────────────────────────────────────────
// Get single template
// ─────────────────────────────────────────────

export async function getTemplate(templateId: string, tenantId: string) {
  const template = await prisma.reportTemplate.findFirst({
    where: {
      id: templateId,
      isActive: true,
      OR: [{ tenantId }, { tenantId: null }],
    },
  });
  if (!template) throw new NotFoundError('Report template');
  return template;
}

// ─────────────────────────────────────────────
// Generate Report — main pipeline
// ─────────────────────────────────────────────

export async function generateReport(
  input: GenerateReportInput,
  tenantId: string,
  userId: string,
): Promise<{ reportId: string; docxUrl: string; pdfUrl: string }> {
  // 1. Load template
  const template = await getTemplate(input.templateId, tenantId);

  // 2. Build report data (includes IBBI compliance gate)
  const reportData = await buildReportData(
    input.assignmentId,
    tenantId,
    userId,
    input.valuationRunId,
  );

  // 3. Fetch template file from storage
  const templateBuffer = await getFileBuffer(template.templateFilePath);

  // 4. Generate DOCX
  const docxBuffer = generateDocx({ templateBuffer, data: reportData });

  // 5. Convert to PDF
  const pdfBuffer = await convertDocxToPdf(docxBuffer);

  // 6. Determine version number (mark old reports as not latest)
  const existingCount = await prisma.report.count({
    where: { assignmentId: input.assignmentId },
  });
  const version = existingCount + 1;

  // Mark all previous reports as not latest
  await prisma.report.updateMany({
    where: { assignmentId: input.assignmentId, isLatest: true },
    data: { isLatest: false },
  });

  // 7. Upload DOCX + PDF to storage
  const timestamp = Date.now();
  const docxStoragePath = `reports/${tenantId}/${input.assignmentId}/v${version}_${timestamp}.docx`;
  const pdfStoragePath  = `reports/${tenantId}/${input.assignmentId}/v${version}_${timestamp}.pdf`;

  await Promise.all([
    uploadFile(docxBuffer, docxStoragePath, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    uploadFile(pdfBuffer, pdfStoragePath, 'application/pdf'),
  ]);

  // 8. Create Report DB record
  const report = await prisma.report.create({
    data: {
      assignmentId: input.assignmentId,
      templateId: input.templateId,
      valuationRunId: input.valuationRunId,
      status: 'GENERATED',
      docxPath: docxStoragePath,
      pdfPath: pdfStoragePath,
      reportData: reportData as unknown as object,
      version,
      isLatest: true,
      generatedAt: new Date(),
    },
  });

  // 9. Audit log
  await createAuditLog({
    tenantId,
    userId,
    action: 'report.generated',
    entityType: 'Report',
    entityId: report.id,
    after: { version, assignmentId: input.assignmentId, templateId: input.templateId },
  });

  // 10. Get signed download URLs
  const [docxUrl, pdfUrl] = await Promise.all([
    getSignedDownloadUrl(docxStoragePath),
    getSignedDownloadUrl(pdfStoragePath),
  ]);

  return { reportId: report.id, docxUrl, pdfUrl };
}

// ─────────────────────────────────────────────
// List reports for an assignment
// ─────────────────────────────────────────────

export async function listReports(assignmentId: string, tenantId: string) {
  // Verify assignment belongs to tenant
  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, tenantId },
  });
  if (!assignment) throw new NotFoundError('Assignment');

  return prisma.report.findMany({
    where: { assignmentId },
    include: { template: { select: { name: true, bankCode: true, propertyType: true } } },
    orderBy: { version: 'desc' },
  });
}

// ─────────────────────────────────────────────
// Get single report with download URLs
// ─────────────────────────────────────────────

export async function getReport(reportId: string, tenantId: string) {
  const report = await prisma.report.findFirst({
    where: { id: reportId, assignment: { tenantId } },
    include: { template: true },
  });
  if (!report) throw new NotFoundError('Report');

  // Generate signed download URLs
  const [docxUrl, pdfUrl] = await Promise.all([
    report.docxPath ? getSignedDownloadUrl(report.docxPath) : Promise.resolve(null),
    report.pdfPath  ? getSignedDownloadUrl(report.pdfPath)  : Promise.resolve(null),
  ]);

  return { ...report, docxUrl, pdfUrl };
}

// ─────────────────────────────────────────────
// Update report status
// ─────────────────────────────────────────────

export async function updateReportStatus(
  reportId: string,
  tenantId: string,
  userId: string,
  status: 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED',
  notes?: string,
) {
  const report = await prisma.report.findFirst({
    where: { id: reportId, assignment: { tenantId } },
  });
  if (!report) throw new NotFoundError('Report');

  const before = { status: report.status };

  const updated = await prisma.report.update({
    where: { id: reportId },
    data: { status, updatedAt: new Date() },
  });

  await createAuditLog({
    tenantId,
    userId,
    action: `report.status_changed`,
    entityType: 'Report',
    entityId: reportId,
    before,
    after: { status, notes },
  });

  return updated;
}

// ─────────────────────────────────────────────
// Deliver report by email (Stage 8 hook)
// Full SES implementation is in Stage 8.
// ─────────────────────────────────────────────

export async function deliverReport(
  reportId: string,
  tenantId: string,
  userId: string,
  input: DeliverReportInput,
) {
  const report = await prisma.report.findFirst({
    where: {
      id: reportId,
      assignment: { tenantId },
      status: { in: ['APPROVED', 'SIGNED', 'GENERATED'] },
    },
  });
  if (!report) throw new NotFoundError('Report (must be in APPROVED, SIGNED, or GENERATED status)');

  if (!report.pdfPath) throw new AppError(422, 'Report PDF not yet generated');

  // Create a notification record for the email job (SES sending handled in Stage 8)
  const notification = await prisma.notification.create({
    data: {
      tenantId,
      assignmentId: report.assignmentId,
      recipientEmail: input.recipientEmail,
      recipientName: input.recipientName,
      channel: 'EMAIL',
      type: 'report.delivered',
      subject: `Valuation Report — ${report.assignmentId}`,
      body: input.message ?? 'Please find the attached valuation report.',
      status: 'PENDING',
    },
  });

  // Update report with delivery info
  await prisma.report.update({
    where: { id: reportId },
    data: {
      status: 'DELIVERED',
      deliveredAt: new Date(),
      deliveredToEmail: input.recipientEmail,
    },
  });

  await createAuditLog({
    tenantId,
    userId,
    action: 'report.delivered',
    entityType: 'Report',
    entityId: reportId,
    after: { recipientEmail: input.recipientEmail },
  });

  return { reportId, notificationId: notification.id, status: 'PENDING' };
}
