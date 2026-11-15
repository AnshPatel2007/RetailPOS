// Reading the barcode on the back of a driver's license or ID card (lib/idScan.ts).
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
  vm.runInNewContext(compiled, { exports: module.exports, module, require: name => { throw Error('Unexpected import ' + name); }, Date, Map, RegExp, Number }, { filename: file });
  return module.exports;
}
const id = load('lib/idScan.ts');
const day = date => date && `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const today = new Date(2026, 10, 15); // Nov 15, 2026

// A US license as a scanner types it: header, then one element per line (sample data).
const usLines = ['@', '\u001e', 'ANSI 636014090102DL00410279ZC03200024DLDAQD1234567', 'DCSSMITH', 'DDEN', 'DACJOHN', 'DDFN', 'DADQUINCY',
  'DBD01152021', 'DBB04011990', 'DBA04012028', 'DBC1', 'DAU070 IN', 'DAJCA', 'DAK958200000', 'DCGUSA', 'DDB08292017', 'ZCZCAN'];

test('a US license: date of birth, expiry and name, with the line breaks kept', () => {
  const scan = id.readIdBarcode(usLines.join('\n'), today);
  assert.equal(day(scan.birthDate), '1990-04-01');
  assert.equal(day(scan.expires), '2028-04-01');
  assert.equal(scan.firstName, 'JOHN');
  assert.equal(scan.lastName, 'SMITH');
});

test('the same license from a scanner that drops the line breaks still gives the dates', () => {
  const scan = id.readIdBarcode(usLines.join(''), today);
  assert.equal(day(scan.birthDate), '1990-04-01');
  assert.equal(day(scan.expires), '2028-04-01');
});

test('a Canadian card writes dates year first', () => {
  const scan = id.readIdBarcode(['@', 'ANSI 636012080002DL00410262ZO03030063DLDAQS12345678901234', 'DCSTREMBLAY', 'DACMARIE', 'DBB19850315', 'DBA20300315'].join('\n'), today);
  assert.equal(day(scan.birthDate), '1985-03-15');
  assert.equal(day(scan.expires), '2030-03-15');
});

test('a scanner that types the license fields separated by $ gives the date of birth', () => {
  // Sample data in the layout one scanner types: first, middle, last, birth date, street, -, city, state, ZIP, -, number.
  const scan = id.readIdBarcode('JANE$Q$DOE$04/01/1990$123 MAIN ST$$SPRINGFIELD$IL$627010000$NONE$D12345678901', today);
  assert.equal(day(scan.birthDate), '1990-04-01');
  assert.equal(scan.expires, null);
  assert.equal(scan.firstName, null);
  // A date still ahead is the expiry; a past second date (it may be the issue date) is not.
  assert.equal(day(id.readIdBarcode('JANE$DOE$04/01/1990$01/15/2021$04/01/2029$SPRINGFIELD$IL', today).expires), '2029-04-01');
  assert.equal(id.readIdBarcode('JANE$DOE$04/01/1990$01/15/2021$SPRINGFIELD$IL', today).expires, null);
  assert.equal(day(id.readIdBarcode('JANE$DOE$1990-04-01$SPRINGFIELD$IL', today).birthDate), '1990-04-01');
  // Separated text without a date is not an ID.
  assert.equal(id.readIdBarcode('JANE$DOE$SPRINGFIELD$IL$62701', today), null);
});

test('a product barcode or random text is not an ID', () => {
  assert.equal(id.readIdBarcode('036000291452', today), null);
  assert.equal(id.readIdBarcode('hello world, nothing to see', today), null);
  assert.equal(id.looksLikeIdBarcode(usLines.join('\n')), true);
});

test('impossible or future birth dates are not read', () => {
  assert.equal(id.aamvaDate('02302000'), null); // Feb 30
  assert.equal(day(id.aamvaDate('12312030')), '2030-12-31');
  assert.equal(day(id.aamvaDate('20301231')), '2030-12-31');
  assert.equal(id.aamvaDate('1990041'), null);
  const future = id.readIdBarcode(['ANSI 636014090102DL', 'DBB04012030'].join('\n'), today);
  assert.equal(future.birthDate, null);
});

test('age turns over on the birthday, and an ID is valid through its expiry date', () => {
  const born = new Date(2005, 10, 15);
  assert.equal(id.ageOn(born, new Date(2026, 10, 14)), 20);
  assert.equal(id.ageOn(born, new Date(2026, 10, 15)), 21);
  assert.equal(id.isExpired(new Date(2026, 10, 15), today), false);
  assert.equal(id.isExpired(new Date(2026, 10, 14), today), true);
  assert.equal(id.isExpired(null, today), false);
});
