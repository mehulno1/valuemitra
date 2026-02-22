import type { Request, Response } from 'express';
import { asyncHandler } from '../../middleware/error.middleware.js';
import {
  getReviewStatus,
  submitForReview,
  advanceReview,
  rejectReview,
  deliverFinalReport,
} from './review.service.js';
import { SubmitForReviewSchema, AdvanceReviewSchema, RejectReviewSchema, DeliverReportSchema } from '@valuemitra/shared';

// GET /api/review/:assignmentId
export const getStatus = asyncHandler(async (req: Request, res: Response) => {
  const status = await getReviewStatus(req.params['assignmentId']!, req.user!.tenantId);
  res.json({ success: true, data: status });
});

// POST /api/review/:assignmentId/submit
export const submit = asyncHandler(async (req: Request, res: Response) => {
  const input = SubmitForReviewSchema.parse(req.body);
  const result = await submitForReview(
    req.params['assignmentId']!,
    req.user!.tenantId,
    req.user!.id,
    input,
  );
  res.json({ success: true, data: result });
});

// POST /api/review/:assignmentId/advance
export const advance = asyncHandler(async (req: Request, res: Response) => {
  const input = AdvanceReviewSchema.parse(req.body);
  const result = await advanceReview(
    req.params['assignmentId']!,
    req.user!.tenantId,
    req.user!.id,
    input,
  );
  res.json({ success: true, data: result });
});

// POST /api/review/:assignmentId/reject
export const reject = asyncHandler(async (req: Request, res: Response) => {
  const input = RejectReviewSchema.parse(req.body);
  const result = await rejectReview(
    req.params['assignmentId']!,
    req.user!.tenantId,
    req.user!.id,
    input,
  );
  res.json({ success: true, data: result });
});

// POST /api/review/:assignmentId/deliver
export const deliver = asyncHandler(async (req: Request, res: Response) => {
  const input = DeliverReportSchema.parse(req.body);
  const result = await deliverFinalReport(
    req.params['assignmentId']!,
    req.user!.tenantId,
    req.user!.id,
    {
      recipientEmail: input.recipientEmail,
      recipientName: input.recipientName,
      message: input.message,
    },
  );
  res.json({ success: true, data: result });
});
