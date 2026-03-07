import { Request, Response } from 'express';
import { asyncHandler } from '../../middleware/error.middleware.js';
import { AssignInspectionSchema, SaveInspectionSchema } from '@valuemitra/shared';
import {
  assignInspection,
  getInspection,
  updateInspection,
  submitInspection,
  getMyInspections,
} from './inspections.service.js';

export const getMyInspectionsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId, id: userId } = req.user!;
  const result = await getMyInspections(tenantId, userId);
  res.json({ success: true, data: result });
});

export const assignInspectionHandler = asyncHandler(async (req: Request, res: Response) => {
  const { assignmentId } = req.params as { assignmentId: string };
  const { tenantId, id: userId } = req.user!;
  const input = AssignInspectionSchema.parse(req.body);
  await assignInspection(assignmentId, tenantId, userId, input);
  res.status(201).json({ success: true });
});

export const getInspectionHandler = asyncHandler(async (req: Request, res: Response) => {
  const { assignmentId } = req.params as { assignmentId: string };
  const { tenantId } = req.user!;
  const result = await getInspection(assignmentId, tenantId);
  res.json({ success: true, data: result });
});

export const updateInspectionHandler = asyncHandler(async (req: Request, res: Response) => {
  const { assignmentId } = req.params as { assignmentId: string };
  const { tenantId, id: userId, role } = req.user!;
  const data = SaveInspectionSchema.parse(req.body);
  await updateInspection(assignmentId, tenantId, userId, role, data);
  res.json({ success: true });
});

export const submitInspectionHandler = asyncHandler(async (req: Request, res: Response) => {
  const { assignmentId } = req.params as { assignmentId: string };
  const { tenantId, id: userId, role } = req.user!;
  await submitInspection(assignmentId, tenantId, userId, role);
  res.json({ success: true });
});
