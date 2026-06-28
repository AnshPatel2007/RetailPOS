# End-to-End (E2E) Testing with Playwright

This directory contains E2E tests for the POS System using Playwright.

## Overview

E2E tests simulate real user interactions with the application to ensure critical workflows function correctly across different browsers and devices.

## Test Coverage

### 1. Authentication Flow (`auth.spec.ts`)
- Login with valid/invalid credentials
- Logout functionality
- Session persistence
- Role-based access control
- Forgot password flow
- Protected route redirection

### 2. POS Checkout Flow (`pos-checkout.spec.ts`)
- Product search
- Add/remove products from cart
- Update quantities
- Apply discounts
- Customer selection
- Complete checkout with different payment methods
- Cart total calculations
- Clear cart functionality

### 3. Inventory Management (`inventory.spec.ts`)
- View product list
- Search and filter products
- Create new products
- Edit product details
- Adjust inventory stock
- Delete products
- Export inventory data
- Pagination

## Running Tests

### Prerequisites

```bash
# Install dependencies
npm install
```

### Run All Tests

```bash
# Run all E2E tests
npm run test:e2e

# Run tests in UI mode (interactive)
npm run test:e2e:ui

# Run tests in headed mode (see browser)
npm run test:e2e:headed
```

### Run Specific Tests

```bash
# Run only authentication tests
npx playwright test auth.spec.ts

# Run only POS tests
npx playwright test pos-checkout.spec.ts

# Run only inventory tests
npx playwright test inventory.spec.ts
```

### Run Tests in Specific Browser

```bash
# Chromium
npx playwright test --project=chromium

# Firefox
npx playwright test --project=firefox

# WebKit (Safari)
npx playwright test --project=webkit

# Mobile Chrome
npx playwright test --project="Mobile Chrome"
```

### Debug Tests

```bash
# Run tests in debug mode
npx playwright test --debug

# Run specific test in debug mode
npx playwright test auth.spec.ts --debug
```

## Test Configuration

Configuration is in `playwright.config.ts`. Key settings:

- **Base URL**: `http://localhost:5173` (configurable via `E2E_BASE_URL`)
- **Timeout**: 30 seconds per test
- **Retries**: 2 in CI, 0 locally
- **Screenshots**: On failure
- **Videos**: On failure
- **Traces**: On first retry

## Writing Tests

### Test Structure

```typescript
import { test, expect } from '@playwright/test';
import { setupAuthenticatedSession } from './utils/auth-helper';

test.describe('Feature Name', () => {
  test.beforeEach(async ({ page }) => {
    // Setup before each test
    await setupAuthenticatedSession(page);
    await page.goto('/your-page');
  });

  test('should do something', async ({ page }) => {
    // Your test code
    await page.click('button');
    await expect(page.locator('text=Success')).toBeVisible();
  });
});
```

### Best Practices

1. **Use data-testid attributes**: Prefer `[data-testid="element"]` selectors
2. **Wait for network idle**: Use `waitForLoadState('networkidle')` for SPAs
3. **Handle timeouts**: Provide appropriate timeouts for slow operations
4. **Be resilient**: Use `.or()` for alternative selectors
5. **Clean up**: Reset state between tests using `beforeEach`
6. **Authenticate once**: Use `setupAuthenticatedSession()` helper

### Utility Functions

Located in `e2e/utils/`:

- `auth-helper.ts`: Authentication utilities
  - `login(page, email, password)`: Log in a user
  - `logout(page)`: Log out current user
  - `setupAuthenticatedSession(page)`: Quick login for tests
  - `isAuthenticated(page)`: Check auth status

## CI/CD Integration

Tests run automatically in CI with:
- All browsers (Chromium, Firefox, WebKit)
- Retry failed tests up to 2 times
- Generate HTML report
- Upload test artifacts

## Viewing Test Reports

After running tests:

```bash
# Open HTML report
npx playwright show-report
```

Reports include:
- Test results summary
- Screenshots of failures
- Videos of failed tests
- Trace files for debugging

## Troubleshooting

### Tests Timing Out

- Increase timeout in `playwright.config.ts`
- Check if application is running
- Verify network connectivity

### Flaky Tests

- Add explicit waits: `await page.waitForSelector()`
- Use `waitForLoadState('networkidle')`
- Check for race conditions
- Enable retries in config

### Element Not Found

- Verify selector is correct
- Check if element is in viewport
- Wait for element to be visible
- Use Playwright Inspector: `npx playwright test --debug`

## Environment Variables

```bash
# Custom base URL
E2E_BASE_URL=http://localhost:3000 npm run test:e2e

# Run in CI mode
CI=true npm run test:e2e
```

## Test Data

Test credentials are in `utils/auth-helper.ts`:

```typescript
TEST_USER = {
  email: 'admin@possystem.com',
  password: 'Admin123!',
  role: 'ADMIN',
}

TEST_CASHIER = {
  email: 'cashier@possystem.com',
  password: 'Cashier123!',
  role: 'CASHIER',
}
```

**Note**: Ensure these users exist in your test database.

## Adding New Tests

1. Create new spec file: `e2e/feature-name.spec.ts`
2. Import test utilities
3. Write test cases following existing patterns
4. Run tests locally
5. Commit changes

## Resources

- [Playwright Documentation](https://playwright.dev)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [Selector Strategies](https://playwright.dev/docs/selectors)
- [Debugging Tests](https://playwright.dev/docs/debug)
