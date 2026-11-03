import { test, expect } from '@playwright/test';
import { login, TEST_USER } from './utils/auth-helper';

test('a refund with a lost response survives reload and pays from the later drawer once', async ({ page }) => {
  await login(page, TEST_USER.email);
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const headers = { Authorization: 'Bearer ' + token };
  const products = await (await page.request.get('/api/products?search=Fixture%20Refund', { headers })).json();
  const originalShift = (await (await page.request.get('/api/shifts/current', { headers })).json()).data;
  const saleResponse = await page.request.post('/api/sales', { headers, data: { items: [{ productId: products.data[0].id, price: 10, quantity: 1 }], paymentMethod: 'CASH', amountPaid: 20, idempotencyKey: crypto.randomUUID() } });
  expect(saleResponse.status()).toBe(201); const sale = (await saleResponse.json()).data;
  expect((await page.request.post('/api/shifts/clock-out', { headers, data: { endingCash: 111 } })).status()).toBe(200);
  const before = (await (await page.request.get('/api/shifts/' + originalShift.id + '/z-report', { headers })).json()).data;
  expect((await page.request.post('/api/shifts/clock-in', { headers, data: { startingCash: 100 } })).status()).toBe(201);
  await page.goto('/pos'); await page.getByTitle('Quick refund', { exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Quick Refund', exact: true });
  await dialog.getByPlaceholder('Enter sale number...').fill(sale.saleNumber);
  await dialog.getByRole('button', { name: 'Find sale', exact: true }).click();
  await dialog.getByRole('button', { name: 'Amount only', exact: true }).click();
  await dialog.getByLabel('Refund Amount', { exact: false }).fill('5');
  page.on('dialog', native => native.accept());
  await page.route('**/api/sales/*/refund', async route => {
    const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed');
  }, { times: 1 });
  await dialog.getByRole('button', { name: 'Refund $5.00', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Retry saved refund', exact: true })).toBeEnabled();
  await page.reload(); await page.getByTitle('Quick refund', { exact: true }).click();
  const replay = page.waitForResponse(r => r.url().endsWith('/refund') && r.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Retry saved refund', exact: true }).click();
  expect((await replay).status()).toBe(200);
  await expect(dialog).toHaveCount(0);
  const detail = (await (await page.request.get('/api/sales/' + sale.id, { headers })).json()).data;
  expect(detail.refunds).toHaveLength(1); expect(detail.refunds[0].amount).toBe(5);
  const after = (await (await page.request.get('/api/shifts/' + originalShift.id + '/z-report', { headers })).json()).data;
  expect(after).toEqual(before);
  await page.goto('/shifts');
  await expect(page.getByText('Cash Refunds & Voids Paid', { exact: true })).toBeVisible();
  await expect(page.getByText('$95.00', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/drawer-refund.png', fullPage: true });
  await page.getByRole('button', { name: 'Clock Out', exact: true }).click();
  const close = page.getByRole('dialog', { name: 'Clock Out', exact: true });
  await close.getByLabel('Ending Cash (Actual Count)', { exact: true }).fill('95');
  await close.getByRole('button', { name: 'Clock Out', exact: true }).click();
  const summary = page.getByRole('dialog', { name: 'Shift Summary', exact: true });
  await expect(summary.getByText('Cash Refunds Paid', { exact: true })).toBeVisible();
  await expect(summary.getByText('-$5.00', { exact: true })).toBeVisible();
});

test('a previously saved safe drop remains recoverable after the movement control is removed', async ({ page }) => {
  await login(page, 'manager@example.test'); await page.goto('/shifts');
  await expect(page.getByRole('button', { name: 'Clock Out', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Cash Movement', exact: true })).toHaveCount(0);
  // Simulate the durable request left by the former movement dialog.
  await page.evaluate(() => {
    const user = JSON.parse(localStorage.getItem('user')!);
    localStorage.setItem(`pos-pending-movement:${user.locationId || ''}:${user.id}`, JSON.stringify({
      label: 'SAFE_DROP', amount: 20,
      payload: { type: 'SAFE_DROP', amount: 20, reason: 'Safe drop test', idempotencyKey: crypto.randomUUID() },
    }));
  });
  await page.reload();
  await page.route('**/api/shifts/cash-movement', async route => {
    const response = await route.fetch(); expect(response.status()).toBe(201); await route.abort('failed');
  }, { times: 1 });
  await page.getByRole('button', { name: 'Retry saved cash movement', exact: true }).click();
  await expect(page.getByText(/Movement result is unconfirmed/)).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Retry saved cash movement', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry saved cash movement', exact: true })).toHaveCount(0);
  await expect(page.getByText('$80.00', { exact: true })).toBeVisible();
  await expect(page.getByText('SAFE DROP — Safe drop test', { exact: true })).toHaveCount(1);
});
