import type { Request, Response } from 'express';
import { asyncHandler } from '../../middleware/error.middleware.js';
import { requestAIValuation, getStoredAIResult } from './ai-valuation.service.js';
import { RequestAIValuationSchema } from '@valuemitra/shared';

// POST /api/ai-valuation
export const requestValuation = asyncHandler(async (req: Request, res: Response) => {
  const input = RequestAIValuationSchema.parse(req.body);
  const result = await requestAIValuation(input, req.user!.tenantId, req.user!.id);
  res.json({ success: true, data: result });
});

// GET /api/ai-valuation/run/:id
export const getResult = asyncHandler(async (req: Request, res: Response) => {
  const result = await getStoredAIResult(req.params['id']!, req.user!.tenantId);
  if (!result) {
    res.json({ success: true, data: null, message: 'No AI valuation result stored for this run yet.' });
    return;
  }
  res.json({ success: true, data: result });
});
