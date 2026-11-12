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

test('My Stores shows each of the owner\'s stores and opens one', async ({ page }) => {
  await login(page, 'stores@example.test');
  await page.getByRole('link', { name: 'My Stores', exact: true }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/stores$/);
  const card = (name: string) => page.getByRole('region', { name, exact: true });
  await expect(card('North Street Store')).toContainText('Working here');
  await expect(card('South Street Store')).toContainText('Sales today');
  await expect(card('South Street Store')).toContainText('No closed drawers yet');
  await page.getByRole('button', { name: 'Open South Street Store', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(selectField(page, 'Switch store').filter({ visible: true })).toContainText('South Street Store');
  await expect(page.getByText('Last 7 days', { exact: true }).locator('..')).toContainText('$42.00');
});

test('an owner lets a cashier also work at their other store, and takes it back', async ({ page }, info) => {
  await login(page, 'stores@example.test');
  await page.goto('/team-time/staff');
  await page.getByRole('button', { name: 'Give access to another store', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Give access to another store' });
  await expect(selectField(dialog, 'Team member')).toContainText('Nora North');
  await expect(selectField(dialog, 'Store')).toContainText('South Street Store');
  await dialog.getByRole('button', { name: 'Give Access', exact: true }).click();
  await expect(page.getByText('Nora can now work at South Street Store as cashier')).toBeVisible();
  const grants = page.getByRole('table', { name: 'Access to other stores' });
  await expect(grants.getByRole('row').filter({ hasText: 'Nora North' })).toContainText('South Street Store');
  await page.screenshot({ path: info.outputPath('team-access.png'), fullPage: true });

  // At South Street, Nora is listed as also working there.
  await chooseOption(selectField(page, 'Switch store').filter({ visible: true }), 'South Street Store');
  const staffRow = page.getByRole('table', { name: 'Staff', exact: true }).getByRole('row').filter({ hasText: 'Nora North' });
  await expect(staffRow).toContainText('Also works here');
  await expect(staffRow).toContainText('Managed at their home store');
  await page.screenshot({ path: info.outputPath('team-also-works-here.png'), fullPage: true });
  await chooseOption(selectField(page, 'Switch store').filter({ visible: true }), 'North Street Store');

  await grants.getByRole('button', { name: 'Remove Nora North from South Street Store', exact: true }).click();
  await confirmInApp(page, 'Remove access?', 'Remove Access');
  await expect(page.getByText('No one works in more than one store yet')).toBeVisible();
});

test('the platform admin sees which business a store belongs to and its owners', async ({ page }, info) => {
  await login(page, 'platform@example.test');
  await page.goto('/admin/stores');
  const row = page.getByRole('row').filter({ hasText: 'South Street Store' });
  await expect(row).toContainText('North Street Store'); // the business, named after its first store
  await row.getByRole('button', { name: 'Business and owners for South Street Store', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Business and owners' });
  await expect(dialog).toContainText('Part of North Street Store');
  await expect(dialog.getByRole('listitem').filter({ hasText: 'stores@example.test' })).toContainText('Multi Store');
  await expect(dialog.getByRole('button', { name: 'Remove Multi Store as owner', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('store-business.png'), fullPage: true });
});
