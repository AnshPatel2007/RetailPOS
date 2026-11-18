import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';

// Real push subscriptions need a live push service, so they are covered by the API tests
// (phoneAlerts.workflow.test.ts). Here: the cards, the owner's amounts, and where a tap lands.
test('owners set alert amounts and see the phone alerts card; a tapped alert opens its page', async ({ page }) => {
  await login(page, 'owner@example.test');
  await page.goto('/settings?section=profile');
  const card = page.locator('.card, [class*="card"]').filter({ has: page.getByText('Alerts On This Phone', { exact: true }) }).first();
  await expect(card).toBeVisible();
  // The test server has no push keys: the card says so instead of offering a button that cannot work.
  await expect(card).toContainText('not set up on this server yet');

  await page.goto('/settings?section=notifications');
  const refund = page.getByLabel('Refund or void of at least ($)', { exact: true });
  await expect(refund).toHaveValue('50');
  await refund.fill('75');
  // Store Pulse switches sit beside the amounts, all on until the owner turns one off.
  await expect(page.getByLabel('A register not heard from while its drawer is open', { exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Save Changes', exact: true }).last().click();
  await expect(page.getByText('Store alerts saved', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Refund or void of at least ($)', { exact: true })).toHaveValue('75');

  const locationId = await page.evaluate(() => JSON.parse(localStorage.getItem('user') || '{}').locationId as string);
  await page.goto(`/alerts/open?store=${locationId}&to=${encodeURIComponent('/financial?tab=ahead')}`);
  await expect(page).toHaveURL(/\/financial\?tab=ahead$/);
  // Never another site.
  await page.goto(`/alerts/open?store=${locationId}&to=${encodeURIComponent('https://evil.example/')}`);
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('cashiers get no phone alerts and never see the amounts', async ({ page }) => {
  await login(page, 'cashier@example.test');
  await page.goto('/settings?section=profile');
  await expect(page.getByText('User Profile', { exact: true })).toBeVisible();
  await expect(page.getByText('Alerts On This Phone', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Store Alerts', { exact: true })).toHaveCount(0);
  const token = await page.evaluate(() => localStorage.getItem('token'));
  expect((await page.request.get('/api/pulse/settings', { headers: { Authorization: 'Bearer ' + token } })).status()).toBe(403);
});
