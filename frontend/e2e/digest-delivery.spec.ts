import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';

test('owner can queue a morning brief and explicitly review an uncertain retry', async ({ page }) => {
  await login(page, 'owner@example.test'); await page.goto('/reports');
  await page.getByRole('navigation', { name: 'Reports views' }).getByRole('link', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Delivery History', exact: true }).click();
  const history = page.getByRole('dialog', { name: 'Morning brief deliveries', exact: true });
  await expect(history.getByText('Needs delivery review', { exact: true })).toBeVisible();
  await history.getByRole('button', { name: 'Review retry', exact: true }).click();
  await history.getByLabel('Reason for retry').fill('Provider history confirms no delivery');
  await expect(history.getByRole('button', { name: 'Queue retry', exact: true })).toBeDisabled();
  await history.getByRole('checkbox').check();
  const retried = page.waitForResponse(response => response.url().endsWith('/retry') && response.request().method() === 'POST');
  await history.getByRole('button', { name: 'Queue retry', exact: true }).click();
  expect((await retried).status()).toBe(200);
  await expect(history.getByText('Queued', { exact: true })).toBeVisible();
  await history.getByRole('button', { name: /close/i }).click();
  const queued = page.waitForResponse(response => response.url().endsWith('/daily-digest/send'));
  await page.getByRole('button', { name: 'Send Morning Brief', exact: true }).click();
  const response = await queued; expect(response.status()).toBe(200);
  const result = await response.json(); expect(result.data.deliveries.map((delivery: { recipientEmail: string }) => delivery.recipientEmail).sort()).toEqual(['accounts@example.test', 'loyalty@example.test', 'owner@example.test']); expect(result.data.deliveries.every((delivery: { status: string }) => delivery.status === 'QUEUED')).toBe(true);
  await expect(history).toBeVisible(); await expect(history.getByText('Queued', { exact: true })).toHaveCount(4);
  await expect(history.getByText(/Provider acceptance does not confirm arrival/)).toBeVisible();
  await history.screenshot({ path: 'test-results/digest-deliveries.png' });
});

test('manager cannot see owner morning brief controls', async ({ page }) => {
  await login(page, 'manager@example.test'); await page.goto('/reports');
  await page.getByRole('navigation', { name: 'Reports views' }).getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send Morning Brief', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delivery History', exact: true })).toHaveCount(0);
});
