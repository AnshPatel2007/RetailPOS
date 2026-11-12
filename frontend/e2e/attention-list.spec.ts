import { test, expect, Page } from '@playwright/test';
import { login } from './utils/auth-helper';

const auth = async (page: Page) => ({ Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token')) });

// attention@example.test owns a store no other spec uses, so it starts with nothing to report.
test('the owner dashboard opens with what needs attention, each with a link to fix it', async ({ page }) => {
  await login(page, 'attention@example.test');
  await page.goto('/dashboard');
  const list = page.locator('.attention-list');
  await expect(list.getByRole('heading', { name: 'Needs Attention', exact: true })).toBeVisible();
  await expect(list.getByText('Nothing needs attention right now.', { exact: true })).toBeVisible();
  // Owners see money tiles in place of the customer and product counts.
  const tile = (label: string) => page.locator('.summary-item').filter({ has: page.getByText(label, { exact: true }) });
  await expect(tile('Profit yesterday')).toContainText('$0.00'); await expect(tile('Profit yesterday')).toContainText('No sales yesterday');
  await expect(tile('Bills due this week')).toContainText('Nothing due');
  await expect(page.locator('.summary-item').filter({ has: page.getByText('Customers', { exact: true }) })).toHaveCount(0);

  const headers = await auth(page), stamp = Date.now();
  const api = async (path: string, data: object) => {
    const response = await page.request.post('/api' + path, { headers, data });
    expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
    return (await response.json()).data;
  };
  // An item sold with none on record, and an item priced below what it costs.
  const soda = await api('/products', { name: `Attention soda ${stamp}`, sku: `ATTN-${stamp}`, barcode: String(stamp), price: 2.5, cost: 1.5, stockQuantity: 0, isTaxable: false, trackInventory: true });
  await api('/products', { name: `Loss leader ${stamp}`, sku: `LEADER-${stamp}`, price: 1, cost: 2, stockQuantity: 5, isTaxable: false, trackInventory: true });
  await api('/sales', { items: [{ productId: soda.id, quantity: 1, price: 2.5 }], paymentMethod: 'CASH', amountPaid: 5, idempotencyKey: crypto.randomUUID() });

  await page.reload();
  const items = list.getByRole('list', { name: 'Needs attention' }).getByRole('listitem');
  await expect(items).toHaveCount(2);
  // Most urgent first: losing money on every sale outranks a fresh stock exception.
  await expect(items.nth(0)).toContainText('1 item is priced below what it costs.');
  await expect(items.nth(1)).toContainText(new RegExp(`Attention soda ${stamp} sold more than recorded stock and is waiting for a count \\(since [A-Z][a-z]{2} \\d{1,2}\\)\\.`));
  await expect(list.getByText('2 items', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/attention-list.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });

  await items.nth(1).getByRole('link', { name: 'Count items', exact: true }).click();
  await expect(page).toHaveURL(/\/inventory\/stock-control\/exceptions$/);
  await page.goBack();
  await items.nth(0).getByRole('link', { name: 'Review prices', exact: true }).click();
  await expect(page).toHaveURL(/\/inventory\/purchasing\/price-review$/);
});

test('cashiers do not get the attention list', async ({ page }) => {
  await login(page, 'cashier@example.test'); await page.goto('/dashboard');
  await expect(page.getByText(/Showing your own sales/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Needs Attention', exact: true })).toHaveCount(0);
  await expect(page.getByText('Profit yesterday', { exact: true })).toHaveCount(0);
});
