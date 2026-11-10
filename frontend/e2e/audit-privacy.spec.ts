import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';

test('manager activity hides wage events and expands only sanitized details', async ({ page }) => {
  await login(page, 'manager@example.test'); await page.goto('/audit-log');
  const search = page.getByPlaceholder('Search actions, entities, IDs...');
  await search.fill('HOURLY_RATE_UPDATED');
  await expect(page.getByText('No audit log entries found', { exact: true })).toBeVisible();
  await search.fill('PRIVACY-FIXTURE');
  await page.getByRole('button', { name: 'View details', exact: true }).click();
  const details = page.locator('[id^="audit-details-"]');
  await expect(details).toContainText('Safe value'); await expect(details).toContainText('[Redacted]');
  await expect(details).not.toContainText('secret-audit-password'); await expect(details).not.toContainText('987');
  await expect(details).not.toContainText('hourlyRate'); await expect(details).not.toContainText('Hourly Rate');
  await page.screenshot({ path: 'test-results/audit-manager-privacy.png', fullPage: true });
});

test('owner keeps wage history and failed reads show a retryable error instead of an empty log', async ({ page }) => {
  await login(page, 'owner@example.test'); await page.goto('/audit-log');
  await page.getByPlaceholder('Search actions, entities, IDs...').fill('WAGE-FIXTURE');
  await expect(page.getByRole('button', { name: 'View details', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'View details', exact: true }).click();
  const details = page.locator('[id^="audit-details-"]');
  await expect(details).toContainText('23'); await expect(details).toContainText('17');
  await page.route('**/api/audit-logs?**', route => route.fulfill({ status: 503, json: { error: 'Unavailable' } }));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('status').filter({ hasText: 'Updates are unavailable.' })).toContainText('Updates are unavailable. Showing previously loaded data.');
  await expect(page.getByText('No audit log entries found', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Hide details', exact: true })).toBeVisible();
  await page.unroute('**/api/audit-logs?**');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('Updates are unavailable. Showing previously loaded data.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Hide details', exact: true })).toBeVisible();
});
