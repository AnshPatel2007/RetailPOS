import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';
import { saleComplete } from './utils/sale-complete';

test('sales pages keep full-range totals and a recoverable sale URL after reload', async ({ page }) => {
  await login(page, 'reporting@example.test');
  const headers = { Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token')) };
  const existing = (await (await page.request.get('/api/reports/sales', { headers })).json()).data;
  const original = existing.sales[0];
  expect(original).toBeTruthy();
  const originalDetail = (await (await page.request.get('/api/sales/' + original.id, { headers })).json()).data;
  const requestedPages: number[] = [];
  await page.route('**/api/reports/sales?*', async route => {
    const requested = Number(new URL(route.request().url()).searchParams.get('page') || 1);
    requestedPages.push(requested);
    const start = (requested - 1) * 50;
    const sales = Array.from({ length: Math.min(50, 101 - start) }, (_, offset) => ({ ...original, id: 'paged-' + (start + offset), saleNumber: 'PAGED-' + (start + offset) }));
    await route.fulfill({ json: { success: true, data: { ...existing, sales, refunds: [], voids: [], entries: [], entriesPartial: true,
      summary: { ...existing.summary, totalSales: 101, totalTransactions: 101 },
      pagination: { ...existing.pagination, entryCount: 101, sales: { page: requested, pageSize: 50, total: 101, totalPages: 3 } },
    } } });
  });
  let detailUnavailable = true;
  await page.route('**/api/sales/paged-*', async route => {
    if (detailUnavailable) return route.fulfill({ status: 503, json: { error: 'Sale details temporarily unavailable' } });
    const id = new URL(route.request().url()).pathname.split('/').pop()!;
    return route.fulfill({ json: { success: true, data: { ...originalDetail, id, saleNumber: 'PAGED-' + id.slice(6) } } });
  });
  await page.goto('/insights/reports/sales');
  const total = page.getByText('Sales after refunds (incl. tax)', { exact: true }).locator('..');
  await expect(total).toContainText('$101.00');
  const pages = page.getByLabel('Sale pages', { exact: true });
  await expect(pages).toContainText('Page 1 of 3 (101 sales)');
  await pages.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(pages).toContainText('Page 2 of 3');
  await expect(page.getByText('PAGED-50', { exact: true })).toBeVisible();
  await expect(page.getByText('PAGED-0', { exact: true })).toHaveCount(0);
  await expect(total).toContainText('$101.00');
  expect(requestedPages).toContain(2);
  await page.getByRole('row').filter({ hasText: 'PAGED-50' }).getByTitle('View details', { exact: true }).click();
  await expect(page).toHaveURL(/record=paged-50/);
  const modal = page.getByRole('dialog', { name: 'Sale Details', exact: true });
  await expect(modal.getByRole('alert')).toContainText('Sale details temporarily unavailable');
  detailUnavailable = false;
  await modal.getByRole('button', { name: 'Retry sale', exact: true }).click();
  await expect(modal).toContainText('PAGED-50');
  await page.reload();
  await expect(modal).toContainText('PAGED-50');
  await expect(page).toHaveURL(/page=2.*record=paged-50/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await expect(modal.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
  await modal.screenshot({ path: 'test-results/sale-detail-mobile-dark.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  await expect(page).toHaveURL(/page=2$/);
});

test('a completed checkout invalidates the cached sales report before returning to it', async ({ page }) => {
  await login(page, 'bulk-other@example.test');
  const headers = { Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token')) };
  if (!(await (await page.request.get('/api/shifts/current', { headers })).json()).data) {
    expect((await page.request.post('/api/shifts/clock-in', { headers, data: { startingCash: 100 } })).status()).toBe(201);
  }
  const fixtureId = crypto.randomUUID().slice(0, 8);
  const productName = 'Report cache checkout ' + fixtureId;
  const sku = 'REPORT-CACHE-' + fixtureId;
  expect((await page.request.post('/api/products', { headers, data: { name: productName, sku, price: 10, cost: 4, stockQuantity: 3, lowStockAlert: 0, trackInventory: true } })).status()).toBe(201);
  const before = (await (await page.request.get('/api/reports/sales', { headers })).json()).data.summary.totalSales;
  let requests = 0;
  page.on('request', request => { if (request.url().includes('/api/reports/sales?')) requests += 1; });
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'All Sales', exact: true })).toBeVisible();
  const priorRequests = requests;
  await page.getByRole('navigation').getByRole('link', { name: 'POS', exact: true }).first().click();
  await page.getByPlaceholder('Search products... (/ or F3)', { exact: true }).fill(sku);
  await page.getByRole('button', { name: new RegExp('^' + productName) }).click();
  await page.getByRole('button', { name: 'Charge $11.00', exact: true }).click();
  const payment = page.getByRole('dialog', { name: 'Payment', exact: true });
  await payment.getByRole('button', { name: 'Exact', exact: true }).click();
  await payment.getByRole('button', { name: 'Charge $11.00', exact: true }).click();
  await expect(saleComplete(page)).toBeVisible();
  // Router navigation keeps this application's in-memory cache alive.
  await page.goBack();
  const total = page.getByText('Sales after refunds (incl. tax)', { exact: true }).locator('..');
  await expect(total).toContainText(new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(before + 11));
  expect(requests).toBeGreaterThan(priorRequests);
});
