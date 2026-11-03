import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';

test('bulk refund lost-response recovery preserves the request and pays once after drawer closure', async ({ page }) => {
  await login(page, 'bulk-voids@example.test');
  const auth = { Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token')) };
  let current = (await (await page.request.get('/api/shifts/current', { headers: auth })).json()).data;
  if (!current) {
    expect((await page.request.post('/api/shifts/clock-in', { headers: auth, data: { startingCash: 100 } })).status()).toBe(201);
    current = (await (await page.request.get('/api/shifts/current', { headers: auth })).json()).data;
  }
  const before = current.expectedDrawer;
  const product = (await (await page.request.get('/api/products?search=FIXTURE-BULK-VOID', { headers: auth })).json()).data[0];
  const created = await page.request.post('/api/sales', { headers: auth, data: { items: [{ productId: product.id, quantity: 2, price: 10 }], paymentMethod: 'CASH', amountPaid: 22 } });
  expect(created.status()).toBe(201); const sale = (await created.json()).data;
  await page.goto('/reports'); await page.getByRole('checkbox', { name: 'Select sale ' + sale.saleNumber, exact: true }).check();
  await page.getByRole('button', { name: 'Refund Selected', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Refund Selected Sales', exact: true });
  await expect(dialog).toContainText('Total refund: $22.00');
  await dialog.getByLabel('Refund reason', { exact: true }).fill('Verified returned goods');
  let original: unknown;
  await page.route('**/api/sales/bulk-refund', async route => {
    original = route.request().postDataJSON(); const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed');
  }, { times: 1 });
  await dialog.getByRole('button', { name: 'Record Bulk Refund', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Result uncertain');
  await page.reload(); await page.getByRole('button', { name: 'Review saved bulk refund', exact: true }).click();
  await expect(dialog).toContainText('Verified returned goods');
  const closed = await page.request.post('/api/shifts/clock-out', { headers: auth, data: { endingCash: before } });
  expect(closed.status()).toBe(200); expect((await closed.json()).data.cashDifference).toBe(0);
  const confirmed = page.waitForResponse(response => response.url().endsWith('/api/sales/bulk-refund') && response.status() === 200);
  await dialog.getByRole('button', { name: 'Retry saved operation', exact: true }).click();
  const response = await confirmed; expect(response.request().postDataJSON()).toEqual(original); expect((await response.json()).replayed).toBe(true);
  await expect(dialog).toHaveCount(0);
  const final = (await (await page.request.get('/api/sales/' + sale.id, { headers: auth })).json()).data;
  expect(final.status).toBe('REFUNDED'); expect(final.refunds).toHaveLength(1);
  expect((await (await page.request.get('/api/products/' + product.id, { headers: auth })).json()).data.stockQuantity).toBe(product.stockQuantity);
});
