import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';

test('a late promotion product lookup cannot replace the selected promotion or its reviewed edits', async ({ page }) => {
  await login(page, 'owner@example.test');
  const common = { type: 'PERCENT_OFF', percentOff: 10, buyQuantity: null, getQuantity: null, bundlePrice: null, amountOff: null,
    categoryIds: [], daysOfWeek: [], startsAt: null, endsAt: null, startTime: null, endTime: null, priority: 0, timesUsed: 0, isActive: true, description: '' };
  await page.route('**/api/promotions?*', route => route.fulfill({ json: { success: true, data: [
    { ...common, id: 'promo-alpha', name: 'Alpha promotion', productIds: ['alpha-product'] },
    { ...common, id: 'promo-beta', name: 'Beta promotion', productIds: ['beta-product'] },
  ], pagination: { totalPages: 1 } } }));
  let release!: () => void, started!: () => void, finished!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { started = resolve; });
  const completed = new Promise<void>(resolve => { finished = resolve; });
  await page.route('**/api/products?*', async route => {
    const id = new URL(route.request().url()).searchParams.get('ids');
    if (!id) return route.continue();
    if (id === 'alpha-product') { started(); await held; }
    try { await route.fulfill({ json: { success: true, data: [{ id, name: id === 'alpha-product' ? 'Alpha item' : 'Beta item' }] } }); }
    finally { if (id === 'alpha-product') finished(); }
  });
  await page.goto('/promotions');
  await page.getByRole('row').filter({ hasText: 'Alpha promotion' }).getByRole('button', { name: 'Edit', exact: true }).click(); await ready;
  await page.getByRole('row').filter({ hasText: 'Beta promotion' }).getByRole('button', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit Promotion', exact: true });
  const name = dialog.getByLabel('Name', { exact: true });
  await expect(name).toHaveValue('Beta promotion'); await name.fill('Beta reviewed');
  release(); await completed;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(name).toHaveValue('Beta reviewed'); await expect(dialog).toContainText('Beta item'); await expect(dialog).not.toContainText('Alpha item');
});
