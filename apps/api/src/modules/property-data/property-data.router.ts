import { Router } from 'express';
import { authenticate, requireNotInspector, requireNotViewer } from '../../middleware/auth.middleware.js';
import {
  getPropertyDataHandler,
  extractPropertyDataHandler,
  savePropertyDataHandler,
  verifyPropertyDataHandler,
} from './property-data.controller.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/property-data/:assignmentId — all authenticated roles including INSPECTOR
router.get('/:assignmentId', getPropertyDataHandler);

// POST /api/property-data/:assignmentId/extract — INSPECTOR excluded
router.post('/:assignmentId/extract', requireNotInspector, extractPropertyDataHandler);

// PATCH /api/property-data/:assignmentId — INSPECTOR excluded
router.patch('/:assignmentId', requireNotInspector, savePropertyDataHandler);

// POST /api/property-data/:assignmentId/verify — INSPECTOR excluded
router.post('/:assignmentId/verify', requireNotViewer, verifyPropertyDataHandler);

export default router;
