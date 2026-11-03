import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', timeout: 30000, fullyParallel: false, workers: 1,
  forbidOnly: !!process.env.CI, retries: process.env.CI ? 1 : 0,
  globalSetup: './e2e/global-setup.ts',
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:5174', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], channel: process.env.E2E_BROWSER_CHANNEL } },
    { name: 'firefox', testMatch: '**/ui-controls.spec.ts', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', testMatch: '**/ui-controls.spec.ts', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: [
    { command: 'node ../backend/scripts/e2e-server.cjs', url: 'http://127.0.0.1:5001/api/health', reuseExistingServer: false, timeout: 120000 },
    { command: 'npm run dev -- --host 127.0.0.1 --port 5174 --strictPort', url: 'http://127.0.0.1:5174', env: { POS_API_PROXY: 'http://127.0.0.1:5001', VITE_API_URL: '/api' }, reuseExistingServer: false }
  ]
});
