import { expect, type Locator, type Page } from '@playwright/test';

export function selectField(scope: Page | Locator, label: string) {
  return scope.locator('[data-select-label=' + JSON.stringify(label) + ']');
}
/** Exercise the visible controls, including search, rather than setting hidden form values. */
export async function chooseOption(field: Locator, label: string) {
  const search = field.getByRole('combobox');
  const list = field.page().getByRole('listbox');
  if (await search.count()) await search.fill('');
  if (!await list.isVisible()) await field.locator('button').first().click();
  await expect(list).toBeVisible();
  await list.getByRole('option', { name: label, exact: true }).click();
  await expect(list).toHaveCount(0);
}
