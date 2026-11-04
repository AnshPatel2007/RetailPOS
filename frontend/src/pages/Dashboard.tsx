import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { reportService } from '@/services/api';
import { DashboardMetrics } from '@/types';
import { useAuthStore } from '@/store/authStore';
import { ManagementPage, SummaryStrip } from '@/components/common/Workspace';
import { PageHeader } from '@/components/common/PageHeader';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { AutoRefreshStatus } from '@/components/common/AutoRefreshStatus';
import { Button } from '@/components/ui/Button';
import { can } from '@/lib/capabilities';
import { formatCurrency } from '@/lib/utils';
import { useInventoryExceptionCount } from '@/hooks/useInventoryExceptionCount';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import {
  ShoppingCart,
  Users,
  Package,
  TrendingUp,
  TrendingDown,
  Clock,
  CreditCard,
  BarChart3,
} from 'lucide-react';


const TrendBadge = ({ trend, label }: { trend?: number | null; label?: string }) => {
  if (trend === undefined || trend === null) return null;
  const up = trend >= 0;
  return (
    <div className="flex items-center gap-1">
      <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${up ? 'text-success' : 'text-destructive'}`}>
        {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
        {up ? '+' : ''}{trend}%
      </span>
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
    </div>
  );
};

const elapsedTime = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
};

const timeAgo = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

const formatHourLabel = (timestamp: number, timezone: string): string => new Intl.DateTimeFormat('en-US', {
  timeZone: timezone, hour: 'numeric', timeZoneName: 'short',
}).format(timestamp);

// Keep clock ticks from rerendering the charts and tables every second.
const DashboardHeader = ({ timezone, firstName }: { timezone: string; firstName?: string }) => {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(timer); }, []);
  const hour = Number(now.toLocaleString('en-US', { timeZone: timezone, hour: 'numeric', hourCycle: 'h23' }));
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return <PageHeader title={`${greeting}, ${firstName || 'there'}`} actions={
    <div className="text-right"><p className="text-sm font-medium">{now.toLocaleDateString(undefined, { timeZone: timezone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
      <p className="text-xs text-muted-foreground">{now.toLocaleTimeString(undefined, { timeZone: timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' })}</p></div>
  } />;
};

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value?: number }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover border border-border rounded-lg shadow-lg px-3 py-2">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-sm font-bold text-primary">{formatCurrency(payload[0].value ?? 0)}</p>
    </div>
  );
};

export const Dashboard: React.FC = () => {
  const user = useAuthStore(state => state.user);
  return <DashboardContent key={user?.id + ':' + user?.role + ':' + user?.locationId} />;
};

const DashboardContent: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isManager = can(user?.role, 'shift.store');
  const canInventory = can(user?.role, 'inventory.read');
  const canReports = user?.role === 'ADMIN' || user?.role === 'MANAGER';
  const query = useScopedQuery<DashboardMetrics>(['dashboard'], async signal => (await reportService.getDashboard(signal)).data.data);
  const metrics = query.data;
  const exceptionCount = useInventoryExceptionCount(canInventory && user?.role !== 'SUPER_ADMIN');

  if (query.loading) {
    return (
      <div className="p-4 sm:p-8">
        <PageHeader title="Dashboard" />
        <div className="animate-pulse space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-28 bg-muted rounded-lg"></div>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 h-72 bg-muted rounded-lg"></div>
            <div className="h-72 bg-muted rounded-lg"></div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="h-48 bg-muted rounded-lg"></div>
            <div className="h-48 bg-muted rounded-lg"></div>
            <div className="h-48 bg-muted rounded-lg"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!metrics) return <div className="p-4 sm:p-8"><PageHeader title="Dashboard" /><div role="alert" className="p-4 border border-destructive rounded-lg space-y-3">
    <p>Dashboard data is unavailable.</p><Button variant="outline" onClick={query.refresh} disabled={query.refreshing}>Retry</Button></div></div>;
  const timezone = metrics.period.timezone;
  const hourlyData = metrics.hourlyData.map(entry => ({ ...entry, label: formatHourLabel(entry.timestamp, timezone) }));
  const { topProducts, activeShifts } = metrics;
  const maxRevenue = Math.max(1, ...topProducts.map(product => Math.abs(product.revenue)));

  return (
    <ManagementPage>
      <DashboardHeader timezone={timezone} firstName={user?.firstName} />
      <AutoRefreshStatus state={query} />

      <p className="mb-4 text-sm text-muted-foreground">Collections include tax, less refunds and voids recorded in each period. Calendar: {timezone}. {user?.role === 'CASHIER' && 'Showing activity for your sales.'}</p>
      {metrics.historyWarning && <p role="status" className="mb-4 text-sm text-warning">{metrics.historyWarning}</p>}
      {metrics.todayVoidCount > 0 && <p className="mb-4 text-sm text-muted-foreground">Voids today: {metrics.todayVoidCount} ({formatCurrency(metrics.todayVoids)}), already deducted from collections.</p>}
      <SummaryStrip className="mb-6" items={[
        { label: "Today's Collections", value: formatCurrency(metrics.todaySales || 0), detail: <>{metrics.todayTransactions || 0} {metrics.todayTransactions === 1 ? 'transaction' : 'transactions'}<TrendBadge trend={metrics.todayTrend} label="vs yesterday" /></> },
        { label: '7-Day Collections', value: formatCurrency(metrics.weekSales || 0), detail: <TrendBadge trend={metrics.weekTrend} label="vs prev week" /> },
        { label: '30-Day Collections', value: formatCurrency(metrics.monthSales || 0), detail: <TrendBadge trend={metrics.monthTrend} label="vs prev month" /> },
        { label: 'Avg Order Value', value: metrics.averageOrderValue == null ? 'N/A' : formatCurrency(metrics.averageOrderValue), detail: 'Original purchases today' },
      ]} />

      {/* Charts row - wider chart + top products */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Hourly sales chart - takes 2 cols */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Collections Last 12 Hours</CardTitle>
          </CardHeader>
          <CardContent>
            {hourlyData.every(entry => entry.total === 0) ? (
              <div className="h-[180px] flex flex-col items-center justify-center text-muted-foreground">
                <BarChart3 className="h-10 w-10 mb-2 opacity-30" />
                <p className="text-sm">No collection activity in the last 12 hours</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={264}>
                <BarChart data={hourlyData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${v}`} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--accent))' }} />
                  <defs>
                    <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={1} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.6} />
                    </linearGradient>
                  </defs>
                  <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                  <Bar isAnimationActive={false} dataKey="total" fill="url(#barGradient)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Top products today */}
        <Card>
          <CardHeader>
            <CardTitle>Top Products Today</CardTitle>
            <p className="text-xs text-muted-foreground">By net collections, including returns and voids.</p>
          </CardHeader>
          <CardContent>
            {metrics.productWarning && <p role="status" className="mb-3 text-xs text-warning">{metrics.productWarning}</p>}
            {topProducts.length === 0 ? (
              <div className="h-[180px] flex flex-col items-center justify-center text-muted-foreground">
                <Package className="h-10 w-10 mb-2 opacity-30" />
                <p className="text-sm">No product activity today</p>
              </div>
            ) : (
              <div className="space-y-4">
                {topProducts.map((p, i) => {
                  const pct = maxRevenue > 0 ? (Math.abs(p.revenue) / maxRevenue) * 100 : 0;
                  return (
                    <div key={p.productId}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs font-bold text-muted-foreground w-4 text-right shrink-0">{i + 1}</span>
                          <span className="text-sm font-medium truncate">{p.name}</span>
                        </div>
                        <span className="text-sm font-bold text-primary shrink-0 ml-2">{formatCurrency(p.revenue)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${p.revenue < 0 ? 'bg-destructive/80' : 'bg-primary/80'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0 w-20 text-right">{p.qty} net units</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Middle row: secondary stats, one strip; each tile opens its page */}
      <SummaryStrip className="mb-6" items={[
        { label: 'Customers', value: metrics?.totalCustomers || 0, href: '/customers' },
        ...(isManager ? [{ label: 'On shift', value: metrics?.activeEmployees || 0, href: '/shifts' }] : []),
        ...(canInventory ? [
          { label: 'Products', value: metrics?.totalProducts || 0, href: '/inventory' },
          { label: 'Stock alerts', value: metrics?.lowStockCount || 0, tone: metrics?.lowStockCount ? 'warning' as const : 'default' as const, href: '/inventory' },
        ] : []),
        ...(canInventory && exceptionCount > 0 ? [{ label: 'Inventory exceptions', value: exceptionCount, detail: 'Sold below recorded stock', tone: 'danger' as const, href: '/inventory/stock-control/exceptions' }] : []),
        ...(canReports ? [{ label: 'Refunds today', value: metrics?.todayRefundCount || 0, detail: (metrics?.todayRefunds || 0) > 0 ? formatCurrency(metrics?.todayRefunds || 0) : undefined, href: '/reports' }] : []),
      ]} />

      {/* Bottom row: Recent sales + Low stock + Payment breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Recent Sales */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Sales</CardTitle>
          </CardHeader>
          <CardContent>
            {!metrics?.recentSales?.length ? (
              <div className="h-40 flex flex-col items-center justify-center text-muted-foreground">
                <ShoppingCart className="h-8 w-8 mb-2 opacity-30" />
                <p className="text-sm">No recent sales</p>
              </div>
            ) : (
              <div className="space-y-3">
                {metrics.recentSales.map((sale) => (
                  <div key={sale.id} className="flex items-center justify-between py-1">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {sale.customerName || sale.saleNumber}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {sale.paymentMethod.replace(/_/g, ' ')} · {timeAgo(sale.createdAt)} / {sale.status.toLowerCase()}
                      </p>
                      <time dateTime={sale.createdAt} className="block text-xs text-muted-foreground">
                        {new Date(sale.createdAt).toLocaleString('en-US', { timeZone: timezone, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}
                      </time>
                    </div>
                    <span className="text-sm font-bold ml-3 shrink-0">{formatCurrency(sale.total)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Low Stock Items */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Stock Alerts</CardTitle>
              {canInventory && metrics.lowStockCount > 0 && (
                <button
                  onClick={() => navigate('/inventory')}
                  className="text-xs text-primary hover:underline"
                >
                  View all
                </button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {!metrics?.lowStockItems?.length ? (
              <div className="h-40 flex flex-col items-center justify-center text-muted-foreground">
                <Package className="h-8 w-8 mb-2 opacity-30" />
                <p className="text-sm">All items well stocked</p>
              </div>
            ) : (
              <div className="space-y-3">
                {metrics.lowStockItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between py-1">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{item.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{item.sku}</p>
                    </div>
                    <div className="text-right ml-3 shrink-0">
                      <p className={`text-sm font-bold ${item.stock <= 0 ? 'text-destructive' : 'text-warning'}`}>
                        {item.stock}
                      </p>
                      <p className="text-xs text-muted-foreground">{item.stock <= 0 ? 'Out of stock' : 'Low stock'} · Min stock: {item.alert}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Payment Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>Payment Methods Today</CardTitle>
            <p className="text-xs text-muted-foreground">Net activity by sale/refund payment label. Split tenders remain grouped; this is not terminal settlement.</p>
          </CardHeader>
          <CardContent>
            {!metrics?.paymentBreakdown?.length ? (
              <div className="h-40 flex flex-col items-center justify-center text-muted-foreground">
                <CreditCard className="h-8 w-8 mb-2 opacity-30" />
                <p className="text-sm">No payments today</p>
              </div>
            ) : (
              <div className="space-y-3">
                {(() => {
                  return metrics.paymentBreakdown.map((pb) => {
                  const pct = pb.percentage;
                  return (
                    <div key={pb.method}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium capitalize">
                          {pb.method.replace(/_/g, ' ').toLowerCase()}
                        </span>
                        <span className="text-sm font-bold">{formatCurrency(pb.total)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {pct !== null && <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary/60 rounded-full transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>}
                        <span className="text-xs text-muted-foreground text-right">
                          {pb.count} original sales / {pct === null ? 'Share unavailable' : pct.toFixed(0) + '%'}
                        </span>
                      </div>
                    </div>
                  );
                });
                })()}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Active shifts - visible to managers+ only */}
      {isManager && activeShifts.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-success" />
              Active Shifts ({metrics.activeEmployees})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-3">Up to 10 active shifts. Collections follow the original sale shift, less its returns and voids. Drawer payouts are shown in Shifts.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {activeShifts.map((shift) => (
                <div key={shift.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                  <div className="w-2 h-2 rounded-full bg-success shrink-0 animate-pulse" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{shift.employeeName}</p>
                    <p className="text-xs text-muted-foreground">
                      {elapsedTime(shift.clockInAt)} · {shift.totalTransactions} sales · {formatCurrency(shift.totalSales)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <button onClick={() => navigate('/pos')} className="p-4 border border-border rounded-lg hover:bg-accent hover:border-primary transition-colors text-left">
              <ShoppingCart className="h-6 w-6 mb-2 text-primary" />
              <p className="font-medium">New Sale</p>
              <p className="text-xs text-muted-foreground">Start checkout</p>
            </button>
            {canInventory && (<button onClick={() => navigate('/inventory')} className="p-4 border border-border rounded-lg hover:bg-accent hover:border-primary transition-colors text-left">
              <Package className="h-6 w-6 mb-2 text-primary" />
              <p className="font-medium">Inventory</p>
              <p className="text-xs text-muted-foreground">Manage products</p>
            </button>)}
            <button onClick={() => navigate('/customers')} className="p-4 border border-border rounded-lg hover:bg-accent hover:border-primary transition-colors text-left">
              <Users className="h-6 w-6 mb-2 text-primary" />
              <p className="font-medium">Customers</p>
              <p className="text-xs text-muted-foreground">View directory</p>
            </button>
            {canReports && (<button onClick={() => navigate('/reports')} className="p-4 border border-border rounded-lg hover:bg-accent hover:border-primary transition-colors text-left">
              <TrendingUp className="h-6 w-6 mb-2 text-primary" />
              <p className="font-medium">Reports</p>
              <p className="text-xs text-muted-foreground">See analytics</p>
            </button>)}
          </div>
        </CardContent>
      </Card>
    </ManagementPage>
  );
};
