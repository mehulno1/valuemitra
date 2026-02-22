import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../../middleware/auth.middleware.js';
import { resolveTenant } from '../../middleware/tenant.middleware.js';
import { requireNotViewer, requireValuer } from '../../middleware/auth.middleware.js';
import { env } from '../../config/env.js';
import {
  upload,
  listByAssignment,
  getDownloadUrl,
  deleteDoc,
  retryOcr,
  reviewOcr,
  waiveItem,
} from './documents.controller.js';

export const documentsRouter = Router();

// ─────────────────────────────────────────────
// Multer — memory storage (buffer passed to service → storage abstraction)
// ─────────────────────────────────────────────

const multerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_FILE_SIZE_MB * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const allowed = [
      'application/pdf',
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/tiff',
      'image/webp',
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: PDF, JPEG, PNG, TIFF, WebP`));
    }
  },
});

// All document routes require auth + tenant resolution
documentsRouter.use(authenticate, resolveTenant);

// ─────────────────────────────────────────────
// Document routes
// ─────────────────────────────────────────────

// Upload a document for an assignment
documentsRouter.post(
  '/:assignmentId/upload',
  requireNotViewer,
  multerUpload.single('file'),
  upload,
);

// List all documents + checklist for an assignment
documentsRouter.get('/:assignmentId', listByAssignment);

// Get a single document with a signed download URL
documentsRouter.get('/:documentId/download-url', getDownloadUrl);

// Soft-delete a document
documentsRouter.delete('/:documentId', requireNotViewer, deleteDoc);

// Re-queue OCR for a document
documentsRouter.post('/:documentId/ocr/retry', requireValuer, retryOcr);

// Valuer reviews + corrects OCR-extracted data
documentsRouter.patch('/:documentId/ocr-review', requireValuer, reviewOcr);

// Waive a checklist item for an assignment
documentsRouter.patch('/:assignmentId/checklist/waive', requireValuer, waiveItem);
