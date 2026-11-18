import { test, expect, Page } from '@playwright/test';
import { login, logout } from './utils/auth-helper';

test('product search ignores older replies and shows a retry for failed reads', async ({ page }) => {
  await login(page, 'owner@example.test'); await page.goto('/pos');
  const search = page.getByPlaceholder('Search products... (/ or F3)');
  let release!: () => void, captured!: () => void, finished!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const arrived = new Promise<void>(resolve => { captured = resolve; });
  const done = new Promise<void>(resolve => { finished = resolve; });
  let fail = false;
  await page.route('**/api/products?*', async route => {
    const query = new URL(route.request().url()).searchParams.get('search');
    if (query === 'Coffee') {
      try { const response = await route.fetch(); captured(); await held; await route.fulfill({ response }); }
      catch { /* Superseded search is cancelled. */ }
      finally { finished(); }
    } else if (query === 'Refund' && fail) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Catalog temporarily unavailable' }) });
    } else await route.continue();
  });
  await search.fill('Coffee'); await arrived;
  await search.fill('Loyalty');
  await expect(page.getByRole('button', { name: /^Fixture Loyalty/ })).toBeVisible();
  release(); await done;
  await expect(page.getByRole('button', { name: /^Fixture Coffee/ })).toHaveCount(0);
  fail = true; await search.fill('Refund');
  await expect(page.getByRole('alert')).toContainText('Catalog temporarily unavailable');
  await expect(page.getByText('No products found', { exact: true })).toHaveCount(0);
  fail = false; await page.getByRole('button', { name: 'Retry products' }).click();
  await expect(page.getByRole('button', { name: /^Fixture Refund/ })).toBeVisible();
});

/** The register's saved catalog (IndexedDB): which store it belongs to and the product names in it. */
const savedCatalog = (page: Page) => page.evaluate(() => new Promise<{ locationId: string | null; names: string[] }>(resolve => {
  const open = indexedDB.open('POSOfflineDB');
  open.onerror = () => resolve({ locationId: null, names: [] });
  open.onsuccess = () => {
    try {
      const transaction = open.result.transaction(['settings', 'products']);
      const scope = transaction.objectStore('settings').get('products_cache_scope');
      const products = transaction.objectStore('products').getAll();
      transaction.oncomplete = () => { resolve({ locationId: scope.result?.value?.locationId ?? null, names: (products.result || []).map((product: { name: string }) => product.name) }); open.result.close(); };
      transaction.onerror = () => { resolve({ locationId: null, names: [] }); open.result.close(); };
    } catch { resolve({ locationId: null, names: [] }); open.result.close(); }
  };
}));

test('a delayed cache refresh cannot populate another store after logout', async ({ page, context }) => {
  await login(page, 'owner@example.test'); await page.goto('/pos');
  let release!: () => void, captured!: () => void, finished!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const arrived = new Promise<void>(resolve => { captured = resolve; });
  const done = new Promise<void>(resolve => { finished = resolve; });
  await page.route('**/api/products?*', async route => {
    if (new URL(route.request().url()).searchParams.get('limit') !== '100') { await route.continue(); return; }
    try { const response = await route.fetch(); captured(); await held; await route.fulfill({ response }); }
    catch { /* A request from the former login must be discarded. */ }
    finally { finished(); }
  });
  await page.getByRole('button', { name: 'Register recovery and connection status' }).click();
  await arrived;
  await logout(page); await login(page, 'voids@example.test'); await page.goto('/pos');
  await expect(page.getByRole('button', { name: /^Fixture Void/ })).toBeVisible();
  const store = await page.evaluate(() => JSON.parse(localStorage.getItem('user')!).locationId as string);
  release(); await done; await page.unroute('**/api/products?*');
  // The register saves the new store's own product list right after sign-in; the
  // former login's late reply (another store's products) is discarded.
  await expect.poll(async () => (await savedCatalog(page)).locationId, { timeout: 15000 }).toBe(store);
  const catalog = await savedCatalog(page);
  expect(catalog.names).toContain('Fixture Void');
  expect(catalog.names).not.toContain('Fixture Coffee');
  await context.setOffline(true);
  const search = page.getByPlaceholder('Search products... (/ or F3)');
  await search.fill('Coffee');
  await expect(page.getByRole('button', { name: /^Fixture Coffee/ })).toHaveCount(0);
  // Offline, this store's own products are still found.
  await search.fill('Void');
  await expect(page.getByRole('button', { name: /^Fixture Void/ })).toBeVisible();
  await context.setOffline(false);
});
