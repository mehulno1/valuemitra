import { Router } from 'express';
import { authenticate, requireAdmin, requireNotViewer } from '../../middleware/auth.middleware.js';
import { resolveTenant } from '../../middleware/tenant.middleware.js';
import { list, get, create, update, deactivate } from './users.controller.js';

export const usersRouter = Router();

usersRouter.use(authenticate, resolveTenant);

usersRouter.get('/', requireNotViewer, list);
usersRouter.get('/:userId', requireNotViewer, get);
usersRouter.post('/', requireAdmin, create);
usersRouter.patch('/:userId', update);          // self or admin
usersRouter.delete('/:userId', requireAdmin, deactivate);
