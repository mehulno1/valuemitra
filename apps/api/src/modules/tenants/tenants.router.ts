import { Router } from 'express';
import { authenticate, requireAdmin } from '../../middleware/auth.middleware.js';
import { resolveTenant } from '../../middleware/tenant.middleware.js';
import { getProfile, updateProfile, getStats } from './tenants.controller.js';

export const tenantsRouter = Router();

// All tenant routes require auth + tenant resolution
tenantsRouter.use(authenticate, resolveTenant);

tenantsRouter.get('/profile', getProfile);
tenantsRouter.patch('/profile', requireAdmin, updateProfile);
tenantsRouter.get('/stats', requireAdmin, getStats);
