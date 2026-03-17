/**
 * Auth spec — tests login/register UI flows with a clean browser (no stored auth).
 */
import { test, expect } from '@playwright/test';

// Run without the globalSetup storageState — these tests need a fresh browser
test.use({ storageState: { cookies: [], origins: [] } });

const TS = Date.now();
const NEW_EMAIL = `e2e-auth-${TS}@valuemitra-test.com`;
const PASSWORD = 'E2eTest@1234';

test.describe('Auth — Register & Login', () => {
  test('01 Register a new tenant', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByRole('heading', { name: 'Create firm workspace' })).toBeVisible();

    await page.locator('#fullName').fill('E2E Auth Tester');
    await page.locator('#email').fill(NEW_EMAIL);
    await page.locator('#password').fill(PASSWORD);
    await page.locator('#firmName').fill(`Auth Test Firm ${TS}`);
    await page.locator('#firmCode').fill(`AT${TS.toString().slice(-3)}`);
    await page.locator('#ibbiFirmRegNo').fill('IBBI/RVO/2020/AUTH001');

    await page.getByRole('button', { name: 'Create workspace' }).click();

    // After register → redirect to /login?registered=1
    await expect(page).toHaveURL(/\/login.*registered=1/, { timeout: 15_000 });
    await expect(page.getByText('Registration successful')).toBeVisible();
  });

  test('02 Login with registered credentials', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    await page.locator('#email').fill(NEW_EMAIL);
    await page.locator('#password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  });

  test('03 Wrong password shows error message', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#email').fill(NEW_EMAIL);
    await page.locator('#password').fill('WrongPassword999!');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // LoginPage renders errMsg from the API error response
    // api.ts interceptor skips auth endpoints, so 401 propagates to useMutation error state
    // auth.service throws UnauthorizedError('Invalid credentials')
    await expect(page.getByText(/invalid credentials/i)).toBeVisible({ timeout: 10_000 });
  });

  test('04 Protected route redirects unauthenticated user to /login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });
});
