import type { Request, Response } from 'express';
import { asyncHandler, ForbiddenError } from '../../middleware/error.middleware.js';
import {
  listAssignments,
  getAssignment,
  createAssignment,
  updateAssignment,
  updateAssignmentStatus,
  updateProperty,
  updateGeneralFields,
} from './assignments.service.js';
import { CreateAssignmentSchema, UpdateAssignmentSchema, UpdatePropertySchema, UpdateGeneralFieldsSchema } from '@valuemitra/shared';
import { AssignmentStatus } from '@valuemitra/shared';
import { z } from 'zod';

const StatusUpdateSchema = z.object({
  status: z.nativeEnum(AssignmentStatus),
  comment: z.string().max(500).optional(),
});

// GET /api/assignments
export const list = asyncHandler(async (req: Request, res: Response) => {
  const { status, assignedToId, clientId, propertyType, search, page, limit } = req.query as Record<string, string | undefined>;
  // INSPECTOR role can only see assignments where they are the assigned inspector
  const inspectorId = req.user!.role === 'INSPECTOR' ? req.user!.id : undefined;
  const result = await listAssignments(req.tenant!.id, {
    status: status as AssignmentStatus | undefined,
    assignedToId,
    inspectorId,
    clientId,
    propertyType: propertyType as never,
    search,
    page: page ? parseInt(page) : undefined,
    limit: limit ? parseInt(limit) : undefined,
  });
  res.json({ success: true, ...result });
});

// GET /api/assignments/:assignmentId
export const get = asyncHandler(async (req: Request, res: Response) => {
  const assignment = await getAssignment(req.tenant!.id, req.params['assignmentId']!);
  // INSPECTOR can only view assignments they are assigned to inspect
  if (req.user!.role === 'INSPECTOR') {
    const insp = assignment as unknown as { inspection?: { inspectorId?: string } };
    if (insp.inspection?.inspectorId !== req.user!.id) {
      throw new ForbiddenError('You are not assigned to inspect this assignment');
    }
  }
  res.json({ success: true, data: assignment });
});

// POST /api/assignments
export const create = asyncHandler(async (req: Request, res: Response) => {
  const input = CreateAssignmentSchema.parse(req.body);
  const assignment = await createAssignment(
    req.tenant!.id,
    req.user!.id,
    req.tenant!.firmCode,
    input,
  );
  res.status(201).json({ success: true, data: assignment });
});

// PATCH /api/assignments/:assignmentId
export const update = asyncHandler(async (req: Request, res: Response) => {
  const data = UpdateAssignmentSchema.parse(req.body);
  const assignment = await updateAssignment(
    req.tenant!.id,
    req.user!.id,
    req.params['assignmentId']!,
    data,
  );
  res.json({ success: true, data: assignment });
});

// PATCH /api/assignments/:assignmentId/status
export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
  const { status, comment } = StatusUpdateSchema.parse(req.body);
  const assignment = await updateAssignmentStatus(
    req.tenant!.id,
    req.user!.id,
    req.user!.role,
    req.params['assignmentId']!,
    status,
    comment,
  );
  res.json({ success: true, data: assignment });
});

// PATCH /api/assignments/:assignmentId/property
export const updatePropertyHandler = asyncHandler(async (req: Request, res: Response) => {
  const data = UpdatePropertySchema.parse(req.body);
  const property = await updateProperty(
    req.tenant!.id,
    req.user!.id,
    req.params['assignmentId']!,
    data,
  );
  res.json({ success: true, data: property });
});

// PATCH /api/assignments/:assignmentId/general
// Saves GEN section fields (loanType, bankRep, bankBranch, fees, etc.)
export const updateGeneralFieldsHandler = asyncHandler(async (req: Request, res: Response) => {
  const data = UpdateGeneralFieldsSchema.parse(req.body);
  await updateGeneralFields(
    req.tenant!.id,
    req.params['assignmentId']!,
    req.user!.id,
    data,
  );
  res.json({ success: true });
});
