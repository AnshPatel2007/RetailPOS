const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { exports: module.exports, module, AbortController, setTimeout, clearTimeout, ...globals }, { filename: file });
  return module.exports;
}
const { createReadRefreshScheduler, readRetryAfter } = load('services/readRefreshScheduler.ts');
const settle = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture(loader, overrides = {}) {
  let at = 100000, next = 0, safe = true, current = true;
  const timers = new Map(), calls = [], busy = [];
  const scheduler = createReadRefreshScheduler({ load: async context => { calls.push(context); return loader?.(context); },
    canBackground: () => safe, current: () => current, onBusy: value => busy.push(value), now: () => at,
    setTimer: (callback, delay) => { const id = ++next; timers.set(id, { callback, at: at + delay }); return id; },
    clearTimer: id => timers.delete(id), ...overrides,
  });
  return { scheduler, calls, busy, timers,
    safe: value => { safe = value; scheduler.environmentChanged(); }, current: value => { current = value; },
    advance: async amount => {
      const end = at + amount;
      for (let loop = 0; loop < 1000; loop++) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        at = due[1].at; timers.delete(due[0]); due[1].callback(); await settle();
        if (loop === 999) throw new Error('Timer loop');
      }
      at = end; await settle();
    },
  };
}

test('initial/manual reads are explicit and background reads use the configured quiet interval', async () => {
  const f = fixture(); f.scheduler.request('initial'); await settle();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].quiet, false);
  await f.advance(29999); assert.equal(f.calls.length, 1);
  await f.advance(1); assert.equal(f.calls.length, 2); assert.equal(f.calls[1].reason, 'interval'); assert.equal(f.calls[1].quiet, true);
  f.scheduler.request(); await settle(); assert.equal(f.calls.length, 3); assert.equal(f.calls[2].quiet, false);
  f.scheduler.dispose();
  const jobs = fixture(undefined, { intervalMs: 10000 }); jobs.scheduler.request('initial'); await settle();
  await jobs.advance(10000); assert.equal(jobs.calls.length, 2); jobs.scheduler.dispose();
});

test('legacy loaders can arm polling without duplicating their separate initial request', async () => {
  const f = fixture(); f.scheduler.start(); f.scheduler.start(); await settle();
  assert.equal(f.calls.length, 0); assert.equal(f.timers.size, 1);
  await f.advance(30000); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].quiet, true); f.scheduler.dispose();
});

test('requests never overlap even when the old loader ignores abort; mutation storms coalesce', async () => {
  const gate = deferred(); let applied = 0;
  const f = fixture(async context => { if (f.calls.length === 1) await gate.promise; if (context.current()) applied++; });
  f.scheduler.request('initial'); await settle();
  for (let i = 0; i < 20; i++) f.scheduler.request('mutation');
  assert.equal(f.calls[0].signal.aborted, true); assert.equal(f.calls[0].current(), false);
  await f.advance(90000); assert.equal(f.calls.length, 1);
  gate.resolve(); await settle(); assert.equal(f.calls.length, 2); assert.equal(applied, 1);
  f.scheduler.dispose();
});

test('hidden/offline/modal/dirty-form availability pauses timers and flushes one deferred update', async () => {
  const f = fixture(); f.scheduler.request('initial'); await settle(); f.safe(false);
  await f.advance(120000); assert.equal(f.calls.length, 1); assert.equal(f.timers.size, 0);
  f.scheduler.request('online'); f.scheduler.request('focus'); f.scheduler.request('mutation');
  await settle(); assert.equal(f.calls.length, 1);
  f.safe(true); await settle(); assert.equal(f.calls.length, 2); assert.equal(f.calls[1].reason, 'mutation');
  f.scheduler.dispose();
});

test('opening an edit/review during a background request prevents applying its result', async () => {
  const gate = deferred(); const applied = [];
  const f = fixture(async context => { if (context.quiet) await gate.promise; if (context.current()) applied.push(context.reason); });
  f.scheduler.request('initial'); await settle(); f.scheduler.request('focus'); await settle();
  f.safe(false); assert.equal(f.calls[1].signal.aborted, true); gate.resolve(); await settle();
  assert.deepEqual(applied, ['initial']); assert.equal(f.calls.length, 2);
  f.safe(true); await settle(); assert.equal(f.calls.length, 3); assert.deepEqual(applied, ['initial', 'resume']);
  f.scheduler.dispose();
});

test('initial and manual detail reads remain usable inside a paused dialog', async () => {
  const f = fixture(); f.safe(false); f.scheduler.request('initial'); await settle();
  assert.equal(f.calls.length, 1); f.scheduler.request(); await settle(); assert.equal(f.calls.length, 2);
  f.scheduler.request('mutation'); await settle(); assert.equal(f.calls.length, 2); f.scheduler.dispose();
});

test('one-shot reviewed snapshots never poll or reload on mutation, focus, online or resume', async () => {
  const f = fixture(undefined, { automatic: false }); f.scheduler.request('initial'); await settle();
  for (const reason of ['mutation', 'focus', 'online', 'interval', 'resume']) f.scheduler.request(reason);
  await f.advance(600000); assert.equal(f.calls.length, 1); assert.equal(f.timers.size, 0);
  f.scheduler.request('manual'); await settle(); assert.equal(f.calls.length, 2); f.scheduler.dispose();
});

test('Retry-After throttles automatic events and explicit retry without losing the pending refresh', async () => {
  let unavailable = true;
  const f = fixture(() => { if (unavailable) throw { response: { status: 429, headers: { 'retry-after': '60' } } }; });
  f.scheduler.request('initial'); await settle(); unavailable = false;
  f.scheduler.request('online'); f.scheduler.request('manual'); f.scheduler.request('mutation');
  await f.advance(59999); assert.equal(f.calls.length, 1);
  await f.advance(1); assert.equal(f.calls.length, 2); assert.equal(f.calls[1].reason, 'manual');
  f.scheduler.dispose();
});

test('HTTP-date Retry-After is supported without shortening a provider delay', () => {
  const at = Date.parse('2026-10-20T12:00:00Z');
  assert.equal(readRetryAfter({ response: { headers: { get: () => 'Tue, 20 Oct 2026 12:02:00 GMT' } } }, at), 120000);
  assert.equal(readRetryAfter({ response: { headers: { 'Retry-After': 120 } } }, at), 120000);
  for (const value of ['invalid', '-1', undefined]) assert.equal(readRetryAfter({ response: { headers: { 'retry-after': value } } }, at), 0);
});

test('network failures back off and a success restores the normal polling interval', async () => {
  let fail = true;
  const f = fixture(() => { if (fail) throw new Error('offline'); }, { intervalMs: 1000 });
  f.scheduler.request('initial'); await settle(); await f.advance(4999); assert.equal(f.calls.length, 1);
  await f.advance(1); assert.equal(f.calls.length, 2); await f.advance(9999); assert.equal(f.calls.length, 2);
  fail = false; await f.advance(1); assert.equal(f.calls.length, 3);
  await f.advance(1000); assert.equal(f.calls.length, 4); f.scheduler.dispose();
});

test('explicit retry after an ordinary failure is immediate while automatic retries still back off', async () => {
  let fail = true;
  const f = fixture(() => { if (fail) throw new Error('offline'); });
  f.scheduler.request('initial'); await settle();
  fail = false;
  f.scheduler.request('manual'); await settle();
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].reason, 'manual');
  f.scheduler.dispose();
});

test('session/store obsolescence and disposal invalidate in-flight results and cancel future polling', async () => {
  const gate = deferred(); let applied = false;
  const f = fixture(async context => { await gate.promise; if (context.current()) applied = true; });
  f.scheduler.request('initial'); await settle(); f.current(false);
  assert.equal(f.calls[0].current(), false); f.scheduler.dispose(); gate.resolve(); await settle();
  await f.advance(300000); f.scheduler.request('manual'); await settle();
  assert.equal(applied, false); assert.equal(f.calls.length, 1); assert.equal(f.timers.size, 0);
});

test('cross-tab invalidation sends only a protocol version, clears local caches and never echoes', () => {
  const channels = [];
  class BroadcastChannel {
    constructor(name) { this.name = name; this.messages = []; channels.push(this); }
    postMessage(message) { this.messages.push(message); channels.filter(other => other !== this && other.name === this.name).forEach(other => other.onmessage?.({ data: message })); }
  }
  const globals = { window: {}, BroadcastChannel };
  const first = load('services/queryCache.ts', globals), second = load('services/queryCache.ts', globals);
  let firstReads = 0, secondReads = 0;
  const unlisten = first.subscribeScopedQueryInvalidation(() => firstReads++);
  second.subscribeScopedQueryInvalidation(() => secondReads++);
  first.scopedQueryCache.set('private-store-a', { at: 1, data: 'private payload' });
  second.scopedQueryCache.set('private-store-b', { at: 1, data: 'other private payload' });
  first.invalidateScopedQueries();
  assert.equal(first.scopedQueryCache.size, 0); assert.equal(second.scopedQueryCache.size, 0);
  assert.equal(firstReads, 1); assert.equal(secondReads, 1);
  assert.deepEqual(channels[0].messages, [1]); assert.deepEqual(channels[1].messages, []);
  unlisten(); second.invalidateScopedQueries(); assert.equal(firstReads, 1); assert.equal(secondReads, 2);
});

test('storage-denied clients retain local refresh without surfacing storage failures', () => {
  const client = load('services/queryCache.ts', { window: { addEventListener() {}, localStorage: { setItem() { throw new Error('denied'); } } } });
  let reads = 0; client.subscribeScopedQueryInvalidation(() => reads++);
  assert.doesNotThrow(() => client.invalidateScopedQueries()); assert.equal(reads, 1);
});

test('restricted notification APIs and a broken subscriber cannot reject a confirmed mutation', () => {
  for (const BroadcastChannel of [class { constructor() { throw new Error('restricted'); } }, class { postMessage() { throw new Error('closed'); } }]) {
    const client = load('services/queryCache.ts', { BroadcastChannel, window: { addEventListener() {}, localStorage: { setItem() { throw new Error('denied'); } } } });
    let healthy = 0; client.subscribeScopedQueryInvalidation(() => { throw new Error('unmounted subscriber'); });
    client.subscribeScopedQueryInvalidation(() => healthy++);
    assert.doesNotThrow(() => client.invalidateScopedQueries()); assert.equal(healthy, 1);
  }
});

test('browser environment detects visible review dialogs, dirty drafts and read-only opt-outs', () => {
  const handlers = new Map(); let mutation;
  class Element {
    constructor({ form = null, allow = false, hidden = false, role = null, search = false } = {}) {
      Object.assign(this, { form, allow, hidden, role, search, isConnected: true });
    }
    closest(selector) { if (selector === 'form') return this.form; if (selector.includes('data-auto-refresh')) return this.allow ? this : null; return this.hidden ? this : null; }
    matches() { return this.search; }
    getClientRects() { return this.hidden ? [] : [{}]; }
    getAttribute(name) { return name === 'role' ? this.role : null; }
  }
  class HTMLFormElement extends Element {}
  const dialogs = [], document = { visibilityState: 'visible', documentElement: {}, querySelectorAll: () => dialogs,
    addEventListener: (name, handler) => handlers.set(name, handler), removeEventListener: name => handlers.delete(name) };
  const window = { addEventListener: (name, handler) => handlers.set(name, handler), removeEventListener: name => handlers.delete(name) };
  const navigator = { onLine: true };
  class MutationObserver { constructor(callback) { mutation = callback; } observe() {} disconnect() {} }
  const environment = load('services/autoRefreshEnvironment.ts', { document, window, navigator, Element, HTMLFormElement, MutationObserver });
  const events = [], unsubscribe = environment.subscribeRefreshEnvironment(reason => events.push(reason));
  assert.equal(environment.canRefreshInBackground(), true);
  document.visibilityState = 'hidden'; handlers.get('visibilitychange')(); assert.equal(environment.canRefreshInBackground(), false);
  document.visibilityState = 'visible'; handlers.get('visibilitychange')(); assert.equal(events.at(-1), 'focus');
  navigator.onLine = false; assert.equal(environment.canRefreshInBackground(), false); navigator.onLine = true;
  dialogs.push(new Element()); mutation(); assert.equal(environment.canRefreshInBackground(), false);
  dialogs[0].allow = true; assert.equal(environment.canRefreshInBackground(), true);
  dialogs[0].allow = false; dialogs[0].hidden = true; assert.equal(environment.canRefreshInBackground(), true);
  dialogs.length = 0;
  const form = new HTMLFormElement(), input = new Element({ form });
  handlers.get('input')({ target: input }); assert.equal(environment.canRefreshInBackground(), false);
  handlers.get('reset')({ target: form }); assert.equal(environment.canRefreshInBackground(), true);
  handlers.get('change')({ target: input }); form.isConnected = false; assert.equal(environment.canRefreshInBackground(), true);
  const search = new HTMLFormElement({ role: 'search' });
  handlers.get('input')({ target: new Element({ form: search }) }); assert.equal(environment.canRefreshInBackground(), true);
  const lookup = new HTMLFormElement(); handlers.get('input')({ target: new Element({ form: lookup, search: true }) });
  assert.equal(environment.canRefreshInBackground(), true);
  unsubscribe(); assert.equal(handlers.size, 0);
});
