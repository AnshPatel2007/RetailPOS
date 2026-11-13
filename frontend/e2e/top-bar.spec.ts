import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';
import { NEW_LOOK } from './utils/look';

/**
 * The New look's menu is a bar across the top (components/common/TopBar.tsx).
 * Run with: E2E_LOOK=new node scripts/verify-pos.cjs browser e2e/top-bar.spec.ts --project=chromium
 */
test.skip(!NEW_LOOK, 'The top bar belongs to the New look: run with E2E_LOOK=new');

test('the top bar groups pages into drop-downs, marks where you are and leaves pages the full width', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await login(page, 'owner@example.test');
  const bar = page.getByRole('navigation', { name: 'Main' });
  await expect(bar.getByRole('link', { name: 'Dashboard', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(bar.getByRole('link', { name: 'POS', exact: true })).toBeVisible();
  // No side menu: the page starts at the left edge and spans the screen.
  const main = (await page.getByRole('main').boundingBox())!;
  expect(main.x).toBe(0);
  expect(main.width).toBe(1366);

  // A section drops down; choosing a page goes there and lights the section up.
  const products = bar.getByRole('button', { name: 'Products', exact: true });
  await products.click();
  const menu = page.getByRole('menu', { name: 'Products', exact: true });
  await expect(menu.getByRole('menuitem')).toHaveText([/^Products/, /^Purchasing/, /^Stock Control/, /^Promotions/]);
  await menu.getByRole('menuitem', { name: /^Purchasing/ }).click();
  await expect(page).toHaveURL(/\/inventory\/purchasing\/orders$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Purchasing');
  await expect(products).toHaveAttribute('data-current', 'true');
  await expect(bar.getByRole('link', { name: 'Dashboard', exact: true })).not.toHaveAttribute('aria-current', 'page');

  // On a 1366px laptop the menu never runs under the tools on the right.
  const last = (await bar.locator('.app-topbar-link').last().boundingBox())!;
  const toolsBox = (await page.locator('.app-topbar-tools').boundingBox())!;
  expect(last.x + last.width).toBeLessThanOrEqual(toolsBox.x);
  expect(toolsBox.x + toolsBox.width).toBeLessThanOrEqual(1366);

  // From a small laptop (or 125% zoom) up, the whole menu shows without scrolling and nothing overlaps.
  for (const width of [1024, 1093, 1280, 1366, 1440, 1920]) {
    await page.setViewportSize({ width, height: 768 });
    expect(await page.locator('.app-topbar-nav').evaluate(element => element.scrollWidth <= element.clientWidth), `menu fits at ${width}px`).toBe(true);
    const edge = (await page.locator('.app-topbar-tools').boundingBox())!;
    expect(edge.x + edge.width, `tools on screen at ${width}px`).toBeLessThanOrEqual(width);
    await expect(bar.getByRole('button', { name: 'Store', exact: true })).toBeInViewport();
    await expect(page.locator('.app-topbar-tools').getByRole('button', { name: 'Logout', exact: true })).toBeInViewport();
  }
  await page.setViewportSize({ width: 1366, height: 768 });

  // Escape closes a menu.
  await bar.getByRole('button', { name: 'Money', exact: true }).click();
  await expect(page.getByRole('menu', { name: 'Money', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);

  // Quick find, the theme and sign-out are one click away in the bar.
  await page.getByRole('button', { name: 'Find a page', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Quick find', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  const tools = page.locator('.app-topbar-tools');
  await expect(tools.getByRole('button', { name: 'Toggle theme', exact: true })).toBeVisible();
  await tools.getByRole('button', { name: 'Logout', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('a cashier gets a short plain row, and the platform administrator gets the admin pages', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await login(page, 'cashier@example.test');
  await page.goto('/customers');
  const bar = page.getByRole('navigation', { name: 'Main' });
  await expect(bar.getByRole('link')).toHaveText(['Dashboard', 'POS', 'Lottery', 'My Shift', 'Customers', 'Settings']);
  await expect(bar.getByRole('button')).toHaveCount(0);
  await expect(bar.getByRole('link', { name: 'Customers', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.locator('.app-topbar-tools').getByRole('button', { name: 'Logout', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);

  await login(page, 'platform@example.test');
  const admin = page.getByRole('navigation', { name: 'Admin' });
  await expect(admin.getByRole('link')).toHaveText(['Dashboard', 'Stores', 'Users', 'Integrations']);
  await admin.getByRole('link', { name: 'Stores', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/stores$/);
  await expect(admin.getByRole('link', { name: 'Stores', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('on a phone the bar keeps a menu button, and the drawer holds the pages, the look switch and sign-out', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'owner@example.test');
  await page.goto('/inventory');
  await expect(page.getByRole('navigation', { name: 'Main' }).filter({ visible: true })).toHaveCount(0);
  // The bar fits the screen: nothing is pushed off the right edge.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('.app-topbar').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(page.locator('.app-topbar [data-sidebar-store-name]')).toHaveText('Store A');

  const open = page.getByRole('button', { name: 'Open menu', exact: true });
  await open.click();
  const drawer = page.getByRole('dialog', { name: 'Main menu', exact: true });
  await expect(drawer.getByRole('link', { name: 'Products', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(drawer.getByRole('group', { name: 'Look' }).getByRole('button', { name: 'New', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(drawer.getByRole('button', { name: 'Logout', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(open).toBeFocused();
});
