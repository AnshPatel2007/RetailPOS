import { test, expect } from '@playwright/test';
import { login, logout, TEST_USER, TEST_CASHIER } from './utils/auth-helper';

test.describe('Authentication Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Start each test from the login page
    await page.goto('/login');
  });

  test('should display login page', async ({ page }) => {
    await expect(page).toHaveTitle(/POS System|Login/);
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('should show error for invalid credentials', async ({ page }) => {
    await page.fill('input[type="email"]', 'wrong@example.com');
    await page.fill('input[type="password"]', 'WrongPassword123!');
    await page.click('button[type="submit"]');

    // Wait for error message
    await expect(page.locator('text=/invalid|incorrect|wrong/i')).toBeVisible({
      timeout: 5000,
    });
  });

  test('should show validation error for empty fields', async ({ page }) => {
    await page.click('button[type="submit"]');

    // Should show validation errors
    await expect(
      page.locator('text=/required|email|password/i').first()
    ).toBeVisible({ timeout: 3000 });
  });

  test('should login successfully with valid credentials', async ({ page }) => {
    await login(page, TEST_USER.email, TEST_USER.password);

    // Should redirect to dashboard or POS
    await expect(page).toHaveURL(/\/(dashboard|pos)/);

    // Should show user info or navigation
    await expect(
      page.locator(`text=${TEST_USER.email}`).or(page.locator('[data-testid="user-menu"]'))
    ).toBeVisible({ timeout: 5000 });
  });

  test('should maintain session on page reload', async ({ page }) => {
    await login(page, TEST_USER.email, TEST_USER.password);

    // Reload the page
    await page.reload();

    // Should still be authenticated
    await expect(page).toHaveURL(/\/(dashboard|pos)/);
  });

  test('should logout successfully', async ({ page }) => {
    await login(page, TEST_USER.email, TEST_USER.password);

    // Logout
    await logout(page);

    // Should redirect to login
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
  });

  test('should redirect to login when accessing protected route', async ({ page }) => {
    await page.goto('/dashboard');

    // Should redirect to login
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
  });

  test('should handle forgot password flow', async ({ page }) => {
    // Look for forgot password link
    const forgotPasswordLink = page.locator('text=/forgot.*password/i');

    if (await forgotPasswordLink.isVisible({ timeout: 2000 })) {
      await forgotPasswordLink.click();

      // Should navigate to forgot password page
      await expect(page).toHaveURL(/\/forgot-password/, { timeout: 3000 });

      // Should have email input
      await expect(page.locator('input[type="email"]')).toBeVisible();
    }
  });

  test('should prevent access for different user roles', async ({ page }) => {
    // Login as cashier
    await login(page, TEST_CASHIER.email, TEST_CASHIER.password);

    // Try to access admin-only route
    await page.goto('/admin/users');

    // Should either redirect or show error
    await page.waitForTimeout(2000);
    const url = page.url();

    // Should not be on admin page
    expect(url).not.toContain('/admin/users');
  });
});
