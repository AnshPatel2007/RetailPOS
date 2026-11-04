import { ManagementPage, SummaryStrip } from '@/components/common/Workspace';
import { Select } from '@/components/ui/Select';
import { ForecastPanel, type ForecastData } from '@/components/analytics/ForecastPanel';
import { InventoryPurchaseSummary } from '@/components/financial/InventoryPurchaseSummary';
import React, { useState, useEffect } from 'react';
import {
  TrendingUp,
  DollarSign,
  Star,
  AlertTriangle,
  HelpCircle,
  ArrowUpRight,
  ArrowDownRight,
  Brain,
  Zap,
  Gift,
  Trophy,
  Calculator,
  ShoppingBag,
  Award,
  Medal,
  Sparkles,
} from 'lucide-react';
import {
  Line,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  AreaChart,
  Area,
} from 'recharts';
import { api } from '../services/api';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { PageHeader } from '@/components/common/PageHeader';
import { StoreFilterSelect } from '@/components/common/StoreFilterSelect';
import { PageTabs } from '@/components/common/PageTabs';
import { AutoRefreshStatus } from '@/components/common/AutoRefreshStatus';
import { useAuthStore } from '@/store/authStore';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Pagination } from '@/components/common/Pagination';
import { Badge } from '@/components/ui/Badge';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/Table';

export type AnalysisView = 'overview' | 'inventory' | 'products' | 'forecast' | 'predictions' | 'anomalies' | 'bundles' | 'employees' | 'health' | 'whatif';
export const Analytics: React.FC<{ view?: AnalysisView }> = ({ view }) => {
  const role = useAuthStore(state => state.user?.role);
  const [selectedTab, setActiveTab] = useState<AnalysisView>('overview');
  const activeTab = view || selectedTab;
  const [abcDays, setAbcDays] = useState('90'), [abcPage, setAbcPage] = useState(1);
  const [inventoryPage, setInventoryPage] = useState(1), [forecastDays, setForecastDays] = useState('30'), [employeeDays, setEmployeeDays] = useState('30');
  const [locationId, setLocationId] = useState('');
  const [whatIfInputs, setWhatIfInputs] = useState({ priceChange: 0, costChange: 0, volumeChange: 0 });
  const [simulation, setSimulation] = useState<typeof whatIfInputs | null>(null);
  const query = useScopedQuery<any>(['analytics', activeTab, locationId,
    activeTab === 'inventory' ? [abcDays, abcPage] : activeTab === 'predictions' ? inventoryPage : activeTab === 'forecast' ? forecastDays : activeTab === 'employees' ? employeeDays : activeTab === 'whatif' ? simulation : null], async signal => {
    const params: Record<string, unknown> = { locationId: locationId || undefined };
    if (activeTab === 'overview') {
      const [comparison, realtime] = await Promise.all([api.get('/analytics/comparison', { params, signal }), api.get('/analytics/realtime', { params, signal })]);
      return { comparison: comparison.data.data, realtime: realtime.data.data };
    }
    const paths = { inventory: 'abc-analysis', products: 'product-matrix', forecast: 'forecast', predictions: 'inventory-predictions', anomalies: 'anomalies', bundles: 'bundle-recommendations', employees: 'employee-performance', health: 'business-health' };
    if (activeTab === 'whatif') return (await api.post('/analytics/what-if', { ...simulation, ...params }, { signal })).data.data;
    if (activeTab === 'inventory') Object.assign(params, { days: abcDays, page: abcPage });
    if (activeTab === 'predictions') params.page = inventoryPage;
    if (activeTab === 'forecast') params.forecastDays = forecastDays;
    if (activeTab === 'employees') params.days = employeeDays;
    return (await api.get('/analytics/' + paths[activeTab as keyof typeof paths], { params, signal })).data.data;
  }, activeTab !== 'whatif' || !!simulation, 30000, { autoRefresh: activeTab !== 'whatif' });
  const comparisonData = activeTab === 'overview' ? query.data?.comparison : null, realtimeData = activeTab === 'overview' ? query.data?.realtime : null;
  const abcData = activeTab === 'inventory' ? query.data : null, matrixData = activeTab === 'products' ? query.data : null;
  const forecastData: ForecastData | null = activeTab === 'forecast' ? query.data : null;
  const inventoryPredictions = activeTab === 'predictions' ? query.data : null, anomaliesData = activeTab === 'anomalies' ? query.data : null;
  const bundlesData = activeTab === 'bundles' ? query.data : null, employeeData = activeTab === 'employees' ? query.data : null;
  const healthData = activeTab === 'health' ? query.data : null, whatIfData = activeTab === 'whatif' ? query.data : null;
  const loadError = query.stale ? '' : query.error, loading = query.loading && !query.data, forecastRefreshing = query.loading;
  const fetchAllData = query.refresh;
  const fetchABC = (days: string) => { setAbcDays(days); setAbcPage(1); };
  const fetchForecast = (days: string) => setForecastDays(days);
  const fetchEmployeePerformance = (days: string) => setEmployeeDays(days);
  const fetchWhatIfAnalysis = () => { setSimulation({ ...whatIfInputs }); query.refresh(); };
  useEffect(() => { setInventoryPage(1); setAbcPage(1); setSimulation(null); }, [locationId]);

  const formatCurrency = (value: number | null | undefined) => {
    if (value == null || !Number.isFinite(value)) return 'Unavailable';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatPercent = (value: number | null | undefined) => {
    if (value == null || !Number.isFinite(value)) return 'Unavailable';
    return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
  };

  const GrowthIndicator = ({ value }: { value: number | null }) => {
    if (value === null) return <span className="text-sm text-muted-foreground" title="No sales in the earlier period to compare with">New · no earlier sales</span>;
    if (value > 0) {
      return (
        <span className="flex items-center text-success text-sm">
          <ArrowUpRight className="w-4 h-4" />
          {formatPercent(value)}
        </span>
      );
    } else if (value < 0) {
      return (
        <span className="flex items-center text-destructive text-sm">
          <ArrowDownRight className="w-4 h-4" />
          {formatPercent(value)}
        </span>
      );
    }
    return <span className="text-muted-foreground text-sm">0%</span>;
  };

  return (
    <ManagementPage className="">
      <PageHeader title="Analytics"
        tabs={!view && <PageTabs label="Analytics views" value={activeTab} onChange={id => setActiveTab(id as AnalysisView)} items={[
          { id: 'overview', label: 'Comparison' }, { id: 'health', label: 'Business Health' },
          { id: 'inventory', label: 'ABC Analysis' }, { id: 'products', label: 'Product Matrix' },
          { id: 'forecast', label: 'Forecast' }, { id: 'predictions', label: 'Inventory Planning' },
          { id: 'anomalies', label: 'Anomalies' }, { id: 'bundles', label: 'Bundles' },
          { id: 'employees', label: 'Employee Performance' },
        ]} />}
        toolbar={role === 'SUPER_ADMIN' ? <StoreFilterSelect value={locationId} onChange={setLocationId} /> : undefined}
      />
      {loading && <p role="status" className="mb-4 text-muted-foreground">Loading analysis...</p>}
      {query.refreshing && <span className="sr-only" role="status">Updating analysis</span>}

      <AutoRefreshStatus state={query} />
      {/* Live figures share the same compact hierarchy as reports. */}
      {activeTab === 'overview' && realtimeData && <SummaryStrip className="mb-6" items={[
        { label: "Today's Revenue", value: formatCurrency(realtimeData.today.revenue), detail: (realtimeData.today.transactions ?? 'Unavailable') + ' transactions' },
        { label: 'Last Hour', value: formatCurrency(realtimeData.lastHour.revenue), detail: (realtimeData.lastHour.transactions ?? 'Unavailable') + ' sales' },
        { label: 'Avg Order Value', value: formatCurrency(realtimeData.today.avgOrderValue) },
        { label: 'Alerts', value: realtimeData.alerts.lowStockItems, detail: 'Low stock items', tone: realtimeData.alerts.lowStockItems > 0 ? 'warning' : 'default' },
      ]} />}

      {loadError && <div role="alert" className="rounded border border-destructive p-3 mb-4"><p>{loadError}</p><Button variant="outline" onClick={fetchAllData}>Retry</Button></div>}


      {/* Comparison Analytics Tab */}
      {activeTab === 'overview' && comparisonData && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Daily Comparison */}
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Daily Performance</h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Today</span>
                  <span className="font-bold text-xl">{formatCurrency(comparisonData.daily.current.revenue)}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span>vs Yesterday</span>
                  <GrowthIndicator value={comparisonData.daily.growthVsPrevious} />
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span>vs Same Day Last Year</span>
                  <GrowthIndicator value={comparisonData.daily.growthVsLastYear} />
                </div>
                <div className="pt-2 border-t">
                  <p className="text-sm text-muted-foreground">
                    {comparisonData.daily.current.transactions ?? 'Unavailable'} transactions today
                  </p>
                </div>
              </div>
            </Card>

            {/* Weekly Comparison */}
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Weekly Performance</h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">This Week</span>
                  <span className="font-bold text-xl">{formatCurrency(comparisonData.weekly.current.revenue)}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span>vs Last Week</span>
                  <GrowthIndicator value={comparisonData.weekly.growthVsPrevious} />
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span>vs Same Week Last Year</span>
                  <GrowthIndicator value={comparisonData.weekly.growthVsLastYear} />
                </div>
                <div className="pt-2 border-t">
                  <p className="text-sm text-muted-foreground">
                    {comparisonData.weekly.current.transactions ?? 'Unavailable'} transactions this week
                  </p>
                </div>
              </div>
            </Card>

            {/* Monthly Comparison */}
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Monthly Performance</h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">This Month</span>
                  <span className="font-bold text-xl">{formatCurrency(comparisonData.monthly.current.revenue)}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span>vs Last Month</span>
                  <GrowthIndicator value={comparisonData.monthly.growthVsPrevious} />
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span>vs Same Month Last Year</span>
                  <GrowthIndicator value={comparisonData.monthly.growthVsLastYear} />
                </div>
                <div className="pt-2 border-t">
                  <p className="text-sm text-muted-foreground">
                    Profit: {formatCurrency(comparisonData.monthly.current.profit)}
                  </p>
                </div>
              </div>
            </Card>

            {/* Yearly Comparison */}
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Yearly Performance</h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">This Year</span>
                  <span className="font-bold text-xl">{formatCurrency(comparisonData.yearly.current.revenue)}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span>vs Last Year</span>
                  <GrowthIndicator value={comparisonData.yearly.growthVsPrevious} />
                </div>
                <div className="pt-2 border-t">
                  <p className="text-sm text-muted-foreground">
                    {comparisonData.yearly.current.transactions ?? 'Unavailable'} transactions YTD
                  </p>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ABC Inventory Analysis Tab */}
      {activeTab === 'inventory' && abcData && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-semibold">ABC Inventory Analysis</h3>
              <p className="text-sm text-muted-foreground">
                Classify products by revenue contribution
              </p>
              <p className="text-sm text-muted-foreground">{abcData.basis} {abcData.period?.timezone}</p>
              {!!abcData.summary.unranked?.count && <p className="text-sm">{abcData.summary.unranked.count} products remain unranked.</p>}
            </div>
            <Select
              value={abcDays}
              onChange={(e) => {
                setAbcDays(e.target.value);
                fetchABC(e.target.value);
              }}
              className="px-3 py-2 border border-input rounded-md bg-background text-foreground"
            >
              <option value="30">Last 30 days</option>
              <option value="60">Last 60 days</option>
              <option value="90">Last 90 days</option>
              <option value="180">Last 180 days</option>
            </Select>
          </div>

          {/* Summary */}
          <SummaryStrip items={[
            { label: 'Class A · Stars', value: `${abcData.summary.classA.count} products`, tone: 'success', detail: `${abcData.summary.classA.revenuePercentage == null ? '—' : abcData.summary.classA.revenuePercentage.toFixed(0) + '%'} of positive net collections (${abcData.summary.classA.percentage.toFixed(0)}% of items)` },
            { label: 'Class B · Stable', value: `${abcData.summary.classB.count} products`, tone: 'warning', detail: `${abcData.summary.classB.revenuePercentage == null ? '—' : abcData.summary.classB.revenuePercentage.toFixed(0) + '%'} of positive net collections (${abcData.summary.classB.percentage.toFixed(0)}% of items)` },
            { label: 'Class C · Slow', value: `${abcData.summary.classC.count} products`, tone: 'danger', detail: `${abcData.summary.classC.revenuePercentage == null ? '—' : abcData.summary.classC.revenuePercentage.toFixed(0) + '%'} of positive net collections (${abcData.summary.classC.percentage.toFixed(0)}% of items)` },
          ]} />

          {/* Pareto Chart */}
          <Card className="p-6">
            <h4 className="font-medium mb-4">Revenue Distribution (Pareto)</h4>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={abcData.pareto || abcData.products.slice(0, 30)}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={false} />
                  <YAxis yAxisId="left" />
                  <YAxis yAxisId="right" orientation="right" domain={[0, 100]} />
                  <Tooltip
                    formatter={(value: any, name: string) =>
                      name === 'cumulative' ? `${value.toFixed(1)}%` : formatCurrency(value)
                    }
                  />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="revenue"
                    fill="#3b82f6"
                    stroke="#3b82f6"
                    name="Revenue"
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="cumulativePercentage"
                    stroke="#ef4444"
                    name="cumulative"
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Product List */}
          <Card>
            <Table scrollLabel="Analytics records">
              <TableHeader>
                <TableRow>
                  <TableHead>Class</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Revenue</TableHead>
                  <TableHead>% of Total</TableHead>
                  <TableHead>Quantity</TableHead>
                  <TableHead>Stock</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {abcData.products.map((product: any) => (
                  <TableRow key={product.id}>
                    <TableCell>
                      <Badge
                        variant={
                          product.classification === 'A' ? 'success' :
                          product.classification === 'B' ? 'warning' : 'destructive'
                        }
                      >
                        {product.classification}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">{product.name}</TableCell>
                    <TableCell className="text-muted-foreground">{product.sku}</TableCell>
                    <TableCell>{formatCurrency(product.revenue)}</TableCell>
                    <TableCell>{product.revenuePercentage == null ? 'Unavailable' : product.revenuePercentage.toFixed(1) + '%'}</TableCell>
                    <TableCell>{product.quantity}</TableCell>
                    <TableCell>{product.stockQuantity}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination page={abcData.pagination.page} totalPages={abcData.pagination.totalPages} onPageChange={setAbcPage} totalItems={abcData.pagination.total} itemName="products" />
          </Card>
        </div>
      )}

      {/* Product Performance Matrix Tab */}
      {activeTab === 'products' && matrixData && (
        <div className="space-y-6">
          {matrixData.unavailableCount > 0 && <p role="status" className="text-sm text-muted-foreground">{matrixData.unavailableCount} products have unavailable historical margin and are excluded from the performance quadrants.</p>}
          <div>
            <h3 className="text-lg font-semibold">Product Performance Matrix</h3>
            <p className="text-sm text-muted-foreground">
              Classify products by sales velocity and profit margin
            </p>
          </div>

          {/* Quadrant Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="p-4 border-t-4 border-t-green-500">
              <div className="flex items-center gap-2 mb-2">
                <Star className="w-5 h-5 text-success" />
                <h4 className="font-semibold text-success">Stars ({matrixData.quadrants.star.count})</h4>
              </div>
              <p className="text-xs text-muted-foreground mb-3">{matrixData.quadrants.star.description}</p>
              <div className="space-y-2">
                {matrixData.quadrants.star.products.slice(0, 5).map((product: any) => (
                  <div key={product.id} className="flex justify-between text-sm">
                    <span className="truncate">{product.name}</span>
                    <span className="font-medium">{formatCurrency(product.revenue)}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-4 border-t-4 border-t-blue-500">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="w-5 h-5 text-info" />
                <h4 className="font-semibold text-info">Cash Cows ({matrixData.quadrants.cash_cow.count})</h4>
              </div>
              <p className="text-xs text-muted-foreground mb-3">{matrixData.quadrants.cash_cow.description}</p>
              <div className="space-y-2">
                {matrixData.quadrants.cash_cow.products.slice(0, 5).map((product: any) => (
                  <div key={product.id} className="flex justify-between text-sm">
                    <span className="truncate">{product.name}</span>
                    <span className="font-medium">{formatCurrency(product.revenue)}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-4 border-t-4 border-t-yellow-500">
              <div className="flex items-center gap-2 mb-2">
                <HelpCircle className="w-5 h-5 text-warning" />
                <h4 className="font-semibold text-warning">Question Marks ({matrixData.quadrants.question_mark.count})</h4>
              </div>
              <p className="text-xs text-muted-foreground mb-3">{matrixData.quadrants.question_mark.description}</p>
              <div className="space-y-2">
                {matrixData.quadrants.question_mark.products.slice(0, 5).map((product: any) => (
                  <div key={product.id} className="flex justify-between text-sm">
                    <span className="truncate">{product.name}</span>
                    <span className="font-medium">{formatCurrency(product.revenue)}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-4 border-t-4 border-t-red-500">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-5 h-5 text-destructive" />
                <h4 className="font-semibold text-destructive">Dogs ({matrixData.quadrants.dog.count})</h4>
              </div>
              <p className="text-xs text-muted-foreground mb-3">{matrixData.quadrants.dog.description}</p>
              <div className="space-y-2">
                {matrixData.quadrants.dog.products.slice(0, 5).map((product: any) => (
                  <div key={product.id} className="flex justify-between text-sm">
                    <span className="truncate">{product.name}</span>
                    <span className="font-medium">{formatCurrency(product.revenue)}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Scatter Plot */}
          <Card className="p-6">
            <h4 className="font-medium mb-4">Product Matrix Visualization</h4>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    dataKey="velocity"
                    name="Velocity"
                    label={{ value: 'Sales Velocity (units/day)', position: 'bottom' }}
                  />
                  <YAxis
                    type="number"
                    dataKey="margin"
                    name="Margin"
                    label={{ value: 'Profit Margin (%)', angle: -90, position: 'left' }}
                  />
                  <Tooltip
                    content={({ payload }) => {
                      if (payload && payload.length) {
                        const data = payload[0].payload;
                        return (
                          <div className="bg-background border rounded p-2 text-sm">
                            <p className="font-medium">{data.name}</p>
                            <p>Velocity: {data.velocity.toFixed(2)} /day</p>
                            <p>Margin: {data.margin.toFixed(1)}%</p>
                            <p>Revenue: {formatCurrency(data.revenue)}</p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Scatter
                    data={matrixData.products.filter((p: any) => p.margin !== null)}
                    fill="#3b82f6"
                  >
                    {matrixData.products.filter((p: any) => p.margin !== null).map((entry: any, index: number) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={
                          entry.quadrant === 'star' ? '#10b981' :
                          entry.quadrant === 'cash_cow' ? '#3b82f6' :
                          entry.quadrant === 'question_mark' ? '#f59e0b' : '#ef4444'
                        }
                      />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-center gap-4 mt-4 text-sm">
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-success rounded-full"></span> Stars</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-info rounded-full"></span> Cash Cows</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-warning rounded-full"></span> Question Marks</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-destructive rounded-full"></span> Dogs</span>
            </div>
          </Card>
        </div>
      )}

      {activeTab === 'forecast' && <ForecastPanel data={forecastData} days={forecastDays} refreshing={forecastRefreshing}
        onDaysChange={days => { setForecastDays(days); void fetchForecast(days); }} />}

      {/* Business Health Dashboard Tab */}
      {activeTab === 'health' && healthData && (
        <div className="space-y-6">
          {healthData.profitability.unavailableReason && <p role="status" className="text-sm text-muted-foreground">{healthData.profitability.unavailableReason}</p>}
          <p className="text-sm text-muted-foreground">{healthData.healthScoreBasis} {healthData.projectionBasis}</p>
          <div>
            <h3 className="text-lg font-semibold">Business Health Dashboard</h3>
            <p className="text-sm text-muted-foreground">
              Real-time P&L, KPIs, and overall health scores
            </p>
          </div>

          {/* Health Score */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <Card className="p-4 col-span-2 sm:col-span-1">
              <div className="text-center">
                <p className="text-sm text-muted-foreground mb-2">Overall Health</p>
                <div className={`${healthData.healthScores.overall == null ? 'text-lg text-muted-foreground' : 'text-4xl'} font-bold ${
                  healthData.healthScores.overall == null ? '' : healthData.healthScores.overall >= 70 ? 'text-success' :
                  healthData.healthScores.overall >= 40 ? 'text-warning' : 'text-destructive'
                }`}>
                  {healthData.healthScores.overall ?? 'Unavailable'}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{healthData.healthScores.overall == null ? 'More history needed' : 'out of 100'}</p>
              </div>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Revenue Score</p>
              <p className={healthData.healthScores.revenue == null ? "text-lg font-medium text-muted-foreground" : "text-2xl font-bold"}>{healthData.healthScores.revenue ?? 'Unavailable'}</p>
              <div className="w-full bg-muted rounded-full h-2 mt-2">
                <div className="bg-info h-2 rounded-full" style={{ width: `${healthData.healthScores.revenue ?? 0}%` }}></div>
              </div>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Profitability</p>
              <p className={healthData.healthScores.profitability == null ? "text-lg font-medium text-muted-foreground" : "text-2xl font-bold"}>{healthData.healthScores.profitability ?? 'Unavailable'}</p>
              <div className="w-full bg-muted rounded-full h-2 mt-2">
                <div className="bg-success h-2 rounded-full" style={{ width: `${healthData.healthScores.profitability ?? 0}%` }}></div>
              </div>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Inventory</p>
              <p className={healthData.healthScores.inventory == null ? "text-lg font-medium text-muted-foreground" : "text-2xl font-bold"}>{healthData.healthScores.inventory ?? 'Unavailable'}</p>
              <div className="w-full bg-muted rounded-full h-2 mt-2">
                <div className="bg-primary h-2 rounded-full" style={{ width: `${healthData.healthScores.inventory ?? 0}%` }}></div>
              </div>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Growth</p>
              <p className={healthData.healthScores.growth == null ? "text-lg font-medium text-muted-foreground" : "text-2xl font-bold"}>{healthData.healthScores.growth ?? 'Unavailable'}</p>
              <div className="w-full bg-muted rounded-full h-2 mt-2">
                <div className="bg-warning h-2 rounded-full" style={{ width: `${healthData.healthScores.growth ?? 0}%` }}></div>
              </div>
            </Card>
          </div>

          {/* Revenue Overview */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Today's Revenue</p>
              <p className="text-2xl font-bold">{formatCurrency(healthData.overview.todayRevenue)}</p>
              <p className="text-xs text-muted-foreground">{healthData.overview.todayTransactions} transactions</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Month Revenue</p>
              <p className="text-2xl font-bold">{formatCurrency(healthData.overview.monthRevenue)}</p>
              <p className="text-xs text-muted-foreground">{healthData.overview.monthTransactions} transactions</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Year Revenue</p>
              <p className="text-2xl font-bold">{formatCurrency(healthData.overview.yearRevenue)}</p>
              <p className="text-xs text-muted-foreground">{healthData.overview.yearTransactions} transactions</p>
            </Card>
          </div>

          {/* Profitability */}
          <Card className="p-6">
            <h4 className="font-medium mb-4">Monthly P&L</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span>Net sales, excluding tax</span>
                  <span className="font-medium">{formatCurrency(healthData.profitability.grossRevenue)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>- Cost of goods sold (recorded)</span>
                  <span>{formatCurrency(healthData.profitability.costOfGoodsSold)}</span>
                </div>
                <div className="flex justify-between border-t pt-2">
                  <span>Gross Profit</span>
                  <span className={`font-medium ${healthData.profitability.grossProfit == null ? 'text-muted-foreground' : healthData.profitability.grossProfit >= 0 ? 'text-success' : 'text-destructive'}`}>{formatCurrency(healthData.profitability.grossProfit)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>- Operating Expenses</span>
                  <span>{formatCurrency(healthData.profitability.expenses)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>+ Other income</span>
                  <span>{formatCurrency(healthData.profitability.otherIncome)}</span>
                </div>
                <div className="flex justify-between border-t pt-2 text-lg">
                  <span className="font-semibold">Net Profit</span>
                  <span className={`font-bold ${healthData.profitability.netProfit == null ? 'text-muted-foreground' : healthData.profitability.netProfit >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {formatCurrency(healthData.profitability.netProfit)}
                  </span>
                </div>
                <InventoryPurchaseSummary received={healthData.profitability.receivedInventoryPurchases} purchaseEntries={healthData.profitability.inventoryPurchases} />
              </div>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span>Gross Margin</span>
                  <span className="font-medium">{formatPercent(healthData.profitability.grossMargin)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Net Margin</span>
                  <span className="font-medium">{formatPercent(healthData.profitability.netMargin)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Revenue Growth</span>
                  <GrowthIndicator value={healthData.kpis.revenueGrowth} />
                </div>
                <div className="flex justify-between">
                  <span>Avg Transaction</span>
                  <span className="font-medium">{formatCurrency(healthData.kpis.avgTransactionValue)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Projected Monthly</span>
                  <span className="font-medium">{formatCurrency(healthData.kpis.projectedMonthlyRevenue)}</span>
                </div>
              </div>
            </div>
          </Card>

          {/* KPIs and Cash Flow */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="p-6">
              <h4 className="font-medium mb-4">Inventory Health</h4>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span>Total Units</span>
                  <span className="font-medium">{healthData.inventory.totalUnits.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Value at Cost</span>
                  <span className="font-medium">{healthData.inventory.valueAtCost == null ? 'Unavailable' : formatCurrency(healthData.inventory.valueAtCost)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Value at Retail</span>
                  <span className="font-medium">{formatCurrency(healthData.inventory.valueAtRetail)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Potential Profit</span>
                  <span className="font-medium text-success">{formatCurrency(healthData.inventory.potentialProfit)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Turnover Ratio</span>
                  <span className="font-medium">{healthData.inventory.turnoverRatio == null ? 'Unavailable' : healthData.inventory.turnoverRatio.toFixed(2) + 'x'}</span>
                </div>
              </div>
            </Card>
            <Card className="p-6">
              <h4 className="font-medium mb-4">Cash Flow</h4>
              {healthData.cashFlow.unavailableReason && <p className="text-sm text-muted-foreground mb-3">{healthData.cashFlow.unavailableReason}</p>}
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span>Cash Inflows</span>
                  <span className="font-medium text-success">{formatCurrency(healthData.cashFlow.inflows)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Cash Outflows</span>
                  <span className="font-medium text-destructive">{formatCurrency(healthData.cashFlow.outflows)}</span>
                </div>
                <div className="flex justify-between border-t pt-2">
                  <span className="font-semibold">Net Cash Flow</span>
                  <span className={`font-bold ${healthData.cashFlow.netCashFlow >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {formatCurrency(healthData.cashFlow.netCashFlow)}
                  </span>
                </div>
                <div className="mt-4 p-3 bg-muted rounded">
                  <p className="text-sm">
                    <span className="font-medium">Break-even Progress: </span>
                    {healthData.kpis.breakEvenProgress == null ? 'Unavailable' : healthData.kpis.breakEvenProgress + '%'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">{healthData.kpis.breakEvenReason}</p>
                  <div className="w-full bg-background rounded-full h-2 mt-2">
                    <div
                      className={`h-2 rounded-full ${healthData.kpis.breakEvenProgress >= 100 ? 'bg-success' : 'bg-info'}`}
                      style={{ width: `${Math.min(healthData.kpis.breakEvenProgress, 100)}%` }}
                    ></div>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* Inventory Predictions Tab */}
      {activeTab === 'predictions' && inventoryPredictions && (
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Brain className="w-5 h-5 text-primary" />
              Inventory Planning
            </h3>
            <p className="text-sm text-muted-foreground">
              {inventoryPredictions.basis} Store timezone: {inventoryPredictions.period?.timezone}.
            </p>
            {!!inventoryPredictions.summary.unavailableDemand && <p className="text-sm">Demand estimates are unavailable for {inventoryPredictions.summary.unavailableDemand} products.</p>}
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <Card className="p-4 border-l-4 border-l-red-500">
              <p className="text-sm text-muted-foreground">Critical</p>
              <p className="text-2xl font-bold text-destructive">{inventoryPredictions.summary.critical}</p>
              <p className="text-xs">Review stock and delivery</p>
            </Card>
            <Card className="p-4 border-l-4 border-l-orange-500">
              <p className="text-sm text-muted-foreground">Needs Reorder</p>
              <p className="text-2xl font-bold text-warning">{inventoryPredictions.summary.needsReorder}</p>
              <p className="text-xs">Review reorder estimates</p>
            </Card>
            <Card className="p-4 border-l-4 border-l-yellow-500">
              <p className="text-sm text-muted-foreground">Overstock</p>
              <p className="text-2xl font-bold text-warning">{inventoryPredictions.summary.overstock}</p>
              <p className="text-xs">Review purchasing</p>
            </Card>
            <Card className="p-4 border-l-4 border-l-red-500/50">
              <p className="text-sm text-muted-foreground">Dead Stock</p>
              <p className="text-2xl font-bold text-destructive">{inventoryPredictions.summary.deadStock}</p>
              <p className="text-xs">No sales in 60+ days</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Inventory Value</p>
              <p className="text-2xl font-bold">{inventoryPredictions.summary.totalInventoryValue == null ? 'Unavailable' : formatCurrency(inventoryPredictions.summary.totalInventoryValue)}</p>
              <p className="text-xs">Total at cost</p>
            </Card>
          </div>

          <Card className="p-4 text-sm"><p>Storewide totals appear above. Planning suggestions are a bounded review list; the paginated table below contains every product. No purchase order is placed automatically.</p></Card>

          {/* Buy More - Auto Order Suggestions */}
          {inventoryPredictions.autoOrderSuggestions.length > 0 && (
            <Card className="p-6 border-success/20">
              <h4 className="font-medium mb-1 flex items-center gap-2 text-success">
                <ArrowUpRight className="w-5 h-5" />
                Buy More — Restock These Products
              </h4>
              <p className="text-sm text-muted-foreground mb-4">
                These products are selling fast and need restocking based on velocity and lead time
              </p>
              <Table scrollLabel="Analytics records">
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Current Stock</TableHead>
                    <TableHead>Recommended Order</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Est. Cost</TableHead>
                    <TableHead>Urgency</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inventoryPredictions.autoOrderSuggestions.map((item: any) => {
                    const prediction = inventoryPredictions.predictions.find((p: any) => p.id === item.productId);
                    return (
                      <TableRow key={item.productId}>
                        <TableCell className="font-medium">{item.productName}</TableCell>
                        <TableCell>{prediction?.currentStock ?? '—'} units</TableCell>
                        <TableCell className="font-bold text-success">{item.quantity} units</TableCell>
                        <TableCell>{item.supplier}</TableCell>
                        <TableCell>{formatCurrency(item.estimatedCost)}</TableCell>
                        <TableCell>
                          <Badge variant={item.urgency === 'critical' ? 'destructive' : 'warning'}>
                            {item.urgency === 'critical' ? 'Order Now' : 'Order Soon'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}

          {/* Stop Buying - Overstock & Dead Stock */}
          {(inventoryPredictions.predictions.filter((p: any) => p.status === 'overstock').length > 0 || inventoryPredictions.deadStock.length > 0) && (
            <Card className="p-6 border-destructive/20">
              <h4 className="font-medium mb-1 flex items-center gap-2 text-destructive">
                <ArrowDownRight className="w-5 h-5" />
                Stop Buying — Reduce These Products
              </h4>
              <p className="text-sm text-muted-foreground mb-4">
                These products are not selling well enough to justify current stock levels
              </p>
              <Table scrollLabel="Analytics records">
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Stock</TableHead>
                    <TableHead>Sales/Day</TableHead>
                    <TableHead>Days to Sell</TableHead>
                    <TableHead>Capital Tied Up</TableHead>
                    <TableHead>Recommendation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    ...inventoryPredictions.deadStock.map((d: any) => ({
                      ...d,
                      status: 'dead',
                      dailyVelocity: null,
                      daysOfStock: null,
                      totalValue: d.value,
                      action: 'Clearance sale or discontinue — no sales in 60+ days',
                    })),
                    ...inventoryPredictions.predictions.filter((p: any) => p.status === 'overstock'),
                  ].map((item: any) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <Badge variant={item.status === 'dead' ? 'destructive' : 'warning'}>
                          {item.status === 'dead' ? 'Dead Stock' : 'Overstock'}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell>{item.stock ?? item.currentStock} units</TableCell>
                      <TableCell>{item.dailyVelocity == null ? 'Unavailable' : item.dailyVelocity.toFixed(1) + ' /day'}</TableCell>
                      <TableCell>{item.status === 'dead' ? `${item.daysSinceLastSale} days since last sale` : item.daysOfStock == null ? 'Unavailable' : `${item.daysOfStock} days`}</TableCell>
                      <TableCell className="font-medium text-destructive">{formatCurrency(item.totalValue ?? item.value)}</TableCell>
                      <TableCell className="text-sm max-w-xs">
                        {item.action}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}

          {/* All Predictions Table */}
          <Card>
            <div className="p-4 border-b">
              <h4 className="font-medium">Complete Inventory Analysis</h4>
              <p className="text-sm text-muted-foreground">All products sorted by urgency</p>
            </div>
            <Table scrollLabel="Analytics records">
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>Velocity</TableHead>
                  <TableHead>Days Left</TableHead>
                  <TableHead>Reorder Point</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inventoryPredictions.predictions.map((item: any) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Badge variant={
                        item.status === 'critical' ? 'destructive' :
                        item.status === 'reorder' ? 'warning' :
                        item.status === 'overstock' ? 'secondary' : 'default'
                      }>
                        {item.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">{item.sku} · {item.category}</p>
                    </TableCell>
                    <TableCell>{item.currentStock}</TableCell>
                    <TableCell>{item.dailyVelocity == null ? 'Unavailable' : item.dailyVelocity.toFixed(1) + ' /day'}</TableCell>
                    <TableCell className={item.daysOfStock !== null && item.daysOfStock <= 7 ? 'text-destructive font-bold' : ''}>
                      {item.daysOfStock == null ? item.demandStatus === 'NO_RECENT_DEMAND' ? 'No recent demand' : 'Unavailable' : `${item.daysOfStock}d`}
                    </TableCell>
                    <TableCell>{item.reorderPoint ?? 'Unavailable'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-xs">
                      {item.action}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination page={inventoryPredictions.pagination.page} totalPages={inventoryPredictions.pagination.totalPages} totalItems={inventoryPredictions.pagination.total} itemName="products" onPageChange={setInventoryPage} />
          </Card>
        </div>
      )}

      {/* Anomalies Detection Tab */}
      {activeTab === 'anomalies' && anomaliesData && (
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Zap className="w-5 h-5 text-warning" />
              Sales Anomaly Detection
            </h3>
            <p className="text-sm text-muted-foreground">
              {anomaliesData.basis} Store timezone: {anomaliesData.period?.timezone}.
            </p>
            {anomaliesData.status === 'UNAVAILABLE' && <p role="status" className="mt-2 text-sm">Analysis unavailable: {anomaliesData.unavailableReason}</p>}
          </div>

          {/* Summary */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Daily Anomalies</p>
              <p className="text-2xl font-bold">{anomaliesData.summary.dailyAnomalies}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Product Anomalies</p>
              <p className="text-2xl font-bold">{anomaliesData.summary.productAnomalies}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Avg Daily Revenue</p>
              <p className="text-2xl font-bold">{anomaliesData.summary.avgDailyRevenue == null ? 'Unavailable' : formatCurrency(anomaliesData.summary.avgDailyRevenue)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Std Deviation</p>
              <p className="text-2xl font-bold">{anomaliesData.summary.revenueStdDev == null ? 'Unavailable' : formatCurrency(anomaliesData.summary.revenueStdDev)}</p>
            </Card>
          </div>

          {/* Insights */}
          {anomaliesData.insights.length > 0 && (
            <Card className="p-4 bg-info/5">
              <h4 className="font-medium mb-2 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Key Insights
              </h4>
              <ul className="list-disc list-inside space-y-1 text-sm">
                {anomaliesData.insights.map((insight: string, i: number) => (
                  <li key={i}>{insight}</li>
                ))}
              </ul>
            </Card>
          )}

          {/* Daily Anomalies */}
          {anomaliesData.dailyAnomalies.length > 0 && (
            <Card className="p-6">
              <h4 className="font-medium mb-4">Daily Revenue Anomalies</h4>
              <Table scrollLabel="Analytics records">
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Revenue</TableHead>
                    <TableHead>Expected</TableHead>
                    <TableHead>Deviation</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Severity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {anomaliesData.dailyAnomalies.map((anomaly: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell>{anomaly.date}</TableCell>
                      <TableCell className="font-medium">{formatCurrency(anomaly.revenue)}</TableCell>
                      <TableCell>{formatCurrency(anomaly.expected)}</TableCell>
                      <TableCell className={anomaly.deviation > 0 ? 'text-success' : 'text-destructive'}>
                        {anomaly.deviation > 0 ? '+' : ''}{formatCurrency(anomaly.deviation)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={anomaly.type === 'spike' ? 'success' : 'destructive'}>
                          {anomaly.type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={anomaly.severity === 'high' ? 'destructive' : 'warning'}>
                          {anomaly.severity}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}

          {/* Product Anomalies */}
          {anomaliesData.productAnomalies.length > 0 && (
            <Card className="p-6">
              <h4 className="font-medium mb-4">Product Demand Anomalies</h4>
              <Table scrollLabel="Analytics records">
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Last Qty</TableHead>
                    <TableHead>Avg Qty</TableHead>
                    <TableHead>Z-Score</TableHead>
                    <TableHead>Type</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {anomaliesData.productAnomalies.map((anomaly: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{anomaly.productName}</TableCell>
                      <TableCell>{anomaly.lastQuantity}</TableCell>
                      <TableCell>{anomaly.avgQuantity}</TableCell>
                      <TableCell>{anomaly.zScore ?? 'Constant baseline'}</TableCell>
                      <TableCell>
                        <Badge variant={anomaly.type === 'surge' ? 'success' : 'destructive'}>
                          {anomaly.type}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </div>
      )}

      {/* Bundle Recommendations Tab */}
      {activeTab === 'bundles' && bundlesData && (
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Gift className="w-5 h-5 text-pink-500" />
              Bundle Recommendations
            </h3>
            <p className="text-sm text-muted-foreground">
              Products frequently bought together - create bundle deals!
            </p>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Bundles Found</p>
              <p className="text-2xl font-bold">{bundlesData.summary.totalBundlesFound}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Avg Lift</p>
              <p className="text-2xl font-bold">{bundlesData.summary.avgLift}x</p>
              <p className="text-xs text-muted-foreground">Higher = stronger association</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Potential Revenue</p>
              <p className="text-2xl font-bold">{formatCurrency(bundlesData.summary.potentialRevenue)}</p>
            </Card>
          </div>

          {/* Insights */}
          {bundlesData.insights.length > 0 && (
            <Card className="p-4 bg-pink-500/5">
              <ul className="space-y-1 text-sm">
                {bundlesData.insights.map((insight: string, i: number) => (
                  <li key={i} className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-pink-500" />
                    {insight}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Bundle Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {bundlesData.recommendations.map((bundle: any, i: number) => (
              <Card key={i} className="p-4">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <Badge variant="secondary" className="mb-2">
                      Lift: {bundle.lift}x
                    </Badge>
                    <p className="text-sm text-muted-foreground">
                      Bought together {bundle.coOccurrences} times
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-success">
                      {formatCurrency(bundle.suggestedBundlePrice)}
                    </p>
                    <p className="text-xs text-muted-foreground line-through">
                      {formatCurrency(bundle.combinedPrice)}
                    </p>
                  </div>
                </div>
                <div className="space-y-2">
                  {bundle.products.map((product: any) => (
                    <div key={product.id} className="flex justify-between text-sm">
                      <span>{product.name}</span>
                      <span className="text-muted-foreground">{formatCurrency(product.price)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 pt-3 border-t flex justify-between text-sm">
                  <span>Suggested Discount</span>
                  <span className="font-medium text-success">{bundle.suggestedDiscount}% off</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Bundle Margin</span>
                  <span className="font-medium">{formatCurrency(bundle.potentialMargin)}</span>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Employee Performance Tab */}
      {activeTab === 'employees' && employeeData && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Trophy className="w-5 h-5 text-warning" />
                Employee Leaderboard
              </h3>
              <p className="text-sm text-muted-foreground">
                Performance scores and gamification badges
              </p>
            </div>
            <Select
              value={employeeDays}
              onChange={(e) => {
                setEmployeeDays(e.target.value);
                fetchEmployeePerformance(e.target.value);
              }}
              className="px-3 py-2 border border-input rounded-md bg-background text-foreground"
            >
              <option value="7">Last 7 days</option>
              <option value="14">Last 14 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </Select>
          </div>

          {/* Team Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Total Revenue</p>
              <p className="text-2xl font-bold">{formatCurrency(employeeData.teamStats.totalRevenue)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Total Transactions</p>
              <p className="text-2xl font-bold">{employeeData.teamStats.totalTransactions ?? 'Unavailable'}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Avg Score</p>
              <p className="text-2xl font-bold">{employeeData.teamStats.avgScore}/100</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Top Performer</p>
              <p className="text-2xl font-bold">{employeeData.teamStats.topPerformer}</p>
            </Card>
          </div>

          {/* Scoring Weights */}
          <Card className="p-4">
            <h4 className="font-medium mb-2">Scoring Weights</h4><p className="text-sm text-muted-foreground mb-2">{employeeData.basis} Store timezone: {employeeData.period?.timezone}.</p>{employeeData.historyWarning && <p role="status">{employeeData.historyWarning}</p>}
            <div className="flex flex-wrap gap-4 text-sm">
              <span>Revenue: {employeeData.scoringWeights.revenue}</span>
              <span>Transactions: {employeeData.scoringWeights.transactions}</span>
              <span>Avg Transaction: {employeeData.scoringWeights.avgTransaction}</span>
              <span>Efficiency: {employeeData.scoringWeights.efficiency}</span>
              <span>Quality: {employeeData.scoringWeights.quality}</span>
            </div>
          </Card>

          {/* Leaderboard */}
          <Card>
            <Table scrollLabel="Analytics records">
              <TableHeader>
                <TableRow>
                  <TableHead>Rank</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Revenue</TableHead>
                  <TableHead>Transactions</TableHead>
                  <TableHead>$/Hour</TableHead>
                  <TableHead>Badges</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employeeData.leaderboard.map((emp: any) => (
                  <TableRow key={emp.id}>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {emp.rank === 1 && <Medal className="w-5 h-5 text-warning" />}
                        {emp.rank === 2 && <Medal className="w-5 h-5 text-muted-foreground" />}
                        {emp.rank === 3 && <Medal className="w-5 h-5 text-warning" />}
                        {emp.rank > 3 && <span className="w-5 text-center">{emp.rank}</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{emp.name}</p>
                      <p className="text-xs text-muted-foreground">{emp.role}</p>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-bold">{emp.score}</span>
                        <div className="w-20 bg-muted rounded-full h-2">
                          <div
                            className={`h-2 rounded-full ${
                              emp.score >= 70 ? 'bg-success' :
                              emp.score >= 40 ? 'bg-warning' : 'bg-destructive'
                            }`}
                            style={{ width: `${emp.score}%` }}
                          ></div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{formatCurrency(emp.metrics.totalRevenue)}</TableCell>
                    <TableCell>{emp.metrics.totalSales}</TableCell>
                    <TableCell>{formatCurrency(emp.metrics.revenuePerHour)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {emp.badges.map((badge: string, i: number) => (
                          <Badge key={i} variant="secondary" className="text-xs">
                            {badge === 'Top Seller' && <Award className="w-3 h-3 mr-1" />}
                            {badge === 'Upsell Champion' && <TrendingUp className="w-3 h-3 mr-1" />}
                            {badge === 'Most Efficient' && <Zap className="w-3 h-3 mr-1" />}
                            {badge === 'Quality Star' && <Star className="w-3 h-3 mr-1" />}
                            {badge === 'High Volume' && <ShoppingBag className="w-3 h-3 mr-1" />}
                            {badge}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}

      {/* What-If Analysis Tab */}
      {activeTab === 'whatif' && (
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Calculator className="w-5 h-5 text-info" />
              What-If Scenario Analysis
            </h3>
            <p className="text-sm text-muted-foreground">
              Model the impact of price, cost, and volume changes
            </p>
          </div>

          {/* Input Controls */}
          <Card className="p-6">
            <h4 className="font-medium mb-4">Adjust Parameters</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className="text-sm font-medium">Price Change (%)</label>
                <input
                  type="range"
                  min="-50"
                  max="50"
                  value={whatIfInputs.priceChange}
                  onChange={(e) => setWhatIfInputs(prev => ({ ...prev, priceChange: parseInt(e.target.value) }))}
                  className="w-full mt-2"
                />
                <div className="flex justify-between text-sm mt-1">
                  <span>-50%</span>
                  <span className={`font-bold ${whatIfInputs.priceChange > 0 ? 'text-success' : whatIfInputs.priceChange < 0 ? 'text-destructive' : ''}`}>
                    {whatIfInputs.priceChange > 0 ? '+' : ''}{whatIfInputs.priceChange}%
                  </span>
                  <span>+50%</span>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Cost Change (%)</label>
                <input
                  type="range"
                  min="-50"
                  max="50"
                  value={whatIfInputs.costChange}
                  onChange={(e) => setWhatIfInputs(prev => ({ ...prev, costChange: parseInt(e.target.value) }))}
                  className="w-full mt-2"
                />
                <div className="flex justify-between text-sm mt-1">
                  <span>-50%</span>
                  <span className={`font-bold ${whatIfInputs.costChange < 0 ? 'text-success' : whatIfInputs.costChange > 0 ? 'text-destructive' : ''}`}>
                    {whatIfInputs.costChange > 0 ? '+' : ''}{whatIfInputs.costChange}%
                  </span>
                  <span>+50%</span>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Volume Change (%)</label>
                <input
                  type="range"
                  min="-50"
                  max="50"
                  value={whatIfInputs.volumeChange}
                  onChange={(e) => setWhatIfInputs(prev => ({ ...prev, volumeChange: parseInt(e.target.value) }))}
                  className="w-full mt-2"
                />
                <div className="flex justify-between text-sm mt-1">
                  <span>-50%</span>
                  <span className={`font-bold ${whatIfInputs.volumeChange > 0 ? 'text-success' : whatIfInputs.volumeChange < 0 ? 'text-destructive' : ''}`}>
                    {whatIfInputs.volumeChange > 0 ? '+' : ''}{whatIfInputs.volumeChange}%
                  </span>
                  <span>+50%</span>
                </div>
              </div>
            </div>
            <Button className="mt-4" onClick={fetchWhatIfAnalysis}>
              <Calculator className="w-4 h-4 mr-2" />
              Calculate Impact
            </Button>
          </Card>

          {/* Results */}
          {whatIfData && (
            <>
              {/* Comparison Table */}
              <Card className="p-6">
                <h4 className="font-medium mb-4">Projected Impact</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-2">Current</p>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span>Revenue</span>
                        <span className="font-medium">{formatCurrency(whatIfData.scenarios.current.revenue)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Transactions</span>
                        <span className="font-medium">{whatIfData.scenarios.current.transactions ?? 'Unavailable'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Profit</span>
                        <span className="font-medium">{formatCurrency(whatIfData.scenarios.current.profit)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Margin</span>
                        <span className="font-medium">{formatPercent(whatIfData.scenarios.current.margin)}</span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-info mb-2">Projected</p>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span>Revenue</span>
                        <span className="font-medium">{formatCurrency(whatIfData.scenarios.projected.revenue)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Transactions</span>
                        <span className="font-medium">{whatIfData.scenarios.projected.transactions ?? 'Unavailable'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Profit</span>
                        <span className="font-medium">{formatCurrency(whatIfData.scenarios.projected.profit)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Margin</span>
                        <span className="font-medium">{formatPercent(whatIfData.scenarios.projected.margin)}</span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-2">Difference</p>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span>Revenue</span>
                        <span className={`font-medium ${whatIfData.scenarios.difference.revenue >= 0 ? 'text-success' : 'text-destructive'}`}>
                          {whatIfData.scenarios.difference.revenue >= 0 ? '+' : ''}{formatCurrency(whatIfData.scenarios.difference.revenue)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Transactions</span>
                        <span className={`font-medium ${whatIfData.scenarios.difference.transactions >= 0 ? 'text-success' : 'text-destructive'}`}>
                          {whatIfData.scenarios.difference.transactions >= 0 ? '+' : ''}{whatIfData.scenarios.difference.transactions}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Profit</span>
                        <span className={`font-medium ${whatIfData.scenarios.difference.profit >= 0 ? 'text-success' : 'text-destructive'}`}>
                          {whatIfData.scenarios.difference.profit != null && whatIfData.scenarios.difference.profit >= 0 ? '+' : ''}{formatCurrency(whatIfData.scenarios.difference.profit)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Margin</span>
                        <span className={`font-medium ${whatIfData.scenarios.difference.margin >= 0 ? 'text-success' : 'text-destructive'}`}>
                          {formatPercent(whatIfData.scenarios.difference.margin)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>

              {/* Insights */}
              {whatIfData.insights.length > 0 && (
                <Card className="p-4 bg-info/5">
                  <h4 className="font-medium mb-2">Analysis Insights</h4>
                  <ul className="space-y-1 text-sm">
                    {whatIfData.insights.map((insight: string, i: number) => (
                      <li key={i} className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-info" />
                        {insight}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </>
          )}
        </div>
      )}
    </ManagementPage>
  );
};

export default Analytics;
