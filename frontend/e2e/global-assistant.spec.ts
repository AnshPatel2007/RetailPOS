import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';

const open = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: 'Open POS assistant', exact: true }).click();
  return page.getByRole('dialog', { name: 'POS Assistant', exact: true });
};

for (const width of [1440, 768, 390]) {
  test(`assistant avoids checkout controls and fits a short ${width}px viewport`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 700 });
    await login(page, 'cashier@example.test');
    await page.goto('/pos');
    const launcher = page.getByRole('button', { name: 'Open POS assistant', exact: true });
    const controls = page.locator('[data-assistant-avoid]').filter({ visible: true }).first();
    await expect(controls).toBeVisible();
    await expect.poll(async () => {
      const button = await launcher.boundingBox(), footer = await controls.boundingBox();
      return !!button && !!footer && (button.y + button.height <= footer.y - 8 || button.x + button.width <= footer.x - 8);
    }).toBe(true);
    if (width >= 900) {
      const cart = (await page.locator('[data-sale-cart]').filter({ visible: true }).boundingBox())!;
      const button = (await launcher.boundingBox())!;
      expect(button.x + button.width).toBeLessThanOrEqual(cart.x - 8);
    }
    const dimensions = await launcher.boundingBox();
    expect(dimensions?.height).toBe(48); expect(dimensions?.width).toBe(48);
    const dialog = await open(page);
    const panel = await dialog.boundingBox();
    expect(panel!.y).toBeGreaterThanOrEqual(0);
    expect(panel!.y + panel!.height).toBeLessThanOrEqual(700);
    // Fixed checkout controls must not intercept the sheet's submit area.
    expect(await dialog.evaluate(element => {
      const submit = element.querySelector('button[type="submit"]')!;
      const rect = submit.getBoundingClientRect();
      return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    })).toBe(true);
    await page.screenshot({ path: info.outputPath('assistant-checkout-' + width + '.png') });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(launcher).toBeFocused();
    if (width < 900) {
      await page.getByRole('button', { name: 'Open sale cart', exact: true }).click();
      await expect(launcher).toBeDisabled();
      await page.getByRole('button', { name: 'Close sale cart', exact: true }).click();
      await expect(launcher).toBeEnabled();
    }
  });
}

test('anonymous assistant opens without calling a provider, preserves a failed question and excludes credentials/page contents', async ({ page }, info) => {
  const payloads: { question: string; history: unknown[]; pageContext: string }[] = [];
  let fail = true;
  await page.route('**/api/assistant/help', async route => {
    payloads.push(route.request().postDataJSON());
    expect(route.request().headers().authorization).toBeUndefined();
    await route.fulfill({ status: fail ? 503 : 200, json: fail ? { error: 'Unavailable' } : { success: true, data: { answer: 'Use the Forgot password link.' } } });
  });
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill('private-password-not-chat-context');
  const dialog = await open(page);
  await expect(dialog).toContainText('General POS help');
  expect(payloads).toHaveLength(0);
  await dialog.getByRole('textbox', { name: 'Message the assistant' }).fill('How do I reset my password?');
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('question is saved');
  await expect(dialog.getByRole('textbox')).toHaveValue('How do I reset my password?');
  fail = false;
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(dialog.getByRole('log')).toContainText('Use the Forgot password link.');
  expect(payloads).toHaveLength(2);
  expect(payloads[0]).toEqual({ question: 'How do I reset my password?', history: [], pageContext: 'sign-in' });
  expect(JSON.stringify(payloads)).not.toContain('private-password');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open POS assistant' })).toBeFocused();
  await page.goto('/reset-password?token=private-reset-token');
  const reset = await open(page);
  await reset.getByRole('textbox').fill('Help with recovery');
  await reset.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(reset.getByRole('log')).toContainText('Use the Forgot password link.');
  expect(payloads[2].pageContext).toBe('password-reset');
  expect(JSON.stringify(payloads)).not.toContain('private-reset-token');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(reset).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('assistant-login-phone.png') });
  await page.emulateMedia({ media: 'print' });
  await expect(reset).toBeHidden();
});

test('owner analysis persists across navigation and customer display uses an isolated general-help conversation', async ({ page }, info) => {
  const storePayloads: { question: string; history: unknown[] }[] = [];
  const helpPayloads: { question: string; history: unknown[] }[] = [];
  await page.route('**/api/analytics/chat*', async route => {
    storePayloads.push(route.request().postDataJSON());
    await route.fulfill({ json: { success: true, data: { answer: 'Authorized store answer.', toolTrace: [] } } });
  });
  await page.route('**/api/assistant/help', async route => {
    helpPayloads.push(route.request().postDataJSON());
    await route.fulfill({ json: { success: true, data: { answer: 'General display help.' } } });
  });
  await login(page, 'owner@example.test');
  let dialog = await open(page);
  await expect(dialog).toContainText('Read-only store analysis');
  expect(storePayloads).toHaveLength(0);
  await dialog.getByRole('textbox').fill('Show sales today');
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(dialog.getByRole('log')).toContainText('Authorized store answer.');
  await page.getByRole('button', { name: 'Inventory', exact: true }).click();
  await page.getByRole('link', { name: 'Products', exact: true }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/inventory$/);
  await expect(page.getByRole('heading', { name: 'Products', exact: true })).toBeVisible();
  await expect(dialog.getByRole('log')).toContainText('Authorized store answer.');
  await dialog.getByRole('textbox').fill('And yesterday?');
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => storePayloads.length).toBe(2);
  expect(storePayloads[1].history).toEqual([{ role: 'user', content: 'Show sales today' }, { role: 'assistant', content: 'Authorized store answer.' }]);
  await page.screenshot({ path: info.outputPath('assistant-owner-desktop.png') });
  await page.keyboard.press('Escape');
  // Preserve the application mount while changing to the customer-facing route.
  await page.evaluate(() => { history.pushState({}, '', '/customer-display'); dispatchEvent(new PopStateEvent('popstate')); });
  dialog = await open(page);
  await expect(dialog).toContainText('General POS help');
  await expect(dialog).not.toContainText('Authorized store answer.');
  await dialog.getByRole('textbox').fill('How does this display work?');
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(dialog.getByRole('log')).toContainText('General display help.');
  expect(helpPayloads[0].history).toEqual([]);
  expect(storePayloads).toHaveLength(2);
});

for (const email of ['cashier@example.test', 'platform@example.test']) {
  test(`${email} receives general help and never calls store analysis`, async ({ page }) => {
    let help = 0, store = 0;
    await page.route('**/api/assistant/help', route => { help++; return route.fulfill({ json: { data: { answer: 'General role help.' } } }); });
    await page.route('**/api/analytics/chat*', route => { store++; return route.fulfill({ status: 403, json: { error: 'Forbidden' } }); });
    await login(page, email);
    const dialog = await open(page);
    await expect(dialog).toContainText('General POS help');
    await dialog.getByRole('textbox').fill('How do I use POS?');
    await dialog.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(dialog).toContainText('General role help.');
    expect(help).toBe(1); expect(store).toBe(0);
  });
}

test('transaction dialogs take priority and a late owner response cannot enter a signed-out thread', async ({ page }) => {
  let started!: () => void, release!: () => void;
  const received = new Promise<void>(resolve => { started = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/analytics/chat*', async route => {
    started(); await held;
    try { await route.fulfill({ json: { data: { answer: 'Private late owner answer.' } } }); } catch { /* The old scope aborted its request. */ }
  });
  await login(page, 'owner@example.test');
  await page.getByRole('button', { name: 'Inventory', exact: true }).click();
  await page.getByRole('link', { name: 'Products', exact: true }).filter({ visible: true }).click();
  const dialog = await open(page);
  await dialog.getByRole('textbox').fill('Private question');
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await received;
  await page.getByRole('button', { name: 'Add Product', exact: true }).click();
  await expect(page.getByRole('dialog', { name: /^Add (?:New )?Product$/ })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open POS assistant' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open POS assistant' })).toBeEnabled();
  await page.getByRole('button', { name: 'Logout', exact: true }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  release();
  const guest = await open(page);
  await expect(guest).toContainText('General POS help');
  await expect(guest).not.toContainText(/Private question|Private late owner answer/);
  await expect(guest.getByRole('textbox')).toHaveValue('');
});

test('assistant respects the server retry delay while retaining the question', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/assistant/help', route => { calls++; return route.fulfill({ status: 429, headers: { 'Retry-After': '60' }, json: { error: 'Wait' } }); });
  await page.goto('/login');
  const dialog = await open(page);
  await dialog.getByRole('textbox').fill('Help me sign in');
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Retry in');
  await expect(dialog.getByRole('button', { name: 'Retry', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('textbox')).toHaveValue('Help me sign in');
  expect(calls).toBe(1);
});
