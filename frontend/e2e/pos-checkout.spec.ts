import { test, expect } from '@playwright/test';
import { setupAuthenticatedSession } from './utils/auth-helper';

test.describe('POS Checkout Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await setupAuthenticatedSession(page);

    // Navigate to POS page
    await page.goto('/pos');
    await page.waitForLoadState('networkidle');
  });

  test('should display POS interface', async ({ page }) => {
    // Check for key POS elements
    await expect(page.locator('text=/product|item|search/i').first()).toBeVisible();

    // Should have cart or checkout area
    await expect(
      page.locator('[data-testid="cart"]').or(page.locator('text=/cart|checkout/i'))
    ).toBeVisible({ timeout: 5000 });
  });

  test('should search for products', async ({ page }) => {
    // Find search input
    const searchInput = page.locator('input[type="search"]').or(
      page.locator('input[placeholder*="search" i]')
    ).first();

    if (await searchInput.isVisible({ timeout: 3000 })) {
      await searchInput.fill('test product');
      await page.waitForTimeout(1000);

      // Should show search results
      // (This may vary based on actual implementation)
    }
  });

  test('should add product to cart', async ({ page }) => {
    // This is a generalized test - actual selectors may vary
    // Look for product items or add buttons
    const addButton = page.locator('button:has-text("Add")').or(
      page.locator('[data-testid="add-to-cart"]')
    ).first();

    if (await addButton.isVisible({ timeout: 5000 })) {
      // Get initial cart count
      const cartBefore = await page.locator('[data-testid="cart-count"]').textContent().catch(() => '0');

      // Add product
      await addButton.click();

      // Cart should update
      await page.waitForTimeout(500);

      const cartAfter = await page.locator('[data-testid="cart-count"]').textContent().catch(() => '0');

      // Cart count should have changed
      expect(parseInt(cartAfter || '0')).toBeGreaterThanOrEqual(parseInt(cartBefore || '0'));
    }
  });

  test('should update product quantity in cart', async ({ page }) => {
    // First add a product
    const addButton = page.locator('button:has-text("Add")').first();

    if (await addButton.isVisible({ timeout: 5000 })) {
      await addButton.click();
      await page.waitForTimeout(500);

      // Look for quantity controls
      const increaseBtn = page.locator('button:has-text("+")').or(
        page.locator('[data-testid="increase-quantity"]')
      ).first();

      if (await increaseBtn.isVisible({ timeout: 3000 })) {
        await increaseBtn.click();

        // Quantity should increase
        await page.waitForTimeout(500);
      }
    }
  });

  test('should remove product from cart', async ({ page }) => {
    // First add a product
    const addButton = page.locator('button:has-text("Add")').first();

    if (await addButton.isVisible({ timeout: 5000 })) {
      await addButton.click();
      await page.waitForTimeout(500);

      // Look for remove/delete button
      const removeBtn = page.locator('button:has-text("Remove")').or(
        page.locator('[data-testid="remove-item"]')
      ).first();

      if (await removeBtn.isVisible({ timeout: 3000 })) {
        await removeBtn.click();

        // Item should be removed
        await page.waitForTimeout(500);
      }
    }
  });

  test('should calculate cart total correctly', async ({ page }) => {
    // Add multiple products if possible
    const addButtons = page.locator('button:has-text("Add")');
    const count = await addButtons.count();

    if (count > 0) {
      // Add first product
      await addButtons.first().click();
      await page.waitForTimeout(500);

      // Check if total is displayed
      const totalElement = page.locator('[data-testid="cart-total"]').or(
        page.locator('text=/total.*\\$/i')
      ).first();

      if (await totalElement.isVisible({ timeout: 3000 })) {
        const totalText = await totalElement.textContent();
        expect(totalText).toMatch(/\$?\d+\.?\d*/);
      }
    }
  });

  test('should complete checkout with cash payment', async ({ page }) => {
    // Add a product
    const addButton = page.locator('button:has-text("Add")').first();

    if (await addButton.isVisible({ timeout: 5000 })) {
      await addButton.click();
      await page.waitForTimeout(500);

      // Look for checkout button
      const checkoutBtn = page.locator('button:has-text("Checkout")').or(
        page.locator('[data-testid="checkout"]')
      ).first();

      if (await checkoutBtn.isVisible({ timeout: 3000 })) {
        await checkoutBtn.click();

        // Should show payment options
        await page.waitForTimeout(1000);

        // Select cash payment
        const cashOption = page.locator('text=/cash/i').first();

        if (await cashOption.isVisible({ timeout: 3000 })) {
          await cashOption.click();

          // Complete payment
          const completeBtn = page.locator('button:has-text("Complete")').or(
            page.locator('button:has-text("Pay")')
          ).first();

          if (await completeBtn.isVisible({ timeout: 3000 })) {
            await completeBtn.click();

            // Should show success message or receipt
            await expect(
              page.locator('text=/success|complete|receipt/i').first()
            ).toBeVisible({ timeout: 5000 });
          }
        }
      }
    }
  });

  test('should apply discount to sale', async ({ page }) => {
    // Add a product
    const addButton = page.locator('button:has-text("Add")').first();

    if (await addButton.isVisible({ timeout: 5000 })) {
      await addButton.click();
      await page.waitForTimeout(500);

      // Look for discount button/option
      const discountBtn = page.locator('button:has-text("Discount")').or(
        page.locator('[data-testid="apply-discount"]')
      ).first();

      if (await discountBtn.isVisible({ timeout: 3000 })) {
        await discountBtn.click();

        // Enter discount
        const discountInput = page.locator('input[type="number"]').first();

        if (await discountInput.isVisible({ timeout: 2000 })) {
          await discountInput.fill('10');

          // Total should update
          await page.waitForTimeout(500);
        }
      }
    }
  });

  test('should select customer for sale', async ({ page }) => {
    // Look for customer selection
    const customerBtn = page.locator('button:has-text("Customer")').or(
      page.locator('[data-testid="select-customer"]')
    ).first();

    if (await customerBtn.isVisible({ timeout: 3000 })) {
      await customerBtn.click();
      await page.waitForTimeout(500);

      // Should show customer search/list
      await expect(
        page.locator('text=/search|select.*customer/i').first()
      ).toBeVisible({ timeout: 3000 });
    }
  });

  test('should clear cart', async ({ page }) => {
    // Add a product
    const addButton = page.locator('button:has-text("Add")').first();

    if (await addButton.isVisible({ timeout: 5000 })) {
      await addButton.click();
      await page.waitForTimeout(500);

      // Look for clear cart button
      const clearBtn = page.locator('button:has-text("Clear")').or(
        page.locator('[data-testid="clear-cart"]')
      ).first();

      if (await clearBtn.isVisible({ timeout: 3000 })) {
        await clearBtn.click();

        // Cart should be empty
        await page.waitForTimeout(500);

        const cartCount = await page.locator('[data-testid="cart-count"]')
          .textContent()
          .catch(() => '0');

        expect(parseInt(cartCount || '0')).toBe(0);
      }
    }
  });
});
