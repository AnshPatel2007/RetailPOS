import { test, expect, Page } from '@playwright/test';
import { login, logout } from './utils/auth-helper';

async function terminalPayment(page: Page, reference: string) {
  await login(page, 'loyalty@example.test');
  await page.goto('/pos');
  await page.getByRole('button', { name: /Fixture Loyalty.*in stock/ }).click();
  await page.getByRole('button', { name: 'Charge $1.10', exact: true }).click();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  const payment = page.getByRole('dialog', { name: 'Payment', exact: true });
  await payment.getByRole('button', { name: 'Card (external)', exact: true }).click();
  await payment.getByPlaceholder('Terminal approval / transaction reference').fill(reference);
  await expect(payment.getByRole('button', { name: /^Save payment / })).toBeEnabled();
  return payment;
}

test('a lost terminal sale response survives reload and retries the same transaction once', async ({ page }) => {
  const payment = await terminalPayment(page, 'RECOVERY-LOST-RESPONSE');
  let committedId = '', originalPayload: unknown;
  await page.route('**/api/sales', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    originalPayload = route.request().postDataJSON();
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    committedId = (await response.json()).data.id;
    await route.abort('failed');
  });
  await payment.getByRole('button', { name: /^Save payment / }).click();
  await expect(page.getByRole('dialog', { name: 'Payment requires reconciliation' })).toBeVisible();
  await page.reload();
  const recovery = page.getByRole('dialog', { name: 'Payment requires reconciliation' });
  await expect(recovery).toContainText('RECOVERY-LOST-RESPONSE');
  await expect(recovery).toContainText('Do not charge the customer again');
  await page.unroute('**/api/sales');
  const retried = page.waitForResponse(response => response.url().endsWith('/api/sales') && response.request().method() === 'POST');
  await recovery.getByRole('button', { name: 'Retry saving sale' }).click();
  const response = await retried;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toEqual(originalPayload);
  expect((await response.json()).data.id).toBe(committedId);
  await expect(recovery).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: /Receipt/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /Fixture Loyalty.*in stock/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review payment' })).toHaveCount(0);
});

test('an unsaved terminal payment stays with its cashier through logout and can be saved after recovery', async ({ page }) => {
  const payment = await terminalPayment(page, 'RECOVERY-NOT-SAVED');
  await page.route('**/api/sales', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary save failure' }) })
    : route.continue());
  await payment.getByRole('button', { name: /^Save payment / }).click();
  const recovery = page.getByRole('dialog', { name: 'Payment requires reconciliation' });
  await expect(recovery).toContainText('RECOVERY-NOT-SAVED');
  await recovery.getByRole('button', { name: 'Retry saving sale' }).click();
  await expect(recovery.getByRole('alert')).toContainText('Temporary save failure');
  await logout(page);
  await login(page, 'owner@example.test');
  await page.goto('/pos');
  await expect(page.getByRole('button', { name: /Fixture.*in stock|Fixture.*left/ }).first()).toBeVisible();
  await expect(page.getByText('RECOVERY-NOT-SAVED')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review payment' })).toHaveCount(0);
  await logout(page);
  await login(page, 'loyalty@example.test');
  await page.goto('/pos');
  await expect(recovery).toContainText('RECOVERY-NOT-SAVED');
  await page.unroute('**/api/sales');
  const saved = page.waitForResponse(response => response.url().endsWith('/api/sales') && response.request().method() === 'POST');
  await recovery.getByRole('button', { name: 'Retry saving sale' }).click();
  expect((await saved).status()).toBe(201);
  await expect(recovery).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: /Receipt/ })).toBeVisible();
});
