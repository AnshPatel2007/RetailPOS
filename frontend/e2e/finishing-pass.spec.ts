import { test, expect, Page } from '@playwright/test';
import { login } from './utils/auth-helper';
import { expectStockExceptionNote } from './utils/menu-helper';
import { saleComplete } from './utils/sale-complete';

const auth = async (page: Page) => ({ Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token')) });
const exceptionBadge = (page: Page) => page.locator('.page-tab-badge');
const badgeCount = async (page: Page) => (await exceptionBadge(page).count()) ? Number(await exceptionBadge(page).textContent()) : 0;

test('on a phone the menu drawer folds into sections, one open at a time, and opens where you are', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'owner@example.test');
  const openDrawer = async () => {
    await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    return page.getByRole('dialog', { name: 'Main menu', exact: true }).getByRole('navigation', { name: 'Main' });
  };
  let menu = await openDrawer();
  const heading = (title: string) => menu.getByRole('button', { name: title, exact: true });
  // Always-visible pages stay; folded sections hide theirs until opened.
  await expect(menu.getByRole('link', { name: 'POS', exact: true })).toBeVisible();
  if (await heading('Products').getAttribute('aria-expanded') !== 'true') await heading('Products').click();
  await expect(menu.getByRole('link', { name: 'Purchasing', exact: true })).toBeVisible();
  await heading('Store').click();
  await expect(heading('Products')).toHaveAttribute('aria-expanded', 'false');
  await expect(menu.getByRole('link', { name: 'Purchasing', exact: true })).toBeHidden();
  await expect(menu.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
  await heading('Store').click();
  await expect(heading('Store')).toHaveAttribute('aria-expanded', 'false');
  await page.screenshot({ path: info.outputPath('menu-folded.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await page.goto('/financial');
  menu = await openDrawer();
  await expect(heading('Money & reports')).toHaveAttribute('aria-expanded', 'true');
  await expect(menu.getByRole('link', { name: 'Finances', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('the stock exception count changes as soon as a sale oversells and as soon as it is resolved', async ({ page }) => {
  await login(page, 'owner@example.test');
  const name = `Live badge soda ${Date.now()}`;
  const created = await page.request.post('/api/products', { headers: await auth(page), data: {
    name, sku: name.replaceAll(' ', '-'), barcode: String(Date.now()), price: 2.5, cost: 1.5, stockQuantity: 0, isTaxable: false, trackInventory: true,
  } });
  expect(created.status()).toBe(201);
  await page.goto('/inventory/stock-control/exceptions');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Stock Control');
  const before = await badgeCount(page);

  // The badge sits on the tab's corner: the tab keeps the height of its neighbours.
  const tabs = page.getByRole('navigation', { name: 'Inventory / Stock Control views' });
  const exceptionsTab = tabs.getByRole('link', { name: /^Exceptions/ });
  const countsTab = tabs.getByRole('link', { name: 'Counts', exact: true });

  // A sale in another window of this browser drives the item below zero.
  const register = await page.context().newPage();
  await register.goto('/pos');
  await register.getByPlaceholder('Search products... (/ or F3)', { exact: true }).fill(name);
  await register.getByRole('button', { name: new RegExp('^' + name) }).click();
  await register.getByRole('button', { name: 'Charge $2.50', exact: true }).click();
  const payment = register.getByRole('dialog', { name: 'Payment', exact: true });
  await payment.getByRole('button', { name: 'Exact', exact: true }).click();
  const saved = register.waitForResponse(response => response.url().endsWith('/api/sales') && response.request().method() === 'POST');
  await payment.getByRole('button', { name: 'Charge $2.50', exact: true }).click();
  expect((await saved).status()).toBe(201);
  await register.close();

  // No navigation or reload: the count goes up by itself.
  await expect.poll(() => badgeCount(page), { timeout: 10000 }).toBe(before + 1);
  await expect(exceptionBadge(page)).toHaveCSS('position', 'absolute');
  expect(Math.round((await exceptionsTab.boundingBox())!.height)).toBe(Math.round((await countsTab.boundingBox())!.height));
  const sentence = new RegExp('^' + (before + 1) + ' inventory exceptions? needs? review$');
  await expectStockExceptionNote(page, sentence);

  // Resolving it brings the count straight back down.
  await page.reload();
  const row = page.getByRole('row').filter({ hasText: name });
  await row.click();
  await page.getByRole('dialog', { name: /Inventory discrepancy/ }).getByRole('button', { name: 'Resolve discrepancy', exact: true }).click();
  const resolve = page.getByRole('dialog', { name: 'Resolve discrepancy: ' + name, exact: true });
  await resolve.getByText("I counted it / I'm not sure why", { exact: true }).click();
  await resolve.getByLabel(new RegExp('How many ' + name)).fill('0');
  await resolve.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => badgeCount(page), { timeout: 10000 }).toBe(before);

  // The top bar's Products menu still says that something needs review.
  if (before > 0) {
    await page.goto('/dashboard');
    await expectStockExceptionNote(page, /inventory exceptions? needs? review$/);
  }
});

test('dark mode is pure black on management pages and the register', async ({ page }, info) => {
  await login(page, 'owner@example.test');
  await page.getByRole('button', { name: 'Toggle theme', exact: true }).filter({ visible: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.locator('.management-content')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await page.screenshot({ path: info.outputPath('dashboard-dark.png'), animations: 'disabled' });
  await page.goto('/pos');
  await expect(page.locator('.pos-workspace')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await page.screenshot({ path: info.outputPath('register-dark.png'), animations: 'disabled' });
});

test('in dark mode, Payment keeps orange for the field being typed in and Charge only', async ({ page }, info) => {
  await login(page, 'owner@example.test');
  await page.getByRole('button', { name: 'Toggle theme', exact: true }).filter({ visible: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.goto('/pos');
  await page.getByPlaceholder('Search products... (/ or F3)', { exact: true }).fill('Fixture Coffee');
  await page.getByRole('button', { name: /^Fixture Coffee/ }).click();
  await page.getByRole('button', { name: /^Charge \$/ }).click();
  const payment = page.getByRole('dialog', { name: 'Payment', exact: true });
  await expect(payment).toBeVisible();
  const amount = payment.getByRole('spinbutton', { name: 'Amount Tendered' });
  await expect(amount).toBeFocused();
  await page.waitForTimeout(300); // the dialog's entrance has settled
  const colors = await page.evaluate(() => {
    const dialog = document.querySelector('.pos-payment-dialog')!;
    const style = (element: Element | null) => element ? getComputedStyle(element) : null;
    const selected = style(dialog.querySelector('.payment-method[aria-pressed="true"]'));
    const remaining = style(dialog.querySelector('.payment-remaining > p:last-child'));
    const box = style(dialog.querySelector('.payment-remaining'));
    const input = style(dialog.querySelector('input[aria-label="Amount Tendered"]'));
    return { selected: selected?.borderTopColor, remaining: remaining?.color, box: box ? `${box.borderLeftColor} ${box.backgroundColor}` : undefined,
      underline: input?.borderBottomColor, ring: input?.boxShadow };
  });
  // Every element was found: a missing one would pass the color checks without testing anything.
  for (const [part, value] of Object.entries(colors)) expect(value, part).toBeTruthy();
  // Orange: much more red than blue, with a middling green.
  const orange = (value = '') => (value.match(/rgba?\((\d+), (\d+), (\d+)/g) || []).some(color => {
    const [r, g, b] = color.replace(/rgba?\(/, '').split(', ').map(Number);
    return r > 200 && g > 80 && g < 170 && b < 90;
  });
  expect(orange(colors.selected), `selected method: ${colors.selected}`).toBe(false);
  expect(orange(colors.remaining), `remaining amount: ${colors.remaining}`).toBe(false);
  expect(orange(colors.box), `remaining box: ${colors.box}`).toBe(false);
  expect(orange(colors.underline), `amount underline: ${colors.underline}`).toBe(true);
  expect(orange(colors.ring), `amount focus ring: ${colors.ring}`).toBe(false);
  await page.screenshot({ path: info.outputPath('payment-dark.png'), animations: 'disabled' });
});

test('Enter pressed while the total is still being checked charges once the check finishes', async ({ page }) => {
  await login(page, 'owner@example.test');
  const barcode = '73' + String(Date.now()).slice(-10);
  expect((await page.request.post('/api/products', { headers: await auth(page), data: {
    name: 'Early enter item', sku: 'EARLY-' + barcode, barcode, price: 3, cost: 1, stockQuantity: 20, trackInventory: true, isTaxable: false,
  } })).status()).toBe(201);
  await page.goto('/pos');
  await page.getByPlaceholder('Search products... (/ or F3)', { exact: true }).click();
  await page.keyboard.type(barcode, { delay: 5 }); await page.keyboard.press('Enter');
  await expect(page.locator('[data-sale-cart]').filter({ visible: true }).getByText('Early enter item')).toBeVisible();
  // Slow the payment window's total check down so Enter lands before it finishes.
  let quotes = 0;
  await page.route('**/api/sales/quote', async route => { quotes++; if (quotes > 1) await new Promise(resolve => setTimeout(resolve, 1500)); await route.continue(); });
  await page.keyboard.press('F1');
  const payment = page.getByRole('dialog', { name: 'Payment', exact: true });
  await expect(payment.getByRole('spinbutton', { name: 'Amount Tendered' })).toBeFocused();
  const saved = page.waitForResponse(response => response.url().endsWith('/api/sales') && response.request().method() === 'POST');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status', { name: 'Payment balance' })).toContainText('Checking total');
  expect((await saved).status()).toBe(201);
  await expect(saleComplete(page)).toContainText('Paid in full');
});
