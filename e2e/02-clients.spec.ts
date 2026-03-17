/**
 * Clients spec — authenticated via globalSetup storageState.
 * All inputs in NewClientPage use placeholder (no id attributes).
 */
import { test, expect } from '@playwright/test';

test.describe('Clients', () => {
  test('01 Navigate to clients list', async ({ page }) => {
    await page.goto('/clients');
    await expect(page.getByRole('heading', { name: /clients/i })).toBeVisible();
  });

  test('02 Create a BANK client (SBI)', async ({ page }) => {
    await page.goto('/clients/new');
    await expect(page.getByRole('heading', { name: 'New Client' })).toBeVisible();

    // shadcn Select — click trigger to open, pick option from portal
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Bank' }).click();

    // Inputs use placeholder (no id attributes in this form)
    await page.getByPlaceholder('e.g. Punjab National Bank').fill('State Bank of India');
    await page.getByPlaceholder('e.g. Ahmedabad Main Branch').fill('Mumbai Main Branch');
    await page.getByPlaceholder('client@example.com').fill('sbi.mumbai@test.com');
    await page.getByPlaceholder('10-digit mobile').fill('9988776655');
    await page.getByPlaceholder('e.g. Pune').fill('Mumbai');

    await page.getByRole('button', { name: 'Create Client' }).click();

    // Require 10+ chars so the pattern does NOT match '/clients/new' (3 chars)
    await expect(page).toHaveURL(/\/clients\/[a-z0-9-]{10,}/, { timeout: 10_000 });
    await expect(page.getByText(/state bank of india/i)).toBeVisible();
  });

  test('03 Create an INDIVIDUAL client', async ({ page }) => {
    await page.goto('/clients/new');
    await expect(page.getByRole('heading', { name: 'New Client' })).toBeVisible();

    // Default type is INDIVIDUAL
    await page.getByPlaceholder('e.g. Rajesh Kumar').fill('Ramesh Kumar Verma');
    await page.getByPlaceholder('client@example.com').fill('ramesh.verma@test.com');
    await page.getByPlaceholder('10-digit mobile').fill('9812345678');
    await page.getByPlaceholder('e.g. Pune').fill('Pune');

    await page.getByRole('button', { name: 'Create Client' }).click();

    await expect(page).toHaveURL(/\/clients\/[a-z0-9-]{10,}/, { timeout: 10_000 });
    await expect(page.getByText(/ramesh kumar verma/i)).toBeVisible();
  });

  test('04 Clients list shows both created entries', async ({ page }) => {
    await page.goto('/clients');
    await expect(page.getByText(/state bank of india/i).first()).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(/ramesh kumar verma/i).first()).toBeVisible({ timeout: 8_000 });
  });
});
