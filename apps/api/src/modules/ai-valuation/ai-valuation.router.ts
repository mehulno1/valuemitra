import { Router } from 'express';
import { authenticate, requireValuer } from '../../middleware/auth.middleware.js';
import { requestValuation, getResult } from './ai-valuation.controller.js';

export const aiValuationRouter = Router();

aiValuationRouter.use(authenticate);
aiValuationRouter.use(requireValuer);

// POST /api/ai-valuation          — request AI advisory valuation
aiValuationRouter.post('/', requestValuation);

// GET  /api/ai-valuation/run/:id  — fetch stored AI result for a valuation run
aiValuationRouter.get('/run/:id', getResult);
