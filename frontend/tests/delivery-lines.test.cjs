const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file) {
  const source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { exports: module.exports, module }, { filename: file });
  return module.exports;
}
const lines = load('lib/deliveryLines.ts');
let next = 0;
const key = () => 'k' + (++next);
// JSON from the server: compare plain values, not objects from the vm's realm.
const plain = value => JSON.parse(JSON.stringify(value));

const soda = { id: 'soda', name: 'Soda Can', sku: 'SODA', barcode: '049000000443', cost: 0.6, stockQuantity: 3, stockVersion: 7, lowStockAlert: 5, trackInventory: true, baseStockQuantity: 3 };
const single = { kind: 'PRODUCT', product: soda, openExceptionId: null };
const carton = { kind: 'PACK', product: { ...soda, id: 'carton', name: 'Soda Can (12-pack)', sku: '049000028911', barcode: '049000028911', cost: 7.2, stockQuantity: 0,
  inventoryProductId: 'soda', sellingUnitId: 'carton', unitsPerPackage: 12, packageName: '12-pack' }, openExceptionId: null };
const supplierCase = (supplierId, packCost = 14.4) => ({ kind: 'SUPPLIER_CASE', product: soda, openExceptionId: null, supplierCase: { supplierId, supplierName: 'Coke', packSize: 24, packCost } });

test('a scan becomes a line with its pack size, last cost and recorded stock', () => {
  const pack = lines.lineFromMatch(carton, key);
  assert.equal(pack.productId, 'soda');
  assert.equal(pack.sellingUnitId, 'carton');
  assert.equal(pack.packSize, 12);
  assert.equal(pack.cases, '1');
  assert.equal(pack.cost, '7.2');
  assert.equal(pack.previousUnitCost, 0.6);
  assert.deepEqual(plain(pack.recorded), { quantity: 3, lowStockAlert: 5, version: 7 });
  assert.equal(lines.lineUnits(pack), 12);

  const box = lines.lineFromMatch(supplierCase('coke'), key);
  assert.equal(box.packSize, 24);
  assert.equal(box.sellingUnitId, null);
  assert.equal(box.cost, '14.4');
  assert.equal(lines.unitCostOf(box), 0.6);

  // An item with no cost on record leaves the cost blank so it must be entered.
  assert.equal(lines.lineFromMatch({ kind: 'PRODUCT', product: { ...soda, cost: 0 } }, key).cost, '');
});

test('this supplier\'s case wins; matches for different items become choices', () => {
  assert.equal(lines.pickMatch([], 'coke'), null);
  assert.equal(lines.pickMatch([single, supplierCase('coke')], 'coke').match.kind, 'SUPPLIER_CASE');
  assert.equal(lines.pickMatch([single, supplierCase('pepsi')], 'coke').match.kind, 'PRODUCT');
  // Another supplier's case still identifies the item when nothing else matched.
  assert.equal(lines.pickMatch([supplierCase('pepsi')], 'coke').match.kind, 'SUPPLIER_CASE');
  const other = { kind: 'PRODUCT', product: { ...soda, id: 'water', name: 'Water' } };
  assert.equal(lines.pickMatch([single, other], 'coke').choices.length, 2);
});

test('scanning again adds one more of the same size, or singles to a line of another size', () => {
  let state = lines.addScan([], lines.lineFromMatch(carton, key));
  assert.equal(state.lines.length, 1);
  state = lines.addScan(state.lines, lines.lineFromMatch(carton, key));
  assert.equal(state.lines[0].cases, '2');
  assert.equal(lines.lineUnits(state.lines[0]), 24);
  state = lines.addScan(state.lines, lines.lineFromMatch(single, key));
  assert.equal(state.lines.length, 1);
  assert.equal(state.lines[0].units, '1');
  assert.equal(lines.lineUnits(state.lines[0]), 25);
  assert.match(state.note, /added 1 single, 25 units in all/);
  // A different item goes on top of the list.
  state = lines.addScan(state.lines, lines.lineFromMatch({ kind: 'PRODUCT', product: { ...soda, id: 'water', name: 'Water' } }, key));
  assert.deepEqual(plain(state.lines.map(line => line.name)), ['Water', 'Soda Can (12-pack)']);
});

test('a typed shelf count keeps the record it was made against until it is saved', () => {
  const first = { ...lines.lineFromMatch(single, key), shelfCount: '2' };
  const later = lines.lineFromMatch({ ...single, product: { ...soda, stockQuantity: 2, baseStockQuantity: 2, stockVersion: 8 } }, key);
  assert.equal(lines.addScan([first], later).lines[0].recorded.version, 7);
  assert.equal(lines.addScan([{ ...first, countSaved: true }], later).lines[0].recorded.version, 8);
});

test('the shelf count is offered for low items without an open exception and posts the difference', () => {
  const low = lines.lineFromMatch(single, key);
  assert.equal(lines.shelfCountOffered(low), true);
  assert.equal(lines.shelfCountOffered({ ...low, recorded: { ...low.recorded, quantity: 9 } }), false);
  assert.equal(lines.shelfCountOffered(lines.lineFromMatch({ ...single, openExceptionId: 'x1' }, key)), false);
  assert.equal(lines.pendingShelfCount(low), null);
  const counted = lines.pendingShelfCount({ ...low, shelfCount: '1' });
  assert.equal(counted.change, -2);
  assert.equal(counted.expectedVersion, 7);
  assert.equal(counted.idempotencyKey, low.countKey);
  assert.equal(lines.pendingShelfCount({ ...low, shelfCount: '1', countSaved: true }), null);
  assert.equal(lines.pendingShelfCount({ ...low, shelfCount: '1.5' }), null);
});

test('an order lists what it expects; fill as ordered keeps scanned quantities', () => {
  const scanned = lines.lineFromMatch(single, key);
  const items = [
    { productId: 'soda', productName: 'Soda Can', sku: 'SODA', cost: 0.6, packSize: 1, outstanding: 10 },
    { productId: 'chips', productName: 'Chips', sku: 'CHIP', cost: 0.5, packSize: 24, packCost: 12, outstanding: 50 },
    { productId: 'gum', productName: 'Gum', sku: 'GUM', cost: 0.2, outstanding: 0 },
  ];
  let state = lines.withOrderLines([scanned], items, key);
  assert.deepEqual(plain(state.map(line => [line.productId, line.ordered])), [['soda', 10], ['chips', 50]]);
  assert.equal(state[1].cost, '12');
  state = lines.fillAsOrdered(state);
  assert.equal(lines.lineUnits(state[0]), 1);
  assert.deepEqual([state[1].cases, state[1].units, lines.lineUnits(state[1])], ['2', '2', 50]);
  // Unlinking the order drops expected lines with nothing entered.
  const unlinked = lines.withoutOrder(lines.withOrderLines([scanned], items, key));
  assert.deepEqual(plain(unlinked.map(line => [line.productId, line.ordered])), [['soda', null]]);
});

test('lines with a problem say what to fix; empty lines are left out', () => {
  const order = { orderNumber: 'PO-1' };
  const line = lines.lineFromMatch(single, key);
  assert.deepEqual(plain(lines.lineIssues(line, null)), []);
  assert.deepEqual(plain(lines.lineIssues({ ...line, units: '' }, order)), []);
  assert.deepEqual(plain(lines.lineIssues({ ...line, cost: '' }, null)), ['Enter the cost.']);
  assert.deepEqual(plain(lines.lineIssues({ ...line, cost: '0' }, null)), ['Enter the cost, or confirm these came free.']);
  assert.deepEqual(plain(lines.lineIssues({ ...line, cost: '0', freeConfirmed: true }, null)), []);
  assert.deepEqual(plain(lines.lineIssues({ ...line, tracked: false }, null)), ['Stock is not counted for this item, so a delivery cannot add to it.']);
  assert.match(lines.lineIssues(line, order)[0], /Not on order PO-1/);
  assert.match(lines.lineIssues({ ...line, units: '12', ordered: 10 }, order)[0], /Only 10 left on order PO-1/);
  const fresh = lines.newItemLine({ code: '777', name: ' Jerky ', sku: '', price: '', cost: '1.25', units: '' }, key);
  assert.equal(fresh.sku, '777');
  assert.equal(fresh.units, '1');
  assert.deepEqual(plain(lines.lineIssues(fresh, null)), ['Enter the selling price.']);
  assert.match(lines.lineIssues({ ...fresh, price: '2.99' }, order)[0], /New items cannot be received on order PO-1/);
});

test('receipt items carry accepted units, unit cost and sealed packs', () => {
  const pack = { ...lines.lineFromMatch(carton, key), cases: '2', units: '3' };
  const box = lines.lineFromMatch(supplierCase('coke'), key);
  const fresh = { ...lines.newItemLine({ code: '777', name: 'Jerky', sku: 'JRK', price: '2.99', cost: '0', units: '4' }, key), freeConfirmed: true };
  const empty = { ...lines.lineFromMatch(single, key), units: '' };
  assert.deepEqual(plain(lines.receiptItems([pack, box, fresh, empty])), [
    { matchedProductId: 'soda', name: 'Soda Can (12-pack)', packSize: 12, sellingUnitId: 'carton', receivedPackageQuantity: 2, unitQuantity: 27, unitCost: 0.6, zeroCostConfirmed: false },
    { matchedProductId: 'soda', name: 'Soda Can', packSize: 24, unitQuantity: 24, unitCost: 0.6, zeroCostConfirmed: false },
    { matchedProductId: null, name: 'Jerky', packSize: 1, unitQuantity: 4, unitCost: 0, zeroCostConfirmed: true, price: 2.99, sku: 'JRK', barcode: '777' },
  ]);
});

test('a saved draft round-trips; anything unreadable starts empty', () => {
  const draft = { ...lines.emptyDraft(), supplier: { id: 's', name: 'Coke' }, lines: [lines.lineFromMatch(single, key)] };
  assert.deepEqual(plain(lines.parseDraft(lines.serializeDraft(draft))), plain(draft));
  assert.equal(lines.parseDraft(null), null);
  assert.equal(lines.parseDraft('{bad'), null);
  assert.equal(lines.parseDraft(JSON.stringify({ lines: [] })), null);
});
