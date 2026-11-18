import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';
import fs from 'fs';
import { createRequire } from 'node:module';
const ExcelJS = createRequire(import.meta.url)('exceljs/dist/exceljs.min.js') as typeof import('exceljs');

test('recorded P&L keeps old links and month selection and exports the daily grid', async ({ page }) => {
  await login(page, 'reporting@example.test');
  await page.goto('/financial?tab=pnl&pnlCosts=estimated');
  await expect(page.getByText('Profit & Loss Statement', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Estimated costs (70%)', exact: true })).toHaveCount(0);
  const exportStatement = async () => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export Excel', exact: true }).click();
    const download = await pending;
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(fs.readFileSync((await download.path())!));
    return { name: download.suggestedFilename(), workbook, contents: JSON.stringify(workbook.model) };
  };
  const recorded = await exportStatement();
  expect(recorded.name).toContain('-recorded.xlsx');
  expect(recorded.contents).not.toContain('Estimated merchandise cost rate');
  expect(recorded.workbook.worksheets[0].getCell('B6').value).toBe('Total sale');
  expect(recorded.workbook.worksheets[0].getCell('J6').value).toBe('MONTHLY SALES');
  await page.getByLabel('P&L month', { exact: true }).fill('2026-01');
  await expect(page.getByText('Cost of goods sold', { exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByLabel('P&L month', { exact: true })).toHaveValue('January 2026');
  const january = await exportStatement();
  expect(january.name).toContain('2026-01-01-to-2026-01-31-recorded.xlsx');
  expect(january.workbook.worksheets).toHaveLength(1);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({ path: 'test-results/recorded-pnl.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/recorded-pnl-mobile.png', fullPage: true, animations: 'disabled' });
});

test('failed P&L reads disable export until the statement recovers', async ({ page }) => {
  await login(page, 'reporting@example.test');
  let unavailable = true;
  await page.route('**/api/financial/reports/pnl*', route => unavailable ? route.fulfill({ status: 503, json: { error: 'Report unavailable' } }) : route.continue());
  await page.goto('/financial?tab=pnl');
  await expect(page.getByRole('alert')).toContainText('Report unavailable');
  await expect(page.getByRole('button', { name: 'Export Excel', exact: true })).toBeDisabled();
  unavailable = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Export Excel', exact: true })).toBeEnabled();
  await expect(page.getByText('Profit & Loss Statement', { exact: true })).toBeVisible();
});

test('Excel export recovers from failure and cancels a download when the month changes', async ({ page }) => {
  await login(page, 'reporting@example.test');
  await page.goto('/financial?tab=pnl');
  const button = page.getByRole('button', { name: 'Export Excel', exact: true });
  await expect(button).toBeEnabled();
  await page.route('**/api/financial/reports/pnl?*', async route => {
    if (new URL(route.request().url()).searchParams.get('workbook') === 'true') await route.fulfill({ status: 503, json: { error: 'Excel report temporarily unavailable' } });
    else await route.continue();
  });
  await button.click();
  await expect(page.getByText('Excel report temporarily unavailable', { exact: true })).toBeVisible();
  await expect(button).toBeEnabled();
  await page.unrouteAll({ behavior: 'wait' });
  let release!: () => void, completed!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const handled = new Promise<void>(resolve => { completed = resolve; });
  const downloads: string[] = [];
  page.on('download', download => downloads.push(download.suggestedFilename()));
  await page.route('**/api/financial/reports/pnl?*', async route => {
    if (new URL(route.request().url()).searchParams.get('workbook') !== 'true') { await route.continue(); return; }
    try { const response = await route.fetch(); await gate; await route.fulfill({ response }); }
    catch { /* Navigation aborts the superseded export request. */ }
    finally { completed(); }
  });
  const requested = page.waitForRequest(r => r.url().includes('workbook=true'));
  await button.click(); await requested;
  await expect(page.getByRole('button', { name: 'Preparing Excel…', exact: true })).toBeDisabled();
  await page.getByLabel('P&L month', { exact: true }).fill('2026-01');
  release(); await handled;
  await expect(button).toBeEnabled();
  await expect(page.getByLabel('P&L month', { exact: true })).toHaveValue('January 2026');
  expect(downloads).toHaveLength(0);
  await page.unrouteAll({ behavior: 'wait' });
  const pending = page.waitForEvent('download');
  await button.click();
  expect((await pending).suggestedFilename()).toContain('2026-01-01-to-2026-01-31');
});
