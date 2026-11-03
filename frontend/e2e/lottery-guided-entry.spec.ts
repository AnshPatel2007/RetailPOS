import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';

test('simple mixed legacy stores retain both sources and support multiple new rolls with no book management', async ({ page }, info) => {
  await login(page, 'lottery-mixed@example.test'); await page.goto('/lottery'); await page.getByRole('button', { name: 'Start daily entry', exact: true }).click();
  const row = page.locator('tbody tr').filter({ hasText: 'Bright Stars' });
  await row.getByRole('button', { name: 'New roll', exact: true }).click(); await row.getByRole('button', { name: 'New roll (1)', exact: true }).click();
  const input = page.getByLabel('Closing number for Bin A1');
  await input.fill('003'); await input.press('Enter'); await expect(row).toContainText('$1,130.00');
  await page.getByLabel('Scratch sales', { exact: true }).fill('50');
  await page.getByRole('button', { name: 'Save & online sales', exact: true }).click();
  for (const label of ['Cancellations', 'Draw-game payouts', 'FastPlay payouts', 'Scratch-ticket payouts']) await page.getByLabel(label, { exact: true }).fill('0');
  await page.getByLabel('Gross online sales', { exact: true }).fill('100'); await page.getByRole('button', { name: 'Save draft', exact: true }).click(); await expect(page.getByRole('button', { name: 'Close day', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Close day', exact: true }).click(); await expect(page.getByText('Closed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reports', exact: true }).click(); await expect(page.getByRole('cell', { name: 'Pending', exact: true })).toBeVisible(); await expect(page.getByRole('cell', { name: '$1,280.00', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ticket Setup', exact: true }).click(); await expect(page.getByRole('button', { name: 'Books', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit', exact: true }).click(); await expect(page.getByLabel('Bin number', { exact: true })).toHaveValue('A1'); await expect(page.getByLabel('Starting number', { exact: true })).toHaveValue('10');
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: info.outputPath('game-setup-phone.png'), animations: 'disabled' }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
