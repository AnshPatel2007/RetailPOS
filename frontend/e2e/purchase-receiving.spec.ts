import { test, expect } from '@playwright/test';
import { login, TEST_USER } from './utils/auth-helper';

test('partial delivery survives a lost response and reload, then closes with documented damage', async ({ page }) => {
  await login(page, TEST_USER.email); await page.goto('/suppliers');
  const before = await page.evaluate(async () => (await (await fetch('/api/analytics/business-health', {
    headers: { Authorization: 'Bearer ' + localStorage.getItem('token') },
  })).json()).data.profitability);
  await page.getByRole('navigation', { name: 'Inventory / Purchasing views' }).getByRole('link', { name: 'Orders', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: 'PO-FIXTURE' });
  await row.getByTitle('Receive Delivery').click();
  const delivery = page.getByRole('dialog', { name: 'Receive delivery · PO-FIXTURE', exact: true });
  await delivery.getByLabel('Fixture Delivery accepted').fill('3');
  await expect(delivery.getByText('7 units will remain open for a later delivery.')).toBeVisible();
  // The server commits, but the browser never receives its response.
  await page.route('**/api/purchase-orders/*/receive', async route => {
    const response = await route.fetch(); expect(response.status()).toBe(200);
    await route.abort('failed');
  }, { times: 1 });
  await delivery.getByRole('button', { name: 'Record delivery', exact: true }).click();
  await expect(delivery.getByRole('alert')).toContainText('uncertain');
  await page.reload();
  await page.getByRole('navigation', { name: 'Inventory / Purchasing views' }).getByRole('link', { name: 'Orders', exact: true }).click();
  await expect(row.getByText('Partially received', { exact: true })).toBeVisible();
  await row.getByTitle('Receive Delivery').click();
  await expect(delivery.getByLabel('Fixture Delivery accepted')).toHaveValue('3');
  await expect(delivery.getByLabel('Fixture Delivery accepted')).toBeDisabled();
  const replayed = page.waitForResponse(r => r.url().endsWith('/receive') && r.request().method() === 'POST');
  await delivery.getByRole('button', { name: 'Retry saved delivery', exact: true }).click();
  const replay = await (await replayed).json(); expect(replay.data.replayed).toBe(true);
  await expect(delivery).toHaveCount(0);
  await row.getByTitle('View Details').click();
  const details = page.getByRole('dialog', { name: 'Order PO-FIXTURE', exact: true });
  await expect(details.getByText('3 accepted · 0 damaged · 0 rejected')).toBeVisible();
  await expect(details.getByText(/· Partial delivery/)).toHaveCount(1);
  await details.getByRole('button', { name: 'Receive Delivery', exact: true }).click();
  await delivery.getByLabel('Fixture Delivery accepted').fill('4');
  await delivery.getByLabel('Fixture Delivery damaged').fill('2');
  await delivery.getByLabel('Fixture Delivery rejected').fill('1');
  await delivery.getByRole('button', { name: 'Record delivery', exact: true }).click();
  await expect(delivery.getByRole('alert')).toContainText('Add a reason');
  await delivery.getByLabel('Delivery notes / discrepancy reason').fill('Two crushed; one wrong item');
  await delivery.getByRole('button', { name: 'Record delivery', exact: true }).click();
  await expect(delivery).toHaveCount(0);
  await expect(details.getByText('Closed', { exact: true })).toBeVisible();
  await expect(details.getByText('7 accepted · 2 damaged · 1 rejected')).toBeVisible();
  await expect(details.getByText('Two crushed; one wrong item')).toBeVisible();
  await expect(details.getByRole('button', { name: 'Receive Delivery', exact: true })).toHaveCount(0);
  await page.goto('/inventory');
  await page.getByPlaceholder('Search by name, SKU, or barcode...').fill('Fixture Delivery');
  await expect(page.getByRole('row').filter({ hasText: 'Fixture Delivery' }).getByText('107', { exact: true })).toBeVisible();
  await page.goto('/analytics?tab=health');
  const received = before.receivedInventoryPurchases + 35;
  const currency = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  await expect(page.getByText('Inventory received at cost', { exact: true }).locator('..')).toContainText(currency(received));
  await expect(page.getByText('- Operating Expenses', { exact: true }).locator('..')).toContainText(currency(before.expenses));
  await expect(page.getByText('+ Other income', { exact: true }).locator('..')).toContainText(currency(before.otherIncome));
  await page.getByText('Monthly P&L', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/received-purchases-analytics.png', fullPage: true });
  await page.getByRole('button', { name: 'Toggle theme', exact: true }).filter({ visible: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByText('Monthly P&L', { exact: true }).locator('..').screenshot({ path: 'test-results/received-purchases-mobile-dark.png' });
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit' }).format(new Date());
  await page.goto('/financial?tab=pnl&pnlMonth=' + month);
  await expect(page.getByText('Inventory received at cost', { exact: true }).locator('..')).toContainText(currency(received));
});
