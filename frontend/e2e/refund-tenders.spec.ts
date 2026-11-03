import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';

test('mixed original-tender refund requires card evidence and retries exactly after a closed drawer', async ({ page }) => {
  await login(page, 'refund-tenders@example.test');
  const headers = { Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token')) };
  let current = (await (await page.request.get('/api/shifts/current', { headers })).json()).data;
  if (!current) {
    expect((await page.request.post('/api/shifts/clock-in', { headers, data: { startingCash: 100 } })).status()).toBe(201);
    current = (await (await page.request.get('/api/shifts/current', { headers })).json()).data;
  }
  const before = current.expectedDrawer;
  const product = (await (await page.request.get('/api/products?search=FIXTURE-REFUND-TENDER', { headers })).json()).data[0];
  const created = await page.request.post('/api/sales', { headers, data: { idempotencyKey: crypto.randomUUID(), items: [{ productId: product.id, quantity: 2, price: 10 }],
    paymentMethod: 'CASH', amountPaid: 30, payments: [{ paymentMethod: 'CASH', amount: 20 }, { paymentMethod: 'CARD', amount: 10, reference: 'ORIGINAL-CARD-CHARGE' }] } });
  expect(created.status()).toBe(201); const sale = (await created.json()).data;
  await page.goto('/pos'); await page.getByTitle('Quick refund', { exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Quick Refund', exact: true });
  await dialog.getByPlaceholder('Enter sale number...').fill(sale.saleNumber);
  await dialog.getByRole('button', { name: 'Find sale', exact: true }).click();
  await dialog.getByRole('button', { name: 'Select all', exact: true }).click();
  await expect(dialog).toContainText('Remaining $12.00'); await expect(dialog).toContainText('Remaining $10.00');
  await expect(dialog.getByRole('button', { name: 'Refund $22.00', exact: true })).toBeDisabled();
  await dialog.getByLabel(/Terminal refund reference for payment/).fill('TERMINAL-REFUND-10');
  await expect(dialog.getByRole('button', { name: 'Refund $22.00', exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.screenshot({ path: 'test-results/mixed-refund-phone-dark.png', fullPage: true });
  page.on('dialog', native => native.accept());
  let saved: unknown;
  await page.route('**/api/sales/*/refund', async route => { saved = route.request().postDataJSON(); const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed'); }, { times: 1 });
  await dialog.getByRole('button', { name: 'Refund $22.00', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Retry saved refund', exact: true })).toBeEnabled();
  const closed = await page.request.post('/api/shifts/clock-out', { headers, data: { endingCash: before } });
  expect(closed.status()).toBe(200); expect((await closed.json()).data.cashDifference).toBe(0);
  await page.reload(); await page.getByRole('button', { name: 'Open sale cart', exact: true }).click();
  await page.getByRole('button', { name: 'Quick refund', exact: true }).click();
  const replay = page.waitForResponse(response => response.url().endsWith('/refund') && response.status() === 200);
  await dialog.getByRole('button', { name: 'Retry saved refund', exact: true }).click();
  const result = await replay; expect(result.request().postDataJSON()).toEqual(saved); expect((await result.json()).replayed).toBe(true);
  await expect(dialog).toHaveCount(0);
  const final = (await (await page.request.get('/api/sales/' + sale.id, { headers })).json()).data;
  expect(final.refunds).toHaveLength(1); expect(final.refunds[0]).toMatchObject({ amount: 22, method: 'SPLIT', tenders: expect.arrayContaining([
    expect.objectContaining({ method: 'CASH', amount: 12 }), expect.objectContaining({ method: 'CARD', amount: 10, reference: 'TERMINAL-REFUND-10' }),
  ]) });
  expect((await (await page.request.get('/api/products/' + product.id, { headers })).json()).data.stockQuantity).toBe(product.stockQuantity);
});

test('a definitive POS rejection keeps precompleted terminal evidence through reload and later confirmation', async ({ page }) => {
  await login(page, 'refund-tenders@example.test');
  const headers = { Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token')) };
  if (!(await (await page.request.get('/api/shifts/current', { headers })).json()).data) expect((await page.request.post('/api/shifts/clock-in', { headers, data: { startingCash: 100 } })).status()).toBe(201);
  const product = (await (await page.request.get('/api/products?search=FIXTURE-REFUND-TENDER', { headers })).json()).data[0];
  const created = await page.request.post('/api/sales', { headers, data: { idempotencyKey: crypto.randomUUID(), items: [{ productId: product.id, quantity: 1, price: 10 }], paymentMethod: 'CARD', amountPaid: 11 } });
  expect(created.status()).toBe(201); const sale = (await created.json()).data;
  await page.goto('/pos'); await page.getByTitle('Quick refund', { exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Quick Refund', exact: true });
  await dialog.getByPlaceholder('Enter sale number...').fill(sale.saleNumber); await dialog.getByRole('button', { name: 'Find sale', exact: true }).click();
  await dialog.getByRole('button', { name: 'Select all', exact: true }).click(); await dialog.getByLabel(/Terminal refund reference for payment/).fill('PRECOMPLETED-TERMINAL-11');
  page.on('dialog', native => native.accept());
  let original: unknown;
  await page.route('**/api/sales/*/refund', async route => { if (!original) original = route.request().postDataJSON(); await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Original tender changed; owner review required.' }) }); });
  await dialog.getByRole('button', { name: 'Refund $11.00', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('terminal refund evidence remains saved');
  await page.reload(); await page.getByTitle('Quick refund', { exact: true }).click();
  await expect(dialog).toContainText('External card refund evidence is saved');
  const rejected = page.waitForResponse(response => response.url().endsWith('/refund') && response.status() === 409);
  await dialog.getByRole('button', { name: 'Retry saved refund', exact: true }).click();
  expect((await rejected).request().postDataJSON()).toEqual(original);
  await expect(dialog.getByRole('button', { name: 'Retry saved refund', exact: true })).toBeEnabled();
  await page.unroute('**/api/sales/*/refund');
  const confirmed = page.waitForResponse(response => response.url().endsWith('/refund') && response.status() === 200);
  await dialog.getByRole('button', { name: 'Retry saved refund', exact: true }).click();
  expect((await confirmed).request().postDataJSON()).toEqual(original); await expect(dialog).toHaveCount(0);
  const final = (await (await page.request.get('/api/sales/' + sale.id, { headers })).json()).data;
  expect(final.refunds).toHaveLength(1); expect(final.refunds[0].tenders[0]).toMatchObject({ method: 'CARD', amount: 11, reference: 'PRECOMPLETED-TERMINAL-11' });
});
