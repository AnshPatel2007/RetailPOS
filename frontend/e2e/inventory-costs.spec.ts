import { test, expect } from '@playwright/test';
import { login, TEST_USER } from './utils/auth-helper';

test('owner reviews opening inventory, previews audited corrections and recovers a lost confirmation', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await login(page, TEST_USER.email);
  const name = 'Cost review ' + Date.now();
  const created = await page.evaluate(async productName => {
    const response = await fetch('/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('token') },
      body: JSON.stringify({ name: productName, sku: productName.replace(/ /g, '-'), price: 15, cost: 8, stockQuantity: 10, trackInventory: true, isTaxable: false }) });
    return { status: response.status, body: await response.json() };
  }, name);
  expect(created.status).toBe(201);
  await page.goto('/financial?tab=inventory');
  await page.getByLabel('Search inventory costs').fill(name);
  const product = page.getByRole('row').filter({ hasText: name });
  await expect(product.getByText('Unavailable', { exact: true })).toHaveCount(2);
  await product.getByRole('button', { name: 'Review opening', exact: true }).click();
  const opening = page.getByRole('dialog', { name: 'Confirm opening inventory', exact: true });
  await expect(opening.getByLabel('Total inventory value at cost')).toHaveValue('80');
  await opening.getByLabel('Opening inventory evidence').fill('Count sheet and invoice verified by owner');
  await page.screenshot({ path: 'test-results/inventory-opening-desktop.png', fullPage: true, animations: 'disabled' });
  await page.route('**/api/financial/inventory-costs/opening', async route => {
    const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed');
  }, { times: 1 });
  await opening.getByRole('button', { name: 'Confirm opening value', exact: true }).click();
  await expect(opening.getByRole('button', { name: 'Retry saved operation', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Retry saved operation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry saved operation', exact: true })).toHaveCount(0);
  await page.getByLabel('Search inventory costs').fill(name);
  await expect(product.getByText('$80.00', { exact: true })).toBeVisible();
  await expect(product.getByText('Confirmed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Value ledger', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle theme', exact: true }).click();
  const openingEntry = page.getByRole('row').filter({ hasText: name }).filter({ hasText: 'Opening' });
  await openingEntry.getByRole('button', { name: 'Review cost', exact: true }).click();
  const correction = page.getByRole('dialog', { name: 'Review cost correction', exact: true });
  await correction.getByLabel('Corrected total cost').fill('90');
  await correction.getByLabel('Reason / supporting document').fill('Corrected original supplier invoice');
  await correction.getByRole('button', { name: 'Preview correction', exact: true }).click();
  await expect(correction.getByText('$90.00', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/inventory-correction-dark.png', fullPage: true, animations: 'disabled' });
  await correction.getByRole('button', { name: 'Confirm correction', exact: true }).click();
  await expect(correction).toHaveCount(0);
  await page.getByRole('button', { name: 'Valuation as of', exact: true }).click();
  await expect(product.getByText('$90.00', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText('Inventory costs updated', { exact: true })).toHaveCount(0, { timeout: 10000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/inventory-valuation-mobile.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Reconciliation', exact: true }).click();
  await expect(page.getByText('Closing inventory', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('manager can inspect costs but cannot confirm owner opening values', async ({ page }) => {
  await login(page, 'manager@example.test');
  await page.goto('/financial?tab=inventory');
  await expect(page.getByRole('button', { name: 'Balances & opening', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review opening', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review opening inventory', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Missing costs', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review cost', exact: true })).toHaveCount(0);
});

test('owner confirms an editable opening group across pages with explicit zero costs and one recovery key', async ({ page }) => {
  await login(page, TEST_USER.email);
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const headers = { Authorization: 'Bearer ' + token };
  const prefix = 'Bulk review ' + Date.now(), products: { id: string; name: string }[] = [];
  for (let index = 0; index < 28; index++) {
    const name = `${prefix} ${String(index).padStart(2, '0')}`;
    const response = await page.request.post('/api/products', { headers, data: { name, sku: name.replace(/ /g, '-'),
      price: 15, cost: index < 2 ? 0 : 8, stockQuantity: 10, trackInventory: true, isTaxable: false } });
    expect(response.status()).toBe(201); products.push((await response.json()).data);
  }
  await page.goto('/financial?tab=inventory');
  await page.getByLabel('Search inventory costs').fill(prefix);
  await page.getByRole('button', { name: 'Review opening inventory', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review opening inventory', exact: true });
  await expect(dialog.getByText('28 awaiting opening review')).toBeVisible();
  await dialog.getByLabel('Inventory value for ' + products[2].name, { exact: true }).fill('99');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await (await page.request.get('/api/financial/inventory-costs/opening-review?search=' + encodeURIComponent(prefix), { headers })).json()).data.total).toBe(28);
  await page.getByRole('button', { name: 'Review opening inventory', exact: true }).click();
  await expect(dialog.getByLabel('Inventory value for ' + products[2].name, { exact: true })).toHaveValue('80');
  await expect(dialog.getByLabel('Inventory value for ' + products[0].name, { exact: true })).toHaveValue('');
  await dialog.getByLabel('Opening inventory evidence', { exact: true }).fill('Owner-verified count sheet and invoice; first product was free');
  const attestation = dialog.getByLabel('I verified the selected quantities and values against the supporting records.', { exact: true });
  await attestation.check();
  await expect(dialog.getByRole('button', { name: 'Confirm 28 products', exact: true })).toBeDisabled();
  await dialog.getByLabel('Inventory value for ' + products[0].name, { exact: true }).fill('0');
  await dialog.getByLabel('Include ' + products[1].name, { exact: true }).uncheck();
  await dialog.getByLabel('Quantity for ' + products[2].name, { exact: true }).fill('8');
  await dialog.getByLabel('Inventory value for ' + products[2].name, { exact: true }).fill('64');
  await dialog.getByRole('button', { name: 'Next products', exact: true }).click();
  await dialog.getByLabel('Inventory value for ' + products[27].name, { exact: true }).fill('90');
  await expect(attestation).not.toBeChecked();
  await attestation.check();
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({ path: 'test-results/inventory-opening-bulk-desktop.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/inventory-opening-bulk-phone.png', fullPage: true, animations: 'disabled' });
  await page.route('**/api/financial/inventory-costs/opening', async route => {
    const request = route.request().postDataJSON();
    expect(request.items).toHaveLength(27);
    expect(request.items.find((item: { productId: string }) => item.productId === products[2].id)).toMatchObject({ quantity: 8, value: 64 });
    const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed');
  }, { times: 1 });
  await dialog.getByRole('button', { name: 'Confirm 27 products', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Retry saved operation', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Retry saved operation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry saved operation', exact: true })).toHaveCount(0);
  const balances = (await (await page.request.get('/api/financial/inventory-costs/balances?search=' + encodeURIComponent(prefix), { headers })).json()).data.products;
  expect(balances.filter((item: { openingConfirmed: boolean }) => item.openingConfirmed)).toHaveLength(27);
  expect(balances.find((item: { id: string }) => item.id === products[0].id)).toMatchObject({ value: 0, averageCost: 0 });
  expect(balances.find((item: { id: string }) => item.id === products[1].id)).toMatchObject({ value: null, openingConfirmed: false });
  expect(balances.find((item: { id: string }) => item.id === products[2].id)).toMatchObject({ quantity: 8, value: 64 });
  expect(balances.find((item: { id: string }) => item.id === products[27].id)).toMatchObject({ value: 90 });
});
