import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';

const views: [string, string][] = [
  ...['summary', 'comparison', 'forecast', 'whatif', 'health', 'anomalies'].map(view => ['/insights/reports/overview?view=' + view, 'Reports & Analysis'] as [string, string]),
  ...['stock-health', 'catalog', 'abc', 'products', 'predictions', 'bundles'].map(view => ['/insights/reports/inventory?view=' + view, 'Reports & Analysis'] as [string, string]),
  ...['sales', 'performance'].map(view => ['/insights/reports/staff?view=' + view, 'Reports & Analysis'] as [string, string]),
  ['/insights/reports/sales', 'Reports & Analysis'], ['/insights/reports/exports', 'Reports & Analysis'],
  ...['expenses', 'budgets', 'recurring', 'pnl'].map(tab => ['/financial?tab=' + tab, 'Financial Management'] as [string, string]),
  ...['profile', 'store', 'payments', 'receipts', 'notifications', 'devices'].map(section => ['/settings?section=' + section, 'Settings'] as [string, string]),
  ...['daily', 'reports', 'ticketTypes'].map(tab => ['/lottery?tab=' + tab, 'Lottery'] as [string, string]),
  ...['corrections', 'legacy', 'history'].map(view => ['/financial/reconciliation?view=' + view, 'Reconciliation'] as [string, string]),
  ['/customers/insights?analysis=overview', 'Customer Insights'], ['/customers/insights?analysis=segments', 'Customer Insights'],
];

for (const width of [1440, 768, 390]) for (const dark of [false, true]) {
  test(`nested views keep shared controls: ${width}px ${dark ? 'dark' : 'light'}`, async ({ page }, info) => {
    test.setTimeout(180000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: width < 640 ? 844 : 1000 });
    await login(page, 'owner@example.test');
    for (const [path, title] of views) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark);
      const main = page.getByRole('main');
      const heading = main.getByRole('heading', { level: 1 });
      await expect(heading, path).toHaveCount(1);
      await expect(heading, path).toHaveText(title);
      await expect(heading).toHaveCSS('font-size', '24px');
      await expect(main.getByRole('combobox', { name: 'Analysis view', exact: true })).toHaveCount(0);
      await expect(main.getByRole('button', { name: /^Refresh(?: |$)|^Ask AI$/ })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), path).toBe(true);
      for (const button of await main.locator('.page-header .page-tab, .page-actions .app-button[data-control-size="standard"]').all()) {
        if (!await button.isVisible()) continue;
        await expect(button).toHaveCSS('font-size', '14px');
        expect(await button.evaluate(element => element.getBoundingClientRect().height), path).toBe(width < 640 ? 44 : 36);
        await expect(button).toHaveAccessibleName(/\S/);
      }
      if (['/insights/reports/overview?view=summary', '/insights/reports/exports', '/financial?tab=budgets'].includes(path)) {
        await page.screenshot({ path: info.outputPath(path.replaceAll(/[/?=]/g, '-') + '.png'), animations: 'disabled' });
      }
    }
    expect(errors).toEqual([]);
  });
}

test('financial dialogs share keyboard behavior and tab navigation survives Back', async ({ page }, info) => {
  await login(page, 'owner@example.test');
  await page.goto('/financial');
  await page.getByRole('button', { name: 'Budgets', exact: true }).click();
  const addBudget = page.locator('.page-actions').getByRole('button', { name: 'Add Budget', exact: true });
  await addBudget.click();
  const budget = page.getByRole('dialog', { name: 'Create Budget', exact: true });
  await expect(budget).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open POS assistant', exact: true })).toBeDisabled();
  await budget.screenshot({ path: info.outputPath('budget-dialog.png') });
  await page.keyboard.press('Escape');
  await expect(budget).toHaveCount(0);
  await expect(addBudget).toBeFocused();
  await page.getByRole('button', { name: 'Recurring', exact: true }).click();
  await page.locator('.page-actions').getByRole('button', { name: 'Add Recurring Expense', exact: true }).click();
  const recurring = page.getByRole('dialog', { name: 'Add Recurring Expense', exact: true });
  await expect(recurring).toBeVisible();
  await recurring.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Budgets', exact: true })).toHaveAttribute('aria-current', 'page');
});
