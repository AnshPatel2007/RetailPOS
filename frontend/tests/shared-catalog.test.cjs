// The Shared Catalog screens' helpers (lib/sharedCatalog.ts): what an edit sends, how the
// link review reads, and the batches sent to the server.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, modules = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  const require = name => { if (name in modules) return modules[name]; throw Error('Unexpected import ' + name); };
  vm.runInNewContext(compiled, { exports: module.exports, module, require }, { filename: file });
  return module.exports;
}
const catalog = load('lib/sharedCatalog.ts', { '@/lib/utils': { formatCurrency: value => '$' + Number(value).toFixed(2) } });
const plain = value => JSON.parse(JSON.stringify(value));

const item = {
  name: 'Cola 12 oz', sku: 'COLA-12', barcode: '036000291452', description: null, brand: 'Cola Co', productFamily: null, variant: null, size: '12 oz',
  baseUnitName: 'can', isTaxable: true, minimumAge: null, ebtEligible: true, priceEmbedded: false, saleBlockedReason: null, categoryName: 'Soda',
};

test('an edit sends only what changed; emptied fields become null', () => {
  const draft = catalog.draftOf(item);
  assert.deepEqual(plain(catalog.changedFields(item, draft)), {});
  assert.deepEqual(plain(catalog.changedFields(item, { ...draft, name: '  Cola Classic 12 oz ', brand: '', minimumAge: '21' })),
    { name: 'Cola Classic 12 oz', brand: null, minimumAge: 21 });
  assert.deepEqual(plain(catalog.changedFields(item, { ...draft, description: 'Cold', categoryName: ' ', ebtEligible: false })),
    { categoryName: null, description: 'Cold', ebtEligible: false });
  // An emptied unit name keeps the one it had.
  assert.deepEqual(plain(catalog.changedFields(item, { ...draft, baseUnitName: '' })), {});
});

test('the edit form says what is missing before saving', () => {
  const draft = catalog.draftOf(item);
  assert.equal(catalog.draftProblem(draft), null);
  assert.equal(catalog.draftProblem({ ...draft, name: ' ' }), 'Enter the item name.');
  assert.equal(catalog.draftProblem({ ...draft, sku: '' }), 'Enter the SKU.');
  assert.equal(catalog.draftProblem({ ...draft, saleBlockedReason: 'no' }), 'Describe the sale hold in a few words, or leave it empty.');
});

test('link review values read in plain words', () => {
  assert.equal(catalog.describeValue('isTaxable', true), 'Yes');
  assert.equal(catalog.describeValue('ebtEligible', false), 'No');
  assert.equal(catalog.describeValue('price', 1.5), '$1.50');
  assert.equal(catalog.describeValue('minimumAge', 21), '21+');
  assert.equal(catalog.describeValue('brand', null), '—');
  assert.equal(catalog.describeValue('name', 'Cola Can'), 'Cola Can');
});

test('the link review counts matches that are the same, differ, or cannot be linked', () => {
  const groups = [{ problem: null, differences: [] }, { problem: null, differences: [{ field: 'name' }] }, { problem: 'Two in one store', differences: [] }];
  assert.deepEqual(plain(catalog.linkCounts(groups)), { total: 3, same: 1, differ: 1, blocked: 1 });
});

test('long lists go to the server in batches it accepts', () => {
  assert.deepEqual(plain(catalog.chunks([1, 2, 3, 4, 5], 2)), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(plain(catalog.chunks([], 200)), []);
  assert.equal(catalog.chunks(Array.from({ length: 450 }, (_, index) => index), 200).length, 3);
});

test('a shared price reaches the following stores, or all of them', () => {
  const listings = [{ storeName: 'North', priceFollowsCatalog: true }, { storeName: 'South', priceFollowsCatalog: false }];
  assert.deepEqual(plain(catalog.priceReach({ listings })), { following: ['North'], all: ['North', 'South'] });
});

test('typed prices are positive amounts to the cent', () => {
  assert.equal(catalog.typedPrice('1.499'), 1.5);
  assert.equal(catalog.typedPrice(' 2 '), 2);
  assert.equal(catalog.typedPrice('0'), null);
  assert.equal(catalog.typedPrice(''), null);
  assert.equal(catalog.typedPrice('abc'), null);
  assert.equal(catalog.plural(1, 'store'), '1 store');
  assert.equal(catalog.plural(3, 'match', 'matches'), '3 matches');
});
