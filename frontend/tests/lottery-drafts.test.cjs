const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/services/lotteryDraft.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const moduleValue = { exports: {} };
vm.runInNewContext(compiled, { exports: moduleValue.exports, module: moduleValue });
const { reconcileLotteryDraft, sameLotteryReport } = moduleValue.exports;
const rackModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/lotteryRackInput.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports: rackModule.exports, module: rackModule });
const { parseRackInput, rackSold } = rackModule.exports;
const rack = { id: 'one', ticketTypeId: 'one', bin: '12', name: 'Example', gameNumber: '284', price: '10', firstTicket: 0, lastTicket: 59, direction: 'ASC', openingNumber: 10, closingNumber: null, finishedRolls: 0, lossQuantity: 0 };
test('rack entry parses ticket serials and short numbers without silently accepting another game', () => {
  assert.equal(parseRackInput('025', rack), '025');
  assert.equal(parseRackInput('284-123456-025', rack), '025');
  assert.equal(parseRackInput('0284123456025', rack), '025');
  assert.throws(() => parseRackInput('285123456025', rack), /another game/);
  assert.throws(() => parseRackInput('validation-text', rack), /inventory barcode/);
  assert.throws(() => parseRackInput('009', rack), /New roll/);
  assert.equal(rackSold({ ...rack, closingNumber: '025' }), 15);
  assert.equal(rackSold({ ...rack, openingNumber: 55, closingNumber: '003', finishedRolls: 2 }), 68);
  assert.equal(rackSold({ ...rack, direction: 'DESC', openingNumber: 59, closingNumber: '-1' }), 60);
});
const base = { onlineGross: null, reference: '', dispensers: [{ sourceId: 'one', grossSales: null }] };

test('count revisions preserve unfinished report values and advance only an unchanged base', () => {
  const draft = { version: 1, base, report: { ...base, onlineGross: '12.' } };
  const next = reconcileLotteryDraft(draft, { version: 2, report: { dispensers: base.dispensers, reference: '', onlineGross: null } });
  assert.equal(next.version, 2); assert.equal(next.report.onlineGross, '12.');
  assert.equal(reconcileLotteryDraft(next, { version: 3, report: { ...base, onlineGross: '20' } }), next);
});
test('a confirmed retry clears its submitted draft but retains later edits', () => {
  const submitted = { ...base, onlineGross: '10' };
  const draft = { version: 1, base, report: submitted };
  assert.equal(reconcileLotteryDraft(draft, { version: 2, report: submitted }, submitted), null);
  const later = { ...draft, report: { ...submitted, reference: 'Later edit' } };
  const next = reconcileLotteryDraft(later, { version: 2, report: submitted }, submitted);
  assert.equal(next.report.reference, 'Later edit'); assert.equal(next.version, 2);
});
test('older reads cannot roll a draft back and older drafts require comparison after a conflict', () => {
  const draft = { version: 5, base, report: { ...base, onlineGross: '30' } };
  assert.equal(reconcileLotteryDraft(draft, { version: 4, report: base }), draft);
  const legacy = { version: 1, report: draft.report };
  assert.equal(reconcileLotteryDraft(legacy, { version: 2, report: base }), legacy);
  assert.equal(sameLotteryReport(base, { ...base, reference: 'Different' }), false);
});
