import { test, type Browser, type Page } from '@playwright/test';
import path from 'node:path';
import { closeAll, inspect, record, roleContext, settle, shoot, SHOTS, slug, VIEWPORTS } from './shared';
import { seedDemo } from './seed-demo';

/**
 * Before/after pictures only (no accessibility or layout checks): every main
 * screen on a computer and a phone, key screens in dark, the register with a
 * sale in progress, and the pop-up each page's main button opens.
 *
 *   UX_AUDIT_DIR=ux-audit-2026-11b/before  [UX_AUDIT_LOOK=new]
 *   node scripts/verify-pos.cjs browser -c playwright.audit.config.ts pictures.spec.ts -g "owner computer"
 *
 * Each test is one run of a few minutes; run them one at a time.
 */
test.describe.configure({ mode: 'serial' });

const OWNER = 'owner@example.test';
const pages = [
  '/dashboard', '/pos', '/lottery',
  '/inventory', '/inventory?view=packs',
  // Price Review and Credits Owed moved; their old addresses redirect, and keep the picture names the same before and after.
  '/inventory/purchasing/orders', '/inventory/purchasing/receive', '/inventory/purchasing/suggestions', '/inventory/purchasing/price-review',
  '/inventory/purchasing/suppliers', '/inventory/purchasing/credits',
  '/inventory/stock-control/exceptions', '/inventory/stock-control/counts', '/inventory/stock-control/transfers', '/inventory/stock-control/movements',
  '/promotions', '/customers', '/customers/accounts/gift-cards', '/customers/accounts/store-credits', '/customers/accounts/house-accounts',
  '/customers/insights?analysis=overview',
  '/financial?tab=expenses', '/financial?tab=budgets', '/financial?tab=recurring', '/financial?tab=pnl', '/financial?tab=inventory',
  '/insights/reports/overview?view=summary', '/insights/reports/sales?view=transactions', '/insights/reports/inventory?view=stock-health',
  '/insights/reports/staff?view=sales', '/insights/reports/exports',
  '/team-time/shifts', '/team-time/staff', '/team-time/payroll', '/audit-log',
  '/settings?section=profile', '/settings?section=store', '/settings?section=payments', '/settings?section=receipts',
  '/settings?section=pricing', '/settings?section=notifications', '/settings?section=devices',
];
const keyPages = ['/dashboard', '/pos', '/inventory', '/inventory/purchasing/orders', '/inventory/purchasing/receive', '/inventory/purchasing/suppliers',
  '/inventory/stock-control/counts', '/customers', '/financial?tab=expenses', '/insights/reports/overview?view=summary', '/team-time/staff', '/settings?section=store'];
/** Pages whose main (last) header button opens a pop-up worth a picture. */
const popupPages = ['/inventory', '/inventory?view=packs', '/inventory/purchasing/orders', '/inventory/purchasing/suppliers', '/inventory/purchasing/credits',
  '/inventory/stock-control/counts', '/inventory/stock-control/transfers', '/promotions', '/customers', '/customers/accounts/gift-cards',
  '/customers/accounts/store-credits', '/customers/accounts/house-accounts', '/financial?tab=expenses', '/team-time/staff'];

async function open(page: Page, route: string) { await page.goto(route); await settle(page); }

async function capture(browser: Browser, email: string, role: string, routes: string[], viewport: keyof typeof VIEWPORTS, dark = false) {
  const { context, page } = await roleContext(browser, email, { dark });
  for (const route of routes) {
    try {
      await open(page, route);
      const files = await shoot(page, `${role}__${slug(route)}`, VIEWPORTS[viewport], route !== '/pos');
      record('pictures.jsonl', { role, route, viewport, files });
    } catch (error) { record('pictures.jsonl', { role, route, viewport, error: String(error).slice(0, 300) }); }
  }
  await closeAll(context);
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(10 * 60_000);
  const page = await browser.newPage({ baseURL: 'http://127.0.0.1:5174' });
  await seedDemo(page);
  await page.close();
});

test('owner computer A', async ({ browser }) => { await capture(browser, OWNER, 'owner', pages.slice(0, 21), 'laptop'); });
test('owner computer B', async ({ browser }) => { await capture(browser, OWNER, 'owner', pages.slice(21), 'laptop'); });
test('owner phone A', async ({ browser }) => { await capture(browser, OWNER, 'owner', pages.slice(0, 21), 'phone'); });
test('owner phone B', async ({ browser }) => { await capture(browser, OWNER, 'owner', pages.slice(21), 'phone'); });
test('owner dark', async ({ browser }) => { await capture(browser, OWNER, 'owner', keyPages, 'dark', true); });
test('key pages', async ({ browser }) => { await capture(browser, OWNER, 'owner', keyPages, 'laptop'); await capture(browser, OWNER, 'owner', keyPages, 'phone'); });

/** Contrast and other WCAG A/AA checks (axe) on the key pages in both themes, for comparing looks: checks.jsonl. */
test('accessibility of key pages', async ({ browser }) => {
  test.setTimeout(8 * 60_000);
  for (const dark of [false, true]) {
    const { context, page } = await roleContext(browser, OWNER, { dark });
    for (const route of keyPages) {
      try {
        await open(page, route);
        const checks = await inspect(page);
        record('checks.jsonl', { route, dark, axe: checks.axe, smallControls: checks.smallControlCount, smallText: checks.smallTextCount, pageOverflow: checks.pageOverflow });
      } catch (error) { record('checks.jsonl', { route, dark, error: String(error).slice(0, 300) }); }
    }
    await closeAll(context);
  }
});

test('cashier and platform', async ({ browser }) => {
  const cashier = ['/dashboard', '/pos', '/customers', '/my-shift', '/lottery', '/settings?section=profile'];
  await capture(browser, 'cashier@example.test', 'cashier', cashier, 'laptop');
  await capture(browser, 'cashier@example.test', 'cashier', cashier, 'phone');
  const platform = ['/admin', '/admin/stores', '/admin/users', '/admin/integrations', '/analytics'];
  await capture(browser, 'platform@example.test', 'platform', platform, 'laptop');
  await capture(browser, 'platform@example.test', 'platform', platform, 'phone');
});

test('register with a sale', async ({ browser }) => {
  for (const viewport of ['laptop', 'phone'] as const) {
    const { context, page } = await roleContext(browser, OWNER);
    const size = VIEWPORTS[viewport];
    const snap = async (name: string) => {
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(SHOTS, `register__${name}__${size.name}.png`), animations: 'disabled' });
    };
    try {
      await page.setViewportSize({ width: size.width, height: size.height });
      await open(page, '/pos');
      const tiles = page.locator('.pos-product-button').filter({ visible: true });
      const count = Math.min(3, await tiles.count());
      for (let index = 0; index < count; index++) await tiles.nth(index).click().catch(() => undefined);
      if (viewport === 'phone') await page.getByRole('button', { name: 'Open sale cart' }).click().catch(() => undefined);
      await snap('cart');
      await page.getByRole('button', { name: /^Charge/ }).filter({ visible: true }).first().click().catch(() => undefined);
      await settle(page);
      await snap('payment');
      record('pictures.jsonl', { role: 'owner', route: '/pos (sale)', viewport, tiles: count });
    } catch (error) { record('pictures.jsonl', { role: 'owner', route: '/pos (sale)', viewport, error: String(error).slice(0, 300) }); }
    await closeAll(context);
  }
});

test('pop-ups from main buttons', async ({ browser }) => {
  for (const viewport of ['laptop', 'phone'] as const) {
    const { context, page } = await roleContext(browser, OWNER);
    const size = VIEWPORTS[viewport];
    await page.setViewportSize({ width: size.width, height: size.height });
    for (const route of popupPages) {
      try {
        await open(page, route);
        const main = page.locator('.page-actions').locator('button, a').filter({ visible: true }).last();
        const label = ((await main.innerText().catch(() => '')) || 'main').trim();
        await main.click();
        await page.waitForTimeout(600);
        const dialog = page.locator('[role="dialog"]').filter({ visible: true }).last();
        if (await dialog.count()) {
          const file = `popup__${slug(route)}__${slug(label).slice(0, 30)}__${size.name}.png`;
          await page.screenshot({ path: path.join(SHOTS, file), animations: 'disabled' });
          record('pictures.jsonl', { role: 'owner', route, viewport, popup: label, files: [file] });
          await page.keyboard.press('Escape');
          await page.waitForTimeout(300);
        } else record('pictures.jsonl', { role: 'owner', route, viewport, popup: label, note: 'no dialog opened' });
      } catch (error) { record('pictures.jsonl', { role: 'owner', route, viewport, error: String(error).slice(0, 300) }); }
    }
    await closeAll(context);
  }
});
