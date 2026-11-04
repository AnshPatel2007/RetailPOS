import { test, expect, Page } from '@playwright/test';
import { login } from './utils/auth-helper';
import { confirmInApp } from './utils/confirm-helper';

async function checkout(page: Page, quantity: number, points: string, total: string) {
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
  await payment.getByPlaceholder('Points to redeem').fill(points);
  const saved = page.waitForResponse(r => r.url().endsWith('/api/sales') && r.request().method() === 'POST');
  await payment.getByRole('button', { name: 'Charge $' + total, exact: true }).click();
  const response = await saved; expect(response.status()).toBe(201);
  const sale = (await response.json()).data;
  const receipt = page.getByRole('dialog', { name: 'Receipt', exact: true });
  await expect(receipt.getByText('Points redeemed: ' + points, { exact: true })).toBeVisible();
  await expect(receipt.getByText('Points earned: ' + Math.floor(Number(total)), { exact: true })).toBeVisible();
  await receipt.getByRole('button', { name: 'Done', exact: true }).click();
  return sale;
}

test('checkout and successive returns show the original allocated cash and points', async ({ page }) => {
  await login(page, 'loyalty@example.test');
  const sale = await checkout(page, 3, '100', '2.30');
  for (const [cash, points] of [['0.76', 33], ['0.77', 33], ['0.77', 34]] as const) {
    await page.getByTitle('Quick refund', { exact: true }).click();
    const refund = page.getByRole('dialog', { name: 'Quick Refund', exact: true });
    await refund.getByPlaceholder('Enter sale number...').fill(sale.saleNumber);
    await refund.getByRole('button', { name: 'Find sale', exact: true }).click();
    await refund.getByRole('button', { name: 'Return more Fixture Loyalty', exact: true }).click();
    await expect(refund.getByText(new RegExp(points + ' redeemed points will be restored'))).toBeVisible();
    const result = page.waitForResponse(r => r.url().endsWith('/refund') && r.request().method() === 'POST');
    await refund.getByRole('button', { name: 'Refund $' + cash, exact: true }).click();
    await confirmInApp(page, 'Refund $' + cash + '?', 'Refund');
    expect((await result).status()).toBe(200); await expect(refund).toHaveCount(0);
  }
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const headers = { Authorization: 'Bearer ' + token };
  const customer = (await (await page.request.get('/api/customers/' + sale.customerId, { headers })).json()).data;
  expect(customer.loyaltyPoints).toBe(1000);
  const shift = (await (await page.request.get('/api/shifts/current', { headers })).json()).data;
  expect(shift.expectedDrawer).toBe(100);
});

test('a points-only checkout and return need no cash payment', async ({ page }) => {
  await login(page, 'loyalty@example.test');
  const sale = await checkout(page, 1, '110', '0.00');
  await page.getByTitle('Quick refund', { exact: true }).click();
  const refund = page.getByRole('dialog', { name: 'Quick Refund', exact: true });
  await refund.getByPlaceholder('Enter sale number...').fill(sale.saleNumber);
  await refund.getByRole('button', { name: 'Find sale', exact: true }).click();
  await refund.getByRole('button', { name: 'Select all', exact: true }).click();
  await expect(refund.getByText(/110 redeemed points will be restored/)).toBeVisible();
  await page.screenshot({ path: 'test-results/points-only-refund.png', fullPage: true });
  const saved = page.waitForResponse(r => r.url().endsWith('/refund') && r.request().method() === 'POST');
  await refund.getByRole('button', { name: 'Refund $0.00', exact: true }).click();
  await confirmInApp(page, 'Refund $0.00?', 'Refund');
  const response = await saved; expect(response.status()).toBe(200);
  expect((await response.json()).refund).toMatchObject({ amount: 0, pointsRestored: 110 });
});
