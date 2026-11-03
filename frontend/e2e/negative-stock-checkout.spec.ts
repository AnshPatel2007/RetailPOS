import { test, expect, Page } from '@playwright/test';
import { login } from './utils/auth-helper';

const auth = async (page: Page) => ({ Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token')) });

test('a zero-stock item sells without a stock prompt and raises an exception for the manager', async ({ page }) => {
  await login(page, 'owner@example.test');
  const name = `Empty shelf soda ${Date.now()}`;
  const created = await page.request.post('/api/products', { headers: await auth(page), data: {
    name, sku: name.replaceAll(' ', '-'), barcode: String(Date.now()), price: 2.5, cost: 1.5, stockQuantity: 0, isTaxable: false, trackInventory: true,
  } });
  expect(created.status()).toBe(201);
  const product = (await created.json()).data;

  await page.goto('/pos');
  await page.getByPlaceholder('Search products... (/ or F3)', { exact: true }).fill(name);
  const tile = page.getByRole('button', { name: new RegExp('^' + name) });
  await expect(tile).toBeEnabled();
  await expect(tile).not.toContainText(/in stock|\d+ left|out of stock/i);
  await tile.click();
  await expect(page.getByRole('button', { name: 'Change quantity for ' + name, exact: true })).toHaveText('1');
  await page.getByRole('button', { name: 'Charge $2.50', exact: true }).click();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  const payment = page.getByRole('dialog', { name: 'Payment', exact: true });
  await payment.getByRole('button', { name: 'Exact', exact: true }).click();
  const saved = page.waitForResponse(response => response.url().endsWith('/api/sales') && response.request().method() === 'POST');
  await payment.getByRole('button', { name: 'Charge $2.50', exact: true }).click();
  expect((await saved).status()).toBe(201);

  const after = (await (await page.request.get('/api/products/' + product.id, { headers: await auth(page) })).json()).data;
  expect(after.stockQuantity).toBe(-1);

  await page.goto('/inventory/stock-control/exceptions');
  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row).toContainText('-1');
  await expect(row).toContainText('Open');
  await row.click();
  const detail = page.getByRole('dialog', { name: new RegExp('Inventory discrepancy') });
  await expect(detail).toContainText('1 more unit was sold than the system currently accounts for');
  await detail.getByRole('button', { name: 'Record physical count', exact: true }).click();
  const count = page.getByRole('dialog', { name: 'Record physical count', exact: true });
  await count.getByLabel(new RegExp('Units of ' + name)).fill('4');
  await expect(count).toContainText('adjustment of +5');
  await count.getByRole('button', { name: 'Save count and resolve', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: name })).toHaveCount(0);
  const resolved = (await (await page.request.get('/api/products/' + product.id, { headers: await auth(page) })).json()).data;
  expect(resolved.stockQuantity).toBe(4);
});
