import * as crypto from 'crypto';
import * as path from 'path';
import { prisma } from '../../config/database.js';
import { uploadFile, getSignedDownloadUrl, deleteFile } from '../../config/storage.js';
import { createAuditLog } from '../../middleware/audit.middleware.js';
import {
  NotFoundError,
  ForbiddenError,
  AppError,
} from '../../middleware/error.middleware.js';
import {
  DocumentType,
  OCRStatus,
  ChecklistStatus,
  AssignmentStatus,
  JobType,
  JobStatus,
} from '@valuemitra/shared';
import { env } from '../../config/env.js';

// ─────────────────────────────────────────────
// Document types that should trigger OCR
// (photos / maps / draft reports are excluded)
// ─────────────────────────────────────────────

const OCR_ELIGIBLE_TYPES = new Set<DocumentType>([
  DocumentType.SALE_DEED,
  DocumentType.SEVEN_TWELVE_EXTRACT,
  DocumentType.EIGHT_A_EXTRACT,
  DocumentType.PROPERTY_CARD,
  DocumentType.INDEX_II,
  DocumentType.MUNICIPAL_TAX_RECEIPT,
  DocumentType.ENCUMBRANCE_CERTIFICATE,
  DocumentType.BUILDING_PLAN_APPROVAL,
  DocumentType.COMPLETION_CERTIFICATE,
  DocumentType.OCCUPANCY_CERTIFICATE,
  DocumentType.POSSESSION_CERTIFICATE,
  DocumentType.SOCIETY_NOC,
  DocumentType.TITLE_CHAIN_DOCUMENT,
  DocumentType.IDENTITY_PROOF,
  DocumentType.NA_ORDER,
  DocumentType.LAYOUT_APPROVAL,
  DocumentType.LEASE_DEED,
]);

// MIME types that Vision can process
const OCR_ELIGIBLE_MIMES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/tiff',
  'image/webp',
]);

// ─────────────────────────────────────────────
// Build storage path for an uploaded document
// Format: uploads/{tenantId}/{assignmentId}/{documentId}-{sanitizedName}
// ─────────────────────────────────────────────

function buildStoragePath(
  tenantId: string,
  assignmentId: string,
  documentId: string,
  originalName: string,
): string {
  const ext = path.extname(originalName).toLowerCase();
  const sanitized = path
    .basename(originalName, ext)
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 60);
  const prefix = env.AWS_S3_UPLOADS_PREFIX.replace(/\/$/, '');
  return `${prefix}/${tenantId}/${assignmentId}/${documentId}-${sanitized}${ext}`;
}

// ─────────────────────────────────────────────
// UPLOAD DOCUMENT
// ─────────────────────────────────────────────

export async function uploadDocument(
  tenantId: string,
  assignmentId: string,
  uploadedById: string,
  file: {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
    size: number;
  },
  opts: {
    documentType: DocumentType;
    subType?: string;
  },
  context: { ipAddress?: string; userAgent?: string },
) {
  // Verify assignment belongs to this tenant
  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, tenantId },
    select: { id: true, status: true },
  });
  if (!assignment) throw new NotFoundError('Assignment');

  // Check file size
  const maxBytes = env.MAX_FILE_SIZE_MB * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new AppError(400, `File size exceeds the ${env.MAX_FILE_SIZE_MB} MB limit`, 'FILE_TOO_LARGE');
  }

  // Compute SHA-256 checksum
  const checksum = crypto.createHash('sha256').update(file.buffer).digest('hex');

  // Generate document ID first so we can include it in the path
  const documentId = crypto.randomUUID();
  const storagePath = buildStoragePath(tenantId, assignmentId, documentId, file.originalname);

  // Upload file to storage
  await uploadFile(file.buffer, storagePath, file.mimetype);

  // Determine if OCR should be queued
  const needsOcr =
    OCR_ELIGIBLE_TYPES.has(opts.documentType) && OCR_ELIGIBLE_MIMES.has(file.mimetype);

  // Create Document record + OCR job in a single transaction
  const document = await prisma.$transaction(async (tx) => {
    const doc = await tx.document.create({
      data: {
        id: documentId,
        tenantId,
        assignmentId,
        uploadedById,
        originalName: file.originalname,
        storagePath,
        storageProvider: env.STORAGE_PROVIDER,
        mimeType: file.mimetype,
        fileSizeBytes: file.size,
        checksum,
        documentType: opts.documentType,
        subType: opts.subType,
        ocrStatus: needsOcr ? OCRStatus.QUEUED : OCRStatus.SKIPPED,
      },
    });

    // Enqueue OCR job if needed
    if (needsOcr) {
      await tx.jobQueue.create({
        data: {
          jobType: JobType.OCR_PROCESSING,
          payload: { documentId: doc.id, tenantId, assignmentId },
          status: JobStatus.PENDING,
          priority: 3,
        },
      });
    }

    // Update checklist item for this document type → UPLOADED
    await tx.checklistItem.updateMany({
      where: {
        assignmentId,
        documentType: opts.documentType,
        status: { in: [ChecklistStatus.PENDING] },
      },
      data: { status: ChecklistStatus.UPLOADED, documentId: doc.id },
    });

    return doc;
  });

  // Advance assignment status to DOCUMENTS_RECEIVED if currently DOCUMENTS_PENDING
  if (assignment.status === AssignmentStatus.DOCUMENTS_PENDING) {
    await prisma.assignment.update({
      where: { id: assignmentId },
      data: { status: AssignmentStatus.DOCUMENTS_RECEIVED },
    });
  }

  await createAuditLog({
    tenantId,
    userId: uploadedById,
    action: 'document.uploaded',
    entityType: 'Document',
    entityId: documentId,
    after: {
      documentType: opts.documentType,
      originalName: file.originalname,
      fileSizeBytes: file.size,
      ocrStatus: document.ocrStatus,
    },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });

  return document;
}

// ─────────────────────────────────────────────
// LIST DOCUMENTS FOR AN ASSIGNMENT
// ─────────────────────────────────────────────

export async function listDocuments(tenantId: string, assignmentId: string) {
  // Verify assignment belongs to tenant
  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, tenantId },
    select: { id: true },
  });
  if (!assignment) throw new NotFoundError('Assignment');

  const documents = await prisma.document.findMany({
    where: { assignmentId, tenantId, isDeleted: false },
    select: {
      id: true,
      originalName: true,
      documentType: true,
      subType: true,
      mimeType: true,
      fileSizeBytes: true,
      storagePath: true,
      storageProvider: true,
      photoCategory: true,
      ocrStatus: true,
      ocrConfidence: true,
      ocrExtracted: true,
      ocrReviewedAt: true,
      version: true,
      createdAt: true,
      uploadedBy: { select: { id: true, fullName: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const documentsWithUrls = await Promise.all(
    documents.map(async (doc) => ({
      ...doc,
      signedUrl: await getSignedDownloadUrl(doc.storagePath),
    })),
  );

  const checklist = await prisma.checklistItem.findMany({
    where: { assignmentId },
    select: {
      id: true,
      documentType: true,
      label: true,
      isMandatory: true,
      status: true,
      documentId: true,
      notes: true,
    },
  });

  return { documents: documentsWithUrls, checklist };
}

// ─────────────────────────────────────────────
// GET DOCUMENT WITH SIGNED DOWNLOAD URL
// ─────────────────────────────────────────────

export async function getDocumentWithUrl(tenantId: string, documentId: string) {
  const document = await prisma.document.findFirst({
    where: { id: documentId, tenantId, isDeleted: false },
  });
  if (!document) throw new NotFoundError('Document');

  const downloadUrl = await getSignedDownloadUrl(document.storagePath, 900); // 15 min

  return { ...document, downloadUrl };
}

// ─────────────────────────────────────────────
// SOFT DELETE DOCUMENT
// ─────────────────────────────────────────────

export async function softDeleteDocument(
  tenantId: string,
  documentId: string,
  userId: string,
  context: { ipAddress?: string; userAgent?: string },
) {
  const document = await prisma.document.findFirst({
    where: { id: documentId, tenantId, isDeleted: false },
  });
  if (!document) throw new NotFoundError('Document');

  await prisma.$transaction(async (tx) => {
    await tx.document.update({
      where: { id: documentId },
      data: { isDeleted: true, deletedAt: new Date() },
    });

    // Revert checklist item back to PENDING if it pointed to this doc
    await tx.checklistItem.updateMany({
      where: {
        assignmentId: document.assignmentId,
        documentId,
        status: ChecklistStatus.UPLOADED,
      },
      data: { status: ChecklistStatus.PENDING, documentId: null },
    });
  });

  await createAuditLog({
    tenantId,
    userId,
    action: 'document.deleted',
    entityType: 'Document',
    entityId: documentId,
    before: { documentType: document.documentType, originalName: document.originalName },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });
}

// ─────────────────────────────────────────────
// RETRY OCR — re-enqueue a failed / skipped document
// ─────────────────────────────────────────────

export async function retriggerOcr(
  tenantId: string,
  documentId: string,
  userId: string,
  context: { ipAddress?: string; userAgent?: string },
) {
  const document = await prisma.document.findFirst({
    where: { id: documentId, tenantId, isDeleted: false },
  });
  if (!document) throw new NotFoundError('Document');

  if (document.ocrStatus === OCRStatus.PROCESSING) {
    throw new AppError(409, 'OCR is already in progress for this document', 'OCR_IN_PROGRESS');
  }

  if (!OCR_ELIGIBLE_MIMES.has(document.mimeType)) {
    throw new AppError(400, 'Document MIME type does not support OCR', 'OCR_NOT_SUPPORTED');
  }

  await prisma.$transaction(async (tx) => {
    await tx.document.update({
      where: { id: documentId },
      data: { ocrStatus: OCRStatus.QUEUED },
    });

    await tx.jobQueue.create({
      data: {
        jobType: JobType.OCR_PROCESSING,
        payload: { documentId, tenantId, assignmentId: document.assignmentId },
        status: JobStatus.PENDING,
        priority: 4,
      },
    });
  });

  await createAuditLog({
    tenantId,
    userId,
    action: 'document.ocr_retriggered',
    entityType: 'Document',
    entityId: documentId,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });

  return { queued: true };
}

// ─────────────────────────────────────────────
// UPDATE OCR REVIEW — valuer corrects extracted data
// ─────────────────────────────────────────────

export async function updateOcrReview(
  tenantId: string,
  documentId: string,
  userId: string,
  ocrExtracted: Record<string, unknown>,
  context: { ipAddress?: string; userAgent?: string },
) {
  const document = await prisma.document.findFirst({
    where: { id: documentId, tenantId, isDeleted: false },
  });
  if (!document) throw new NotFoundError('Document');

  if (document.ocrStatus !== OCRStatus.COMPLETED && document.ocrStatus !== OCRStatus.NEEDS_REVIEW) {
    throw new AppError(409, 'Document has not completed OCR yet', 'OCR_NOT_READY');
  }

  const before = document.ocrExtracted;

  await prisma.document.update({
    where: { id: documentId },
    data: {
      ocrExtracted: ocrExtracted as object,
      ocrStatus: OCRStatus.COMPLETED,
      ocrReviewedAt: new Date(),
      ocrReviewedById: userId,
    },
  });

  await createAuditLog({
    tenantId,
    userId,
    action: 'document.ocr_reviewed',
    entityType: 'Document',
    entityId: documentId,
    before: { ocrExtracted: before as Record<string, unknown> },
    after: { ocrExtracted },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });

  return { updated: true };
}

// ─────────────────────────────────────────────
// WAIVE CHECKLIST ITEM
// ─────────────────────────────────────────────

export async function waiveChecklistItem(
  tenantId: string,
  assignmentId: string,
  userId: string,
  documentType: DocumentType,
  notes: string,
  context: { ipAddress?: string; userAgent?: string },
) {
  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, tenantId },
    select: { id: true },
  });
  if (!assignment) throw new NotFoundError('Assignment');

  const item = await prisma.checklistItem.findFirst({
    where: { assignmentId, documentType },
  });
  if (!item) throw new NotFoundError('Checklist item');

  const before = { status: item.status, notes: item.notes };

  await prisma.checklistItem.update({
    where: { id: item.id },
    data: { status: ChecklistStatus.WAIVED, notes },
  });

  await createAuditLog({
    tenantId,
    userId,
    action: 'checklist.waived',
    entityType: 'ChecklistItem',
    entityId: item.id,
    before,
    after: { status: ChecklistStatus.WAIVED, notes },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });

  return { waived: true };
}

// ─────────────────────────────────────────────
// SAVE OCR RESULT — called internally by OCR job worker
// ─────────────────────────────────────────────

export async function saveOcrResult(
  documentId: string,
  result: {
    status: OCRStatus;
    provider: string;
    rawResponse: Record<string, unknown>;
    extracted: Record<string, unknown>;
    confidence: number;
  },
) {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true, assignmentId: true, tenantId: true },
  });
  if (!document) return;

  await prisma.document.update({
    where: { id: documentId },
    data: {
      ocrStatus: result.status,
      ocrProvider: result.provider,
      ocrRawResponse: result.rawResponse as object,
      ocrExtracted: result.extracted as object,
      ocrConfidence: result.confidence,
    },
  });

  // If OCR completed/failed, check if all assignment docs are now processed
  await checkAndAdvanceAssignmentOcrStatus(document.assignmentId, document.tenantId);
}

// ─────────────────────────────────────────────
// Check if all docs for an assignment are OCR-done, advance status
// ─────────────────────────────────────────────

async function checkAndAdvanceAssignmentOcrStatus(
  assignmentId: string,
  tenantId: string,
): Promise<void> {
  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, tenantId },
    select: { id: true, status: true },
  });
  if (!assignment) return;

  // Only advance if currently in a post-document-upload state
  const advanceable = [
    AssignmentStatus.DOCUMENTS_RECEIVED,
    AssignmentStatus.DOCUMENTS_PENDING,
    AssignmentStatus.OCR_COMPLETE,
  ];
  if (!advanceable.includes(assignment.status as AssignmentStatus)) return;

  // Check if any docs are still pending/processing
  const pending = await prisma.document.count({
    where: {
      assignmentId,
      isDeleted: false,
      ocrStatus: { in: [OCRStatus.PENDING, OCRStatus.QUEUED, OCRStatus.PROCESSING] },
    },
  });

  if (pending === 0) {
    await prisma.assignment.update({
      where: { id: assignmentId },
      data: { status: AssignmentStatus.OCR_COMPLETE },
    });
  }
}

// ─────────────────────────────────────────────
// MARK OCR FAILED — called by job worker on unrecoverable error
// ─────────────────────────────────────────────

export async function markOcrFailed(documentId: string, reason: string) {
  await prisma.document.update({
    where: { id: documentId },
    data: { ocrStatus: OCRStatus.FAILED },
  });

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { assignmentId: true, tenantId: true },
  });
  if (document) {
    await checkAndAdvanceAssignmentOcrStatus(document.assignmentId, document.tenantId);
  }

  console.error(`OCR failed for document ${documentId}: ${reason}`);
}

// ─────────────────────────────────────────────
// Prevent cross-tenant access
// ─────────────────────────────────────────────

export function assertDocumentTenant(documentTenantId: string, requestTenantId: string): void {
  if (documentTenantId !== requestTenantId) {
    throw new ForbiddenError('Access denied');
  }
}
