import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

/**
 * The built, installable app (service worker and all) served by `vite preview`:
 * proves the register starts and sells with no connection. Kept out of the
 * normal run because it builds the app first.
 * Run: node scripts/verify-pos.cjs browser -c playwright.pwa.config.ts
 */
const servers = Array.isArray(base.webServer) ? base.webServer : [];
export default defineConfig({
  testDir: './e2e-pwa',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  globalSetup: './e2e/global-setup.ts',
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:5175', trace: 'retain-on-failure', screenshot: 'only-on-failure', serviceWorkers: 'allow' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: process.env.E2E_BROWSER_CHANNEL } }],
  webServer: [
    servers[0],
    { command: 'npm run build && npx vite preview --host 127.0.0.1 --port 5175 --strictPort', url: 'http://127.0.0.1:5175',
      env: { POS_API_PROXY: 'http://127.0.0.1:5001', VITE_API_URL: '/api' }, reuseExistingServer: false, timeout: 300_000 },
  ],
});
