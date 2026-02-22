import { app, registerRoutes } from './app.js';
import { env } from './config/env.js';
import { prisma } from './config/database.js';
import { errorHandler, NotFoundError } from './middleware/error.middleware.js';

async function bootstrap(): Promise<void> {
  // Register all module routes
  await registerRoutes();

  // 404 + error handlers must be registered AFTER all routes
  app.use((_req, _res, next) => { next(new NotFoundError('Route')); });
  app.use(errorHandler);

  // Verify DB connection before accepting traffic
  await prisma.$connect();
  console.info('✅ Database connected');

  // Start job scheduler
  const { startScheduler } = await import('./jobs/scheduler.js');
  await startScheduler();

  const server = app.listen(env.PORT, () => {
    console.info(`🚀 ValueMitra API running on port ${env.PORT} [${env.NODE_ENV}]`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    console.info(`\n${signal} received — shutting down gracefully`);
    server.close(async () => {
      await prisma.$disconnect();
      console.info('Database disconnected. Server closed.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
    process.exit(1);
  });

  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    process.exit(1);
  });
}

void bootstrap();
