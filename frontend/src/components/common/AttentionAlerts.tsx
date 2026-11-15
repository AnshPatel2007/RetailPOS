import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { Button as AriaButton, Dialog, DialogTrigger } from 'react-aria-components';
import { Bell, CheckCircle2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { ControlPopover } from '@/components/ui/Overlay';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/store/authStore';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { reportService } from '@/services/api';
import { formatCurrency, cn } from '@/lib/utils';

export type AttentionSeverity = 'high' | 'medium' | 'low';
export interface AttentionFinding {
  key: string;
  severity: AttentionSeverity;
  sentence: string;
  amount?: number;
  count?: number;
  href: string;
}
export interface AttentionReport {
  asOf: string;
  timezone: string;
  incomplete: boolean;
  items: AttentionFinding[];
  figures: {
    yesterday: { date: string; sales: number; grossProfit: number | null; grossMargin: number | null; costBasis: 'HISTORICAL' | 'ESTIMATED' | 'PROVISIONAL' | 'UNAVAILABLE' };
    billsDue: { count: number; amount: number; overdue: number };
  };
}

const dot: Record<AttentionSeverity, string> = { high: 'bg-destructive', medium: 'bg-warning', low: 'bg-muted-foreground' };
const word: Record<AttentionSeverity, string> = { high: 'Urgent', medium: 'Soon', low: 'When you can' };
const action: Record<string, string> = {
  'stock-exceptions': 'Count items', 'profit-not-confirmed': 'Review', 'drawer-difference': 'See shifts', 'prices-below-target': 'Review prices',
  'bills-due': 'See bills', 'orders-overdue': 'See orders', 'refunds-high': 'See refunds', 'deliveries-without-invoice': 'Match invoices',
  'job-failures': 'See jobs', 'unusual-sales-day': 'See report', 'invoices-to-confirm': 'Check invoices',
};

/*
 * Which alerts a person has read or dismissed, kept on this computer per person and
 * store (no server change). An alert is known by its rule and its exact wording, so
 * when the problem changes (more items, a bigger amount, a newer date) it counts as
 * new again, and a dismissed alert comes back.
 */
interface Marks { seen: string[]; dismissed: string[] }
const EMPTY = '{"seen":[],"dismissed":[]}';
const storageKey = (scope: string) => `attention-marks:${scope}`;
const memory = new Map<string, string>();
const listeners = new Set<() => void>();
function readMarks(scope: string): string {
  if (memory.has(scope)) return memory.get(scope)!;
  try { return localStorage.getItem(storageKey(scope)) ?? EMPTY; } catch { return EMPTY; }
}
function writeMarks(scope: string, marks: Marks) {
  const raw = JSON.stringify(marks);
  memory.set(scope, raw);
  try { localStorage.setItem(storageKey(scope), raw); } catch { /* a private window keeps them for this visit only */ }
  listeners.forEach(listener => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab of this person marked something.
  const storage = (event: StorageEvent) => { if (event.key?.startsWith('attention-marks:')) { memory.clear(); listener(); } };
  window.addEventListener('storage', storage);
  return () => { listeners.delete(listener); window.removeEventListener('storage', storage); };
}
function parse(raw: string): Marks {
  try {
    const value = JSON.parse(raw) as Partial<Marks>;
    return { seen: Array.isArray(value.seen) ? value.seen : [], dismissed: Array.isArray(value.dismissed) ? value.dismissed : [] };
  } catch { return { seen: [], dismissed: [] }; }
}
const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];
const identity = (item: AttentionFinding) => [item.key, item.sentence, item.amount ?? '', item.count ?? ''].join('|');

export interface AttentionAlert extends AttentionFinding { id: string; isNew: boolean; dismissed: boolean }

/** The store's alerts (Dashboard > attention rules) for owners and managers, with this person's read and dismissed marks. */
export function useAttentionAlerts() {
  const user = useAuthStore(state => state.user);
  const enabled = user?.role === 'ADMIN' || user?.role === 'MANAGER';
  const scope = `${user?.id ?? ''}:${user?.locationId ?? ''}`;
  // The same read as the Dashboard's figures, every two minutes: new alerts arrive without a reload.
  const query = useScopedQuery<AttentionReport>(['attention'], async signal => (await reportService.getAttention(signal)).data.data, enabled, 120000, { refreshInterval: 120000 });
  const raw = useSyncExternalStore(subscribe, () => readMarks(scope));
  const marks = useMemo(() => parse(raw), [raw]);
  const report = query.data;
  const items: AttentionAlert[] = useMemo(() => (report?.items ?? []).map(item => {
    const id = identity(item);
    return { ...item, id, isNew: !marks.seen.includes(id), dismissed: marks.dismissed.includes(id) };
  }), [report, marks]);
  const shown = items.filter(item => !item.dismissed);
  const update = (change: (current: Marks) => Marks) => {
    const next = change(parse(readMarks(scope)));
    // Forget alerts that are gone, unless some checks could not run (an alert may only be missing for now).
    if (report && !report.incomplete) {
      const current = new Set(items.map(item => item.id));
      next.seen = next.seen.filter(id => current.has(id));
      next.dismissed = next.dismissed.filter(id => current.has(id));
    }
    writeMarks(scope, next);
  };
  return {
    enabled, scope, report: report ?? null, error: query.error, loading: query.loading, refresh: query.refresh,
    shown, fresh: shown.filter(item => item.isNew), hidden: items.length - shown.length,
    markRead: (ids: string[] = shown.map(item => item.id)) => update(current => ({ ...current, seen: union(current.seen, ids) })),
    dismiss: (id: string) => update(current => ({ seen: union(current.seen, [id]), dismissed: union(current.dismissed, [id]) })),
    restore: () => update(current => ({ ...current, dismissed: [] })),
  };
}

function AlertRow({ item, isNew, onFollow, onDismiss }: { item: AttentionAlert; isNew: boolean; onFollow?: () => void; onDismiss: () => void }) {
  return <li className="attention-row">
    <span className={cn('attention-dot', dot[item.severity])} aria-hidden="true" />
    <p className="attention-sentence">
      <span className="sr-only">{word[item.severity]}: </span>
      {isNew && <span className="attention-new">New</span>}{item.sentence}
    </p>
    {item.amount !== undefined && <span className="attention-amount">{formatCurrency(item.amount)}</span>}
    <span className="attention-row-actions">
      <Link className="page-action" to={item.href} onClick={onFollow}>{action[item.key] || 'Open'}</Link>
      <Button variant="ghost" aria-label={`Dismiss: ${item.sentence}`} onClick={onDismiss}>Dismiss</Button>
    </span>
  </li>;
}

/** The bell's list opens when a slide-in message asks for it ("View alerts"). */
const OPEN_ALERTS = 'pos:open-alerts';
/**
 * Alerts already known in this visit, per person and store. The first look after
 * signing in fills it silently (the bell just shows its number); an alert that
 * turns up later slides in for a few seconds.
 */
const knownThisVisit = new Map<string, Set<string>>();

/** A new alert, sliding in at the top right; it leaves after about 4 seconds, or with ×. */
function AlertToast({ visible, item, count, onOpen, onClose }: { visible: boolean; item: AttentionAlert; count: number; onOpen: () => void; onClose: () => void }) {
  return <div className={cn('attention-toast', visible ? 'is-in' : 'is-out')} role="status" aria-live="polite">
    <span className={cn('attention-dot', dot[item.severity])} aria-hidden="true" />
    <div className="attention-toast-body">
      <p className="attention-toast-title">{count === 1 ? 'New alert' : `${count} new alerts`}</p>
      <p className="attention-toast-text">{item.sentence}</p>
      <button type="button" className="attention-toast-open" onClick={onOpen}>View alerts</button>
    </div>
    <button type="button" className="attention-toast-close" aria-label="Close this notification" onClick={onClose}><X size={16} aria-hidden="true" /></button>
  </div>;
}

/**
 * The alerts button in the top bar. Its number counts
 * the alerts this person has not read yet; opening the list marks them read. Alerts
 * found at sign-in only set the number; one that arrives later also slides in.
 */
export function AttentionBell({ className }: { className?: string }) {
  const alerts = useAttentionAlerts();
  const [open, setOpen] = useState(false);
  // Which alerts were new when the list was opened: they keep their "New" tag while it is open.
  const [newWhenOpened, setNewWhenOpened] = useState<Set<string>>(new Set());
  const [bump, setBump] = useState(false);
  const count = alerts.fresh.length;
  const latest = useRef({ alerts, count });
  latest.current = { alerts, count };
  const openChange = (next: boolean) => {
    const current = latest.current;
    if (next) { setNewWhenOpened(new Set(current.alerts.fresh.map(item => item.id))); if (current.count) current.alerts.markRead(); }
    setOpen(next);
  };
  const openRef = useRef(openChange);
  openRef.current = openChange;

  // Announce alerts that arrive after the first look of this visit (once, however many bells are mounted).
  const { report, scope, enabled } = alerts;
  useEffect(() => {
    if (!enabled || !report) return;
    const current = latest.current.alerts;
    const known = knownThisVisit.get(scope);
    if (!known) { knownThisVisit.set(scope, new Set(current.shown.map(item => item.id))); return; }
    const arrived = current.fresh.filter(item => !known.has(item.id));
    current.shown.forEach(item => known.add(item.id));
    if (!arrived.length) return;
    toast.custom(t => <AlertToast visible={t.visible} item={arrived[0]} count={arrived.length}
      onOpen={() => { toast.dismiss(t.id); window.dispatchEvent(new Event(OPEN_ALERTS)); }}
      onClose={() => toast.dismiss(t.id)} />, { id: 'attention:' + arrived[0].id, duration: 4000 });
  }, [report, scope, enabled]);
  // The number pops when it goes up after the first look (+1), not at sign-in.
  const previousCount = useRef<number | null>(null);
  useEffect(() => {
    if (!report) return;
    if (previousCount.current !== null && count > previousCount.current) setBump(true);
    previousCount.current = count;
  }, [report, count]);
  useEffect(() => { if (!bump) return; const timer = setTimeout(() => setBump(false), 900); return () => clearTimeout(timer); }, [bump]);
  // "View alerts" opens the list of the bell that is on screen (a closed menu drawer may hold another).
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const show = () => {
      const box = trigger.current?.getBoundingClientRect();
      if (box && box.width > 0 && box.right > 0 && box.left < innerWidth && box.bottom > 0 && box.top < innerHeight) openRef.current(true);
    };
    window.addEventListener(OPEN_ALERTS, show);
    return () => window.removeEventListener(OPEN_ALERTS, show);
  }, []);

  if (!enabled) return null;
  return <DialogTrigger isOpen={open} onOpenChange={openChange}>
    <AriaButton ref={trigger} className={cn('attention-bell', className)} aria-label={count ? `Alerts, ${count} new` : 'Alerts'}>
      <Bell size={18} aria-hidden="true" />
      {count > 0 && <span className="attention-bell-count" data-bump={bump || undefined} aria-hidden="true">{count > 9 ? '9+' : count}</span>}
    </AriaButton>
    <ControlPopover placement="bottom end">
      <Dialog aria-label="Alerts" className="attention-panel">
        <div className="attention-panel-head">
          <h2>Alerts</h2>
          {alerts.shown.length > 0 && <span>{alerts.shown.length} open</span>}
        </div>
        {alerts.error ? <div role="alert" className="attention-panel-empty">
          <p>Alerts could not be loaded.</p>
          <Button onClick={() => void alerts.refresh()}>Retry</Button>
        </div> : !alerts.report ? <p role="status" className="attention-panel-empty">Checking the store…</p>
          : alerts.shown.length === 0 ? <p className="attention-panel-empty"><CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />Nothing needs attention right now.</p>
          : <ul aria-label="Alerts" className="attention-list">
            {alerts.shown.map(item => <AlertRow key={item.id} item={item} isNew={newWhenOpened.has(item.id)} onFollow={() => setOpen(false)} onDismiss={() => alerts.dismiss(item.id)} />)}
          </ul>}
        {(alerts.hidden > 0 || alerts.report?.incomplete) && <div className="attention-panel-foot">
          {alerts.report?.incomplete && <p>Some checks could not run just now; this list may be missing an alert.</p>}
          {alerts.hidden > 0 && <Button variant="ghost" onClick={alerts.restore}>Show {alerts.hidden} dismissed</Button>}
        </div>}
      </Dialog>
    </ControlPopover>
  </DialogTrigger>;
}
