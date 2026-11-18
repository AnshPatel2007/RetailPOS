import { test, expect } from '@playwright/test';
import { login, logout, TEST_USER, TEST_CASHIER } from './utils/auth-helper';
test('login form and invalid credentials', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill('missing@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Invalid123!');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page.getByText('Invalid credentials', { exact: true })).toBeVisible();
});
test('owner session survives reload and logout removes access', async ({ page }) => {
  await login(page, TEST_USER.email); await page.reload();
  await expect(page).toHaveURL(/\/dashboard$/);
  const oldToken = await page.evaluate(() => localStorage.getItem('token'));
  await logout(page); await page.goto('/inventory'); await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get('/api/auth/me', { headers: { Authorization: `Bearer ${oldToken}` } })).status()).toBe(401);
  expect((await page.request.post('/api/auth/refresh')).status()).toBe(401);
});

test('a delayed refresh from the previous cashier cannot restore or clear the new login', async ({ page }) => {
  await login(page, TEST_USER.email);
  let release!: () => void, observed!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { observed = resolve; });
  await page.route('**/api/auth/me', route => route.fulfill({ status: 401, json: { error: 'Expired fixture access token' } }), { times: 1 });
  await page.route('**/api/auth/refresh', async route => {
    const response = await route.fetch(); expect(response.status()).toBe(200); observed();
    await delayed; await route.fulfill({ response });
  }, { times: 1 });
  await page.evaluate(async () => {
    const modulePath = '/src/services/api.ts';
    const { api } = await import(modulePath);
    void api.get('/auth/me').catch(() => {});
  });
  await started;
  const signedOut = page.waitForResponse(r => r.url().endsWith('/api/auth/logout'));
  await page.getByRole('button', { name: 'Logout', exact: true }).filter({ visible: true }).click();
  expect((await signedOut).status()).toBe(200);
  await expect(page).toHaveURL(/\/login$/);
  // Stay in this application instance so the old in-flight request survives.
  await page.getByLabel('Email', { exact: true }).fill(TEST_CASHIER.email);
  await page.getByLabel('Password', { exact: true }).fill(TEST_CASHIER.password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const currentToken = await page.evaluate(() => localStorage.getItem('token'));
  const refreshed = page.waitForResponse(r => r.url().endsWith('/api/auth/refresh'));
  release(); await refreshed;
  // Wait for the actual client interceptor to finish, then inspect the active user.
  await page.evaluate(async () => {
    const modulePath = '/src/services/api.ts'; const { api } = await import(modulePath);
    await api.get('/auth/me');
  });
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(await page.evaluate(() => localStorage.getItem('token'))).toBe(currentToken);
  const me = await page.request.get('/api/auth/me', { headers: { Authorization: `Bearer ${currentToken}` } });
  expect((await me.json()).data.email).toBe(TEST_CASHIER.email);
});

test('logging out also removes access from another open register tab', async ({ page, context }) => {
  await login(page, TEST_USER.email);
  const other = await context.newPage();
  await other.goto('/inventory'); await expect(other.getByPlaceholder('Search by name, SKU, or barcode...')).toBeVisible();
  await logout(page);
  await expect(other).toHaveURL(/\/login$/);
  await expect(other.getByLabel('Email', { exact: true })).toBeVisible();
  await other.close();
});
test('forgot password opens recovery form', async ({ page }) => {
  await page.goto('/login'); await page.getByRole('button', { name: 'Forgot password?' }).click();
  await expect(page.getByText('Reset your password', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
});
test('cashier sees directory without analytics or payroll', async ({ page }) => {
  await login(page, TEST_CASHIER.email); await page.goto('/customers');
  await expect(page.getByRole('heading', { name: 'Customers', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Customer Insights', exact: true })).toHaveCount(0);
  await page.goto('/payroll'); await expect(page.getByText('Access Denied', { exact: true })).toBeVisible();
});
test('super admin retains theme control and has no payroll or reports link', async ({ page }) => {
  await login(page, 'platform@example.test');
  await expect(page.getByRole('link', { name: /payroll|reports/i })).toHaveCount(0);
  const theme = page.getByRole('button', { name: /Switch to (light|dark) mode/ });
  const before = await page.locator('html').getAttribute('class');
  await theme.click(); await expect(page.locator('html')).not.toHaveAttribute('class', before || '');
});
