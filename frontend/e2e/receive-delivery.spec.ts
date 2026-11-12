import { test, expect, Page } from '@playwright/test';
import { login } from './utils/auth-helper';

const auth = async (page: Page) => ({ Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token')) });

// receive@example.test owns a store no other spec uses. Laid out for a phone first, so it runs at phone width.
test.use({ viewport: { width: 390, height: 844 } });

test('a delivery scanned on a phone updates stock and cost, after a shelf count of the low item', async ({ page }) => {
  await login(page, 'receive@example.test');
  const headers = await auth(page), stamp = Date.now();
  const call = async (method: 'get' | 'post' | 'put', path: string, data?: object) => {
    const response = await page.request[method]('/api' + path, { headers, ...(data ? { data } : {}) });
    expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
    return (await response.json()).data;
  };
  const supplierName = `Fizz Distributing ${stamp}`;
  const supplier = await call('post', '/suppliers', { name: supplierName });
  const item = (name: string, barcode: string, cost: number, price: number) => call('post', '/products', { name: `${name} ${stamp}`,
    sku: `${name.toUpperCase().replaceAll(' ', '-')}-${stamp}`, barcode, price, cost, stockQuantity: 0, lowStockAlert: 5, isTaxable: false, trackInventory: true });
  const cola = await item('Cola Can', `${stamp}1`, 0.6, 1.5);
  const lemon = await item('Lemon Can', `${stamp}2`, 0.5, 1.25);
  await call('post', '/financial/inventory-costs/opening', { idempotencyKey: crypto.randomUUID(), notes: 'Counted on the shelf with the supplier invoice',
    items: [{ productId: cola.id, quantity: 3, value: 1.8, expectedVersion: cola.stockVersion }, { productId: lemon.id, quantity: 40, value: 20, expectedVersion: lemon.stockVersion }] });
  const colaPack = `${stamp}3`, lemonCase = `${stamp}4`;
  await call('post', `/products/${cola.id}/selling-units`, { name: '12-pack', barcode: colaPack, unitsPerPackage: 12, price: 12 });
  // The supplier now charges $14.40 for a case of 24: $0.60 each, up from $0.50.
  await call('post', `/suppliers/${supplier.id}/products`, { productId: lemon.id, packSize: 24, packCost: 14.4, packBarcode: lemonCase });
  // The store aims for a 60% margin, so a cost rise suggests a new price.
  await call('put', '/pricing/rules', { scope: 'STORE', targetMargin: 0.6, rounding: 'CENT' });

  await page.goto('/inventory/purchasing/receive');
  await expect(page.getByRole('link', { name: 'Receive Delivery' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Nothing scanned yet')).toBeVisible();
  const barcode = page.getByLabel('Barcode', { exact: true });
  await expect(barcode).toBeDisabled(); // the supplier comes first
  await page.getByLabel('Supplier', { exact: true }).fill(supplierName);
  await page.getByRole('button', { name: supplierName }).click();
  await expect(page.getByRole('status').filter({ hasText: `Selected supplier: ${supplierName}` })).toBeVisible();

  // A store pack scans in as one sealed 12-pack; one more makes two.
  await barcode.fill(colaPack); await barcode.press('Enter');
  const colaLine = page.getByRole('listitem', { name: `Cola Can ${stamp} (12-pack)` });
  await expect(colaLine.getByLabel('12-pack (of 12)', { exact: true })).toHaveValue('1');
  await colaLine.getByRole('button', { name: 'One more: 12-pack (of 12)' }).click();
  await expect(colaLine.getByLabel('12-pack (of 12)', { exact: true })).toHaveValue('2');
  await expect(colaLine.getByLabel('Cost per 12-pack', { exact: true })).toHaveValue('7.2');
  await expect(colaLine).toContainText('24 units');
  // Only 3 on record and it runs low at 5: the cheap moment to count the shelf.
  const shelf = colaLine.getByLabel('On the shelf right now, before this delivery (optional)', { exact: true });
  await expect(colaLine).toContainText('The record shows 3; it runs low at 5.');
  await shelf.fill('2');

  // The list survives a reload on the phone.
  await page.reload();
  await expect(colaLine.getByLabel('12-pack (of 12)', { exact: true })).toHaveValue('2');
  await expect(shelf).toHaveValue('2');

  // This supplier's case barcode adds a case of 24 with its case cost.
  await barcode.fill(lemonCase); await barcode.press('Enter');
  const lemonLine = page.getByRole('listitem', { name: `Lemon Can ${stamp}` });
  await expect(lemonLine.getByLabel('Cases (of 24)', { exact: true })).toHaveValue('1');
  await expect(lemonLine.getByLabel('Cost per case', { exact: true })).toHaveValue('14.4');
  await expect(lemonLine).toContainText('$0.60 each');
  await expect(lemonLine).toContainText('Was $0.50 each; the cost went up.');
  await expect(lemonLine.getByLabel('On the shelf right now, before this delivery (optional)', { exact: true })).toHaveCount(0); // 40 on hand is not low
  await lemonLine.getByLabel('Cases (of 24)', { exact: true }).fill('2');
  await expect(page.getByText('2 items · 72 units')).toBeVisible();

  // An unknown code offers a new item; cancelling leaves the list alone.
  await barcode.fill(`${stamp}9`); await barcode.press('Enter');
  await expect(page.getByRole('form', { name: 'New item' })).toContainText(`${stamp}9 is not one of your products.`);
  await page.getByRole('form', { name: 'New item' }).getByRole('button', { name: 'Cancel' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/receive-delivery.png', fullPage: true, animations: 'disabled' });
  await lemonLine.screenshot({ path: 'test-results/receive-delivery-line.png', animations: 'disabled' });

  await page.getByRole('button', { name: 'Review delivery' }).click();
  await expect(page.getByRole('heading', { name: 'Check the delivery' })).toBeVisible();
  // The shelf count went in first, so the review starts from the counted 2.
  await expect(page.getByRole('row').filter({ hasText: cola.sku })).toContainText('2 → 26');
  await expect(page.getByRole('row').filter({ hasText: lemon.sku })).toContainText('40 → 88');
  // The cost rise is flagged with the margin it leaves and the price that meets the target.
  const costChanges = page.getByRole('region', { name: 'Cost changes (1 up 3% or more)' });
  await expect(costChanges.getByRole('listitem')).toHaveText([`Lemon Can ${stamp}: $0.50 → $0.60 (+20%), margin 52.0% at $1.25, target 60.0%, suggested $1.50`]);
  await expect(costChanges.getByRole('link', { name: 'Open Price Review' })).toHaveAttribute('href', '/inventory/purchasing/price-review');
  await page.getByRole('button', { name: 'Save delivery' }).click();
  await expect(page.getByText('Delivery saved')).toBeVisible();
  await expect(page.getByText('2 items received (2 existing, 0 new). Stock and costs are updated.')).toBeVisible();

  const colaAfter = await call('get', `/products/${cola.id}/selling-units`);
  expect(colaAfter.stockQuantity).toBe(26);
  expect(colaAfter.cost).toBeCloseTo(0.6, 4);
  expect(colaAfter.sellingUnits.find((unit: { barcode: string }) => unit.barcode === colaPack).sealedQuantity).toBe(2);
  const lemonAfter = await call('get', `/products/${lemon.id}/selling-units`);
  expect(lemonAfter.stockQuantity).toBe(88);
  expect(lemonAfter.cost).toBeCloseTo(0.6, 4);
  // The count is recorded before the delivery, with its own reason.
  const movements = await call('get', `/products/movements?productId=${cola.id}`);
  expect(movements.slice(0, 2).map((row: { type: string; previousQty: number; newQty: number }) => [row.type, row.previousQty, row.newQty]))
    .toEqual([['PURCHASE', 2, 26], ['MANUAL_COUNT', 3, 2]]);

  // Saved: the list is cleared for the next delivery.
  await page.getByRole('button', { name: 'Receive another' }).click();
  await expect(page.getByText('Nothing scanned yet')).toBeVisible();
});
