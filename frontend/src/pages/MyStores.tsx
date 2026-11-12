import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { ManagementPage } from '@/components/common/Workspace';
import { PageHeader } from '@/components/common/PageHeader';
import { AboutNumbers } from '@/components/common/AboutNumbers';
import { EmptyState } from '@/components/common/EmptyState';
import { TrendBadge } from '@/components/common/TrendBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { apiErrorMessage, organizationService } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { formatCurrency, formatDateTime } from '@/lib/utils';

interface StoreCard {
  locationId: string;
  name: string;
  isActive: boolean;
  timezone: string;
  isCurrent: boolean;
  today: { sales: number; transactions: number | null; trend: number | null; historyWarning: string | null };
  yesterday: { date: string; sales: number; grossProfit: number | null; grossMargin: number | null; costBasis: string; note: string | null };
  openStockExceptions: number;
  attentionCount: number;
  attentionIncomplete: boolean;
  lastDrawer: { difference: number; closedAt: string; employeeName: string } | null;
}

function Figure({ label, value, detail, tone }: { label: string; value: React.ReactNode; detail?: React.ReactNode; tone?: 'warning' | 'danger' }) {
  return <div>
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className={`text-lg font-semibold ${tone === 'danger' ? 'text-destructive' : tone === 'warning' ? 'text-warning' : ''}`}>{value}</p>
    {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
  </div>;
}

function drawerText(drawer: StoreCard['lastDrawer']) {
  if (!drawer) return { value: '—', detail: 'No closed drawers yet' };
  const amount = Math.abs(drawer.difference);
  return {
    value: drawer.difference === 0 ? 'Even' : `${formatCurrency(amount)} ${drawer.difference < 0 ? 'short' : 'over'}`,
    detail: `${drawer.employeeName}, ${formatDateTime(drawer.closedAt)}`,
    tone: amount >= 20 ? 'danger' as const : amount >= 5 ? 'warning' as const : undefined,
  };
}

/**
 * Owners of several stores: every store at a glance, and one click to work in it.
 * The figures are each store's own Dashboard figures.
 */
export function MyStores() {
  const navigate = useNavigate();
  const switchStore = useAuthStore(state => state.switchStore);
  const [opening, setOpening] = useState<string | null>(null);
  const overview = useScopedQuery<{ asOf: string; stores: StoreCard[] }>(['organization-overview'],
    async signal => (await organizationService.getOverview(signal)).data.data, true, 60000);

  const open = async (store: StoreCard) => {
    if (store.isCurrent) { navigate('/dashboard'); return; }
    setOpening(store.locationId);
    try {
      await switchStore(store.locationId);
      toast.success(`Now working in ${store.name}`);
      navigate('/dashboard');
    } catch (error) {
      toast.error(error instanceof Error && !(error as { response?: unknown }).response ? error.message : apiErrorMessage(error, 'Could not open that store. Try again.'));
    } finally {
      setOpening(null);
    }
  };

  const stores = overview.data?.stores ?? [];
  return <ManagementPage>
    <PageHeader title="My Stores" />
    <AboutNumbers className="mb-4">
      <p>These are the same figures each store&apos;s Dashboard shows. Sales include tax; refunds and voids come off on the day they happen. Today is each store&apos;s own day, in its own timezone.</p>
      <p>Profit yesterday is marked not final while sales beyond recorded stock wait for a count; it is unavailable when a cost is missing.</p>
    </AboutNumbers>

    {overview.error && !overview.data && <div role="alert" className="mb-4 space-y-3 rounded-lg border border-destructive p-4">
      <p>{overview.error}</p>
      <Button variant="outline" onClick={overview.refresh} disabled={overview.refreshing}>Retry</Button>
    </div>}
    {overview.loading && <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-busy="true">
      {[0, 1].map(index => <div key={index} className="h-64 animate-pulse rounded-lg bg-muted" />)}
    </div>}
    {!overview.loading && overview.data && !stores.length && <EmptyState icon={Building2} title="No stores to show" hint="Stores you run as an owner or admin appear here." />}

    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {stores.map(store => {
        const drawer = drawerText(store.lastDrawer);
        const profit = store.yesterday;
        return <section key={store.locationId} aria-label={store.name} className="flex"><Card className="flex w-full flex-col">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{store.name}</CardTitle>
              {store.isCurrent && <Badge variant="secondary">Working here</Badge>}
              {!store.isActive && <Badge variant="warning">Inactive</Badge>}
            </div>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <Figure label="Sales today" value={formatCurrency(store.today.sales)} detail={<>
                {store.today.transactions ?? 0} {store.today.transactions === 1 ? 'sale' : 'sales'}
                <TrendBadge trend={store.today.trend} label="vs same time yesterday" />
                {store.today.historyWarning && <p className="text-warning">{store.today.historyWarning}</p>}
              </>} />
              <Figure label="Profit yesterday"
                value={profit.grossProfit === null ? 'Unavailable' : formatCurrency(profit.grossProfit)}
                tone={profit.grossProfit !== null && profit.grossProfit < 0 ? 'danger' : undefined}
                detail={<>
                  {profit.grossProfit === null ? 'Needs complete costs' : profit.grossMargin === null ? (profit.sales ? 'Margin unavailable' : 'No sales')
                    : `${profit.grossMargin}% margin${profit.costBasis === 'PROVISIONAL' ? ' · not final' : ''}`}
                  {profit.note && <p>{profit.note}</p>}
                </>} />
              <Figure label="Needs attention" value={store.attentionCount}
                detail={store.attentionIncomplete ? 'Some checks could not run' : store.attentionCount ? 'On the store\'s Dashboard' : 'Nothing right now'}
                tone={store.attentionCount ? 'warning' : undefined} />
              <Figure label="Stock problems" value={store.openStockExceptions}
                detail={store.openStockExceptions ? 'Sold beyond recorded stock' : 'None open'} tone={store.openStockExceptions ? 'warning' : undefined} />
              <Figure label="Last drawer closed" value={drawer.value} detail={drawer.detail} tone={drawer.tone} />
            </div>
            <div className="mt-auto flex justify-end">
              <Button onClick={() => { void open(store); }} disabled={opening !== null} aria-label={`Open ${store.name}`}>
                {opening === store.locationId ? 'Opening…' : store.isCurrent ? 'Go to Dashboard' : 'Open store'}
              </Button>
            </div>
          </CardContent>
        </Card></section>;
      })}
    </div>
  </ManagementPage>;
}
