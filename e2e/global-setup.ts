import { chromium, type FullConfig } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const API_URL = 'http://localhost:3006/api';
const WEB_URL = 'http://localhost:5173';
const STATE_FILE = path.join(__dirname, '.auth-state.json');
const STORAGE_FILE = path.join(__dirname, '.auth-storage.json');

export default async function globalSetup(_config: FullConfig) {
  const TS = Date.now();
  const email = `e2e-${TS}@valuemitra-test.com`;
  const password = 'E2eTest@1234';
  const firmCode = `E2E${TS.toString().slice(-4)}`;
  const firmName = `E2E Valuers LLP`;

  console.log(`\n[E2E Setup] Registering test user: ${email}`);

  // 1. Register via API
  const regRes = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'E2E Test Valuer',
      email,
      password,
      firmName,
      firmCode,
      ibbiFirmRegNo: 'IBBI/RVO/2020/E2E001',
    }),
  });

  if (!regRes.ok) {
    const err = await regRes.text();
    throw new Error(`Registration failed: ${err}`);
  }
  console.log('[E2E Setup] Registration successful');

  // 2. Login via API
  const loginRes = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!loginRes.ok) {
    const err = await loginRes.text();
    throw new Error(`Login failed: ${err}`);
  }

  const loginData = (await loginRes.json()) as {
    data: {
      user: { id: string; email: string; fullName: string; role: string; tenantId: string };
      tenant: { id: string; name: string; slug: string; firmCode: string };
      accessToken: string;
      refreshToken: string;
    };
  };

  const { user, tenant, accessToken, refreshToken } = loginData.data;
  console.log(`[E2E Setup] Login OK — tenant: ${tenant.name} (${tenant.firmCode})`);

  // 3. Save credentials for spec files to use (email, password, etc.)
  fs.writeFileSync(STATE_FILE, JSON.stringify({ email, password, firmCode }));

  // 4. Launch browser, inject auth state into localStorage, save storageState
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(WEB_URL);

  // Inject Zustand persist state — key: 'vm-auth'
  await page.evaluate(
    ({ user, tenant, accessToken, refreshToken }) => {
      const authState = {
        state: { user, tenant, accessToken, refreshToken, isAuthenticated: true },
        version: 0,
      };
      localStorage.setItem('vm-auth', JSON.stringify(authState));
    },
    { user, tenant, accessToken, refreshToken },
  );

  // Navigate to dashboard to confirm auth works
  await page.goto(`${WEB_URL}/dashboard`);
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
  console.log('[E2E Setup] Auth state confirmed — dashboard loaded');

  await context.storageState({ path: STORAGE_FILE });
  await browser.close();
  console.log(`[E2E Setup] Storage state saved to ${STORAGE_FILE}\n`);
}
