import { z } from 'zod';
import { BankCode, PropertyType } from '../types/enums.js';

// ─────────────────────────────────────────────
// Generate Report
// ─────────────────────────────────────────────

export const GenerateReportSchema = z.object({
  assignmentId: z.string().uuid(),
  templateId: z.string().uuid(),
  valuationRunId: z.string().uuid().optional(),
});

// ─────────────────────────────────────────────
// List Templates query
// ─────────────────────────────────────────────

export const ListTemplatesSchema = z.object({
  bankCode: z.nativeEnum(BankCode).optional(),
  propertyType: z.nativeEnum(PropertyType).optional(),
  isUnderConstruction: z.coerce.boolean().optional(),
});

// ─────────────────────────────────────────────
// Deliver Report
// ─────────────────────────────────────────────

export const DeliverReportSchema = z.object({
  recipientEmail: z.string().email(),
  recipientName: z.string().min(2).max(200),
  message: z.string().max(1000).optional(),
  includeDocx: z.boolean().default(false),
});

// ─────────────────────────────────────────────
// Update Report Status (manual override by admin)
// ─────────────────────────────────────────────

export const UpdateReportStatusSchema = z.object({
  status: z.enum(['UNDER_REVIEW', 'APPROVED', 'REJECTED']),
  notes: z.string().max(1000).optional(),
});

export type GenerateReportInput = z.infer<typeof GenerateReportSchema>;
export type ListTemplatesInput = z.infer<typeof ListTemplatesSchema>;
export type DeliverReportInput = z.infer<typeof DeliverReportSchema>;
export type UpdateReportStatusInput = z.infer<typeof UpdateReportStatusSchema>;
