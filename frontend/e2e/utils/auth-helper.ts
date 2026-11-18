import { Page, expect } from '@playwright/test';
export const TEST_USER = { email: 'owner@example.test', password: 'BrowserTest123!' };
export const TEST_CASHIER = { email: 'cashier@example.test', password: 'BrowserTest123!' };
export async function login(page: Page, email: string, password = TEST_USER.password) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page).toHaveURL(/\/(dashboard|pos|admin)$/);
}
export async function logout(page: Page) {
  await page.goto('/customers');
  const response = page.waitForResponse(r => r.url().endsWith('/api/auth/logout') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Logout', exact: true }).filter({ visible: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page).toHaveURL(/\/login$/);
}
export async function setupAuthenticatedSession(page: Page) { await login(page, TEST_USER.email); }
