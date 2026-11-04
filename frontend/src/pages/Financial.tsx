import { useCalendarTimezone } from '@/hooks/useCalendarTimezone';
import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { FilterChips } from '@/components/common/FilterChips';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { InventoryCostPanel } from '@/components/financial/InventoryCostPanel';
import { ProfitAndLossStatement } from '@/components/financial/ProfitAndLossStatement';
import { ManagementPage, SummaryStrip } from '@/components/common/Workspace';
import { useLegacyPageRefresh } from '@/hooks/useLegacyPageRefresh';
import { PageTabs } from '@/components/common/PageTabs';
import { useUrlFilter } from '@/hooks/useUrlFilter';
import { useAuthStore } from '@/store/authStore';
import { can } from '@/lib/capabilities';
import { formatEnumLabel } from '@/lib/utils';
import type { ProfitAndLossReport } from '@/services/profitAndLossExport';
import React, { useState, useEffect, useRef } from 'react';
import { useEffectiveLocation } from '@/hooks/useEffectiveLocation';
import { sessionGeneration } from '@/services/sessionGeneration';
import {
  DollarSign,
  RefreshCw,
  Download,
  Plus,
  Trash2,
  Edit,
  Calendar,
  AlertTriangle,
  CheckCircle,
  Search,
  Filter,
  Eye,
  BarChart3,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ExportPreviewModal } from '@/components/reports/ExportPreviewModal';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import {
  Table,
  TableBody,
  TableRow,
  TableHeader,
  TableHead,
  TableCell,
} from '@/components/ui/Table';
import { financialService, expenseService, reportService } from '@/services/api';
import { displayStoreDate, storeDateInput } from '@/lib/storeDates';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { StoreFilterSelect } from '@/components/common/StoreFilterSelect';
import toast from 'react-hot-toast';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import type { ExpenseReportData, Expense } from '@/types';
import { ExpenseModal } from '@/components/expenses/ExpenseModal';
import { ExpenseDetailsModal } from '@/components/expenses/ExpenseDetailsModal';
import { ExpenseFilters } from '@/components/expenses/ExpenseFilters';
import { BulkActionsToolbar } from '@/components/expenses/BulkActionsToolbar';
import { FilterDropdown } from '@/components/common/FilterDropdown';
import { BudgetModal } from '@/components/financial/BudgetModal';
import { RecurringExpenseModal } from '@/components/financial/RecurringExpenseModal';
import { useConfirm } from '@/components/ui/useConfirm';

export const Financial: React.FC = () => {
  const [confirm, confirmDialog] = useConfirm();
  const scopeUser = useAuthStore(s => s.user);
  const role = scopeUser?.role;
  const mayManage = can(role, 'financial.manage');
  const { locationId: contextLocationId, isAdminViewing } = useEffectiveLocation();
  const assignedTimezone = useCalendarTimezone();
  const [tab, setActiveTab] = useUrlFilter('tab', 'expenses', false);
  const [pnlMonth, setPnlMonth] = useUrlFilter('pnlMonth');
  const validPnlMonth = /^20\d{2}-(0[1-9]|1[0-2])$/.test(pnlMonth) ? pnlMonth : '';
  const activeTab = ['expenses', 'budgets', 'recurring', 'pnl', 'inventory'].includes(tab) ? tab : 'expenses';
  const [loading, setLoading] = useState(true);

  // Data states
  const [expenseData, setExpenseData] = useState<ExpenseReportData | null>(null);
  const [budgets, setBudgets] = useState<any[]>([]);
  const [budgetSummary, setBudgetSummary] = useState<any>(null);
  const [recurringExpenses, setRecurringExpenses] = useState<any[]>([]);
  const [pnlData, setPnlData] = useState<ProfitAndLossReport | null>(null);
  const [exportingPnl, setExportingPnl] = useState(false);
  const pnlExportRequest = useRef<AbortController | null>(null);

  // Expense-specific state
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showExpenseDetails, setShowExpenseDetails] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<string[]>([]);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [expenseFilters, setExpenseFilters] = useState({
    category: [] as string[],
    status: [] as string[],
    startDate: storeDateInput(new Date(Date.now() - 30 * 86400000), assignedTimezone),
    endDate: storeDateInput(new Date(), assignedTimezone),
    minAmount: '',
    maxAmount: '',
    showCharts: false,
  });

  // Modal states for budgets/recurring
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [showRecurringModal, setShowRecurringModal] = useState(false);
  const [editingBudget, setEditingBudget] = useState<any>(null);
  const [editingRecurring, setEditingRecurring] = useState<any>(null);
  const [locationId, setLocationId] = useState('');
  const activeLocationId = isAdminViewing ? contextLocationId : locationId || contextLocationId;
  const scopeKey = `${scopeUser?.id}:${role}:${activeLocationId || 'all'}`;
  const viewKey = `${scopeKey}:${activeTab}:${expenseFilters.startDate}:${expenseFilters.endDate}:${validPnlMonth}`;
  const currentView = useRef(viewKey);
  currentView.current = viewKey;
  const requestVersion = useRef(0);
  const [loadedView, setLoadedView] = useState('');
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    void fetchData();
    return () => { requestVersion.current += 1; };
  }, [viewKey]);

  useEffect(() => {
    setExportingPnl(false);
    return () => { pnlExportRequest.current?.abort(); pnlExportRequest.current = null; };
  }, [viewKey]);

  useEffect(() => {
    setExpenseData(null); setBudgets([]); setBudgetSummary(null); setRecurringExpenses([]); setPnlData(null);
    setSelectedExpenseIds([]); setSelectedExpense(null); setShowExpenseModal(false); setShowExpenseDetails(false);
    setEditingBudget(null); setEditingRecurring(null); setShowBudgetModal(false); setShowRecurringModal(false); setShowExportMenu(false);
  }, [scopeKey]);

  const fetchData = async (quiet = false, active: () => boolean = () => true, signal?: AbortSignal) => {
    const version = ++requestVersion.current;
    const generation = sessionGeneration();
    const current = () => active() && version === requestVersion.current && generation === sessionGeneration() && viewKey === currentView.current;
    if (!quiet) { setLoading(true); setLoadError(''); }
    try {
      switch (activeTab) {
        case 'expenses': {
          const expRes = await reportService.getExpenses({
            startDate: expenseFilters.startDate,
            endDate: expenseFilters.endDate,
            locationId: activeLocationId || undefined,
          }, signal);
          if (current()) setExpenseData(expRes.data.data);
          break;
        }
        case 'budgets': {
          const [budgetsRes, summaryRes] = await Promise.all([
            financialService.getBudgets({ locationId: activeLocationId || undefined }, signal),
            financialService.getBudgetSummary({ locationId: activeLocationId || undefined }, signal),
          ]);
          if (current()) { setBudgets(budgetsRes.data.data || []); setBudgetSummary(summaryRes.data.data); }
          break;
        }
        case 'recurring': {
          const recRes = await financialService.getRecurringExpenses({ locationId: activeLocationId || undefined }, signal);
          if (current()) setRecurringExpenses(recRes.data.data || []);
          break;
        }
        case 'pnl': {
          const [year, month] = validPnlMonth.split('-').map(Number);
          const pnlRes = await financialService.getProfitAndLoss({ locationId: activeLocationId || undefined,
            ...(validPnlMonth ? { startDate: validPnlMonth + '-01', endDate: `${validPnlMonth}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}` } : {}),
          }, signal);
          if (current()) setPnlData(pnlRes.data.data);
          break;
        }
      }
      if (current()) { setLoadError(''); setLoadedView(viewKey); }
    } catch (error) {
      if (quiet) throw error;
      if (current()) setLoadError((error as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to load financial data.');
    } finally {
      if (current()) setLoading(false);
    }
  };

  // Expense helper functions
  const handleExport = async (format: 'csv' | 'pdf') => {
    const generation = sessionGeneration();
    const current = () => generation === sessionGeneration() && viewKey === currentView.current;
    try {
      const params = {
        ...expenseFilters,
        category: expenseFilters.category.join(','),
        status: expenseFilters.status.join(','),
        locationId: activeLocationId || undefined,
      };

      const response =
        format === 'csv'
          ? await expenseService.exportCSV(params)
          : await expenseService.exportPDF(params);
      if (!current()) return;

      // Create download link
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `expenses-export.${format}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setShowExportMenu(false);
      toast.success(`Exported expenses as ${format.toUpperCase()}`);
    } catch (error) {
      if (current()) toast.error(`Failed to export ${format}`);
    }
  };

  const toggleExpenseSelection = (id: string) => {
    setSelectedExpenseIds((prev) =>
      prev.includes(id) ? prev.filter((expId) => expId !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedExpenseIds.length === filteredExpenses.length) {
      setSelectedExpenseIds([]);
    } else {
      setSelectedExpenseIds(filteredExpenses.map((exp) => exp.id));
    }
  };

  // Filter and search expenses
  const filteredExpenses = React.useMemo(() => {
    if (!expenseData?.expenses) return [];

    let filtered = [...expenseData.expenses];

    // Apply search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (exp) =>
          exp.expenseNumber.toLowerCase().includes(query) ||
          exp.description.toLowerCase().includes(query) ||
          exp.vendor?.toLowerCase().includes(query) ||
          exp.invoiceNumber?.toLowerCase().includes(query)
      );
    }

    // Apply filters
    if (expenseFilters.category.length > 0) {
      filtered = filtered.filter((exp) => expenseFilters.category.includes(exp.category));
    }
    if (expenseFilters.status.length > 0) {
      filtered = filtered.filter((exp) => expenseFilters.status.includes(exp.status));
    }
    if (expenseFilters.minAmount) {
      filtered = filtered.filter((exp) => exp.amount >= parseFloat(expenseFilters.minAmount));
    }
    if (expenseFilters.maxAmount) {
      filtered = filtered.filter((exp) => exp.amount <= parseFloat(expenseFilters.maxAmount));
    }

    return filtered;
  }, [expenseData?.expenses, searchQuery, expenseFilters]);

  const formatCurrency = (value: number | null | undefined) => {
    if (value == null || !Number.isFinite(value)) return 'Unavailable';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value || 0);
  };

  const handleGenerateRecurring = async () => {
    try {
      const response = await financialService.generateRecurringExpenses();
      toast.success(`Generated ${response.data.data.generated} expenses`);
      fetchData();
    } catch (error) {
      toast.error('Failed to generate recurring expenses');
    }
  };

  const handleDeleteBudget = async (id: string) => {
    if (!await confirm({ title: 'Delete this budget?', confirmLabel: 'Delete', destructive: true })) return;
    try {
      await financialService.deleteBudget(id);
      toast.success('Budget deleted');
      fetchData();
    } catch (error) {
      toast.error('Failed to delete budget');
    }
  };

  const handleDeleteRecurring = async (id: string) => {
    if (!await confirm({ title: 'Delete this recurring expense?', message: 'Expenses already created from it are kept.', confirmLabel: 'Delete', destructive: true })) return;
    try {
      await financialService.deleteRecurringExpense(id);
      toast.success('Recurring expense deleted');
      fetchData();
    } catch (error) {
      toast.error('Failed to delete recurring expense');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING':
        return <Badge variant="warning">Pending</Badge>;
      case 'APPROVED':
        return <Badge variant="success">Approved</Badge>;
      case 'PAID':
        return <Badge variant="default">Paid</Badge>;
      case 'REJECTED':
        return <Badge variant="destructive">Rejected</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const autoRefresh = useLegacyPageRefresh((current, signal) => fetchData(true, current, signal), { key: viewKey, paused: loading || exportingPnl || showExpenseModal || showExpenseDetails || showBudgetModal || showRecurringModal });
  const exportPnl = async () => {
    if (!pnlData || exportingPnl || pnlExportRequest.current || loading || loadError || loadedView !== currentView.current) return;
    const controller = new AbortController(), generation = sessionGeneration();
    pnlExportRequest.current = controller; setExportingPnl(true);
    const current = () => !controller.signal.aborted && generation === sessionGeneration() && viewKey === currentView.current;
    try {
      const [year, month] = validPnlMonth.split('-').map(Number);
      const response = await financialService.getProfitAndLoss({ workbook: true, locationId: activeLocationId || undefined,
        ...(validPnlMonth ? { startDate: validPnlMonth + '-01', endDate: `${validPnlMonth}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}` } : {}),
      }, controller.signal);
      if (!current()) return;
      const { prepareProfitAndLossExcel } = await import('@/services/profitAndLossWorkbook');
      const file = await prepareProfitAndLossExcel(response.data.data);
      if (!current()) return;
      setPnlData(response.data.data);
      const url = URL.createObjectURL(file.blob), link = document.createElement('a');
      link.href = url; link.download = file.filename; document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('Excel report exported');
    } catch (error) { if (current()) toast.error((error as { response?: { data?: { error?: string } } }).response?.data?.error || 'Excel export failed. Please try again.'); }
    finally { if (pnlExportRequest.current === controller) { pnlExportRequest.current = null; setExportingPnl(false); } }
  };

  return (
    <>
      {confirmDialog}
    <ManagementPage>
      <PageHeader
        title="Financial Management"
        actions={<>
          {activeTab === 'pnl' && <Button variant="outline" onClick={exportPnl} disabled={exportingPnl || loading || !!loadError || loadedView !== viewKey || !pnlData}><Download className="h-4 w-4 mr-2" />{exportingPnl ? 'Preparing Excel…' : 'Export Excel'}</Button>}
          {activeTab === 'expenses' && filteredExpenses.length > 0 && <Button variant="outline" onClick={() => setShowExportMenu(true)}><Download className="h-4 w-4 mr-2" />Export</Button>}
          {activeTab === 'recurring' && mayManage && <Button onClick={handleGenerateRecurring} variant="outline"><RefreshCw className="h-4 w-4 mr-2" />Generate Due Expenses</Button>}
          {mayManage && ['expenses','budgets','recurring'].includes(activeTab) && <Button onClick={() => { if(activeTab === 'expenses') setShowExpenseModal(true); else if(activeTab === 'budgets') { setEditingBudget(null); setShowBudgetModal(true); } else { setEditingRecurring(null); setShowRecurringModal(true); } }}><Plus className="h-4 w-4 mr-2" />{activeTab === 'expenses' ? 'Add Expense' : activeTab === 'budgets' ? 'Add Budget' : 'Add Recurring Expense'}</Button>}
        </>}
        tabs={<PageTabs label="Financial views" value={activeTab} onChange={setActiveTab} items={[
          {id:'expenses',label:'Expenses'},{id:'budgets',label:'Budgets'},{id:'recurring',label:'Recurring'},{id:'pnl',label:'P&L Report'},{id:'inventory',label:'Inventory costs'},
          ...(role === 'ADMIN' ? [{id:'reconciliation',label:'Reconciliation',href:'/financial/reconciliation'},{id:'jobs',label:'Email & Export Jobs',href:'/settings/jobs'}] : [])
        ]} />}
        toolbar={<>
          {role === 'SUPER_ADMIN' && !isAdminViewing && <StoreFilterSelect value={locationId} onChange={setLocationId} />}
          {activeTab === 'pnl' && <><label className="flex flex-wrap items-center gap-2 text-sm">P&L month<Input aria-label="P&L month" type="month" value={validPnlMonth} placeholder="Year to date" onChange={e => setPnlMonth(e.target.value)} className="w-48" /></label><Button variant="outline" onClick={() => setPnlMonth('')} disabled={!validPnlMonth}>Year to date</Button></>}
        </>}
      />
      {autoRefresh.notice}

      {loading || (!loadError && loadedView !== viewKey) ? (
        <div className="flex justify-center items-center h-64">
          <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : loadError ? (
        <div role="alert" className="rounded-lg border border-destructive/30 p-4 space-y-3"><p>{loadError}</p><Button onClick={() => void fetchData()}>Retry</Button></div>
      ) : (
        <>
          {activeTab === 'inventory' && <InventoryCostPanel locationId={activeLocationId || undefined} owner={role === 'ADMIN'} readOnly={role === 'SUPER_ADMIN'} />}
          {/* Expenses Tab */}
          {activeTab === 'expenses' && expenseData && (
            <>
              {/* Search & Filter Bar */}
              <div className="report-filter-toolbar flex flex-wrap gap-2 mb-4">
                <DateRangePicker label="Expense dates" startDate={expenseFilters.startDate} endDate={expenseFilters.endDate} timezone={expenseData.period.timezone || assignedTimezone} onChange={range => setExpenseFilters({ ...expenseFilters, ...range })} />
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="Search by expense #, description, vendor, or invoice..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Button
                  variant={expenseFilters.showCharts ? 'default' : 'outline'}
                  onClick={() => setExpenseFilters({ ...expenseFilters, showCharts: !expenseFilters.showCharts })}
                  title="Toggle charts visualization"
                >
                  <BarChart3 className="h-4 w-4 mr-2" />
                  Charts
                </Button>
                <div className="relative">
                  <Button
                    variant={showFilters ? 'default' : 'outline'}
                    onClick={() => setShowFilters(!showFilters)}
                  >
                    <Filter className="h-4 w-4 mr-2" />
                    Filters
                    {(expenseFilters.category.length > 0 || expenseFilters.status.length > 0) && (
                      <span className="ml-2 bg-primary-foreground text-primary rounded-full px-2 py-0.5 text-xs">
                        {expenseFilters.category.length + expenseFilters.status.length}
                      </span>
                    )}
                  </Button>

                  {/* Filters Dropdown */}
                  <FilterDropdown
                    isOpen={showFilters}
                    onClose={() => setShowFilters(false)}
                    title="Expense Filters"
                  >
                    <ExpenseFilters
                      filters={expenseFilters}
                      onFilterChange={setExpenseFilters}
                      onClear={() =>
                        setExpenseFilters({
                          category: [],
                          status: [],
                          startDate: storeDateInput(new Date(Date.now() - 30 * 86400000), expenseData?.period.timezone || assignedTimezone),
                          endDate: storeDateInput(new Date(), expenseData?.period.timezone || assignedTimezone),
                          minAmount: '',
                          maxAmount: '',
                          showCharts: false,
                        })
                      }
                    />
                  </FilterDropdown>
                </div>

              </div>

              <FilterChips filters={expenseFilters} onChange={setExpenseFilters} count={filteredExpenses.length} itemName="expenses" />
              {/* Bulk Actions Toolbar */}
              {mayManage && <BulkActionsToolbar
                selectedIds={selectedExpenseIds}
                onClearSelection={() => setSelectedExpenseIds([])}
                onSuccess={fetchData}
              />}

              <SummaryStrip className="mb-4" items={[
                { label: 'Total Expenses', value: formatCurrency(expenseData.summary?.totalExpenses || 0) },
                { label: 'Pending', value: formatCurrency(expenseData.summary?.pendingExpenses || 0), tone: expenseData.summary?.pendingExpenses ? 'warning' : 'default' },
                { label: 'Top Category', value: expenseData.summary?.topCategory ? formatEnumLabel(expenseData.summary.topCategory) : 'Unavailable' },
                { label: 'Avg Daily', value: formatCurrency(expenseData.summary?.avgDailyExpense || 0) },
              ]} />

              {/* Category Breakdown Chart */}
              {expenseFilters.showCharts && expenseData.summary?.byCategory && expenseData.summary.byCategory.length > 0 && (
                <Card className="mb-6">
                  <CardHeader>
                    <CardTitle>Expense by Category</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <div className="h-80">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={expenseData.summary.byCategory}
                              dataKey="total"
                              nameKey="category"
                              cx="50%"
                              cy="50%"
                              outerRadius={100}
                              label={(entry) => `${entry.category}: ${entry.percentage.toFixed(1)}%`}
                            >
                              {expenseData.summary.byCategory.map((_entry, index) => (
                                <Cell
                                  key={`cell-${index}`}
                                  fill={`hsl(${(index * 360) / expenseData.summary.byCategory.length}, 70%, 50%)`}
                                />
                              ))}
                            </Pie>
                            <Tooltip formatter={(value) => formatCurrency(value as number)} />
                            <Legend />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Category</TableHead>
                              <TableHead>Count</TableHead>
                              <TableHead className="text-right">Total</TableHead>
                              <TableHead className="text-right">%</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {expenseData.summary.byCategory.map((cat) => (
                              <TableRow key={cat.category}>
                                <TableCell className="font-medium">{formatEnumLabel(cat.category)}</TableCell>
                                <TableCell>{cat.count}</TableCell>
                                <TableCell className="text-right">
                                  {formatCurrency(cat.total)}
                                </TableCell>
                                <TableCell className="text-right">
                                  {cat.percentage.toFixed(1)}%
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Expenses Table */}
              <Card>
                <CardHeader>
                  <CardTitle>
                    {searchQuery || expenseFilters.category.length > 0 || expenseFilters.status.length > 0
                      ? `Filtered Expenses (${filteredExpenses.length})`
                      : 'All Expenses'}
                  </CardTitle>
                </CardHeader>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">
                        <input
                          type="checkbox"
                              disabled={!mayManage}
                          checked={
                            filteredExpenses.length > 0 &&
                            selectedExpenseIds.length === filteredExpenses.length
                          }
                          onChange={toggleSelectAll}
                          className="cursor-pointer"
                        />
                      </TableHead>
                      <TableHead>Expense</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredExpenses.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8}>
                          <EmptyState
                            icon={DollarSign}
                            title="No expenses found"
                            hint="Try widening the date range or clearing filters"
                          />
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredExpenses.slice(0, 50).map((expense) => (
                        <TableRow
                          key={expense.id}
                          className="cursor-pointer hover:bg-accent"
                          onClick={(e) => {
                            if (
                              (e.target as HTMLElement).tagName === 'INPUT' ||
                              (e.target as HTMLElement).closest('button')
                            ) {
                              return;
                            }
                            setSelectedExpense(expense);
                            setShowExpenseDetails(true);
                          }}
                        >
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              disabled={!mayManage}
                              checked={selectedExpenseIds.includes(expense.id)}
                              onChange={() => toggleExpenseSelection(expense.id)}
                              className="cursor-pointer"
                            />
                          </TableCell>
                          <TableCell>
                            <span title={expense.description} className="block min-w-32 max-w-60 truncate font-medium">{expense.description}</span>
                            <span title={expense.expenseNumber} className="block max-w-36 truncate text-xs text-muted-foreground">{expense.expenseNumber}</span>
                          </TableCell>
                          <TableCell className="whitespace-nowrap">{displayStoreDate(expense.expenseDate, expenseData?.period.timezone || assignedTimezone)}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="whitespace-normal">
                              {formatEnumLabel(expense.category)}
                            </Badge>
                          </TableCell>
                          <TableCell>{expense.vendor || '-'}</TableCell>
                          <TableCell>{getStatusBadge(expense.status)}</TableCell>
                          <TableCell className="text-right whitespace-nowrap font-medium">
                            {formatCurrency(expense.amount)}
                          </TableCell>
                          <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex justify-end gap-1">
                              <button
                                onClick={() => {
                                  setSelectedExpense(expense);
                                  setShowExpenseDetails(true);
                                }}
                                className="p-1 hover:bg-accent rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                title="View details"
                              >
                                <Eye className="h-4 w-4" />
                              </button>
                              {mayManage && expense.status === 'PENDING' && (
                                <button
                                  onClick={() => {
                                    setSelectedExpense(expense);
                                    setShowExpenseModal(true);
                                  }}
                                  className="p-1 hover:bg-accent rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                  title="Edit"
                                >
                                  <Edit className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </Card>

              {/* Modals */}
              <ExpenseModal
                timezone={expenseData?.period.timezone || assignedTimezone}
                isOpen={showExpenseModal}
                onClose={() => {
                  setShowExpenseModal(false);
                  setSelectedExpense(null);
                }}
                onSuccess={fetchData}
                expense={selectedExpense}
              />

              <ExpenseDetailsModal
                timezone={expenseData?.period.timezone || assignedTimezone}
                isOpen={showExpenseDetails}
                onClose={() => {
                  setShowExpenseDetails(false);
                  setSelectedExpense(null);
                }}
                expense={selectedExpense}
                onSuccess={fetchData}
                onEdit={(expense) => {
                  setSelectedExpense(expense);
                  setShowExpenseModal(true);
                }}
              />
            </>
          )}

          {/* Budgets Tab */}
          {activeTab === 'budgets' && (
            <div className="space-y-6">
              {/* Budget Summary */}
              {budgetSummary && (
                <SummaryStrip items={[
                  { label: 'Total Budgeted', value: formatCurrency(budgetSummary.totals.budgeted) },
                  { label: 'Total Spent', value: formatCurrency(budgetSummary.totals.spent) },
                  { label: 'Remaining', value: formatCurrency(budgetSummary.totals.remaining), tone: budgetSummary.totals.remaining < 0 ? 'danger' : 'default' },
                  { label: '% Used', value: `${budgetSummary.totals.percentUsed}%`, detail: budgetSummary.totals.percentUsed > 100 ? 'Over budget' : undefined, tone: budgetSummary.totals.percentUsed > 100 ? 'danger' : budgetSummary.totals.percentUsed > 80 ? 'warning' : 'default' },
                ]} />
              )}

              {/* Category Budgets */}
              {budgetSummary?.categories && budgetSummary.categories.length > 0 && (
                <Card className="p-6">
                  <h3 className="font-medium mb-4">Budget by Category</h3>
                  <div className="space-y-4">
                    {budgetSummary.categories.map((cat: any) => (
                      <div key={cat.category} className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        <div className="w-full sm:w-32 font-medium">{formatEnumLabel(cat.category)}</div>
                        <div className="min-w-0 flex-1">
                          <div className="flex justify-between text-sm mb-1">
                            <span>{formatCurrency(cat.spent)} / {formatCurrency(cat.budgeted)}</span>
                            <span>{cat.percentUsed}%</span>
                          </div>
                          <div className="w-full bg-muted rounded-full h-2">
                            <div
                              className={`h-2 rounded-full ${
                                cat.status === 'over' ? 'bg-destructive' :
                                cat.status === 'warning' ? 'bg-warning' : 'bg-success'
                              }`}
                              style={{ width: `${Math.min(cat.percentUsed, 100)}%` }}
                            ></div>
                          </div>
                        </div>
                        {cat.status === 'over' && <AlertTriangle className="w-4 h-4 text-destructive" />}
                        {cat.status === 'warning' && <AlertTriangle className="w-4 h-4 text-warning" />}
                        {cat.status === 'ok' && <CheckCircle className="w-4 h-4 text-success" />}
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* All Budgets Table */}
              <Card>
                <div className="p-4 border-b flex justify-between items-center">
                  <h3 className="font-medium">All Budgets</h3>

                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead>Budgeted</TableHead>
                      <TableHead>Spent</TableHead>
                      <TableHead>Remaining</TableHead>
                      <TableHead>% Used</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {budgets.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground">
                          {mayManage ? 'No budgets set. Click "Add Budget" to create one.' : 'No budgets set for this store.'}
                        </TableCell>
                      </TableRow>
                    ) : (
                      budgets.map((budget) => (
                        <TableRow key={budget.id}>
                          <TableCell>{formatEnumLabel(budget.category)}</TableCell>
                          <TableCell>{formatEnumLabel(budget.period)}</TableCell>
                          <TableCell>{formatCurrency(budget.amount)}</TableCell>
                          <TableCell>{formatCurrency(budget.spent)}</TableCell>
                          <TableCell className={budget.remaining >= 0 ? 'text-success' : 'text-destructive'}>
                            {formatCurrency(budget.remaining)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span>{budget.percentUsed}%</span>
                              {budget.isOverBudget && <AlertTriangle className="w-4 h-4 text-destructive" />}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              {mayManage && <Button aria-label="Edit budget"
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setEditingBudget(budget);
                                  setShowBudgetModal(true);
                                }}
                              >
                                <Edit className="w-4 h-4" />
                              </Button>}
                              {can(role, 'financial.delete') && <ActionMenu label="Budget actions" iconOnly items={[{ id: 'delete', label: 'Delete budget', icon: <Trash2 size={16} />, destructive: true, onAction: () => handleDeleteBudget(budget.id) }]} />}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </Card>
            </div>
          )}

          {/* Recurring Expenses Tab */}
          {activeTab === 'recurring' && (
            <div className="space-y-6">


              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Description</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Frequency</TableHead>
                      <TableHead>Next Due</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recurringExpenses.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground">
                          No recurring expenses set up
                        </TableCell>
                      </TableRow>
                    ) : (
                      recurringExpenses.map((recurring) => (
                        <TableRow key={recurring.id}>
                          <TableCell>
                            <p className="font-medium">{recurring.description}</p>
                            {recurring.vendor && (
                              <p className="text-xs text-muted-foreground">{recurring.vendor}</p>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">{formatEnumLabel(recurring.category)}</Badge>
                          </TableCell>
                          <TableCell className="font-medium">
                            {formatCurrency(recurring.amount)}
                          </TableCell>
                          <TableCell>{formatEnumLabel(recurring.frequency)}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Calendar className="w-4 h-4 text-muted-foreground" />
                              {new Date(recurring.nextDueDate).toLocaleDateString()}
                            </div>
                          </TableCell>
                          <TableCell>
                            {recurring.isActive ? (
                              <Badge variant="success">Active</Badge>
                            ) : (
                              <Badge variant="secondary">Inactive</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              {mayManage && <Button aria-label="Edit recurring expense"
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setEditingRecurring(recurring);
                                  setShowRecurringModal(true);
                                }}
                              >
                                <Edit className="w-4 h-4" />
                              </Button>}
                              {can(role, 'financial.delete') && <Button aria-label="Delete recurring expense"
                                size="sm"
                                variant="ghost"
                                onClick={() => handleDeleteRecurring(recurring.id)}
                              >
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </Card>
            </div>
          )}

          {/* P&L Report Tab */}
          {activeTab === 'pnl' && pnlData && (
            <ProfitAndLossStatement report={pnlData} month={validPnlMonth} onReviewCosts={() => setActiveTab('inventory')} />
          )}
        </>
      )}

      {/* Budget Modal */}
      <BudgetModal
        isOpen={showBudgetModal}
        onClose={() => {
          setShowBudgetModal(false);
          setEditingBudget(null);
        }}
        onSuccess={fetchData}
        budget={editingBudget}
      />

      {/* Recurring Expense Modal */}
      <RecurringExpenseModal
        isOpen={showRecurringModal}
        onClose={() => {
          setShowRecurringModal(false);
          setEditingRecurring(null);
        }}
        onSuccess={fetchData}
        recurringExpense={editingRecurring}
      />

      {/* Export Preview Modal */}
      {showExportMenu && (
        <ExportPreviewModal
          isOpen={showExportMenu}
          onClose={() => setShowExportMenu(false)}
          type="expenses"
          data={filteredExpenses}
          onExportCSV={async () => {
            await handleExport('csv');
            setShowExportMenu(false);
          }}
          onExportPDF={async () => {
            await handleExport('pdf');
            setShowExportMenu(false);
          }}
        />
      )}
    </ManagementPage>
    </>
  );
};

export default Financial;
