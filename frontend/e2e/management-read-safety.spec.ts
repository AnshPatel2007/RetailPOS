import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';

for (const scenario of [
  { user: 'owner@example.test', path: '/team-time/staff', endpoint: '**/api/users*', message: 'Staff could not be loaded.', empty: 'No team members yet' },
  { user: 'platform@example.test', path: '/admin/users', endpoint: '**/api/users*', message: 'Users could not be loaded.', empty: 'No users found' },
  { user: 'platform@example.test', path: '/admin/stores', endpoint: '**/api/locations*', message: 'Stores could not be loaded.', empty: 'No stores yet' },
  { user: 'platform@example.test', path: '/admin/integrations', endpoint: '**/api/developer/api-keys*', message: 'Integrations could not be loaded.', empty: 'No API keys yet' },
]) {
  test(`${scenario.path} keeps failed reads distinct from an empty page and offers Retry`, async ({ page }) => {
    await login(page, scenario.user);
    await page.route(scenario.endpoint, route => route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } }));
    await page.goto(scenario.path);
    const main = page.getByRole('main');
    await expect(main.locator('.page-header h1')).toBeVisible();
    await expect(main.getByRole('alert')).toContainText(scenario.message);
    await expect(main.getByText(scenario.empty, { exact: true })).toHaveCount(0);
    await page.unroute(scenario.endpoint);
    await main.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(main.getByRole('alert')).toHaveCount(0);
    if (scenario.path === '/admin/integrations') {
      await expect(main.getByRole('heading', { name: 'API Keys', exact: true })).toBeVisible();
      await expect(main.getByText('No API keys yet', { exact: true })).toBeVisible();
    } else await expect(main.getByRole('table').first()).toBeVisible();
  });
}
