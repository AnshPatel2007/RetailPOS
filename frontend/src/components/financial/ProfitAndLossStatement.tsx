import { Link } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { DataPanel, SummaryStrip } from '@/components/common/Workspace';
import { Button } from '@/components/ui/Button';
import { formatCurrency, formatEnumLabel } from '@/lib/utils';
import { monthLabel } from '@/lib/calendarDates';
import type { ProfitAndLossReport } from '@/services/profitAndLossExport';
import { InventoryPurchaseSummary } from './InventoryPurchaseSummary';
import '@/styles/financial.css';

const money = (value: number | null | undefined) => value == null ? 'Unavailable' : formatCurrency(value);
const deduction = (value: number | null | undefined) => value == null ? 'Unavailable' : `(${formatCurrency(value)})`;
const margin = (value: number | null) => value == null ? 'Margin unavailable' : `${value}% margin`;

function StatementRow({ label, value, total = false, final = false }: { label: string; value: string; total?: boolean; final?: boolean }) {
  return <div className={`statement-row${total ? ' statement-subtotal' : ''}${final ? ' statement-final' : ''}`}>
    <dt>{label}</dt><dd>{value}</dd>
  </div>;
}

/** Presentation uses the saved report snapshot; no totals are calculated here. */
export function ProfitAndLossStatement({ report, month, onReviewCosts }: { report: ProfitAndLossReport; month: string; onReviewCosts: () => void }) {
  const date = new Intl.DateTimeFormat(undefined, { timeZone: report.period.timezone, month: 'short', day: 'numeric', year: 'numeric' });
  const period = `${date.format(new Date(report.period.start))} – ${date.format(new Date(new Date(report.period.end).getTime() - Number(report.period.endExclusive)))}`;
  const hasIncompleteCosts = report.costCompleteness?.complete === false;
  // Units sold beyond recorded stock carry a provisional cost, flagged rather than treated as free.
  const estimatedCost = !hasIncompleteCosts && report.costCompleteness?.estimated ? report.costCompleteness.estimatedAmount ?? null : null;
  const hasPendingEarnings = report.earningsCompleteness?.complete === false;
  return <div className="financial-statement-view">
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 className="text-lg font-semibold">{month ? monthLabel(month) : 'Year to date'}</h2>
      <p className="text-xs text-muted-foreground">{period} · {report.period.timezone}</p>
    </div>
    <SummaryStrip emphasis items={[
      { label: 'Net sales', value: money(report.revenue.netSales), detail: 'Excluding sales tax' },
      { label: 'COGS', value: money(report.costOfGoodsSold), detail: hasIncompleteCosts ? 'Cost information incomplete' : estimatedCost !== null ? `Includes ${money(estimatedCost)} estimated cost` : 'Recorded inventory costs' },
      { label: 'Gross profit', value: money(report.grossProfit), detail: margin(report.margins.gross) },
      { label: 'Net income', value: money(report.netIncome), detail: margin(report.margins.net), tone: report.netIncome != null && report.netIncome < 0 ? 'danger' : 'default' },
    ]} />
    {(report.unavailableReason || hasIncompleteCosts || hasPendingEarnings) && <div className="financial-status" role="status">
      <AlertCircle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{hasIncompleteCosts ? 'Cost information incomplete' : hasPendingEarnings ? 'Lottery earnings pending' : 'Some figures are unavailable'}</p>
        {report.unavailableReason && <p className="mt-1 text-sm text-muted-foreground">{hasIncompleteCosts ? report.unavailableReason.replace(/^Cost information incomplete\.\s*/, '') : report.unavailableReason}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {hasIncompleteCosts && <Button variant="outline" onClick={onReviewCosts}>Review costs</Button>}
        {hasPendingEarnings && <Link className="page-action" to="/lottery?tab=reports">Review lottery earnings</Link>}
      </div>
    </div>}
    <DataPanel className="financial-statement-panel">
      <div className="financial-statement-heading">
        <h3 className="text-lg font-semibold">Profit &amp; Loss Statement</h3>
        <span className="text-xs text-muted-foreground">USD</span>
      </div>
      <div className="pnl-statement">
        <section aria-label="Revenue" className="statement-section">
          <h4>Revenue</h4>
          <dl>
            <StatementRow label="Sales before returns, excluding tax" value={money(report.revenue.grossSales)} />
            <StatementRow label="Less: Refunds, excluding tax" value={deduction(report.revenue.refunds)} />
            <StatementRow label="Voids deducted, excluding tax" value={deduction(report.revenue.voids)} />
            <StatementRow label="Net Sales" value={money(report.revenue.netSales)} total />
          </dl>
        </section>
        <section aria-label="Cost of sales" className="statement-section">
          <h4>Cost of sales</h4>
          <dl>
            {report.inventoryCostAdjustments !== undefined && report.inventoryCostAdjustments !== 0 && <>
              <StatementRow label="Recorded merchandise sold, net of returns" value={money(report.recordedSaleCosts)} />
              <StatementRow label="Inventory losses & purchase-cost adjustments" value={money(report.inventoryCostAdjustments)} />
            </>}
            <StatementRow label="Cost of goods sold" value={deduction(report.costOfGoodsSold)} />
            <StatementRow label="Gross Profit" value={money(report.grossProfit)} total />
          </dl>
        </section>
        <section aria-label="Operating expenses" className="statement-section">
          <h4>Operating Expenses</h4>
          <dl>
            {report.operatingExpenses.byCategory.map(expense => <StatementRow key={expense.category} label={formatEnumLabel(expense.category)} value={money(expense.amount)} />)}
            <StatementRow label="Total Operating Expenses" value={deduction(report.operatingExpenses.total)} total />
          </dl>
        </section>
        <dl className="statement-results">
          <StatementRow label="Other income (gaming/ATM and confirmed lottery earnings)" value={money(report.otherIncome)} />
          <StatementRow label="Net Income" value={money(report.netIncome)} final />
        </dl>
        <dl className="statement-margins">
          <div><dt>Gross Margin</dt><dd>{report.margins.gross == null ? 'Unavailable' : `${report.margins.gross}%`}</dd></div>
          <div><dt>Net Margin</dt><dd>{report.margins.net == null ? 'Unavailable' : `${report.margins.net}%`}</dd></div>
        </dl>
      </div>
      <div className="financial-statement-reference">
        <InventoryPurchaseSummary received={report.receivedInventoryPurchases} purchaseEntries={report.inventoryPurchases} />
        {report.historyWarning && <p className="mt-3 text-xs text-muted-foreground">{report.historyWarning}</p>}
      </div>
    </DataPanel>
  </div>;
}
