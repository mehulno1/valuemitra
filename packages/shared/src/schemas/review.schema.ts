import { z } from 'zod';

// ─────────────────────────────────────────────
// Submit for Review
// ─────────────────────────────────────────────

export const SubmitForReviewSchema = z.object({
  reportId: z.string().uuid(),
  notes: z.string().max(2000).optional(),
  notifyEmail: z.string().email().optional(),
  notifyName: z.string().max(200).optional(),
});

// ─────────────────────────────────────────────
// Advance Review Step
// ─────────────────────────────────────────────

export const AdvanceReviewSchema = z.object({
  notes: z.string().max(2000).optional(),
  notifyEmail: z.string().email().optional(),
  notifyName: z.string().max(200).optional(),
});

// ─────────────────────────────────────────────
// Reject — back to REPORT_DRAFT
// ─────────────────────────────────────────────

export const RejectReviewSchema = z.object({
  reason: z.string().min(10).max(2000),
  notifyEmail: z.string().email().optional(),
  notifyName: z.string().max(200).optional(),
});

export type SubmitForReviewInput = z.infer<typeof SubmitForReviewSchema>;
export type AdvanceReviewInput = z.infer<typeof AdvanceReviewSchema>;
export type RejectReviewInput = z.infer<typeof RejectReviewSchema>;
