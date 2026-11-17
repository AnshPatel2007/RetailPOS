// Store Pulse in the app: the one line shown on the Shifts page and each My Stores card.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/lib/storePulse.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const loaded = { exports: {} };
vm.runInNewContext(compiled, { exports: loaded.exports, module: loaded, Intl, Date }, { filename: 'storePulse.ts' });
const { ago } = loaded.exports;
// Objects made in the module's own context: compare plain copies.
const pulseLine = (...args) => ({ ...loaded.exports.pulseLine(...args) });

// Tuesday, November 10, 2026, 8:25 AM in Chicago (UTC-6).
const zone = 'America/Chicago', now = Date.parse('2026-11-10T14:25:00Z');
const status = change => ({ today: '2026-11-10', closedToday: false, openDrawers: 0, openSince: null, lastSaleAt: null, learning: false,
  usual: { weekday: 'Tuesday', opensAt: '6:00 AM', closesAt: '11:00 PM' }, alerts: [], ...change });

test('an open alert comes first', () => {
  const alert = { kind: 'PULSE_QUIET', severity: 'medium', sentence: 'No sale since 7:30 AM. Tuesday between 8 and 9 AM usually has about 12 sales.', href: '/team-time/shifts', createdAt: '2026-11-10T14:20:00Z' };
  assert.deepEqual(pulseLine(status({ openDrawers: 1, openSince: '2026-11-10T11:58:00Z', alerts: [alert] }), zone, now), { text: alert.sentence, tone: 'warning' });
});

test('an open store says since when and how long since the last sale', () => {
  assert.deepEqual(pulseLine(status({ openDrawers: 2, openSince: '2026-11-10T11:58:00Z', lastSaleAt: '2026-11-10T14:23:00Z' }), zone, now),
    { text: 'Open since 5:58 AM · last sale 2 minutes ago', tone: 'success' });
  // A drawer left open since yesterday shows its date; a sale before it opened does not count.
  assert.equal(pulseLine(status({ openDrawers: 1, openSince: '2026-11-10T04:00:00Z', lastSaleAt: '2026-11-10T03:00:00Z' }), zone, now).text,
    'Open since Nov 9, 10:00 PM · no sale yet');
});

test('nobody on: the usual opening once it is learned, or closed today', () => {
  assert.deepEqual(pulseLine(status(), zone, now), { text: 'Nobody is clocked in. On Tuesdays the store usually opens by 6:00 AM.', tone: 'muted' });
  assert.equal(pulseLine(status({ learning: true, usual: null }), zone, now).text, 'Nobody is clocked in.');
  assert.deepEqual(pulseLine(status({ closedToday: true }), zone, now), { text: 'Closed today', tone: 'muted' });
});

test('how long ago, in plain words', () => {
  const minutesAgo = minutes => new Date(now - minutes * 60000);
  assert.deepEqual([0, 1, 59, 60, 179, 25 * 60, 49 * 60].map(minutes => ago(minutesAgo(minutes), now)),
    ['just now', '1 minute ago', '59 minutes ago', '1 hour ago', '2 hours ago', '1 day ago', '2 days ago']);
});
