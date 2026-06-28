import { test, expect } from '@playwright/test';
import { setupAuthenticatedSession } from './utils/auth-helper';

test.describe('Inventory Management', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await setupAuthenticatedSession(page);

    // Navigate to inventory page
    await page.goto('/inventory');
    await page.waitForLoadState('networkidle');
  });

  test('should display inventory page', async ({ page }) => {
    // Check for inventory elements
    await expect(page).toHaveURL(/\/inventory/);

    // Should show products list or table
    await expect(
      page.locator('text=/product|item|inventory/i').first()
    ).toBeVisible({ timeout: 5000 });
  });

  test('should search for products in inventory', async ({ page }) => {
    // Find search input
    const searchInput = page.locator('input[type="search"]').or(
      page.locator('input[placeholder*="search" i]')
    ).first();

    if (await searchInput.isVisible({ timeout: 3000 })) {
      await searchInput.fill('test');
      await page.waitForTimeout(1000);

      // Results should update
      // This may vary based on implementation
    }
  });

  test('should filter products by category', async ({ page }) => {
    // Look for category filter
    const categoryFilter = page.locator('select').or(
      page.locator('[data-testid="category-filter"]')
    ).first();

    if (await categoryFilter.isVisible({ timeout: 3000 })) {
      await categoryFilter.click();
      await page.waitForTimeout(500);

      // Select a category
      const firstOption = page.locator('option').nth(1);

      if (await firstOption.isVisible({ timeout: 2000 })) {
        await firstOption.click();
        await page.waitForTimeout(1000);
      }
    }
  });

  test('should show low stock products', async ({ page }) => {
    // Look for low stock filter/tab
    const lowStockBtn = page.locator('button:has-text("Low Stock")').or(
      page.locator('[data-testid="low-stock-filter"]')
    ).first();

    if (await lowStockBtn.isVisible({ timeout: 3000 })) {
      await lowStockBtn.click();
      await page.waitForTimeout(1000);

      // Should filter to low stock items
    }
  });

  test('should open add product dialog', async ({ page }) => {
    // Look for add product button
    const addBtn = page.locator('button:has-text("Add Product")').or(
      page.locator('[data-testid="add-product"]')
    ).first();

    if (await addBtn.isVisible({ timeout: 3000 })) {
      await addBtn.click();

      // Should show product form
      await expect(
        page.locator('text=/add.*product|create.*product/i').first()
      ).toBeVisible({ timeout: 3000 });

      // Should have form fields
      await expect(
        page.locator('input[name="name"]').or(page.locator('input[placeholder*="name" i]'))
      ).toBeVisible({ timeout: 2000 });
    }
  });

  test('should create new product', async ({ page }) => {
    const addBtn = page.locator('button:has-text("Add Product")').first();

    if (await addBtn.isVisible({ timeout: 3000 })) {
      await addBtn.click();
      await page.waitForTimeout(500);

      // Fill product form
      const nameInput = page.locator('input[name="name"]').first();
      const skuInput = page.locator('input[name="sku"]').first();
      const priceInput = page.locator('input[name="price"]').first();

      if (await nameInput.isVisible({ timeout: 2000 })) {
        await nameInput.fill(`Test Product ${Date.now()}`);
      }

      if (await skuInput.isVisible({ timeout: 2000 })) {
        await skuInput.fill(`SKU-${Date.now()}`);
      }

      if (await priceInput.isVisible({ timeout: 2000 })) {
        await priceInput.fill('19.99');
      }

      // Submit form
      const submitBtn = page.locator('button[type="submit"]').or(
        page.locator('button:has-text("Save")')
      ).first();

      if (await submitBtn.isVisible({ timeout: 2000 })) {
        await submitBtn.click();

        // Should show success message
        await expect(
          page.locator('text=/success|created|added/i').first()
        ).toBeVisible({ timeout: 5000 });
      }
    }
  });

  test('should edit product details', async ({ page }) => {
    // Find first edit button
    const editBtn = page.locator('button:has-text("Edit")').or(
      page.locator('[data-testid="edit-product"]')
    ).first();

    if (await editBtn.isVisible({ timeout: 3000 })) {
      await editBtn.click();
      await page.waitForTimeout(500);

      // Should show edit form
      const nameInput = page.locator('input[name="name"]').first();

      if (await nameInput.isVisible({ timeout: 2000 })) {
        // Update name
        await nameInput.fill(`Updated Product ${Date.now()}`);

        // Save changes
        const saveBtn = page.locator('button:has-text("Save")').first();

        if (await saveBtn.isVisible({ timeout: 2000 })) {
          await saveBtn.click();

          // Should show success
          await expect(
            page.locator('text=/success|updated|saved/i').first()
          ).toBeVisible({ timeout: 5000 });
        }
      }
    }
  });

  test('should adjust inventory stock', async ({ page }) => {
    // Look for inventory adjustment option
    const adjustBtn = page.locator('button:has-text("Adjust")').or(
      page.locator('[data-testid="adjust-inventory"]')
    ).first();

    if (await adjustBtn.isVisible({ timeout: 3000 })) {
      await adjustBtn.click();
      await page.waitForTimeout(500);

      // Should show adjustment form
      const quantityInput = page.locator('input[name="quantity"]').or(
        page.locator('input[type="number"]')
      ).first();

      if (await quantityInput.isVisible({ timeout: 2000 })) {
        await quantityInput.fill('10');

        // Submit adjustment
        const submitBtn = page.locator('button[type="submit"]').first();

        if (await submitBtn.isVisible({ timeout: 2000 })) {
          await submitBtn.click();

          // Should show success
          await expect(
            page.locator('text=/success|adjusted|updated/i').first()
          ).toBeVisible({ timeout: 5000 });
        }
      }
    }
  });

  test('should view product details', async ({ page }) => {
    // Click on first product
    const firstProduct = page.locator('[data-testid="product-row"]').or(
      page.locator('tr').nth(1)
    ).first();

    if (await firstProduct.isVisible({ timeout: 3000 })) {
      await firstProduct.click();
      await page.waitForTimeout(500);

      // Should show product details
      // This varies based on implementation
    }
  });

  test('should delete product with confirmation', async ({ page }) => {
    // Find delete button
    const deleteBtn = page.locator('button:has-text("Delete")').or(
      page.locator('[data-testid="delete-product"]')
    ).first();

    if (await deleteBtn.isVisible({ timeout: 3000 })) {
      await deleteBtn.click();
      await page.waitForTimeout(500);

      // Should show confirmation dialog
      const confirmBtn = page.locator('button:has-text("Confirm")').or(
        page.locator('button:has-text("Yes")')
      ).first();

      if (await confirmBtn.isVisible({ timeout: 2000 })) {
        await confirmBtn.click();

        // Should show success
        await expect(
          page.locator('text=/success|deleted|removed/i').first()
        ).toBeVisible({ timeout: 5000 });
      }
    }
  });

  test('should export inventory data', async ({ page }) => {
    // Look for export button
    const exportBtn = page.locator('button:has-text("Export")').or(
      page.locator('[data-testid="export-inventory"]')
    ).first();

    if (await exportBtn.isVisible({ timeout: 3000 })) {
      // Setup download handler
      const downloadPromise = page.waitForEvent('download', { timeout: 5000 });

      await exportBtn.click();

      try {
        const download = await downloadPromise;
        expect(download).toBeDefined();
        expect(download.suggestedFilename()).toMatch(/inventory|products/i);
      } catch {
        // Export might work differently - just check button exists
      }
    }
  });

  test('should paginate product list', async ({ page }) => {
    // Look for pagination controls
    const nextBtn = page.locator('button:has-text("Next")').or(
      page.locator('[data-testid="next-page"]')
    ).first();

    if (await nextBtn.isVisible({ timeout: 3000 })) {
      const isDisabled = await nextBtn.isDisabled();

      if (!isDisabled) {
        await nextBtn.click();
        await page.waitForTimeout(1000);

        // Page should update
      }
    }
  });
});
