import { z } from 'zod';
import { DocumentType } from '../types/enums.js';

// ─────────────────────────────────────────────
// Document upload — documentType sent as form field alongside the file
// ─────────────────────────────────────────────

export const UploadDocumentSchema = z.object({
  documentType: z.nativeEnum(DocumentType),
  subType: z.string().max(100).optional(),
});

// ─────────────────────────────────────────────
// OCR review — valuer corrects extracted data
// ─────────────────────────────────────────────

export const UpdateOcrReviewSchema = z.object({
  ocrExtracted: z.record(z.unknown()),
  notes: z.string().max(1000).optional(),
});

// ─────────────────────────────────────────────
// Waive a checklist item (e.g. document not available for old property)
// ─────────────────────────────────────────────

export const WaiveChecklistItemSchema = z.object({
  documentType: z.nativeEnum(DocumentType),
  notes: z.string().min(5).max(500),
});

export type UploadDocumentInput = z.infer<typeof UploadDocumentSchema>;
export type UpdateOcrReviewInput = z.infer<typeof UpdateOcrReviewSchema>;
export type WaiveChecklistItemInput = z.infer<typeof WaiveChecklistItemSchema>;
