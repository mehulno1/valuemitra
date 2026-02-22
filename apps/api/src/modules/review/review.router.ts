import { Router } from 'express';
import { authenticate, requireValuer, requireAdmin } from '../../middleware/auth.middleware.js';
import { getStatus, submit, advance, reject, deliver } from './review.controller.js';

export const reviewRouter = Router();

reviewRouter.use(authenticate);

// GET  /api/review/:assignmentId          — review status (all roles)
reviewRouter.get('/:assignmentId', getStatus);

// POST /api/review/:assignmentId/submit   — valuer submits for review
reviewRouter.post('/:assignmentId/submit', requireValuer, submit);

// POST /api/review/:assignmentId/advance  — admin advances to next step
reviewRouter.post('/:assignmentId/advance', requireAdmin, advance);

// POST /api/review/:assignmentId/reject   — admin rejects, back to REPORT_DRAFT
reviewRouter.post('/:assignmentId/reject', requireAdmin, reject);

// POST /api/review/:assignmentId/deliver  — admin delivers approved report
reviewRouter.post('/:assignmentId/deliver', requireAdmin, deliver);
