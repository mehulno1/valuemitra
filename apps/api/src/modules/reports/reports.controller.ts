import type { Request, Response } from 'express';
import { asyncHandler } from '../../middleware/error.middleware.js';
import {
  listTemplates,
  getTemplate,
  generateReport,
  listReports,
  getReport,
  updateReportStatus,
  deliverReport,
} from './reports.service.js';
import {
  GenerateReportSchema,
  ListTemplatesSchema,
  DeliverReportSchema,
  UpdateReportStatusSchema,
} from '@valuemitra/shared';

// GET /api/reports/templates
export const listTemplatesHandler = asyncHandler(async (req: Request, res: Response) => {
  const filters = ListTemplatesSchema.parse(req.query);
  const templates = await listTemplates(req.user!.tenantId, filters);
  res.json({ success: true, data: templates });
});

// GET /api/reports/templates/:id
export const getTemplateHandler = asyncHandler(async (req: Request, res: Response) => {
  const template = await getTemplate(req.params['id']!, req.user!.tenantId);
  res.json({ success: true, data: template });
});

// POST /api/reports/generate
export const generateReportHandler = asyncHandler(async (req: Request, res: Response) => {
  const input = GenerateReportSchema.parse(req.body);
  const result = await generateReport(input, req.user!.tenantId, req.user!.id);
  res.status(201).json({ success: true, data: result });
});

// GET /api/reports/assignment/:assignmentId
export const listReportsHandler = asyncHandler(async (req: Request, res: Response) => {
  const reports = await listReports(req.params['assignmentId']!, req.user!.tenantId);
  res.json({ success: true, data: reports });
});

// GET /api/reports/:id
export const getReportHandler = asyncHandler(async (req: Request, res: Response) => {
  const report = await getReport(req.params['id']!, req.user!.tenantId);
  res.json({ success: true, data: report });
});

// PATCH /api/reports/:id/status
export const updateStatusHandler = asyncHandler(async (req: Request, res: Response) => {
  const { status, notes } = UpdateReportStatusSchema.parse(req.body);
  const report = await updateReportStatus(
    req.params['id']!,
    req.user!.tenantId,
    req.user!.id,
    status,
    notes,
  );
  res.json({ success: true, data: report });
});

// POST /api/reports/:id/deliver
export const deliverReportHandler = asyncHandler(async (req: Request, res: Response) => {
  const input = DeliverReportSchema.parse(req.body);
  const result = await deliverReport(
    req.params['id']!,
    req.user!.tenantId,
    req.user!.id,
    input,
  );
  res.json({ success: true, data: result });
});
