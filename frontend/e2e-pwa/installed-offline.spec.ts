import { test, expect, Page } from '@playwright/test';
import { login } from '../e2e/utils/auth-helper';

/** A value from the register's saved settings (IndexedDB), or null. */
const saved = (page: Page, key: string) => page.evaluate(name => new Promise<unknown>(resolve => {
  const open = indexedDB.open('POSOfflineDB');
  open.onerror = () => resolve(null);
  open.onsuccess = () => {
    try {
      const get = open.result.transaction('settings').objectStore('settings').get(name);
      get.onsuccess = () => { resolve(get.result?.value ?? null); open.result.close(); };
      get.onerror = () => { resolve(null); open.result.close(); };
    } catch { resolve(null); open.result.close(); }
  };
}), key);

test('the installed app opens with the network off, keeps the cashier signed in, and sells for cash', async ({ page, context }) => {
  await login(page, 'cashier@example.test');
  await page.goto('/pos');
  await expect(page.getByRole('button', { name: /^Fixture Loyalty/ })).toBeVisible();
  // The register has saved its product list, knows the open drawer, and the app itself is saved for offline use.
  await expect.poll(async () => !!(await saved(page, 'products_cache_scope') as { syncedThrough?: string } | null)?.syncedThrough, { timeout: 15000 }).toBe(true);
  await expect.poll(async () => typeof (await saved(page, 'open_shift') as { shiftId?: string } | null)?.shiftId).toBe('string');
  expect(await page.evaluate(async () => !!(await navigator.serviceWorker.ready).active)).toBe(true);
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ name: 'POS System', display: 'standalone', start_url: '/' });

  // No network at all: nothing can come from the server, not even the page.
  await context.setOffline(true);
  await page.reload();
  await expect(page).toHaveURL(/\/pos$/);
  const tile = page.getByRole('button', { name: /^Fixture Loyalty/ });
  await expect(tile).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('button', { name: 'Register recovery and connection status' })).toContainText('Offline');

  await tile.click();
  await page.getByRole('button', { name: 'Charge $1.10', exact: true }).click();
  const payment = page.getByRole('dialog', { name: 'Payment', exact: true });
  await expect(payment.getByText(/Offline: cached cash total only/)).toBeVisible();
  await payment.getByRole('button', { name: 'Exact', exact: true }).click();
  await payment.getByRole('button', { name: 'Charge $1.10', exact: true }).click();
  await expect(payment).toHaveCount(0);

  // A deep link also opens while offline (any page address serves the saved app).
  await page.goto('/my-shift');
  await expect(page).toHaveURL(/\/my-shift$/);
  await page.goto('/pos');

  // The network returns: the saved sale is sent once and the cashier is still signed in.
  const sent = page.waitForResponse(response => response.url().endsWith('/api/sales') && response.request().method() === 'POST', { timeout: 30000 });
  await context.setOffline(false);
  expect((await sent).status()).toBe(201);
  await expect(page).toHaveURL(/\/pos$/);
  await expect(page.getByRole('button', { name: 'Register recovery and connection status' })).toContainText('Online', { timeout: 20000 });
});
