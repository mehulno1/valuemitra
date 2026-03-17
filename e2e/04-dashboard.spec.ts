/**
 * Dashboard & navigation spec.
 * DashboardPage h1 says "Welcome, {name}", not "Dashboard".
 * NavLinks are <a> role=link.
 * Logout is button[title="Sign out"].
 */
import { test, expect } from '@playwright/test';

test.describe('Dashboard & Navigation', () => {
  test('01 Dashboard loads — Welcome heading visible', async ({ page }) => {
    await page.goto('/dashboard');
    // h1 says "Welcome, E2E Test Valuer" — filter by name to avoid matching sidebar "ValueMitra" h1
    await expect(page.getByRole('heading', { name: /welcome/i })).toBeVisible();
    // Sidebar is present
    await expect(page.locator('aside')).toBeVisible();
  });

  test('02 Sidebar navigation — Clients', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('link', { name: 'Clients' }).click();
    await expect(page).toHaveURL(/\/clients/);
    await expect(page.getByRole('heading', { name: /clients/i })).toBeVisible();
  });

  test('03 Sidebar navigation — Assignments', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('link', { name: 'Assignments' }).click();
    await expect(page).toHaveURL(/\/assignments/);
  });

  test('04 Sidebar — Dashboard link returns to dashboard', async ({ page }) => {
    await page.goto('/assignments');
    await page.getByRole('link', { name: 'Dashboard' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('05 Sidebar shows firm name', async ({ page }) => {
    await page.goto('/dashboard');
    // Tenant name appears in sidebar (AppLayout shows tenant?.name under the logo)
    await expect(page.locator('aside')).toContainText(/E2E Valuers LLP/i);
  });

  test('06 Logout redirects to login', async ({ page }) => {
    await page.goto('/dashboard');
    // Logout icon button has title="Sign out"
    await page.locator('button[title="Sign out"]').click();
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });
});
