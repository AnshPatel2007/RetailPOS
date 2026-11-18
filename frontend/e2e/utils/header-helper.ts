import { Page } from '@playwright/test';

/** Click a page-header button wherever it sits: beside the title, or folded under "More". */
export async function clickHeaderAction(page: Page, name: string | RegExp) {
  const exact = typeof name === 'string';
  const actions = page.locator('.page-actions');
  await actions.first().waitFor();
  const shown = actions.getByRole('button', { name, exact }).or(actions.getByRole('link', { name, exact }));
  if (await shown.first().isVisible()) return shown.first().click();
  await actions.getByRole('button', { name: 'More actions', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'More actions', exact: true });
  await menu.getByRole('button', { name, exact }).or(menu.getByRole('link', { name, exact })).first().click();
}
