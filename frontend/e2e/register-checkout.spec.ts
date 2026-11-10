import { test, expect, Page } from '@playwright/test';
import { login } from './utils/auth-helper';
import { saleComplete } from './utils/sale-complete';

const createProduct = async (page: Page, name: string, barcode: string, price: number) => {
  const headers = { Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token')) };
  expect((await page.request.post('/api/products', { headers, data: {
    name, sku: 'REG-' + barcode, barcode, price, cost: price / 2, stockQuantity: 20, trackInventory: true, isTaxable: false,
  } })).status()).toBe(201);
};
/** A USB scanner types the whole code in a few milliseconds and ends with Enter. */
const scan = async (page: Page, code: string) => { await page.keyboard.type(code, { delay: 5 }); await page.keyboard.press('Enter'); };

test('a finished sale stays in the cart with its change, and the next scan starts the next sale', async ({ page }, info) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await login(page, 'owner@example.test');
  const stamp = String(Date.now()).slice(-9);
  const first = '71' + stamp, second = '72' + stamp;
  await createProduct(page, 'Register coffee ' + stamp, first, 4);
  await createProduct(page, 'Register water ' + stamp, second, 2.5);
  await page.goto('/pos');
  const cart = page.locator('[data-sale-cart]').filter({ visible: true });
  const search = page.getByPlaceholder('Search products... (/ or F3)', { exact: true });

  await search.click(); await scan(page, first);
  await expect(cart.getByText('Register coffee ' + stamp)).toBeVisible();
  // The scan says what it added, inside the search box.
  await expect(page.getByRole('status').filter({ hasText: 'Added Register coffee ' + stamp + ' · $4.00' })).toBeVisible();

  await page.keyboard.press('F1');
  const payment = page.getByRole('dialog', { name: 'Payment', exact: true });
  await payment.getByRole('spinbutton', { name: 'Amount Tendered' }).fill('10');
  await expect(payment.getByRole('button', { name: 'Charge $10.00', exact: true })).toBeEnabled();
  const saved = page.waitForResponse(response => response.url().endsWith('/api/sales') && response.request().method() === 'POST');
  await page.keyboard.press('Enter');
  expect((await saved).status()).toBe(201);

  // Change due is the biggest thing on screen, and nothing has to be closed.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(saleComplete(page)).toContainText('Change due');
  await expect(saleComplete(page)).toContainText('$6.00');
  await expect(saleComplete(page)).toContainText('Paid $10.00 cash · Total $4.00');
  await page.screenshot({ path: info.outputPath('sale-complete.png'), animations: 'disabled' });

  // The receipt opens on request; the next customer's first scan closes it, counts,
  // and replaces the finished sale.
  await saleComplete(page).getByRole('button', { name: 'View receipt', exact: true }).click();
  const receipt = page.getByRole('dialog', { name: 'Receipt', exact: true });
  await receipt.getByText('TOTAL', { exact: true }).click();
  await scan(page, second);
  await expect(receipt).toHaveCount(0);
  await expect(cart.getByText('Register water ' + stamp)).toBeVisible();
  await expect(saleComplete(page)).toHaveCount(0);
});

test('an unknown barcode is explained under the search box with what to do next', async ({ page }) => {
  await login(page, 'owner@example.test');
  await page.goto('/pos');
  const unknown = '79' + String(Date.now()).slice(-10);
  await page.getByPlaceholder('Search products... (/ or F3)', { exact: true }).click();
  await scan(page, unknown);
  const problem = page.getByRole('alert').filter({ hasText: 'No product has barcode ' + unknown + '.' });
  await expect(problem).toBeVisible();
  await problem.getByRole('button', { name: 'Sell as misc item', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Add Misc Item', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.waitForTimeout(1600);
  await page.getByPlaceholder('Search products... (/ or F3)', { exact: true }).click();
  await scan(page, unknown);
  await page.getByRole('alert').filter({ hasText: unknown }).getByRole('button', { name: 'Add product', exact: true }).click();
  await expect(page).toHaveURL(/\/inventory$/);
  const form = page.getByRole('dialog').filter({ has: page.getByLabel('Barcode', { exact: true }) });
  await expect(form.getByLabel('Barcode', { exact: true })).toHaveValue(unknown);
});

test('a catalog without photos uses compact text tiles', async ({ page }, info) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await login(page, 'owner@example.test');
  await page.goto('/pos');
  const tiles = page.locator('.pos-product-grid .pos-product-tile');
  await expect(tiles.first()).toBeVisible();
  const withPhotos = await tiles.locator('img').count();
  test.skip(withPhotos * 2 >= await tiles.count(), 'This store shows mostly photographed products');
  await expect(page.locator('.pos-product-grid.is-text')).toHaveCount(1);
  await expect(page.locator('.pos-product-placeholder')).toHaveCount(0);
  const height = (await tiles.first().boundingBox())!.height;
  expect(height).toBeLessThan(110);
  await page.screenshot({ path: info.outputPath('text-tiles.png'), animations: 'disabled' });
});
