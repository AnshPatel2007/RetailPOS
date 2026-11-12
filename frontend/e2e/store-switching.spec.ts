import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';
import { confirmInApp } from './utils/confirm-helper';
import { chooseOption, selectField } from './utils/select-helper';

// stores@example.test owns North Street and South Street, one business seeded for this
// spec alone: South Street sold $42.00 two days ago, North Street sold nothing.
test('an owner switches between their stores, and a sale in the cart keeps them where they are', async ({ page }) => {
  await login(page, 'stores@example.test');
  const switcher = selectField(page, 'Switch store').filter({ visible: true });
  const week = page.getByText('Last 7 days', { exact: true }).locator('..');
  await expect(switcher).toContainText('North Street Store');
  await expect(week).toContainText('$0.00');

  // A sale in progress belongs to this store: switching waits until it is finished or cleared.
  await page.goto('/pos');
  await page.getByPlaceholder('Search products... (/ or F3)', { exact: true }).fill('North Only Lemonade');
  await page.getByRole('button', { name: /^North Only Lemonade/ }).click();
  const cart = page.locator('[data-sale-cart]').filter({ visible: true });
  await expect(cart.getByText('North Only Lemonade')).toBeVisible();
  await page.goto('/dashboard');
  await chooseOption(switcher, 'South Street Store');
  await expect(page.getByText('Finish or clear the sale in the cart before switching stores.')).toBeVisible();
  await expect(switcher).toContainText('North Street Store');
  await expect(week).toContainText('$0.00');

  await page.goto('/pos');
  await cart.getByRole('button', { name: 'Clear cart', exact: true }).click();
  await confirmInApp(page, 'Clear all 1 item?', 'Clear cart');
  await page.goto('/dashboard');
  await chooseOption(switcher, 'South Street Store');
  await expect(page.getByText('Now working in South Street Store')).toBeVisible();
  await expect(switcher).toContainText('South Street Store');
  await expect(week).toContainText('$42.00');

  // The product list is South Street's; North Street's lemonade is not on it.
  await page.goto('/inventory');
  const productCell = (name: string) => page.getByRole('cell').filter({ has: page.getByText(name, { exact: true }) });
  await expect(productCell('South Only Iced Tea')).toBeVisible();
  await expect(productCell('North Only Lemonade')).toHaveCount(0);

  // The sign-in stays in South Street after a reload, and can go back.
  await page.reload();
  await expect(switcher).toContainText('South Street Store');
  await chooseOption(switcher, 'North Street Store');
  await expect(switcher).toContainText('North Street Store');
  await expect(productCell('North Only Lemonade')).toBeVisible();
  await expect(productCell('South Only Iced Tea')).toHaveCount(0);
});
