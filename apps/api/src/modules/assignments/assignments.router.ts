import { Router } from 'express';
import { authenticate, requireNotViewer } from '../../middleware/auth.middleware.js';
import { resolveTenant } from '../../middleware/tenant.middleware.js';
import { list, get, create, update, updateStatus, updatePropertyHandler } from './assignments.controller.js';

export const assignmentsRouter = Router();

assignmentsRouter.use(authenticate, resolveTenant);

assignmentsRouter.get('/', list);
assignmentsRouter.get('/:assignmentId', get);
assignmentsRouter.post('/', requireNotViewer, create);
assignmentsRouter.patch('/:assignmentId', requireNotViewer, update);
assignmentsRouter.patch('/:assignmentId/status', requireNotViewer, updateStatus);
assignmentsRouter.patch('/:assignmentId/property', requireNotViewer, updatePropertyHandler);
