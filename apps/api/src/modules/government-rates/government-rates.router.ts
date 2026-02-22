import { Router } from 'express';
import { authenticate, requireRoles, requireAdmin, requireValuer } from '../../middleware/auth.middleware.js';
import {
  list,
  getOne,
  triggerFetch,
  createManual,
  override,
} from './government-rates.controller.js';

export const governmentRatesRouter = Router();

// All routes require authentication
governmentRatesRouter.use(authenticate);

// GET  /api/government-rates         — list rates with filters (all roles)
governmentRatesRouter.get('/', list);

// GET  /api/government-rates/:id     — single rate record (all roles)
governmentRatesRouter.get('/:id', getOne);

// POST /api/government-rates/fetch   — trigger scrape job (TENANT_ADMIN / VALUER)
governmentRatesRouter.post('/fetch', requireValuer, triggerFetch);

// POST /api/government-rates/manual  — manual rate entry (TENANT_ADMIN only)
governmentRatesRouter.post('/manual', requireAdmin, createManual);

// PATCH /api/government-rates/:id/override — override rate value (TENANT_ADMIN only)
governmentRatesRouter.patch('/:id/override', requireAdmin, override);
