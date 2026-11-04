import { test, expect, type Page, type Route } from '@playwright/test';
import { login } from './utils/auth-helper';
import { selectField, chooseOption } from './utils/select-helper';

const firstBarcode = '012345678905';
const secondBarcode = '036000291452';
const productImage = 'https://catalog.example.test/coffee.png';
const identified = (overrides: Record<string, unknown> = {}) => ({
  success: true,
  data: {
    found: true, status: 'found', name: 'Catalog Coffee 12 oz', description: 'Roasted coffee, 12 oz',
    brand: 'Catalog', size: '12 oz', category: 'Beverages', image: productImage,
    source: ['barcode_db'], ...overrides,
  },
});

async function prepare(page: Page) {
  let creates = 0;
  let categoryCreates = 0;
  // Protect the fixture store even if scanner Enter accidentally submits a form.
  await page.route(/\/api\/products(?:\?.*)?$/, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    creates += 1;
    await route.fulfill({ status: 409, json: { success: false, error: 'Unexpected product submission in lookup test' } });
  });
  await page.route(/\/api\/categories(?:\?.*)?$/, async route => {
    if (route.request().method() === 'POST') {
      categoryCreates += 1;
      return route.fulfill({ status: 409, json: { success: false, error: 'Lookup must not create categories' } });
    }
    await route.fulfill({ json: { success: true, data: [{ id: 'lookup-beverages', name: 'Beverages' }, { id: 'lookup-candy', name: 'Candy' }] } });
  });
  await page.route(productImage, route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#8a6048"/></svg>',
  }));
  await login(page, 'owner@example.test');
  await page.goto('/inventory');
  await expect(page.getByRole('row').filter({ hasText: 'Fixture Coffee' })).toBeVisible();
  return { creates: () => creates, categoryCreates: () => categoryCreates };
}

async function addProduct(page: Page) {
  await page.getByRole('button', { name: 'Add single item', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add New Product', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Barcode', { exact: true })).toBeFocused();
  return dialog;
}

function deferredLookup() {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  return {
    release,
    respond: async (route: Route, body = identified()) => {
      await gate;
      // Cancellation is expected when the barcode or dialog changes.
      await route.fulfill({ json: body }).catch(() => undefined);
    },
  };
}

test('a new product barcode fills catalog identity and image without changing store pricing or sale settings', async ({ page }) => {
  const mutations = await prepare(page);
  const payloads: unknown[] = [];
  await page.route('**/api/products/identify', async route => {
    payloads.push(route.request().postDataJSON());
    await route.fulfill({ json: identified({ category: '  beverages  ', price: 99, cost: 50, stockQuantity: 500, minimumAge: 21, ebtEligible: false }) });
  });
  const dialog = await addProduct(page);
  for (const [label, value] of [['Cost Price', '4.25'], ['Retail Price', '6.75'], ['Stock Quantity', '12'], ['Low Stock Alert', '3']]) {
    await dialog.getByLabel(label, { exact: true }).fill(value);
  }
  await dialog.getByRole('checkbox', { name: 'Taxable item', exact: true }).uncheck();
  await dialog.getByRole('checkbox', { name: 'EBT / SNAP eligible', exact: true }).check();
  await dialog.getByLabel('Barcode', { exact: true }).fill(firstBarcode);
  await expect(dialog.getByLabel('Product Name', { exact: true })).toHaveValue('Catalog Coffee 12 oz');
  await expect(dialog.getByLabel('SKU', { exact: true })).toHaveValue(firstBarcode);
  await expect(dialog.getByLabel('Description', { exact: true })).toHaveValue('Roasted coffee, 12 oz');
  await expect(dialog.getByLabel('Image URL', { exact: true })).toHaveValue(productImage);
  await expect(selectField(dialog, 'Category').getByRole('button')).toHaveText('Beverages');
  await expect(dialog.getByRole('img', { name: 'Catalog Coffee 12 oz preview', exact: true })).toHaveAttribute('src', productImage);
  for (const [label, value] of [['Cost Price', '4.25'], ['Retail Price', '6.75'], ['Stock Quantity', '12'], ['Low Stock Alert', '3']]) {
    await expect(dialog.getByLabel(label, { exact: true })).toHaveValue(value);
  }
  await expect(dialog.getByRole('checkbox', { name: 'Taxable item', exact: true })).not.toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'EBT / SNAP eligible', exact: true })).toBeChecked();
  await expect(selectField(dialog, 'Age restriction').getByRole('button')).toHaveText('None');
  await expect(dialog.getByRole('status')).toContainText(/filled|found|review/i);
  expect(payloads).toEqual([{ barcode: firstBarcode }]);
  expect(mutations.creates()).toBe(0);
  expect(mutations.categoryCreates()).toBe(0);
});

test('scanner Enter looks up once and never submits a completed product form', async ({ page }) => {
  const mutations = await prepare(page);
  let calls = 0;
  await page.route('**/api/products/identify', async route => {
    calls += 1;
    await route.fulfill({ json: identified() });
  });
  const dialog = await addProduct(page);
  for (const [label, value] of [['Product Name', 'My coffee'], ['SKU', 'LOCAL-COFFEE'], ['Cost Price', '4'], ['Retail Price', '6'], ['Stock Quantity', '12'], ['Low Stock Alert', '3']]) {
    await dialog.getByLabel(label, { exact: true }).fill(value);
  }
  const barcode = dialog.getByLabel('Barcode', { exact: true });
  await barcode.fill(firstBarcode);
  await barcode.press('Enter');
  await expect.poll(() => calls).toBe(1);
  await expect(dialog.getByLabel('Image URL', { exact: true })).toHaveValue(productImage);
  // Let the automatic debounce expire: Enter must cancel it instead of duplicating lookup.
  await page.waitForTimeout(900);
  expect(calls).toBe(1);
  expect(mutations.creates()).toBe(0);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Product Name', { exact: true })).toHaveValue('My coffee');
  await expect(dialog.getByLabel('SKU', { exact: true })).toHaveValue('LOCAL-COFFEE');
});

test('lookup preserves manually entered identity and edits made while the catalog responds', async ({ page }) => {
  const mutations = await prepare(page);
  const pending = deferredLookup();
  let calls = 0;
  await page.route('**/api/products/identify', async route => {
    calls += 1;
    await pending.respond(route);
  });
  const dialog = await addProduct(page);
  await dialog.getByLabel('SKU', { exact: true }).fill('MY-SKU');
  await dialog.locator('summary', { hasText: 'Brand, size & description' }).click();
  await dialog.getByLabel('Description', { exact: true }).fill('Owner description');
  await dialog.getByLabel('Image URL', { exact: true }).fill('/my-product.png');
  await chooseOption(selectField(dialog, 'Category'), 'Candy');
  await dialog.getByLabel('Barcode', { exact: true }).fill(firstBarcode);
  await expect.poll(() => calls).toBe(1);
  await dialog.getByLabel('Product Name', { exact: true }).fill('Owner corrected name');
  pending.release();
  await expect(dialog.getByRole('status')).toContainText(/filled|found|review|kept/i);
  await expect(dialog.getByLabel('Product Name', { exact: true })).toHaveValue('Owner corrected name');
  await expect(dialog.getByLabel('SKU', { exact: true })).toHaveValue('MY-SKU');
  await expect(dialog.getByLabel('Description', { exact: true })).toHaveValue('Owner description');
  await expect(dialog.getByLabel('Image URL', { exact: true })).toHaveValue('/my-product.png');
  await expect(selectField(dialog, 'Category').getByRole('button')).toHaveText('Candy');
  expect(mutations.categoryCreates()).toBe(0);
  expect(mutations.creates()).toBe(0);
});

test('changed barcodes replace only generated details and discard an obsolete lookup response', async ({ page }) => {
  await prepare(page);
  const stale = deferredLookup();
  const calls: string[] = [];
  await page.route('**/api/products/identify', async route => {
    const { barcode } = route.request().postDataJSON();
    calls.push(barcode);
    if (barcode === firstBarcode) return stale.respond(route);
    await route.fulfill({ json: identified({ name: 'Second product', description: 'Second description', category: 'Unknown category' }) });
  });
  const dialog = await addProduct(page);
  await dialog.getByLabel('Barcode', { exact: true }).fill(firstBarcode);
  await expect.poll(() => calls).toEqual([firstBarcode]);
  await dialog.getByLabel('Barcode', { exact: true }).fill(secondBarcode);
  await expect(dialog.getByLabel('Product Name', { exact: true })).toHaveValue('Second product');
  stale.release();
  await page.waitForTimeout(200);
  await expect(dialog.getByLabel('Product Name', { exact: true })).toHaveValue('Second product');
  await expect(dialog.getByLabel('SKU', { exact: true })).toHaveValue(secondBarcode);
  await expect(selectField(dialog, 'Category').getByRole('button')).toHaveText('Select a category');
  await dialog.getByLabel('Product Name', { exact: true }).fill('Keep my second name');
  await page.unroute('**/api/products/identify');
  await page.route('**/api/products/identify', route => route.fulfill({ json: identified({ name: 'Third product', description: 'Third description' }) }));
  await dialog.getByLabel('Barcode', { exact: true }).fill('4006381333931');
  await expect(dialog.getByLabel('Description', { exact: true })).toHaveValue('Third description');
  await expect(dialog.getByLabel('SKU', { exact: true })).toHaveValue('4006381333931');
  await expect(dialog.getByLabel('Product Name', { exact: true })).toHaveValue('Keep my second name');
});

test('closing the dialog discards pending results and editing an existing product does not auto-lookup', async ({ page }) => {
  await prepare(page);
  const pending = deferredLookup();
  let calls = 0;
  await page.route('**/api/products/identify', async route => {
    calls += 1;
    await pending.respond(route);
  });
  const dialog = await addProduct(page);
  await dialog.getByLabel('Barcode', { exact: true }).fill(firstBarcode);
  await expect.poll(() => calls).toBe(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  const reopened = await addProduct(page);
  pending.release();
  await page.waitForTimeout(200);
  await expect(reopened.getByLabel('Product Name', { exact: true })).toHaveValue('');
  await expect(reopened.getByLabel('Barcode', { exact: true })).toHaveValue('');
  await expect(reopened.getByLabel('Image URL', { exact: true })).toHaveValue('');
  await page.keyboard.press('Escape');
  await page.getByRole('row').filter({ hasText: 'Fixture Coffee' }).getByRole('button', { name: 'Edit Fixture Coffee', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit Product', exact: true });
  await edit.getByLabel('Barcode', { exact: true }).fill(secondBarcode);
  await page.waitForTimeout(900);
  expect(calls).toBe(1);
  await expect(edit.getByLabel('Product Name', { exact: true })).toHaveValue('Fixture Coffee');
  await edit.getByRole('button', { name: 'Auto-fill', exact: true }).click();
  await expect.poll(() => calls).toBe(2);
  await expect(edit.getByLabel('Image URL', { exact: true })).toHaveValue(productImage);
  await expect(edit.getByLabel('Product Name', { exact: true })).toHaveValue('Fixture Coffee');
});

test('an unavailable or missing catalog item keeps manual entry available and lookup can be retried', async ({ page }) => {
  const mutations = await prepare(page);
  let calls = 0;
  await page.route('**/api/products/identify', async route => {
    calls += 1;
    if (calls === 1) return route.fulfill({ status: 503, json: { success: false, error: 'Product catalog is temporarily unavailable' } });
    if (calls === 2) return route.fulfill({ json: { success: true, data: { found: false, status: 'not_found', source: [] }, message: 'No catalog match. Enter the product details manually.' } });
    await route.fulfill({ json: identified() });
  });
  const dialog = await addProduct(page);
  await dialog.getByLabel('Barcode', { exact: true }).fill(firstBarcode);
  await expect(dialog.getByRole('alert').or(dialog.getByRole('status'))).toContainText(/unavailable|try again|failed/i);
  await dialog.getByRole('button', { name: /^(Retry lookup|Auto-fill)$/ }).click();
  await expect(dialog.getByRole('status')).toContainText(/not found|no.*match|manual|not recognized/i);
  await dialog.getByLabel('Product Name', { exact: true }).fill('Manually identified product');
  await dialog.getByRole('button', { name: /^(Retry lookup|Auto-fill)$/ }).click();
  await expect(dialog.getByLabel('Image URL', { exact: true })).toHaveValue(productImage);
  await expect(dialog.getByLabel('Product Name', { exact: true })).toHaveValue('Manually identified product');
  expect(calls).toBe(3);
  expect(mutations.creates()).toBe(0);
});

test('a barcode already in this store opens the existing product instead of creating a duplicate', async ({ page }, info) => {
  const mutations = await prepare(page);
  const product = { id: 'existing-lookup', name: 'Existing coffee', sku: 'EXISTING', barcode: firstBarcode,
    cost: 4, price: 6, stockQuantity: 10, lowStockAlert: 3, isTaxable: true, isActive: true,
    trackInventory: true, allowBackorder: false, categoryId: null };
  await page.route('**/api/products/identify', route => route.fulfill({ json: identified({ name: product.name, existingProductId: product.id, source: ['local_catalog'] }) }));
  await page.route('**/api/products/existing-lookup', route => route.fulfill({ json: { success: true, data: product } }));
  const dialog = await addProduct(page);
  await dialog.getByLabel('Barcode', { exact: true }).fill(firstBarcode);
  await expect(dialog.getByRole('status')).toContainText('already in your store');
  await expect(dialog.getByRole('button', { name: 'Create Product', exact: true })).toBeDisabled();
  await page.screenshot({ path: info.outputPath('barcode-existing-product.png') });
  await dialog.getByRole('button', { name: 'Open existing product', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit Product', exact: true });
  await expect(edit.getByLabel('Product Name', { exact: true })).toHaveValue(product.name);
  await expect(edit.getByLabel('SKU', { exact: true })).toHaveValue(product.sku);
  await expect(edit.getByLabel('Stock Quantity', { exact: true })).toHaveValue('10');
  expect(mutations.creates()).toBe(0);
});

test('Coca-Cola catalog hierarchy selects the store beverage category and fills description and photo', async ({ page }, info) => {
  await prepare(page);
  await page.route('**/api/products/identify', route => route.fulfill({ json: identified({
    name: 'Coca-Cola 20 fl oz', description: 'Coca-Cola bottled cola, 20 fl oz.', category: 'Sweetened beverages',
    categoryCandidates: ['Sweetened beverages', 'Soda', 'Colas', 'Soft drinks', 'Beverages'], missingFields: [],
  }) }));
  const dialog = await addProduct(page);
  await dialog.getByLabel('Barcode', { exact: true }).fill('049000000443');
  await expect(dialog.getByLabel('Product Name', { exact: true })).toHaveValue('Coca-Cola 20 fl oz');
  await expect(selectField(dialog, 'Category').getByRole('button')).toHaveText('Beverages');
  await expect(dialog.getByLabel('Description', { exact: true })).toHaveValue('Coca-Cola bottled cola, 20 fl oz.');
  await expect(dialog.getByLabel('Image URL', { exact: true })).toHaveValue(productImage);
  await expect.poll(() => dialog.getByRole('img', { name: 'Catalog match preview', exact: true }).evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.screenshot({ path: info.outputPath('cola-details.png') });
});

test('a name-only match explains missing fields and retry can fill them without replacing edited details', async ({ page }) => {
  await prepare(page);
  let calls = 0;
  await page.route('**/api/products/identify', route => route.fulfill({ json: ++calls === 1
    ? identified({ description: null, image: null, category: null, categoryCandidates: [], missingFields: ['description', 'category', 'image'], enrichmentUnavailable: true })
    : identified({ missingFields: [] }) }));
  const dialog = await addProduct(page);
  await dialog.getByLabel('Barcode', { exact: true }).fill(firstBarcode);
  await expect(dialog.getByRole('status')).toContainText('Some catalog details could not be retrieved');
  await expect(dialog.getByRole('status')).toContainText('Not supplied by the catalog: description, category, photo');
  await dialog.getByLabel('Product Name', { exact: true }).fill('My shelf label');
  await dialog.getByRole('button', { name: 'Auto-fill', exact: true }).click();
  await expect(dialog.getByLabel('Image URL', { exact: true })).toHaveValue(productImage);
  await expect(dialog.getByLabel('Product Name', { exact: true })).toHaveValue('My shelf label');
  await expect(dialog.getByRole('status')).not.toContainText('Not supplied');
});

test('a store without categories can review and add the catalog suggestion without submitting the product', async ({ page }, info) => {
  const mutations = await prepare(page);
  const categoryRequests: unknown[] = [];
  await page.route(/\/api\/categories(?:\?.*)?$/, async route => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: { success: true, data: [] } });
    categoryRequests.push(route.request().postDataJSON());
    if (categoryRequests.length === 1) return route.fulfill({ status: 503, json: { success: false, error: 'Category save unavailable. Try again.' } });
    return route.fulfill({ json: { success: true, data: { id: 'new-soda', name: 'Soda' } } });
  });
  await page.route('**/api/products/identify', route => route.fulfill({ json: identified({
    name: 'Coca-Cola 20 fl oz', category: 'Sweetened beverages',
    categoryCandidates: ['Sweetened beverages', 'Soda', 'Colas', 'Beverages'],
  }) }));
  await page.reload();
  const dialog = await addProduct(page);
  await dialog.getByLabel('Barcode', { exact: true }).fill('049000000443');
  await expect(dialog.getByLabel('Product Name', { exact: true })).toHaveValue('Coca-Cola 20 fl oz');
  await expect(selectField(dialog, 'Category').getByRole('button')).toHaveText('Select a category');
  const suggestion = dialog.getByRole('button', { name: 'Add suggested category: Soda', exact: true });
  await expect(suggestion).toBeVisible();
  expect(categoryRequests).toEqual([]);
  await page.screenshot({ path: info.outputPath('cola-category-suggestion.png') });
  await suggestion.click();
  await expect(dialog.getByLabel('New category name', { exact: true })).toHaveValue('Soda');
  await expect(dialog.getByLabel('New category name', { exact: true })).toBeFocused();
  expect(categoryRequests).toEqual([]);
  await dialog.getByRole('button', { name: 'Add category', exact: true }).click();
  await expect(page.getByText('Category save unavailable. Try again.', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('New category name', { exact: true })).toHaveValue('Soda');
  await dialog.getByRole('button', { name: 'Add category', exact: true }).click();
  await expect(selectField(dialog, 'Category').getByRole('button')).toHaveText('Soda');
  await expect(dialog.getByLabel('Product Name', { exact: true })).toHaveValue('Coca-Cola 20 fl oz');
  expect(categoryRequests).toEqual([{ name: 'Soda' }, { name: 'Soda' }]);
  expect(mutations.creates()).toBe(0);
});

test('recognized restricted products select 21+ and later unknown scans never clear that restriction', async ({ page }) => {
  await prepare(page);
  let calls = 0;
  await page.route('**/api/products/identify', route => route.fulfill({ json: identified({
    name: ++calls === 1 ? 'Example Lager' : 'Unknown item',
    ageRestriction: calls === 1
      ? { status: 'restricted', minimumAge: 21, reason: 'Catalog category identifies an alcoholic beverage (21+).' }
      : { status: 'unknown', minimumAge: null, reason: 'No specific category.' },
  }) }));
  const dialog = await addProduct(page);
  await dialog.getByLabel('Barcode', { exact: true }).fill(firstBarcode);
  await expect(selectField(dialog, 'Age restriction').getByRole('button')).toHaveText('21+ (alcohol, tobacco, vape)');
  await expect(dialog.getByRole('status')).toContainText('21+ age check selected');
  await dialog.getByLabel('Barcode', { exact: true }).fill(secondBarcode);
  await expect(dialog.getByLabel('Product Name', { exact: true })).toHaveValue('Unknown item');
  await expect(selectField(dialog, 'Age restriction').getByRole('button')).toHaveText('21+ (alcohol, tobacco, vape)');
});

test('age suggestions preserve an owner choice made while lookup is pending and expose uncertain classifications', async ({ page }) => {
  await prepare(page);
  const pending = deferredLookup();
  let calls = 0;
  await page.route('**/api/products/identify', async route => {
    calls++;
    await pending.respond(route, identified({ name: 'Example Cigarettes', ageRestriction: {
      status: 'restricted', minimumAge: 21, reason: 'Catalog category identifies tobacco (21+).',
    } }));
  });
  const dialog = await addProduct(page);
  await dialog.getByLabel('Barcode', { exact: true }).fill(firstBarcode);
  await expect.poll(() => calls).toBe(1);
  await chooseOption(selectField(dialog, 'Age restriction'), '18+ (lottery)');
  pending.release();
  await expect(dialog.getByRole('status')).toContainText('21+ age check recommended');
  await expect(selectField(dialog, 'Age restriction').getByRole('button')).toHaveText('18+ (lottery)');
  await page.route('**/api/products/identify', route => route.fulfill({ json: identified({
    name: 'Example Non-Alcoholic Beer', ageRestriction: { status: 'review', minimumAge: null, reason: 'Check the product label.' },
  }) }));
  await dialog.getByLabel('Barcode', { exact: true }).fill(secondBarcode);
  await expect(dialog.getByRole('status')).toContainText('Check age restriction: Check the product label.');
  await expect(selectField(dialog, 'Age restriction').getByRole('button')).toHaveText('18+ (lottery)');
});

test('catalog photo choices can replace an existing draft image without saving or resubmitting the product', async ({ page }, info) => {
  const mutations = await prepare(page);
  const alternate = 'https://catalog.example.test/alternate.png';
  await page.route(alternate, route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="white"/><rect x="10" y="3" width="12" height="28" fill="red"/></svg>' }));
  await page.route('**/api/products/identify', route => route.fulfill({ json: identified({
    imageStatus: 'catalog', imageCandidates: [
      { url: productImage, source: 'UPCitemdb', kind: 'catalog' },
      { url: alternate, source: 'Coca-Cola', kind: 'catalog' },
      { url: 'https://catalog.example.test/community.png', source: 'Open Food Facts', kind: 'community' },
    ],
  }) }));
  const dialog = await addProduct(page);
  await dialog.getByLabel('Barcode', { exact: true }).fill(firstBarcode);
  await expect(dialog.getByLabel('Image URL', { exact: true })).toHaveValue(productImage);
  // The lookup opened "Brand, size & description" to show the photo it found.
  await dialog.locator('summary').filter({ hasText: 'Catalog photos (2)' }).click();
  const choices = dialog.getByRole('group', { name: 'Catalog product photos' });
  await expect(choices.getByRole('button')).toHaveCount(2);
  await choices.getByRole('button', { name: 'Use product photo 2 from Coca-Cola', exact: true }).click();
  await expect(dialog.getByLabel('Image URL', { exact: true })).toHaveValue(alternate);
  await dialog.getByLabel('Barcode', { exact: true }).scrollIntoViewIfNeeded();
  await dialog.getByRole('button', { name: 'Auto-fill', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Auto-fill', exact: true })).toBeEnabled();
  await expect(dialog.getByLabel('Image URL', { exact: true })).toHaveValue(alternate);
  await choices.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('catalog-photo-options.png') });
  expect(mutations.creates()).toBe(0);
});

test('community snapshots do not automatically populate the product image', async ({ page }) => {
  await prepare(page);
  await page.route('**/api/products/identify', route => route.fulfill({ json: identified({
    image: null, imageStatus: 'community_only', missingFields: ['image'],
    imageCandidates: [{ url: productImage, source: 'Open Food Facts', kind: 'community' }],
  }) }));
  const dialog = await addProduct(page);
  await dialog.getByLabel('Barcode', { exact: true }).fill(firstBarcode);
  await expect(dialog.getByRole('status')).toContainText('Only community snapshots are available');
  await expect(dialog.getByLabel('Image URL', { exact: true })).toHaveValue('');
  await expect(dialog.getByRole('img', { name: 'Catalog match preview', exact: true })).toHaveCount(0);
});
