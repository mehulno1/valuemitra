import type { Request, Response } from 'express';
import { asyncHandler } from '../../middleware/error.middleware.js';
import {
  registerTenant,
  login,
  refreshAccessToken,
  logout,
  getProfile,
} from './auth.service.js';
import {
  RegisterTenantSchema,
  LoginSchema,
  RefreshTokenSchema,
} from '@valuemitra/shared';

// POST /api/auth/register
export const register = asyncHandler(async (req: Request, res: Response) => {
  const input = RegisterTenantSchema.parse(req.body);
  const result = await registerTenant(input);
  res.status(201).json({ success: true, data: result });
});

// POST /api/auth/login
export const loginUser = asyncHandler(async (req: Request, res: Response) => {
  const input = LoginSchema.parse(req.body);
  const result = await login(input);
  res.json({ success: true, data: result });
});

// POST /api/auth/refresh
export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const input = RefreshTokenSchema.parse(req.body);
  const result = await refreshAccessToken(input.refreshToken);
  res.json({ success: true, data: result });
});

// POST /api/auth/logout
export const logoutUser = asyncHandler(async (req: Request, res: Response) => {
  const input = RefreshTokenSchema.parse(req.body);
  await logout(input.refreshToken);
  res.json({ success: true, message: 'Logged out successfully' });
});

// GET /api/auth/me
export const me = asyncHandler(async (req: Request, res: Response) => {
  const profile = await getProfile(req.user!.id);
  res.json({ success: true, data: profile });
});
