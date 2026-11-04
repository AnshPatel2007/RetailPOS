import { chooseOption, selectField } from './utils/select-helper';
import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';
import fs from 'fs';

test('overall cards and signed breakdowns agree without invented comparison percentages', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await login(page, 'reporting@example.test'); await page.goto('/reports');
  const loaded = page.waitForResponse(r => r.url().includes('/api/reports/overall'));
  await page.getByRole('navigation', { name: 'Reports views' }).getByRole('link', { name: 'Overview', exact: true }).click();
  const response = await loaded; expect(response.status()).toBe(200);
  const report = (await response.json()).data;
  const currency = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
  await expect(page.getByText('Inventory received at cost', { exact: true }).locator('..')).toContainText(currency(report.profitability.receivedInventoryPurchases));
  await expect(page.getByRole('link', { name: 'View Full P&L', exact: true })).toHaveAttribute('href', '/financial?tab=pnl');
  await expect(page.getByText('Last 30 Days', { exact: true }).first().locator('..')).toContainText('$11.00');
  await expect(page.getByText('Comparison unavailable', { exact: true })).toHaveCount(2);
  await expect(page.getByText('Calendar: America/Chicago.', { exact: false })).toBeVisible();
  expect(report.trends.dailySales.reduce((sum: number, row: { sales: number }) => sum + row.sales, 0)).toBe(11);
  const payment = page.getByText('Payment Labels (Last 30 Days)', { exact: true }).locator('..').locator('..');
  await expect(payment).toContainText('$22.00'); await expect(payment).toContainText('-$11.00');
  await expect(payment.getByText(/share unavailable/)).toHaveCount(2);
  const category = page.getByText('Sales by Category', { exact: true }).locator('..').locator('..');
  await expect(category.getByText('Unallocated historical activity', { exact: true })).toBeVisible();
  await category.screenshot({ path: 'test-results/overall-signed-categories.png', animations: 'disabled' });
  await page.getByRole('heading', { name: 'Reports', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/overall-report-light.png', animations: 'disabled' });
  await expect(page.getByText(/\bNaN\b|Infinity/)).toHaveCount(0); expect(errors).toEqual([]);
});

test('analytics loads the selected view and shows unavailable historic profit honestly', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await login(page, 'reporting@example.test');
  const requested = new Set<string>();
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/analytics/')) requested.add(path);
  });
  await page.goto('/analytics');
  await expect(page.getByText('Profit: Unavailable', { exact: true })).toBeVisible();
  expect([...requested].sort()).toEqual(['/api/analytics/comparison', '/api/analytics/realtime']);
  const healthResponse = page.waitForResponse(r => r.url().includes('/analytics/business-health'));
  await page.getByRole('button', { name: 'Business Health', exact: true }).click();
  const health = await healthResponse;
  expect(health.status()).toBe(200);
  const profitability = (await health.json()).data.profitability;
  const currency = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
  await expect(page.getByText('+ Other income', { exact: true }).locator('..')).toContainText(currency(profitability.otherIncome));
  await expect(page.getByText('Inventory received at cost', { exact: true }).locator('..')).toContainText(currency(profitability.receivedInventoryPurchases));
  await expect(page.getByText('Cost information incomplete. Review missing inventory and sale costs.', { exact: false })).toBeVisible();
  await expect(page.getByText('Cost of goods sold (recorded)', { exact: false })).toBeVisible();
  await expect(page.getByText('Break-even requires a configured fixed/variable expense model.', { exact: true })).toBeVisible();
  await expect(page.getByText(/\bNaN\b/)).toHaveCount(0);
  await page.screenshot({ path: 'test-results/reporting-unavailable.png', fullPage: true });
  await page.getByRole('navigation', { name: 'Reports views' }).getByRole('link', { name: 'Inventory', exact: true }).click();
  await page.getByRole('button', { name: 'Product Matrix', exact: true }).click();
  await expect(page.getByText(/1 products have unavailable historical margin/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('P&L and what-if keep missing costs unavailable instead of estimating profit', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await login(page, 'reporting@example.test');
  await page.goto('/financial');
  await page.getByRole('button', { name: 'Profit & Loss', exact: true }).click();
  await expect(page.getByText('Profit & Loss Statement', { exact: true })).toBeVisible();
  const costStatus = page.getByRole('status').filter({ hasText: 'Cost information incomplete' });
  await expect(costStatus).toContainText('Review missing inventory and sale costs.');
  await expect(costStatus.getByRole('button', { name: 'Review costs', exact: true })).toBeVisible();
  await expect(page.getByText('Gross profit', { exact: true }).locator('..')).toContainText('—');
  await page.goto('/analytics');
  await page.getByRole('button', { name: 'What-If', exact: true }).click();
  await page.getByRole('button', { name: 'Calculate Impact', exact: true }).click();
  await expect(page.getByText(/Volume changes only by your input/)).toBeVisible();
  await expect(page.getByText('Unavailable', { exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('sales filters, return-period totals and both downloads agree', async ({ page }) => {
  await login(page, 'reporting@example.test'); await page.goto('/reports');
  const summary = page.getByText('Net collected (including tax)', { exact: true }).locator('..');
  await expect(summary.getByText('$11.00', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Returns issued in this period', exact: true })).toBeVisible();
  const search = page.getByPlaceholder('Search by sale #, customer name, email, or phone...');
  await search.fill('REPORT-PRIOR');
  await expect(summary.getByText('-$11.00', { exact: true })).toBeVisible();
  await expect(search).toHaveValue('REPORT-PRIOR');
  await page.getByRole('button', { name: 'Charts', exact: true }).click();
  await expect(page.getByText(/\bNaN\b/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Export Preview', exact: true });
  await expect(modal.getByText('1 sale, return and void entries will be exported.', { exact: true })).toBeVisible();
  await expect(modal.getByText('REFUND', { exact: true })).toBeVisible();
  await page.route('**/api/reports/sales/export/csv?*', route => route.fulfill({ status: 503, json: { error: 'Temporary export failure' } }), { times: 1 });
  await modal.getByRole('button', { name: 'Download CSV', exact: true }).click();
  await expect(modal.getByRole('alert')).toContainText('Retry');
  const downloadCsv = page.waitForEvent('download');
  await modal.getByRole('button', { name: 'Download CSV', exact: true }).click();
  const csv = fs.readFileSync((await (await downloadCsv).path())!, 'utf8');
  expect(csv).toContain('"REFUND"'); expect(csv).toContain('"-11.00","-1.00"'); expect(csv).not.toContain('REPORT-LEGACY');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const downloadPdf = page.waitForEvent('download');
  await modal.getByRole('button', { name: 'Download PDF', exact: true }).click();
  const pdf = fs.readFileSync((await (await downloadPdf).path())!); expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  await page.screenshot({ path: 'test-results/sales-return-report.png', fullPage: true });
  await search.fill('NO-MATCH');
  await expect(summary.getByText('$0.00', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Returns issued in this period', exact: true })).toHaveCount(0);
});

test('P&L separates purchases, keeps wages and exports the acquisition account', async ({ page }) => {
  await login(page, 'reporting@example.test'); await page.goto('/financial');
  await page.getByRole('button', { name: 'Profit & Loss', exact: true }).click();
  await expect(page.getByText('Total Operating Expenses', { exact: true }).locator('..')).toContainText('$3.00');
  await expect(page.getByText('Inventory received at cost', { exact: true }).locator('..')).toContainText('$0.00');
  await expect(page.getByText('Net Margin', { exact: true }).locator('..')).toContainText('—');
  await expect(page.getByText('INVENTORY_PURCHASE', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/purchase-expense-pnl.png', fullPage: true });
  await page.goto('/reports'); await page.getByRole('navigation', { name: 'Reports views' }).getByRole('link', { name: 'Exports', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Expenses', exact: true }).click();
  const csv = fs.readFileSync((await (await download).path())!, 'utf8');
  expect(csv).toContain('REPORT-PURCHASE'); expect(csv).toContain('Inventory Asset');
  expect(csv).toContain('REPORT-WAGES'); expect(csv).toContain('Expense - PAYROLL');
});

test.describe('Expense entry on a register in another timezone', () => {
  test.use({ timezoneId: 'Pacific/Kiritimati' });
  test('manager can save without a due date and edit without shifting the store date', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await login(page, 'manager@example.test'); await page.goto('/financial');
    await page.getByRole('button', { name: 'Add Expense', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'Add New Expense', exact: true });
    await expect(form.getByRole('option', { name: 'PAYROLL', exact: true })).toHaveCount(0);
    const chosen = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date());
    await expect(form.getByLabel('Expense Date', { exact: true })).toHaveValue(chosen);
    await chooseOption(selectField(form, 'Category'), 'Inventory Purchase');
    await form.getByLabel('Amount', { exact: true }).fill('17.25');
    await form.getByLabel('Description', { exact: true }).fill('Store calendar browser purchase');
    await expect(form.getByLabel('Due Date', { exact: true })).toHaveValue('');
    await page.screenshot({ path: 'test-results/expense-entry-light.png', fullPage: true });
    const saved = page.waitForResponse(r => r.url().endsWith('/api/expenses') && r.request().method() === 'POST');
    await form.getByRole('button', { name: 'Create Expense', exact: true }).click();
    const response = await saved; expect(response.status()).toBe(201);
    const record = (await response.json()).data; expect(record.dueDate).toBeNull();
    await expect(form).toHaveCount(0);
    const row = page.getByRole('row').filter({ hasText: 'Store calendar browser purchase' });
    await expect(row).toBeVisible(); await row.getByTitle('Edit', { exact: true }).click();
    const edit = page.getByRole('dialog', { name: 'Edit Expense', exact: true });
    await expect(edit.getByLabel('Expense Date', { exact: true })).toHaveValue(chosen);
    await edit.getByLabel('Description', { exact: true }).fill('Store calendar browser purchase revised');
    const updated = page.waitForResponse(r => r.url().endsWith('/api/expenses/' + record.id) && r.request().method() === 'PUT');
    await edit.getByRole('button', { name: 'Update Expense', exact: true }).click();
    const after = await updated; expect(after.status()).toBe(200);
    expect((await after.json()).data.expenseDate).toBe(record.expenseDate);
    await expect(edit).toHaveCount(0); expect(errors).toEqual([]);
  });
});

test('financial read failures show retry and recover without a blank screen', async ({ page }) => {
  await login(page, 'reporting@example.test');
  let unavailable = true;
  await page.route('**/api/reports/expenses?*', route => unavailable ? route.fulfill({ status: 503, json: { error: 'Financial fixture temporarily unavailable' } }) : route.continue());
  await page.goto('/financial');
  await expect(page.getByRole('alert')).toContainText('Financial fixture temporarily unavailable');
  unavailable = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Report stock acquisition' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('platform financial views remain read-only and ignore responses from the previous store', async ({ page }) => {
  await login(page, 'platform@example.test'); await page.goto('/financial');
  const selector = selectField(page, 'Store');
  await chooseOption(selector, 'Store C');
  await expect(page.getByRole('row').filter({ hasText: 'Report stock acquisition' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Expense', exact: true })).toHaveCount(0);
  let release!: () => void, observed!: () => void, completed!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { observed = resolve; });
  const finished = new Promise<void>(resolve => { completed = resolve; });
  await page.route('**/api/reports/expenses?*', async route => {
    const response = await route.fetch(); observed(); await delayed;
    try { await route.fulfill({ response }); } catch { /* Obsolete scoped requests may be cancelled. */ } finally { completed(); }
  }, { times: 1 });
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await started;
  await chooseOption(selector, 'Empty Store');
  await expect(page.getByText('No expenses found', { exact: true })).toBeVisible();
  release(); await finished;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByText('No expenses found', { exact: true })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Report stock acquisition' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Budgets', exact: true }).click();
  await expect(page.getByText('No budgets set for this store.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Budget', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Recurring', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Generate Due Expenses', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add Recurring', exact: true })).toHaveCount(0);
  await expect(page.getByText('No recurring expenses set up', { exact: true })).toBeVisible();
  await chooseOption(selector, 'Store C');
  await expect(page.getByRole('row').filter({ hasText: 'Store C recurring supplier' })).toBeVisible();
});

