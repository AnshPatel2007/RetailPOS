import { test, expect, Page } from '@playwright/test';
import { login } from './utils/auth-helper';
import fs from 'fs';
import { createRequire } from 'node:module';
const ExcelJS = createRequire(import.meta.url)('exceljs/dist/exceljs.min.js') as typeof import('exceljs');

const auth = async (page: Page) => ({ Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token')) });

// profit@example.test owns a store no other spec uses, so the statement holds only this spec's sale.
test('profit shows as not final while a stock exception is open and is confirmed once it is resolved', async ({ page }) => {
  await login(page, 'profit@example.test');
  const headers = await auth(page), stamp = Date.now();
  const api = async (path: string, data: object) => {
    const response = await page.request.post('/api' + path, { headers, data });
    expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
    return (await response.json()).data;
  };
  const product = await api('/products', { name: `Not final soda ${stamp}`, sku: `NOT-FINAL-${stamp}`, barcode: String(stamp),
    price: 2.5, cost: 1.5, stockQuantity: 0, isTaxable: false, trackInventory: true });
  // Two units on record at $1.50, three sold: the third unit's cost is an estimate.
  await api('/financial/inventory-costs/opening', { idempotencyKey: crypto.randomUUID(), notes: 'Counted on the shelf with the supplier invoice',
    items: [{ productId: product.id, quantity: 2, value: 3, expectedVersion: product.stockVersion }] });
  await api('/sales', { items: [{ productId: product.id, quantity: 3, price: 2.5 }], paymentMethod: 'CASH', amountPaid: 10, idempotencyKey: crypto.randomUUID() });

  await page.goto('/financial?tab=pnl');
  await expect(page.getByText('Profit & Loss Statement', { exact: true })).toBeVisible();
  const notice = page.getByRole('status').filter({ hasText: 'Profit is not final' });
  await expect(notice).toContainText(/Includes \$4\.50 of estimated cost for 1 stock exception\. Resolve it in Stock Control to confirm profit\./);
  await expect(notice.getByRole('link', { name: 'Resolve stock exceptions', exact: true })).toHaveAttribute('href', '/inventory/stock-control/exceptions');
  // The figures are shown, each marked, instead of a dash.
  const row = (label: string) => page.locator('.statement-row').filter({ has: page.getByText(label, { exact: true }) }).locator('dd');
  await expect(row('Cost of goods sold (includes estimates)')).toHaveText('($4.50)');
  await expect(row('Gross Profit (not final)')).toHaveText('$3.00');
  await expect(row('Net Income (not final)')).toHaveText('$3.00');
  await expect(page.getByText('40% margin · not final', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/profit-not-final.png', fullPage: true, animations: 'disabled' });

  const exportStatement = async () => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export Excel', exact: true }).click();
    const download = await pending;
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(fs.readFileSync((await download.path())!));
    return { name: download.suggestedFilename(), contents: JSON.stringify(workbook.model), headings: workbook.worksheets.map(sheet => String(sheet.getCell('A3').value)) };
  };
  const open = await exportStatement();
  expect(open.name).toContain('-not-final.xlsx');
  // Year to date has one sheet per month: only the month with the open exception is marked.
  expect(open.headings.filter(heading => heading === 'NOT FINAL • Includes estimated costs awaiting review')).toHaveLength(1);
  expect(open.contents).toContain('Not final: includes estimated costs awaiting review. Includes $4.50 of estimated cost for 1 stock exception.');

  // The same notice on Reports, pointing at the exceptions (not at missing costs).
  await page.goto('/insights/reports/overview');
  const reportNotice = page.getByRole('status').filter({ hasText: 'Profit is not final.' });
  await expect(reportNotice).toContainText('Includes $4.50 of estimated cost for 1 stock exception.');
  await expect(page.getByRole('link', { name: 'Resolve stock exceptions', exact: true })).toBeVisible();

  // A manager resolves the exception: the same profit is now confirmed.
  const list = await page.request.get('/api/inventory-exceptions', { headers });
  const exception = (await list.json()).data.find((item: { productId: string }) => item.productId === product.id);
  await api(`/inventory-exceptions/${exception.id}/resolve`, { resolution: 'NO_CHANGE_NEEDED' });
  await page.goto('/financial?tab=pnl');
  await expect(row('Gross Profit')).toHaveText('$3.00');
  await expect(page.getByText('Profit is not final', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Gross Profit (not final)', { exact: true })).toHaveCount(0);
  expect((await exportStatement()).name).toContain('-recorded.xlsx');
});
