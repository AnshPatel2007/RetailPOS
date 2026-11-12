import { Link } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { DataPanel } from '@/components/common/Workspace';
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
  'job-failures': 'See jobs', 'unusual-sales-day': 'See report',
};

/** What needs attention today: one sentence each, worked out from the store's records. */
export function AttentionList({ report, error, onRetry }: { report: AttentionReport | null; error?: string; onRetry?: () => void }) {
  return <DataPanel className="attention-list mb-6">
    <div className="px-4 py-4 sm:px-5">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-lg font-semibold">Needs Attention</h2>
      {report && report.items.length > 0 && <span className="text-sm text-muted-foreground">{report.items.length} {report.items.length === 1 ? 'item' : 'items'}</span>}
    </div>
    {error ? <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 text-sm">
      <span>The attention list could not be loaded.</span>
      {onRetry && <button type="button" className="page-action" onClick={onRetry}>Retry</button>}
    </div> : !report ? <p role="status" className="mt-3 text-sm text-muted-foreground">Checking the store…</p>
      : report.items.length === 0 ? <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />Nothing needs attention right now.</p>
      : <ul className="mt-3 divide-y divide-border" aria-label="Needs attention">
        {report.items.map(item => <li key={item.key} className="flex flex-wrap items-start gap-x-3 gap-y-2 py-3 sm:flex-nowrap">
          <span className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', dot[item.severity])} aria-hidden="true" />
          <p className="min-w-0 flex-1 text-sm"><span className="sr-only">{word[item.severity]}: </span>{item.sentence}</p>
          {item.amount !== undefined && <span className="shrink-0 text-sm font-medium tabular-nums">{formatCurrency(item.amount)}</span>}
          <Link className="page-action shrink-0" to={item.href}>{action[item.key] || 'Open'}</Link>
        </li>)}
      </ul>}
    {report?.incomplete && <p className="mt-2 text-xs text-muted-foreground">Some checks could not run just now; this list may be missing an item.</p>}
    </div>
  </DataPanel>;
}
