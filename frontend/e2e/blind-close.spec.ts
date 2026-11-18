import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';

test('a cashier counts the drawer before seeing the expected amount; a manager always sees it', async ({ page }) => {
  await login(page, 'cashier@example.test');
  const headers = { Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token')) };
  // Nothing the register receives says what the drawer should hold.
  const shift = (await (await page.request.get('/api/shifts/current', { headers })).json()).data;
  expect(shift.blindClose).toBe(true);
  expect(shift.expectedDrawer).toBeUndefined();

  await page.goto('/my-shift');
  await expect(page.getByText('Starting Cash', { exact: true })).toBeVisible();
  await expect(page.getByText('Expected in Drawer', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Cash Refunds & Voids Paid', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/count the drawer and enter the total/)).toBeVisible();
  // The open shift's report (it states the expected cash) is offered only after closing.
  await expect(page.getByRole('row').filter({ hasText: 'Active' }).getByText('After closing', { exact: true })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Active' }).getByTitle('Print Z-report')).toHaveCount(0);

  await page.getByRole('button', { name: 'Clock Out', exact: true }).click();
  const close = page.getByRole('dialog', { name: 'Clock Out', exact: true });
  await expect(close.getByText(/Count everything in the drawer/)).toBeVisible();
  await expect(close.getByText('Expected in drawer', { exact: true })).toHaveCount(0);
  await close.getByLabel('Counted cash', { exact: true }).fill('1');
  // No running "short by" while typing: the count is not steered toward a number.
  await expect(close.getByText(/Drawer is (short|over) by|Drawer balances/)).toHaveCount(0);
  await page.screenshot({ path: 'test-results/blind-close.png', fullPage: true });
  await close.getByRole('button', { name: 'Clock Out', exact: true }).click();

  // After closing, the expected amount and the difference are shown.
  const summary = page.getByRole('dialog', { name: 'Shift Summary', exact: true });
  await expect(summary.getByText('Expected', { exact: true })).toBeVisible();
  await expect(summary.getByText('Actual Count', { exact: true })).toBeVisible();
  await expect(summary.getByText('Difference', { exact: true })).toBeVisible();
  await summary.getByRole('button', { name: 'Done', exact: true }).click();
  // Leave the cashier clocked in, as seeded, so later register specs can take payment.
  expect((await page.request.post('/api/shifts/clock-in', { headers, data: { startingCash: 100 } })).status()).toBe(201);
});

test('the owner sees the expected amount and controls the rule in settings', async ({ page }) => {
  await login(page, 'owner@example.test');
  await page.goto('/shifts');
  await expect(page.getByText('Expected in Drawer', { exact: true })).toBeVisible();

  await page.goto('/settings?section=payments');
  const rule = page.getByRole('checkbox', { name: 'Cashiers count the drawer before seeing the expected amount' });
  await expect(rule).toBeChecked();
  const headers = { Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token')) };
  const saved = async () => (await (await page.request.get('/api/locations/my-settings', { headers })).json()).data.settings.cashControl.blindClose;
  await expect(page.getByRole('heading', { name: 'Cash Drawer' })).toBeVisible();
  try {
    await rule.uncheck();
    // The Cash Drawer card is the last one in this section.
    await page.getByRole('button', { name: 'Save Changes', exact: true }).last().click();
    await expect.poll(saved).toBe(false);
  } finally {
    // Put the rule back so later specs see the default.
    await page.request.put('/api/locations/my-settings', { headers, data: { cashControl: { blindClose: true } } });
  }
  expect(await saved()).toBe(true);
});
