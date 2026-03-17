import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,   // run tests serially — state depends on prior steps
  retries: 0,
  workers: 1,

  globalSetup: './e2e/global-setup.ts',

  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],

  use: {
    baseURL: 'http://localhost:5173',
    // Reuse the auth state from globalSetup for every test
    storageState: path.join(__dirname, 'e2e/.auth-storage.json'),
    // Record video for every test
    video: 'on',
    // Screenshot on failure
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    viewport: { width: 1400, height: 900 },
    // Slow down actions for readability in recordings
    launchOptions: { slowMo: 200 },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Assume servers are already started (we started them manually)
  webServer: [
    {
      command: 'npm run dev -w apps/api',
      url: 'http://localhost:3006/health',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'npm run dev -w apps/web',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
