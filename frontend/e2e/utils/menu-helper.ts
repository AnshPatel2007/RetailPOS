import { Page, expect } from '@playwright/test';
import { NEW_LOOK } from './look';

type Section = 'Products' | 'Customers' | 'Money & reports' | 'Store';

/** Sidebar sections fold (one open at a time): open one before clicking a page inside it. Classic look only. */
export async function openMenuSection(page: Page, title: Section) {
  const heading = page.getByRole('navigation', { name: 'Main' }).filter({ visible: true }).getByRole('button', { name: title, exact: true });
  if (await heading.getAttribute('aria-expanded') !== 'true') await heading.click();
}

/**
 * Go to a page through the menu, in either look: the Classic side menu opens
 * the section and clicks the link; the New look's top bar drops the section
 * down and picks the page.
 */
export async function openMenuPage(page: Page, section: Section, name: string) {
  if (NEW_LOOK) {
    const title = section === 'Money & reports' ? 'Money' : section;
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: title, exact: true }).click();
    await page.getByRole('menu', { name: title, exact: true }).getByRole('menuitem', { name: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\s|\\d|$)') }).click();
    return;
  }
  await openMenuSection(page, section);
  await page.getByRole('link', { name, exact: true }).filter({ visible: true }).click();
}

/**
 * The menu tells screen readers how many stock exceptions wait: on the Stock
 * Control link of the Classic side menu, on the Products menu of the New look's top bar.
 */
export async function expectStockExceptionNote(page: Page, sentence: RegExp) {
  if (NEW_LOOK) await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Products', exact: true })).toHaveAccessibleDescription(sentence);
  else await expect(page.getByRole('link', { name: 'Stock Control', exact: true }).filter({ visible: true })).toHaveAttribute('aria-description', sentence);
}
