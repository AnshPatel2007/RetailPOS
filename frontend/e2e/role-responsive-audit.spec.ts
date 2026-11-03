import { test, expect, type Page } from '@playwright/test';
import { login } from './utils/auth-helper';

const operations = ['/dashboard', '/inventory', '/customers', '/customers/insights', '/customers/accounts/gift-cards',
  '/customers/accounts/store-credits', '/customers/accounts/house-accounts', '/team-time/shifts', '/financial',
  '/inventory/purchasing/orders', '/inventory/purchasing/suppliers', '/inventory/purchasing/suggestions',
  '/inventory/stock-control/transfers', '/inventory/stock-control/counts', '/inventory/stock-control/movements',
  '/promotions', '/audit-log', '/settings'];
const roles = [
  { name: 'owner', email: 'owner@example.test', paths: [...operations, '/team-time/staff', '/team-time/payroll', '/financial/reconciliation', '/settings/jobs', '/insights/reports/sales'], denied: ['/admin/users'] },
  { name: 'manager', email: 'manager@example.test', paths: [...operations, '/insights/reports/sales'], denied: ['/team-time/payroll', '/team-time/staff', '/financial/reconciliation', '/settings/jobs'] },
  { name: 'cashier', email: 'cashier@example.test', paths: ['/dashboard', '/pos', '/customers', '/my-shift', '/lottery', '/settings'], denied: ['/inventory', '/financial', '/customers/insights', '/customers/accounts/gift-cards', '/team-time/payroll', '/settings/jobs'] },
  { name: 'platform', email: 'platform@example.test', paths: ['/admin', '/admin/stores', '/admin/users', '/admin/integrations', '/settings/jobs'], denied: ['/team-time/payroll', '/team-time/staff', '/financial/reconciliation', '/insights/reports/sales'] },
];
async function inspect(page: Page, path: string, dark: boolean) {
  await page.goto(path);
  const content = path === '/pos' ? page.locator('#root') : page.getByRole('main');
  await expect(content).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark);
  await expect(page.getByText('Access Denied', { exact: true })).toHaveCount(0);
  if (path === '/pos') await expect(page.getByRole('button', { name: 'Back to Dashboard', exact: true })).toBeVisible();
  else {
    const heading = content.locator('.page-header h1');
    await expect(heading).toHaveCount(1);
    await expect(heading).toBeVisible();
    await expect(heading).toHaveCSS('font-size', '24px');
    await expect(content.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(content.getByRole('button', { name: /^Refresh(?: |$)/ })).toHaveCount(0);
    for (const button of await content.locator('.page-actions .app-button[data-control-size="standard"]').all()) {
      if (await button.isVisible()) {
        const height = await button.evaluate(element => element.getBoundingClientRect().height);
        expect(height, 'Action size: ' + path).toBe((page.viewportSize()?.width || 0) < 640 ? 44 : 36);
        await expect(button).toHaveCSS('font-size', '14px');
      }
    }
    for (const navigation of await content.locator('.page-header .page-tabs').all()) {
      expect(await navigation.evaluate(element => element.getBoundingClientRect().top)).toBeGreaterThan(await heading.evaluate(element => element.getBoundingClientRect().top));
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Horizontal page overflow: ' + path).toBe(true);
  if ((page.viewportSize()?.width || 0) < 500) expect(await content.evaluate(element => element.getBoundingClientRect().width), 'Phone content width: ' + path).toBeGreaterThanOrEqual(320);
  for (const button of await content.getByRole('button').all()) await expect(button, 'Unnamed control: ' + path).toHaveAccessibleName(/\S/);
}

for (const role of roles) for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'tablet', width: 768, height: 1024 }, { name: 'phone', width: 390, height: 844 }]) for (const dark of [false, true]) {
  const phone = viewport.name === 'phone';
  test(`${role.name} retained screens: ${viewport.name} ${dark ? 'dark' : 'light'}`, async ({ page }, testInfo) => {
    test.setTimeout(120000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await login(page, role.email);
    for (const path of role.paths) {
      await inspect(page, path, dark);
      if (['/inventory', '/financial', '/promotions', '/admin/stores'].includes(path)) await page.screenshot({ path: testInfo.outputPath(path.replaceAll('/', '-') + '.png'), fullPage: true, animations: 'disabled' });
    }
    if (role.name === 'platform') {
      await page.goto('/admin/stores');
      await page.getByRole('cell', { name: 'Store A Tax Rate: 10%', exact: true }).click();
      await page.getByRole('button', { name: 'Preview store', exact: true }).click();
      for (const path of ['/inventory', '/promotions', '/customers/accounts/house-accounts', '/financial', '/inventory/stock-control/counts', '/settings']) {
        await inspect(page, path, dark);
        await expect(page.getByRole('button', { name: /^(Add Product|Import CSV|Scan Receipt|New Promotion|Open Account|Add Expense|New Count)$/ })).toHaveCount(0);
      }
    }
    for (const path of role.denied) {
      await page.goto(path); await expect(page.getByText('Access Denied', { exact: true })).toBeVisible();
    }
    if (phone && role.name !== 'platform') {
      await page.goto('/customers');
      const menu = page.getByRole('button', { name: 'Open menu', exact: true });
      await menu.click(); const drawer = page.getByRole('dialog', { name: 'Main menu', exact: true });
      await expect(drawer).toBeVisible(); await page.keyboard.press('Escape');
      await expect(drawer).toHaveCount(0); await expect(menu).toBeFocused();
    }
    if (phone && role.name === 'platform') {
      await page.goto('/admin');
      const menu = page.getByRole('button', { name: 'Open admin menu', exact: true });
      await menu.click(); const drawer = page.getByRole('dialog', { name: 'Admin menu', exact: true });
      await expect(drawer).toBeVisible(); await page.keyboard.press('Escape');
      await expect(drawer).toHaveCount(0); await expect(menu).toBeFocused();
    }
    expect(errors).toEqual([]);
  });
}
