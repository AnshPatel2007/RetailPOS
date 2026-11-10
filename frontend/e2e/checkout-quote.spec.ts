import { test, expect, Page } from '@playwright/test';
import { login } from './utils/auth-helper';

async function openPayment(page: Page, quantity = 1) {
  await login(page, 'loyalty@example.test');
  await page.goto('/pos');
  await page.getByRole('button', { name: /^Fixture Loyalty/ }).click();
  await page.getByRole('button', { name: 'Change quantity for Fixture Loyalty', exact: true }).click();
  const pad = page.getByRole('dialog', { name: 'Quantity for Fixture Loyalty' });
  await pad.getByRole('button', { name: String(quantity), exact: true }).click();
  await pad.getByRole('button', { name: 'OK', exact: true }).click();
  await page.getByRole('button', { name: 'Charge $' + (quantity * 1.1).toFixed(2), exact: true }).click();
  await page.getByRole('dialog', { name: 'Payment', exact: true }).getByRole('button', { name: 'Add customer', exact: true }).click();
  const linkCustomer = page.getByRole('dialog', { name: /Link Customer/ });
  await linkCustomer.getByPlaceholder('Phone number (or last 4 digits)...').fill('5557770011');
  await linkCustomer.getByRole('button', { name: 'Continue', exact: true }).click();
  const payment = page.getByRole('dialog', { name: 'Payment', exact: true });
  await expect(payment.getByRole('button', { name: /^Charge / })).toBeEnabled();
  return payment;
}

test('a late loyalty quote cannot enable Charge for an old selection', async ({ page }) => {
  const payment = await openPayment(page, 3);
  let release!: () => void, captured!: () => void, finished!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const arrived = new Promise<void>(resolve => { captured = resolve; });
  const done = new Promise<void>(resolve => { finished = resolve; });
  await page.route('**/api/sales/quote', async route => {
    if (route.request().postDataJSON().pointsRedeemed !== 100) { await route.continue(); return; }
    try {
      const response = await route.fetch(); captured(); await held;
      await route.fulfill({ response });
    } catch { /* The application cancels the superseded request. */ }
    finally { finished(); }
  });
  await payment.getByPlaceholder('Points to redeem').fill('100');
  await arrived;
  await expect(payment.getByRole('button', { name: /^Charge / })).toBeDisabled();
  await expect(payment.getByText('Verifying final total…', { exact: true })).toBeVisible();
  await payment.getByPlaceholder('Points to redeem').fill('200');
  await expect(payment.getByRole('button', { name: 'Charge $1.30', exact: true })).toBeEnabled();
  release(); await done;
  await expect(payment.getByRole('button', { name: 'Charge $1.30', exact: true })).toBeEnabled();
  await expect(payment.getByRole('button', { name: 'Charge $2.30', exact: true })).toHaveCount(0);
});

test('a failed final quote retains the checkout and requires a successful retry', async ({ page }) => {
  const payment = await openPayment(page, 3);
  let reject = true;
  await page.route('**/api/sales/quote', route => reject
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Pricing temporarily unavailable' }) })
    : route.continue());
  await payment.getByPlaceholder('Points to redeem').fill('100');
  await expect(payment.getByRole('alert')).toContainText('Pricing temporarily unavailable');
  await expect(payment.getByRole('button', { name: /^Charge / })).toBeDisabled();
  await expect(payment.getByPlaceholder('Points to redeem')).toHaveValue('100');
  reject = false;
  await payment.getByRole('button', { name: 'Retry total', exact: true }).click();
  await expect(payment.getByRole('button', { name: 'Charge $2.30', exact: true })).toBeEnabled();
  await expect(payment.getByRole('alert')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/final-checkout-quote.png', fullPage: true });
});

test('pressing Charge asks the server once: prices, drawer and store settings arrive together', async ({ page }) => {
  await login(page, 'loyalty@example.test');
  await page.goto('/pos');
  await page.getByRole('button', { name: /^Fixture Loyalty/ }).click();
  const charge = page.getByRole('button', { name: 'Charge $1.10', exact: true });
  await expect(charge).toBeEnabled();
  // Settings and drawer used to be fetched one after the other before the quote.
  let watching = false, quoted = false;
  const beforeQuote: string[] = [];
  page.on('request', request => {
    const url = request.url();
    if (url.endsWith('/api/sales/quote')) quoted = true;
    else if (watching && !quoted && /\/api\/(locations\/my-settings|shifts\/current)/.test(url)) beforeQuote.push(url);
  });
  const quote = page.waitForResponse(response => response.url().endsWith('/api/sales/quote'));
  watching = true;
  await charge.click();
  const body = (await (await quote).json()).data;
  expect(typeof body.shiftId).toBe('string');
  expect(body.store.name).toBeTruthy();
  await expect(page.getByRole('dialog', { name: 'Payment', exact: true })).toBeVisible();
  expect(beforeQuote).toEqual([]);
});

test('eligible products explain the EBT launch boundary without offering an unsafe tender', async ({ page }) => {
  await login(page, 'owner@example.test');
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const created = await page.request.post('/api/products', { headers: { Authorization: 'Bearer ' + token }, data: {
    name: 'SNAP Boundary Fixture', sku: 'SNAP-BOUNDARY', price: 1, cost: 0.5, stockQuantity: 5, isTaxable: true, ebtEligible: true,
  } });
  expect(created.status()).toBe(201);
  await page.goto('/pos');
  await page.getByRole('button', { name: /^SNAP Boundary Fixture/ }).click();
  await page.getByRole('button', { name: 'Charge $1.10', exact: true }).click();
  const payment = page.getByRole('dialog', { name: 'Payment', exact: true });
  await expect(payment.getByText(/EBT\/SNAP is unavailable/)).toBeVisible();
  await expect(payment.getByRole('button', { name: 'EBT / SNAP', exact: true })).toHaveCount(0);
  await expect(payment.getByRole('button', { name: 'Charge $1.10', exact: true })).toBeEnabled();
});
