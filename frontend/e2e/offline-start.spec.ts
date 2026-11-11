import { test, expect, Page } from '@playwright/test';
import { login } from './utils/auth-helper';

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

/** The POS server stops answering while the browser still reports "online" (the store's internet is down, its router is not). */
const serverDown = (page: Page) => page.route('**/api/**', route => route.abort());

async function openRegister(page: Page) {
  await login(page, 'cashier@example.test');
  await page.goto('/pos');
  const tile = page.getByRole('button', { name: /^Fixture Loyalty/ });
  await expect(tile).toBeVisible();
  // The register has saved its product list and knows this cashier's open drawer.
  await expect.poll(async () => !!(await saved(page, 'products_cache_scope') as { syncedThrough?: string } | null)?.syncedThrough, { timeout: 15000 }).toBe(true);
  await expect.poll(async () => typeof (await saved(page, 'open_shift') as { shiftId?: string } | null)?.shiftId).toBe('string');
  return tile;
}

async function sellOneForCash(page: Page, tile: ReturnType<Page['getByRole']>) {
  await tile.click();
  await page.getByRole('button', { name: 'Charge $1.10', exact: true }).click();
  const payment = page.getByRole('dialog', { name: 'Payment', exact: true });
  await expect(payment.getByText(/Offline: cached cash total only/)).toBeVisible();
  await payment.getByRole('button', { name: 'Exact', exact: true }).click();
  await payment.getByRole('button', { name: 'Charge $1.10', exact: true }).click();
  await expect(payment).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Register recovery and connection status' })).toContainText('Offline');
}

test('when the server stops answering but the browser still says online, the register sells for cash and sends the sale later', async ({ page }) => {
  const tile = await openRegister(page);
  await serverDown(page);
  expect(await page.evaluate(() => navigator.onLine)).toBe(true);
  await sellOneForCash(page, tile);

  // The server comes back: the register notices by itself and sends the saved sale once.
  const sent = page.waitForResponse(response => response.url().endsWith('/api/sales') && response.request().method() === 'POST', { timeout: 20000 });
  await page.unroute('**/api/**');
  expect((await sent).status()).toBe(201);
  const status = page.getByRole('button', { name: 'Register recovery and connection status' });
  await expect(status).toContainText('Online', { timeout: 15000 });
  await expect(status).not.toContainText('pending');
});

test('a register restarted while the server is unreachable keeps its cashier, drawer and product list', async ({ page }) => {
  await openRegister(page);
  await serverDown(page);
  await page.reload();

  // Not sent to the sign-in screen: the cashier who was signed in carries on.
  await expect(page).toHaveURL(/\/pos$/);
  const tile = page.getByRole('button', { name: /^Fixture Loyalty/ });
  await expect(tile).toBeVisible({ timeout: 15000 });
  await sellOneForCash(page, tile);

  // Back online: the session is checked with the server, the sale is sent, and the cashier stays signed in.
  const checked = page.waitForResponse(response => response.url().endsWith('/api/auth/me'), { timeout: 20000 });
  const sent = page.waitForResponse(response => response.url().endsWith('/api/sales') && response.request().method() === 'POST', { timeout: 20000 });
  await page.unroute('**/api/**');
  expect((await checked).status()).toBe(200);
  expect((await sent).status()).toBe(201);
  await expect(page).toHaveURL(/\/pos$/);
  await expect(page.getByRole('button', { name: 'Register recovery and connection status' })).toContainText('Online', { timeout: 15000 });
});
