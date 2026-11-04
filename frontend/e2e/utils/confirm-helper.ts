import { Page, expect } from '@playwright/test';

/** Answer an in-app confirmation (they replaced the browser's confirm pop-ups). */
export async function confirmInApp(page: Page, title: string | RegExp, button: string) {
  const dialog = page.getByRole('dialog', { name: title, exact: typeof title === 'string' });
  await dialog.getByRole('button', { name: button, exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
