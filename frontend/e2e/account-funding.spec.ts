import { chooseOption, selectField } from './utils/select-helper';
import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';

test('gift cash funding recovers once after a lost response and a reload', async ({ page }) => {
  await login(page, 'accounts@example.test'); await page.goto('/gift-cards');
  await page.getByRole('button', { name: 'Issue Gift Card', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Issue Gift Card', exact: true });
  await form.getByLabel('Amount', { exact: true }).fill('25');
  await expect(selectField(form, 'Payment method')).toHaveAttribute('data-value', 'CASH');
  await expect(selectField(form, 'Payment method').getByRole('button')).toContainText('Cash');
  await page.screenshot({ path: 'test-results/gift-funding-light.png', fullPage: true });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.screenshot({ path: 'test-results/gift-funding-dark.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/gift-funding-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await page.route('**/api/gift-cards', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch(); expect(response.status()).toBe(201); await route.abort('failed');
  }, { times: 1 });
  await form.getByRole('button', { name: 'Issue Card', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry saved operation' })).toBeEnabled();
  await page.reload();
  const replay = page.waitForResponse(r => r.url().endsWith('/api/gift-cards') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Retry saved operation' }).click();
  expect((await replay).status()).toBe(200);
  const receipt = page.getByRole('dialog', { name: 'Account receipt', exact: true });
  await expect(receipt.getByText('Gift card issued', { exact: true })).toBeVisible();
  await expect(receipt.getByText('CASH', { exact: true })).toBeVisible();
  await receipt.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('button', { name: 'History', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'History', exact: true }).click();
  const history = page.getByRole('dialog', { name: 'Gift card history', exact: true });
  await expect(history.getByRole('button', { name: 'Receipt', exact: true })).toHaveCount(1);
  await history.getByRole('button', { name: 'Receipt', exact: true }).click();
  await expect(receipt.getByText('Gift card issued', { exact: true })).toBeVisible();
  const popupEvent = page.waitForEvent('popup');
  await receipt.getByRole('button', { name: 'Print receipt', exact: true }).click();
  const popup = await popupEvent;
  await expect(popup.getByText('Gift card issued', { exact: true })).toBeVisible();
  await popup.close();
  await page.goto('/shifts');
  await expect(page.getByText('$125.00', { exact: true })).toBeVisible();
  await expect(page.getByText('Gift Card Cash Funding', { exact: true })).toBeVisible();
});

test('house repayments record the tender, reduce debt and reconcile cash', async ({ page }) => {
  await login(page, 'accounts@example.test'); await page.goto('/house-accounts');
  const row = page.getByRole('row').filter({ hasText: 'Account Fixture' });
  await row.getByRole('button', { name: 'Payment', exact: true }).click();
  const form = page.getByRole('dialog', { name: /Payment/ });
  await form.getByLabel('Amount received ($)', { exact: true }).fill('15');
  await form.getByRole('button', { name: 'Record Payment', exact: true }).click();
  const receipt = page.getByRole('dialog', { name: 'Account receipt', exact: true });
  await expect(receipt.getByText('$65.00', { exact: true })).toBeVisible();
  await receipt.getByRole('button', { name: 'Done', exact: true }).click();
  await row.getByRole('button', { name: 'Payment', exact: true }).click();
  await form.getByLabel('Amount received ($)', { exact: true }).fill('10');
  await chooseOption(selectField(form, 'Payment method'), 'External card terminal');
  await expect(form.getByRole('button', { name: 'Record Payment', exact: true })).toBeDisabled();
  await form.getByLabel('Terminal approval reference').fill('TEST-APPROVED-10');
  await form.getByRole('button', { name: 'Record Payment', exact: true }).click();
  await expect(receipt.getByText('$55.00', { exact: true })).toBeVisible();
  await expect(receipt.getByText('TEST-APPROVED-10', { exact: true })).toBeVisible();
  await page.goto('/shifts');
  await expect(page.getByText('House Account Cash Payments', { exact: true })).toBeVisible();
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const shift = (await (await page.request.get('/api/shifts/current', { headers: { Authorization: 'Bearer ' + token } })).json()).data;
  expect(shift.cashHousePayments).toBe(15);
  expect(shift.expectedDrawer).toBe(100 + shift.cashGiftFunding + 15);
  await page.screenshot({ path: 'test-results/account-collections.png', fullPage: true });
});

test('store credit requires a reason and preserves a reprintable source record', async ({ page }) => {
  await login(page, 'accounts@example.test'); await page.goto('/store-credits');
  await page.getByRole('button', { name: 'Issue Credit', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Issue Store Credit', exact: true });
  await form.getByPlaceholder('Search customer by name, phone...').fill('Account');
  await form.getByRole('button', { name: 'Account Fixture', exact: true }).click();
  await form.getByLabel('Amount ($)', { exact: true }).fill('12.50');
  await expect(form.getByRole('button', { name: 'Issue Credit', exact: true })).toBeDisabled();
  await form.getByLabel('Credit reason', { exact: true }).fill('Customer service goodwill');
  await form.getByRole('button', { name: 'Issue Credit', exact: true }).click();
  const receipt = page.getByRole('dialog', { name: 'Account receipt', exact: true });
  await expect(receipt.getByText('GOODWILL', { exact: true })).toBeVisible();
  await expect(receipt.getByText('Customer service goodwill', { exact: true })).toBeVisible();
  await receipt.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await page.getByRole('button', { name: 'Receipt', exact: true }).click();
  await expect(receipt.getByText('Store credit issued', { exact: true })).toBeVisible();
});

test('manager account screens hide owner grants and corrections', async ({ page }) => {
  await login(page, 'manager@example.test'); await page.goto('/gift-cards');
  await page.getByRole('button', { name: 'Issue Gift Card', exact: true }).click();
  await expect(page.getByLabel('Payment method').locator('option[value="PROMOTIONAL"]')).toHaveCount(0);
  await page.goto('/store-credits');
  await page.getByRole('button', { name: 'Issue Credit', exact: true }).click();
  await expect(page.getByLabel('Credit source').locator('option[value="CORRECTION"]')).toHaveCount(0);
});

test('unavailable browser storage blocks funding before any request is sent', async ({ page }) => {
  await login(page, 'accounts@example.test'); await page.goto('/gift-cards');
  await page.getByRole('button', { name: 'Issue Gift Card', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Issue Gift Card', exact: true });
  await form.getByLabel('Amount', { exact: true }).fill('5');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('pos-pending-account-')) throw new DOMException('Storage full', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  let requests = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/gift-cards')) requests++; });
  await form.getByRole('button', { name: 'Issue Card', exact: true }).click();
  await expect(page.getByText(/Nothing was sent: browser storage is unavailable/)).toBeVisible();
  await expect(form).toBeVisible();
  await expect(form.getByRole('button', { name: 'Issue Card', exact: true })).toBeDisabled();
  expect(requests).toBe(0);
});
