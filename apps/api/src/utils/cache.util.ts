import { prisma } from '../config/database.js';

// ─────────────────────────────────────────────
// MySQL-backed K/V cache (replaces Redis)
// TTL is set per key; daily cleanup cron removes expired rows
// tags stored as comma-separated string (schema: String?)
// ─────────────────────────────────────────────

export async function cacheGet<T>(key: string): Promise<T | null> {
  const entry = await prisma.cacheEntry.findUnique({ where: { cacheKey: key } });

  if (!entry) return null;
  if (entry.expiresAt < new Date()) {
    await prisma.cacheEntry.delete({ where: { cacheKey: key } }).catch(() => null);
    return null;
  }

  return entry.value as T;
}

export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds: number,
  tags?: string[],
): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const tagsStr = tags && tags.length > 0 ? tags.join(',') : null;

  await prisma.cacheEntry.upsert({
    where: { cacheKey: key },
    create: { cacheKey: key, value: value as object, expiresAt, tags: tagsStr },
    update: { value: value as object, expiresAt, tags: tagsStr },
  });
}

export async function cacheDel(key: string): Promise<void> {
  await prisma.cacheEntry.delete({ where: { cacheKey: key } }).catch(() => null);
}

export async function cacheDelByTag(tag: string): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM cache_entries WHERE FIND_IN_SET(${tag}, tags) > 0
  `;
}

export async function cacheCleanup(): Promise<number> {
  const result = await prisma.cacheEntry.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return result.count;
}

// TTL constants (in seconds)
export const CACHE_TTL = {
  GOVT_RATES: 7 * 24 * 60 * 60,
  DASHBOARD_STATS: 5 * 60,
  OCR_RESPONSE: 30 * 24 * 60 * 60,
  USER_SESSION: 15 * 60,
  TENANT_PROFILE: 60 * 60,
} as const;
