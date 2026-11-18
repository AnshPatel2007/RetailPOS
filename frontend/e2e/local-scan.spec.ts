import { test, expect, Page } from '@playwright/test';
import { login } from './utils/auth-helper';

/** Whether the register's saved catalog (IndexedDB) has a product with this barcode. */
const cached = (page: Page, barcode: string) => page.evaluate(code => new Promise<boolean>(resolve => {
  const open = indexedDB.open('POSOfflineDB');
  open.onerror = () => resolve(false);
  open.onsuccess = () => {
    try {
      const get = open.result.transaction('products').objectStore('products').index('barcode').get(code);
      get.onsuccess = () => { resolve(!!get.result); open.result.close(); };
      get.onerror = () => { resolve(false); open.result.close(); };
    } catch { resolve(false); open.result.close(); }
  };
}), barcode);

test('scans are answered from the register\'s saved catalog: no lookup request, and offline too', async ({ page }) => {
  await login(page, 'owner@example.test');
  const headers = { Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token')) };
  const barcode = '71' + String(Date.now()).slice(-10);
  const name = 'Local scan ' + barcode;
  expect((await page.request.post('/api/products', { headers, data: {
    name, sku: 'LOCAL-' + barcode, barcode, price: 3, cost: 1, stockQuantity: 20, trackInventory: true, isTaxable: false,
  } })).status()).toBe(201);

  // Opening the register brings its saved catalog up to date (only what changed).
  await page.goto('/pos');
  await expect(page.getByRole('button', { name: new RegExp('^' + name) })).toBeVisible();
  await expect.poll(() => cached(page, barcode), { timeout: 15000 }).toBe(true);

  // Every product request now fails, so only the saved catalog can answer a scan.
  // The routine background catalog sync may still try; a lookup for the scanned code must not.
  const productRequests: string[] = [];
  const lookups = () => productRequests.filter(url => url.includes('resolve-barcode') || url.includes(barcode) || url.includes('7199999999999'));
  await page.route('**/api/products**', route => { productRequests.push(route.request().url()); return route.abort(); });
  const search = page.getByPlaceholder('Search products... (/ or F3)', { exact: true });
  const cart = page.locator('[data-sale-cart]').filter({ visible: true });
  await search.click();
  // The EAN-13 form of the same UPC-A code finds it too.
  await page.keyboard.type('0' + barcode, { delay: 5 }); await page.keyboard.press('Enter');
  await expect(cart.getByText(name)).toBeVisible();
  await expect(search).toHaveValue('');
  expect(lookups()).toEqual([]);

  // With the network gone, a scan still adds the item.
  await page.context().setOffline(true);
  await search.click();
  await page.keyboard.type(barcode, { delay: 5 }); await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Change quantity for ' + name, exact: true })).toHaveText('2');

  // An unknown code offline says so and offers the misc key instead of hanging.
  await search.click();
  await page.keyboard.type('7199999999999', { delay: 5 }); await page.keyboard.press('Enter');
  await expect(page.getByText('No product has barcode 7199999999999.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sell as misc item', exact: true })).toBeVisible();
  expect(lookups()).toEqual([]);
  await page.context().setOffline(false);
});

test('a product added a moment ago, not yet in the saved catalog, is found by one exact barcode lookup', async ({ page }) => {
  await login(page, 'owner@example.test');
  const headers = { Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token')) };
  await page.goto('/pos');
  const search = page.getByPlaceholder('Search products... (/ or F3)', { exact: true });
  await expect(search).toBeVisible();
  // Hold back the background sync so the register's copy cannot learn about the new product.
  await page.route(/\/api\/products\?.*updatedSince/, route => route.abort());
  const barcode = '72' + String(Date.now()).slice(-10);
  expect((await page.request.post('/api/products', { headers, data: {
    name: 'Just added ' + barcode, sku: 'JUST-' + barcode, barcode, price: 5, cost: 2, stockQuantity: 3, trackInventory: true, isTaxable: false,
  } })).status()).toBe(201);
  const resolved = page.waitForResponse(response => response.url().includes('/api/products/resolve-barcode'));
  await search.click();
  await page.keyboard.type(barcode, { delay: 5 }); await page.keyboard.press('Enter');
  expect((await resolved).status()).toBe(200);
  const cart = page.locator('[data-sale-cart]').filter({ visible: true });
  await expect(cart.getByText('Just added ' + barcode)).toBeVisible();
  // The server's answer is kept, so the same code is local from now on.
  await expect.poll(() => cached(page, barcode)).toBe(true);
});
