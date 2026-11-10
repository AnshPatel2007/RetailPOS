import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';
import { openMenuSection } from './utils/menu-helper';
import { chooseOption, selectField } from './utils/select-helper';

test('month picker supports year entry, keyboard selection and focus restoration', async ({ page }, info) => {
  await login(page, 'owner@example.test');
  await page.goto('/financial?tab=pnl&pnlMonth=2026-01');
  const trigger = page.getByRole('button', { name: 'Choose p&l month', exact: true });
  await trigger.click();
  const picker = page.getByRole('dialog', { name: 'Choose p&l month', exact: true });
  await expect(picker.getByRole('radio')).toHaveCount(12);
  await picker.getByRole('spinbutton', { name: 'Year', exact: true }).fill('2025');
  await picker.screenshot({ path: info.outputPath('month-picker.png') });
  await picker.getByText('Feb', { exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'P&L month', exact: true })).toHaveValue('February 2025');
  await expect(page).toHaveURL(/pnlMonth=2025-02/);
  await expect(trigger).toBeFocused();
  await trigger.click(); await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0); await expect(trigger).toBeFocused();
});

test('selector and calendar inside a dialog do not close the underlying form', async ({ page }, info) => {
  await login(page, 'owner@example.test'); await page.goto('/financial?tab=budgets');
  await page.getByRole('button', { name: 'Add Budget', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create Budget', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-select-field]').first().locator('button').first().click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.getByRole('listbox').screenshot({ path: info.outputPath('select-options.png') });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0); await expect(dialog).toBeVisible();
  const category = selectField(dialog, 'Category');
  await category.getByRole('combobox').fill('insur');
  await expect(page.getByRole('option', { name: 'Insurance', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Utilities', exact: true })).toHaveCount(0);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(category).toHaveAttribute('data-value', 'INSURANCE');
  await expect(category.getByRole('combobox')).toHaveValue('Insurance');
  await chooseOption(selectField(dialog, 'Budget Period'), 'Quarterly');
  const calendarTrigger = dialog.getByRole('button', { name: 'Choose start date', exact: true });
  await calendarTrigger.click();
  const calendar = page.getByRole('dialog', { name: 'Choose start date', exact: true });
  await expect(calendar.getByRole('grid')).toBeVisible();
  await selectField(calendar, 'Calendar month').getByRole('button').click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(calendar).toBeVisible();
  await page.keyboard.press('Escape'); await expect(calendar).toHaveCount(0);
  await expect(calendarTrigger).toBeFocused(); await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Start Date', exact: true }).fill('2024-02-29');
  await dialog.getByRole('textbox', { name: 'End Date', exact: true }).fill('2024-02-30');
  await dialog.getByRole('textbox', { name: 'End Date', exact: true }).blur();
  await expect(dialog.getByRole('alert')).toContainText('Enter a valid date');
  await dialog.getByRole('textbox', { name: 'End Date', exact: true }).fill('');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await dialog.screenshot({ path: info.outputPath('budget-dialog.png') });
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
});

test('date ranges and additional filters commit only on Apply', async ({ page }, info) => {
  await login(page, 'owner@example.test'); await page.goto('/insights/reports/sales');
  const initial = page.url();
  await page.getByRole('button', { name: /^Sales dates:/ }).click();
  const dates = page.getByRole('dialog', { name: 'Sales dates', exact: true });
  await dates.getByRole('textbox', { name: 'From date', exact: true }).fill('2024-02-29');
  await dates.getByRole('textbox', { name: 'Through date', exact: true }).fill('2024-02-28');
  await expect(dates.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await expect(page).toHaveURL(initial);
  await dates.getByRole('textbox', { name: 'Through date', exact: true }).fill('2024-03-01');
  await dates.screenshot({ path: info.outputPath('date-range-picker.png') });
  await dates.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL(initial);
  await page.getByRole('button', { name: /^Filters/ }).click();
  const filters = page.getByRole('dialog', { name: 'Sales Filters', exact: true });
  await expect(filters).toBeVisible();
  await filters.getByRole('button', { name: 'Status', exact: true }).click();
  await filters.getByRole('button', { name: 'Completed', exact: true }).click();
  await expect(page).toHaveURL(initial);
  await filters.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL(initial);
  await page.getByRole('button', { name: /^Filters/ }).click();
  await filters.getByRole('button', { name: 'Status', exact: true }).click();
  await filters.getByRole('button', { name: 'Completed', exact: true }).click();
  await filters.getByRole('button', { name: 'Apply filters', exact: true }).click();
  expect(JSON.parse(new URL(page.url()).searchParams.get('salesFilters')!)).toMatchObject({ status: ['COMPLETED'] });
  const beforeClear = await page.getByRole('button', { name: /^Sales dates:/ }).textContent();
  await page.getByRole('button', { name: 'Remove Status: Completed', exact: true }).click();
  expect(JSON.parse(new URL(page.url()).searchParams.get('salesFilters')!)).toMatchObject({ status: [] });
  await expect(page.getByRole('button', { name: /^Sales dates:/ })).toHaveText(beforeClear!);
  await page.getByRole('button', { name: /^Sales dates:/ }).click();
  await dates.getByRole('textbox', { name: 'From date', exact: true }).fill('2024-02-29');
  await dates.getByRole('textbox', { name: 'Through date', exact: true }).fill('2024-03-01');
  await dates.getByRole('button', { name: 'Apply', exact: true }).click();
  const applied = new URL(page.url()).searchParams.get('salesFilters')!;
  expect(JSON.parse(applied)).toMatchObject({ startDate: '2024-02-29', endDate: '2024-03-01' });
  const selectedPeriodUrl = page.url();
  await openMenuSection(page, 'Money & reports');
  await page.getByRole('link', { name: 'Finances', exact: true }).filter({ visible: true }).click();
  await expect(page.getByRole('heading', { name: 'Finances', exact: true })).toBeVisible();
  await page.goBack(); await expect(page).toHaveURL(selectedPeriodUrl);
  await expect(page.getByRole('button', { name: /^Sales dates:/ })).toContainText('Feb 29, 2024');
  await page.goForward(); await expect(page).toHaveURL(/\/financial$/);
});

test('required selections and invalid dates prevent submitting a dialog', async ({ page }) => {
  await login(page, 'owner@example.test'); await page.goto('/financial?tab=budgets');
  let submitted = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/budgets')) submitted++; });
  await page.getByRole('button', { name: 'Add Budget', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create Budget', exact: true });
  await dialog.getByPlaceholder('0.00', { exact: true }).fill('150');
  await dialog.getByRole('button', { name: 'Create Budget', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Choose category');
  expect(submitted).toBe(0);
  await chooseOption(selectField(dialog, 'Category'), 'Rent');
  await dialog.getByRole('textbox', { name: 'End Date', exact: true }).fill('2024-02-30');
  await dialog.getByRole('button', { name: 'Create Budget', exact: true }).click();
  expect(submitted).toBe(0);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
});

for (const viewport of [{ name: 'laptop', width: 1366, height: 768 }, { name: 'phone', width: 390, height: 844 }, { name: 'zoom200', width: 683, height: 384 }]) {
  test(`open controls fit ${viewport.name} in both themes`, async ({ page }, info) => {
    await page.setViewportSize(viewport); await login(page, 'owner@example.test');
    for (const dark of [false, true]) {
      await page.evaluate(value => localStorage.setItem('theme', value ? 'dark' : 'light'), dark);
      await page.goto('/insights/reports/sales');
      await expect(page.locator('html')).toHaveClass(dark ? /dark/ : /^(?!.*dark)/);
      await page.getByRole('button', { name: /^Sales dates:/ }).click();
      const picker = page.getByRole('dialog', { name: 'Sales dates', exact: true });
      await expect(picker.getByRole('grid')).toHaveCount(viewport.width < 640 ? 1 : 2);
      const popover = page.locator('.date-range-popover');
      const bounds = await popover.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(await popover.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      // Footer actions stay visible even when the calendar itself needs scrolling.
      await expect(picker.getByRole('button', { name: 'Apply', exact: true })).toBeInViewport();
      await page.screenshot({ path: info.outputPath(`${viewport.name}-${dark ? 'dark' : 'light'}-range.png`) });
      await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      for (const native of await page.locator('select, input[type=date], input[type=month], input[type=datetime-local]').all()) await expect(native).not.toBeVisible();
      await page.goto('/financial');
      const search = page.getByPlaceholder('Search by expense #, description, vendor, or invoice...', { exact: true });
      await expect(search).toBeVisible();
      expect((await search.boundingBox())!.width).toBeGreaterThanOrEqual(200);
      await page.screenshot({ path: info.outputPath(`${viewport.name}-${dark ? 'dark' : 'light'}-expenses.png`) });
      await page.goto('/financial?tab=budgets');
      await page.getByRole('button', { name: 'Add Budget', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Create Budget', exact: true });
      await expect(page.locator('html')).toHaveClass(dark ? /dark/ : /^(?!.*dark)/);
      await expect(dialog.getByRole('button', { name: 'Create Budget', exact: true })).toBeInViewport();
      const endDate = dialog.getByRole('textbox', { name: 'End Date', exact: true });
      await endDate.focus();
      await expect.poll(async () => endDate.evaluate(input => {
        const field = input.getBoundingClientRect(), body = input.closest('.dialog-body')!.getBoundingClientRect();
        return field.top >= body.top && field.bottom <= body.bottom;
      })).toBe(true);
      await page.screenshot({ path: info.outputPath(`${viewport.name}-${dark ? 'dark' : 'light'}-dialog.png`) });
      await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
    }
  });
}

test('an unfinished calendar range cannot replace the current report period', async ({ page }) => {
  await login(page, 'owner@example.test'); await page.goto('/insights/reports/sales');
  const initial = page.url();
  await page.getByRole('button', { name: /^Sales dates:/ }).click();
  const picker = page.getByRole('dialog', { name: 'Sales dates', exact: true });
  await picker.locator('.calendar-day:not([data-outside-month]):not([data-disabled])').first().click();
  await expect(picker.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await expect(picker.getByRole('status')).toContainText('Now choose the last day');
  await expect(page).toHaveURL(initial);
  await picker.locator('.calendar-day:not([data-outside-month]):not([data-disabled])').nth(3).click();
  await expect(picker.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
  await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL(initial);
});

test.describe('store calendar defaults', () => {
  test.use({ timezoneId: 'Pacific/Kiritimati' });
  test('forms and presets use the store day across a year boundary', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-01-01T01:00:00Z'));
    await login(page, 'owner@example.test');
    await page.goto('/financial?tab=budgets');
    await page.getByRole('button', { name: 'Add Budget', exact: true }).click();
    const budget = page.getByRole('dialog', { name: 'Create Budget', exact: true });
    await expect(budget.getByRole('textbox', { name: 'Start Date', exact: true })).toHaveValue('Dec 31, 2025');
    await page.keyboard.press('Escape');
    await page.goto('/financial?tab=recurring');
    await page.getByRole('button', { name: 'Add Recurring Expense', exact: true }).click();
    const recurring = page.getByRole('dialog', { name: 'Add Recurring Expense', exact: true });
    await expect(recurring.getByRole('textbox', { name: 'Next Due Date', exact: true })).toHaveValue('Dec 31, 2025');
    await page.keyboard.press('Escape');
    await page.goto('/lottery');
    await expect(page.getByRole('textbox', { name: 'Business date', exact: true })).toHaveValue('Dec 31, 2025');
    await expect(page.locator('input[type=date]')).toHaveCount(0);
    await page.goto('/insights/reports/exports');
    await expect(page.getByRole('button', { name: /^Scan data dates:/ })).toContainText('Dec 22, 2025');
    await page.goto('/insights/reports/sales');
    await page.getByRole('button', { name: /^Sales dates:/ }).click();
    await page.getByRole('dialog', { name: 'Sales dates', exact: true }).getByRole('button', { name: 'Today', exact: true }).click();
    expect(JSON.parse(new URL(page.url()).searchParams.get('salesFilters')!)).toMatchObject({ startDate: '2025-12-31', endDate: '2025-12-31' });
  });
});
