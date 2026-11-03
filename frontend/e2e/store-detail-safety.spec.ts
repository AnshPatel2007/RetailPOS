import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';

test('store detail failures clear old figures, retry, and ignore a closed store response with keyboard recovery', async ({ page }) => {
  await login(page, 'platform@example.test');
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const stores = (await (await page.request.get('/api/locations', { headers: { Authorization: 'Bearer '+token } })).json()).data;
  const storeA = stores.find((store: { name: string }) => store.name === 'Store A');
  let unavailable = false, delay = false;
  let release!: () => void, started!: () => void, finished!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { started = resolve; });
  const completed = new Promise<void>(resolve => { finished = resolve; });
  await page.route('**/api/locations/*/stats?*', async route => {
    const url = new URL(route.request().url()), first = url.pathname.includes('/'+storeA.id+'/');
    if (unavailable) return route.fulfill({ status: 503, json: { error: 'Fixture period unavailable' } });
    if (delay && first) { started(); await held; }
    try { await route.fulfill({ json: { success: true, data: { periodRevenue: first ? 111.11 : 222.22, periodProfit: null, periodTransactions: 1, periodExpenses: 0 } } }); }
    finally { if (delay && first) finished(); }
  });
  await page.goto('/admin/stores');
  const openA = page.getByRole('button', { name: 'View details for Store A', exact: true });
  await openA.click(); const dialog = page.getByRole('dialog', { name: 'Store Details', exact: true });
  await expect(dialog).toContainText('$111.11'); await expect(dialog).toContainText('Unavailable');
  unavailable = true; await dialog.getByRole('button', { name: '7d', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Unable to load this store and period');
  await expect(dialog).not.toContainText('$111.11');
  unavailable = false; await dialog.getByRole('button', { name: 'Retry store details', exact: true }).click();
  await expect(dialog).toContainText('$111.11');
  delay = true; await dialog.getByRole('button', { name: '30d', exact: true }).click(); await ready;
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(openA).toBeFocused();
  await page.getByRole('button', { name: 'View details for Store B', exact: true }).click();
  await expect(dialog).toContainText('$222.22');
  release(); await completed;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(dialog).toContainText('$222.22'); await expect(dialog).not.toContainText('$111.11');
});
