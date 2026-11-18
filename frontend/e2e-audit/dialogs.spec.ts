import { test, type Locator, type Page } from '@playwright/test';
import path from 'node:path';
import { closeAll, record, roleContext, settle, SHOTS, slug } from './shared';
import { seedDemo } from './seed-demo';

test.describe.configure({ mode: 'serial' });

/**
 * Every form, dialog and picker a page opens: each page's header actions, its
 * date pickers and a few row actions are opened one by one, measured (fields,
 * height, sections) and photographed, then closed.
 */
const OWNER_PAGES = ['/dashboard', '/inventory', '/inventory?view=packs', '/inventory/purchasing/orders', '/inventory/purchasing/suppliers',
  '/inventory/purchasing/suggestions', '/inventory/stock-control/transfers', '/inventory/stock-control/counts', '/inventory/stock-control/exceptions',
  '/inventory/stock-control/movements', '/promotions', '/customers', '/customers/accounts/gift-cards', '/customers/accounts/store-credits',
  '/customers/accounts/house-accounts', '/team-time/shifts', '/team-time/staff', '/team-time/payroll', '/insights/reports/sales?view=transactions',
  '/insights/reports/inventory?view=catalog', '/insights/reports/exports', '/financial?tab=expenses', '/financial?tab=budgets', '/financial?tab=recurring',
  '/financial?tab=pnl', '/financial?tab=inventory', '/financial/reconciliation?view=corrections', '/audit-log', '/settings?section=pricing'];
const ROW_ACTIONS: [string, RegExp][] = [
  ['/inventory', /^Edit /], ['/customers', /^View/], ['/inventory/purchasing/suppliers', /edit/i], ['/promotions', /edit/i],
  ['/inventory/purchasing/orders', /view|eye/i], ['/team-time/staff', /edit/i], ['/customers/accounts/house-accounts', /^Payment/],
];
const SKIP = /^(Back|Background Jobs|Export|Export Excel|Saved exports|Print Labels|Scan Receipt|Charts|Filters|Search|Retry|Back to Financial|Delivery Jobs|Clock Out)/i;

async function measure(page: Page, surface: Locator) {
  return surface.evaluate(el => {
    const visible = (node: Element) => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const fields = [...el.querySelectorAll('input:not([type=hidden]), select, textarea, [role=combobox], [role=spinbutton]')].filter(visible);
    const scroller = el.querySelector('.dialog-body') || el;
    return {
      title: (el.getAttribute('aria-label') || el.querySelector('h1,h2,[slot="title"]')?.textContent || '').trim(),
      fields: fields.length,
      requiredFields: fields.filter(f => (f as HTMLInputElement).required || f.getAttribute('aria-required') === 'true').length,
      sections: el.querySelectorAll('h3, h4, legend, .form-section, fieldset').length,
      buttons: [...el.querySelectorAll('button')].filter(visible).length,
      width: Math.round(el.getBoundingClientRect().width),
      visibleHeight: Math.round(el.getBoundingClientRect().height),
      contentHeight: Math.round((scroller as HTMLElement).scrollHeight),
      words: (el as HTMLElement).innerText.split(/\s+/).filter(Boolean).length,
    };
  });
}

async function capture(page: Page, role: string, where: string, trigger: string) {
  await page.waitForTimeout(500);
  const surface = page.locator('[role="dialog"]:visible, .control-popover:visible').last();
  if (!(await surface.count())) return false;
  const base = `dialog__${role}__${slug(where)}__${slug(trigger).slice(0, 40)}`;
  const metrics = await measure(page, surface);
  const files = [`${base}.png`];
  await page.screenshot({ path: path.join(SHOTS, files[0]), animations: 'disabled' });
  // A form taller than the window: also capture the whole form.
  if (metrics.contentHeight > metrics.visibleHeight + 40) {
    const original = page.viewportSize()!;
    await page.setViewportSize({ width: original.width, height: Math.min(4000, original.height + metrics.contentHeight - metrics.visibleHeight + 80) });
    await page.waitForTimeout(300);
    files.push(`${base}__full.png`);
    await page.screenshot({ path: path.join(SHOTS, files[1]), animations: 'disabled' });
    await page.setViewportSize(original);
  }
  record('dialogs.jsonl', { role, page: where, trigger, files, ...metrics });
  return true;
}

async function close(page: Page) {
  for (let i = 0; i < 3 && await page.locator('[role="dialog"]:visible, .control-popover:visible').count(); i++) {
    await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  }
}

async function crawl(page: Page, role: string, where: string) {
  await page.goto(where); await settle(page);
  const actions = page.locator('.page-header .page-actions button:visible, .page-header button:visible');
  const labels = [...new Set((await actions.allInnerTexts()).map(t => t.trim()).filter(t => t && !SKIP.test(t)))];
  for (const label of labels) {
    try {
      await page.goto(where); await settle(page);
      const button = page.locator('.page-header').getByRole('button', { name: label, exact: true }).first();
      if (!(await button.count()) || !(await button.isEnabled())) continue;
      await button.click();
      if (!new URL(page.url()).pathname.startsWith(where.split('?')[0])) continue;
      await capture(page, role, where, label);
      await close(page);
    } catch (error) { record('dialogs.jsonl', { role, page: where, trigger: label, error: String(error).slice(0, 200) }); }
  }
  // Date pickers on the page.
  try {
    await page.goto(where); await settle(page);
    const pickers = page.locator('.date-range-trigger:visible, .date-control button:visible');
    const count = Math.min(await pickers.count(), 2);
    for (let i = 0; i < count; i++) {
      await pickers.nth(i).click();
      await capture(page, role, where, `date picker ${i + 1}`);
      await close(page);
    }
  } catch (error) { record('dialogs.jsonl', { role, page: where, trigger: 'date picker', error: String(error).slice(0, 200) }); }
}

test('seed demo store data', async ({ page }) => { test.setTimeout(10 * 60_000); await seedDemo(page); });

test('owner forms, dialogs and pickers', async ({ browser }) => {
  test.setTimeout(40 * 60_000);
  const { context, page } = await roleContext(browser, 'owner@example.test');
  for (const where of OWNER_PAGES) await crawl(page, 'admin', where);
  for (const [where, name] of ROW_ACTIONS) {
    try {
      await page.goto(where); await settle(page);
      const button = page.getByRole('main').getByRole('button', { name }).first();
      if (await button.count()) { await button.click(); await capture(page, 'admin', where, 'row ' + name.source); await close(page); }
    } catch (error) { record('dialogs.jsonl', { role: 'admin', page: where, trigger: 'row', error: String(error).slice(0, 200) }); }
  }
  await closeAll(context);
});

test('platform forms', async ({ browser }) => {
  test.setTimeout(15 * 60_000);
  const { context, page } = await roleContext(browser, 'platform@example.test');
  for (const where of ['/admin/stores', '/admin/users', '/admin/integrations']) await crawl(page, 'superadmin', where);
  await closeAll(context);
});

test('register dialogs', async ({ browser }) => {
  test.setTimeout(15 * 60_000);
  const { context, page } = await roleContext(browser, 'cashier@example.test');
  await page.goto('/pos'); await settle(page);
  for (const [key, label] of [['F7', 'misc item'], ['F6', 'held sales'], ['F8', 'refund'], ['?', 'shortcuts']]) {
    try { await page.keyboard.press(key); await capture(page, 'cashier', '/pos', label); await close(page); }
    catch (error) { record('dialogs.jsonl', { role: 'cashier', page: '/pos', trigger: label, error: String(error).slice(0, 200) }); }
  }
  await page.goto('/my-shift'); await settle(page);
  try { await page.getByRole('button', { name: /Clock Out/ }).first().click(); await capture(page, 'cashier', '/my-shift', 'clock out'); await close(page); }
  catch (error) { record('dialogs.jsonl', { role: 'cashier', page: '/my-shift', trigger: 'clock out', error: String(error).slice(0, 200) }); }
  await closeAll(context);
});
