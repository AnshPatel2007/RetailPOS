import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { locationService } from '@/services/api';
import { formatCurrency } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  Store,
  Users,
  DollarSign,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  Building2,
  ShoppingCart,
  Package,
  RefreshCw,
  Award,
  Target,
  Percent,
  AlertTriangle,
  Clock,
  RotateCcw,
  Wallet,
  UserPlus,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import toast from 'react-hot-toast';

interface LocationStats {
  locationId: string;
  locationName: string;
  revenue: number;
  transactions: number;
  expenses: number;
  profit: number;
  activeUsers: number;
  lowStockCount: number;
  activeShifts: number;
  pendingSales: number;
  refundCount: number;
  refundAmount: number;
  taxCollected: number;
  inventoryValue: number;
}

interface StoreDetails {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  phone: string;
  email: string;
  isActive: boolean;
  _count: {
    users: number;
    products: number;
    sales: number;
  };
  totalRevenue: number;
  todayRevenue: number;
}

interface DashboardData {
  locations: LocationStats[];
  totals: {
    totalRevenue: number;
    totalTransactions: number;
    totalExpenses: number;
    totalProfit: number;
    totalUsers: number;
    totalLowStock: number;
    totalActiveShifts: number;
    totalPendingSales: number;
    totalRefunds: number;
    totalRefundAmount: number;
    totalTaxCollected: number;
    totalInventoryValue: number;
  };
  period: number;
  globalMetrics: {
    totalCustomers: number;
    newCustomers: number;
    topProducts: any[];
    cashDiscrepancies: any[];
  };
}

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

export const AdminDashboard: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [stores, setStores] = useState<StoreDetails[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [period, setPeriod] = useState(30);

  useEffect(() => {
    loadData();
  }, [period]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [statsResponse, storesResponse] = await Promise.all([
        locationService.getCrossLocationStats(period),
        locationService.getAll(),
      ]);
      setData(statsResponse.data.data);
      setStores(storesResponse.data.data);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
      toast.error('Failed to load dashboard data');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Failed to load dashboard data</p>
        <Button onClick={loadData} className="mt-4">Retry</Button>
      </div>
    );
  }

  // Calculate additional metrics
  const avgOrderValue = data.totals.totalTransactions > 0
    ? data.totals.totalRevenue / data.totals.totalTransactions
    : 0;

  const profitMargin = data.totals.totalRevenue > 0
    ? (data.totals.totalProfit / data.totals.totalRevenue) * 100
    : 0;

  const totalTodayRevenue = stores.reduce((sum, store) => sum + store.todayRevenue, 0);
  const totalProducts = stores.reduce((sum, store) => sum + store._count.products, 0);

  // Find top performing store
  const topStore = data.locations.length > 0
    ? data.locations.reduce((max, loc) => loc.revenue > max.revenue ? loc : max)
    : null;

  // Chart data
  const revenueChartData = data.locations.map(loc => ({
    name: loc.locationName,
    revenue: loc.revenue,
    profit: loc.profit,
    expenses: loc.expenses,
  }));

  const pieChartData = data.locations.map(loc => ({
    name: loc.locationName,
    value: loc.revenue,
  }));

  // Store cards with detailed info
  const storeCards = stores.map(store => {
    const stats = data.locations.find(l => l.locationId === store.id);
    return {
      ...store,
      periodRevenue: stats?.revenue || 0,
      periodProfit: stats?.profit || 0,
      periodTransactions: stats?.transactions || 0,
      periodExpenses: stats?.expenses || 0,
    };
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Admin Dashboard</h1>
          <p className="text-muted-foreground">
            Complete overview of all stores
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadData}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          {[7, 30, 90].map((p) => (
            <Button
              key={p}
              variant={period === p ? 'primary' : 'outline'}
              size="sm"
              onClick={() => setPeriod(p)}
            >
              {p}d
            </Button>
          ))}
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col">
              <div className="flex items-center gap-2 mb-2">
                <Store className="h-4 w-4 text-primary" />
                <span className="text-xs text-muted-foreground">Stores</span>
              </div>
              <p className="text-2xl font-bold">{stores.length}</p>
              <p className="text-xs text-green-500">{stores.filter(s => s.isActive).length} active</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="h-4 w-4 text-green-500" />
                <span className="text-xs text-muted-foreground">Today</span>
              </div>
              <p className="text-2xl font-bold">{formatCurrency(totalTodayRevenue)}</p>
              <p className="text-xs text-muted-foreground">revenue</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="h-4 w-4 text-blue-500" />
                <span className="text-xs text-muted-foreground">{period}d Revenue</span>
              </div>
              <p className="text-2xl font-bold">{formatCurrency(data.totals.totalRevenue)}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col">
              <div className="flex items-center gap-2 mb-2">
                <Target className="h-4 w-4 text-emerald-600" />
                <span className="text-xs text-muted-foreground">Profit</span>
              </div>
              <p className="text-2xl font-bold">{formatCurrency(data.totals.totalProfit)}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col">
              <div className="flex items-center gap-2 mb-2">
                <TrendingDown className="h-4 w-4 text-red-500" />
                <span className="text-xs text-muted-foreground">Expenses</span>
              </div>
              <p className="text-2xl font-bold">{formatCurrency(data.totals.totalExpenses)}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col">
              <div className="flex items-center gap-2 mb-2">
                <ShoppingCart className="h-4 w-4 text-purple-500" />
                <span className="text-xs text-muted-foreground">Orders</span>
              </div>
              <p className="text-2xl font-bold">{data.totals.totalTransactions}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col">
              <div className="flex items-center gap-2 mb-2">
                <Percent className="h-4 w-4 text-amber-500" />
                <span className="text-xs text-muted-foreground">Margin</span>
              </div>
              <p className="text-2xl font-bold">{profitMargin.toFixed(1)}%</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col">
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-4 w-4 text-orange-500" />
                <span className="text-xs text-muted-foreground">Users</span>
              </div>
              <p className="text-2xl font-bold">{data.totals.totalUsers}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Additional Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Avg Order Value</p>
                <p className="text-xl font-bold">{formatCurrency(avgOrderValue)}</p>
              </div>
              <Building2 className="h-8 w-8 text-muted-foreground/30" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Products</p>
                <p className="text-xl font-bold">{totalProducts}</p>
              </div>
              <Package className="h-8 w-8 text-muted-foreground/30" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Top Store</p>
                <p className="text-xl font-bold truncate">{topStore?.locationName || 'N/A'}</p>
              </div>
              <Award className="h-8 w-8 text-amber-500/30" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Inventory Value</p>
                <p className="text-xl font-bold">{formatCurrency(data.totals.totalInventoryValue)}</p>
              </div>
              <Wallet className="h-8 w-8 text-blue-500/30" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Operational Alerts */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className={data.totals.totalLowStock > 0 ? 'border-amber-500' : ''}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Low Stock Alerts</p>
                <p className={`text-xl font-bold ${data.totals.totalLowStock > 0 ? 'text-amber-500' : ''}`}>
                  {data.totals.totalLowStock}
                </p>
              </div>
              <AlertTriangle className={`h-8 w-8 ${data.totals.totalLowStock > 0 ? 'text-amber-500' : 'text-muted-foreground/30'}`} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active Shifts</p>
                <p className="text-xl font-bold text-green-500">{data.totals.totalActiveShifts}</p>
              </div>
              <Clock className="h-8 w-8 text-green-500/30" />
            </div>
          </CardContent>
        </Card>

        <Card className={data.totals.totalPendingSales > 0 ? 'border-blue-500' : ''}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pending Sales</p>
                <p className={`text-xl font-bold ${data.totals.totalPendingSales > 0 ? 'text-blue-500' : ''}`}>
                  {data.totals.totalPendingSales}
                </p>
              </div>
              <ShoppingCart className={`h-8 w-8 ${data.totals.totalPendingSales > 0 ? 'text-blue-500' : 'text-muted-foreground/30'}`} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Refunds/Voids</p>
                <p className="text-xl font-bold text-red-500">{data.totals.totalRefunds}</p>
                <p className="text-xs text-muted-foreground">{formatCurrency(data.totals.totalRefundAmount)}</p>
              </div>
              <RotateCcw className="h-8 w-8 text-red-500/30" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Financial Health */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Tax Collected</p>
                <p className="text-xl font-bold">{formatCurrency(data.totals.totalTaxCollected)}</p>
              </div>
              <DollarSign className="h-8 w-8 text-muted-foreground/30" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Customers</p>
                <p className="text-xl font-bold">{data.globalMetrics?.totalCustomers || 0}</p>
              </div>
              <Users className="h-8 w-8 text-muted-foreground/30" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">New Customers ({period}d)</p>
                <p className="text-xl font-bold text-green-500">{data.globalMetrics?.newCustomers || 0}</p>
              </div>
              <UserPlus className="h-8 w-8 text-green-500/30" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue by Store */}
        <Card>
          <CardHeader>
            <CardTitle>Revenue & Profit by Store</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenueChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Bar dataKey="revenue" fill="#3b82f6" name="Revenue" />
                  <Bar dataKey="profit" fill="#22c55e" name="Profit" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Revenue Distribution Pie */}
        <Card>
          <CardHeader>
            <CardTitle>Revenue Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieChartData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                    labelLine={false}
                  >
                    {pieChartData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Individual Store Cards */}
      <div>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Store Details</h2>
          <Link to="/admin/stores">
            <Button variant="outline" size="sm">
              Manage Stores <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {storeCards.map((store) => {
            const margin = store.periodRevenue > 0
              ? (store.periodProfit / store.periodRevenue) * 100
              : 0;

            return (
              <Card key={store.id} className={!store.isActive ? 'opacity-60' : ''}>
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-lg">{store.name}</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {store.city}, {store.state}
                      </p>
                    </div>
                    <Badge variant={store.isActive ? 'success' : 'secondary'}>
                      {store.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Today's Revenue */}
                  <div className="flex justify-between items-center p-2 bg-green-500/10 rounded">
                    <span className="text-sm text-green-500">Today</span>
                    <span className="font-bold text-green-500">
                      {formatCurrency(store.todayRevenue)}
                    </span>
                  </div>

                  {/* Period Stats */}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Revenue:</span>
                      <span className="font-medium">{formatCurrency(store.periodRevenue)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Profit:</span>
                      <span className="font-medium text-green-500">
                        {formatCurrency(store.periodProfit)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Expenses:</span>
                      <span className="font-medium text-red-500">
                        {formatCurrency(store.periodExpenses)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Margin:</span>
                      <span className={`font-medium ${margin >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {margin.toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  {/* Counts */}
                  <div className="flex justify-between pt-2 border-t text-sm">
                    <div className="text-center">
                      <p className="font-bold">{store.periodTransactions}</p>
                      <p className="text-xs text-muted-foreground">Orders</p>
                    </div>
                    <div className="text-center">
                      <p className="font-bold">{store._count.products}</p>
                      <p className="text-xs text-muted-foreground">Products</p>
                    </div>
                    <div className="text-center">
                      <p className="font-bold">{store._count.users}</p>
                      <p className="text-xs text-muted-foreground">Users</p>
                    </div>
                    <div className="text-center">
                      <p className="font-bold">{store.totalRevenue > 0 ? formatCurrency(store.totalRevenue) : '$0'}</p>
                      <p className="text-xs text-muted-foreground">All Time</p>
                    </div>
                  </div>

                  {/* Contact Info */}
                  <div className="text-xs text-muted-foreground pt-2 border-t">
                    <p>{store.phone}</p>
                    <p>{store.email}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Performance Comparison Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Performance Comparison</CardTitle>
          <Link to="/admin/reports">
            <Button variant="outline" size="sm">
              Full Reports <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-medium">Store</th>
                  <th className="text-right py-3 px-4 font-medium">Revenue</th>
                  <th className="text-right py-3 px-4 font-medium">Expenses</th>
                  <th className="text-right py-3 px-4 font-medium">Profit</th>
                  <th className="text-right py-3 px-4 font-medium">Margin</th>
                  <th className="text-right py-3 px-4 font-medium">Orders</th>
                  <th className="text-right py-3 px-4 font-medium">Avg Order</th>
                  <th className="text-right py-3 px-4 font-medium">Users</th>
                </tr>
              </thead>
              <tbody>
                {data.locations.map((loc, index) => {
                  const margin = loc.revenue > 0 ? (loc.profit / loc.revenue) * 100 : 0;
                  const avgOrder = loc.transactions > 0 ? loc.revenue / loc.transactions : 0;

                  return (
                    <tr key={loc.locationId} className="border-b hover:bg-accent/50">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          {index === 0 && <Award className="h-4 w-4 text-amber-500" />}
                          <span className="font-medium">{loc.locationName}</span>
                        </div>
                      </td>
                      <td className="text-right py-3 px-4 text-green-500 font-medium">
                        {formatCurrency(loc.revenue)}
                      </td>
                      <td className="text-right py-3 px-4 text-red-500">
                        {formatCurrency(loc.expenses)}
                      </td>
                      <td className="text-right py-3 px-4 font-medium">
                        {formatCurrency(loc.profit)}
                      </td>
                      <td className="text-right py-3 px-4">
                        <span className={margin >= 20 ? 'text-green-500' : margin >= 10 ? 'text-amber-500' : 'text-red-500'}>
                          {margin.toFixed(1)}%
                        </span>
                      </td>
                      <td className="text-right py-3 px-4">{loc.transactions}</td>
                      <td className="text-right py-3 px-4">{formatCurrency(avgOrder)}</td>
                      <td className="text-right py-3 px-4">{loc.activeUsers}</td>
                    </tr>
                  );
                })}
                {/* Totals Row */}
                <tr className="bg-muted/50 font-bold">
                  <td className="py-3 px-4">TOTAL</td>
                  <td className="text-right py-3 px-4 text-green-500">
                    {formatCurrency(data.totals.totalRevenue)}
                  </td>
                  <td className="text-right py-3 px-4 text-red-500">
                    {formatCurrency(data.totals.totalExpenses)}
                  </td>
                  <td className="text-right py-3 px-4">
                    {formatCurrency(data.totals.totalProfit)}
                  </td>
                  <td className="text-right py-3 px-4">
                    {profitMargin.toFixed(1)}%
                  </td>
                  <td className="text-right py-3 px-4">{data.totals.totalTransactions}</td>
                  <td className="text-right py-3 px-4">{formatCurrency(avgOrderValue)}</td>
                  <td className="text-right py-3 px-4">{data.totals.totalUsers}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
