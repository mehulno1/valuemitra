import { PrismaClient } from '@prisma/client';
import { env } from './env.js';

// Singleton Prisma client — prevents connection pool exhaustion
// in development with hot-reload

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: env.NODE_ENV === 'development'
      ? ['query', 'warn', 'error']
      : ['warn', 'error'],
  });
}

export const prisma: PrismaClient =
  env.NODE_ENV === 'production'
    ? createPrismaClient()
    : (global.__prisma ??= createPrismaClient());

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});
