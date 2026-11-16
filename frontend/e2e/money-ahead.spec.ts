import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';
import { chooseOption, selectField } from './utils/select-helper';
import { confirmInApp } from './utils/confirm-helper';
import { clickHeaderAction } from './utils/header-helper';

test('the owner enters money today and a planned payment, and sees what is left each day', async ({ page }, info) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await login(page, 'owner@example.test');
  const headers = { Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token')) };
  const today: string = (await (await page.request.get('/api/financial/cash-plan', { headers })).json()).data.plan.today;
  await page.goto('/financial?tab=ahead');
  await expect(page.locator('.page-tabs [aria-current="page"]')).toHaveText('Money Ahead');
  const days = page.locator('table').first().locator('tbody tr');
  await expect(days).toHaveCount(14);
  await expect(days.first()).toContainText('Today');

  await clickHeaderAction(page, 'Update Money Today');
  const money = page.getByRole('dialog', { name: 'Update Money Today', exact: true });
  await money.getByLabel('Money this morning', { exact: true }).fill('1500');
  await money.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(money).toHaveCount(0);
  await expect(page.getByText('This morning, bank and safe', { exact: true })).toBeVisible();
  await expect(days.first().locator('td').nth(3)).toContainText('$');

  // A loan payment on today's day of the month lands in today's row.
  await clickHeaderAction(page, 'Add Planned Item');
  const item = page.getByRole('dialog', { name: 'Add Planned Item', exact: true });
  await item.getByLabel('Name', { exact: true }).fill('Loan payment');
  await item.getByLabel('Amount', { exact: true }).fill('2000');
  await chooseOption(selectField(item, 'Day of the month'), String(Number(today.slice(8))));
  await item.getByRole('button', { name: 'Add Item', exact: true }).click();
  await expect(item).toHaveCount(0);
  const planned = page.locator('table').nth(1);
  await expect(planned.getByRole('row').filter({ hasText: 'Loan payment' })).toContainText('Monthly on day ' + Number(today.slice(8)));
  await days.first().locator('summary').click();
  await expect(days.first()).toContainText('Loan payment');
  await expect(days.first()).toContainText('$2,000.00');
  await page.screenshot({ path: info.outputPath('money-ahead.png'), animations: 'disabled' });
  // On a phone the days stack into cards and nothing scrolls sideways (dark mode too).
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await expect(days.first()).toContainText('Loan payment');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('money-ahead-phone-dark.png'), animations: 'disabled' });
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await page.setViewportSize({ width: 1366, height: 900 });

  // Removing it asks first.
  await planned.getByRole('button', { name: 'More actions for Loan payment', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Remove', exact: true }).click();
  await confirmInApp(page, 'Remove Loan payment?', 'Remove');
  await expect(page.getByText('No planned items', { exact: true })).toBeVisible();
});

test('a manager has no Money Ahead', async ({ page }) => {
  await login(page, 'manager@example.test');
  await page.goto('/financial?tab=ahead');
  await expect(page.locator('.page-tabs [aria-current="page"]')).toHaveText('Expenses');
  await expect(page.locator('.page-tabs').getByText('Money Ahead', { exact: true })).toHaveCount(0);
  expect((await page.request.get('/api/financial/cash-plan', { headers: { Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token')) } })).status()).toBe(403);
});
