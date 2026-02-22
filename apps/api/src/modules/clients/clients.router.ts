import { Router } from 'express';
import { authenticate, requireNotViewer } from '../../middleware/auth.middleware.js';
import { resolveTenant } from '../../middleware/tenant.middleware.js';
import { list, get, create, update, remove } from './clients.controller.js';

export const clientsRouter = Router();

clientsRouter.use(authenticate, resolveTenant);

clientsRouter.get('/', list);
clientsRouter.get('/:clientId', get);
clientsRouter.post('/', requireNotViewer, create);
clientsRouter.patch('/:clientId', requireNotViewer, update);
clientsRouter.delete('/:clientId', requireNotViewer, remove);
