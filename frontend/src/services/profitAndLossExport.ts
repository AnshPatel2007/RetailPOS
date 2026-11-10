import { buildCsv } from '@/lib/utils';

export interface ProfitAndLossReport {
  scope: { locationId: string | null; storeName: string };
  snapshotAt: string;
  period: { start: string; end: string; timezone: string; endExclusive: boolean };
  revenue: { grossSales: number; refunds: number | null; voids: number; netSales: number | null; taxCollected: number | null };
  costOfGoodsSold: number | null; grossProfit: number | null; netIncome: number | null;
  margins: { gross: number | null; net: number | null };
  operatingExpenses: { total: number; byCategory: { category: string; amount: number }[] };
  inventoryPurchases: number; otherIncome: number;
  recordedSaleCosts?: number | null; inventoryCostAdjustments?: number | null; receivedInventoryPurchases?: number;
  costCompleteness?: { complete: boolean; missingRecords: number; label: string; reviewPath: string; estimated?: boolean; estimatedAmount?: number; pendingStockProblems?: number };
  lotteryEarnings?: number;
  earningsCompleteness?: { complete: boolean; pendingDays: number; label: string; reviewPath: string };
  unavailableReason?: string | null; historyWarning?: string | null;
  defaultCostView: string;
  estimate: null | { assumption: string; costRatePercent: number; costOfGoodsSold: number; grossProfit: number; netIncome: number; margins: { gross: number | null; net: number | null } };
}

/** Export the displayed snapshot, without re-fetching or recomputing its figures. */
export function profitAndLossCsv(report: ProfitAndLossReport, _legacyEstimated = false) {
  const figures = report;
  const basis = 'Recorded';
  const dates = new Intl.DateTimeFormat('en-CA', { timeZone: report.period.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const start = dates.format(new Date(report.period.start));
  const end = dates.format(new Date(new Date(report.period.end).getTime() - Number(report.period.endExclusive)));
  const amount = (value: number | null) => value === null ? 'Unavailable' : value;
  const rows: unknown[][] = [
    ['Statement', 'Report', 'Profit & Loss', '', basis],
    ['Statement', 'Store', report.scope.storeName, '', 'Recorded'],
    ['Statement', 'Store ID', report.scope.locationId || 'All stores', '', 'Recorded'],
    ['Statement', 'Period start', start, '', 'Recorded'],
    ['Statement', 'Period end (inclusive)', end, '', 'Recorded'],
    ['Statement', 'Timezone', report.period.timezone, '', 'Recorded'],
    ['Statement', 'Snapshot UTC', report.snapshotAt, '', 'Recorded'],
    ['Revenue', 'Sales before returns, excluding tax', amount(report.revenue.grossSales), 'USD', 'Recorded'],
    ['Revenue', 'Refunds deducted, excluding tax', amount(report.revenue.refunds), 'USD', 'Recorded'],
    ['Revenue', 'Voids deducted, excluding tax', amount(report.revenue.voids), 'USD', 'Recorded'],
    ['Revenue', 'Net sales', amount(report.revenue.netSales), 'USD', 'Recorded'],
    ['Cost', 'Cost of goods sold (deducted)', amount(figures.costOfGoodsSold), 'USD', basis],
    ['Profit', 'Gross profit', amount(figures.grossProfit), 'USD', basis],
    ...report.operatingExpenses.byCategory.map(row => ['Operating expenses', row.category.replace(/_/g, ' '), row.amount, 'USD', 'Recorded']),
    ['Operating expenses', 'Total operating expenses (deducted)', report.operatingExpenses.total, 'USD', 'Recorded'],
    ['Other income', 'Gaming/ATM and confirmed lottery earnings', report.otherIncome, 'USD', 'Recorded'],
    ['Profit', 'Net income', amount(figures.netIncome), 'USD', basis],
    ['Margin', 'Gross margin', amount(figures.margins.gross), '%', basis],
    ['Margin', 'Net margin', amount(figures.margins.net), '%', basis],
    ['Reference only', 'Net tax collected (excluded from sales)', amount(report.revenue.taxCollected), 'USD', 'Recorded'],
    ['Reference only', 'Inventory received at cost (not deducted again)', amount(report.receivedInventoryPurchases ?? null), 'USD', 'Recorded'],
    ['Reference only', 'Inventory purchase expense entries (may overlap receipts)', report.inventoryPurchases, 'USD', 'Recorded'],
  ];
  if (report.historyWarning) rows.push(['Notes', 'Source limitations', report.historyWarning, '', 'Recorded']);
  if (report.unavailableReason) rows.push(['Notes', 'Reporting limitation', report.unavailableReason, '', 'Recorded']);
  return { csv: buildCsv(['Section', 'Metric', 'Value', 'Unit', 'Basis'], rows),
    filename: `pnl-${report.scope.locationId || 'all-stores'}-${start}-to-${end}-${basis.toLowerCase()}.csv` };
}
