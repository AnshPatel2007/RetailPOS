import { test, expect } from '@playwright/test';
import { login, TEST_USER, TEST_CASHIER } from './utils/auth-helper';

test('old inventory links retain filters and Stock Control keeps separate accessible views', async ({ page }, testInfo) => {
  await login(page, TEST_USER.email);
  await page.goto('/inventory-transfers?status=CANCELLED');
  await expect(page).toHaveURL(/\/inventory\/stock-control\/transfers\?status=CANCELLED$/);
  await expect(page.getByText('No transfers found', { exact: true })).toBeVisible();
  const navigation = page.getByRole('navigation', { name: 'Inventory / Stock Control views' });
  await navigation.getByRole('link', { name: 'Counts', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New Count', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('stock-counts-secondary-tabs.png'), animations: 'disabled' });
  await page.goBack(); await expect(page).toHaveURL(/status=CANCELLED$/);
  await navigation.getByRole('link', { name: 'Movement History', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Stock Control', exact: true })).toBeVisible();
  await page.getByLabel('Search movements').fill('absent movement fixture');
  await expect(page.getByText('No recorded movements match these filters.')).toBeVisible();
  await page.reload(); await expect(page.getByLabel('Search movements')).toHaveValue('absent movement fixture');
  await expect(page.getByText('No recorded movements match these filters.')).toBeVisible();
  await page.route('**/api/products/movements?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary movement failure' }) }), { times: 1 });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('alert')).toContainText('Temporary movement failure');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('No recorded movements match these filters.')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('stock-control-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await expect(navigation.getByRole('link', { name: 'Movement History' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('stock-control-phone-dark.png') });
});

test('cashier cannot open Stock Control through a direct or legacy link', async ({ page }) => {
  await login(page, TEST_CASHIER.email);
  for (const path of ['/inventory-transfers', '/cycle-counts', '/inventory/stock-control/movements']) {
    await page.goto(path); await expect(page.getByText('Access Denied', { exact: true })).toBeVisible();
  }
});
