import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { reportService } from '@/services/api';
import { DashboardMetrics } from '@/types';
import { formatCurrency } from '@/lib/utils';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
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
} from 'lucide-react';

interface DashboardData extends DashboardMetrics {
  yesterdaySales?: number;
  todayTrend?: number;
  prevWeekSales?: number;
  weekTrend?: number;
}

interface HourlyEntry { hour: number; label: string; total: number; }
interface TopProduct { productId: string; name: string; qty: number; revenue: number; }
interface ActiveShift { id: string; employeeName: string; clockInAt: string; totalSales: number; totalTransactions: number; }

const REFRESH_INTERVAL_MS = 30_000;

const TrendBadge = ({ trend }: { trend?: number }) => {
  if (trend === undefined || trend === null) return null;
  const up = trend >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${up ? 'text-green-500' : 'text-red-500'}`}>
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {up ? '+' : ''}{trend}%
    </span>
  );
};

const elapsedTime = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
};

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [metrics, setMetrics] = useState<DashboardData | null>(null);
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
      setHourlyData(hourly.hourlyData || []);
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

  // Initial load
  useEffect(() => { loadMetrics(); }, [loadMetrics]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => loadMetrics(true), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadMetrics]);

  // Tick "last updated X seconds ago"
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
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-1/4"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-32 bg-muted rounded"></div>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="h-48 bg-muted rounded"></div>
            <div className="h-48 bg-muted rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  const stats = [
    {
      title: "Today's Sales",
      value: formatCurrency(metrics?.todaySales || 0),
      subtitle: `${metrics?.todayTransactions || 0} transactions`,
      trend: metrics?.todayTrend,
      trendLabel: 'vs yesterday',
      icon: DollarSign,
      color: 'text-green-500',
      bgColor: 'bg-green-500/10',
    },
    {
      title: 'Week Sales',
      value: formatCurrency(metrics?.weekSales || 0),
      subtitle: 'Last 7 days',
      trend: metrics?.weekTrend,
      trendLabel: 'vs prev week',
      icon: TrendingUp,
      color: 'text-blue-500',
      bgColor: 'bg-blue-500/10',
    },
    {
      title: 'Month Sales',
      value: formatCurrency(metrics?.monthSales || 0),
      subtitle: 'Last 30 days',
      trend: undefined,
      trendLabel: '',
      icon: ShoppingCart,
      color: 'text-purple-500',
      bgColor: 'bg-purple-500/10',
    },
    {
      title: 'Avg Order Value',
      value: formatCurrency(metrics?.averageOrderValue || 0),
      subtitle: 'Per transaction today',
      trend: undefined,
      trendLabel: '',
      icon: DollarSign,
      color: 'text-indigo-500',
      bgColor: 'bg-indigo-500/10',
    },
  ];

  const secondaryStats = [
    {
      title: 'Total Customers',
      value: metrics?.totalCustomers || 0,
      icon: Users,
      color: 'text-cyan-500',
      bgColor: 'bg-cyan-500/10',
    },
    {
      title: 'Active Employees',
      value: metrics?.activeEmployees || 0,
      icon: Users,
      color: 'text-teal-500',
      bgColor: 'bg-teal-500/10',
    },
    {
      title: 'Low Stock Items',
      value: metrics?.lowStockProducts || 0,
      icon: AlertTriangle,
      color: 'text-orange-500',
      bgColor: 'bg-orange-500/10',
      onClick: () => navigate('/inventory'),
    },
  ];

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Dashboard</h1>
          <p className="text-muted-foreground">
            Welcome back! Here's what's happening today.
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

      {/* Main KPI stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
        {stats.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <Card key={index}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-muted-foreground mb-1">
                      {stat.title}
                    </p>
                    <h3 className="text-2xl font-bold truncate">{stat.value}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-xs text-muted-foreground">{stat.subtitle}</p>
                      {stat.trend !== undefined && (
                        <TrendBadge trend={stat.trend} />
                      )}
                    </div>
                    {stat.trendLabel && stat.trend !== undefined && (
                      <p className="text-xs text-muted-foreground mt-0.5">{stat.trendLabel}</p>
                    )}
                  </div>
                  <div className={`p-3 rounded-full ${stat.bgColor} ml-3 shrink-0`}>
                    <Icon className={`h-6 w-6 ${stat.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Hourly sales chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sales Last 12 Hours</CardTitle>
          </CardHeader>
          <CardContent>
            {hourlyData.length === 0 ? (
              <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">
                No sales data yet today
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={hourlyData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                  <Tooltip
                    formatter={(value: number) => [formatCurrency(value), 'Sales']}
                    labelFormatter={(label) => `Hour: ${label}`}
                  />
                  <Bar dataKey="total" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
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
              <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">
                No sales yet today
              </div>
            ) : (
              <div className="space-y-3">
                {topProducts.map((p, i) => (
                  <div key={p.productId} className="flex items-center gap-3">
                    <span className="text-sm font-bold text-muted-foreground w-5 text-right">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground">{p.qty} sold</p>
                    </div>
                    <span className="text-sm font-bold text-primary">{formatCurrency(p.revenue)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bottom row: secondary stats + active shifts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Secondary KPI cards */}
        {secondaryStats.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <div
              key={index}
              role={stat.onClick ? 'button' : undefined}
              tabIndex={stat.onClick ? 0 : undefined}
              onClick={stat.onClick}
              onKeyDown={stat.onClick ? (e) => { if (e.key === 'Enter') stat.onClick?.(); } : undefined}
              className={stat.onClick ? 'cursor-pointer' : ''}
            >
              <Card className={stat.onClick ? 'hover:border-primary transition-colors' : ''}>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-1">
                        {stat.title}
                      </p>
                      <h3 className="text-3xl font-bold">{stat.value}</h3>
                    </div>
                    <div className={`p-3 rounded-full ${stat.bgColor}`}>
                      <Icon className={`h-6 w-6 ${stat.color}`} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          );
        })}
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
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <button onClick={() => navigate('/pos')} className="p-4 border border-border rounded-md hover:bg-accent transition-colors text-left">
              <ShoppingCart className="h-6 w-6 mb-2 text-primary" />
              <p className="font-medium">New Sale</p>
              <p className="text-xs text-muted-foreground">Start checkout</p>
            </button>
            <button onClick={() => navigate('/inventory')} className="p-4 border border-border rounded-md hover:bg-accent transition-colors text-left">
              <Package className="h-6 w-6 mb-2 text-primary" />
              <p className="font-medium">Add Product</p>
              <p className="text-xs text-muted-foreground">Manage inventory</p>
            </button>
            <button onClick={() => navigate('/customers')} className="p-4 border border-border rounded-md hover:bg-accent transition-colors text-left">
              <Users className="h-6 w-6 mb-2 text-primary" />
              <p className="font-medium">New Customer</p>
              <p className="text-xs text-muted-foreground">Add to directory</p>
            </button>
            <button onClick={() => navigate('/reports')} className="p-4 border border-border rounded-md hover:bg-accent transition-colors text-left">
              <TrendingUp className="h-6 w-6 mb-2 text-primary" />
              <p className="font-medium">View Reports</p>
              <p className="text-xs text-muted-foreground">See analytics</p>
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
