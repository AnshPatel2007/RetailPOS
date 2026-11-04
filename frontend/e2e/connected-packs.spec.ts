import { test, expect, Page } from '@playwright/test';
import { login } from './utils/auth-helper';

const auth = async (page: Page) => ({ Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token')) });

test('a 12-pack scans at its own price and sells from the can stock', async ({ page }) => {
  await login(page, 'owner@example.test');
  const stamp = Date.now();
  const name = `Cola can ${stamp}`, packBarcode = `12${stamp}`;
  const created = await page.request.post('/api/products', { headers: await auth(page), data: {
    name, sku: `COLA-${stamp}`, barcode: `01${stamp}`, price: 1.25, cost: 0.5, stockQuantity: 24, isTaxable: false, trackInventory: true,
  } });
  expect(created.status()).toBe(201);
  const product = (await created.json()).data;
  const pack = await page.request.post(`/api/products/${product.id}/selling-units`, { headers: await auth(page), data: {
    name: '12-pack', barcode: packBarcode, unitsPerPackage: 12, price: 9.99, baseUnitName: 'can',
  } });
  expect(pack.status()).toBe(201);

  await page.goto('/pos');
  await page.getByPlaceholder('Search products... (/ or F3)', { exact: true }).fill(packBarcode);
  const tile = page.getByRole('button', { name: new RegExp('^' + name + ' \\(12-pack\\)') });
  await tile.click();
  await page.getByRole('button', { name: 'Charge $9.99', exact: true }).click();
  const payment = page.getByRole('dialog', { name: 'Payment', exact: true });
  await payment.getByRole('button', { name: 'Exact', exact: true }).click();
  const saved = page.waitForResponse(response => response.url().endsWith('/api/sales') && response.request().method() === 'POST');
  await payment.getByRole('button', { name: 'Charge $9.99', exact: true }).click();
  expect((await saved).status()).toBe(201);

  // One stock of cans: the 12-pack took 12 of the 24.
  const after = (await (await page.request.get('/api/products/' + product.id, { headers: await auth(page) })).json()).data;
  expect(after.stockQuantity).toBe(12);
});

test('items under the target margin are listed with a rounded-up price, and exceptions show a badge', async ({ page }) => {
  await login(page, 'owner@example.test');
  const stamp = Date.now();
  const rule = await page.request.put('/api/pricing/rules', { headers: await auth(page), data: { scope: 'STORE', targetMargin: 0.3, rounding: 'CENT' } });
  expect(rule.status()).toBe(200);
  const name = `Under target tea ${stamp}`;
  expect((await page.request.post('/api/products', { headers: await auth(page), data: {
    name, sku: `TEA-${stamp}`, price: 1.99, cost: 1.5, stockQuantity: 0, isTaxable: false, trackInventory: true,
  } })).status()).toBe(201);

  await page.goto('/inventory/purchasing/price-review');
  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row).toContainText('Under target');
  await expect(row.getByLabel('New price for ' + name, { exact: true })).toHaveValue('2.15');

  // Selling the zero-stock tea opens an exception; the count shows on Stock Control and its Exceptions tab.
  const product = (await (await page.request.get('/api/products?search=' + encodeURIComponent(name), { headers: await auth(page) })).json()).data[0];
  expect((await page.request.post('/api/sales', { headers: await auth(page), data: {
    items: [{ productId: product.id, quantity: 1, price: 1.99 }], paymentMethod: 'CASH', amountPaid: 2, idempotencyKey: crypto.randomUUID(),
  } })).status()).toBe(201);
  await page.goto('/inventory/stock-control/exceptions');
  await expect(page.getByLabel(/\d+ need review/)).toBeVisible();
  // The count describes the Stock Control link; its name stays "Stock Control".
  await expect(page.getByRole('link', { name: 'Stock Control', exact: true }).filter({ visible: true })).toHaveAttribute('aria-description', /^\d+ inventory exceptions? needs? review$/);
});
