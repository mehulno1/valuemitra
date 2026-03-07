import { Request, Response } from 'express';
import { asyncHandler } from '../../middleware/error.middleware.js';
import { SavePropertyDataSchema } from '@valuemitra/shared';
import {
  extractPropertyData,
  savePropertyData,
  verifyPropertyData,
  getPropertyData,
} from './property-data.service.js';

export const getPropertyDataHandler = asyncHandler(async (req: Request, res: Response) => {
  const { assignmentId } = req.params as { assignmentId: string };
  const { tenantId } = req.user!;
  const result = await getPropertyData(assignmentId, tenantId);
  res.json({ success: true, data: result });
});

export const extractPropertyDataHandler = asyncHandler(async (req: Request, res: Response) => {
  const { assignmentId } = req.params as { assignmentId: string };
  const { tenantId } = req.user!;
  const result = await extractPropertyData(assignmentId, tenantId);
  res.json({ success: true, data: result });
});

export const savePropertyDataHandler = asyncHandler(async (req: Request, res: Response) => {
  const { assignmentId } = req.params as { assignmentId: string };
  const { tenantId, id: userId } = req.user!;
  const data = SavePropertyDataSchema.parse(req.body);
  await savePropertyData(assignmentId, tenantId, userId, data);
  res.json({ success: true });
});

export const verifyPropertyDataHandler = asyncHandler(async (req: Request, res: Response) => {
  const { assignmentId } = req.params as { assignmentId: string };
  const { tenantId, id: userId } = req.user!;
  await verifyPropertyData(assignmentId, tenantId, userId);
  res.json({ success: true });
});
