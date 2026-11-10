import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';

test('dashboard reconciles net collections, average purchases and signed payment labels in both themes', async ({ page }) => {
  const errors: string[] = [], dashboardRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/reports/dashboard')) dashboardRequests.push(new URL(request.url()).pathname); });
  await login(page, 'reporting@example.test');
  const today = page.getByText('Sales today', { exact: true }).locator('..');
  await expect(today).toContainText('$11.00');
  await expect(page.getByText('Average sale', { exact: true }).locator('..')).toContainText('$22.00');
  await expect(page.getByText(/Store time: America\/Chicago/)).toBeVisible();
  const payment = page.getByRole('heading', { name: 'Payment Methods Today', exact: true }).locator('..').locator('..');
  await expect(payment).toContainText('$22.00'); await expect(payment).toContainText('-$11.00');
  await expect(payment.getByText(/Share unavailable/)).toHaveCount(2);
  await expect(page.getByText(/Some historical returns have no complete product allocation/)).toBeVisible();
  expect(dashboardRequests.length).toBeGreaterThan(0); expect(dashboardRequests.every(path => path === '/api/reports/dashboard')).toBe(true);
  await page.screenshot({ path: 'test-results/dashboard-light.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Toggle theme', exact: true }).filter({ visible: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.screenshot({ path: 'test-results/dashboard-dark.png', fullPage: true, animations: 'disabled' });
  await payment.scrollIntoViewIfNeeded();
  await payment.screenshot({ path: 'test-results/dashboard-payments-dark.png', animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('heading', { name: /^Good (morning|afternoon|evening), / }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/dashboard-mobile.png', fullPage: true, animations: 'disabled' });
  const chart = page.getByRole('heading', { name: 'Sales in the Last 12 Hours', exact: true }).locator('..').locator('..');
  await chart.scrollIntoViewIfNeeded(); await chart.screenshot({ path: 'test-results/dashboard-chart-mobile.png', animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByText(/\bNaN\b|Infinity/)).toHaveCount(0); expect(errors).toEqual([]);
});

test('a delayed dashboard response is invalidated and a coalesced read restores current figures', async ({ page }) => {
  await login(page, 'reporting@example.test');
  const total = page.getByText('Sales today', { exact: true }).locator('..');
  await expect(total).toContainText('$11.00');
  let release!: () => void, observed!: () => void, completed!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { observed = resolve; });
  const finished = new Promise<void>(resolve => { completed = resolve; });
  await page.route('**/api/reports/dashboard', async route => {
    const response = await route.fetch(), body = await response.json();
    body.data.todaySales = 999;
    observed(); await delayed;
    // A cross-tab mutation cancels this obsolete read. Its route may still finish.
    try { await route.fulfill({ response, json: body }); } catch { /* Intentionally cancelled. */ } finally { completed(); }
  }, { times: 1 });
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await started;
  const refreshed = page.waitForResponse(async response => new URL(response.url()).pathname === '/api/reports/dashboard'
    && response.status() === 200 && (await response.json()).data.todaySales === 11);
  await page.evaluate(() => { const channel = new BroadcastChannel('pos-read-invalidation-v1'); channel.postMessage(1); channel.close(); });
  release(); await finished;
  expect((await refreshed).status()).toBe(200);
  await expect(total).toContainText('$11.00'); await expect(total).not.toContainText('$999.00');
});

test('dashboard distinguishes an initial outage from zero and retains explicitly stale data on refresh failure', async ({ page }) => {
  await page.clock.install();
  let unavailable = true;
  await page.route('**/api/reports/dashboard', route => unavailable ? route.fulfill({ status: 503, json: { error: 'Unavailable' } }) : route.continue());
  await login(page, 'reporting@example.test');
  await expect(page.getByRole('alert')).toContainText('Dashboard data is unavailable');
  await expect(page.getByText('Sales today', { exact: true })).toHaveCount(0);
  unavailable = false; await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.clock.fastForward(5000);
  const today = page.getByText('Sales today', { exact: true }).locator('..');
  await expect(today).toContainText('$11.00');
  unavailable = true; await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('status').filter({ hasText: 'Showing previously loaded data' })).toContainText('Unavailable');
  await expect(today).toContainText('$11.00');
  unavailable = false; await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.clock.fastForward(5000);
  await expect(page.getByText('Showing previously loaded data.', { exact: false })).toHaveCount(0); await expect(today).toContainText('$11.00');
});

test('cashier dashboard keeps permitted shortcuts and hides restricted report and inventory actions', async ({ page }) => {
  await login(page, 'cashier@example.test'); await page.goto('/dashboard');
  await expect(page.getByText(/Showing your own sales/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Inventory Manage products', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reports See analytics', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Active Shifts/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Customers View directory', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New Sale Start checkout', exact: true }).click();
  await expect(page).toHaveURL(/\/pos$/);
});

test('dashboard pauses background refresh while hidden and refreshes when visible', async ({ page }) => {
  await login(page, 'reporting@example.test'); await page.clock.install(); await page.goto('/dashboard');
  await expect(page.getByText('Sales today', { exact: true }).locator('..')).toContainText('$11.00');
  let refreshes = 0; page.on('request', request => { if (new URL(request.url()).pathname === '/api/reports/dashboard') refreshes++; });
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.fastForward(31_000); expect(refreshes).toBe(0);
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/reports/dashboard');
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  expect((await response).status()).toBe(200); expect(refreshes).toBe(1);
});

test('background dashboard reads wait while an edit dialog or dirty form is active', async ({ page }) => {
  await login(page, 'reporting@example.test'); await page.clock.install(); await page.goto('/dashboard');
  await expect(page.getByText('Sales today', { exact: true }).locator('..')).toContainText('$11.00');
  let reads = 0; page.on('request', request => { if (new URL(request.url()).pathname === '/api/reports/dashboard') reads++; });
  await page.evaluate(() => {
    const dialog = document.createElement('div'); dialog.id = 'refresh-test-review'; dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
    dialog.textContent = 'Fixture review'; document.body.appendChild(dialog);
    window.dispatchEvent(new Event('focus'));
  });
  await page.clock.fastForward(31000); expect(reads).toBe(0);
  const resumed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/reports/dashboard');
  await page.evaluate(() => document.getElementById('refresh-test-review')!.remove()); await resumed;
  expect(reads).toBe(1);
  await page.evaluate(() => {
    const form = document.createElement('form'); form.id = 'refresh-test-draft'; form.innerHTML = '<label>Fixture draft<input value="original"></label>';
    document.body.appendChild(form); const input = form.querySelector('input')!; input.value = 'Unsaved draft'; input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.clock.fastForward(31000); expect(reads).toBe(1);
  await expect(page.getByLabel('Fixture draft')).toHaveValue('Unsaved draft');
  const reset = page.waitForResponse(response => new URL(response.url()).pathname === '/api/reports/dashboard');
  await page.evaluate(() => (document.getElementById('refresh-test-draft') as HTMLFormElement).reset()); await reset;
  expect(reads).toBe(2);
  await expect(page.getByRole('button', { name: /Refresh dashboard/i })).toHaveCount(0);
});
