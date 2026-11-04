import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';
import type { Page } from '@playwright/test';

async function chooseJanuary(page: Page) {
  await page.getByRole('button', { name: /^Employee sales dates:/ }).click();
  const picker = page.getByRole('dialog', { name: 'Employee sales dates', exact: true });
  await picker.getByLabel('From date', { exact: true }).fill('2025-01-01');
  await picker.getByLabel('Through date', { exact: true }).fill('2025-01-31');
  await picker.getByRole('button', { name: 'Apply', exact: true }).click();
}

test('employee collection totals and signed details reconcile, with visible retry for both requests', async ({ page }) => {
  await login(page, 'reporting@example.test'); await page.goto('/reports');
  let unavailable = true;
  await page.route('**/api/reports/employee-sales*', route => unavailable ? route.fulfill({ status: 503, json: { error: 'Employee report temporarily unavailable' } }) : route.continue());
  await page.getByRole('navigation', { name: 'Reports views' }).getByRole('link', { name: 'Staff', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Employee report temporarily unavailable');
  unavailable = false; await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('Net collected', { exact: true }).first().locator('..')).toContainText('$11.00');
  await page.route('**/api/reports/sales?*', route => route.fulfill({ status: 503, json: { error: 'Activity temporarily unavailable' } }), { times: 1 });
  await page.getByRole('button', { name: 'View activity for Reporting Fixture', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Activity - Reporting Fixture', exact: true });
  await expect(modal.getByRole('alert')).toContainText('Activity temporarily unavailable');
  await modal.getByRole('button', { name: 'Retry details', exact: true }).click();
  await expect(modal).toContainText('2 sale, return and void entries.');
  await expect(modal.getByText('REPORT-PRIOR', { exact: true })).toBeVisible();
  await expect(modal.getByText('-$11.00', { exact: true })).toBeVisible();
  await expect(modal.getByText('$22.00', { exact: true })).toBeVisible();
  await modal.screenshot({ path: 'test-results/employee-activity-light.png', animations: 'disabled' });
  await page.keyboard.press('Escape'); await expect(modal).toHaveCount(0);
  await chooseJanuary(page);
  await expect(page.getByText('Net collected', { exact: true }).first().locator('..')).toContainText('$22.00');
});

test('employee date filters ignore a late response from the previous period', async ({ page }) => {
  await login(page, 'reporting@example.test'); await page.goto('/reports');
  await page.getByRole('navigation', { name: 'Reports views' }).getByRole('link', { name: 'Staff', exact: true }).click();
  await page.getByRole('button', { name: 'View activity for Reporting Fixture', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Activity - Reporting Fixture', exact: true });
  await expect(modal).toContainText('2 sale, return and void entries.');
  await page.keyboard.press('Escape');
  let release!: () => void, observed!: () => void, completed!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { observed = resolve; });
  const finished = new Promise<void>(resolve => { completed = resolve; });
  await page.route('**/api/reports/employee-sales*', async route => { const response = await route.fetch(); observed(); await delayed; try { await route.fulfill({ response }); } finally { completed(); } }, { times: 1 });
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await started;
  await chooseJanuary(page);
  const total = page.getByText('Net collected', { exact: true }).first().locator('..');
  await expect(total).toContainText('$22.00');
  release(); await finished;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(total).toContainText('$22.00');
  await expect(page.getByRole('button', { name: /^Employee sales dates:/ })).toContainText('Jan 1, 2025');
  expect(new URL(page.url()).searchParams.get('employeeFrom')).toBe('2025-01-01');
  expect(new URL(page.url()).searchParams.get('employeeTo')).toBe('2025-01-31');
});
