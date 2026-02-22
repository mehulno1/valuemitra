import type { Request, Response } from 'express';
import { asyncHandler } from '../../middleware/error.middleware.js';
import {
  uploadDocument,
  listDocuments,
  getDocumentWithUrl,
  softDeleteDocument,
  retriggerOcr,
  updateOcrReview,
  waiveChecklistItem,
} from './documents.service.js';
import {
  UploadDocumentSchema,
  UpdateOcrReviewSchema,
  WaiveChecklistItemSchema,
  DocumentType,
} from '@valuemitra/shared';

function requestContext(req: Request) {
  return {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  };
}

// POST /api/documents/:assignmentId/upload
export const upload = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ success: false, error: { code: 'NO_FILE', message: 'No file uploaded' } });
    return;
  }

  const { documentType, subType } = UploadDocumentSchema.parse({
    documentType: req.body['documentType'] as string,
    subType: req.body['subType'] as string | undefined,
  });

  const document = await uploadDocument(
    req.tenant!.id,
    req.params['assignmentId']!,
    req.user!.id,
    {
      buffer: req.file.buffer,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
    },
    { documentType, subType },
    requestContext(req),
  );

  res.status(201).json({ success: true, data: document });
});

// GET /api/documents/:assignmentId
export const listByAssignment = asyncHandler(async (req: Request, res: Response) => {
  const result = await listDocuments(req.tenant!.id, req.params['assignmentId']!);
  res.json({ success: true, data: result });
});

// GET /api/documents/:documentId/download-url
export const getDownloadUrl = asyncHandler(async (req: Request, res: Response) => {
  const doc = await getDocumentWithUrl(req.tenant!.id, req.params['documentId']!);
  res.json({ success: true, data: doc });
});

// DELETE /api/documents/:documentId
export const deleteDoc = asyncHandler(async (req: Request, res: Response) => {
  await softDeleteDocument(
    req.tenant!.id,
    req.params['documentId']!,
    req.user!.id,
    requestContext(req),
  );
  res.json({ success: true, message: 'Document deleted' });
});

// POST /api/documents/:documentId/ocr/retry
export const retryOcr = asyncHandler(async (req: Request, res: Response) => {
  const result = await retriggerOcr(
    req.tenant!.id,
    req.params['documentId']!,
    req.user!.id,
    requestContext(req),
  );
  res.json({ success: true, data: result });
});

// PATCH /api/documents/:documentId/ocr-review
export const reviewOcr = asyncHandler(async (req: Request, res: Response) => {
  const { ocrExtracted } = UpdateOcrReviewSchema.parse(req.body);
  const result = await updateOcrReview(
    req.tenant!.id,
    req.params['documentId']!,
    req.user!.id,
    ocrExtracted,
    requestContext(req),
  );
  res.json({ success: true, data: result });
});

// PATCH /api/documents/:assignmentId/checklist/waive
export const waiveItem = asyncHandler(async (req: Request, res: Response) => {
  const { documentType, notes } = WaiveChecklistItemSchema.parse(req.body);
  const result = await waiveChecklistItem(
    req.tenant!.id,
    req.params['assignmentId']!,
    req.user!.id,
    documentType as DocumentType,
    notes,
    requestContext(req),
  );
  res.json({ success: true, data: result });
});
