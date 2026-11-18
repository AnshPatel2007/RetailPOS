import { test, type Browser, type Locator, type Page } from '@playwright/test';
import path from 'node:path';
import { closeAll, record, roleContext, settle, SHOTS } from './shared';

test.describe.configure({ mode: 'serial' });

/** Records one task: every click, key press and typed entry, with a screenshot per step and the dialogs it passed through. */
class Flow {
  clicks = 0; keys = 0; entries = 0; scans = 0;
  steps: { n: number; action: string; dialogs: string[]; file: string }[] = [];
  dialogs = new Set<string>();
  constructor(private page: Page, readonly name: string, readonly role: string) {
    // Native browser confirm pop-ups count as an extra click (and are a finding of their own).
    page.on('dialog', async dialog => { this.clicks++; this.dialogs.add(`browser ${dialog.type()}: ${dialog.message().slice(0, 60)}`); await dialog.accept(); });
  }
  private async snap(action: string) {
    await this.page.waitForTimeout(350);
    const dialogs = await this.page.getByRole('dialog').evaluateAll(elements => elements
      .filter(el => (el as HTMLElement).offsetParent !== null || getComputedStyle(el).position === 'fixed')
      .map(el => el.getAttribute('aria-label') || el.querySelector('h1,h2,[slot="title"]')?.textContent?.trim() || 'dialog'));
    dialogs.forEach(d => this.dialogs.add(d));
    const file = `flow__${this.role}__${this.name}__${String(this.steps.length + 1).padStart(2, '0')}.png`;
    await this.page.screenshot({ path: path.join(SHOTS, file), animations: 'disabled' });
    this.steps.push({ n: this.steps.length + 1, action, dialogs, file });
  }
  async start(action: string) { await settle(this.page); await this.snap(action); }
  async click(target: Locator, action: string) { await target.click(); this.clicks++; await this.snap(action); }
  async press(key: string, action: string) { await this.page.keyboard.press(key); this.keys++; await this.snap(action); }
  async fill(target: Locator, text: string, action: string) { await target.fill(text); this.entries++; await this.snap(action); }
  async scan(code: string, action: string) { await this.page.keyboard.type(code, { delay: 5 }); await this.page.keyboard.press('Enter'); this.scans++; await this.snap(action); }
  save(completed: boolean, error?: unknown, note?: string) {
    record('flows.jsonl', { flow: this.name, role: this.role, completed, clicks: this.clicks, keys: this.keys, entries: this.entries, scans: this.scans,
      steps: this.steps, dialogs: [...this.dialogs], note, error: error ? String(error).slice(0, 300) : undefined });
  }
}

async function run(browser: Browser, email: string, role: string, name: string, body: (flow: Flow, page: Page) => Promise<string | void>) {
  const { context, page } = await roleContext(browser, email);
  const flow = new Flow(page, name, role);
  try { const note = await body(flow, page); flow.save(true, undefined, note || undefined); }
  catch (error) { flow.save(false, error); }
  finally { await closeAll(context); }
}

const CASHIER = 'cashier@example.test', OWNER = 'owner@example.test';
const salePosted = (page: Page) => page.waitForResponse(r => r.url().endsWith('/api/sales') && r.request().method() === 'POST', { timeout: 15_000 });
const search = (page: Page) => page.getByPlaceholder('Search products... (/ or F3)', { exact: true });
const charge = (page: Page) => page.getByRole('button', { name: /^Charge \$/ }).filter({ visible: true }).first();

test('checkout flows', async ({ browser }) => {
  test.setTimeout(30 * 60_000);

  await run(browser, CASHIER, 'cashier', 'cash-sale-mouse', async (flow, page) => {
    await page.goto('/pos'); await flow.start('Open register');
    await flow.fill(search(page), 'Fixture Coffee', 'Search for the item');
    await flow.click(page.getByRole('button', { name: /^Fixture Coffee/ }), 'Add item');
    await flow.click(charge(page), 'Charge');
    await flow.click(page.getByRole('button', { name: 'Skip', exact: true }), 'Skip customer');
    const payment = page.getByRole('dialog', { name: 'Payment', exact: true });
    await flow.click(payment.getByRole('button', { name: 'Exact', exact: true }), 'Exact cash');
    const saved = salePosted(page);
    await flow.click(payment.getByRole('button', { name: /^Charge \$/ }), 'Confirm charge');
    await saved;
    const done = page.getByRole('button', { name: 'Done', exact: true });
    if (await done.isVisible().catch(() => false)) await flow.click(done, 'Close receipt');
  });

  await run(browser, CASHIER, 'cashier', 'cash-sale-keyboard', async (flow, page) => {
    await page.goto('/pos'); await flow.start('Open register');
    await flow.scan('444444', 'Scan item (Fixture Transfer, barcode 444444)');
    const saved = salePosted(page).then(() => true).catch(() => false);
    await flow.press('F1', 'F1 pay cash');
    // Try to finish with the keyboard only: Enter until the sale saves (at most 6 presses).
    for (let i = 0; i < 6; i++) {
      if (await Promise.race([saved, page.waitForTimeout(600).then(() => false)])) break;
      await flow.press('Enter', 'Enter');
    }
    return (await Promise.race([saved, page.waitForTimeout(2000).then(() => false)])) ? 'Completed with the keyboard' : 'Could not complete with the keyboard alone';
  });

  await run(browser, CASHIER, 'cashier', 'scan-while-search-focused', async (flow, page) => {
    await page.goto('/pos'); await flow.start('Open register');
    await flow.press('F3', 'F3 focus search');
    await flow.scan('444444', 'Scan item while search box is focused');
    const added = await page.getByRole('button', { name: /^Change quantity for Fixture Transfer/ }).count();
    return added ? 'Scan added the item' : 'Scan typed into the search box instead of adding the item';
  });

  await run(browser, CASHIER, 'cashier', 'split-tender', async (flow, page) => {
    await page.goto('/pos'); await flow.start('Open register');
    await flow.fill(search(page), 'Fixture Coffee', 'Search');
    await flow.click(page.getByRole('button', { name: /^Fixture Coffee/ }), 'Add item');
    await flow.click(page.getByRole('button', { name: /^Fixture Coffee/ }), 'Add second');
    await flow.click(charge(page), 'Charge');
    await flow.click(page.getByRole('button', { name: 'Skip', exact: true }), 'Skip customer');
    const payment = page.getByRole('dialog', { name: 'Payment', exact: true });
    await flow.fill(payment.getByRole('spinbutton'), '10', 'Enter $10 cash');
    await flow.click(payment.getByRole('button', { name: 'Charge $10.00', exact: true }), 'Take $10 cash');
    await flow.click(payment.getByRole('button', { name: 'Card (external)', exact: true }), 'Switch to card');
    const due = (await payment.getByRole('status', { name: 'Payment balance', exact: true }).innerText()).match(/\$([\d.]+) still due/)?.[1] || '12.00';
    await flow.fill(payment.getByRole('spinbutton'), due, 'Enter card amount');
    await flow.fill(payment.getByPlaceholder('Terminal approval / transaction reference'), 'AUDIT-APPROVAL', 'Enter terminal reference');
    const saved = salePosted(page);
    await flow.click(payment.getByRole('button', { name: /^Save payment \$/ }), 'Save card payment');
    await saved;
  });

  await run(browser, CASHIER, 'cashier', 'link-customer', async (flow, page) => {
    await page.goto('/pos'); await flow.start('Open register');
    await flow.fill(search(page), 'Fixture Loyalty', 'Search');
    await flow.click(page.getByRole('button', { name: /^Fixture Loyalty/ }), 'Add item');
    await flow.click(charge(page), 'Charge');
    const lookup = page.getByPlaceholder(/Phone number/).filter({ visible: true }).first();
    await flow.fill(lookup, '5557770011', 'Type customer phone');
    await flow.press('Enter', 'Look up');
    const pick = page.getByRole('button', { name: /Loyalty Customer/ }).filter({ visible: true }).first();
    if (await pick.count()) await flow.click(pick, 'Choose customer');
    const next = page.getByRole('button', { name: /^(Continue|Next|Continue to payment)/ }).filter({ visible: true }).first();
    if (await next.count()) await flow.click(next, 'Continue to payment');
    return 'Stopped at payment (customer linked)';
  });

  await run(browser, CASHIER, 'cashier', 'hold-and-recall', async (flow, page) => {
    await page.goto('/pos'); await flow.start('Open register');
    await flow.fill(search(page), 'Fixture Coffee', 'Search');
    await flow.click(page.getByRole('button', { name: /^Fixture Coffee/ }), 'Add item');
    await flow.click(page.getByTitle('Hold sale (F5)').filter({ visible: true }).first(), 'Hold sale');
    await flow.click(page.getByTitle(/Held sales/).filter({ visible: true }).first(), 'Open held sales');
    const held = page.getByRole('dialog', { name: /Held Sales/ });
    await flow.click(held.getByRole('button', { name: /Resume|Recall|Restore|Load/ }).first(), 'Resume held sale');
  });

  await run(browser, CASHIER, 'cashier', 'misc-item', async (flow, page) => {
    await page.goto('/pos'); await flow.start('Open register');
    await flow.press('F7', 'F7 misc item');
    const dialog = page.getByRole('dialog').filter({ visible: true }).last();
    const inputs = dialog.locator('input');
    await flow.fill(inputs.first(), 'Deli sandwich', 'Name');
    if (await inputs.count() > 1) await flow.fill(inputs.nth(1), '6.50', 'Price');
    await flow.click(dialog.getByRole('button', { name: /^Add/ }).first(), 'Add misc item');
  });

  await run(browser, CASHIER, 'cashier', 'discount-with-approval', async (flow, page) => {
    await page.goto('/pos'); await flow.start('Open register');
    await flow.click(page.getByRole('button', { name: /^Fixture Coffee/ }), 'Add item');
    await flow.click(page.getByRole('button', { name: 'Actions for Fixture Coffee', exact: true }), 'Line actions');
    await flow.click(page.getByRole('menuitem', { name: 'Item discount', exact: true }), 'Item discount');
    await flow.fill(page.getByLabel('Item discount amount'), '1', 'Discount amount');
    await flow.click(page.getByRole('button', { name: 'Apply', exact: true }), 'Apply');
    await flow.click(charge(page), 'Charge');
    await flow.click(page.getByRole('button', { name: 'Skip', exact: true }), 'Skip customer');
    const payment = page.getByRole('dialog', { name: 'Payment', exact: true });
    await flow.click(payment.getByRole('button', { name: 'Exact', exact: true }), 'Exact cash');
    await flow.click(payment.getByRole('button', { name: /^Charge \$/ }), 'Confirm charge');
    const approval = page.getByRole('dialog', { name: 'Manager approval', exact: true });
    await flow.fill(approval.getByLabel('Reason', { exact: true }), 'Damaged packaging', 'Reason');
    await flow.fill(approval.getByLabel('Manager email'), 'manager@example.test', 'Manager email');
    await flow.fill(approval.getByLabel('Manager password'), 'BrowserTest123!', 'Manager password');
    const saved = salePosted(page);
    await flow.click(approval.getByRole('button', { name: 'Approve this action' }), 'Approve');
    await saved;
  });

  await run(browser, CASHIER, 'cashier', 'quick-refund', async (flow, page) => {
    await page.goto('/pos'); await flow.start('Open register');
    await flow.click(page.getByTitle('Quick refund', { exact: true }).filter({ visible: true }).first(), 'Open quick refund');
    const dialog = page.getByRole('dialog', { name: 'Quick Refund', exact: true });
    const recent = dialog.getByRole('button', { name: /S-\d/ }).first();
    if (await recent.count()) await flow.click(recent, 'Pick a recent sale');
    const more = dialog.getByRole('button', { name: /^Return more/ }).first();
    if (await more.count()) await flow.click(more, 'Return one item');
    const refund = dialog.getByRole('button', { name: /^Refund \$/ }).first();
    if (await refund.count()) await flow.click(refund, 'Refund');
  });
});

test('back-office flows', async ({ browser }) => {
  test.setTimeout(30 * 60_000);

  await run(browser, OWNER, 'admin', 'add-product', async (flow, page) => {
    await page.goto('/inventory'); await flow.start('Products');
    await flow.click(page.getByRole('button', { name: 'Add single item', exact: true }), 'Add single item');
    const dialog = page.getByRole('dialog', { name: 'Add New Product', exact: true });
    await flow.fill(dialog.getByLabel('Product Name', { exact: true }), 'Audit Iced Tea', 'Name');
    await flow.fill(dialog.getByLabel('SKU', { exact: true }), 'AUDIT-TEA', 'SKU');
    await flow.fill(dialog.getByLabel('Retail Price', { exact: true }), '2.99', 'Price');
    await flow.fill(dialog.getByLabel('Cost Price', { exact: true }), '1.20', 'Cost');
    await flow.fill(dialog.getByLabel('Stock Quantity', { exact: true }), '24', 'Stock');
    await flow.fill(dialog.getByLabel('Low Stock Alert', { exact: true }), '6', 'Low stock alert');
    await flow.click(dialog.getByRole('button', { name: 'Create Product', exact: true }).or(page.getByRole('button', { name: 'Create Product', exact: true })).first(), 'Create');
  });

  await run(browser, OWNER, 'admin', 'adjust-stock', async (flow, page) => {
    await page.goto('/inventory'); await flow.start('Products');
    await flow.fill(page.getByRole('searchbox', { name: 'Search products' }), 'Fixture Coffee', 'Find product');
    await flow.click(page.getByRole('button', { name: 'More actions for Fixture Coffee', exact: true }), 'More actions');
    await flow.click(page.getByRole('menuitem', { name: 'Adjust Stock', exact: true }), 'Adjust Stock');
    const dialog = page.getByRole('dialog', { name: 'Adjust Stock', exact: true });
    await flow.fill(dialog.getByPlaceholder('Amount to adjust'), '5', 'Quantity');
    await flow.click(dialog.getByRole('button', { name: /^(Adjust Stock|Receive)$/ }), 'Save');
  });

  await run(browser, OWNER, 'admin', 'receive-purchase-order', async (flow, page) => {
    await page.goto('/inventory/purchasing/orders'); await flow.start('Purchase orders');
    const row = page.getByRole('row').filter({ hasText: 'PO-FIXTURE' });
    const receive = row.getByRole('button', { name: /Receive/ }).first();
    if (await receive.count()) await flow.click(receive, 'Receive');
    else await flow.click(row.first(), 'Open order');
    const record = page.getByRole('button', { name: 'Record delivery', exact: true });
    if (await record.count()) await flow.click(record, 'Record delivery');
  });

  await run(browser, OWNER, 'admin', 'create-promotion', async (flow, page) => {
    await page.goto('/promotions'); await flow.start('Promotions');
    await flow.click(page.getByRole('button', { name: /New Promotion/ }).first(), 'New promotion');
    const dialog = page.getByRole('dialog').filter({ visible: true }).last();
    await flow.fill(dialog.getByLabel(/^Name/).first(), 'Audit weekend deal', 'Name');
    return 'Stopped after naming (form shape recorded)';
  });

  await run(browser, OWNER, 'admin', 'export-report', async (flow, page) => {
    await page.goto('/insights/reports/exports'); await flow.start('Exports');
    const button = page.getByRole('button', { name: /Export|Download/ }).first();
    if (await button.count()) await flow.click(button, 'Export');
  });

  await run(browser, 'platform@example.test', 'superadmin', 'preview-store-and-exit', async (flow, page) => {
    await page.goto('/admin/stores'); await flow.start('Stores');
    await flow.click(page.getByRole('cell', { name: /^Store A/ }).first(), 'Open Store A');
    await flow.click(page.getByRole('button', { name: 'Preview store', exact: true }), 'Preview store');
    await flow.click(page.getByRole('button', { name: /Exit View/ }).first(), 'Exit preview');
  });

  await run(browser, CASHIER, 'cashier', 'end-shift', async (flow, page) => {
    await page.goto('/my-shift'); await flow.start('My Shift');
    const end = page.getByRole('button', { name: /Clock Out|End Shift|Close Shift/i }).first();
    if (await end.count()) await flow.click(end, 'Clock out / end shift');
    return 'Stopped at the end-shift form';
  });
});
