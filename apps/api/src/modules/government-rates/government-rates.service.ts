import { prisma } from '../../config/database.js';
import { cacheGet, cacheSet } from '../../utils/cache.util.js';
import { AppError, NotFoundError } from '../../middleware/error.middleware.js';
import { StateCode } from '@valuemitra/shared';
import type {
  FetchRatesInput,
  QueryRatesInput,
  ManualRateInput,
  OverrideRateInput,
} from '@valuemitra/shared';
import type { ScrapedRate } from './scrapers/base.scraper.js';

// Cache TTL: 24 hours (rates don't change intra-day)
const RATE_CACHE_TTL_S = 24 * 60 * 60;

// ─────────────────────────────────────────────
// Query rates (with caching)
// ─────────────────────────────────────────────

export async function queryRates(input: QueryRatesInput) {
  const cacheKey = `govt-rates:${JSON.stringify(input)}`;
  const cached = await cacheGet<object[]>(cacheKey);
  if (cached) return cached;

  const { page, limit, isActive, ...filters } = input;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = { isActive: isActive ?? true };
  if (filters.state) where['state'] = filters.state;
  if (filters.district) where['district'] = { contains: filters.district };
  if (filters.taluka) where['taluka'] = { contains: filters.taluka };
  if (filters.village) where['village'] = { contains: filters.village };
  if (filters.rateYear) where['rateYear'] = filters.rateYear;
  if (filters.propertyCategory) where['propertyCategory'] = filters.propertyCategory;

  const [rows, total] = await Promise.all([
    prisma.governmentRate.findMany({ where, skip, take: limit, orderBy: { fetchedAt: 'desc' } }),
    prisma.governmentRate.count({ where }),
  ]);

  const result = { rows, total, page, limit, pages: Math.ceil(total / limit) };
  await cacheSet(cacheKey, result, RATE_CACHE_TTL_S, [`govt-rates:${filters.state ?? 'all'}`]);
  return result;
}

// ─────────────────────────────────────────────
// Get single rate record
// ─────────────────────────────────────────────

export async function getRateById(id: string) {
  const rate = await prisma.governmentRate.findUnique({ where: { id } });
  if (!rate) throw new NotFoundError('Government rate record');
  return rate;
}

// ─────────────────────────────────────────────
// Enqueue scrape job
// ─────────────────────────────────────────────

export async function enqueueFetchJob(input: FetchRatesInput): Promise<{ jobId: string }> {
  const job = await prisma.jobQueue.create({
    data: {
      jobType: 'GOVT_RATE_FETCH',
      payload: input as unknown as object,
      priority: 3, // higher priority than OCR
      scheduledAt: new Date(),
    },
  });
  return { jobId: job.id };
}

// ─────────────────────────────────────────────
// Manual rate entry (no scraping)
// ─────────────────────────────────────────────

export async function upsertManualRate(input: ManualRateInput) {
  const existing = await prisma.governmentRate.findFirst({
    where: {
      state: input.state,
      rateYear: input.rateYear,
      district: input.district ?? null,
      taluka: input.taluka ?? null,
      village: input.village ?? null,
      propertyCategory: input.propertyCategory,
      isManualOverride: true,
    },
  });

  const data = {
    state: input.state,
    rateYear: input.rateYear,
    district: input.district,
    taluka: input.taluka,
    village: input.village,
    zone: input.zone,
    jantriZone: input.jantriZone,
    surveyType: input.surveyType,
    propertyCategory: input.propertyCategory,
    ratePerSqM: input.ratePerSqM !== undefined ? String(input.ratePerSqM) : null,
    ratePerSqFt: input.ratePerSqFt !== undefined ? String(input.ratePerSqFt) : null,
    ratePerAcre: input.ratePerAcre !== undefined ? String(input.ratePerAcre) : null,
    fetchedAt: new Date(),
    isManualOverride: true,
    overrideNotes: input.overrideNotes,
    effectiveFrom: new Date(input.effectiveFrom),
    effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
    isActive: true,
  };

  const rate = existing
    ? await prisma.governmentRate.update({ where: { id: existing.id }, data })
    : await prisma.governmentRate.create({ data });

  // Invalidate cache for this state
  await invalidateRateCache(input.state);
  return rate;
}

// ─────────────────────────────────────────────
// Override an existing scraped rate
// ─────────────────────────────────────────────

export async function overrideRate(id: string, input: OverrideRateInput) {
  const existing = await prisma.governmentRate.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Government rate record');

  const rate = await prisma.governmentRate.update({
    where: { id },
    data: {
      ratePerSqM: input.ratePerSqM !== undefined ? String(input.ratePerSqM) : undefined,
      ratePerSqFt: input.ratePerSqFt !== undefined ? String(input.ratePerSqFt) : undefined,
      ratePerAcre: input.ratePerAcre !== undefined ? String(input.ratePerAcre) : undefined,
      overrideNotes: input.overrideNotes,
      effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : undefined,
      isManualOverride: true,
      updatedAt: new Date(),
    },
  });

  await invalidateRateCache(existing.state as StateCode);
  return rate;
}

// ─────────────────────────────────────────────
// Deactivate stale rates (called when new ones arrive for same scope)
// ─────────────────────────────────────────────

export async function deactivateStaleRates(
  state: string,
  rateYear: string,
  district?: string,
  taluka?: string,
  village?: string,
): Promise<void> {
  await prisma.governmentRate.updateMany({
    where: {
      state,
      rateYear,
      district: district ?? null,
      taluka: taluka ?? null,
      village: village ?? null,
      isManualOverride: false, // never deactivate manual overrides automatically
    },
    data: { isActive: false },
  });
}

// ─────────────────────────────────────────────
// Persist scraped rates from a scraper run
// ─────────────────────────────────────────────

export async function persistScrapedRates(
  state: StateCode,
  scrapedRates: ScrapedRate[],
): Promise<number> {
  if (scrapedRates.length === 0) return 0;

  const now = new Date();
  let saved = 0;

  for (const r of scrapedRates) {
    // Deactivate existing non-manual rates for same scope + year
    await deactivateStaleRates(state, r.rateYear, r.district, r.taluka, r.village);

    await prisma.governmentRate.create({
      data: {
        state,
        rateYear: r.rateYear,
        district: r.district,
        taluka: r.taluka ?? null,
        village: r.village ?? null,
        zone: r.zone ?? null,
        jantriZone: r.jantriZone ?? null,
        surveyType: r.surveyType ?? null,
        propertyCategory: r.propertyCategory,
        ratePerSqM: r.ratePerSqM !== undefined ? String(r.ratePerSqM) : null,
        ratePerSqFt: r.ratePerSqFt !== undefined ? String(r.ratePerSqFt) : null,
        ratePerAcre: r.ratePerAcre !== undefined ? String(r.ratePerAcre) : null,
        sourceUrl: r.sourceUrl,
        fetchedAt: now,
        effectiveFrom: now,
        isActive: true,
      },
    });
    saved++;
  }

  await invalidateRateCache(state);
  console.info(`[GovtRates] Persisted ${saved} rate records for ${state}`);
  return saved;
}

// ─────────────────────────────────────────────
// Fetch rates for an assignment property (used by valuation engine)
// Returns best-match rates for a given location + property category
// ─────────────────────────────────────────────

export async function getRatesForProperty(opts: {
  state: StateCode;
  district: string;
  taluka?: string;
  village?: string;
  propertyCategory: string;
  rateYear?: string;
}) {
  const cacheKey = `prop-rate:${JSON.stringify(opts)}`;
  const cached = await cacheGet<object[]>(cacheKey);
  if (cached) return cached;

  const currentFY = getCurrentFY();

  // Try most-specific match first, then broaden
  const searchScopes = [
    { district: opts.district, taluka: opts.taluka, village: opts.village },
    { district: opts.district, taluka: opts.taluka, village: undefined },
    { district: opts.district, taluka: undefined, village: undefined },
  ];

  for (const scope of searchScopes) {
    const rates = await prisma.governmentRate.findMany({
      where: {
        state: opts.state,
        rateYear: opts.rateYear ?? currentFY,
        district: scope.district,
        taluka: scope.taluka ?? null,
        village: scope.village ?? null,
        propertyCategory: opts.propertyCategory,
        isActive: true,
      },
      orderBy: [{ isManualOverride: 'desc' }, { fetchedAt: 'desc' }],
      take: 5,
    });

    if (rates.length > 0) {
      await cacheSet(cacheKey, rates, 3600, [`govt-rates:${opts.state}`]);
      return rates;
    }
  }

  // No match found — return empty (valuation engine will fall back to manual input)
  return [];
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function getCurrentFY(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (month >= 4) return `${year}-${String(year + 1).slice(2)}`;
  return `${year - 1}-${String(year).slice(2)}`;
}

async function invalidateRateCache(state: StateCode | string): Promise<void> {
  // Delete cache entries tagged with this state
  await prisma.$executeRawUnsafe(
    `DELETE FROM cache_entries WHERE FIND_IN_SET(?, COALESCE(tags, ''))`,
    `govt-rates:${state}`,
  );
}

// Validate that a scraper exists for given state
export function scraperExistsForState(state: StateCode): boolean {
  return [StateCode.MAHARASHTRA, StateCode.GUJARAT].includes(state);
}

// Re-export for use in job handler
export { StateCode };
export type { AppError };
