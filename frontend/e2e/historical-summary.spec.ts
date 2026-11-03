import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';

test('daily summaries show unknown metrics and read-only source details at laptop and phone sizes', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await login(page, 'reporting@example.test');
  let historical: any;
  await page.route('**/api/reports/sales?*', async route => {
    const response = await route.fetch(), body = await response.json(), data = body.data;
    historical = { ...data.sales[0], sourceType: 'DAILY_SUMMARY', saleNumber: 'HIST-TEST-20260101',
      sourceData: { businessDate: '2026-01-01', register1Cents: 1000, register2Cents: null, cardCents: 1200, lotteryNetCents: -50,
        caveats: ['January source tax summary includes an unexplained $500 not present in daily entries; it is excluded pending clarification.'] }, items: [] };
    data.sales = [historical]; data.refunds = []; data.voids = [];
    data.entries = [{ ...data.entries[0], sourceType: 'DAILY_SUMMARY', kind: 'SALE', saleNumber: historical.saleNumber,
      storeDate: '2026-01-01', customer: 'Not supplied', method: 'OTHER', total: 22 }];
    data.summary = { ...data.summary, totalSales: 22, grossCollected: 22, refunds: 0, refundCount: 0, totalTax: 2, netSales: 20,
      totalTransactions: null, averageOrderValue: null, totalDiscount: null, historicalSummaries: 1 };
    data.historyWarning = '1 historical daily summary included. Receipt counts, costs and discounts were not supplied.';
    await route.fulfill({ json: body });
  });
  await page.route('**/api/sales/*', async route => route.fulfill({ json: { success: true, data: historical } }));
  await page.setViewportSize({ width: 1366, height: 768 }); await page.goto('/reports');
  await expect(page.getByText('Unavailable', { exact: true })).toHaveCount(3);
  const row = page.getByRole('row').filter({ hasText: 'HIST-TEST-20260101' });
  await expect(row.getByRole('checkbox')).toBeDisabled();
  await row.getByTitle('View details').click();
  const dialog = page.getByRole('dialog', { name: 'Historical Daily Summary', exact: true });
  await expect(dialog).toBeVisible(); await expect(dialog.getByText(/unexplained \$500/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Refund|Void/ })).toHaveCount(0);
  await expect(dialog.getByText('-$0.50', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/historical-summary-light.png', animations: 'disabled' });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.screenshot({ path: 'test-results/historical-summary-dark.png', animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/historical-summary-mobile.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Export Preview', exact: true });
  await expect(preview.getByText('Daily summary', { exact: true })).toBeVisible();
  await expect(preview.getByText('2026-01-01', { exact: true })).toBeVisible();
  await expect(preview.getByText('Card recorded; remainder unspecified', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('lottery nets stay separate from commission and missing lottery figures remain unknown', async ({ page }) => {
  await login(page, 'reporting@example.test');
  await page.route('**/api/lottery/reports/daily-summary?*', route => route.fulfill({ json: { success: true, data: {
    historicalDays: 2, missingNetDays: 1, totalNetAmount: null, historicalNet: -0.5,
    historicalNetDaily: [{ id: 'summary-1', date: '2026-01-01', netAmount: -0.5 }],
  } } }));
  await page.goto('/lottery?tab=reports&history=legacy');
  await expect(page.getByRole('heading', { name: 'Historical lottery net', exact: true })).toBeVisible();
  await expect(page.getByText(/Lottery figures were not supplied for 1 days/)).toBeVisible();
  await expect(page.getByText('Unavailable', { exact: true })).toHaveCount(4);
  await expect(page.getByText('-$0.50', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/historical-lottery.png', fullPage: true, animations: 'disabled' });
});
