import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';

test('fractional unit prices use the same rounded line and tax in cart, quote, payment and receipt', async ({ page }) => {
  await login(page, 'owner@example.test');
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const headers = { Authorization: 'Bearer ' + token };
  const created = await page.request.post('/api/products', { headers, data: { name: 'Precision Unit', sku: 'PRECISION-UNIT', price: 1.005, cost: 0.1234, stockQuantity: 10, isTaxable: true } });
  expect(created.status()).toBe(201);
  await page.goto('/pos');
  await page.getByRole('button', { name: /^Precision Unit/ }).click();
  await page.getByRole('button', { name: 'Change quantity for Precision Unit', exact: true }).click();
  const pad = page.getByRole('dialog', { name: 'Quantity for Precision Unit' });
  await pad.getByRole('button', { name: '3', exact: true }).click();
  await pad.getByRole('button', { name: 'OK', exact: true }).click();
  await page.getByRole('button', { name: 'Charge $3.32', exact: true }).click();
  const payment = page.getByRole('dialog', { name: 'Payment', exact: true });
  await payment.getByRole('button', { name: 'Exact', exact: true }).click();
  const saved = page.waitForResponse(r => r.url().endsWith('/api/sales') && r.request().method() === 'POST');
  await payment.getByRole('button', { name: 'Charge $3.32', exact: true }).click();
  const response = await saved; expect(response.status()).toBe(201);
  expect((await response.json()).data).toMatchObject({ subtotal: 3.02, tax: 0.3, total: 3.32, changeDue: 0 });
  const receipt = page.getByRole('dialog', { name: 'Receipt', exact: true });
  await expect(receipt).toContainText('$3.32');
  const item = receipt.getByText('Precision Unit', { exact: true }).locator('..');
  await expect(item).toContainText('3 x $1.005');
  await expect(item).toContainText('$3.02');
  await receipt.screenshot({ path: 'test-results/decimal-receipt.png', animations: 'disabled' });
});
