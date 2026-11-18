import { test, expect, Page } from '@playwright/test';
import { login } from './utils/auth-helper';

const auth = async (page: Page) => ({ Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token')) });

// attention@example.test owns a store no other spec uses, so it starts with nothing to report.
test('alerts wait quietly behind the bell, and one that arrives while working slides in', async ({ page }) => {
  await login(page, 'attention@example.test');
  await page.clock.install();
  await page.goto('/dashboard');
  const bell = page.getByRole('button', { name: /^Alerts/ }).filter({ visible: true });
  const panel = page.getByRole('dialog', { name: 'Alerts', exact: true });
  const slideIns = page.locator('.attention-toast');
  // Nothing to report: the bell says so.
  await expect(bell).toHaveAccessibleName('Alerts');
  await bell.click();
  await expect(panel.getByText('Nothing needs attention right now.', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  // Owners see money tiles in place of the customer and product counts.
  const tile = (label: string) => page.locator('.summary-item').filter({ has: page.getByText(label, { exact: true }) });
  await expect(tile('Profit yesterday')).toContainText('$0.00'); await expect(tile('Profit yesterday')).toContainText('No sales yesterday');
  await expect(tile('Bills due this week')).toContainText('Nothing due');
  await expect(page.locator('.summary-item').filter({ has: page.getByText('Customers', { exact: true }) })).toHaveCount(0);

  const headers = await auth(page), stamp = Date.now();
  const api = async (path: string, data: object) => {
    const response = await page.request.post('/api' + path, { headers, data });
    expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
    return (await response.json()).data;
  };
  let codes = 0;
  const oversell = async (name: string, sku: string) => {
    const item = await api('/products', { name, sku, barcode: String(stamp + codes++), price: 2.5, cost: 1.5, stockQuantity: 0, isTaxable: false, trackInventory: true });
    await api('/sales', { items: [{ productId: item.id, quantity: 1, price: 2.5 }], paymentMethod: 'CASH', amountPaid: 5, idempotencyKey: crypto.randomUUID() });
  };
  // An item sold with none on record, and an item priced below what it costs.
  await oversell(`Attention soda ${stamp}`, `ATTN-${stamp}`);
  await api('/products', { name: `Loss leader ${stamp}`, sku: `LEADER-${stamp}`, price: 1, cost: 2, stockQuantity: 5, isTaxable: false, trackInventory: true });

  // At sign-in the alerts only set the bell's number: nothing slides in and nothing covers the Dashboard.
  await page.reload();
  await expect(bell).toHaveAccessibleName('Alerts, 2 new');
  await expect(slideIns).toHaveCount(0);
  await expect(page.getByText('1 item is priced below what it costs.', { exact: false })).toHaveCount(0);
  expect(await page.evaluate(() => { const width = innerWidth; return document.documentElement.scrollWidth <= width; })).toBe(true);

  // Opening the bell lists them, most urgent first, and clears the number.
  await bell.click();
  const open = panel.getByRole('list', { name: 'Alerts' }).getByRole('listitem');
  await expect(open).toHaveCount(2);
  await expect(open.nth(0)).toContainText('1 item is priced below what it costs.');
  await expect(open.nth(1)).toContainText(new RegExp(`Attention soda ${stamp} sold more than recorded stock and is waiting for a count \\(since [A-Z][a-z]{2} \\d{1,2}\\)\\.`));
  await expect(bell).toHaveAccessibleName('Alerts');
  await page.screenshot({ path: 'test-results/attention-list.png', animations: 'disabled' });
  // Each alert links to the page that fixes it.
  await open.nth(1).getByRole('link', { name: 'Count items', exact: true }).click();
  await expect(page).toHaveURL(/\/inventory\/stock-control\/exceptions$/);
  await expect(panel).toHaveCount(0);
  await page.goBack();
  await bell.click();
  await open.filter({ hasText: 'priced below what it costs' }).getByRole('link', { name: 'Review prices', exact: true }).click();
  await expect(page).toHaveURL(/\/inventory\/price-review$/);
  await page.goBack();
  // Dismissing hides one until it changes; it can be shown again.
  await bell.click();
  await open.filter({ hasText: 'priced below what it costs' }).getByRole('button', { name: /^Dismiss: / }).click();
  await expect(open).toHaveCount(1);
  await panel.getByRole('button', { name: 'Show 1 dismissed', exact: true }).click();
  await expect(open).toHaveCount(2);
  await open.filter({ hasText: 'priced below what it costs' }).getByRole('button', { name: /^Dismiss: / }).click();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);

  // A new problem while working: at the next check it slides in, the bell goes up by one, and × closes it.
  await oversell(`Attention chips ${stamp}`, `CHIPS-${stamp}`);
  await page.clock.fastForward(125_000);
  await expect(slideIns).toHaveCount(1);
  await slideIns.hover(); // a pointer over it holds it in place
  await expect(slideIns).toContainText('New alert');
  await expect(slideIns).toContainText('2 items sold more than recorded stock');
  await expect(bell).toHaveAccessibleName('Alerts, 1 new');
  await slideIns.getByRole('button', { name: 'Close this notification', exact: true }).click();
  await expect(slideIns).toHaveCount(0);
  await expect(bell).toHaveAccessibleName('Alerts, 1 new');

  // The next one goes by itself after about four seconds; "View alerts" opens the list.
  await oversell(`Attention candy ${stamp}`, `CANDY-${stamp}`);
  await page.mouse.move(0, 0);
  await page.clock.fastForward(125_000);
  await expect(slideIns).toHaveCount(1);
  await expect(slideIns).toContainText('3 items sold more than recorded stock');
  await page.clock.fastForward(6_000);
  await expect(slideIns).toHaveCount(0);
  await oversell(`Attention gum ${stamp}`, `GUM-${stamp}`);
  await page.clock.fastForward(125_000);
  await slideIns.getByRole('button', { name: 'View alerts', exact: true }).click();
  await expect(panel).toBeVisible();
  await expect(open.first()).toContainText('4 items sold more than recorded stock');
  await expect(bell).toHaveAccessibleName('Alerts');
});

test('cashiers do not get alerts', async ({ page }) => {
  await login(page, 'cashier@example.test'); await page.goto('/dashboard');
  await expect(page.getByText(/Showing your own sales/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Alerts/ })).toHaveCount(0);
  await expect(page.getByText('Profit yesterday', { exact: true })).toHaveCount(0);
});
