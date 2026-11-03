import { test, expect, Page } from '@playwright/test';
import { today } from '@internationalized/date';
import { login, logout } from './utils/auth-helper';

const date = (days = 0) => today('America/Chicago').add({ days }).toString();
async function save(page: Page) { const response = page.waitForResponse(r => r.url().includes('/lottery/v2/days/') && r.url().endsWith('/report') && r.request().method() === 'POST'); await page.getByRole('button', { name: 'Save draft', exact: true }).click(); expect((await response).status()).toBe(200); await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled(); }
async function terminal(page: Page, scratchPayout = '0', commission = '7.50') {
  await page.getByRole('button', { name: 'Online sales', exact: true }).click();
  for (const label of ['Gross online sales', 'Cancellations', 'Draw-game payouts', 'FastPlay payouts']) await page.getByLabel(label, { exact: true }).fill('0');
  await page.getByLabel('Scratch-ticket payouts', { exact: true }).fill(scratchPayout);
  await page.getByText('Lottery earnings', { exact: true }).click();
  await page.getByLabel('Online sales commission', { exact: true }).fill('0'); await page.getByLabel('Scratch sales commission', { exact: true }).fill(commission);
  await save(page);
}
async function fits(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); }

test('rack closing numbers advance on complete input, retain drafts, retry safely and carry to the next day', async ({ page }, info) => {
  test.setTimeout(120000);
  await login(page, 'lottery@example.test'); await page.goto('/lottery?date=' + date(-1)); await page.getByRole('button', { name: 'Start daily entry', exact: true }).click();
  const first = page.getByLabel('Closing number for Bin 2', { exact: true }), second = page.getByLabel('Closing number for Bin A1', { exact: true });
  await expect(first).toBeVisible(); await expect(page.locator('tbody tr').first()).toContainText('Crossword');
  await first.fill('020'); await expect(second).toBeFocused();
  await second.pressSequentially('0001000001025', { delay: 2 }); await expect(second).toBeFocused(); await second.press('Enter'); await expect(second).toHaveValue('025');
  await expect(page.locator('tbody tr').filter({ hasText: 'Bright Stars' })).toContainText('$150.00');
  await page.getByRole('button', { name: 'Online sales', exact: true }).click(); await page.getByLabel('Gross online sales', { exact: true }).fill('12.');
  await page.getByRole('button', { name: 'Scratch sales', exact: true }).click(); await expect(second).toHaveValue('025');
  await page.getByRole('button', { name: 'Reports', exact: true }).click(); await expect(page.getByRole('button', { name: 'Settlements', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Daily Entry', exact: true }).click(); await page.getByRole('button', { name: 'Online sales', exact: true }).click(); await expect(page.getByLabel('Gross online sales', { exact: true })).toHaveValue('12.');
  await page.getByLabel('Gross online sales', { exact: true }).fill('0');
  let interrupted = false;
  await page.route('**/api/lottery/v2/days/*/report', async route => { if (interrupted) return route.continue(); interrupted = true; const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed'); });
  await page.getByRole('button', { name: 'Save draft', exact: true }).click(); await expect(page.getByRole('button', { name: 'Retry saved request', exact: true })).toBeVisible();
  await page.reload(); await page.getByRole('button', { name: 'Retry saved request', exact: true }).click(); await expect(page.getByRole('button', { name: 'Retry saved request', exact: true })).toHaveCount(0);
  await terminal(page);
  await page.getByRole('button', { name: 'Scratch sales', exact: true }).click(); await page.setViewportSize({ width: 1366, height: 768 }); await page.screenshot({ path: info.outputPath('rack-laptop.png'), animations: 'disabled' }); await fits(page);
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: info.outputPath('rack-phone.png'), animations: 'disabled' }); await fits(page);
  await page.getByRole('button', { name: 'Online sales', exact: true }).click(); await page.getByRole('button', { name: 'Close day', exact: true }).click(); await expect(page.getByText('Closed', { exact: true })).toBeVisible();
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const pnl = await page.request.get('/api/financial/reports/pnl?startDate=' + date(-1) + '&endDate=' + date(-1) + '&workbook=true', { headers: { Authorization: 'Bearer ' + token } });
  expect((await pnl.json()).data).toMatchObject({ lotteryEarnings: 7.5, netIncome: 7.5, revenue: { netSales: 0 } });
  await page.getByRole('button', { name: 'Reports', exact: true }).click(); const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export', exact: true }).click(); expect((await download).suggestedFilename()).toContain('Lottery-');
  await page.goto('/lottery?date=' + date()); await page.getByRole('button', { name: 'Start daily entry', exact: true }).click();
  await expect(page.locator('tbody tr').filter({ hasText: 'Bright Stars' }).getByRole('cell', { name: '025', exact: true })).toBeVisible();
  await expect(page.getByLabel('Closing number for Bin A1')).toHaveValue('');
});

test('machine totals have no rack controls and close without settlement or cash verification', async ({ page }, info) => {
  await login(page, 'lottery-machine@example.test'); await page.goto('/lottery'); await page.getByRole('button', { name: 'Start daily entry', exact: true }).click();
  await expect(page.getByLabel(/Closing number for Bin/)).toHaveCount(0); await page.getByLabel('Scratch sales', { exact: true }).fill('200'); await save(page); await terminal(page, '250', '10');
  await page.getByRole('button', { name: 'Close day', exact: true }).click(); await expect(page.getByText('Closed', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1366, height: 768 }); await page.getByRole('button', { name: 'Toggle theme', exact: true }).filter({ visible: true }).click(); await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Reports', exact: true }).click(); await page.screenshot({ path: info.outputPath('machine-report-dark-phone.png'), animations: 'disabled' }); await fits(page);
  await expect(page.getByRole('cell', { name: '-$50.00', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Settlements', exact: true })).toHaveCount(0);
});

test('cashiers cannot close and platform equipment has only rack or machine', async ({ page }, info) => {
  await login(page, 'lottery-cashier@example.test'); await page.goto('/lottery?lotteryView=online');
  await expect(page.getByRole('button', { name: 'Close day', exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Ticket Setup', exact: true })).toHaveCount(0);
  await logout(page); await login(page, 'platform@example.test'); await page.goto('/admin/stores'); await page.getByRole('button', { name: 'Configure lottery for Lottery MANUAL', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Lottery · Lottery MANUAL' }); await expect(modal.getByRole('button', { name: /Lottery rack/ })).toBeVisible(); await expect(modal.getByRole('button', { name: /Lottery machine/ })).toBeVisible();
  await expect(modal.getByRole('checkbox')).toHaveCount(0); await expect(modal.getByText('Inventory barcode verification')).toHaveCount(0);
  await expect(modal.getByRole('button', { name: 'Save equipment', exact: true })).toBeEnabled(); await page.screenshot({ path: info.outputPath('equipment.png'), animations: 'disabled' });
  await modal.getByRole('button', { name: /Lottery machine/ }).click();
  const saved = page.waitForResponse(response => response.url().includes('/lottery/v2/equipment/') && response.request().method() === 'POST');
  await modal.getByRole('button', { name: 'Save equipment', exact: true }).click(); expect((await saved).status()).toBe(200); await expect(modal).toHaveCount(0);
});
