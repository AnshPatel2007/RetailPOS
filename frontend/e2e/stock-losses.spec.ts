import { test, expect, Page } from '@playwright/test';
import { login } from './utils/auth-helper';

const auth = async (page: Page) => ({ Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token')) });

// losses@example.test owns a store no other spec uses, so the month holds only this spec's write-offs.
test('Finances shows stock lost by cause at cost and keeps paper corrections apart', async ({ page }) => {
  await login(page, 'losses@example.test');
  const headers = await auth(page), stamp = Date.now();
  const api = async (path: string, data: object) => {
    const response = await page.request.post('/api' + path, { headers, data });
    expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
    return (await response.json()).data;
  };
  const product = await api('/products', { name: `Loss check cola ${stamp}`, sku: `LOSS-${stamp}`, barcode: String(stamp),
    price: 2.5, cost: 1.5, stockQuantity: 0, isTaxable: false, trackInventory: true });
  await api('/financial/inventory-costs/opening', { idempotencyKey: crypto.randomUUID(), notes: 'Counted on the shelf with the supplier invoice',
    items: [{ productId: product.id, quantity: 20, value: 30, expectedVersion: product.stockVersion }] });
  const adjust = (quantity: number, type: string) => api(`/products/${product.id}/adjust-inventory`, { quantity, type });
  await adjust(-2, 'DAMAGED'); await adjust(-1, 'THEFT'); await adjust(-1, 'MISCOUNT');
  await adjust(-1, 'SOLD_WITHOUT_SCANNING'); // a record fix: cost of sales, not a loss

  await page.goto('/financial?tab=inventory&costTab=losses');
  const losses = page.getByRole('table', { name: 'Stock losses by cause', exact: true });
  const cells = (table: typeof losses, name: string) => table.getByRole('row').filter({ hasText: name }).getByRole('cell');
  await expect(cells(losses, 'Damaged')).toHaveText(['Damaged', '1', '2', '$3.00']);
  await expect(cells(losses, 'Theft')).toHaveText(['Theft', '1', '1', '$1.50']);
  await expect(cells(losses, 'Count shortfall')).toHaveText(['Count shortfall', '1', '1', '$1.50']);
  await expect(losses.getByRole('row')).toHaveCount(4); // heading and three causes
  const fixes = page.getByRole('table', { name: 'Paper corrections', exact: true });
  await expect(cells(fixes, 'Items sold without scanning')).toHaveText(['Items sold without scanning', '1', '1', '$1.50']);
  // The total counts the three losses only.
  const tile = (label: string) => page.locator('.summary-item').filter({ has: page.getByText(label, { exact: true }) });
  await expect(tile('Stock lost')).toContainText('$6.00'); await expect(tile('Stock lost')).toContainText('4 units in 3 records');
  await expect(tile('Loss after found stock')).toContainText('$6.00');
  await expect(tile('Paper corrections')).toContainText('Records fixed, nothing lost');
  await page.screenshot({ path: 'test-results/stock-losses.png', fullPage: true, animations: 'disabled' });

  // A month with nothing written off says so.
  await page.getByLabel('Losses month', { exact: true }).fill('2025-01');
  await expect(losses.getByRole('row').filter({ hasText: 'No stock losses recorded this month.' })).toBeVisible();
  await expect(tile('Stock lost')).toContainText('Nothing written off');

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
