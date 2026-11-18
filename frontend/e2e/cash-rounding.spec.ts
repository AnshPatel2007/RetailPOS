import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';
import { saleComplete } from './utils/sale-complete';
import { chooseOption, selectField } from './utils/select-helper';

// rounding@example.test owns a store no other spec uses, with an open drawer and a $12.42 item.
test('with cash rounding on, a $12.42 cash sale takes $12.40 while a card would pay exactly', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await login(page, 'rounding@example.test');
  const headers = { Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token')) };
  const saved = async () => (await (await page.request.get('/api/locations/my-settings', { headers })).json()).data.settings.cashControl.cashRounding;

  // Off until the owner chooses it in Settings > Taxes & Payments.
  await page.goto('/settings?section=payments');
  expect(await saved()).toBe('OFF');
  await chooseOption(selectField(page, 'Cash rounding to 5 cents'), 'To the nearest 5 cents (1 or 2 cents down, 3 or 4 up)');
  await page.getByRole('button', { name: 'Save Changes', exact: true }).last().click();
  await expect.poll(saved).toBe('NEAREST');

  await page.goto('/pos');
  await page.getByPlaceholder('Search products... (/ or F3)', { exact: true }).fill('Penny Candy Jar');
  await page.getByRole('button', { name: /^Penny Candy Jar/ }).click();
  await page.keyboard.press('F1');
  const payment = page.getByRole('dialog', { name: 'Payment', exact: true });
  // Cash finishing the sale is rounded: $12.40 is offered, and the exact cents are still accepted.
  await expect(payment.getByRole('spinbutton', { name: 'Amount Tendered' })).toHaveValue('12.40');
  await expect(payment.getByRole('status', { name: 'Payment balance' })).toHaveText('$12.40 still due in cash (rounded from $12.42) · press Enter to charge');
  await expect(payment.locator('.payment-remaining')).toContainText('Rounded from $12.42');
  // A card is charged the exact amount.
  await payment.getByRole('button', { name: /Card \(external\)/ }).click();
  await expect(payment.locator('.payment-remaining')).toContainText('$12.42');
  await expect(payment.locator('.payment-remaining')).not.toContainText('Rounded');
  await payment.getByRole('button', { name: /^Cash/ }).click();

  await payment.getByRole('spinbutton', { name: 'Amount Tendered' }).fill('20');
  await expect(payment.getByText('Change: $7.60', { exact: true })).toBeVisible();
  const sold = page.waitForResponse(response => response.url().endsWith('/api/sales') && response.request().method() === 'POST');
  await page.keyboard.press('Enter');
  const sale = await (await sold).json();
  expect(sale.data).toMatchObject({ total: 12.42, changeDue: 7.6, cashRounding: -0.02 });
  await expect(saleComplete(page)).toContainText('$7.60');

  // The receipt says so.
  await saleComplete(page).getByRole('button', { name: 'View receipt', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Receipt', exact: true })).toContainText('TOTAL$12.42Cash rounding-$0.02Paid (Cash)$20.00Change$7.60');
});
