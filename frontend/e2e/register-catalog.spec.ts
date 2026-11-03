import { test, expect } from '@playwright/test';
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
  await expect(page.getByRole('button', { name: /Fixture Loyalty.*in stock/ })).toBeVisible();
  release(); await done;
  await expect(page.getByRole('button', { name: /Fixture Coffee.*in stock/ })).toHaveCount(0);
  fail = true; await search.fill('Refund');
  await expect(page.getByRole('alert')).toContainText('Catalog temporarily unavailable');
  await expect(page.getByText('No products found', { exact: true })).toHaveCount(0);
  fail = false; await page.getByRole('button', { name: 'Retry products' }).click();
  await expect(page.getByRole('button', { name: /Fixture Refund.*left|Fixture Refund.*in stock/ })).toBeVisible();
});

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
  await expect(page.getByRole('button', { name: /Fixture Void.*in stock/ })).toBeVisible();
  release(); await done; await page.unroute('**/api/products?*');
  await context.setOffline(true);
  await page.getByPlaceholder('Search products... (/ or F3)').fill('Coffee');
  await expect(page.getByRole('alert')).toContainText('No offline catalog is available for this cashier and store');
  await expect(page.getByRole('button', { name: /Fixture Coffee.*in stock/ })).toHaveCount(0);
  await context.setOffline(false);
});
