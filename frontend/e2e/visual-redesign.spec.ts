import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';

test('navigation levels stay consistent across views and calendars keep their footer visible', async ({ page }, info) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await login(page, 'owner@example.test');
  await page.goto('/inventory/purchasing/orders');
  const tabs = page.getByRole('navigation', { name: /Purchasing views$/ });
  const before = await tabs.getByRole('link', { name: 'Orders', exact: true }).evaluate(element => {
    const style = getComputedStyle(element); return [style.backgroundColor, style.borderColor, style.height];
  });
  await tabs.getByRole('link', { name: 'Suppliers', exact: true }).click();
  const after = await tabs.getByRole('link', { name: 'Suppliers', exact: true }).evaluate(element => {
    const style = getComputedStyle(element); return [style.backgroundColor, style.borderColor, style.height];
  });
  expect(after).toEqual(before);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/insights/reports/sales');
  await page.getByRole('button', { name: /^Sales dates:/ }).click();
  const picker = page.getByRole('dialog', { name: 'Sales dates', exact: true });
  await expect(picker.getByRole('button', { name: 'Today', exact: true })).toBeInViewport();
  await expect(picker.getByRole('button', { name: 'Apply', exact: true })).toBeInViewport();
  await expect(picker.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
  expect(await page.locator('.date-range-popover').evaluate(element => element.scrollTop)).toBe(0);
  await page.screenshot({ path: info.outputPath('phone-calendar-footer.png') });
});

for (const dark of [false, true]) test(`redesigned workspaces fit laptops and 200% viewport: ${dark ? 'dark' : 'light'}`, async ({ page }, info) => {
  test.setTimeout(120000);
  await login(page, 'owner@example.test');
  await page.evaluate(value => localStorage.setItem('theme', value ? 'dark' : 'light'), dark);
  // 683 x 384 CSS pixels is the layout viewport of a 1366 x 768 display at 200%.
  for (const size of [{ width: 1366, height: 768 }, { width: 683, height: 384 }]) {
    await page.setViewportSize(size);
    for (const path of ['/dashboard', '/inventory', '/customers', '/financial?tab=pnl', '/team-time/payroll', '/settings', '/audit-log']) {
      await page.goto(path); await page.waitForLoadState('networkidle');
      await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), path).toBe(true);
      await page.screenshot({ path: info.outputPath(`${size.width}-${path.replaceAll(/[/?=]/g, '-')}.png`), animations: 'disabled' });
    }
  }
});

test.describe('touch register', () => {
  test.use({ hasTouch: true });
  test('wide touch controls and nested cart quantity dialog retain usable targets and focus', async ({ page }, info) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await login(page, 'cashier@example.test'); await page.goto('/pos');
    await page.getByPlaceholder('Search products... (/ or F3)', { exact: true }).fill('Fixture Coffee');
    await page.getByRole('button', { name: /^Fixture Coffee/ }).click();
    const cart = page.locator('[data-sale-cart]').filter({ visible: true });
    const plus = cart.getByRole('button', { name: 'Increase quantity', exact: true });
    expect((await plus.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.setViewportSize({ width: 820, height: 900 });
    const launcher = page.getByRole('button', { name: 'Open sale cart', exact: true });
    await launcher.click();
    const quantity = page.getByRole('button', { name: 'Change quantity for Fixture Coffee', exact: true });
    await quantity.click();
    const dialog = page.getByRole('dialog', { name: 'Quantity for Fixture Coffee', exact: true });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Current Sale', exact: true })).toBeVisible();
    await expect(quantity).toBeFocused();
    await page.screenshot({ path: info.outputPath('tablet-cart-sheet.png') });
    await page.keyboard.press('Escape'); await expect(launcher).toBeFocused();
  });
});

test('customer display keeps the live total visible in both themes', async ({ page }, info) => {
  await login(page, 'cashier@example.test');
  await page.goto('/customer-display');
  await expect(page.getByText('Welcome!', { exact: true })).toBeVisible();
  // Broadcast display-only values; this does not create a sale or change stock.
  await page.evaluate(() => {
    const channel = new BroadcastChannel('pos-customer-display');
    channel.postMessage({ storeName: 'A&P Food and Liquor', lines: [
      { name: 'Coffee', quantity: 2, lineTotal: 8 },
      { name: 'Water', quantity: 1, lineTotal: 2 },
    ], subtotal: 10, tax: 1, total: 11, promoSavings: 0 });
    channel.close();
  });
  await expect(page.getByText('Coffee', { exact: true })).toBeVisible();
  for (const width of [1366, 390]) for (const dark of [false, true]) {
    await page.setViewportSize({ width, height: 768 });
    await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark);
    const total = page.locator('.customer-totals').getByText('$11.00', { exact: true });
    await expect(total).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const amount = (await total.boundingBox())!, assistant = (await page.getByRole('button', { name: 'Open POS assistant' }).boundingBox())!;
    expect(amount.y + amount.height).toBeLessThanOrEqual(assistant.y);
    await page.screenshot({ path: info.outputPath(`customer-display-${width}-${dark ? 'dark' : 'light'}.png`) });
  }
});
