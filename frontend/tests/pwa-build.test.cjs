// Checks the production build is installable and starts offline. Build first:
//   npm run build --workspace=frontend && npm run test:pwa --workspace=frontend
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dist = path.join(__dirname, '../dist');
const read = file => fs.readFileSync(path.join(dist, file), 'utf8');

test('the build contains a service worker that saves the app and leaves API requests alone', () => {
  assert.ok(fs.existsSync(path.join(dist, 'sw.js')), 'dist/sw.js is missing: run the frontend build first');
  const worker = read('sw.js');
  assert.match(worker, /index\.html/, 'the app page must be saved for offline use');
  assert.ok(worker.includes('NavigationRoute'), 'any page address must open the saved app');
  assert.ok(worker.includes('denylist:[/^' + String.fromCharCode(92) + '/api' + String.fromCharCode(92) + '//]'), 'API addresses must never be answered from the saved app');
  // An update waits until the person at the register asks for it (the page sends SKIP_WAITING); it never takes over by itself.
  assert.ok(worker.includes('SKIP_WAITING'), 'updates must be applied on request');
  assert.ok(!worker.includes('clientsClaim'), 'a new version must not take over an open register');
});

test('the manifest makes the app installable with its own icons', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  for (const icon of manifest.icons) assert.ok(fs.existsSync(path.join(dist, icon.src)), 'missing icon ' + icon.src);
  assert.ok(manifest.icons.some(icon => icon.purpose === 'maskable'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512'));
  assert.match(read('index.html'), /rel="manifest"/);
});
