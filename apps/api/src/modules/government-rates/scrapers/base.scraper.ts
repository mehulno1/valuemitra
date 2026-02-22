import { chromium, Browser, BrowserContext, Page } from 'playwright';

export interface ScrapedRate {
  district: string;
  taluka?: string;
  village?: string;
  zone?: string;
  jantriZone?: string;
  surveyType?: string;
  propertyCategory: string;
  ratePerSqM?: number;
  ratePerSqFt?: number;
  ratePerAcre?: number;
  sourceUrl: string;
  rateYear: string;
}

export interface ScrapeOptions {
  district: string;
  taluka?: string;
  village?: string;
  rateYear?: string;          // defaults to current FY
}

export abstract class BaseScraper {
  protected browser: Browser | null = null;
  protected context: BrowserContext | null = null;

  protected async launchBrowser(): Promise<Page> {
    this.browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    this.context = await this.browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'en-IN',
      timezoneId: 'Asia/Kolkata',
    });
    return this.context.newPage();
  }

  protected async closeBrowser(): Promise<void> {
    await this.context?.close();
    await this.browser?.close();
    this.browser = null;
    this.context = null;
  }

  /** Returns the current financial year string, e.g. "2024-25" */
  protected currentFY(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1; // 1-indexed
    if (month >= 4) {
      return `${year}-${String(year + 1).slice(2)}`;
    }
    return `${year - 1}-${String(year).slice(2)}`;
  }

  /** Retry wrapper — up to maxRetries attempts with exponential back-off */
  protected async withRetry<T>(
    fn: () => Promise<T>,
    maxRetries = 3,
    baseDelayMs = 2000,
  ): Promise<T> {
    let lastError: Error = new Error('Unknown scraper error');
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(`Scraper attempt ${attempt}/${maxRetries} failed: ${lastError.message}`);
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(2, attempt - 1)));
        }
      }
    }
    throw lastError;
  }

  abstract scrape(options: ScrapeOptions): Promise<ScrapedRate[]>;
}
