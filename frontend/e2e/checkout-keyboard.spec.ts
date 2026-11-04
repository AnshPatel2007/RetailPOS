import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';
import { confirmInApp } from './utils/confirm-helper';

test('a scan into the focused search box adds the item and F1, Enter completes a cash sale', async ({ page }) => {
  await login(page, 'owner@example.test');
  const headers = { Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token')) };
  const barcode = '70' + String(Date.now()).slice(-10);
  expect((await page.request.post('/api/products', { headers, data: {
    name: 'Keyboard item', sku: 'KEYBOARD-' + barcode, barcode, price: 4, cost: 2, stockQuantity: 20, trackInventory: true, isTaxable: false,
  } })).status()).toBe(201);
  await page.goto('/pos');
  const search = page.getByPlaceholder('Search products... (/ or F3)', { exact: true });
  const cart = page.locator('[data-sale-cart]').filter({ visible: true });

  // Scanner aimed while the cursor is in the search box.
  await search.click();
  await page.keyboard.type(barcode, { delay: 5 }); await page.keyboard.press('Enter');
  await expect(cart.getByText('Keyboard item')).toBeVisible();
  await expect(search).toHaveValue('');

  // Esc on an idle register never leaves it.
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/pos$/);

  // One shortcut hint, in the cart, with the full list a click away.
  await cart.getByRole('button', { name: /All shortcuts/ }).click();
  await expect(page.getByRole('heading', { name: 'Keyboard Shortcuts' })).toBeVisible();
  await page.getByRole('button', { name: 'Close keyboard shortcuts', exact: true }).click();

  // Clearing the cart asks in the app, and Keep keeps.
  await cart.getByRole('button', { name: 'Clear cart', exact: true }).click();
  await confirmInApp(page, 'Clear all 1 item?', 'Keep items');
  await expect(cart.getByText('Keyboard item')).toBeVisible();

  // F1 opens payment directly (no customer step); Enter charges the exact amount.
  await page.keyboard.press('F1');
  const payment = page.getByRole('dialog', { name: 'Payment', exact: true });
  await expect(payment.getByText('No customer on this sale')).toBeVisible();
  await expect(payment.getByRole('button', { name: 'Charge $4.00', exact: true })).toBeEnabled();
  await expect(payment.getByRole('spinbutton', { name: 'Amount Tendered' })).toBeFocused();
  const saved = page.waitForResponse(response => response.url().endsWith('/api/sales') && response.request().method() === 'POST');
  await page.keyboard.press('Enter');
  expect((await saved).status()).toBe(201);
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
});
