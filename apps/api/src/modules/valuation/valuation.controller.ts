import type { Request, Response } from 'express';
import { asyncHandler } from '../../middleware/error.middleware.js';
import {
  createValuationRun,
  listValuationRuns,
  getValuationRun,
  updateMarketComparison,
  updateCostApproach,
  updateIncomeApproach,
  finalizeValuationRun,
  deleteValuationRun,
} from './valuation.service.js';
import {
  CreateValuationRunSchema,
  UpdateMarketComparisonSchema,
  UpdateCostApproachSchema,
  UpdateIncomeApproachSchema,
  FinalizeValuationSchema,
} from '@valuemitra/shared';

// POST /api/valuation
export const create = asyncHandler(async (req: Request, res: Response) => {
  const input = CreateValuationRunSchema.parse(req.body);
  const run = await createValuationRun(input, req.user!.tenantId, req.user!.id);
  res.status(201).json({ success: true, data: run });
});

// GET /api/valuation/:assignmentId
export const listByAssignment = asyncHandler(async (req: Request, res: Response) => {
  const runs = await listValuationRuns(req.params['assignmentId']!, req.user!.tenantId);
  res.json({ success: true, data: runs });
});

// GET /api/valuation/run/:id
export const getOne = asyncHandler(async (req: Request, res: Response) => {
  const run = await getValuationRun(req.params['id']!, req.user!.tenantId);
  res.json({ success: true, data: run });
});

// PATCH /api/valuation/run/:id/market
export const updateMarket = asyncHandler(async (req: Request, res: Response) => {
  const input = UpdateMarketComparisonSchema.parse(req.body);
  const run = await updateMarketComparison(req.params['id']!, req.user!.tenantId, input);
  res.json({ success: true, data: run });
});

// PATCH /api/valuation/run/:id/cost
export const updateCost = asyncHandler(async (req: Request, res: Response) => {
  const input = UpdateCostApproachSchema.parse(req.body);
  const run = await updateCostApproach(req.params['id']!, req.user!.tenantId, input);
  res.json({ success: true, data: run });
});

// PATCH /api/valuation/run/:id/income
export const updateIncome = asyncHandler(async (req: Request, res: Response) => {
  const input = UpdateIncomeApproachSchema.parse(req.body);
  const run = await updateIncomeApproach(req.params['id']!, req.user!.tenantId, input);
  res.json({ success: true, data: run });
});

// POST /api/valuation/run/:id/finalize
export const finalize = asyncHandler(async (req: Request, res: Response) => {
  const input = FinalizeValuationSchema.parse(req.body);
  const run = await finalizeValuationRun(req.params['id']!, req.user!.tenantId, input);
  res.json({ success: true, data: run });
});

// DELETE /api/valuation/run/:id
export const deleteOne = asyncHandler(async (req: Request, res: Response) => {
  await deleteValuationRun(req.params['id']!, req.user!.tenantId);
  res.json({ success: true });
});
