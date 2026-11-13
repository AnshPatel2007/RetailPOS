import { test, expect, type Page } from '@playwright/test';
import { login } from './utils/auth-helper';

/**
 * The setup rules every screen keeps (CLAUDE.md > Frontend conventions):
 *  - a page header shows at most three buttons on a computer and two on a phone
 *    (the rest fold under "More"), and at most one of them is filled;
 *  - every button has a name;
 *  - a pop-up keeps its buttons in the footer, which never scrolls away, with
 *    exactly one filled button; on a phone the pop-up is a bottom sheet.
 */
const routes = [
  '/dashboard', '/lottery', '/inventory', '/inventory?view=packs',
  '/inventory/price-review', '/inventory/purchasing/orders', '/inventory/purchasing/receive', '/inventory/purchasing/suggestions',
  '/inventory/purchasing/suppliers', '/inventory/purchasing/suppliers/credits',
  '/inventory/stock-control/exceptions', '/inventory/stock-control/counts', '/inventory/stock-control/transfers', '/inventory/stock-control/movements',
  '/promotions', '/customers', '/customers/accounts/gift-cards', '/customers/accounts/store-credits', '/customers/accounts/house-accounts',
  '/customers/insights?analysis=overview',
  '/financial?tab=expenses', '/financial?tab=budgets', '/financial?tab=recurring', '/financial?tab=pnl', '/financial?tab=inventory',
  '/insights/reports/overview?view=summary', '/insights/reports/sales?view=transactions', '/insights/reports/inventory?view=stock-health',
  '/insights/reports/staff?view=sales', '/insights/reports/exports',
  '/team-time/shifts', '/team-time/staff', '/team-time/payroll', '/audit-log', '/financial/reconciliation', '/settings/jobs',
  '/settings?section=profile', '/settings?section=store', '/settings?section=payments', '/settings?section=receipts',
  '/settings?section=pricing', '/settings?section=notifications', '/settings?section=devices',
];

/**
 * Pop-ups (opened by their page's main button) that follow the pop-up rule.
 * The UI pass adds each pop-up here as it moves onto DialogActions.
 */
const popups: { route: string; opens: string }[] = [
  { route: '/customers', opens: 'Add Customer' },
  { route: '/inventory', opens: 'Add single item' },
  { route: '/inventory/purchasing/suppliers', opens: 'Add Supplier' },
  { route: '/inventory/purchasing/orders', opens: 'New Order' },
];

const FILLED = '[data-variant="primary"], [data-variant="destructive"]';
const viewports = [
  { name: 'computer', width: 1366, height: 768, headerLimit: 3 },
  { name: 'phone', width: 390, height: 844, headerLimit: 2 },
];

async function visit(page: Page, route: string) {
  await page.goto(route);
  await expect(page.getByRole('main')).toBeVisible();
  await page.waitForLoadState('networkidle');
}

/** Checked in the page in one pass, so forty screens stay quick. */
const pageProblems = (page: Page, headerLimit: number) => page.evaluate(({ headerLimit, filled }) => {
  const shown = (element: Element) => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden';
  };
  const text = (element: Element | null) => (element?.textContent ?? '').trim();
  const name = (element: Element) => element.getAttribute('aria-label')?.trim()
    || (element.getAttribute('aria-labelledby') ?? '').split(/\s+/).map(id => text(document.getElementById(id))).join(' ').trim()
    || text(element) || element.getAttribute('title')?.trim()
    || element.querySelector('img[alt]')?.getAttribute('alt')?.trim() || text(element.querySelector('svg title')) || '';
  const words = (elements: Element[]) => elements.map(element => name(element) || '(no name)').join(' | ');
  const problems: string[] = [];
  for (const header of Array.from(document.querySelectorAll('main .page-header'))) {
    const buttons = Array.from(header.querySelectorAll('.page-actions button, .page-actions a')).filter(shown);
    if (buttons.length > headerLimit) problems.push(`${buttons.length} header buttons (limit ${headerLimit}): ${words(buttons)}`);
    const main = Array.from(header.querySelectorAll(filled)).filter(shown);
    if (main.length > 1) problems.push(`${main.length} filled buttons in the header: ${words(main)}`);
  }
  const unnamed = Array.from(document.querySelectorAll('main button, main [role="button"]')).filter(shown).filter(button => !name(button));
  if (unnamed.length) problems.push(`${unnamed.length} buttons without a name: ${unnamed.map(button => button.outerHTML.slice(0, 120)).join(' | ')}`);
  return problems;
}, { headerLimit, filled: FILLED });

for (const viewport of viewports) {
  test(`page headers keep the button rules: ${viewport.name}`, async ({ page }) => {
    test.setTimeout(300000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await login(page, 'owner@example.test');
    const problems: string[] = [];
    for (const route of routes) {
      await visit(page, route);
      for (const problem of await pageProblems(page, viewport.headerLimit)) problems.push(`${route}: ${problem}`);
    }
    expect(problems).toEqual([]);
  });

  test(`pop-ups keep their buttons in the footer: ${viewport.name}`, async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await login(page, 'owner@example.test');
    for (const popup of popups) {
      await visit(page, popup.route);
      await page.locator('.page-actions').getByRole('button', { name: popup.opens, exact: true }).click();
      const sheet = page.locator('.app-dialog').filter({ visible: true }).last();
      await expect(sheet, popup.route).toBeVisible();
      await expect(sheet.locator('.dialog-body').locator(FILLED).filter({ visible: true }), `Filled button in the scrolling body: ${popup.route}`).toHaveCount(0);
      await expect(sheet.locator('.dialog-footer').locator(FILLED).filter({ visible: true }), `One main button in the footer: ${popup.route}`).toHaveCount(1);
      const box = (await sheet.boundingBox())!;
      // The footer is inside the screen, whatever the body's length.
      const footer = (await sheet.locator('.dialog-footer').boundingBox())!;
      expect(footer.y + footer.height, `Footer on screen: ${popup.route}`).toBeLessThanOrEqual(viewport.height + 1);
      if (viewport.name === 'phone') {
        expect(Math.round(box.x), `Bottom sheet spans the screen: ${popup.route}`).toBe(0);
        expect(Math.round(box.width)).toBe(viewport.width);
        expect(Math.round(box.y + box.height), `Bottom sheet sits on the bottom edge: ${popup.route}`).toBe(viewport.height);
      }
      await page.keyboard.press('Escape');
      await expect(sheet).toHaveCount(0);
    }
  });
}

test('a header with more buttons than fit folds the extras under More, and they still work', async ({ page }) => {
  await login(page, 'owner@example.test');
  // Products has three header buttons: all show on a computer, with the main one last and the only filled one.
  await page.setViewportSize({ width: 1366, height: 768 });
  await visit(page, '/inventory');
  const actions = page.locator('.page-actions');
  const more = actions.getByRole('button', { name: 'More actions', exact: true });
  await expect(more).toHaveCount(0);
  await expect(actions.locator('button, a').filter({ visible: true })).toHaveText(['Import CSV', /^Labels/, 'Add single item']);
  await expect(actions.locator(FILLED)).toHaveText('Add single item');
  // A phone shows the main button and "More".
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(more).toHaveText('More');
  await expect(actions.locator('button, a').filter({ visible: true }).last()).toHaveText('Add single item');
  await more.click();
  const menu = page.getByRole('dialog', { name: 'More actions', exact: true });
  await menu.getByRole('button', { name: 'Import CSV', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Import Products from CSV', exact: true })).toBeVisible();
});

test('register tools are words, and Payment keeps its buttons in the footer', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await login(page, 'owner@example.test');
  await page.goto('/pos');
  await page.locator('.pos-product-button').filter({ visible: true }).first().click();
  const cart = page.locator('[data-sale-cart]').filter({ visible: true });
  // Held, Refund, Clear (and Reprint after a sale): each is a word, never only an icon.
  const tools = cart.locator('.pos-cart-tools button');
  await expect(tools.first()).toBeVisible();
  for (const tool of await tools.all()) await expect(tool).toHaveText(/[A-Za-z]{4,}/);
  await expect(cart.getByRole('button', { name: 'Quick refund', exact: true })).toHaveText('Refund');
  await expect(cart.getByRole('button', { name: 'Clear cart', exact: true })).toHaveText('Clear');
  // Charge stays the one big filled button of the cart.
  await expect(cart.locator(FILLED).filter({ visible: true })).toHaveText(/^Charge/);
  await cart.getByRole('button', { name: /^Charge/ }).click();
  const payment = page.locator('.app-dialog').filter({ visible: true }).last();
  await expect(payment.getByRole('heading', { name: 'Payment', exact: true })).toBeVisible();
  await expect(payment.locator('.dialog-body').locator(FILLED).filter({ visible: true })).toHaveCount(0);
  await expect(payment.locator('.dialog-footer').locator(FILLED).filter({ visible: true })).toHaveCount(1);
});
