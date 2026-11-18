import { test, expect } from '@playwright/test';
import { login, logout } from './utils/auth-helper';

// Seeded for this spec alone: pulse@example.test owns Pulse Street (an open "nobody has
// clocked in" alert, as the once-a-minute check raises it) and Quiet Street; Paula manages Pulse Street.
const sentence = 'Nobody had clocked in by 6:25 AM. On Mondays the store usually opens by 6:00 AM.';

test('the store\'s pulse shows on My Stores, in the bell and on Shifts; "closed today" clears it', async ({ page }) => {
  // The owner sees each store's line on My Stores: the alert, or that nobody is on.
  await login(page, 'pulse@example.test');
  await page.goto('/stores');
  await expect(page.getByRole('region', { name: 'Pulse Street Store' })).toContainText(sentence);
  await expect(page.getByRole('region', { name: 'Quiet Street Store' })).toContainText('Nobody is clocked in.');
  await logout(page);

  // The manager sees it under Alerts, with the page that deals with it.
  await login(page, 'pulse-manager@example.test');
  await page.goto('/dashboard');
  const bell = page.getByRole('button', { name: /^Alerts/ }).filter({ visible: true });
  await bell.click();
  const panel = page.getByRole('dialog', { name: 'Alerts', exact: true });
  const item = panel.getByRole('listitem').filter({ hasText: sentence });
  await expect(item).toBeVisible();
  await item.getByRole('link', { name: 'See shifts', exact: true }).click();
  await expect(page).toHaveURL(/\/team-time\/shifts$/);

  // Shifts: nobody is on, so the store can be marked closed for the day (a holiday).
  await expect(page.getByText(sentence, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'The Store Is Closed Today', exact: true }).click();
  await expect(page.getByText('Marked closed today', { exact: true })).toBeVisible();
  await expect(page.getByText('Marked closed today.', { exact: true })).toBeVisible();
  await expect(page.getByText(sentence, { exact: true })).toHaveCount(0);
  await page.reload();
  await bell.click();
  await expect(panel.getByRole('listitem').filter({ hasText: sentence })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Opened after all: the mark comes off (the closed alert stays closed).
  await page.getByRole('button', { name: 'Open After All', exact: true }).click();
  await expect(page.getByText('Marked open today', { exact: true })).toBeVisible();
  await expect(page.getByText('Nobody is clocked in.', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'The Store Is Closed Today', exact: true })).toBeVisible();
});
