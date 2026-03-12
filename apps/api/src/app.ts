import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import * as path from 'path';
import { env } from './config/env.js';
import { errorHandler, NotFoundError } from './middleware/error.middleware.js';

const app = express();

// Trust Nginx reverse proxy — required for express-rate-limit to work correctly
// behind Nginx (reads X-Forwarded-For to get real client IP)
app.set('trust proxy', 1);

// ─────────────────────────────────────────────
// Security headers
// ─────────────────────────────────────────────
app.use(helmet());

// ─────────────────────────────────────────────
// CORS
// ─────────────────────────────────────────────
app.use(cors({
  origin: env.FRONTEND_URL,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID'],
}));

// ─────────────────────────────────────────────
// Body parsing
// ─────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─────────────────────────────────────────────
// Compression
// ─────────────────────────────────────────────
app.use(compression());

// ─────────────────────────────────────────────
// Logging (HTTP request logs)
// ─────────────────────────────────────────────
if (env.NODE_ENV !== 'test') {
  app.use(morgan(env.NODE_ENV === 'development' ? 'dev' : 'combined'));
}

// ─────────────────────────────────────────────
// Global rate limiter (applied to all routes)
// Per-route limiters are tighter for auth endpoints
// ─────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
});
app.use(globalLimiter);

// ─────────────────────────────────────────────
// Health check (no auth, no rate limit)
// ─────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), env: env.NODE_ENV });
});

// ─────────────────────────────────────────────
// Local file serving (dev only — S3 used in prod)
// Serves uploads from the local filesystem under /api/files/*
// ─────────────────────────────────────────────
if (env.STORAGE_PROVIDER === 'local') {
  app.use('/api/files', express.static(path.resolve(env.LOCAL_UPLOAD_PATH)));
}

// ─────────────────────────────────────────────
// API Routes — registered in Stage 2+
// ─────────────────────────────────────────────
// Lazy imports so TypeScript compiles even before modules exist
async function registerRoutes(): Promise<void> {
  const { authRouter } = await import('./modules/auth/auth.router.js');
  const { tenantsRouter } = await import('./modules/tenants/tenants.router.js');
  const { usersRouter } = await import('./modules/users/users.router.js');
  const { assignmentsRouter } = await import('./modules/assignments/assignments.router.js');
  const { clientsRouter } = await import('./modules/clients/clients.router.js');
  const { documentsRouter } = await import('./modules/documents/documents.router.js');
  const { governmentRatesRouter } = await import('./modules/government-rates/government-rates.router.js');
  const { valuationRouter } = await import('./modules/valuation/valuation.router.js');
  const { aiValuationRouter } = await import('./modules/ai-valuation/ai-valuation.router.js');
  const { reviewRouter } = await import('./modules/review/review.router.js');
  const { reportsRouter } = await import('./modules/reports/reports.router.js');
  const propertyDataRouter = (await import('./modules/property-data/property-data.router.js')).default;
  const inspectionsRouter = (await import('./modules/inspections/inspections.router.js')).default;

  app.use('/api/auth', authRouter);
  app.use('/api/tenants', tenantsRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/assignments', assignmentsRouter);
  app.use('/api/clients', clientsRouter);
  app.use('/api/documents', documentsRouter);
  app.use('/api/government-rates', governmentRatesRouter);
  app.use('/api/valuation', valuationRouter);
  app.use('/api/ai-valuation', aiValuationRouter);
  app.use('/api/review', reviewRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/property-data', propertyDataRouter);
  app.use('/api/inspections', inspectionsRouter);
}

export { app, registerRoutes };
