/**
 * Government rates job processor
 * Processes GOVT_RATE_FETCH jobs from the job_queue table.
 * Called by the scheduler every 5 minutes.
 */

import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { persistScrapedRates } from '../modules/government-rates/government-rates.service.js';
import { StateCode } from '@valuemitra/shared';
import type { FetchRatesInput } from '@valuemitra/shared';

const BATCH_SIZE = 3; // Playwright is memory-heavy; process fewer jobs at once
const STALE_LOCK_MINUTES = 15;

export async function processGovtRateJobs(): Promise<void> {
  // ── Release stale locks (jobs locked > 15 min ago) ───────────────────────
  const staleThreshold = new Date(Date.now() - STALE_LOCK_MINUTES * 60 * 1000);
  await prisma.jobQueue.updateMany({
    where: {
      jobType: 'GOVT_RATE_FETCH',
      status: 'LOCKED',
      lockedAt: { lt: staleThreshold },
    },
    data: { status: 'PENDING', lockedAt: null, lockedBy: null },
  });

  // ── Fetch a batch of pending jobs ─────────────────────────────────────────
  const jobs = await prisma.jobQueue.findMany({
    where: {
      jobType: 'GOVT_RATE_FETCH',
      status: 'PENDING',
      scheduledAt: { lte: new Date() },
      attempts: { lt: 3 },
    },
    orderBy: [{ priority: 'asc' }, { scheduledAt: 'asc' }],
    take: BATCH_SIZE,
  });

  if (jobs.length === 0) return;

  // ── Lock the batch ────────────────────────────────────────────────────────
  const jobIds = jobs.map((j) => j.id);
  await prisma.jobQueue.updateMany({
    where: { id: { in: jobIds } },
    data: { status: 'LOCKED', lockedAt: new Date(), lockedBy: env.WORKER_ID },
  });

  // ── Process each job ──────────────────────────────────────────────────────
  for (const job of jobs) {
    const payload = job.payload as unknown as FetchRatesInput;
    console.info(`[GovtRatesJob] Processing job ${job.id} — ${payload.state} / ${payload.district}`);

    try {
      const count = await runScraper(payload);

      await prisma.jobQueue.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          attempts: job.attempts + 1,
        },
      });

      console.info(`[GovtRatesJob] Job ${job.id} complete — ${count} rates saved`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[GovtRatesJob] Job ${job.id} failed: ${message}`);

      const newAttempts = job.attempts + 1;
      const failureLog = [
        ...((job.failureLog as object[]) ?? []),
        { attempt: newAttempts, error: message, at: new Date().toISOString() },
      ];

      const isExhausted = newAttempts >= job.maxAttempts;
      const retryAt = new Date(Date.now() + Math.pow(2, newAttempts) * 60_000);

      await prisma.jobQueue.update({
        where: { id: job.id },
        data: {
          status: isExhausted ? 'FAILED' : 'PENDING',
          attempts: newAttempts,
          lockedAt: null,
          lockedBy: null,
          scheduledAt: isExhausted ? undefined : retryAt,
          failureLog,
        },
      });
    }
  }
}

// ─────────────────────────────────────────────
// Scraper dispatcher
// ─────────────────────────────────────────────

async function runScraper(payload: FetchRatesInput): Promise<number> {
  const options = {
    district: payload.district,
    taluka: payload.taluka,
    village: payload.village,
    rateYear: payload.rateYear,
  };

  switch (payload.state) {
    case StateCode.MAHARASHTRA: {
      const { IGRMaharashtraScraper } = await import(
        '../modules/government-rates/scrapers/igr-maharashtra.scraper.js'
      );
      const scraper = new IGRMaharashtraScraper();
      const rates = await scraper.scrape(options);
      return persistScrapedRates(StateCode.MAHARASHTRA, rates);
    }

    case StateCode.GUJARAT: {
      const { JantriGujaratScraper } = await import(
        '../modules/government-rates/scrapers/jantri-gujarat.scraper.js'
      );
      const scraper = new JantriGujaratScraper();
      const rates = await scraper.scrape(options);
      return persistScrapedRates(StateCode.GUJARAT, rates);
    }

    default:
      throw new Error(
        `No scraper implemented for state "${payload.state}". Use the manual entry endpoint.`,
      );
  }
}
