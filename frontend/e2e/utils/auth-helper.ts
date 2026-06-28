import { Page } from '@playwright/test';

/**
 * Test user credentials
 */
export const TEST_USER = {
  email: 'admin@possystem.com',
  password: 'Admin123!',
  role: 'ADMIN',
};

export const TEST_CASHIER = {
  email: 'cashier@possystem.com',
  password: 'Cashier123!',
  role: 'CASHIER',
};

/**
 * Login helper function
 */
export async function login(page: Page, email: string, password: string) {
  await page.goto('/login');

  // Wait for login form to be visible
  await page.waitForSelector('input[type="email"]', { timeout: 5000 });

  // Fill in credentials
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);

  // Click login button
  await page.click('button[type="submit"]');

  // Wait for navigation to complete
  await page.waitForURL(/\/(dashboard|pos)/, { timeout: 10000 });
}

/**
 * Logout helper function
 */
export async function logout(page: Page) {
  // Look for user menu or logout button
  await page.click('[data-testid="user-menu"]', { timeout: 5000 }).catch(() => {
    // If data-testid doesn't exist, try finding by text
    page.click('text=Logout').catch(() => {
      // Fallback: navigate to login
      page.goto('/login');
    });
  });
}

/**
 * Check if user is authenticated
 */
export async function isAuthenticated(page: Page): Promise<boolean> {
  try {
    await page.waitForURL(/\/(dashboard|pos)/, { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Setup authenticated session
 * This can be used in test.beforeEach to avoid repeated logins
 */
export async function setupAuthenticatedSession(page: Page) {
  await login(page, TEST_USER.email, TEST_USER.password);
}
