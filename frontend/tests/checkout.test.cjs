const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

test('successive tender balances use cents and quote the card surcharge without losing the last cent', () => {
  const { paymentTotal, amountToComplete } = load('services/paymentSession.ts', { './offlineDb': { db: {} }, '@/lib/money': load('../../backend/src/utils/moneyNumbers.ts') });
  const cash = { paymentMethod: 'CASH', amount: 20 }, card = { paymentMethod: 'CARD', amount: 78.81 };
  assert.equal(amountToComplete(100, 0, [cash], 'CARD'), 80);
  assert.equal(paymentTotal([cash, card]), 98.81);
  assert.equal(amountToComplete(100, 0, [cash, card], 'CASH'), 1.19);
  assert.equal(paymentTotal([cash, card, { paymentMethod: 'CASH', amount: 1.19 }]), 100);
  assert.equal(amountToComplete(100, 3, [cash], 'CARD'), 82.47);
  assert.equal(amountToComplete(100, 3, [cash, card], 'CASH'), 3.55);
  assert.equal(amountToComplete(0.05, 3, [{ paymentMethod: 'CASH', amount: 0.02 }], 'CARD'), 0.03);
});

test('receipt scans recognize compact and legacy references without confusing product barcodes', () => {
  const { isSaleReference, normalizeSaleReference } = load('lib/receiptReference.ts');
  for (const value of ['S-261025-100001', 'SALE-20261024-1234', 'SALE-20261024-28d2863c-c5d6-4741-86ca-39d5fd3e2dc8']) assert.equal(isSaleReference(value), true);
  for (const value of ['123456789012', 'S-261025-1', 'SALE-not-a-receipt']) assert.equal(isSaleReference(value), false);
  assert.equal(normalizeSaleReference(' #s-261025-100001 '), 'S-261025-100001');
  assert.equal(normalizeSaleReference('100001'), '100001');
});

test('receipt totals and names use booked sale facts for first print and reprint', () => {
  const { receiptFromSale } = load('services/receiptFromSale.ts', { '@/lib/money': load('../../backend/src/utils/moneyNumbers.ts'),
    '@/lib/utils': { formatCurrency: amount => '$' + Number(amount).toFixed(2), formatDateTime: date => new Date(date).toISOString(), formatEnumLabel: value => String(value) },
    '@/store/storeSettingsStore': { useStoreSettingsStore: { getState: () => ({ timezone: null }) } } });
  const sale = { saleNumber: 'SALE-1', createdAt: '2026-10-15T12:00:00Z', subtotal: 3, discount: 1, tax: 0.3, surcharge: 0, total: 2.3, amountPaid: 5, changeDue: 2.7, paymentMethod: 'CASH', pointsEarned: 2, pointsRedeemed: 100,
    items: [{ productName: 'Original name', price: 1, quantity: 3, product: { name: 'Renamed product', price: 99 } }], customer: { firstName: 'A', lastName: 'Customer', loyaltyPoints: 9999 } };
  const first = receiptFromSale(sale);
  const reprint = receiptFromSale(JSON.parse(JSON.stringify(sale)));
  assert.deepEqual(first, reprint);
  assert.equal(first.items[0].name, 'Original name'); assert.equal(first.items[0].total, 3);
  assert.equal(first.subtotal - first.discount + first.tax, first.total);
  assert.equal(first.pointsRedeemed, 100); assert.equal(first.pointsEarned, 2);
  assert.equal(first.loyaltyPoints, undefined);
});

test('pending cash operations survive reload and remain isolated by cashier, store and action', () => {
  const entries = new Map();
  const localStorage = { getItem: key => entries.get(key) ?? null };
  const first = load('services/pendingCashOperation.ts', {}, { localStorage });
  const key = first.cashOperationKey('refund', 'cashier-a', 'store-a');
  entries.set(key, JSON.stringify({ saleId: 'sale-a', label: 'Receipt A', amount: 5, payload: { amount: 5, idempotencyKey: 'original-key' } }));
  const reloaded = load('services/pendingCashOperation.ts', {}, { localStorage });
  assert.equal(reloaded.readCashOperation(key).payload.idempotencyKey, 'original-key');
  for (const scope of [['refund', 'cashier-b', 'store-a'], ['refund', 'cashier-a', 'store-b'], ['movement', 'cashier-a', 'store-a']]) assert.equal(reloaded.readCashOperation(reloaded.cashOperationKey(...scope)), null);
  entries.set(key, '{broken');
  assert.throws(() => reloaded.readCashOperation(key), /reconcile/);
});

test('uncertain cash requests keep their key through database failure, logout and network loss', () => {
  const { cashOperationRejected } = load('services/pendingCashOperation.ts');
  for (const error of [{ code: 'ERR_NETWORK' }, { code: 'ERR_CANCELED' }, { response: { status: 401 } }, { response: { status: 500 } }, { response: { status: 400, data: { retrySameRequest: true } } }]) assert.equal(cashOperationRejected(error), false);
  assert.equal(cashOperationRejected({ response: { status: 400, data: { error: 'Refund amount exceeds refundable balance' } } }), true);
});

test('completed card-refund evidence is recognized in single and bulk recovery payloads', () => {
  const { hasExternalRefundEvidence } = load('services/pendingCashOperation.ts');
  const part = { sourcePaymentId: 'card-original', method: 'CARD', amount: 10, reference: 'TERMINAL-REFUND-1' };
  for (const payload of [{ refundTenders: [part] }, { sales: [{ refundTenders: [part] }] },
    { refundMethod: 'CARD', amount: 10, reference: part.reference }, { refundMethod: 'CARD', items: [{ saleItemId: 'item', quantity: 1 }], reference: part.reference },
    { sales: [{ refundMethod: 'CARD', expectedAmount: 10, reference: part.reference }] }]) {
    assert.equal(hasExternalRefundEvidence(payload), true);
  }
  for (const payload of [{}, { sales: [null, 'bad'] }, { refundTenders: [{ ...part, amount: 0 }] },
    { refundTenders: [{ ...part, reference: ' ' }] }, { sales: [{ refundTenders: [{ ...part, method: 'CASH' }] }] }]) {
    assert.equal(hasExternalRefundEvidence(payload), false);
  }
});

test('saved bulk voids retain the complete request across reload and remain scoped to store and actor', () => {
  const entries = new Map();
  const localStorage = { getItem: key => entries.get(key) ?? null };
  const mocks = { zod: require('zod') };
  const first = load('services/pendingBulkVoid.ts', mocks, { localStorage });
  const key = first.bulkVoidStorageKey('owner-a', 'store-a');
  const id = '10000000-0000-4000-8000-000000000001';
  const saved = { payload: { idempotencyKey: '20000000-0000-4000-8000-000000000001', reason: 'Duplicate batch', sales: [{ id, expectedAmount: 11 }] }, labels: { [id]: 'SALE-1' } };
  entries.set(key, JSON.stringify(saved));
  const reloaded = load('services/pendingBulkVoid.ts', mocks, { localStorage });
  assert.equal(JSON.stringify(reloaded.readPendingBulkVoid(key)), JSON.stringify(saved));
  assert.equal(reloaded.readPendingBulkVoid(first.bulkVoidStorageKey('owner-b', 'store-a')), null);
  assert.equal(reloaded.readPendingBulkVoid(first.bulkVoidStorageKey('owner-a', 'store-b')), null);
});

test('bulk recovery refuses malformed, incomplete, duplicate or fractional-cent saved requests', () => {
  let value;
  const { readPendingBulkVoid } = load('services/pendingBulkVoid.ts', { zod: require('zod') }, { localStorage: { getItem: () => value } });
  const id = '10000000-0000-4000-8000-000000000001';
  const saved = { payload: { idempotencyKey: '20000000-0000-4000-8000-000000000001', reason: 'Duplicate', sales: [{ id, expectedAmount: 11 }] }, labels: { [id]: 'SALE-1' } };
  for (const invalid of [
    { ...saved, labels: {} }, { ...saved, payload: { ...saved.payload, reason: ' ' } },
    { ...saved, payload: { ...saved.payload, sales: [saved.payload.sales[0], saved.payload.sales[0]] } },
    { ...saved, payload: { ...saved.payload, sales: [{ id, expectedAmount: 11.001 }] } },
    { payload: { idempotencyKey: saved.payload.idempotencyKey } },
  ]) { value = JSON.stringify(invalid); assert.throws(() => readPendingBulkVoid('key')); }
  value = '{broken'; assert.throws(() => readPendingBulkVoid('key'));
});

// Execute the actual TypeScript modules with browser/API boundaries replaced.
test('recorded stock never limits the cart; recalls and invalid quantities do', () => {
  const { useCartStore } = load('store/cartStore.ts', {
    zustand: require('zustand'), 'zustand/middleware': { persist: initialize => initialize },
    '@/lib/money': load('../../backend/src/utils/moneyNumbers.ts'),
    '../lib/promotionEngine': { applyPromotions() {}, isPromotionActiveNow() { return true; } },
  });
  const cart = useCartStore.getState();
  const product = { id: 'tracked', price: 10, trackInventory: true, stockQuantity: 2 };
  // The customer is holding the item: a third unit sells although two are recorded.
  for (let unit = 0; unit < 3; unit++) assert.equal(cart.addItem(product), true);
  assert.equal(useCartStore.getState().items[0].quantity, 3);
  cart.updateQuantity(product.id, 5);
  assert.equal(useCartStore.getState().items[0].quantity, 5);
  assert.equal(cart.addItem({ ...product, id: 'empty', stockQuantity: 0 }), true);
  for (const quantity of [0, -1, 0.5, NaN, Infinity]) assert.equal(cart.addItem(product, quantity), false);
  // A recall or prohibited-sale hold is the one thing that refuses an item.
  assert.equal(cart.addItem({ ...product, id: 'recalled', saleBlockedReason: 'Recalled by supplier' }), false);
  assert.equal(useCartStore.getState().items.some(item => item.product.id === 'recalled'), false);
  cart.updateQuantity(product.id, 0);
  assert.equal(useCartStore.getState().items.some(item => item.product.id === product.id), false);
});

function load(file, mocks = {}, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    exports: module.exports, module,
    require: name => { if (!(name in mocks)) throw new Error('Unexpected dependency: ' + name); return mocks[name]; },
    console: { log() {}, warn() {}, error() {} }, setTimeout, ...globals,
  }, { filename: file });
  return module.exports;
}

test('checkout identity survives a retry and reload, but changes for a different cart', () => {
  const { checkoutIdentity } = load('lib/checkoutIdentity.ts');
  const entries = new Map();
  const storage = { getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value) };
  const first = checkoutIdentity(storage, 'cart-a', () => 'key-a', 1000);
  const retry = checkoutIdentity(storage, 'cart-a', () => { throw new Error('Must reuse original key'); }, 2000);
  assert.equal(retry.key, first.key);
  assert.equal(retry.createdAt, 1000);
  assert.equal(checkoutIdentity(storage, 'cart-b', () => 'key-b', 3000).key, 'key-b');
});

function syncFixture() {
  let user = { id: 'cashier-a', locationId: 'store-a' };
  const pending = [];
  const submitted = [];
  let failures = 0;
  let requestError = null;
  const offlineDb = {
    getPendingSaleCount: async () => pending.filter(s => !s.synced).length,
    savePendingSale: async sale => { pending.push({ ...sale, id: 1 }); return 1; },
    getPendingSales: async () => pending.filter(s => !s.synced),
    markSaleAsSynced: async () => { pending[0].synced = true; },
    markSaleSyncFailed: async () => { failures++; }, addSyncLog: async () => {},
  };
  const { syncService } = load('services/syncService.ts', {
    './offlineDb': { offlineDb },
    './api': { saleService: { create: async payload => { submitted.push(payload); if (requestError) throw requestError; return { data: { data: { id: 'server-sale' } } }; } } },
    '../store/authStore': { useAuthStore: { getState: () => ({ user, isAuthenticated: true }), subscribe: () => () => {} } },
    '../store/adminViewStore': { useAdminViewStore: { getState: () => ({ isAdminViewing: false }) } },
    './sessionGeneration': { sessionGeneration: () => 0 },
    './storeContextGeneration': { storeContextGeneration: () => 0 },
    './connection': { isOffline: () => true, subscribeConnection: () => () => {} },
  }, { navigator: { onLine: false }, window: { addEventListener() {}, setInterval() {}, clearInterval() {} } });
  return { syncService, pending, submitted, setUser: value => { user = value; }, setRequestError: value => { requestError = value; }, failures: () => failures };
}

const cashCheckout = () => ({
  userId: 'cashier-a', locationId: 'store-a', shiftId: 'original-shift', createdAt: 1000, expectedTotal: 11,
  snapshot: { subtotal: 10, tax: 1, discount: 0 },
  payload: { idempotencyKey: 'original-key', items: [{ productId: 'product', quantity: 1, price: 10, priceOverride: true }], paymentMethod: 'CASH', payments: [{ paymentMethod: 'CASH', amount: 20 }], amountPaid: 20, ageVerification: { method: 'MANUAL_DOB', birthDate: '1980-01-01' } },
});

test('a session change during offline replay retains the sale and its retry budget', async () => {
  const fixture = syncFixture();
  await fixture.syncService.queueCheckout(cashCheckout());
  fixture.setRequestError({ code: 'ERR_CANCELED', message: 'Session changed' });
  await fixture.syncService.syncPendingSales();
  assert.equal(fixture.failures(), 0);
  assert.equal(fixture.pending[0].synced, false);
  fixture.setRequestError(null);
  await fixture.syncService.syncPendingSales();
  assert.equal(fixture.pending[0].synced, true);
  assert.equal(fixture.submitted[0].idempotencyKey, fixture.submitted[1].idempotencyKey);
});

test('offline replay preserves the original key, age check, price override, totals and shift', async () => {
  const fixture = syncFixture();
  const original = cashCheckout();
  await fixture.syncService.queueCheckout(original);
  assert.equal(fixture.pending[0].localId, original.payload.idempotencyKey);
  assert.equal(fixture.pending[0].tax, 1);
  await fixture.syncService.syncPendingSales();
  assert.equal(fixture.submitted.length, 1);
  const replay = fixture.submitted[0];
  assert.equal(replay.idempotencyKey, 'original-key');
  assert.equal(replay.offlineShiftId, 'original-shift');
  assert.equal(replay.offlineCreatedAt, '1970-01-01T00:00:01.000Z');
  assert.equal(replay.items[0].priceOverride, true);
  assert.equal(replay.ageVerification.birthDate, '1980-01-01');
  assert.equal(replay.expectedTotal, 11);
});

test('a different cashier cannot replay another cashier sale or consume its retry budget', async () => {
  const fixture = syncFixture();
  await fixture.syncService.queueCheckout(cashCheckout());
  fixture.setUser({ id: 'cashier-b', locationId: 'store-a' });
  await fixture.syncService.syncPendingSales();
  assert.equal(fixture.submitted.length, 0);
  assert.equal(fixture.failures(), 0);
  assert.equal(fixture.pending[0].synced, false);
});

test('cash-majority split payments and loyalty redemption cannot silently become offline cash', async () => {
  for (const extra of [{ payments: [{ paymentMethod: 'CASH', amount: 9 }, { paymentMethod: 'CARD', amount: 2 }] }, { pointsRedeemed: 100 }]) {
    const fixture = syncFixture();
    const checkout = cashCheckout();
    Object.assign(checkout.payload, extra);
    await assert.rejects(fixture.syncService.queueCheckout(checkout), /cash only/);
    assert.equal(fixture.pending.length, 0);
  }
});

function quantityFixture(maxQty) {
  const slots = []; let index = 0, keydown, tree;
  const confirmed = [];
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: initial => { const i=index++; if (!(i in slots)) slots[i]=initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef: initial => { const i=index++; if (!(i in slots)) slots[i]={current:initial}; return slots[i]; },
    useEffect: fn => fn(),
  };
  const { QuantityNumpad } = load('components/pos/QuantityNumpad.tsx', {
    react: { __esModule:true, default:react, ...react }, 'lucide-react': { Delete: 'delete-icon' },
    '@/components/ui/Modal': { Modal: 'modal' },
  }, { window:{ addEventListener: (_event,handler) => { keydown=handler; }, removeEventListener(){} } });
  const render = () => { index=0; tree=QuantityNumpad({initialQty:1,maxQty,productName:'Test product',onConfirm:q=>confirmed.push(q),onCancel(){}}); };
  const find = (node,predicate) => { if (!node || typeof node !== 'object') return null; if (predicate(node)) return node; return (Array.isArray(node) ? node : node.children || []).map(n=>find(n,predicate)).find(Boolean); };
  render();
  return { confirmed, click: label => { const button=find(tree,n=>n.type==='button' && n.children.includes(label)); assert.ok(button); button.props.onClick();render(); }, key: key => { keydown({key,preventDefault(){}});render(); }, confirmButton:()=>find(tree,n=>n.type==='button' && n.children.includes('OK')) };
}
test('quantity pad replaces the starting 1 on the first digit, then appends subsequent digits', () => {
  const pad=quantityFixture(99);pad.click('3');pad.click('OK');assert.deepEqual(pad.confirmed,[3]);
  const multi=quantityFixture(99);multi.key('3');multi.key('2');multi.key('Enter');assert.deepEqual(multi.confirmed,[32]);
});
test('quantity pad clears without restoring a hidden 1 and blocks amounts above stock', () => {
  const pad=quantityFixture(99);pad.key('Backspace');pad.key('5');pad.key('Enter');assert.deepEqual(pad.confirmed,[5]);
  const tooMany=quantityFixture(99);tooMany.key('1');tooMany.key('0');tooMany.key('0');assert.equal(tooMany.confirmButton().props.disabled,true);tooMany.key('Enter');assert.deepEqual(tooMany.confirmed,[]);
});

function effectiveLocationFixture(user, adminView = {}) {
  return load('hooks/useEffectiveLocation.ts', {
    react: { useMemo: factory => factory() },
    '../store/authStore': { useAuthStore: () => ({ user }) },
    '../store/adminViewStore': { useAdminViewStore: () => adminView },
  }).useEffectiveLocation();
}
test('a session from the old login response can immediately resolve its store for transfers', () => {
  const result = effectiveLocationFixture({ role: 'ADMIN', location: { id: 'store-a' } });
  assert.equal(result.locationId, 'store-a');
  assert.equal(result.isReadOnly, false);
});
test('store fallback respects current assignment and keeps super-admin previews read-only', () => {
  const stalePreview = { isAdminViewing: true, viewingLocationId: 'store-b', viewingStoreName: 'Partner' };
  assert.equal(effectiveLocationFixture({ role: 'ADMIN', locationId: 'store-a', location: { id: 'old-store' } }, stalePreview).locationId, 'store-a');
  assert.equal(effectiveLocationFixture({ role: 'SUPER_ADMIN', locationId: null, location: { id: 'old-store' } }).locationId, null);
  const preview = effectiveLocationFixture({ role: 'SUPER_ADMIN', location: { id: 'store-a' } }, stalePreview);
  assert.equal(preview.locationId, 'store-b');
  assert.equal(preview.isReadOnly, true);
});

test('refund suggestions preserve split-source cents, remaining limits and explicit terminal evidence', () => {
  const { refundTenderSelection } = load('services/refundTenderSelection.ts');
  const options = [{ sourcePaymentId: 'cash', method: 'CASH', originalAmount: 11.99, remainingAmount: 11.99 },
    { sourcePaymentId: 'card', method: 'CARD', originalAmount: 10, remainingAmount: 10 }];
  const suggested = refundTenderSelection(options, 10, {});
  assert.equal(suggested.tenders.reduce((sum, row) => sum + Math.round(row.amount * 100), 0), 1000);
  assert.equal(suggested.invalid, true);
  const reviewed = refundTenderSelection(options, 21.99, { card: { reference: 'TERMINAL-RETURN' } });
  assert.equal(reviewed.invalid, false); assert.equal(reviewed.tenders[0].amount, 11.99); assert.equal(reviewed.tenders[1].amount, 10);
  assert.equal(refundTenderSelection(options, 21.99, { cash: { amount: '21.99' }, card: { amount: '0' } }).invalid, true);
  assert.equal(refundTenderSelection([], 0, {}).invalid, false);
  assert.equal(refundTenderSelection([], 1, {}).invalid, true);
  assert.equal(refundTenderSelection(options, Infinity, {}).invalid, true);
});

test('P&L CSV ignores legacy estimates and keeps store dates and unknown facts', () => {
  const utils = load('lib/utils.ts', { clsx: { clsx() {} }, 'tailwind-merge': { twMerge() {} } });
  const { profitAndLossCsv } = load('services/profitAndLossExport.ts', { '@/lib/utils': utils });
  const report = { scope: { locationId: 'store-1', storeName: '=HYPERLINK("untrusted")' }, snapshotAt: '2026-10-23T12:00:00Z',
    period: { start: '2026-03-01T06:00:00Z', end: '2026-04-01T05:00:00Z', timezone: 'America/Chicago', endExclusive: true },
    revenue: { grossSales: 100, refunds: 0, voids: 0, netSales: 100, taxCollected: 10 },
    costOfGoodsSold: null, grossProfit: null, netIncome: null, margins: { gross: null, net: null },
    operatingExpenses: { total: 50, byCategory: [{ category: 'OTHER', amount: 50 }] }, otherIncome: 5, inventoryPurchases: 90, receivedInventoryPurchases: 1000,
    unavailableReason: 'Historical costs unknown', historyWarning: 'Daily summaries included',
    estimate: { assumption: 'Cost is 70% of pre-tax sales', costRatePercent: 70, costOfGoodsSold: 70, grossProfit: 30, netIncome: -15, margins: { gross: 30, net: -15 } } };
  const original = JSON.stringify(report);
  const estimated = profitAndLossCsv(report, true);
  assert.equal(estimated.filename, 'pnl-store-1-2026-03-01-to-2026-03-31-recorded.csv');
  assert.ok(estimated.csv.includes('"Profit","Net income","Unavailable","USD","Recorded"'));
  assert.ok(!estimated.csv.includes("Cost assumption"));
  assert.ok(estimated.csv.includes('"Period end (inclusive)","2026-03-31"'));
  assert.ok(estimated.csv.includes('"\'=HYPERLINK(""untrusted"")"'));
  const recorded = profitAndLossCsv(report, false);
  assert.ok(recorded.csv.includes('"Profit","Net income","Unavailable","USD","Recorded"'));
  assert.ok(recorded.csv.includes('Historical costs unknown')); assert.ok(!recorded.csv.includes('Cost assumption'));
  assert.ok(recorded.csv.includes('"Inventory received at cost (not deducted again)","1000"'));
  assert.ok(recorded.csv.includes('"Inventory purchase expense entries (may overlap receipts)","90"'));
  assert.equal(JSON.stringify(report), original);
  assert.equal(profitAndLossCsv({ ...report, estimate: null }, true).csv, recorded.csv);
  // Open stock exceptions: the figures are exported, each marked as not final, with the reason.
  const reason = 'Includes $4.50 of estimated cost for 1 stock exception. Resolve it in Stock Control to confirm profit.';
  const notFinal = profitAndLossCsv({ ...report, costOfGoodsSold: 70, grossProfit: 30, netIncome: -15, margins: { gross: 30, net: -15 },
    unavailableReason: null, costBasis: 'PROVISIONAL', provisionalReason: reason });
  assert.equal(notFinal.filename, 'pnl-store-1-2026-03-01-to-2026-03-31-not-final.csv');
  assert.ok(notFinal.csv.includes('"Profit","Net income","-15","USD","Not final"'));
  assert.ok(notFinal.csv.includes('"Revenue","Net sales","100","USD","Recorded"'));
  assert.ok(notFinal.csv.includes('"Notes","Not final","Includes estimated costs awaiting review. ' + reason + '","","Recorded"'));
});

test('CSV formula-looking text is escaped while numeric values and multiline labels retain their data', () => {
  const { buildCsv } = load('lib/utils.ts', { clsx: { clsx() {} }, 'tailwind-merge': { twMerge() {} } });
  const csv = buildCsv(['Value'], [['=1+1'], [' +1+1'], ['@SUM(1)'], ['\t=1+1'], [-12.35], [0], ['A, "B"\nC']]);
  for (const text of ['=1+1', ' +1+1', '@SUM(1)', '\t=1+1']) assert.ok(csv.includes('"\'' + text + '"'));
  assert.ok(csv.includes('"-12.35"')); assert.ok(!csv.includes('"\'-12.35"'));
  assert.ok(csv.includes('"A, ""B""\nC"'));
});

test('large split-source refund suggestions use exact integer allocation and do not silently lose a cent', () => {
  const { refundTenderSelection } = load('services/refundTenderSelection.ts');
  const options = [999999999.99, 333333333.33, 222222222.22].map((amount, index) => ({ sourcePaymentId: String(index), method: 'CASH', originalAmount: amount, remainingAmount: amount }));
  for (const amount of [0.01, 1.01, 999999999.99]) {
    const result = refundTenderSelection(options, amount, {});
    assert.equal(result.tenders.reduce((sum, row) => sum + Math.round(row.amount * 100), 0), Math.round(amount * 100));
    assert.equal(result.invalid, false);
  }
});

test('Excel P&L preserves numeric daily facts, formulas, missing costs and source text after XLSX round-trip', async () => {
  const ExcelJS = require('exceljs');
  const { buildProfitAndLossWorkbook } = load('services/profitAndLossWorkbook.ts', { exceljs: { default: ExcelJS } }, { Date });
  const period = { start: '2026-03-01T06:00:00Z', end: '2026-04-01T05:00:00Z', timezone: 'America/Chicago', endExclusive: true };
  const estimate = { assumption: '70% of net sales before tax', costRatePercent: 70, costOfGoodsSold: 70, grossProfit: 30, netIncome: -15, margins: { gross: 30, net: -15 } };
  const report = { scope: { locationId: 'store-1', storeName: 'Store One' }, snapshotAt: '2026-10-23T12:00:00Z', period,
    revenue: { netSales: 100 }, operatingExpenses: { total: 50 }, otherIncome: 5, inventoryPurchases: 100, receivedInventoryPurchases: 100, estimate,
    workbook: { months: [{ month: '2026-03', store: { id: 'store-1', name: 'Store One' }, period, estimate,
      days: [{ date: '2026-03-01', sales: 110, tax: 10, refunds: 0, voids: 0, netSales: 100, register1: 40, tax1: 10, register2: null, tax2: null, card: 70, lotteryNet: -1.5 }],
      metrics: { grossCollected: 110, netSales: 100, netTax: 10, refunds: 0, voids: 0, expenses: 50, otherIncome: 5, inventoryPurchases: 100, receivedInventoryPurchases: 100,
        costOfGoodsSold: 70, grossProfit: 30, netProfit: -15, grossMargin: 30, unavailableReason: null },
      expenses: [{ description: '=HYPERLINK("untrusted")', amount: 50, sourceType: 'MONTHLY_SUMMARY' }], income: [{ kind: 'GAMING_ATM', amount: 5 }] }] } };
  const before = JSON.stringify(report);
  const { workbook, filename } = buildProfitAndLossWorkbook(report, true);
  const reloaded = new ExcelJS.Workbook(); await reloaded.xlsx.load(await workbook.xlsx.writeBuffer());
  const sheet = reloaded.getWorksheet('2026-03');
  assert.equal(sheet.getCell('A3').value, 'RECORDED COSTS');
  assert.equal(filename, 'pnl-store-1-2026-03-01-to-2026-03-31-recorded.xlsx');
  assert.equal(sheet.getCell('B7').value, 110); assert.equal(sheet.getCell('C7').value, 40);
  assert.equal(sheet.getCell('E7').value, null); assert.equal(sheet.getCell('H7').value, -1.5);
  assert.equal(sheet.getCell('B8').result, 110); assert.equal(sheet.getCell('E8').value, null);
  assert.equal(sheet.getCell('J14').value, '=HYPERLINK("untrusted")'); assert.equal(sheet.getCell('J14').type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell('M11').result, 100); assert.equal(sheet.getCell('M11').formula, 'ROUND(M7-M8-M9-M10,2)');
  let netIncome, grossMargin;
  sheet.eachRow(row => { if (row.getCell(10).text === 'Net income') netIncome = row.getCell(13); if (row.getCell(10).text === 'Gross margin') grossMargin = row.getCell(13); });
  assert.equal(netIncome.result, -15); assert.ok(netIncome.numFmt.includes('[Red]')); assert.equal(grossMargin.result, 0.3); assert.ok(grossMargin.numFmt.includes('%'));
  const purchases = {};
  sheet.eachRow(row => { if (['Inventory received at cost', 'Inventory purchase expense entries'].includes(row.getCell(10).text)) purchases[row.getCell(10).text] = row.getCell(13).value; });
  assert.deepEqual(purchases, { 'Inventory received at cost': 100, 'Inventory purchase expense entries': 100 });
  const multi = buildProfitAndLossWorkbook({ ...report, workbook: { months: [report.workbook.months[0], { ...report.workbook.months[0], month: '2026-04' }] } }).workbook;
  const totals = multi.getWorksheet('Period totals');
  const references = {};
  totals.eachRow(row => { if (row.getCell(1).text.includes('(reference)')) references[row.getCell(1).text] = row.getCell(2).value; });
  assert.deepEqual(references, { 'Inventory received at cost (reference)': 100, 'Inventory purchase expense entries (reference)': 100 });
  assert.equal(sheet.views[0].ySplit, 6); assert.equal(sheet.pageSetup.orientation, 'landscape');
  const missing = { ...report, workbook: { months: [{ ...report.workbook.months[0], metrics: { ...report.workbook.months[0].metrics, costOfGoodsSold: null, grossProfit: null, netProfit: null, grossMargin: null } }] } };
  const recorded = buildProfitAndLossWorkbook(missing, false).workbook.worksheets[0];
  assert.equal(recorded.getCell('A3').value, 'RECORDED COSTS • Cost information incomplete');
  recorded.eachRow(row => { if (row.getCell(10).text === 'Net income') assert.equal(row.getCell(13).value, 'Unavailable'); });
  // Open stock exceptions: the month keeps its figures and is marked as not final.
  const pendingReason = 'Includes $4.50 of estimated cost for 1 stock exception. Resolve it in Stock Control to confirm profit.';
  const pending = buildProfitAndLossWorkbook({ ...report, costBasis: 'PROVISIONAL', provisionalReason: pendingReason,
    workbook: { months: [{ ...report.workbook.months[0], metrics: { ...report.workbook.months[0].metrics, provisionalReason: pendingReason } }] } });
  assert.equal(pending.filename, 'pnl-store-1-2026-03-01-to-2026-03-31-not-final.xlsx');
  const pendingSheet = pending.workbook.worksheets[0], pendingNotes = [];
  assert.equal(pendingSheet.getCell('A3').value, 'NOT FINAL • Includes estimated costs awaiting review');
  pendingSheet.eachRow(row => { pendingNotes.push(row.getCell(1).text); if (row.getCell(10).text === 'Net income') assert.equal(row.getCell(13).result, -15); });
  assert.ok(pendingNotes.includes('Not final: includes estimated costs awaiting review. ' + pendingReason));
  assert.equal(JSON.stringify(report), before);
  const empty = { ...report, workbook: { months: [{ ...report.workbook.months[0], month: '2026-04', days: [], expenses: [], income: [], metrics: { ...report.workbook.months[0].metrics, grossCollected: 0, netSales: 0, netTax: 0, expenses: 0, otherIncome: 0, costOfGoodsSold: 0, grossProfit: 0, netProfit: 0, grossMargin: null },
    estimate: { ...estimate, costOfGoodsSold: 0, grossProfit: 0, netIncome: 0, margins: { gross: null, net: null } } }] } };
  const emptySheet = buildProfitAndLossWorkbook(empty, true).workbook.worksheets[0];
  assert.equal(emptySheet.getCell('B8').result, 0);
  emptySheet.eachRow(row => { if (row.getCell(10).text === 'Gross margin') assert.equal(row.getCell(13).value, 'Unavailable'); });
});

function settingsFixture() {
  const responses = [];
  const locationService = {
    getMySettings: () => new Promise(resolve => responses.push(resolve)),
    updateMySettings: () => new Promise(resolve => responses.push(resolve)),
  };
  const { useStoreSettingsStore } = load('store/storeSettingsStore.ts', {
    zustand: require('zustand'), 'zustand/middleware': { persist: initialize => initialize },
    '@/services/api': { locationService }, '@/services/hardware': { hardware: { applyStoreBranding() {} } },
  });
  const store = (updatedAt, giftCard, id = 'store-a') => ({ id, name: 'Store', taxRate: 8, timezone: 'America/Chicago', updatedAt,
    settings: { paymentMethods: { cash: true, card: true, giftCard, storeCredit: false } } });
  return { settings: useStoreSettingsStore, store, answer: (index, data) => responses[index]({ data: { data } }) };
}

test('settings that arrive with the checkout quote load the store, but never replace a newer saved change', async () => {
  const { settings, store, answer } = settingsFixture();
  // The quote's settings are enough on their own: no separate settings request is needed.
  assert.equal(settings.getState().applyServerSettings(store('2026-11-10T10:00:00.000Z', false), 'store-a'), true);
  assert.equal(settings.getState().isLoaded, true);
  assert.equal(settings.getState().storeInfo.taxRate, 8);
  assert.equal(settings.getState().applyServerSettings(store('2026-11-10T10:00:00.000Z', false, 'store-b'), 'store-a'), false);

  // The owner turns gift cards on while a quote read just before that change is still on its way.
  const saving = settings.getState().savePaymentMethods({ cash: true, card: true, giftCard: true, storeCredit: false });
  answer(0, store('2026-11-10T10:05:00.000Z', true));
  await saving;
  assert.equal(settings.getState().paymentMethods.giftCard, true);
  assert.equal(settings.getState().applyServerSettings(store('2026-11-10T10:04:59.000Z', false), 'store-a'), true);
  assert.equal(settings.getState().paymentMethods.giftCard, true);
  // A later change made elsewhere still comes through.
  settings.getState().applyServerSettings(store('2026-11-10T10:06:00.000Z', false), 'store-a');
  assert.equal(settings.getState().paymentMethods.giftCard, false);
});

test('one unanswered request takes the register offline only when the server health check fails too', async () => {
  const timers = [];
  const connection = load('services/connection.ts', {}, { navigator: { onLine: true }, window: { addEventListener() {} },
    setTimeout: callback => { timers.push(callback); return timers.length; }, clearTimeout() {} });
  let healthy = true;
  const seen = [];
  connection.setServerCheck(async () => healthy);
  connection.subscribeConnection(offline => seen.push(offline));

  // A single blocked or failing request while the server is fine: still online, nobody is told anything.
  connection.serverDidNotAnswer();
  await connection.connectionSettled();
  assert.equal(connection.isOffline(), false);
  assert.deepEqual(seen, []);

  // The server really is gone: offline, and the register keeps looking for it.
  healthy = false;
  connection.serverDidNotAnswer();
  await connection.connectionSettled();
  assert.equal(connection.isOffline(), true);
  assert.deepEqual(seen, [true]);
  await timers.at(-1)();
  assert.equal(connection.isOffline(), true);
  healthy = true;
  await timers.at(-1)();
  assert.equal(connection.isOffline(), false);
  assert.deepEqual(seen, [true, false]);

  // Any real answer from the server also brings the register back at once.
  healthy = false;
  connection.serverDidNotAnswer();
  await connection.connectionSettled();
  assert.equal(connection.isOffline(), true);
  connection.serverAnswered();
  assert.equal(connection.isOffline(), false);
});

test('a computer with no network at all is offline without asking the server', async () => {
  const browser = { onLine: false };
  const connection = load('services/connection.ts', {}, { navigator: browser, window: { addEventListener() {} }, setTimeout: () => 1, clearTimeout() {} });
  let asked = 0;
  connection.setServerCheck(async () => { asked++; return true; });
  assert.equal(connection.isOffline(), true);
  connection.serverDidNotAnswer();
  await connection.connectionSettled();
  assert.equal(asked, 0);
  assert.equal(connection.isOffline(), true);
});
