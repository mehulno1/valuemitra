import fs from 'node:fs';
import path from 'node:path';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { env } from './config/env.js';
import { db } from './db/index.js';
import { adminRoutes } from './http/admin.routes.js';
import { authRoutes } from './http/auth.routes.js';
import { billingRoutes } from './http/billing.routes.js';
import { caseRoutes } from './http/case.routes.js';
import { publicRoutes } from './http/public.routes.js';
import { AppError } from './lib/errors.js';
// modules register their job handlers on import
import './modules/documents/service.js';
import './modules/site/service.js';
import './modules/valuation/service.js';
import './modules/reports/service.js';
import { registerListeners } from './modules/workflow/listeners.js';

export async function buildApp() {
  const app = Fastify({
    logger: { level: env.isProd ? 'info' : 'warn' },
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
  });
  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } });
  if (!env.isProd) await app.register(cors, { origin: env.APP_URL, credentials: true });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 60 * 1024 * 1024, files: 40 } });
  await app.register(rateLimit, { global: false });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: err.code, message: err.message, details: err.details });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.code ?? 'ERROR', message: err.message });
    req.log.error(err);
    console.error(err);
    return reply.status(500).send({ error: 'INTERNAL', message: 'Something went wrong. It has been logged.' });
  });

  app.get('/api/health', async () => {
    await db.selectFrom('firms').select('id').limit(1).execute();
    return { ok: true, time: new Date().toISOString() };
  });

  await app.register(authRoutes);
  await app.register(publicRoutes);
  await app.register(caseRoutes);
  await app.register(adminRoutes);
  await app.register(billingRoutes);
  registerListeners();

  // serve the built web app in production (nginx may also serve it directly)
  const web = path.join(env.root, 'apps/web/dist');
  if (fs.existsSync(web)) {
    await app.register(fastifyStatic, { root: web, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Not found' });
      return reply.sendFile('index.html');
    });
  }
  return app;
}
