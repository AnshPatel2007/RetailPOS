import { test, expect, Page } from '@playwright/test';
import { login } from './utils/auth-helper';
import { chooseOption, selectField } from './utils/select-helper';

const auth = async (page: Page) => ({ Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token')) });
const createProduct = async (page: Page, data: Record<string, unknown>) => {
  const res = await page.request.post('/api/products', { headers: await auth(page), data: { isTaxable: false, trackInventory: true, stockQuantity: 0, ...data } });
  expect(res.status()).toBe(201);
  return (await res.json()).data as { id: string; stockQuantity: number };
};
const getProduct = async (page: Page, id: string) => (await (await page.request.get('/api/products/' + id, { headers: await auth(page) })).json()).data;

test('a carton is added from the Packs tab and its cost sets the single cost', async ({ page }) => {
  await login(page, 'owner@example.test');
  const stamp = Date.now();
  const single = await createProduct(page, { name: `Red Single ${stamp}`, sku: `RED-${stamp}`, barcode: `30${stamp}`, price: 12.5, cost: 9, stockQuantity: 20 });

  await page.goto('/inventory?view=packs');
  await page.getByRole('button', { name: 'Add pack', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add pack', exact: true });
  await dialog.getByRole('button', { name: /^Pack of one item/ }).click();
  await dialog.getByLabel('Search products to add', { exact: true }).fill(`Red Single ${stamp}`);
  await dialog.getByRole('button', { name: new RegExp(`^Red Single ${stamp}`) }).click();
  await dialog.getByLabel(/s in the pack$/).fill('10');
  await expect(dialog.getByLabel('Pack cost', { exact: true })).toHaveValue('90.00');
  await dialog.getByLabel('Pack name', { exact: true }).fill('Carton');
  await dialog.getByLabel('Pack barcode', { exact: true }).fill(`31${stamp}`);
  await dialog.getByLabel('Pack price', { exact: true }).fill('119.99');
  await dialog.getByLabel('Pack cost', { exact: true }).fill('100');
  await expect(dialog).toContainText('$100.00 ÷ 10 = $10.00 per single');
  await dialog.getByRole('button', { name: 'Add pack', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const row = page.getByRole('row').filter({ hasText: `10 × Red Single ${stamp}` });
  await expect(row).toContainText('Carton');
  await expect(row).toContainText('$100.00');
  await expect(row).toContainText('2 available');
  expect(Number((await getProduct(page, single.id)).cost)).toBe(10);

  // Single items stay on their own tab; variety packs and packs are not listed there.
  await page.getByRole('button', { name: 'Single items', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: `Red Single ${stamp}` })).toBeVisible();
});

test('a carton sold as its own product is merged into the pack of its single', async ({ page }) => {
  await login(page, 'owner@example.test');
  const stamp = Date.now();
  const single = await createProduct(page, { name: `Blue Single ${stamp}`, sku: `BLUE-${stamp}`, barcode: `40${stamp}`, price: 12.5, cost: 10, stockQuantity: 5 });
  const carton = await createProduct(page, { name: `Blue Carton ${stamp}`, sku: `BLUEC-${stamp}`, barcode: `41${stamp}`, price: 119.99, cost: 100, stockQuantity: 3 });

  await page.goto('/inventory?view=packs');
  await page.getByRole('button', { name: 'Add pack', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add pack', exact: true });
  await dialog.getByRole('button', { name: /^Pack of one item/ }).click();
  await dialog.getByLabel('Search products to add', { exact: true }).fill(`Blue Single ${stamp}`);
  await dialog.getByRole('button', { name: new RegExp(`^Blue Single ${stamp}`) }).click();
  await dialog.getByLabel(/s in the pack$/).fill('10');
  await dialog.getByLabel('Pack name', { exact: true }).fill('Carton');
  await dialog.getByLabel('Pack barcode', { exact: true }).fill(`41${stamp}`);
  await dialog.getByLabel('Pack price', { exact: true }).fill('119.99');
  await dialog.getByRole('button', { name: 'Add pack', exact: true }).click();

  await expect(dialog).toContainText(`Blue Carton ${stamp} already exists as its own product (3 in stock)`);
  await expect(dialog).toContainText('become 30');
  await dialog.getByRole('button', { name: 'Merge into this pack', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  expect((await getProduct(page, single.id)).stockQuantity).toBe(35);
  expect(await getProduct(page, carton.id)).toMatchObject({ isActive: false, barcode: null });
  const row = page.getByRole('row').filter({ hasText: `10 × Blue Single ${stamp}` });
  await expect(row).toContainText('3 unopened');
});

test("a variety pack's cost splits by count: $24 for 12 red, 6 blue, 6 orange", async ({ page }) => {
  await login(page, 'owner@example.test');
  const stamp = Date.now();
  const [red, blue, orange] = await Promise.all([['Red', 1.8], ['Blue', 0.5], ['Orange', 1.1]].map(([flavor, cost]) =>
    createProduct(page, { name: `Gatorade ${flavor} ${stamp}`, sku: `G${flavor}-${stamp}`, price: 2.49, cost })));
  const pack = await createProduct(page, { name: `Gatorade Variety ${stamp}`, sku: `GV-${stamp}`, price: 34.99, cost: 24 });
  expect((await page.request.put(`/api/products/${pack.id}/bundle`, { headers: await auth(page), data: { components: [
    { productId: red.id, quantity: 12 }, { productId: blue.id, quantity: 6 }, { productId: orange.id, quantity: 6 }] } })).status()).toBe(200);

  await page.goto('/inventory?view=packs');
  const row = page.getByRole('row').filter({ hasText: `Gatorade Variety ${stamp}` });
  await expect(row).toContainText('24 items: 12 Gatorade Red');
  await row.getByRole('button', { name: `Edit Gatorade Variety ${stamp}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit variety pack', exact: true });
  await expect(dialog).toContainText('Pack cost $24.00 ÷ 24 items = $1.00 each');
  for (const line of ['12 × $1.00 = $12.00', '6 × $1.00 = $6.00']) await expect(dialog.getByText(line).first()).toBeVisible();
});

test('receiving one carton at $100 at the stock screen makes each single cost $10', async ({ page }) => {
  await login(page, 'owner@example.test');
  const stamp = Date.now();
  const single = await createProduct(page, { name: `Gold Single ${stamp}`, sku: `GOLD-${stamp}`, price: 12.5, cost: 9, stockQuantity: 0 });
  expect((await page.request.post(`/api/products/${single.id}/selling-units`, { headers: await auth(page), data: {
    name: 'Carton', barcode: `60${stamp}`, unitsPerPackage: 10, price: 119.99 } })).status()).toBe(201);

  await page.goto('/inventory');
  await page.getByRole('searchbox', { name: 'Search products' }).fill(`Gold Single ${stamp}`);
  await page.getByRole('button', { name: `More actions for Gold Single ${stamp}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Adjust Stock', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Adjust Stock', exact: true });
  await chooseOption(selectField(dialog, 'Reason'), 'Received Shipment');
  await chooseOption(selectField(dialog, 'Arrived as'), 'Carton (10 each)');
  await dialog.getByPlaceholder('Amount to adjust').fill('1');
  await dialog.getByLabel('Cost per Carton', { exact: true }).fill('100');
  await expect(dialog).toContainText('$100.00 ÷ 10 = $10.00 per single');
  await dialog.getByRole('button', { name: 'Receive', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const after = await getProduct(page, single.id);
  expect(after.stockQuantity).toBe(10);
  expect(Number(after.cost)).toBe(10);
});

test('the single-item form shows essentials first and its packs one click away', async ({ page }) => {
  await login(page, 'owner@example.test');
  const stamp = Date.now();
  const single = await createProduct(page, { name: `Form Single ${stamp}`, sku: `FORM-${stamp}`, price: 3, cost: 1.5, stockQuantity: 24 });
  expect((await page.request.post(`/api/products/${single.id}/selling-units`, { headers: await auth(page), data: {
    name: 'Case', barcode: `50${stamp}`, unitsPerPackage: 24, price: 59.99 } })).status()).toBe(201);

  await page.goto('/inventory');
  await page.getByRole('searchbox', { name: 'Search products' }).fill(`Form Single ${stamp}`);
  await page.getByRole('button', { name: `Edit Form Single ${stamp}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit Product', exact: true });
  await expect(dialog.getByLabel('Cost Price', { exact: true })).toBeVisible();
  await expect(dialog).toContainText('$36.00 per Case');
  await expect(dialog.locator('summary', { hasText: 'Packs of this item' })).toContainText('Case (24)');
  await dialog.locator('summary', { hasText: 'Packs of this item' }).click();
  await dialog.getByRole('button', { name: 'Edit pack', exact: true }).click();
  const packDialog = page.getByRole('dialog', { name: 'Edit pack', exact: true });
  await expect(packDialog.getByLabel('Pack cost', { exact: true })).toHaveValue('36.00');
  // Saving a pack never saves (or closes) the product form behind it.
  let productSaves = 0;
  page.on('request', request => { if (request.method() === 'PUT' && /\/api\/products\/[^/]+$/.test(new URL(request.url()).pathname)) productSaves += 1; });
  await packDialog.getByLabel('Pack price', { exact: true }).fill('54.99');
  await packDialog.getByRole('button', { name: 'Save pack', exact: true }).click();
  await expect(packDialog).toHaveCount(0);
  await expect(dialog).toBeVisible();
  expect(productSaves).toBe(0);
});
