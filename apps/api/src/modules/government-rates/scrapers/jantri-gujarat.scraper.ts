/**
 * Gujarat Jantri scraper
 * Fetches stamp duty valuation rates (Jantri) from GARVI Gujarat portal.
 *
 * Source: https://garvi.gujarat.gov.in/jantri/
 * Navigation: District → Taluka → Village → Property Classification
 *
 * NOTE: Government portals change their markup without notice. If this scraper
 * breaks, use the manual override API endpoint to enter rates until it is fixed.
 */

import { Page } from 'playwright';
import { BaseScraper, ScrapeOptions, ScrapedRate } from './base.scraper.js';
import { RateCategory } from '@valuemitra/shared';

const GARVI_URL = 'https://garvi.gujarat.gov.in/jantri/';

// Gujarat Jantri uses specific survey/property type codes
const CATEGORY_MAP: Record<string, string> = {
  'Residential': RateCategory.RESIDENTIAL,
  'Commercial': RateCategory.COMMERCIAL,
  'Industrial': RateCategory.INDUSTRIAL,
  'Agricultural': RateCategory.AGRICULTURAL,
  'N.A. (Non-Agricultural)': RateCategory.OPEN_LAND,
  'Open Plot': RateCategory.OPEN_LAND,
  'Open Land': RateCategory.OPEN_LAND,
};

// Rate unit keywords from Gujarat Jantri tables
const UNIT_PER_SQM = ['sq.m', 'sqm', 'per sq m', 'per sqm', 'sq mt', 'chora meter'];
const UNIT_PER_ACRE = ['acre', 'per acre', 'vigha', 'hectare'];

export class JantriGujaratScraper extends BaseScraper {
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

    console.info(`[JANTRI-GJ] Scraping district=${options.district} taluka=${options.taluka ?? 'all'} year=${rateYear}`);

    await page.goto(GARVI_URL, { waitUntil: 'networkidle', timeout: 30_000 });

    // ── Select district ───────────────────────────────────────────────────────
    const districtSelect = page.locator(
      'select[id*="district"], select[id*="District"], select[name*="district"]',
    ).first();

    if (await districtSelect.count() === 0) {
      throw new Error('[JANTRI-GJ] District dropdown not found — page structure may have changed');
    }

    const districtOptions = await districtSelect.locator('option').allTextContents();
    const districtMatch = districtOptions.find(
      (opt) => opt.trim().toLowerCase() === options.district.toLowerCase(),
    ) ?? districtOptions.find(
      (opt) => opt.trim().toLowerCase().includes(options.district.toLowerCase()),
    );

    if (!districtMatch) {
      throw new Error(
        `[JANTRI-GJ] District "${options.district}" not found. Available: ${districtOptions.slice(0, 5).join(', ')}`,
      );
    }

    await districtSelect.selectOption({ label: districtMatch.trim() });
    await page.waitForTimeout(1500);

    // ── Select taluka ─────────────────────────────────────────────────────────
    if (options.taluka) {
      const talukaSelect = page.locator(
        'select[id*="taluka"], select[id*="Taluka"], select[name*="taluka"]',
      ).first();
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

    // ── Select village ────────────────────────────────────────────────────────
    if (options.village) {
      const villageSelect = page.locator(
        'select[id*="village"], select[id*="Village"], select[name*="village"]',
      ).first();
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

    // ── Submit ────────────────────────────────────────────────────────────────
    const submitBtn = page.locator('button[type="submit"], input[type="submit"], a[id*="search"], button:has-text("Search"), button:has-text("Show")').first();
    if (await submitBtn.count() > 0) {
      await submitBtn.click();
      await page.waitForLoadState('networkidle', { timeout: 20_000 });
    }

    // ── Parse Jantri rate tables ──────────────────────────────────────────────
    // Gujarat Jantri tables typically show: Zone | Survey Type | Property Type | Rate | Unit
    const tables = page.locator('table');
    const tableCount = await tables.count();

    for (let t = 0; t < tableCount; t++) {
      const table = tables.nth(t);
      const rows = table.locator('tr');
      const rowCount = await rows.count();

      // Detect header row to understand column layout
      let colPropertyType = 0;
      let colRate = -1;
      let colUnit = -1;
      let colZone = -1;

      if (rowCount > 0) {
        const headerCells = rows.nth(0).locator('th, td');
        const headers = await headerCells.allTextContents();
        headers.forEach((h, idx) => {
          const lower = h.toLowerCase().trim();
          if (lower.includes('zone') || lower.includes('area')) colZone = idx;
          if (lower.includes('type') || lower.includes('category') || lower.includes('property')) colPropertyType = idx;
          if (lower.includes('rate') || lower.includes('jantri')) colRate = idx;
          if (lower.includes('unit') || lower.includes('per')) colUnit = idx;
        });
      }

      if (colRate === -1) continue; // Not a rate table

      for (let r = 1; r < rowCount; r++) {
        const cells = rows.nth(r).locator('td');
        const cellCount = await cells.count();
        if (cellCount < 2) continue;

        const getText = async (idx: number) =>
          idx >= 0 && idx < cellCount
            ? (await cells.nth(idx).textContent() ?? '').trim()
            : '';

        const categoryRaw = await getText(colPropertyType);
        const rateRaw = await getText(colRate);
        const unitRaw = colUnit >= 0 ? await getText(colUnit) : '';
        const zoneRaw = colZone >= 0 ? await getText(colZone) : '';

        const rateValue = this.parseRateValue(rateRaw);
        if (!rateValue) continue;

        const propertyCategory = this.mapCategory(categoryRaw);
        const unitLower = unitRaw.toLowerCase();

        let ratePerSqM: number | undefined;
        let ratePerAcre: number | undefined;
        let ratePerSqFt: number | undefined;

        if (UNIT_PER_ACRE.some((u) => unitLower.includes(u))) {
          ratePerAcre = rateValue;
        } else if (UNIT_PER_SQM.some((u) => unitLower.includes(u)) || unitLower === '' || unitLower.includes('sq')) {
          ratePerSqM = rateValue;
          ratePerSqFt = Math.round((rateValue / 10.764) * 100) / 100;
        } else {
          // Default: assume per sqm for urban areas
          ratePerSqM = rateValue;
        }

        // Extract jantri zone from zone column or property type description
        const jantriZone = zoneRaw || this.extractZone(categoryRaw);

        rates.push({
          district: options.district,
          taluka: options.taluka,
          village: options.village,
          zone: zoneRaw || undefined,
          jantriZone: jantriZone || undefined,
          propertyCategory,
          ratePerSqM,
          ratePerSqFt,
          ratePerAcre,
          sourceUrl: page.url(),
          rateYear,
        });
      }
    }

    if (rates.length === 0) {
      console.warn(`[JANTRI-GJ] No rates parsed from page. URL: ${page.url()}`);
    } else {
      console.info(`[JANTRI-GJ] Scraped ${rates.length} rate entries`);
    }

    return rates;
  }

  private mapCategory(raw: string): string {
    const lower = raw.toLowerCase();
    for (const [key, val] of Object.entries(CATEGORY_MAP)) {
      if (lower.includes(key.toLowerCase())) return val;
    }
    if (lower.includes('resid')) return RateCategory.RESIDENTIAL;
    if (lower.includes('comm')) return RateCategory.COMMERCIAL;
    if (lower.includes('indust')) return RateCategory.INDUSTRIAL;
    if (lower.includes('agri')) return RateCategory.AGRICULTURAL;
    return RateCategory.RESIDENTIAL;
  }

  private extractZone(text: string): string {
    // Gujarat Jantri often encodes zone info as "Zone-1", "A Zone", etc.
    const match = text.match(/zone[\s-]*([0-9A-Za-z]+)/i);
    return match ? `Zone-${match[1]}` : '';
  }

  private parseRateValue(raw: string): number | null {
    if (!raw) return null;
    const cleaned = raw.replace(/[₹,\s]/g, '').trim();
    const num = parseFloat(cleaned);
    return isNaN(num) || num <= 0 ? null : num;
  }
}
