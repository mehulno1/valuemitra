import { Router } from 'express';
import { authenticate, requireValuer, requireAdmin } from '../../middleware/auth.middleware.js';
import {
  create,
  listByAssignment,
  getOne,
  updateMarket,
  updateCost,
  updateIncome,
  finalize,
  deleteOne,
  reopen,
} from './valuation.controller.js';

export const valuationRouter = Router();

valuationRouter.use(authenticate);
valuationRouter.use(requireValuer);

// POST   /api/valuation                          — create a new run
valuationRouter.post('/', create);

// GET    /api/valuation/:assignmentId            — list all runs for an assignment
valuationRouter.get('/:assignmentId', listByAssignment);

// GET    /api/valuation/run/:id                  — get single run
valuationRouter.get('/run/:id', getOne);

// PATCH  /api/valuation/run/:id/market           — save market comparison comparables
valuationRouter.patch('/run/:id/market', updateMarket);

// PATCH  /api/valuation/run/:id/cost             — save cost approach inputs (auto-computes)
valuationRouter.patch('/run/:id/cost', updateCost);

// PATCH  /api/valuation/run/:id/income           — save income approach inputs (auto-computes)
valuationRouter.patch('/run/:id/income', updateIncome);

// POST   /api/valuation/run/:id/finalize         — lock run, compute weighted value
valuationRouter.post('/run/:id/finalize', finalize);

// DELETE /api/valuation/run/:id                  — delete a non-finalized run
valuationRouter.delete('/run/:id', deleteOne);

// POST   /api/valuation/run/:id/reopen           — unlock a finalized run (admin only, blocked after DELIVERED)
valuationRouter.post('/run/:id/reopen', requireAdmin, reopen);
