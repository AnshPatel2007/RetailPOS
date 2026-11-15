// The words and order of the delivery-invoice review (components/deliveries/invoiceText.ts)
// and the photo size sent to the reader (lib/imageCompress.ts).
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
const text = load('components/deliveries/invoiceText.ts', { '@/lib/utils': { formatCurrency: value => '$' + Number(value).toFixed(2) } });
const photos = load('lib/imageCompress.ts');
const plain = value => JSON.parse(JSON.stringify(value));

const line = overrides => ({ index: 0, skip: false, confirmed: true, product: { productId: 'p', sellingUnitId: null, name: 'Coke', sku: 'C', unitsPerPackage: null },
  newItem: null, units: 24, unitsPerCase: 24, receivedQuantity: 1, caseCost: 12, unitCost: 0.5, checkUnits: false, tier: 'SURE', ...overrides });

test('the summary says how many lines, units and how they matched', () => {
  assert.equal(text.invoiceCountsLine({ lines: 24, units: 312, sure: 20, check: 3, new: 1, credit: 0, waiting: 4, skipped: 0, cost: 100 }),
    '24 lines · 312 units · 20 sure · 3 to check · 1 new');
  assert.equal(text.invoiceCountsLine({ lines: 1, units: 1, sure: 1, check: 0, new: 0, credit: 0, waiting: 0, skipped: 0, cost: 1 }), '1 line · 1 unit · 1 sure');
});

test('quantities read as cases times their size, packs by name', () => {
  assert.equal(text.unitsLine(line({ receivedQuantity: 2, units: 48 })), '2 cases × 24 = 48 units');
  assert.equal(text.unitsLine(line({ receivedQuantity: 1, units: 24 })), '1 case × 24 = 24 units');
  assert.equal(text.unitsLine(line({ unitsPerCase: 1, units: 6 })), '6 units');
  assert.equal(text.unitsLine(line({ receivedQuantity: 5, unitsPerCase: 10, units: 50,
    product: { productId: 'm', sellingUnitId: 'carton', name: 'Marlboro Red Carton', sku: 'M', unitsPerPackage: 10 } })), '5 × Marlboro Red Carton = 50 units');
});

test('costs read per case and each, and say when they are missing', () => {
  assert.equal(text.costLine(line({})), '$12.00 a case ($0.50 each)');
  assert.equal(text.costLine(line({ unitsPerCase: 1, caseCost: 1, unitCost: 1 })), '$1.00 each');
  assert.equal(text.costLine(line({ caseCost: null, unitCost: null })), 'No cost on the invoice');
});

test('a cost change is shown when it moved, flagged from the store alert percent', () => {
  assert.deepEqual(plain(text.costChangeText(6.2, 3)), { rising: true, flagged: true, text: 'Up 6.2% from last time' });
  assert.deepEqual(plain(text.costChangeText(12.6, 3)), { rising: true, flagged: true, text: 'Up 13% from last time' });
  assert.deepEqual(plain(text.costChangeText(-4, 3)), { rising: false, flagged: false, text: 'Down 4% from last time' });
  assert.equal(text.costChangeText(2, 3).flagged, false);
  assert.equal(text.costChangeText(0.2, 3), null);
  assert.equal(text.costChangeText(null, 3), null);
});

test('lines that need a person come first, then the decided ones, then skipped', () => {
  const lines = [
    line({ index: 0 }),
    line({ index: 1, skip: true }),
    line({ index: 2, confirmed: false, tier: 'CHECK' }),
    line({ index: 3, checkUnits: true }),
    line({ index: 4, caseCost: null, unitCost: null }),
    line({ index: 5 }),
  ];
  assert.deepEqual(plain(text.reviewOrder(lines).map(entry => entry.index)), [2, 3, 4, 0, 5, 1]);
});

test('what still blocks the OK is said in plain words', () => {
  assert.equal(text.lineProblem(line({})), null);
  assert.equal(text.lineProblem(line({ skip: true, confirmed: false })), null);
  assert.equal(text.lineProblem(line({ confirmed: false })), 'Confirm the item.');
  assert.equal(text.lineProblem(line({ confirmed: false, product: null })), 'Choose the item, add it as new, or skip it.');
  assert.equal(text.lineProblem(line({ confirmed: false, product: null, newItem: { name: 'X', price: null } })), 'Enter a price for the new item.');
  assert.equal(text.lineProblem(line({ units: 0 })), 'Enter how many arrived, or skip it.');
  assert.equal(text.lineProblem(line({ caseCost: null, unitCost: null })), 'Enter what it cost.');
});

test('phone photos are sent at most 2000 pixels on the long side, never enlarged', () => {
  assert.deepEqual(plain(photos.fitWithin(4032, 3024)), { width: 2000, height: 1500 });
  assert.deepEqual(plain(photos.fitWithin(3000, 6000)), { width: 1000, height: 2000 });
  assert.deepEqual(plain(photos.fitWithin(1200, 900)), { width: 1200, height: 900 });
});
