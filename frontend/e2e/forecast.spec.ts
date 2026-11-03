import { chooseOption, selectField } from './utils/select-helper';
import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';

test('new-store forecast explains missing history without invented amounts', async ({ page }) => {
  await login(page, 'owner@example.test'); await page.goto('/analytics');
  await page.getByRole('button', { name: 'Forecast', exact: true }).click();
  await expect(page.getByText('Forecast unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText(/At least 28 complete store dates/)).toBeVisible();
  await expect(page.getByText('Estimated total', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/forecast-unavailable.png', fullPage: true });
});

test('forecast labels estimates and observed ranges and discards a late period response', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await login(page, 'forecast@example.test'); await page.goto('/analytics');
  await page.getByRole('button', { name: 'Forecast', exact: true }).click();
  const total = page.getByText('Estimated total', { exact: true }).locator('..');
  await expect(total).toContainText('$330.00');
  await expect(page.getByText(/28 complete dates, 14 dates with sales/)).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Observed weekday range' })).toBeVisible();
  let release: () => void = () => {}; let started: () => void = () => {}; let finished: () => void = () => {};
  const pending = new Promise<void>(resolve => { release = resolve; });
  const requested = new Promise<void>(resolve => { started = resolve; });
  const fulfilled = new Promise<void>(resolve => { finished = resolve; });
  await page.route('**/api/analytics/forecast?**', async route => {
    if (new URL(route.request().url()).searchParams.get('forecastDays') === '7') {
      const response = await route.fetch(); started(); await pending;
      try { await route.fulfill({ response }); } finally { finished(); }
    } else await route.continue();
  });
  const period = selectField(page, 'Forecast period');
  await chooseOption(period, 'Next 7 days'); await requested;
  await expect(page.getByText('Loading forecast for the selected period.', { exact: true })).toBeVisible();
  await expect(total).toHaveCount(0);
  await chooseOption(period, 'Next 14 days'); await expect(total).toContainText('$154.00');
  release(); await fulfilled;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(period).toHaveAttribute('data-value', '14'); await expect(total).toContainText('$154.00');
  await page.screenshot({ path: 'test-results/forecast-estimate.png', fullPage: true });
  expect(errors).toEqual([]);
});
