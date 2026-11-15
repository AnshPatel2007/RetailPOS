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

// The common sample card (Illinois layout, version 09): Jane Marie Doe, born May 20, 1995.
const sample = ['@', 'ANSI 636035090002DL00410288ZI03290025DLDAQD123456789012', 'DCSDOE', 'DDEN', 'DACJANE', 'DDFN', 'DADMARIE', 'DDGN', 'DCAD',
  'DCBNONE', 'DCDNONE', 'DBD08152024', 'DBB05201995', 'DBA05202029', 'DBC2', 'DAU065 in', 'DAYBRO', 'DAG123 MAIN ST', 'DAICHICAGO', 'DAJIL',
  'DAK606010000  ', 'DCF1234567890123456789', 'DCGUSA', 'DAW140', 'DAZBRO', 'DCK1234567890123456', 'DDB01012020', 'DDK1', 'ZIZIA1'];
const invertCase = text => text.replace(/[a-z]/gi, letter => letter === letter.toUpperCase() ? letter.toLowerCase() : letter.toUpperCase());

test('the raw sample card reads the same however the scanner types it', () => {
  const variants = {
    'line breaks kept': sample.join('\n'),
    'carriage returns': sample.join('\r\n'),
    'line breaks dropped': sample.join(''),
    'Caps Lock on (letters in the wrong case)': invertCase(sample.join('\n')),
    'line breaks typed out as <LF>': sample.join('<LF>'),
    'a symbology prefix before the data': ']L2' + sample.join('\n'),
  };
  for (const [how, text] of Object.entries(variants)) {
    const scan = id.readIdBarcode(text, today);
    assert.equal(day(scan.birthDate), '1995-05-20', how);
    assert.equal(day(scan.expires), '2029-05-20', how);
  }
  const named = id.readIdBarcode(sample.join('\n'), today);
  assert.equal(`${named.firstName} ${named.lastName}`, 'JANE DOE');
});

test('older cards: the full name in one element, dates year first, or dates written with slashes', () => {
  const older = id.readIdBarcode(['@', 'ANSI 636035010002DL00390187DLDAQD123456789012', 'DAADOE,JANE,MARIE', 'DBB19950520', 'DBA20290520'].join('\n'), today);
  assert.equal(day(older.birthDate), '1995-05-20');
  assert.equal(day(older.expires), '2029-05-20');
  assert.equal(`${older.firstName} ${older.lastName}`, 'JANE DOE');
  const slashes = id.readIdBarcode(['ANSI 636035090002DL', 'DCSDOE', 'DACJANE', 'DBB05/20/1995', 'DBA05/20/2029'].join('\n'), today);
  assert.equal(day(slashes.birthDate), '1995-05-20');
  assert.equal(day(slashes.expires), '2029-05-20');
});

test('fields the scanner read itself: labeled, tab-separated, or with an issue date', () => {
  const labeled = id.readIdBarcode('NAME: JANE M DOE\nDOB: 05/20/1995\nISS: 08/15/2024\nEXP: 05/20/2029', today);
  assert.equal(day(labeled.birthDate), '1995-05-20');
  assert.equal(day(labeled.expires), '2029-05-20');
  // A labeled expiry in the past is an expired ID.
  assert.equal(id.isExpired(id.readIdBarcode('DOB 05/20/1995 | EXP 05/20/2024', today).expires, today), true);
  const tabs = id.readIdBarcode(['DOE', 'JANE', 'MARIE', '1995-05-20', '2029-05-20', 'CHICAGO', 'IL'].join('\t'), today);
  assert.equal(day(tabs.birthDate), '1995-05-20');
  assert.equal(day(tabs.expires), '2029-05-20');
  const digitsOnly = id.readIdBarcode('DOE^JANE^MARIE^05201995^05202029^CHICAGO^IL', today);
  assert.equal(day(digitsOnly.birthDate), '1995-05-20');
  assert.equal(day(digitsOnly.expires), '2029-05-20');
});

test('a magnetic stripe swipe gives the date of birth from track 2', () => {
  const swipe = id.readIdBarcode('%ILCHICAGO^DOE$JANE$MARIE^123 MAIN ST^?;636035123456789012=290519950520?', today);
  assert.equal(day(swipe.birthDate), '1995-05-20');
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
