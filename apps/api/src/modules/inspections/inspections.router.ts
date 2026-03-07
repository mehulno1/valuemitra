import { Router } from 'express';
import { authenticate, requireNotInspector, requireInspectorOrAbove } from '../../middleware/auth.middleware.js';
import {
  getMyInspectionsHandler,
  assignInspectionHandler,
  getInspectionHandler,
  updateInspectionHandler,
  submitInspectionHandler,
} from './inspections.controller.js';

const router = Router();

router.use(authenticate);

// GET /api/inspections/my — inspector sees their own pending queue
router.get('/my', getMyInspectionsHandler);

// POST /api/inspections/:assignmentId — assign inspector (admin/valuer only, not INSPECTOR role)
router.post('/:assignmentId', requireNotInspector, assignInspectionHandler);

// GET /api/inspections/:assignmentId — all authenticated roles
router.get('/:assignmentId', getInspectionHandler);

// PATCH /api/inspections/:assignmentId — inspector or admin can save draft
router.patch('/:assignmentId', requireInspectorOrAbove, updateInspectionHandler);

// POST /api/inspections/:assignmentId/submit — inspector or admin can submit
router.post('/:assignmentId/submit', requireInspectorOrAbove, submitInspectionHandler);

export default router;
