import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';
import { openMenuSection } from './utils/menu-helper';
import { chooseOption, selectField } from './utils/select-helper';

test('the menu is grouped by job and quick-find reaches tabs, settings and records', async ({ page }) => {
  await login(page, 'owner@example.test');
  const menu = page.getByRole('navigation', { name: 'Main' }).filter({ visible: true });
  // Sections in the order the work happens; each folds open to show its pages, one at a time.
  const sections: [string, string[]][] = [['Products', ['Purchasing', 'Stock Control', 'Promotions']], ['Customers', ['Gift Cards & Accounts']], ['Money & reports', ['Finances', 'Reports']], ['Store', ['Team & Time', 'Audit Log', 'Settings']]];
  for (const [title, links] of sections) {
    await openMenuSection(page, title as 'Products');
    for (const link of links) await expect(menu.getByRole('link', { name: link, exact: true })).toBeVisible();
    for (const [other] of sections.filter(([name]) => name !== title)) await expect(menu.getByRole('button', { name: other, exact: true })).toHaveAttribute('aria-expanded', 'false');
  }
  // The section holding the current page opens by itself.
  await page.goto('/inventory/purchasing/orders');
  await expect(menu.getByRole('button', { name: 'Products', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(menu.getByRole('link', { name: 'Purchasing', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(menu.getByRole('link', { name: 'Products', exact: true })).not.toHaveAttribute('aria-current', 'page');

  // Keyboard: Ctrl+K, type, Enter.
  await page.keyboard.press('Control+k');
  const finder = page.getByRole('dialog', { name: 'Quick find' });
  await expect(finder).toBeVisible();
  await page.keyboard.type('p&l');
  await expect(finder.getByRole('option').first()).toContainText('Profit & loss');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/financial\?tab=pnl$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Finances');
  await expect(page.getByRole('button', { name: 'Profit & Loss', exact: true })).toHaveAttribute('aria-current', 'page');

  // Synonyms find settings; the mouse works too.
  await page.getByRole('button', { name: 'Find a page' }).filter({ visible: true }).click();
  await page.keyboard.type('printer');
  await finder.getByRole('option', { name: /Devices/ }).click();
  await expect(page).toHaveURL(/\/settings\?section=devices$/);

  // A word that names no page becomes a product search.
  await page.keyboard.press('Control+k');
  await page.keyboard.type('Fixture Coffee');
  await finder.getByRole('option', { name: /Find products matching/ }).click();
  await expect(page).toHaveURL(/\/inventory$/);
  await expect(page.getByLabel('Search products')).toHaveValue('Fixture Coffee');
});

test('cashiers get a short plain menu and denied pages keep it', async ({ page }) => {
  await login(page, 'cashier@example.test');
  const menu = page.getByRole('navigation', { name: 'Main' }).filter({ visible: true });
  await expect(menu.getByRole('link')).toHaveText(['Dashboard', 'POS', 'Lottery', 'My Shift', 'Customers', 'Settings']);
  await expect(menu.getByText('Money & reports', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Control+k');
  await page.keyboard.type('payroll');
  await expect(page.getByRole('dialog', { name: 'Quick find' }).getByRole('option', { name: 'Payroll', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.goto('/financial');
  await expect(page.getByRole('heading', { name: 'Access Denied', exact: true })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'POS', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Go to Dashboard', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto('/no-such-page');
  await expect(page.getByRole('heading', { name: 'Page not found', exact: true })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible();
});

test('platform owners open and switch stores from the menu', async ({ page }) => {
  await login(page, 'platform@example.test');
  await chooseOption(selectField(page, 'Open a store'), 'Store A');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText('Viewing: Store A', { exact: true })).toBeVisible();
  await page.goto('/inventory');
  await chooseOption(selectField(page, 'Switch store').filter({ visible: true }), 'Store B');
  await expect(page).toHaveURL(/\/inventory$/);
  await expect(page.getByText('Viewing: Store B', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell').filter({ has: page.getByText('Fixture Received', { exact: true }) })).toBeVisible();
  await page.getByRole('button', { name: 'Exit View', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
});
