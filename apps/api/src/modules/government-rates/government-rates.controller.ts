import type { Request, Response } from 'express';
import { asyncHandler, AppError } from '../../middleware/error.middleware.js';
import {
  queryRates,
  getRateById,
  enqueueFetchJob,
  upsertManualRate,
  overrideRate,
  scraperExistsForState,
} from './government-rates.service.js';
import {
  FetchRatesSchema,
  QueryRatesSchema,
  ManualRateSchema,
  OverrideRateSchema,
} from '@valuemitra/shared';
import { StateCode } from '@valuemitra/shared';

// GET /api/government-rates
export const list = asyncHandler(async (req: Request, res: Response) => {
  const input = QueryRatesSchema.parse(req.query);
  const result = await queryRates(input);
  res.json({ success: true, data: result });
});

// GET /api/government-rates/:id
export const getOne = asyncHandler(async (req: Request, res: Response) => {
  const rate = await getRateById(req.params['id']!);
  res.json({ success: true, data: rate });
});

// POST /api/government-rates/fetch
// Triggers an async scrape job for the given state + district
export const triggerFetch = asyncHandler(async (req: Request, res: Response) => {
  const input = FetchRatesSchema.parse(req.body);

  if (!scraperExistsForState(input.state as StateCode)) {
    throw new AppError(
      422,
      `No scraper implemented for state "${input.state}". Use POST /manual to enter rates manually.`,
    );
  }

  const { jobId } = await enqueueFetchJob(input);
  res.status(202).json({
    success: true,
    message: 'Rate fetch job enqueued. Results will be available within a few minutes.',
    data: { jobId },
  });
});

// POST /api/government-rates/manual
// Directly insert/update a rate without scraping
export const createManual = asyncHandler(async (req: Request, res: Response) => {
  const input = ManualRateSchema.parse(req.body);
  const rate = await upsertManualRate(input);
  res.status(201).json({ success: true, data: rate });
});

// PATCH /api/government-rates/:id/override
// Override the rate values of an existing record (sets isManualOverride=true)
export const override = asyncHandler(async (req: Request, res: Response) => {
  const input = OverrideRateSchema.parse(req.body);
  const rate = await overrideRate(req.params['id']!, input);
  res.json({ success: true, data: rate });
});
