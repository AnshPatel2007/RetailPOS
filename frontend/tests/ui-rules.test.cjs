// The setup rules, checked in the source of every pop-up (CLAUDE.md > Frontend conventions).
// The browser guard (e2e/ui-rules.spec.ts) can only open pop-ups reachable from a page's
// main button; this reads all of them.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const SRC = path.join(__dirname, '../src');

/**
 * Files the buttons-and-layout sweep has not reached yet. Their pop-ups are not
 * checked; once a file follows the rules it must leave this list (the last test
 * says so), so the list only shrinks.
 */
const PENDING = new Set([
  'components/StoreConnections.tsx', 'components/accounts/AccountFunding.tsx', 'components/admin/StoreBusiness.tsx',
  'components/expenses/ExpenseDetailsModal.tsx', 'components/expenses/ExpenseModal.tsx', 'components/financial/BudgetModal.tsx',
  'components/financial/InventoryCostPanel.tsx', 'components/financial/OpeningInventoryReview.tsx', 'components/financial/RecurringExpenseModal.tsx',
  'components/inventory/BarcodeLabelPrint.tsx', 'components/inventory/CSVImportModal.tsx', 'components/inventory/PackForm.tsx',
  'components/inventory/PurchaseReceiptModal.tsx', 'components/inventory/ReceiptScanModal.tsx', 'components/inventory/ResolveDiscrepancyDialog.tsx',
  'components/inventory/ShelfLabelsDialog.tsx', 'components/inventory/StockAdjustmentModal.tsx', 'components/inventory/TransferReceiptModal.tsx',
  'components/lottery/LotteryBookDialog.tsx', 'components/lottery/LotteryBookRegister.tsx', 'components/lottery/LotteryConfiguration.tsx',
  'components/lottery/LotteryDailyWorkbench.tsx', 'components/lottery/LotteryGameSetup.tsx', 'components/lottery/LotterySettlementDialog.tsx',
  'components/lottery/LotterySimpleDaily.tsx', 'components/reports/BulkRefundActions.tsx', 'components/reports/DigestDeliveryControls.tsx',
  'components/reports/ExportPreviewModal.tsx', 'components/reports/SaleDetailsModal.tsx', 'components/reports/SaleVoidDialog.tsx',
  'components/reports/SalesBulkActions.tsx', 'pages/BackgroundJobs.tsx', 'pages/Customers.tsx', 'pages/CycleCount.tsx', 'pages/Developers.tsx',
  'pages/GiftCards.tsx', 'pages/HouseAccounts.tsx', 'pages/Inventory.tsx', 'pages/InventoryExceptions.tsx', 'pages/InventoryTransfers.tsx',
  'pages/Payroll.tsx', 'pages/Promotions.tsx', 'pages/Reconciliation.tsx', 'pages/Reports.tsx', 'pages/Shifts.tsx', 'pages/StoreCredits.tsx',
  'pages/SupplierCredits.tsx', 'pages/Team.tsx', 'pages/admin/StoreManagement.tsx', 'pages/admin/UserManagement.tsx',
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}
const opening = node => ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
const nameOf = node => opening(node)?.tagName.getText();
function attribute(node, name) {
  const found = opening(node)?.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText() === name);
  if (!found) return undefined;
  if (!found.initializer) return 'true';
  return ts.isStringLiteral(found.initializer) ? found.initializer.text : found.initializer.getText();
}
/** Every element inside `node`, not entering a nested pop-up. */
function elementsWithin(node, visit) {
  ts.forEachChild(node, child => {
    if (nameOf(child) === 'Modal') return;
    if (opening(child)) visit(child);
    elementsWithin(child, visit);
  });
}
/** Every element in a pop-up's body: its children, not its `footer` attribute. */
function bodyElements(modal, visit) {
  for (const child of modal.children) {
    if (nameOf(child) === 'Modal') continue;
    if (opening(child)) visit(child);
    elementsWithin(child, visit);
  }
}
/** A filled button: the main action, which belongs in the footer. */
const filled = element => {
  const variant = attribute(element, 'variant') || '';
  return (nameOf(element) === 'Button' && /primary|destructive/.test(variant)) || attribute(element, 'type') === 'submit';
};

const modals = [];
for (const file of walk(SRC)) {
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes('<Modal')) continue;
  const rel = path.relative(SRC, file).split(path.sep).join('/');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const where = node => `${rel}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
  const visit = node => {
    if (nameOf(node) === 'Modal') modals.push({ node, where: where(node), rel });
    ts.forEachChild(node, visit);
  };
  visit(source);
}

/** Pop-ups whose main button sits in the scrolling body. */
function bodyProblems({ node, where }) {
  if (!ts.isJsxElement(node)) return [];
  const inBody = [];
  bodyElements(node, element => { if (filled(element)) inBody.push(element.getText().replace(/\s+/g, ' ').slice(0, 80)); });
  return inBody.length ? [`${where}: ${inBody.join(' | ')}`] : [];
}
/** Pop-up footers not laid out by DialogActions (FilterDropdown passes its caller's footer through). */
function footerProblems({ node, where, rel }) {
  const footer = attribute(node, 'footer');
  return footer && !/DialogActions/.test(footer) && !rel.endsWith('FilterDropdown.tsx') ? [where] : [];
}
const checked = modals.filter(modal => !PENDING.has(modal.rel));

test('the source has pop-ups to check', () => {
  assert.ok(modals.length > 50, `found only ${modals.length} pop-ups: the scan is broken`);
});

test("a pop-up's main button sits in its fixed footer, never in the scrolling body", () => {
  assert.deepEqual(checked.flatMap(bodyProblems), [], 'Move these buttons into the footer (DialogActions); supporting buttons in the body are outline or ghost.');
});

test('a pop-up footer is laid out by DialogActions', () => {
  assert.deepEqual(checked.flatMap(footerProblems), [], 'Build the footer with DialogActions: Cancel, then the one main button on the right.');
});

test('files waiting for the sweep leave the waiting list once they follow the rules', () => {
  const clean = [...PENDING].filter(rel => {
    const own = modals.filter(modal => modal.rel === rel);
    return own.length > 0 && !own.some(modal => bodyProblems(modal).length || footerProblems(modal).length);
  });
  assert.deepEqual(clean, [], 'These files now follow the rules: remove them from PENDING in tests/ui-rules.test.cjs.');
});
