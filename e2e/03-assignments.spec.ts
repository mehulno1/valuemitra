/**
 * Assignments spec — authenticated via globalSetup storageState.
 * "New Assignment" is a Button (not a Link).
 * Assignment form inputs use placeholder selectors.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const ASSIGNMENT_URL_FILE = path.join(__dirname, '.assignment-url.json');

function saveAssignmentUrl(url: string) {
  fs.writeFileSync(ASSIGNMENT_URL_FILE, JSON.stringify({ url }));
}

function loadAssignmentUrl(): string {
  try {
    const data = JSON.parse(fs.readFileSync(ASSIGNMENT_URL_FILE, 'utf8')) as { url: string };
    return data.url ?? '';
  } catch {
    return '';
  }
}

test.describe('Assignments', () => {
  test('01 Navigate to assignments list', async ({ page }) => {
    await page.goto('/assignments');
    await expect(page.getByRole('heading', { name: /assignments/i })).toBeVisible();
    // "New Assignment" is a <button>, not an <a>
    await expect(page.getByRole('button', { name: /new assignment/i })).toBeVisible();
  });

  test('02 Create a new Residential Flat assignment', async ({ page }) => {
    await page.goto('/assignments/new');
    await expect(page.getByRole('heading', { name: 'New Assignment' })).toBeVisible();

    // Client — Popover + Command
    // Use CSS attribute selector + text filter (more reliable than getByRole for custom combobox)
    await page.locator('button[role="combobox"]').filter({ hasText: /select client/i }).click();
    await expect(page.getByPlaceholder('Search clients\u2026')).toBeVisible();
    // Wait for client options to load from API, then pick first
    await expect(page.getByRole('option').first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole('option').first().click();

    // Property Type — shadcn Select with placeholder "Select type"
    await page.getByText('Select type').click();
    await page.getByRole('option', { name: 'Residential Flat' }).click();

    // Purpose — shadcn Select with placeholder "Select purpose"
    await page.getByText('Select purpose').click();
    await page.getByRole('option', { name: 'Mortgage / Home Loan' }).click();

    // Address fields (Input with register() — use placeholder)
    await page.getByPlaceholder('Plot / Flat / Building details').fill('Flat 101, Sunshine Towers, Andheri East');
    // City and District both use "e.g. Pune" placeholder — take first (City field)
    await page.getByPlaceholder('e.g. Pune').first().fill('Mumbai');
    await page.getByPlaceholder('e.g. Maharashtra').fill('Maharashtra');

    await page.getByRole('button', { name: 'Create Assignment' }).click();

    // Require 10+ chars so the pattern does NOT match '/assignments/new' (3 chars)
    await expect(page).toHaveURL(/\/assignments\/[a-z0-9-]{10,}/, { timeout: 15_000 });
    saveAssignmentUrl(page.url());
    console.log('[E2E] Assignment created:', page.url());
  });

  test('03 Assignment detail — all 5 tabs are visible', async ({ page }) => {
    const assignmentUrl = loadAssignmentUrl();
    await page.goto(assignmentUrl || '/assignments');
    await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Documents' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Valuation' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Reports' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Review' })).toBeVisible();
  });

  test('04 Documents tab — upload a PDF document', async ({ page }) => {
    const assignmentUrl = loadAssignmentUrl();
    await page.goto(assignmentUrl || '/assignments');
    await page.getByRole('tab', { name: 'Documents' }).click();
    await expect(page.getByText('Document Type')).toBeVisible();

    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('#doc-upload').dispatchEvent('click'),
    ]);
    await fileChooser.setFiles({
      name: 'sale-deed-sample.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 1 0 obj<< /Type /Catalog >> endobj'),
    });

    await expect(page.getByText('sale-deed-sample.pdf')).toBeVisible({ timeout: 15_000 });
  });

  test('05 Valuation tab — create a Cost Approach run', async ({ page }) => {
    const assignmentUrl = loadAssignmentUrl();
    await page.goto(assignmentUrl || '/assignments');
    await page.getByRole('tab', { name: 'Valuation' }).click();

    await expect(page.getByText('Start Valuation')).toBeVisible({ timeout: 8_000 });
    await page.getByRole('button', { name: 'COST APPROACH' }).click();
    await expect(page.getByText('Cost Approach').first()).toBeVisible({ timeout: 10_000 });
  });

  test('06 Valuation tab — fill cost data and compute', async ({ page }) => {
    const assignmentUrl = loadAssignmentUrl();
    await page.goto(assignmentUrl || '/assignments');
    await page.getByRole('tab', { name: 'Valuation' }).click();
    await expect(page.getByText('Cost Approach').first()).toBeVisible({ timeout: 8_000 });

    // Inputs use numeric placeholder values (no htmlFor/id on labels)
    await page.getByPlaceholder('500').fill('400');
    await page.getByPlaceholder('15000').fill('20000');
    await page.getByPlaceholder('200').fill('120');
    await page.getByPlaceholder('25000').fill('28000');
    await page.getByPlaceholder('15').fill('8');

    await page.getByRole('button', { name: 'Save & Compute' }).click();
    await expect(page.getByText('Cost Approach Value')).toBeVisible({ timeout: 15_000 });
  });

  test('07 Valuation tab — finalize', async ({ page }) => {
    const assignmentUrl = loadAssignmentUrl();
    await page.goto(assignmentUrl || '/assignments');
    await page.getByRole('tab', { name: 'Valuation' }).click();
    await expect(page.getByText('Finalize Valuation')).toBeVisible({ timeout: 8_000 });

    await page.getByPlaceholder(/explain your valuation/i).fill(
      'Cost approach applied; building age 8 years, sound condition, no comparable market data available.',
    );
    await page.getByRole('button', { name: 'Finalize Valuation' }).click();

    await expect(page.getByText('Final Adopted Value')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('\u2705 Finalized')).toBeVisible();
  });

  test('08 Reports tab — shows template selector', async ({ page }) => {
    const assignmentUrl = loadAssignmentUrl();
    await page.goto(assignmentUrl || '/assignments');
    await page.getByRole('tab', { name: 'Reports' }).click();
    await expect(page.getByText('Select Report Template')).toBeVisible({ timeout: 8_000 });
  });

  test('09 Review tab — shows review stepper', async ({ page }) => {
    const assignmentUrl = loadAssignmentUrl();
    await page.goto(assignmentUrl || '/assignments');
    await page.getByRole('tab', { name: 'Review' }).click();
    // Stepper renders step numbers or step labels
    const stepper = page.locator('.flex.items-center').filter({ hasText: /INTERNAL|review|1/i }).first();
    await expect(stepper).toBeVisible({ timeout: 8_000 });
  });
});
