import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';

test('failed inventory reads show unavailable values and recover without an empty-success state', async ({ page }) => {
  await page.clock.install();
  await login(page, 'owner@example.test'); let unavailable = true;
  for (const pattern of ['**/api/products?*', '**/api/products/stats*']) await page.route(pattern, route => unavailable
    ? route.fulfill({ status: 503, json: { error: 'Fixture read unavailable' } }) : route.continue());
  await page.goto('/inventory');
  await expect(page.getByRole('alert').filter({ hasText: 'Unable to load products' })).toBeVisible();
  await expect(page.getByText('No products found', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Inventory Value', { exact: true }).locator('..')).toContainText('Unavailable');
  unavailable = false;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.clock.fastForward(5000);
  await expect(page.getByRole('cell').filter({ has: page.getByText('Fixture Coffee', { exact: true }) })).toBeVisible();
  // A successful read still leaves unreviewed opening values unavailable.
  await expect(page.getByText('Inventory Value', { exact: true }).locator('..')).toContainText('Unavailable');
  await expect(page.getByText('Total Products', { exact: true }).locator('..')).not.toContainText('Unavailable');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('an earlier inventory search cannot overwrite the later product result', async ({ page }) => {
  await login(page, 'owner@example.test'); await page.goto('/inventory');
  let release!: () => void, started!: () => void, finished!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { started = resolve; });
  const completed = new Promise<void>(resolve => { finished = resolve; });
  await page.route('**/api/products?*', async route => {
    if (new URL(route.request().url()).searchParams.get('search') !== 'Fixture Coffee') return route.continue();
    const response = await route.fetch(); started(); await held;
    try { await route.fulfill({ response }); } catch { /* The old request is intentionally cancelled. */ } finally { finished(); }
  });
  const search = page.getByPlaceholder('Search by name, SKU, or barcode...');
  await search.fill('Fixture Coffee'); await ready;
  await search.fill('Fixture Empty');
  await expect(page.getByRole('row').filter({ hasText: 'Fixture Empty' })).toHaveCount(1);
  release(); await completed;
  await expect(page.getByRole('row').filter({ hasText: 'Fixture Coffee' })).toHaveCount(0);
  await expect(search).toHaveValue('Fixture Empty');
});

test('failed promotion reads offer retry without presenting an empty successful catalog', async ({ page }) => {
  await login(page, 'owner@example.test'); let unavailable = true;
  await page.route('**/api/promotions?*', route => unavailable ? route.fulfill({ status: 503, json: { error: 'Unavailable' } }) : route.continue());
  await page.goto('/promotions');
  await expect(page.getByRole('alert')).toContainText('Unable to load promotions');
  await expect(page.getByText('No promotions yet', { exact: true })).toHaveCount(0);
  unavailable = false; await page.getByRole('button', { name: 'Retry promotions', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New Promotion', exact: true }).first()).toBeVisible();
});
