// Phone alerts in the browser: which devices can show them, the push key format,
// the device names, and the pages a tapped alert may open.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, mocks = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { exports: module.exports, module, atob, Uint8Array, ArrayBuffer,
    require: name => { if (!(name in mocks)) throw new Error('Unexpected dependency: ' + name); return mocks[name]; } }, { filename: file });
  return module.exports;
}
const { pushSupport, applicationServerKey, deviceLabel } = load('lib/pushSupport.ts');
const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const facts = (change = {}) => ({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0', hasServiceWorker: true, hasPushManager: true, hasNotification: true, displayStandalone: false, ...change });

test('a browser with service workers and push can show alerts; an iPhone needs the Home Screen app first', () => {
  assert.equal(pushSupport(facts()), 'supported');
  // Safari on an iPhone has no push until the app is opened from the Home Screen.
  assert.equal(pushSupport(facts({ userAgent: iphone, hasPushManager: false, hasNotification: false })), 'install-first');
  assert.equal(pushSupport(facts({ userAgent: iphone, hasPushManager: false, hasNotification: false, standalone: true })), 'unsupported');
  assert.equal(pushSupport(facts({ userAgent: iphone })), 'supported');
  // An iPad says it is a Mac, with a touch screen.
  assert.equal(pushSupport(facts({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5, hasPushManager: false })), 'install-first');
  assert.equal(pushSupport(facts({ hasServiceWorker: false })), 'unsupported');
});

test('the server\'s base64url push key becomes the bytes the browser wants', () => {
  const bytes = new Uint8Array(applicationServerKey('BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'));
  assert.equal(bytes.length, 65);
  assert.equal(bytes[0], 4);
  assert.deepEqual([...new Uint8Array(applicationServerKey('-_8'))], [251, 255]);
});

test('devices are named plainly in the list of devices with alerts on', () => {
  assert.equal(deviceLabel(iphone), 'iPhone');
  assert.equal(deviceLabel('Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari/537.36'), 'Android phone');
  assert.equal(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'Windows computer');
  assert.equal(deviceLabel('curl/8'), 'This device');
});

test('a tapped alert only ever opens a page of this app', () => {
  const { safeAppPath } = load('pages/OpenAlert.tsx', {
    react: { useEffect() {}, useState: value => [value, () => {}] }, 'react-router-dom': {}, '@/store/authStore': {}, '@/components/common/Workspace': {},
    '@/components/common/PageHeader': {}, '@/components/ui/Alert': {}, '@/components/ui/Button': {}, '@/components/ui/LoadingState': {}, '@/services/api': {},
  });
  assert.equal(safeAppPath('/financial?tab=ahead'), '/financial?tab=ahead');
  for (const unsafe of ['https://evil.example', '//evil.example/path', '/\\evil.example', 'javascript:alert(1)', '', null]) assert.equal(safeAppPath(unsafe), '/dashboard');
});
