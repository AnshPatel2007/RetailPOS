import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';

test('owner accounts and team views retain their distinct actions', async ({ page }) => {
  await login(page, 'owner@example.test'); await page.goto('/gift-cards');
  await expect(page).toHaveURL(/\/customers\/accounts\/gift-cards$/);
  const accounts = page.getByRole('navigation', { name: 'Customers / Accounts views' });
  await accounts.getByRole('link', { name: 'Store Credits' }).click();
  await expect(accounts.getByRole('link', { name: 'Store Credits', exact: true })).toHaveAttribute('aria-current', 'page');
  await accounts.getByRole('link', { name: 'House Accounts' }).click();
  await expect(accounts.getByRole('link', { name: 'House Accounts', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.goto('/team'); await expect(page).toHaveURL(/\/team-time\/staff$/);
  const team = page.getByRole('navigation', { name: 'Team & Time views' });
  await expect(team.getByRole('link', { name: 'Payroll' })).toBeVisible();
  await team.getByRole('link', { name: 'Shifts' }).click();
  await expect(page.getByRole('heading', { name: 'Team & Time', exact: true })).toBeVisible();
  await page.goto('/customers/insights?analysis=segments');
  await expect(page.getByRole('button', { name: 'Customer Segments', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: 'Email Campaign', exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByRole('button', { name: 'Customer Segments', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('manager and cashier see only permitted team and customer actions', async ({ page }) => {
  await login(page, 'manager@example.test'); await page.goto('/shifts');
  await expect(page).toHaveURL(/\/team-time\/shifts$/);
  const team = page.getByRole('navigation', { name: 'Team & Time views' });
  await expect(team.getByRole('link', { name: 'Payroll' })).toHaveCount(0);
  await expect(team.getByRole('link', { name: 'Staff' })).toHaveCount(0);
  await page.goto('/customers/insights');
  await expect(page.getByRole('heading', { name: 'Customer Insights', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Email Campaign', exact: true })).toHaveCount(0);
  await page.goto('/team-time/payroll'); await expect(page.getByText('Access Denied', { exact: true })).toBeVisible();
});

test('cashier has My Shift and no customer analytics or account-management route', async ({ page }) => {
  await login(page, 'cashier@example.test'); await page.goto('/shifts');
  await expect(page).toHaveURL(/\/my-shift$/);
  await expect(page.getByRole('link', { name: 'My Shift', exact: true })).toBeVisible();
  for (const path of ['/customers/insights', '/gift-cards', '/team-time/staff']) {
    await page.goto(path); await expect(page.getByText('Access Denied', { exact: true })).toBeVisible();
  }
});

test('platform integrations stay in the admin shell without payroll access', async ({ page }) => {
  await login(page, 'platform@example.test'); await page.goto('/developers');
  await expect(page).toHaveURL(/\/admin\/integrations$/);
  await expect(page.getByRole('link', { name: 'Stores', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /payroll|reports/i })).toHaveCount(0);
  await page.goto('/team-time/payroll'); await expect(page.getByText('Access Denied', { exact: true })).toBeVisible();
});

test('store previews identify their scope, discard earlier requests and offer an exit', async ({ page }) => {
  await login(page, 'platform@example.test'); await page.goto('/admin/stores');
  await page.getByRole('cell', { name: 'Store A Tax Rate: 10%', exact: true }).click();
  await page.getByRole('button', { name: 'Preview store', exact: true }).click();
  await expect(page.getByText('Viewing: Store A', { exact: true })).toBeVisible();
  await page.goto('/inventory');
  await expect(page.getByRole('cell').filter({ has: page.getByText('Fixture Coffee', { exact: true }) })).toBeVisible();
  let release!: () => void, started!: () => void, finished!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { started = resolve; });
  const completed = new Promise<void>(resolve => { finished = resolve; });
  await page.route('**/api/products?*', async route => {
    if (new URL(route.request().url()).searchParams.get('search') !== 'Fixture Coffee') return route.continue();
    const response = await route.fetch(); started(); await held;
    try { await route.fulfill({ response }); } finally { finished(); }
  });
  await page.getByPlaceholder('Search by name, SKU, or barcode...').fill('Fixture Coffee'); await ready;
  await page.getByRole('button', { name: 'Exit View', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/stores');
  await page.getByRole('cell', { name: 'Store B Tax Rate: 10%', exact: true }).click();
  await page.getByRole('button', { name: 'Preview store', exact: true }).click();
  await page.goto('/inventory');
  await expect(page.getByText('Viewing: Store B', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell').filter({ has: page.getByText('Fixture Received', { exact: true }) })).toBeVisible();
  release(); await completed;
  await expect(page.getByRole('cell').filter({ has: page.getByText('Fixture Coffee', { exact: true }) })).toHaveCount(0);
  await page.goto('/shifts'); await expect(page.getByRole('button', { name: 'Clock In', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Exit View', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
});
