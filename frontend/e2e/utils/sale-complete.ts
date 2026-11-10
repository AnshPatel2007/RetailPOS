import { Page, expect } from '@playwright/test';

/** After a sale the cart shows "Sale complete" (change due, receipt options) instead of a pop-up. */
export const saleComplete = (page: Page) =>
  page.locator('[data-sale-cart]').filter({ visible: true }).getByRole('region', { name: 'Sale complete', exact: true });

/** Open the finished sale's receipt from the cart. */
export async function openReceipt(page: Page) {
  await expect(saleComplete(page)).toBeVisible();
  await saleComplete(page).getByRole('button', { name: 'View receipt', exact: true }).click();
  return page.getByRole('dialog', { name: 'Receipt', exact: true });
}
