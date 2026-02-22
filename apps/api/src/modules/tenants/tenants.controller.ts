import type { Request, Response } from 'express';
import { asyncHandler } from '../../middleware/error.middleware.js';
import { getTenantProfile, updateTenantProfile, getTenantStats } from './tenants.service.js';
import { z } from 'zod';

const UpdateTenantSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  pincode: z.string().regex(/^\d{6}$/).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional(),
  website: z.string().url().optional().or(z.literal('')),
  logoUrl: z.string().url().optional().or(z.literal('')),
  stampUrl: z.string().url().optional().or(z.literal('')),
  firmCode: z.string().min(2).max(20).toUpperCase().optional(),
});

// GET /api/tenants/profile
export const getProfile = asyncHandler(async (req: Request, res: Response) => {
  const profile = await getTenantProfile(req.tenant!.id);
  res.json({ success: true, data: profile });
});

// PATCH /api/tenants/profile
export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  const data = UpdateTenantSchema.parse(req.body);
  const updated = await updateTenantProfile(req.tenant!.id, req.user!.id, data);
  res.json({ success: true, data: updated });
});

// GET /api/tenants/stats
export const getStats = asyncHandler(async (req: Request, res: Response) => {
  const stats = await getTenantStats(req.tenant!.id);
  res.json({ success: true, data: stats });
});
