import type { Request, Response } from 'express';
import { asyncHandler } from '../../middleware/error.middleware.js';
import { listUsers, getUser, createUser, updateUser, deactivateUser } from './users.service.js';
import { z } from 'zod';
import { UserRole } from '@valuemitra/shared';

const CreateUserSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2).max(200),
  role: z.nativeEnum(UserRole),
  password: z.string().min(8),
  phone: z.string().max(20).optional(),
  ibbiRegNo: z.string().max(100).optional(),
  ibbiRegCategory: z.string().max(100).optional(),
  ibbiRegValidUpto: z.coerce.date().optional(),
});

const UpdateUserSchema = z.object({
  fullName: z.string().min(2).max(200).optional(),
  phone: z.string().max(20).optional(),
  ibbiRegNo: z.string().max(100).optional(),
  ibbiRegCategory: z.string().max(100).optional(),
  ibbiRegValidUpto: z.coerce.date().optional(),
  rvoMembershipNo: z.string().max(100).optional(),
  qualifications: z.string().max(500).optional(),
  experienceYears: z.number().int().min(0).max(60).optional(),
  signatureUrl: z.string().url().optional().or(z.literal('')),
  stampUrl: z.string().url().optional().or(z.literal('')),
  role: z.nativeEnum(UserRole).optional(),
});

// GET /api/users
export const list = asyncHandler(async (req: Request, res: Response) => {
  const users = await listUsers(req.tenant!.id);
  res.json({ success: true, data: users });
});

// GET /api/users/:userId
export const get = asyncHandler(async (req: Request, res: Response) => {
  const user = await getUser(req.tenant!.id, req.params['userId']!);
  res.json({ success: true, data: user });
});

// POST /api/users
export const create = asyncHandler(async (req: Request, res: Response) => {
  const input = CreateUserSchema.parse(req.body);
  const user = await createUser(req.tenant!.id, req.user!.id, input);
  res.status(201).json({ success: true, data: user });
});

// PATCH /api/users/:userId
export const update = asyncHandler(async (req: Request, res: Response) => {
  const data = UpdateUserSchema.parse(req.body);
  const updated = await updateUser(
    req.tenant!.id,
    req.user!.id,
    req.user!.role,
    req.params['userId']!,
    data,
  );
  res.json({ success: true, data: updated });
});

// DELETE /api/users/:userId
export const deactivate = asyncHandler(async (req: Request, res: Response) => {
  await deactivateUser(req.tenant!.id, req.user!.id, req.params['userId']!);
  res.json({ success: true, message: 'User deactivated' });
});
