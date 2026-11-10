import { test, expect, Page } from '@playwright/test';
import { login, TEST_USER } from './utils/auth-helper';

const apiToken = async (page: Page, email: string) => {
  const response = await page.request.post('/api/auth/login', { data: { email, password: TEST_USER.password } });
  expect(response.status()).toBe(200);
  return (await response.json()).data.token as string;
};
const enterPin = async (page: Page, pin: string) => {
  await page.getByLabel('PIN', { exact: true }).fill(pin);
  await page.keyboard.press('Enter');
};

test('staff sign in by name and PIN on a set-up register, lock it, and switch cashier', async ({ page }, info) => {
  // Fresh PINs for the fixture owner and cashier; removed again at the end.
  const cashierToken = await apiToken(page, 'cashier@example.test');
  expect((await page.request.put('/api/auth/pin', { headers: { Authorization: 'Bearer ' + cashierToken }, data: { currentPassword: TEST_USER.password, pin: '4821' } })).status()).toBe(200);

  await login(page, 'owner@example.test');
  // Your own PIN, set in Settings with your password.
  await page.goto('/settings?section=profile');
  await page.getByRole('button', { name: 'Set a PIN', exact: true }).click();
  const pinForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Save PIN', exact: true }) });
  await pinForm.getByLabel('Current password', { exact: true }).fill(TEST_USER.password);
  await pinForm.getByLabel('PIN', { exact: true }).fill('1234');
  await pinForm.getByLabel('Repeat PIN', { exact: true }).fill('1234');
  await pinForm.getByRole('button', { name: 'Save PIN', exact: true }).click();
  await expect(page.getByText(/harder to guess/)).toBeVisible();
  await pinForm.getByLabel('PIN', { exact: true }).fill('2580');
  await pinForm.getByLabel('Repeat PIN', { exact: true }).fill('2580');
  await pinForm.getByRole('button', { name: 'Save PIN', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Change PIN', exact: true })).toBeVisible();

  // A manager sets this computer up once.
  await page.goto('/settings?section=devices');
  await page.getByLabel('Register name', { exact: true }).fill('Front counter');
  await page.getByRole('button', { name: 'Set up this computer', exact: true }).click();
  await expect(page.getByText(/This computer is Front counter at/)).toBeVisible();
  await page.screenshot({ path: info.outputPath('register-settings.png'), fullPage: true, animations: 'disabled' });

  // Lock: everything underneath stays, keys do not reach the register.
  await page.goto('/pos');
  await page.getByRole('button', { name: 'Lock', exact: true }).click();
  const lock = page.getByRole('dialog', { name: 'Register locked', exact: true });
  await expect(lock).toBeVisible();
  await page.keyboard.press('F1');
  await expect(page.getByRole('dialog', { name: 'Payment', exact: true })).toHaveCount(0);
  await enterPin(page, '0000');
  await expect(lock.getByRole('alert')).toHaveText('Wrong PIN. 4 tries left.');
  await page.screenshot({ path: info.outputPath('register-locked.png'), animations: 'disabled' });
  await enterPin(page, '2580');
  await expect(lock).toHaveCount(0);

  // Switch cashier: pick a name, enter their PIN; the owner's session ends.
  const ownerToken = await page.evaluate(() => localStorage.getItem('token'));
  await page.getByRole('button', { name: 'Lock', exact: true }).click();
  await lock.getByRole('button', { name: 'Switch cashier', exact: true }).click();
  await lock.getByRole('button', { name: /^cashier F\./ }).click();
  await enterPin(page, '1111');
  await expect(lock.getByRole('alert')).toContainText('Wrong PIN');
  await enterPin(page, '4821');
  await expect(lock).toHaveCount(0);
  await expect(page.locator('.pos-topbar').getByText('cashier Fixture', { exact: true })).toBeVisible();
  expect((await page.request.get('/api/auth/me', { headers: { Authorization: 'Bearer ' + ownerToken } })).status()).toBe(401);

  // Signed out, the register opens on "Who is signing in?".
  await page.goto('/customers');
  await page.getByRole('button', { name: 'Logout', exact: true }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('Who is signing in?', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('register-sign-in.png'), animations: 'disabled' });
  await page.getByRole('button', { name: /^owner F\./ }).click();
  await enterPin(page, '2580');
  await expect(page).toHaveURL(/\/pos$/);

  // Clean up: remove this register and both PINs.
  await page.goto('/settings?section=devices');
  await page.getByRole('button', { name: 'Stop using as a register', exact: true }).click();
  await page.getByRole('button', { name: 'Remove register', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Set up this computer', exact: true })).toBeVisible();
  const owner = { Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token')) };
  expect((await page.request.delete('/api/auth/pin', { headers: owner })).status()).toBe(200);
  expect((await page.request.delete('/api/auth/pin', { headers: { Authorization: 'Bearer ' + await apiToken(page, 'cashier@example.test') } })).status()).toBe(200);
});
