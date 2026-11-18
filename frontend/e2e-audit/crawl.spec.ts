import { test, type Browser, type Page } from '@playwright/test';
import { apiToken, closeAll, inspect, record, roleContext, settle, shoot, slug, VIEWPORTS, watchProblems, type Viewport } from './shared';
import { seedDemo } from './seed-demo';

test.describe.configure({ mode: 'serial' });

const insights = ['overview?view=summary', 'sales?view=transactions', 'inventory?view=stock-health', 'staff?view=sales', 'exports']
  .map(view => '/insights/reports/' + view);
const financial = [...['expenses', 'budgets', 'recurring', 'pnl', 'inventory'].map(tab => '/financial?tab=' + tab),
  ...['balances', 'valuation', 'missing', 'ledger', 'reconciliation'].map(costTab => '/financial?tab=inventory&costTab=' + costTab)];
const settings = (sections: string[]) => sections.map(section => '/settings?section=' + section);
const operations = ['/dashboard', '/pos', '/inventory', '/inventory?view=packs', '/inventory/purchasing/orders', '/inventory/purchasing/suppliers',
  '/inventory/purchasing/suggestions', '/inventory/purchasing/price-review', '/inventory/stock-control/transfers', '/inventory/stock-control/counts',
  '/inventory/stock-control/exceptions', '/inventory/stock-control/movements', '/promotions', '/lottery', '/customers',
  '/customers/insights?analysis=overview', '/customers/insights?analysis=segments', '/customers/accounts/gift-cards', '/customers/accounts/store-credits',
  '/customers/accounts/house-accounts', '/team-time/shifts', ...insights, ...financial, '/audit-log',
  ...settings(['profile', 'store', 'receipts', 'pricing', 'notifications', 'devices']), '/customer-display'];

type Role = { name: string; email: string; paths: string[]; denied: string; depth: 'full' | 'lite'; preview?: boolean };
const roles: Role[] = [
  { name: 'cashier', email: 'cashier@example.test', depth: 'full', denied: '/inventory',
    paths: ['/dashboard', '/pos', '/customers', '/my-shift', '/lottery', ...settings(['profile', 'devices']), '/customer-display'] },
  { name: 'manager', email: 'manager@example.test', depth: 'lite', denied: '/team-time/staff', paths: operations },
  { name: 'admin', email: 'owner@example.test', depth: 'full', denied: '/admin',
    paths: [...operations, '/team-time/staff', '/team-time/payroll', '/financial/reconciliation?view=corrections', '/financial/reconciliation?view=legacy',
      '/financial/reconciliation?view=history', '/settings/jobs', ...settings(['payments'])] },
  { name: 'superadmin', email: 'platform@example.test', depth: 'full', denied: '/insights/reports/overview',
    paths: ['/admin', '/admin/stores', '/admin/users', '/admin/integrations', '/analytics', '/settings/jobs', ...settings(['profile'])] },
  { name: 'superadmin-preview', email: 'platform@example.test', depth: 'lite', denied: '/team-time/payroll', preview: true,
    paths: ['/dashboard', '/pos', '/inventory', '/inventory?view=packs', '/inventory/purchasing/orders', '/inventory/stock-control/exceptions', '/customers',
      '/customers/accounts/gift-cards', '/team-time/shifts', '/financial?tab=expenses', '/promotions', '/audit-log', '/lottery', ...settings(['store']), '/analytics'] },
  { name: 'lottery-admin', email: 'lottery@example.test', depth: 'lite', denied: '/admin', paths: ['/lottery?tab=daily', '/lottery?tab=reports', '/lottery?tab=ticketTypes'] },
  { name: 'lottery-cashier', email: 'lottery-cashier@example.test', depth: 'lite', denied: '/inventory', paths: ['/lottery'] },
];
// Sub-views are checked at the main sizes; the small-laptop size is for top-level pages.
const isSubView = (path: string) => /\/insights\/reports\/|costTab=|reconciliation\?view=(legacy|history)/.test(path);

async function visit(page: Page, path: string) {
  const started = Date.now();
  await page.goto(path);
  await settle(page);
  return Date.now() - started;
}

async function auditRole(browser: Browser, role: Role, preview?: { id: string; name: string }) {
  const { context, page } = await roleContext(browser, role.email, { preview });
  const problems = watchProblems(page);
  for (const path of role.paths) {
    const base = `${role.name}__${slug(path)}`;
    try {
      const loadMs = await visit(page, path);
      const files = await shoot(page, base, VIEWPORTS.laptop, path !== '/pos' && path !== '/customer-display');
      const checks = await inspect(page);
      if (role.depth === 'full') {
        files.push(...await shoot(page, base, VIEWPORTS.wide));
        if (!isSubView(path)) files.push(...await shoot(page, base, VIEWPORTS.small));
        await page.setViewportSize({ width: 1366, height: 768 });
      }
      record('pages.jsonl', { role: role.name, path, loadMs, files, checks, problems: problems.take() });
    } catch (error) {
      record('pages.jsonl', { role: role.name, path, error: String(error).slice(0, 300), problems: problems.take() });
    }
  }
  // What a role sees when it opens a page it may not use.
  try {
    await visit(page, role.denied);
    record('pages.jsonl', { role: role.name, path: role.denied, denied: true, files: await shoot(page, `${role.name}__denied__${slug(role.denied)}`, VIEWPORTS.laptop), problems: problems.take() });
  } catch (error) { record('pages.jsonl', { role: role.name, path: role.denied, denied: true, error: String(error).slice(0, 300) }); }
  await closeAll(context);

  if (role.depth === 'full') {
    const dark = await roleContext(browser, role.email, { dark: true, preview });
    for (const path of role.paths.filter(p => !isSubView(p))) {
      try {
        await visit(dark.page, path);
        record('dark.jsonl', { role: role.name, path, files: await shoot(dark.page, `${role.name}__${slug(path)}`, VIEWPORTS.dark as Viewport) });
      } catch (error) { record('dark.jsonl', { role: role.name, path, error: String(error).slice(0, 300) }); }
    }
    await closeAll(dark.context);
  }
}

test('seed demo store data', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await seedDemo(page);
});

for (const role of roles) {
  test(`crawl ${role.name}`, async ({ browser, page }) => {
    test.setTimeout(45 * 60_000);
    let preview: { id: string; name: string } | undefined;
    if (role.preview) {
      const token = await apiToken(page, role.email);
      const locations = (await (await page.request.get('/api/locations', { headers: { Authorization: 'Bearer ' + token } })).json()).data as { id: string; name: string }[];
      const store = locations.find(location => location.name === 'Store A');
      if (store) preview = { id: store.id, name: store.name };
    }
    await auditRole(browser, role, preview);
  });
}

test('crawl signed-out screens', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  for (const [name, path] of [['login', '/login'], ['reset-invalid', '/reset-password?token=invalid-token']]) {
    await visit(page, path);
    record('pages.jsonl', { role: 'signed-out', path, files: [...await shoot(page, `public__${name}`, VIEWPORTS.laptop), ...await shoot(page, `public__${name}`, VIEWPORTS.wide)], checks: await inspect(page) });
  }
  await visit(page, '/login');
  const forgot = page.getByRole('button', { name: /forgot/i }).or(page.getByRole('link', { name: /forgot/i })).first();
  if (await forgot.count()) {
    await forgot.click();
    await settle(page);
    record('pages.jsonl', { role: 'signed-out', path: '/login (forgot password)', files: await shoot(page, 'public__forgot-password', VIEWPORTS.laptop), checks: await inspect(page) });
  }
  await context.close();
});
