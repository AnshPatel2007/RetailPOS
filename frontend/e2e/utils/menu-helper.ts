import { Page } from '@playwright/test';

/** Sidebar sections fold (one open at a time): open one before clicking a page inside it. */
export async function openMenuSection(page: Page, title: 'Products' | 'Customers' | 'Money & reports' | 'Store') {
  const heading = page.getByRole('navigation', { name: 'Main' }).filter({ visible: true }).getByRole('button', { name: title, exact: true });
  if (await heading.getAttribute('aria-expanded') !== 'true') await heading.click();
}
