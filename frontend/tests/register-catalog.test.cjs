const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, mocks = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    exports: module.exports, module,
    require: name => { if (!(name in mocks)) throw new Error('Unexpected dependency: ' + name); return mocks[name]; },
  }, { filename: file });
  return module.exports;
}

const barcode = load('../../backend/src/utils/barcode.ts');
const row = (fields) => ({ cost: 1, stockQuantity: 5, lowStockAlert: 2, isTaxable: true, isActive: true, syncedAt: 0, ...fields });

function catalogFixture(rows, locationId = 'store-a') {
  let state = { userId: 'cashier', locationId, cachedAt: 1, version: 'v1' };
  let reads = 0;
  const offlineDb = {
    getCatalogState: async () => state,
    getAllProducts: async scope => { reads++; return scope.locationId === state.locationId ? rows : []; },
    applyProductDelta: async () => true,
  };
  const catalog = load('services/registerCatalog.ts', { './offlineDb': { offlineDb }, '@/lib/barcode': barcode });
  return { catalog, reads: () => reads, change: (next, version) => { rows = next; state = { ...state, version }; } };
}

const scope = { userId: 'cashier', locationId: 'store-a' };

test('UPC-A, EAN-13 and GTIN-14 forms of one code are the same item; other codes match exactly', () => {
  assert.equal(barcode.barcodeKey('049000000443'), barcode.barcodeKey('0049000000443'));
  assert.equal(barcode.barcodeKey('049000000443'), barcode.barcodeKey('00049000000443'));
  assert.notEqual(barcode.barcodeKey('49000000443'), barcode.barcodeKey('049000000443'));
  assert.deepEqual([...barcode.barcodeVariants('ABC-12')], ['ABC-12']);
  assert.deepEqual([...barcode.barcodeVariants('')], []);
});

test('a scan is answered from the register copy: product, pack, exact SKU, or a choice', async () => {
  const { catalog } = catalogFixture([
    row({ id: 'soda', sku: 'SODA', name: 'Soda', price: 1.5, barcode: '049000000443', categoryId: 'drinks', categoryName: 'Drinks' }),
    row({ id: 'soda-12', sku: '049000028911', name: 'Soda (12-pack)', price: 12, barcode: '049000028911', sellingUnitId: 'soda-12', inventoryProductId: 'soda', unitsPerPackage: 12 }),
    row({ id: 'gum', sku: 'GUM-1', name: 'Gum', price: 1, barcode: null }),
    row({ id: 'twin-a', sku: 'TWIN-A', name: 'Twin A', price: 2, barcode: '111111111111' }),
    row({ id: 'twin-b', sku: 'TWIN-B', name: 'Twin B', price: 2, barcode: '111111111111' }),
    row({ id: 'old', sku: 'OLD', name: 'Archived', price: 2, barcode: '222222222222', isActive: false }),
  ]);
  const scan = await catalog.lookupScan('0049000000443', scope);
  assert.equal(scan.kind, 'one');
  assert.equal(scan.product.id, 'soda');
  assert.equal(scan.product.price, 1.5);
  assert.equal(scan.product.category.name, 'Drinks');
  assert.equal(scan.product.saleBlockedReason, null);

  const pack = await catalog.lookupScan('049000028911', scope);
  assert.equal(pack.product.sellingUnitId, 'soda-12');
  assert.equal(pack.product.inventoryProductId, 'soda');
  assert.equal(pack.product.unitsPerPackage, 12);

  assert.equal((await catalog.lookupScan('gum-1', scope)).product.id, 'gum');
  const twins = await catalog.lookupScan('111111111111', scope);
  assert.equal(twins.kind, 'many');
  assert.equal(twins.products.length, 2);
  assert.equal((await catalog.lookupScan('222222222222', scope)).kind, 'none');
  assert.equal((await catalog.lookupScan('999', scope)).kind, 'none');
});

test('another store\'s copy is never used, and the index rebuilds only when the copy changes', async () => {
  const fixture = catalogFixture([row({ id: 'soda', sku: 'SODA', name: 'Soda', price: 1.5, barcode: '049000000443' })]);
  assert.equal((await fixture.catalog.lookupScan('049000000443', { userId: 'x', locationId: 'store-b' })).kind, 'unavailable');
  await fixture.catalog.lookupScan('049000000443', scope);
  await fixture.catalog.lookupScan('049000000443', scope);
  assert.equal(fixture.reads(), 1);
  fixture.change([row({ id: 'soda', sku: 'SODA', name: 'Soda', price: 1.75, barcode: '049000000443' })], 'v2');
  assert.equal((await fixture.catalog.lookupScan('049000000443', scope)).product.price, 1.75);
  assert.equal(fixture.reads(), 2);
});

test('an empty copy is unavailable rather than "not found", and scale labels match their item code', async () => {
  assert.equal((await catalogFixture([]).catalog.lookupScan('049000000443', scope)).kind, 'unavailable');
  const { catalog } = catalogFixture([
    row({ id: 'ham', sku: '12345', name: 'Deli Ham', price: 8.99, barcode: null, priceEmbedded: true }),
    row({ id: 'not-scale', sku: '54321', name: 'Packaged', price: 3, barcode: null }),
  ]);
  assert.equal((await catalog.lookupPriceEmbedded('12345', '212345006990', scope)).product.id, 'ham');
  assert.equal((await catalog.lookupPriceEmbedded('54321', '254321003000', scope)).kind, 'none');
});
