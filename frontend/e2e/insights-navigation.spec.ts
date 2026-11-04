import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';

test('report views preserve links, load independently and open AI only on request', async ({ page }, testInfo) => {
  await login(page, 'owner@example.test');
  const requests: string[] = [];
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  await page.goto('/analytics?tab=forecast');
  await expect(page).toHaveURL(/\/insights\/reports\/overview\?view=forecast$/);
  const forecastTab = page.getByRole('navigation', { name: 'Overview analysis views' }).getByRole('button', { name: 'Forecast', exact: true });
  await expect(forecastTab).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Forecast unavailable', { exact: true })).toBeVisible();
  expect(requests.filter(path => /\/analytics\/(abc-analysis|product-matrix|comparison|realtime|chat)$/.test(path))).toHaveLength(0);
  await page.reload(); await expect(forecastTab).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Open POS assistant', exact: true }).click();
  const assistant = page.getByRole('dialog', { name: 'POS Assistant', exact: true });
  await expect(assistant.getByText('Read-only store analysis and POS help', { exact: true })).toBeVisible();
  expect(requests.filter(path => path === '/api/analytics/chat')).toHaveLength(0);
  await page.keyboard.press('Escape'); await expect(assistant).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  const navigation = page.getByRole('navigation', { name: 'Reports views' });
  await expect(navigation.getByRole('link', { name: 'Exports' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('reports-navigation-phone.png') });
  await navigation.getByRole('link', { name: 'Sales', exact: true }).click();
  await expect(page.getByPlaceholder('Search by sale #, customer name, email, or phone...')).toBeVisible();
  await page.goBack(); await expect(forecastTab).toHaveAttribute('aria-current', 'page');
});

test('sales filters and search survive reload and returning from another report', async ({ page }) => {
  await login(page, 'reporting@example.test');
  const filters = { startDate: '2025-01-01', endDate: '2025-01-01', paymentMethod: ['CASH'], status: [], employeeId: [], customerId: '', minAmount: '', maxAmount: '', showCharts: false };
  await page.goto('/reports?salesFilters=' + encodeURIComponent(JSON.stringify(filters)) + '&search=REPORT-PRIOR');
  const search = page.getByPlaceholder('Search by sale #, customer name, email, or phone...');
  await expect(search).toHaveValue('REPORT-PRIOR');
  await expect(page.getByText('REPORT-PRIOR', { exact: true })).toBeVisible();
  await expect(page.getByText('REPORT-LEGACY', { exact: true })).toHaveCount(0);
  await page.reload(); await expect(search).toHaveValue('REPORT-PRIOR');
  await expect(page.getByText('REPORT-PRIOR', { exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Reports views' }).getByRole('link', { name: 'Overview', exact: true }).click();
  await page.goBack(); await expect(search).toHaveValue('REPORT-PRIOR');
  await expect(page.getByText('REPORT-PRIOR', { exact: true })).toBeVisible();
});
