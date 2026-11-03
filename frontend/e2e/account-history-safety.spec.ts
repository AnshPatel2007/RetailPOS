import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';

for (const family of ['house', 'credit'] as const) {
  test(`${family} account history clears the previous customer on failure and ignores a closed customer's late reply`, async ({ page }) => {
    await login(page, 'owner@example.test');
    const customer = (lastName: string, id: string) => ({ id, firstName: 'History', lastName, phone: null, email: null });
    const alpha = { id: '10000000-0000-4000-8000-000000000101', customerId: '10000000-0000-4000-8000-000000000111', balance: 10, creditLimit: 100, isActive: true,
      createdAt: '2026-10-01T12:00:00Z', updatedAt: '2026-10-01T12:00:00Z', customer: customer('Alpha', '10000000-0000-4000-8000-000000000111') };
    const beta = { ...alpha, id: '10000000-0000-4000-8000-000000000102', customerId: '10000000-0000-4000-8000-000000000112', customer: customer('Beta', '10000000-0000-4000-8000-000000000112') };
    const base = family === 'house' ? 'house-accounts' : 'store-credit';
    await page.route(`**/api/${base}?*`, route => route.fulfill({ json: { success: true, data: [alpha, beta], pagination: { totalPages: 1 } } }));
    let betaUnavailable = true, delayAlpha = false;
    let release!: () => void, started!: () => void, finished!: () => void;
    const delayed = new Promise<void>(resolve => { release = resolve; });
    const observed = new Promise<void>(resolve => { started = resolve; });
    const completed = new Promise<void>(resolve => { finished = resolve; });
    await page.route(`**/api/${base}/*/transactions`, async route => {
      const alphaId = family === 'house' ? alpha.id : alpha.customerId;
      const isAlpha = route.request().url().includes('/' + alphaId + '/');
      if (!isAlpha && betaUnavailable) { await route.fulfill({ status: 503, json: { error: 'Fixture history unavailable' } }); return; }
      if (isAlpha && delayAlpha) { started(); await delayed; }
      try {
        await route.fulfill({ json: { success: true, data: [{ id: isAlpha ? 'alpha-entry' : 'beta-entry', type: family === 'house' ? 'CHARGE' : 'CREDIT', amount: 10,
          balanceBefore: 0, balanceAfter: 10, saleId: null, notes: isAlpha ? 'Alpha ledger evidence' : 'Beta ledger evidence', createdAt: '2026-10-01T12:00:00Z' }] } });
      } finally { if (isAlpha && delayAlpha) finished(); }
    });
    await page.goto('/customers/accounts/' + (family === 'house' ? 'house-accounts' : 'store-credits'));
    const open = async (name: string) => page.getByRole('row').filter({ hasText: 'History ' + name }).getByRole('button', { name: 'History', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await open('Alpha'); await expect(dialog).toContainText('Alpha ledger evidence'); await page.keyboard.press('Escape');
    await open('Beta');
    await expect(dialog.getByRole('alert')).toContainText('Unable to load this account activity');
    await expect(dialog).not.toContainText('Alpha ledger evidence'); await expect(dialog).not.toContainText(/No activity yet|No transactions yet/);
    betaUnavailable = false; await dialog.getByRole('button', { name: 'Retry account activity', exact: true }).click();
    await expect(dialog).toContainText('Beta ledger evidence'); await page.keyboard.press('Escape');
    delayAlpha = true; await open('Alpha'); await observed; await page.keyboard.press('Escape');
    await open('Beta'); await expect(dialog).toContainText('Beta ledger evidence');
    release(); await completed;
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(dialog).toHaveAccessibleName(/History Beta/); await expect(dialog).toContainText('Beta ledger evidence'); await expect(dialog).not.toContainText('Alpha ledger evidence');
  });
}
