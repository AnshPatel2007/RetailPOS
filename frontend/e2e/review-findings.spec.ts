import { test, expect, Page } from '@playwright/test';
import { login } from './utils/auth-helper';

const auth = async (page: Page) => ({ Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token')) });
async function product(page: Page, name: string, stockQuantity = 3, extra = {}) {
  const response = await page.request.post('/api/products', { headers: await auth(page), data: {
    name, sku: name.replaceAll(' ', '-'), barcode: String(Date.now()), price: 10, cost: 5, stockQuantity,
    isTaxable: false, trackInventory: true, ...extra,
  } });
  expect(response.status()).toBe(201); return (await response.json()).data;
}
async function scan(page: Page, barcode: string) {
  await page.getByRole('heading', { name: 'Current Sale', exact: true }).click();
  await page.keyboard.type(barcode, { delay: 2 }); await page.keyboard.press('Enter');
}

for (const tender of ['cash', 'split']) test(`immediate product taps and scans retain promotions, stock and dashboard totals with ${tender}`, async ({ page }) => {
  await login(page, 'owner@example.test');
  const item = await product(page, `Quick checkout ${tender}`);
  const empty = await product(page, `Empty checkout ${tender}`, 0);
  const headers = await auth(page);
  expect((await page.request.post('/api/promotions', { headers, data: { name: 'Quick ten percent ' + tender, type: 'PERCENT_OFF', percentOff: 10, productIds: [item.id], isActive: true } })).status()).toBe(201);
  const before = (await (await page.request.get('/api/reports/dashboard', { headers })).json()).data;
  await page.goto('/pos');
  const search = page.getByPlaceholder('Search products... (/ or F3)', { exact: true });
  await search.fill(item.name);
  const card = page.getByRole('button', { name: new RegExp('^' + item.name) });
  await expect(card).not.toContainText(/in stock|left/i);
  await card.click();
  const quantity = page.getByRole('button', { name: 'Change quantity for ' + item.name, exact: true });
  await expect(quantity).toHaveText('1');
  await expect(page.getByRole('dialog', { name: /^Quantity for/ })).toHaveCount(0);
  await scan(page, item.barcode); await expect(quantity).toHaveText('2');
  await card.click(); await expect(quantity).toHaveText('3');
  await search.fill(empty.name);
  // A zero-stock item stays sellable and shows no stock count at the register.
  const emptyCard = page.getByRole('button', { name: new RegExp('^' + empty.name) });
  await expect(emptyCard).toBeEnabled();
  await expect(emptyCard).not.toContainText(/stock/i);
  await expect(page.getByRole('button', { name: 'Change quantity for ' + empty.name, exact: true })).toHaveCount(0);
  await expect(page.getByText('Quick ten percent ' + tender, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Charge $27.00', exact: true }).click();
  const payment = page.getByRole('dialog', { name: 'Payment', exact: true });
  if (tender === 'split') {
    await payment.getByRole('spinbutton').fill('10');
    await payment.getByRole('button', { name: 'Charge $10.00', exact: true }).click();
    await expect(payment.getByRole('status', { name: 'Payment balance', exact: true })).toContainText('$17.00 still due');
    await payment.getByRole('button', { name: 'Card (external)', exact: true }).click();
    await payment.getByRole('spinbutton').fill('17');
    await payment.getByPlaceholder('Terminal approval / transaction reference').fill('ISOLATED-TEST-APPROVAL');
  } else await payment.getByRole('button', { name: 'Exact', exact: true }).click();
  const saved = page.waitForResponse(response => response.url().endsWith('/api/sales') && response.request().method() === 'POST');
  await payment.getByRole('button', { name: tender === 'split' ? 'Save payment $17.00' : 'Charge $27.00', exact: true }).click();
  const response = await saved; expect(response.status()).toBe(201);
  const sale = (await response.json()).data;
  expect(sale.total).toBe(27); expect(sale.items[0].quantity).toBe(3);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(sale.createdAt)).replaceAll('-', '');
  expect(sale.saleNumber).toMatch(new RegExp('^S-' + date.slice(2) + '-\\d{6,}$'));
  expect(sale.payments.map((entry: { paymentMethod: string }) => entry.paymentMethod).sort()).toEqual(tender === 'split' ? ['CARD', 'CASH'] : ['CASH']);
  await page.goto('/inventory'); await page.getByPlaceholder('Search by name, SKU, or barcode...').fill(item.sku);
  await expect(page.getByRole('row').filter({ hasText: item.name }).getByText('Out of Stock', { exact: true })).toBeVisible();
  await page.goto('/dashboard');
  await expect(page.getByText("Today's Collections", { exact: true }).locator('..')).toContainText((before.todaySales + 27).toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
});

test('age-restricted quick add still requires a valid DOB before payment', async ({ page }) => {
  await login(page, 'owner@example.test');
  const item = await product(page, 'Quick age restricted', 3, { minimumAge: 21 });
  await page.goto('/pos'); await page.getByPlaceholder('Search products... (/ or F3)', { exact: true }).fill(item.name);
  await page.getByRole('button', { name: /^Quick age restricted/ }).click();
  await page.getByRole('button', { name: 'Charge $10.00', exact: true }).click();
  const age = page.getByRole('dialog', { name: 'Age Verification Required', exact: true });
  await expect(age).toBeVisible(); await expect(page.getByRole('dialog', { name: 'Payment', exact: true })).toHaveCount(0);
  await age.getByRole('textbox').fill('2020-01-01'); await age.getByRole('textbox').blur();
  await expect(age.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled();
  await age.getByRole('textbox').fill('1990-01-01'); await age.getByRole('textbox').blur();
  await age.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Payment', exact: true })).toBeVisible();
});

test('staff roster keeps wages in Payroll and masks the account password', async ({ page }) => {
  await login(page, 'owner@example.test'); await page.goto('/team-time/staff');
  await expect(page.getByRole('columnheader', { name: /Hourly|Rate|Wages/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add Team Member', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add Team Member', exact: true });
  await expect(dialog.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password');
  await expect(dialog.getByLabel(/PIN Code/)).toHaveCount(0);
});

test('phone cart quantity editor stays above the cart and confirms the selected quantity', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'cashier@example.test'); await page.goto('/pos');
  await page.getByRole('button', { name: /^Fixture Coffee/ }).click();
  await expect(page.getByRole('dialog', { name: /^Quantity for/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open sale cart', exact: true }).click();
  const quantity = page.getByRole('button', { name: 'Change quantity for Fixture Coffee', exact: true }).filter({ visible: true });
  await expect(quantity).toHaveText('1'); await quantity.click();
  const pad = page.getByRole('dialog', { name: 'Quantity for Fixture Coffee', exact: true });
  await pad.getByRole('button', { name: '2', exact: true }).click();
  await expect(pad.getByLabel('Quantity', { exact: true })).toHaveText('2');
  await page.screenshot({ path: info.outputPath('phone-cart-quantity.png'), animations: 'disabled' });
  await pad.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(pad).toHaveCount(0); await expect(quantity).toHaveText('2');
  await quantity.click(); await page.keyboard.press('Escape');
  await expect(pad).toHaveCount(0); await expect(quantity).toHaveText('2');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('empty collections, stock thresholds and full sidebar names remain clear', async ({ page }) => {
  await page.route('**/api/locations/my-settings*', async route => {
    const response = await route.fetch(), body = await response.json(); body.data.name = 'A&P Food and Liquor';
    await route.fulfill({ response, json: body });
  });
  await page.route('**/api/reports/dashboard', async route => {
    const response = await route.fetch(), body = await response.json();
    body.data.hourlyData = body.data.hourlyData.map((entry: object) => ({ ...entry, total: 0 }));
    body.data.lowStockItems = [{ id: 'empty', name: 'Bluetooth Headphones', sku: 'ELEC-003', stock: 0, alert: 5 }];
    await route.fulfill({ response, json: body });
  });
  await page.setViewportSize({ width: 1366, height: 768 }); await login(page, 'owner@example.test');
  await expect(page.getByText('No collection activity in the last 12 hours', { exact: true })).toBeVisible();
  await expect(page.getByText('Out of stock · Min stock: 5', { exact: true })).toBeVisible();
  const name = page.locator('[data-sidebar-store-name]').filter({ visible: true });
  await expect(name).toHaveText('A&P Food and Liquor');
  expect(await name.evaluate(element => element.scrollWidth <= element.clientWidth && getComputedStyle(element).textOverflow !== 'ellipsis')).toBe(true);
  await page.screenshot({ path: 'test-results/review-findings-dashboard.png', fullPage: true });
});
