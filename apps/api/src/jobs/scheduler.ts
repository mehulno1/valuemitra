import cron from 'node-cron';
import { processOcrJobs, cleanupExpiredCache } from './ocr.job.js';
import { processGovtRateJobs } from './govt-rates.job.js';
import { processNotifications } from './notification.job.js';

// ─────────────────────────────────────────────
// Job scheduler — node-cron based (replaces Bull/Redis)
// All job state lives in the job_queue MySQL table
// ─────────────────────────────────────────────

let isOcrRunning = false;
let isGovtRateRunning = false;
let isNotificationRunning = false;

export async function startScheduler(): Promise<void> {
  // ── OCR processing — every 30 seconds ────────────────────
  cron.schedule('*/30 * * * * *', async () => {
    if (isOcrRunning) return; // prevent overlap if a batch takes > 30s
    isOcrRunning = true;
    try {
      await processOcrJobs();
    } catch (err) {
      console.error('OCR scheduler error:', err);
    } finally {
      isOcrRunning = false;
    }
  });

  // ── Government rate fetch — every 5 minutes ───────────────
  // Playwright scrapes are slow; 5-min poll is sufficient
  cron.schedule('*/5 * * * *', async () => {
    if (isGovtRateRunning) return;
    isGovtRateRunning = true;
    try {
      await processGovtRateJobs();
    } catch (err) {
      console.error('Govt-rates scheduler error:', err);
    } finally {
      isGovtRateRunning = false;
    }
  });

  // ── Email notifications — every 1 minute ─────────────────
  cron.schedule('* * * * *', async () => {
    if (isNotificationRunning) return;
    isNotificationRunning = true;
    try {
      await processNotifications();
    } catch (err) {
      console.error('Notification scheduler error:', err);
    } finally {
      isNotificationRunning = false;
    }
  });

  // ── Cache cleanup — every day at 03:00 ───────────────────
  cron.schedule('0 3 * * *', async () => {
    try {
      await cleanupExpiredCache();
    } catch (err) {
      console.error('Cache cleanup scheduler error:', err);
    }
  });

  console.info('✅ Job scheduler started (OCR every 30s, govt-rates every 5min, notifications every 1min, cache cleanup daily at 03:00)');
}
