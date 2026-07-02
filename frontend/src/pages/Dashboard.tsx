import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { reportService } from '@/services/api';
import { DashboardMetrics } from '@/types';
import { useAuthStore } from '@/store/authStore';
import { formatCurrency } from '@/lib/utils';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import {
  DollarSign,
  ShoppingCart,
  Users,
  Package,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  RefreshCw,
  Clock,
  CreditCard,
  UserCheck,
  Undo2,
  BarChart3,
} from 'lucide-react';

interface HourlyEntry { hour: number; utcHour: number; total: number; label?: string; }
interface TopProduct { productId: string; name: string; qty: number; revenue: number; }
interface ActiveShift { id: string; employeeName: string; clockInAt: string; totalSales: number; totalTransactions: number; }

const REFRESH_INTERVAL_MS = 30_000;

const TrendBadge = ({ trend, label }: { trend?: number | null; label?: string }) => {
  if (trend === undefined || trend === null) return null;
  const up = trend >= 0;
  return (
    <div className="flex items-center gap-1">
      <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${up ? 'text-green-500' : 'text-red-500'}`}>
        {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
        {up ? '+' : ''}{trend}%
      </span>
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
    </div>
  );
};

const elapsedTime = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
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

/** Convert UTC hour to local hour, supporting fractional timezone offsets (e.g., UTC+5:30) */
const utcHourToLocal = (utcHour: number): number => {
  const offsetMinutes = new Date().getTimezoneOffset() * -1; // positive = ahead of UTC
  const totalMinutes = utcHour * 60 + offsetMinutes;
  const localHour = Math.floor(((totalMinutes / 60) % 24 + 24) % 24);
  return localHour;
};

const formatHourLabel = (hour: number): string => {
  const h12 = hour % 12 || 12;
  const ampm = hour < 12 ? 'am' : 'pm';
  return `${h12}${ampm}`;
};

const getGreeting = (): string => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover border border-border rounded-lg shadow-lg px-3 py-2">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-sm font-bold text-primary">{formatCurrency(payload[0].value)}</p>
    </div>
  );
};

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [hourlyData, setHourlyData] = useState<HourlyEntry[]>([]);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [activeShifts, setActiveShifts] = useState<ActiveShift[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [secondsAgo, setSecondsAgo] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadMetrics = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    else setIsRefreshing(true);
    try {
      const [dashRes, hourlyRes] = await Promise.all([
        reportService.getDashboard(),
        reportService.getDashboardHourly(),
      ]);
      setMetrics(dashRes.data.data);
      const hourly = hourlyRes.data.data;
      // Convert UTC hours to local, handling fractional timezone offsets
      const localHourly = (hourly.hourlyData || []).map((entry: HourlyEntry) => {
        const localHour = utcHourToLocal(entry.utcHour);
        return {
          ...entry,
          hour: localHour,
          label: formatHourLabel(localHour),
        };
      });
      // Sort by chronological order
      localHourly.sort((a: HourlyEntry, b: HourlyEntry) => {
        const now = new Date().getHours();
        const aDist = ((a.hour - now + 24) % 24);
        const bDist = ((b.hour - now + 24) % 24);
        // hours further in the past come first
        return bDist - aDist;
      });
      setHourlyData(localHourly);
      setTopProducts(hourly.topProducts || []);
      setActiveShifts(hourly.activeShifts || []);
      setLastUpdated(new Date());
      setSecondsAgo(0);
    } catch (error) {
      console.error('Failed to load metrics:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => { loadMetrics(); }, [loadMetrics]);

  useEffect(() => {
    const interval = setInterval(() => loadMetrics(true), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadMetrics]);

  useEffect(() => {
    const tick = setInterval(() => {
      if (lastUpdated) {
        setSecondsAgo(Math.round((Date.now() - lastUpdated.getTime()) / 1000));
      }
    }, 5000);
    return () => clearInterval(tick);
  }, [lastUpdated]);

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-6">
          <div>
            <div className="h-8 bg-muted rounded w-64 mb-2"></div>
            <div className="h-4 bg-muted rounded w-48"></div>
          </div>
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

  const maxRevenue = topProducts.length > 0
    ? Math.max(...topProducts.map(p => p.revenue))
    : 1;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">
            {getGreeting()}, {user?.firstName || 'there'}
          </h1>
          <p className="text-muted-foreground">
            Here's what's happening at your store today.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-xs text-muted-foreground">
              Updated {secondsAgo < 10 ? 'just now' : `${secondsAgo}s ago`}
            </span>
          )}
          <button
            onClick={() => loadMetrics(true)}
            disabled={isRefreshing}
            className="p-2 rounded-lg hover:bg-accent transition-colors disabled:opacity-50"
            title="Refresh dashboard"
          >
            <RefreshCw className={`h-4 w-4 text-muted-foreground ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main KPI stats - 4 cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
        {/* Today's Sales */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-muted-foreground mb-1">Today's Sales</p>
                <h3 className="text-2xl font-bold truncate">{formatCurrency(metrics?.todaySales || 0)}</h3>
                <p className="text-xs text-muted-foreground mt-1">{metrics?.todayTransactions || 0} transactions</p>
                <TrendBadge trend={metrics?.todayTrend} label="vs yesterday" />
              </div>
              <div className="p-3 rounded-full bg-green-500/10 ml-3 shrink-0">
                <DollarSign className="h-6 w-6 text-green-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Week Sales */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-muted-foreground mb-1">Week Sales</p>
                <h3 className="text-2xl font-bold truncate">{formatCurrency(metrics?.weekSales || 0)}</h3>
                <p className="text-xs text-muted-foreground mt-1">Last 7 days</p>
                <TrendBadge trend={metrics?.weekTrend} label="vs prev week" />
              </div>
              <div className="p-3 rounded-full bg-blue-500/10 ml-3 shrink-0">
                <BarChart3 className="h-6 w-6 text-blue-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Month Sales */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-muted-foreground mb-1">Month Sales</p>
                <h3 className="text-2xl font-bold truncate">{formatCurrency(metrics?.monthSales || 0)}</h3>
                <p className="text-xs text-muted-foreground mt-1">Last 30 days</p>
                <TrendBadge trend={metrics?.monthTrend} label="vs prev month" />
              </div>
              <div className="p-3 rounded-full bg-purple-500/10 ml-3 shrink-0">
                <ShoppingCart className="h-6 w-6 text-purple-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Average Order Value */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-muted-foreground mb-1">Avg Order Value</p>
                <h3 className="text-2xl font-bold truncate">
                  {metrics?.averageOrderValue !== null && metrics?.averageOrderValue !== undefined
                    ? formatCurrency(metrics.averageOrderValue)
                    : 'N/A'}
                </h3>
                <p className="text-xs text-muted-foreground mt-1">Per transaction today</p>
              </div>
              <div className="p-3 rounded-full bg-indigo-500/10 ml-3 shrink-0">
                <CreditCard className="h-6 w-6 text-indigo-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts row - wider chart + top products */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Hourly sales chart - takes 2 cols */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Sales Last 12 Hours</CardTitle>
          </CardHeader>
          <CardContent>
            {hourlyData.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-muted-foreground">
                <BarChart3 className="h-10 w-10 mb-2 opacity-30" />
                <p className="text-sm">No sales data in the last 12 hours</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={264}>
                <BarChart data={hourlyData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--accent))' }} />
                  <defs>
                    <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={1} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.6} />
                    </linearGradient>
                  </defs>
                  <Bar dataKey="total" fill="url(#barGradient)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Top products today */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Products Today</CardTitle>
          </CardHeader>
          <CardContent>
            {topProducts.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-muted-foreground">
                <Package className="h-10 w-10 mb-2 opacity-30" />
                <p className="text-sm">No sales yet today</p>
              </div>
            ) : (
              <div className="space-y-4">
                {topProducts.map((p, i) => {
                  const pct = maxRevenue > 0 ? (p.revenue / maxRevenue) * 100 : 0;
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
                            className="h-full bg-primary/80 rounded-full transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0 w-14 text-right">{p.qty} sold</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Middle row: secondary stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-cyan-500/10">
                <Users className="h-5 w-5 text-cyan-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Customers</p>
                <p className="text-lg font-bold">{metrics?.totalCustomers || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-teal-500/10">
                <UserCheck className="h-5 w-5 text-teal-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Active Staff</p>
                <p className="text-lg font-bold">{metrics?.activeEmployees || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-violet-500/10">
                <Package className="h-5 w-5 text-violet-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Products</p>
                <p className="text-lg font-bold">{metrics?.totalProducts || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <button onClick={() => navigate('/inventory')} className="text-left">
          <Card className="hover:border-primary transition-colors h-full">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-orange-500/10">
                  <AlertTriangle className="h-5 w-5 text-orange-500" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Low Stock</p>
                  <p className="text-lg font-bold">{metrics?.lowStockCount || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </button>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500/10">
                <Undo2 className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Refunds</p>
                <p className="text-lg font-bold">
                  {metrics?.todayRefundCount || 0}
                  {(metrics?.todayRefunds || 0) > 0 && (
                    <span className="text-xs font-normal text-muted-foreground ml-1">
                      ({formatCurrency(metrics?.todayRefunds || 0)})
                    </span>
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bottom row: Recent sales + Low stock + Payment breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Recent Sales */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Sales</CardTitle>
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
                        {sale.paymentMethod.replace('_', ' ')} · {timeAgo(sale.createdAt)}
                      </p>
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
              <CardTitle className="text-base">Low Stock Items</CardTitle>
              {(metrics?.lowStockCount || 0) > 0 && (
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
                      <p className={`text-sm font-bold ${item.stock <= 0 ? 'text-red-500' : 'text-orange-500'}`}>
                        {item.stock}
                      </p>
                      <p className="text-xs text-muted-foreground">/ {item.alert} min</p>
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
            <CardTitle className="text-base">Payment Methods Today</CardTitle>
          </CardHeader>
          <CardContent>
            {!metrics?.paymentBreakdown?.length ? (
              <div className="h-40 flex flex-col items-center justify-center text-muted-foreground">
                <CreditCard className="h-8 w-8 mb-2 opacity-30" />
                <p className="text-sm">No payments today</p>
              </div>
            ) : (
              <div className="space-y-3">
                {metrics.paymentBreakdown.map((pb) => {
                  const totalPayments = metrics.paymentBreakdown.reduce((s, p) => s + p.total, 0);
                  const pct = totalPayments > 0 ? (pb.total / totalPayments) * 100 : 0;
                  return (
                    <div key={pb.method}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium capitalize">
                          {pb.method.replace('_', ' ').toLowerCase()}
                        </span>
                        <span className="text-sm font-bold">{formatCurrency(pb.total)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary/60 rounded-full transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground w-16 text-right">
                          {pb.count} ({pct.toFixed(0)}%)
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Active shifts */}
      {activeShifts.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-green-500" />
              Active Shifts ({activeShifts.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {activeShifts.map((shift) => (
                <div key={shift.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                  <div className="w-2 h-2 rounded-full bg-green-500 shrink-0 animate-pulse" />
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
          <CardTitle className="text-base">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <button onClick={() => navigate('/pos')} className="p-4 border border-border rounded-lg hover:bg-accent hover:border-primary transition-colors text-left">
              <ShoppingCart className="h-6 w-6 mb-2 text-primary" />
              <p className="font-medium">New Sale</p>
              <p className="text-xs text-muted-foreground">Start checkout</p>
            </button>
            <button onClick={() => navigate('/inventory')} className="p-4 border border-border rounded-lg hover:bg-accent hover:border-primary transition-colors text-left">
              <Package className="h-6 w-6 mb-2 text-primary" />
              <p className="font-medium">Inventory</p>
              <p className="text-xs text-muted-foreground">Manage products</p>
            </button>
            <button onClick={() => navigate('/customers')} className="p-4 border border-border rounded-lg hover:bg-accent hover:border-primary transition-colors text-left">
              <Users className="h-6 w-6 mb-2 text-primary" />
              <p className="font-medium">Customers</p>
              <p className="text-xs text-muted-foreground">View directory</p>
            </button>
            <button onClick={() => navigate('/reports')} className="p-4 border border-border rounded-lg hover:bg-accent hover:border-primary transition-colors text-left">
              <TrendingUp className="h-6 w-6 mb-2 text-primary" />
              <p className="font-medium">Reports</p>
              <p className="text-xs text-muted-foreground">See analytics</p>
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
