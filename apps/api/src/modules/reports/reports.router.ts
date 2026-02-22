import { Router } from 'express';
import { authenticate, requireValuer, requireAdmin } from '../../middleware/auth.middleware.js';
import {
  listTemplatesHandler,
  getTemplateHandler,
  generateReportHandler,
  listReportsHandler,
  getReportHandler,
  updateStatusHandler,
  deliverReportHandler,
} from './reports.controller.js';

export const reportsRouter = Router();

reportsRouter.use(authenticate);

// GET  /api/reports/templates              — list available templates (all roles)
reportsRouter.get('/templates', listTemplatesHandler);

// GET  /api/reports/templates/:id          — single template (all roles)
reportsRouter.get('/templates/:id', getTemplateHandler);

// POST /api/reports/generate               — generate report (VALUER+)
reportsRouter.post('/generate', requireValuer, generateReportHandler);

// GET  /api/reports/assignment/:id         — list reports for assignment (all roles)
reportsRouter.get('/assignment/:assignmentId', listReportsHandler);

// GET  /api/reports/:id                    — single report + download URLs (all roles)
reportsRouter.get('/:id', getReportHandler);

// PATCH /api/reports/:id/status            — update status (TENANT_ADMIN)
reportsRouter.patch('/:id/status', requireAdmin, updateStatusHandler);

// POST  /api/reports/:id/deliver           — deliver via email (VALUER+)
reportsRouter.post('/:id/deliver', requireValuer, deliverReportHandler);
