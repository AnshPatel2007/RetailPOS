import { test, expect, type Page } from '@playwright/test';
import { login } from './utils/auth-helper';
import { chooseOption, selectField } from './utils/select-helper';

// catalog@example.test owns Elm Street and Oak Street, one business seeded for this spec alone.
// Both sell Sparkle Water under one barcode (Elm: "Sparkle Water 16 oz" $1.99, Oak: "Sparkle Water 16oz"
// $2.09); only Elm Street has Trail Mix.
const switchTo = async (page: Page, store: string) => {
  await chooseOption(selectField(page, 'Switch store').filter({ visible: true }), store);
  await expect(page.getByText(`Now working in ${store}`)).toBeVisible();
};
const productRow = (page: Page, name: string) => page.getByRole('table', { name: 'Products', exact: true }).getByRole('row').filter({ hasText: name });

test('an owner links the stores\' items, changes one for both stores, and adds another to the second store', async ({ page }, info) => {
  test.setTimeout(120000);
  await login(page, 'catalog@example.test');
  await page.goto('/inventory');
  await page.getByRole('link', { name: 'Shared Catalog', exact: true }).click();
  await expect(page).toHaveURL(/\/inventory\/catalog$/);
  await expect(page.getByText('No shared items yet')).toBeVisible();

  // Link: the same barcode in both stores is one item; the review shows what differs.
  await page.locator('.page-actions').getByRole('button', { name: 'Link Existing Products', exact: true }).click();
  const wizard = page.getByRole('dialog', { name: 'Link Existing Products' });
  await expect(selectField(wizard, 'Main store')).toContainText('Elm Street Store');
  await wizard.getByRole('button', { name: 'Find Matches', exact: true }).click();
  const match = wizard.getByRole('listitem').filter({ hasText: 'Same barcode' });
  await expect(match).toContainText('Sparkle Water 16 oz');
  await expect(match).toContainText('Oak Street Store: Sparkle Water 16oz · $2.09 · 6 in stock');
  await expect(match).toContainText('Differs: Name, SKU, Price');
  await page.screenshot({ path: info.outputPath('link-review.png'), animations: 'disabled' });
  await wizard.getByRole('button', { name: 'Link 1 item', exact: true }).click();
  await expect(page.getByText('2 store items linked as 1 shared item')).toBeVisible();
  const sparkle = page.getByRole('table', { name: 'Shared items' }).getByRole('row').filter({ hasText: 'SPARKLE-16' });
  await expect(sparkle).toContainText('Elm Street Store $1.99');
  await expect(sparkle).toContainText('Oak Street Store $2.09');

  // Edit once: the new name reaches both stores (opened once the notice has gone, for the picture).
  await expect(page.getByText('2 store items linked as 1 shared item')).toHaveCount(0, { timeout: 10000 });
  await sparkle.getByRole('button', { name: 'Edit Sparkle Water 16 oz', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit Shared Item' });
  await edit.getByLabel('Name', { exact: true }).fill('Sparkle Water Lime 16 oz');
  await page.screenshot({ path: info.outputPath('edit-shared-item.png'), animations: 'disabled' });
  await edit.getByRole('button', { name: 'Save 1 change', exact: true }).click();
  await expect(page.getByText('Sparkle Water Lime 16 oz changed in 2 stores')).toBeVisible();

  // One shared price, for every store that carries it.
  await sparkle.getByRole('button', { name: 'More actions for Sparkle Water Lime 16 oz', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Set Price', exact: true }).click();
  const price = page.getByRole('dialog', { name: 'Set Shared Price' });
  await price.getByLabel('Shared price', { exact: true }).fill('2.19');
  await price.getByRole('radio', { name: /^Every store that carries it/ }).check();
  await price.getByRole('button', { name: 'Save Price', exact: true }).click();
  await expect(page.getByText('Shared price saved; 2 store prices changed')).toBeVisible();
  await expect(sparkle).toContainText('Elm Street Store $2.19 follows');
  await expect(sparkle).toContainText('Oak Street Store $2.19 follows');

  // Trail Mix is only at Elm Street: share it from its item form, then add it to Oak Street.
  await page.goto('/inventory');
  await productRow(page, 'Trail Mix 6 oz').getByRole('button', { name: 'Edit Trail Mix 6 oz', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Edit Product' });
  await form.getByText('Shared catalog', { exact: true }).click();
  await form.getByRole('button', { name: 'Add to Shared Catalog', exact: true }).click();
  await expect(page.getByText('Trail Mix 6 oz is in the Shared Catalog. Add it to your other stores there.')).toBeVisible();
  await expect(form.getByText('Name, barcode and selling rules are managed in the Shared Catalog.')).toBeVisible();
  await form.getByRole('link', { name: 'Open Shared Catalog', exact: true }).click();
  await expect(page).toHaveURL(/\/inventory\/catalog$/);
  const trail = page.getByRole('table', { name: 'Shared items' }).getByRole('row').filter({ hasText: 'TRAIL-6' });
  await expect(trail).toContainText('Oak Street Store not carried');
  await trail.getByRole('button', { name: 'More actions for Trail Mix 6 oz', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add To Store', exact: true }).click();
  const add = page.getByRole('dialog', { name: 'Add To Store' });
  await expect(selectField(add, 'Store')).toContainText('Oak Street Store');
  await expect(add.getByRole('checkbox', { name: /^Follow the shared price/ })).toBeChecked();
  await add.getByRole('button', { name: 'Add Item', exact: true }).click();
  await expect(page.getByText('Trail Mix 6 oz added to Oak Street Store with stock 0')).toBeVisible();
  await expect(trail).toContainText('Oak Street Store $3.49 follows');
  // The picture: both shared items, once the notices have gone.
  await page.locator('main').getByRole('searchbox', { name: 'Search shared items' }).fill('');
  await expect(page.getByRole('table', { name: 'Shared items' }).getByRole('row').filter({ hasText: 'SPARKLE-16' })).toBeVisible();
  await expect(page.getByText(/^Trail Mix 6 oz (added to|is in)/)).toHaveCount(0, { timeout: 10000 });
  await page.screenshot({ path: info.outputPath('shared-catalog.png'), fullPage: true, animations: 'disabled' });

  // At Oak Street: the shared name and price, a locked form, and Trail Mix with no stock yet.
  await switchTo(page, 'Oak Street Store');
  await page.goto('/inventory');
  await expect(productRow(page, 'Trail Mix 6 oz')).toBeVisible();
  const oakSparkle = productRow(page, 'Sparkle Water Lime 16 oz');
  await expect(oakSparkle).toContainText('$2.19');
  await oakSparkle.getByRole('button', { name: 'Edit Sparkle Water Lime 16 oz', exact: true }).click();
  const oakForm = page.getByRole('dialog', { name: 'Edit Product' });
  await expect(oakForm.getByText('Name, barcode and selling rules are managed in the Shared Catalog.')).toBeVisible();
  await expect(oakForm.getByLabel('Product Name', { exact: true })).toBeDisabled();
  await expect(oakForm.getByLabel('Product Name', { exact: true })).toHaveValue('Sparkle Water Lime 16 oz');
  // A checkbox's name includes its hint, so it is matched from the start.
  const follow = oakForm.getByRole('checkbox', { name: /^Follow shared price/ });
  await expect(oakForm.getByLabel('Retail Price', { exact: true })).toBeDisabled();
  await expect(follow).toBeChecked();
  await page.screenshot({ path: info.outputPath('store-item-form.png'), animations: 'disabled' });

  // The store sets its own price by turning Follow off.
  await follow.uncheck();
  await oakForm.getByLabel('Retail Price', { exact: true }).fill('2.29');
  await oakForm.getByRole('button', { name: 'Update Product', exact: true }).click();
  await expect(page.getByText('Product updated')).toBeVisible();
  await expect(oakSparkle).toContainText('$2.29');

  // On a phone the shared items stack as cards (the catalog is the same from either store).
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/inventory/catalog');
  await expect(page.getByText('Oak Street Store $2.29')).toBeVisible();
  await page.screenshot({ path: info.outputPath('shared-catalog-phone.png'), fullPage: true, animations: 'disabled' });
});
