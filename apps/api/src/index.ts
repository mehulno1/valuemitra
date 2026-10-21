import { buildApp } from './app.js';
import { env } from './config/env.js';
import { db } from './db/index.js';
import { startWorker, stopWorker } from './platform/jobs.js';

const app = await buildApp();
await app.listen({ port: env.PORT, host: env.isProd ? '127.0.0.1' : '0.0.0.0' });
await startWorker();
console.log(`ValueMitra API on :${env.PORT} (${env.NODE_ENV})`);

const shutdown = async () => {
  stopWorker();
  await app.close();
  await db.destroy();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
