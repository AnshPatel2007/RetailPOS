import { Page, expect } from '@playwright/test';

type Section = 'Products' | 'Customers' | 'Money & reports' | 'Store';

/** Go to a page through the top bar: drop its section down and pick the page. */
export async function openMenuPage(page: Page, section: Section, name: string) {
  const title = section === 'Money & reports' ? 'Money' : section;
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: title, exact: true }).click();
  await page.getByRole('menu', { name: title, exact: true }).getByRole('menuitem', { name: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\s|\\d|$)') }).click();
}

/** The top bar's Products menu tells screen readers how many stock exceptions wait. */
export async function expectStockExceptionNote(page: Page, sentence: RegExp) {
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Products', exact: true })).toHaveAccessibleDescription(sentence);
}
