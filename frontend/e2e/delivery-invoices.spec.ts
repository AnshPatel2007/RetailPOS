import { test, expect, Browser, Page } from '@playwright/test';
import { login, logout } from './utils/auth-helper';
import { clickHeaderAction } from './utils/header-helper';

// invoices@example.test owns a store no other spec uses (Fizz Bottling; Fizz Cola and Crunch Chips on the shelf);
// invoice-cashier@example.test works there.
const auth = async (page: Page) => ({ Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token')) });

/** A photo of a supplier's invoice page, drawn in the browser (what the reading below says it contains). */
async function invoicePhoto(browser: Browser, invoiceNumber: string) {
  const sheet = await browser.newPage({ viewport: { width: 860, height: 640 } });
  await sheet.setContent(`<style>
    body { margin: 0; background: #fbfaf4; color: #1d1d1d; font: 15px/1.45 'Courier New', monospace; }
    .page { padding: 34px 44px; } h1 { margin: 0; font: bold 26px Arial, sans-serif; letter-spacing: .02em; }
    .top { display: flex; justify-content: space-between; } .box { border: 2px solid #1d1d1d; padding: 6px 12px; text-align: right; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; } th { text-align: left; border-bottom: 2px solid #1d1d1d; font-size: 13px; padding: 4px 6px; }
    td { padding: 7px 6px; border-bottom: 1px dashed #9a9a9a; } .n { text-align: right; }
    .totals { margin: 14px 0 0 auto; width: 250px; } .totals div { display: flex; justify-content: space-between; }
    .sign { margin-top: 36px; width: 280px; border-top: 1px solid #1d1d1d; padding-top: 4px; font-size: 12px; }
  </style><div class="page">
    <div class="top"><div><h1>FIZZ BOTTLING CO.</h1><div>1200 Industrial Pkwy, Joliet IL 60431</div><div>Route 14</div></div>
      <div class="box"><b>INVOICE</b><div>No. ${invoiceNumber}</div><div>Date 11/14/2026</div></div></div>
    <div style="margin-top:16px">SOLD TO: INVOICE CHECK STORE &middot; ACCT 40917</div>
    <table><thead><tr><th>ITEM#</th><th>UPC</th><th>DESCRIPTION</th><th class="n">QTY</th><th>UNIT</th><th class="n">PRICE</th><th class="n">AMOUNT</th></tr></thead><tbody>
      <tr><td>10234</td><td>012345678905</td><td>FIZZ COLA 12Z CN 24CT</td><td class="n">2</td><td>CS</td><td class="n">9.60</td><td class="n">19.20</td></tr>
      <tr><td>20871</td><td></td><td>CRUNCH CHIPS 3OZ</td><td class="n">1</td><td>CS</td><td class="n">6.00</td><td class="n">6.00</td></tr>
      <tr><td>30552</td><td></td><td>ZING JERKY 2OZ</td><td class="n">4</td><td>EA</td><td class="n">2.50</td><td class="n">10.00</td></tr>
    </tbody></table>
    <div class="totals"><div><span>SUBTOTAL</span><span>35.20</span></div><div><span>TAX</span><span>0.00</span></div><div><b>TOTAL DUE</b><b>35.20</b></div></div>
    <div class="sign">Received by (signature)</div>
  </div>`);
  const buffer = await sheet.screenshot({ fullPage: true });
  await sheet.close();
  return { name: `invoice-${invoiceNumber}.png`, mimeType: 'image/png', buffer };
}

const reading = (invoiceNumber: string) => ({ pages: [{ vendor: 'FIZZ BOTTLING CO', invoiceNumber, invoiceDate: '2026-11-14', total: 35.2, tax: 0, fees: 0, lines: [
  { description: 'FIZZ COLA 12Z CN 24CT', itemCode: '10234', upc: '012345678905', quantity: 2, unit: 'CASE', unitsPerCase: 24, unitPrice: 9.6, lineTotal: 19.2 },
  { description: 'CRUNCH CHIPS 3OZ', itemCode: '20871', quantity: 1, unit: 'CASE', unitsPerCase: 6, unitPrice: 6, lineTotal: 6 },
  { description: 'ZING JERKY 2OZ', itemCode: '30552', quantity: 4, unit: 'EACH', unitPrice: 2.5, lineTotal: 10 },
] }] });

/**
 * The browser never reaches the AI reader in tests: the next invoice sent gets a prepared
 * reading added to its real request (the API honours it only under NODE_ENV=test).
 */
async function withReading(page: Page, prepared: object) {
  await page.route('**/api/delivery-invoices', async route => {
    const request = route.request();
    const boundary = /boundary=([^;]+)/.exec(request.headers()['content-type'] || '')?.[1];
    const body = request.postDataBuffer();
    if (request.method() !== 'POST' || !boundary || !body) return route.continue();
    const end = body.lastIndexOf(Buffer.from(`--${boundary}--`));
    const field = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="testReading"\r\n\r\n${JSON.stringify(prepared)}\r\n`);
    await route.continue({ postData: Buffer.concat([body.subarray(0, end), field, body.subarray(end)]) });
  }, { times: 1 });
}

test('a cashier photographs an invoice at the register; the owner checks it from the bell and one OK receives it', async ({ page, browser }) => {
  test.setTimeout(120000);
  // At the register: Delivery, a photo, Send. Nothing changes in stock yet.
  await login(page, 'invoice-cashier@example.test');
  await page.goto('/pos');
  await withReading(page, reading('F-100'));
  await page.getByRole('button', { name: 'Delivery: photograph the invoice', exact: true }).click();
  const capture = page.getByRole('dialog', { name: 'Delivery invoice', exact: true });
  await capture.getByTestId('invoice-files').setInputFiles(await invoicePhoto(browser, 'F-100'));
  await expect(capture.getByRole('img', { name: 'Page 1', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/delivery-invoice-register-capture.png' });
  await capture.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(capture.getByText('Sent to the owner', { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(capture.getByText('FIZZ BOTTLING CO · Invoice F-100 · 3 lines', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/delivery-invoice-register-sent.png' });
  await page.keyboard.press('Escape');
  await logout(page);

  // The owner's bell says an invoice is waiting, and opens it.
  await login(page, 'invoices@example.test');
  const bell = page.getByRole('button', { name: /^Alerts/ }).filter({ visible: true });
  await expect(bell).toHaveAccessibleName('Alerts, 1 new');
  await bell.click();
  const alert = page.getByRole('dialog', { name: 'Alerts', exact: true }).getByRole('listitem')
    .filter({ hasText: '1 delivery invoice is waiting for your OK (FIZZ BOTTLING CO, $35.20).' });
  await expect(alert).toBeVisible();
  await page.screenshot({ path: 'test-results/delivery-invoice-bell.png', animations: 'disabled' });
  await alert.getByRole('link', { name: 'Check invoices', exact: true }).click();
  await expect(page).toHaveURL(/\/inventory\/purchasing\/receive\?invoice=[0-9a-f-]{36}$/);

  // Photo beside the lines; the lines that need the owner come first.
  const review = page.getByRole('region', { name: 'Invoice from Fizz Bottling', exact: true });
  await expect(review.getByRole('img', { name: 'Invoice photo 1', exact: true })).toBeVisible();
  const lines = review.getByRole('list', { name: 'Invoice lines', exact: true }).getByRole('listitem');
  await expect(lines).toHaveCount(3);
  await expect(lines.nth(0)).toHaveAccessibleName('Line 2: Crunch Chips 3 oz');
  await expect(lines.nth(1)).toHaveAccessibleName('Line 3: Not in your items yet');
  await expect(lines.nth(2)).toHaveAccessibleName('Line 1: Fizz Cola 12 oz Can');
  await expect(lines.nth(2)).toContainText('2 cases × 24 = 48 units');
  await expect(lines.nth(2)).toContainText('Barcode 012345678905');
  const receive = review.getByRole('button', { name: 'Receive 58 units', exact: true });
  await expect(receive).toBeDisabled();
  await page.screenshot({ path: 'test-results/delivery-invoice-review.png' });

  // "Is this …?" Yes. The new item: name filled in from the invoice, a price, Add.
  await lines.nth(0).getByRole('button', { name: "Yes, that's it", exact: true }).click();
  await expect(review.getByRole('listitem', { name: 'Line 2: Crunch Chips 3 oz', exact: true })).toContainText('Checked');
  await review.getByRole('listitem', { name: 'Line 3: Not in your items yet', exact: true }).getByRole('button', { name: 'Add as new item', exact: true }).click();
  const newItem = page.getByRole('dialog', { name: 'Add a new item', exact: true });
  await expect(newItem.getByLabel('Name', { exact: true })).toHaveValue('Zing Jerky 2 oz');
  await newItem.getByLabel('Selling price', { exact: true }).fill('4.99');
  await page.screenshot({ path: 'test-results/delivery-invoice-new-item.png' });
  await newItem.getByRole('button', { name: 'Add item', exact: true }).click();
  await expect(newItem).toHaveCount(0);
  await expect(review.getByRole('listitem', { name: 'Line 3: Zing Jerky 2 oz', exact: true })).toContainText('New item · sells for $4.99');
  await expect(review.getByText('Everything is checked. Stock changes when you press Receive.', { exact: true })).toBeVisible();

  // Laid out for a phone too, in dark mode, without sideways scrolling.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/delivery-invoice-review-phone-dark.png', fullPage: true, animations: 'disabled' });
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await page.setViewportSize({ width: 1280, height: 720 });

  await receive.click();
  await expect(page.getByText('Delivery received', { exact: true })).toBeVisible();
  const headers = await auth(page);
  const product = async (search: string) => (await (await page.request.get('/api/products?search=' + encodeURIComponent(search), { headers })).json()).data[0];
  expect((await product('FIZZ-12')).stockQuantity).toBe(58);
  expect((await product('CRUNCH-3')).stockQuantity).toBe(11);
  expect(await product('Zing Jerky')).toMatchObject({ name: 'Zing Jerky 2 oz', stockQuantity: 4, price: 4.99 });

  // The next invoice from Fizz Bottling is all sure: the owner sends it and presses OK once.
  const done = page.getByRole('region', { name: 'Received', exact: true });
  await expect(done).toContainText('Fizz Bottling · Invoice F-100 · 3 lines, 58 units added to stock.');
  // Crunch Chips now cost $1.00 each, up from $0.80: their price may be too low.
  await expect(done).toContainText('Costs went up on 1 item');
  await expect(done.getByRole('link', { name: 'Check prices', exact: true })).toHaveAttribute('href', '/inventory/purchasing/price-review');
  // The confirmation is at the top of the page, in view.
  await expect(done).toBeInViewport();
  await page.screenshot({ path: 'test-results/delivery-invoice-received.png', animations: 'disabled' });
  await done.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page).toHaveURL(/\/inventory\/purchasing\/receive$/);
  await expect(page.getByRole('heading', { name: 'Or scan the items one by one', exact: true })).toBeVisible();
  // Back on the page, at its top: the main action is in view (once the cost alert has slid away).
  await expect(page.getByRole('button', { name: 'Take a photo of the invoice', exact: true })).toBeInViewport();
  await expect(page.locator('.attention-toast')).toHaveCount(0, { timeout: 10000 });
  await page.screenshot({ path: 'test-results/delivery-invoice-receive-page.png', animations: 'disabled' });
  await withReading(page, reading('F-101'));
  await clickHeaderAction(page, 'Take a photo of the invoice');
  const again = page.getByRole('dialog', { name: 'Delivery invoice', exact: true });
  await again.getByTestId('invoice-files').setInputFiles(await invoicePhoto(browser, 'F-101'));
  await again.getByRole('button', { name: 'Send', exact: true }).click();
  const second = page.getByRole('region', { name: 'Invoice from Fizz Bottling', exact: true });
  await expect(second.getByText('Everything is checked. Stock changes when you press Receive.', { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(second.getByRole('list', { name: 'Invoice lines', exact: true }).getByText('You confirmed this item on an earlier invoice')).toHaveCount(3);
  await second.getByRole('button', { name: 'Receive 58 units', exact: true }).click();
  await expect(page.getByText('Delivery received', { exact: true })).toBeVisible();
  expect((await product('FIZZ-12')).stockQuantity).toBe(106);
  expect((await product('Zing Jerky')).stockQuantity).toBe(8);
});
