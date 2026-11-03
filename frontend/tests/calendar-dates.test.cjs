const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const dates = require('@internationalized/date');
const file = path.join(__dirname, '../src/lib/calendarDates.ts');
const compiled = ts.transpileModule(fs.readFileSync(file,'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const exported = { exports: {} };
vm.runInNewContext(compiled, { exports: exported.exports, module: exported, require, Date, Intl }, { filename: file });
const { calendarDate, inputDate, monthLabel, presetRange, previousFullWeek } = exported.exports;

test('date-only parsing rejects impossible dates and accepts leap dates without timestamp conversion', () => {
  assert.equal(calendarDate('2024-02-29').toString(), '2024-02-29');
  for (const value of ['2025-02-29','2024-04-31','2024-13-01','2024-00-01','0000-01-01','2024-2-1','2024-02-29T00:00:00Z']) assert.equal(calendarDate(value), null, value);
  assert.equal(inputDate('2/29/2024'), '2024-02-29');
  assert.equal(inputDate('2/29/2025'), null);
  assert.equal(inputDate(''), '');
  assert.equal(monthLabel('2026-01'), 'January 2026');
});
test('presets cross calendar year and leap-month boundaries inclusively', () => {
  const now = new dates.CalendarDate(2024, 3, 1);
  assert.deepEqual({ ...presetRange('lastMonth','America/Chicago',now) }, { startDate:'2024-02-01',endDate:'2024-02-29' });
  assert.deepEqual({ ...presetRange('last7','America/Chicago',new dates.CalendarDate(2026,1,3)) }, {startDate:'2025-12-28',endDate:'2026-01-03'});
  assert.deepEqual({ ...presetRange('ytd','America/Chicago',now) }, {startDate:'2024-01-01',endDate:'2024-03-01'});
  assert.equal(presetRange('unsupported','America/Chicago',now), null);
});
test('store calendar can differ from the register and UTC day', () => {
  const instant = Date.parse('2026-01-01T01:00:00Z');
  const chicago = dates.toCalendarDate(dates.fromAbsolute(instant,'America/Chicago'));
  const tokyo = dates.toCalendarDate(dates.fromAbsolute(instant,'Asia/Tokyo'));
  assert.equal(presetRange('today','America/Chicago',chicago).startDate,'2025-12-31');
  assert.equal(presetRange('today','Asia/Tokyo',tokyo).startDate,'2026-01-01');
});

test('previous full export week uses store calendar boundaries, including Sunday and New Year', () => {
  assert.deepEqual({ ...previousFullWeek('America/Chicago', new dates.CalendarDate(2026, 1, 5)) }, { startDate: '2025-12-29', endDate: '2026-01-04' });
  assert.deepEqual({ ...previousFullWeek('America/Chicago', new dates.CalendarDate(2026, 1, 4)) }, { startDate: '2025-12-22', endDate: '2025-12-28' });
});
