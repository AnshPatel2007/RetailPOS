import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.local/ux-audit-2026-11');
export const SHOTS = path.join(OUT, 'shots');
export const PASSWORD = 'BrowserTest123!';
fs.mkdirSync(SHOTS, { recursive: true });

export type Viewport = { name: string; width: number; height: number; dark?: boolean };
export const VIEWPORTS = {
  laptop: { name: '1366-light', width: 1366, height: 768 },
  wide: { name: '1920-light', width: 1920, height: 1080 },
  dark: { name: '1366-dark', width: 1366, height: 768, dark: true },
  small: { name: '1024-light', width: 1024, height: 768 },
} satisfies Record<string, Viewport>;

export const slug = (value: string) => value.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'root';

/** Append one JSON line per audited page or flow; the report is built from these. */
export function record(file: string, entry: object) {
  fs.appendFileSync(path.join(OUT, file), JSON.stringify(entry) + '\n');
}

export async function apiToken(page: Page, email: string) {
  const res = await page.request.post('/api/auth/login', { data: { email, password: PASSWORD } });
  expect(res.ok(), `login ${email}`).toBeTruthy();
  const body = await res.json();
  return (body.data?.accessToken || body.data?.token) as string;
}

/** A browser context signed in as one role, with a theme and (for platform admins) an optional previewed store. */
export async function roleContext(browser: Browser, email: string, options: { dark?: boolean; preview?: { id: string; name: string } } = {}) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await context.addInitScript(({ dark, preview }) => {
    localStorage.setItem('theme', dark ? 'dark' : 'light');
    if (preview) localStorage.setItem('admin-view-storage', JSON.stringify({ state: { isAdminViewing: true, viewingLocationId: preview.id, viewingStoreName: preview.name }, version: 0 }));
  }, { dark: !!options.dark, preview: options.preview ?? null });
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page).toHaveURL(/\/(dashboard|pos|admin)$/, { timeout: 30_000 });
  return { context, page };
}

/** Wait until the page has loaded its data and stopped spinning. */
export async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await page.locator('.animate-spin').first().waitFor({ state: 'detached', timeout: 8_000 }).catch(() => undefined);
  await page.waitForTimeout(400);
}

/** Viewport screenshot, and optionally the whole scrolling content (the layout scrolls inside <main>). */
export async function shoot(page: Page, base: string, viewport: Viewport, full = false) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.waitForTimeout(250);
  const files: string[] = [];
  const name = `${base}__${viewport.name}.png`;
  await page.screenshot({ path: path.join(SHOTS, name), animations: 'disabled' });
  files.push(name);
  if (full) {
    const height = await page.evaluate(() => {
      const main = document.querySelector('main');
      if (!main) return document.documentElement.scrollHeight;
      const top = main.getBoundingClientRect().top;
      return Math.ceil(top + main.scrollHeight + 16);
    });
    if (height > viewport.height + 40) {
      await page.setViewportSize({ width: viewport.width, height: Math.min(height, 7000) });
      await page.waitForTimeout(300);
      const fullName = `${base}__${viewport.name}__full.png`;
      await page.screenshot({ path: path.join(SHOTS, fullName), animations: 'disabled' });
      files.push(fullName);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
    }
  }
  return files;
}

/** Layout and readability checks plus axe-core accessibility, on the current page. */
export async function inspect(page: Page) {
  const layout = await page.evaluate(() => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
    };
    const describe = (el: Element) => {
      const label = (el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.getAttribute('title') || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 50);
      const r = el.getBoundingClientRect();
      return `${el.tagName.toLowerCase()}${label ? ` "${label}"` : ''} ${Math.round(r.width)}x${Math.round(r.height)}`;
    };
    const controls = [...document.querySelectorAll('button, a[href], input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, [role=button], [role=tab], [role=combobox]')].filter(visible);
    const smallControls = controls.filter(el => el.getBoundingClientRect().height < 32).map(describe);
    const smallText: string[] = [];
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el) || ![...el.childNodes].some(node => node.nodeType === 3 && node.textContent!.trim())) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 12) smallText.push(`${Math.round(size * 10) / 10}px "${(el as HTMLElement).innerText.trim().slice(0, 40)}"`);
    }
    const rawButtons = [...document.querySelectorAll('button')].filter(visible).filter(el => !el.classList.contains('app-button')
      && !el.closest('[class*="react-aria"], .select-field, .date-control, .page-tabs, nav, .control-popover')).map(describe);
    const main = document.querySelector('main');
    const h1 = [...document.querySelectorAll('h1')].filter(visible).map(el => (el as HTMLElement).innerText.trim());
    return {
      title: h1[0] || document.title,
      h1Count: h1.length,
      pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      mainOverflow: !!main && main.scrollWidth > main.clientWidth + 1,
      contentHeight: main ? main.scrollHeight : document.documentElement.scrollHeight,
      controlCount: controls.length,
      smallControls: smallControls.slice(0, 15), smallControlCount: smallControls.length,
      smallText: [...new Set(smallText)].slice(0, 10), smallTextCount: smallText.length,
      rawButtons: rawButtons.slice(0, 10), rawButtonCount: rawButtons.length,
      hasEmptyState: !!document.querySelector('.empty-state, [data-empty-state]') || /no .* (yet|found)/i.test(main?.innerText || ''),
      deniedPage: /Access Denied/.test(document.body.innerText),
    };
  });
  let axe: { id: string; impact: string | null | undefined; help: string; nodes: number; targets: string[] }[] = [];
  try {
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    axe = result.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, targets: v.nodes.slice(0, 3).map(n => n.target.join(' ')) }));
  } catch (error) { axe = [{ id: 'axe-failed', impact: 'minor', help: String(error).slice(0, 200), nodes: 0, targets: [] }]; }
  return { ...layout, axe };
}

/** Collect console errors and failed or erroring requests while a page is open. */
export function watchProblems(page: Page) {
  const problems: string[] = [];
  page.on('console', message => { if (message.type() === 'error') problems.push('console: ' + message.text().slice(0, 200)); });
  page.on('pageerror', error => problems.push('pageerror: ' + error.message.slice(0, 200)));
  page.on('requestfailed', request => { if (!request.url().includes('/api/auth/logout')) problems.push(`failed: ${request.method()} ${request.url().replace(/^https?:\/\/[^/]+/, '')}`); });
  page.on('response', response => {
    if (response.url().includes('/api/') && response.status() >= 400 && ![401].includes(response.status()))
      problems.push(`${response.status()}: ${response.request().method()} ${response.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 120)}`);
  });
  return { take: () => problems.splice(0, problems.length) };
}

export async function closeAll(...contexts: BrowserContext[]) { for (const context of contexts) await context.close().catch(() => undefined); }
