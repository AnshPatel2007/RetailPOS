import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

/**
 * UX audit: crawls every screen per role and records key flows, writing
 * screenshots and findings to the git-ignored .local/ux-audit-2026-11/.
 * Kept out of the normal test run. Run: npx playwright test -c playwright.audit.config.ts
 */
export default defineConfig({
  testDir: './e2e-audit',
  timeout: 45 * 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  globalSetup: './e2e/global-setup.ts',
  reporter: [['list']],
  outputDir: '../.local/ux-audit-2026-11/test-output',
  use: { baseURL: 'http://127.0.0.1:5174', trace: 'off', screenshot: 'off', actionTimeout: 15_000, navigationTimeout: 30_000 },
  projects: [{ name: 'audit', use: { ...devices['Desktop Chrome'], channel: process.env.E2E_BROWSER_CHANNEL } }],
  webServer: base.webServer,
});
