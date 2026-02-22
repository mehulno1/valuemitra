/**
 * Maharashtra IGR (Inspector General of Registration) scraper
 * Fetches Annual Statement of Rates (ASR / Ready Reckoner) for Maharashtra.
 *
 * Source: https://igrmaharashtra.gov.in
 * The ASR portal allows lookup by district → taluka → village → property type.
 *
 * NOTE: Government portals change their markup without notice. If this scraper
 * breaks, use the manual override API endpoint to enter rates until it is fixed.
 */

import { Page } from 'playwright';
import { BaseScraper, ScrapeOptions, ScrapedRate } from './base.scraper.js';
import { RateCategory } from '@valuemitra/shared';

const IGR_BASE_URL = 'https://igrmaharashtra.gov.in';
const ASR_URL = `${IGR_BASE_URL}/eASR/eASRCommon.aspx`;

// Maps IGR property type labels → our RateCategory enum
const CATEGORY_MAP: Record<string, string> = {
  'Residential': RateCategory.RESIDENTIAL,
  'Commercial': RateCategory.COMMERCIAL,
  'Industrial': RateCategory.INDUSTRIAL,
  'Agricultural': RateCategory.AGRICULTURAL,
  'Open Land': RateCategory.OPEN_LAND,
  'Open space': RateCategory.OPEN_LAND,
};

export class IGRMaharashtraScraper extends BaseScraper {
  async scrape(options: ScrapeOptions): Promise<ScrapedRate[]> {
    return this.withRetry(async () => {
      const page = await this.launchBrowser();
      try {
        return await this._scrape(page, options);
      } finally {
        await this.closeBrowser();
      }
    });
  }

  private async _scrape(page: Page, options: ScrapeOptions): Promise<ScrapedRate[]> {
    const rateYear = options.rateYear ?? this.currentFY();
    const rates: ScrapedRate[] = [];

    console.info(`[IGR-MH] Scraping district=${options.district} taluka=${options.taluka ?? 'all'} year=${rateYear}`);

    await page.goto(ASR_URL, { waitUntil: 'networkidle', timeout: 30_000 });

    // ── Select financial year ─────────────────────────────────────────────────
    const yearSelect = page.locator('select[id*="ddlYear"], select[name*="ddlYear"]').first();
    if (await yearSelect.count() > 0) {
      // IGR shows year as "2024-2025" format
      const [startYear] = rateYear.split('-');
      const endYear = String(Number(startYear) + 1);
      const yearLabel = `${startYear}-${endYear}`;
      await yearSelect.selectOption({ label: yearLabel }).catch(() => {
        // Fallback: try selecting first matching option
        return yearSelect.selectOption({ index: 0 });
      });
      await page.waitForTimeout(1000);
    }

    // ── Select district ───────────────────────────────────────────────────────
    const districtSelect = page.locator('select[id*="ddlDistrict"], select[name*="ddlDistrict"]').first();
    if (await districtSelect.count() === 0) {
      throw new Error('[IGR-MH] District dropdown not found — page structure may have changed');
    }

    // Try exact match first, then case-insensitive partial match
    const districtOptions = await districtSelect.locator('option').allTextContents();
    const match = districtOptions.find(
      (opt) => opt.trim().toLowerCase() === options.district.toLowerCase(),
    ) ?? districtOptions.find(
      (opt) => opt.trim().toLowerCase().includes(options.district.toLowerCase()),
    );

    if (!match) {
      throw new Error(`[IGR-MH] District "${options.district}" not found. Available: ${districtOptions.slice(0, 5).join(', ')}`);
    }

    await districtSelect.selectOption({ label: match.trim() });
    await page.waitForTimeout(1500);

    // ── Select taluka (optional) ──────────────────────────────────────────────
    if (options.taluka) {
      const talukaSelect = page.locator('select[id*="ddlTaluka"], select[name*="ddlTaluka"]').first();
      if (await talukaSelect.count() > 0) {
        const talukaOptions = await talukaSelect.locator('option').allTextContents();
        const talukaMatch = talukaOptions.find(
          (opt) => opt.trim().toLowerCase().includes(options.taluka!.toLowerCase()),
        );
        if (talukaMatch) {
          await talukaSelect.selectOption({ label: talukaMatch.trim() });
          await page.waitForTimeout(1500);
        }
      }
    }

    // ── Select village (optional) ─────────────────────────────────────────────
    if (options.village) {
      const villageSelect = page.locator('select[id*="ddlVillage"], select[name*="ddlVillage"]').first();
      if (await villageSelect.count() > 0) {
        const villageOptions = await villageSelect.locator('option').allTextContents();
        const villageMatch = villageOptions.find(
          (opt) => opt.trim().toLowerCase().includes(options.village!.toLowerCase()),
        );
        if (villageMatch) {
          await villageSelect.selectOption({ label: villageMatch.trim() });
          await page.waitForTimeout(1500);
        }
      }
    }

    // ── Submit / Search ───────────────────────────────────────────────────────
    const searchBtn = page.locator('input[type="submit"], button[type="submit"], input[value*="Search"], input[value*="View"]').first();
    if (await searchBtn.count() > 0) {
      await searchBtn.click();
      await page.waitForLoadState('networkidle', { timeout: 20_000 });
    }

    // ── Parse rate table ──────────────────────────────────────────────────────
    // IGR shows rates in a table with columns: Property Type | Zone/Area | Rate per Sqm | Rate per Sqft
    const tables = page.locator('table');
    const tableCount = await tables.count();

    for (let t = 0; t < tableCount; t++) {
      const table = tables.nth(t);
      const rows = table.locator('tr');
      const rowCount = await rows.count();

      for (let r = 1; r < rowCount; r++) { // skip header row
        const cells = rows.nth(r).locator('td');
        const cellCount = await cells.count();
        if (cellCount < 3) continue;

        const col0 = (await cells.nth(0).textContent() ?? '').trim();
        const col1 = (await cells.nth(1).textContent() ?? '').trim();
        const col2 = (await cells.nth(2).textContent() ?? '').trim();
        const col3 = cellCount > 3 ? (await cells.nth(3).textContent() ?? '').trim() : '';

        // Detect which column has property category vs numeric rates
        const parsedRate = this.parseRateValue(col2) ?? this.parseRateValue(col1);
        if (!parsedRate) continue;

        const categoryRaw = col0 || col1;
        const propertyCategory = CATEGORY_MAP[categoryRaw] ?? RateCategory.RESIDENTIAL;
        const zone = col1 !== col0 ? col1 : undefined;

        const ratePerSqM = this.parseRateValue(col2) ?? undefined;
        const ratePerSqFt = this.parseRateValue(col3) ?? (ratePerSqM ? Math.round(ratePerSqM / 10.764 * 100) / 100 : undefined);

        rates.push({
          district: options.district,
          taluka: options.taluka,
          village: options.village,
          zone,
          propertyCategory,
          ratePerSqM,
          ratePerSqFt,
          sourceUrl: page.url(),
          rateYear,
        });
      }
    }

    if (rates.length === 0) {
      console.warn(`[IGR-MH] No rates parsed from page. URL: ${page.url()}`);
    } else {
      console.info(`[IGR-MH] Scraped ${rates.length} rate entries`);
    }

    return rates;
  }

  /** Parse "1,23,456" or "₹ 12345.00" → number */
  private parseRateValue(raw: string): number | null {
    if (!raw) return null;
    const cleaned = raw.replace(/[₹,\s]/g, '').trim();
    const num = parseFloat(cleaned);
    return isNaN(num) || num <= 0 ? null : num;
  }
}
