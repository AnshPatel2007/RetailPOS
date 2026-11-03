/** A read-only request coordinator. The caller supplies a loader; it never replays writes. */
export type ReadRefreshReason = 'initial' | 'manual' | 'interval' | 'focus' | 'online' | 'mutation' | 'resume';
export interface ReadRefreshContext {
  signal: AbortSignal;
  /** Check immediately before applying a result, including after every awaited request. */
  current: () => boolean;
  quiet: boolean;
  reason: ReadRefreshReason;
}

interface RefreshSchedulerOptions {
  load: (context: ReadRefreshContext) => Promise<unknown>;
  canBackground: () => boolean;
  current?: () => boolean;
  intervalMs?: number;
  automatic?: boolean;
  onBusy?: (busy: boolean) => void;
  now?: () => number;
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

/** Retry-After supports both seconds and the HTTP-date form. No response content is retained. */
export function readRetryAfter(error: unknown, now = Date.now()): number {
  const headers = (error as { response?: { headers?: Record<string, unknown> & { get?: (name: string) => unknown } } })?.response?.headers;
  const value = headers?.get?.('retry-after') ?? headers?.['retry-after'] ?? headers?.['Retry-After'];
  if (typeof value !== 'string' && typeof value !== 'number') return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const timestamp = Date.parse(String(value));
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : 0;
}

const priority: Record<ReadRefreshReason, number> = { interval: 0, resume: 1, focus: 1, online: 1, mutation: 2, initial: 3, manual: 4 };
const isQuiet = (reason: ReadRefreshReason) => reason !== 'initial' && reason !== 'manual';

export function createReadRefreshScheduler(options: RefreshSchedulerOptions) {
  const now = options.now || Date.now;
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  const interval = Math.max(1000, options.intervalMs ?? 30000);
  let stopped = false;
  let active: { controller: AbortController; reason: ReadRefreshReason } | null = null;
  let pending: ReadRefreshReason | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let notBefore = 0;
  let automaticNotBefore = 0;
  let failures = 0;

  const cancelTimer = () => { if (timer !== undefined) clearTimer(timer); timer = undefined; };
  const remember = (reason: ReadRefreshReason) => { if (!pending || priority[reason] > priority[pending]) pending = reason; };
  const schedule = (reason: ReadRefreshReason, delay: number) => {
    cancelTimer();
    // Long HTTP-date delays are waited in safe chunks rather than overflowing the
    // browser's signed 32-bit timeout and accidentally retrying immediately.
    timer = setTimer(() => { timer = undefined; request(reason); }, Math.min(2147483647, Math.max(0, delay)));
  };

  function request(reason: ReadRefreshReason = 'manual') {
    if (stopped || (isQuiet(reason) && options.automatic === false)) return;
    cancelTimer();
    remember(reason);
    // A mutation invalidates any read already in flight. Wait for that loader to settle
    // before starting another one, even if its transport ignores AbortSignal.
    if (active) {
      if (reason === 'manual' || reason === 'mutation') active.controller.abort();
      return;
    }
    const next = pending!;
    if (isQuiet(next) && !options.canBackground()) return;
    const readyAt = isQuiet(next) ? Math.max(notBefore, automaticNotBefore) : notBefore;
    if (now() < readyAt) { schedule(next, readyAt - now()); return; }
    pending = null;
    const requestState = { controller: new AbortController(), reason: next };
    active = requestState;
    const quiet = isQuiet(next);
    const context: ReadRefreshContext = {
      signal: requestState.controller.signal, reason: next, quiet,
      current: () => !stopped && active === requestState && !requestState.controller.signal.aborted
        && (options.current?.() ?? true) && (!quiet || options.canBackground()),
    };
    options.onBusy?.(true);
    void Promise.resolve().then(() => { if (context.current()) return options.load(context); }).then(() => {
      if (context.current()) { failures = 0; notBefore = 0; automaticNotBefore = 0; }
    }).catch(error => {
      if (!context.current()) return;
      failures++;
      // Focus/online/mutation storms also respect a server throttle. Network failures
      // back off progressively; successful loads restore the normal interval.
      notBefore = now() + readRetryAfter(error, now());
      automaticNotBefore = Math.max(notBefore, now() + Math.min(300000, 5000 * 2 ** Math.min(failures - 1, 6)));
    }).finally(() => {
      if (stopped || active !== requestState) return;
      if (quiet && !options.canBackground()) remember('resume');
      active = null;
      options.onBusy?.(false);
      if (pending) request(pending);
      else if (options.automatic !== false) schedule('interval', Math.max(interval, automaticNotBefore - now()));
    });
  }

  return {
    request,
    /** Legacy views already perform their own initial load. Arm polling without a duplicate read. */
    start() {
      if (!stopped && options.automatic !== false && !active && timer === undefined) schedule('interval', interval);
    },
    /** Called after visibility, connectivity, modal or dirty-form state changes. */
    environmentChanged() {
      if (stopped) return;
      if (active && isQuiet(active.reason) && !options.canBackground()) {
        active.controller.abort(); remember('resume');
      }
      if (!active && pending && (!isQuiet(pending) || options.canBackground())) request(pending);
    },
    dispose() {
      stopped = true; pending = null; cancelTimer(); active?.controller.abort();
    },
  };
}
