import { test, expect } from '@playwright/test';
import { login, logout } from './utils/auth-helper';

test('owner settings keep separate views, preserve drafts and recover a failed read', async ({ page }) => {
  await login(page, 'owner@example.test');
  await page.goto('/settings');
  const views = page.getByRole('navigation', { name: 'Settings sections' });
  await expect(page.getByText('User Profile', { exact: true })).toBeVisible();
  await views.getByRole('button', { name: 'Receipts', exact: true }).click();
  await page.getByLabel('Receipt Header', { exact: true }).fill('Unsaved header draft');
  await views.getByRole('button', { name: 'Store', exact: true }).click();
  await expect(page.getByLabel('Store Name', { exact: true })).toHaveValue('Store A');
  await views.getByRole('button', { name: 'Receipts', exact: true }).click();
  await expect(page.getByLabel('Receipt Header', { exact: true })).toHaveValue('Unsaved header draft');
  await expect(page.getByLabel('Store Name', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(views.getByRole('button', { name: 'Receipts', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByLabel('Receipt Header', { exact: true })).not.toHaveValue('Unsaved header draft');
  await page.route('**/api/locations/my-settings*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Settings temporarily unavailable' }) }));
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Settings temporarily unavailable');
  await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeDisabled();
  await page.unroute('**/api/locations/my-settings*');
  await page.getByRole('button', { name: 'Retry settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.screenshot({ path: 'test-results/settings-receipts-phone-dark.png', fullPage: true });
});

test('manager and cashier settings expose only permitted sections and device actions', async ({ page }) => {
  await login(page, 'manager@example.test');
  await page.goto('/settings?section=payments');
  const views = page.getByRole('navigation', { name: 'Settings sections' });
  await expect(views.getByRole('button', { name: 'Taxes & Payments', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Store sales tax (%)')).toHaveCount(0);
  await views.getByRole('button', { name: 'Store', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeEnabled();
  await logout(page);
  await login(page, 'cashier@example.test');
  await page.goto('/settings?section=store');
  await expect(views.getByRole('button', { name: 'Store', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Store Name')).toHaveCount(0);
  await views.getByRole('button', { name: 'Devices', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Test Scanner', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save Hardware Settings', exact: true })).toHaveCount(0);
});

test('a fresh cashier register prints shared branding without saving local settings', async ({ page, browser }) => {
  await login(page, 'owner@example.test');
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const headers = { Authorization: 'Bearer ' + token };
  const previous = (await (await page.request.get('/api/locations/my-settings', { headers })).json()).data;
  const changed = await page.request.put('/api/locations/my-settings', { headers, data: {
    storeInfo: { storeName: 'Shared Receipt Store' },
    receiptSettings: { header: 'Fresh shared header', footer: 'Shared footer', showAddress: false, showTaxBreakdown: false },
  } });
  expect(changed.status()).toBe(200);
  const register = await browser.newContext();
  try {
    await register.addInitScript(() => { window.print = () => {}; window.close = () => {}; });
    const cashier = await register.newPage();
    await login(cashier, 'cashier@example.test');
    await cashier.goto('/settings?section=devices');
    await expect(cashier.getByText('Refreshing store settings...', { exact: true })).toHaveCount(0);
    const print = cashier.waitForEvent('popup');
    await cashier.getByRole('button', { name: 'Test Printer', exact: true }).click();
    const printed = await print;
    await expect(printed.locator('body')).toContainText('Shared Receipt Store');
    await expect(printed.locator('body')).toContainText('Fresh shared header');
    await expect(printed.locator('body')).toContainText('Shared footer');
    await expect(printed.locator('body')).not.toContainText('Tax:');
    await expect(cashier.getByText('Test print requested', { exact: true })).toBeVisible();
  } finally {
    await register.close();
    const restored = await page.request.put('/api/locations/my-settings', { headers, data: {
      storeInfo: { storeName: previous.name },
      receiptSettings: previous.settings.receiptSettings || { header: '', footer: 'Thank you for your purchase!', showAddress: true, showTaxBreakdown: true },
    } });
    expect(restored.status()).toBe(200);
  }
});
