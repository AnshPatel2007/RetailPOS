import { useCalendarTimezone } from '@/hooks/useCalendarTimezone';
import { printHtml } from '@/lib/print';
import { ManagementPage } from '@/components/common/Workspace';
import { useLegacyPageRefresh } from '@/hooks/useLegacyPageRefresh';
import React, { useState, useEffect, useRef } from 'react';
import { shiftService } from '@/services/api';
import { Shift } from '@/types';
import { formatCurrency, formatDateTime, formatTime, cn, formatEnumLabel } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import toast from 'react-hot-toast';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/Table';
import { Clock, LogIn, LogOut, Printer } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Pagination } from '@/components/common/Pagination';
import { EmptyState } from '@/components/common/EmptyState';
import { useEffectiveLocation } from '@/hooks/useEffectiveLocation';
import { useUrlPage } from '@/hooks/useUrlFilter';
import { can } from '@/lib/capabilities';
import { useAuthStore } from '@/store/authStore';
import { cashOperationKey, cashOperationRejected, readCashOperation, PendingCashOperation } from '@/services/pendingCashOperation';
import { currentPaymentSession } from '@/services/paymentSession';
import { Spinner } from '@/components/ui/LoadingState';
import { Alert } from '@/components/ui/Alert';
import { DrawerCountHelper } from '@/components/shifts/DrawerCountHelper';

/** Drawer over/short colors: even is green, over is amber, short is red. */
const overShortTone = (difference: number) => Math.abs(difference) < 0.005 ? 'text-success' : difference > 0 ? 'text-warning' : 'text-destructive';

export const Shifts: React.FC = () => {
  const timezone = useCalendarTimezone();
  const user = useAuthStore(state => state.user);
  const { locationId } = useEffectiveLocation();
  const canClock = can(user?.role, 'shift.own');
  const requestVersion = useRef(0);
  const [loadError, setLoadError] = useState('');
  const pendingKey = cashOperationKey('movement', user?.id, user?.locationId);
  const [pendingMovement, setPendingMovement] = useState<PendingCashOperation | null>(() => readCashOperation(pendingKey));
  useEffect(() => { setPendingMovement(readCashOperation(pendingKey)); }, [pendingKey]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [currentShift, setCurrentShift] = useState<Shift | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showClockInModal, setShowClockInModal] = useState(false);
  const [showClockOutModal, setShowClockOutModal] = useState(false);
  const [startingCash, setStartingCash] = useState('0');
  const [endingCash, setEndingCash] = useState('');
  const [page, setPage] = useUrlPage();
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    loadData();
    return () => { requestVersion.current++; };
  }, [page, locationId]);

  const loadData = async (quiet = false, active: () => boolean = () => true, signal?: AbortSignal) => {
    const version = ++requestVersion.current; if (!quiet) setLoadError('');
    if (!quiet) setIsLoading(true);
    try {
      const [currentResponse, shiftsResponse] = await Promise.all([
        canClock ? shiftService.getCurrent(signal) : Promise.resolve({ data: { data: null } }),
        shiftService.getAll({ locationId, page, limit: 20 }, signal),
      ]);

      if (version !== requestVersion.current || !active()) return;
      setLoadError('');
      setCurrentShift(currentResponse.data.data || null);
      setShifts(shiftsResponse.data.data);
      setTotalPages(shiftsResponse.data.pagination?.totalPages || 1);
    } catch (error) {
      if (quiet) throw error;
      if (version === requestVersion.current) { setCurrentShift(null); setShifts([]); setLoadError('Unable to load shifts. Try again.'); }
    } finally {
      if (version === requestVersion.current) setIsLoading(false);
    }
  };

  const handleClockIn = async () => {
    try {
      await shiftService.clockIn({
        startingCash: parseFloat(startingCash) || 0,
      });
      setShowClockInModal(false);
      setStartingCash('0');
      loadData();
      toast.success('Clocked in successfully');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to clock in');
    }
  };

  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [shiftSummary, setShiftSummary] = useState<any>(null);

  // Keep recovery available for requests saved before the movement control was removed.
  const [movementSubmitting, setMovementSubmitting] = useState(false);

  const submitCashMovement = async (operation: PendingCashOperation) => {
    if (movementSubmitting) return;
    setMovementSubmitting(true);
    try {
      localStorage.setItem(pendingKey, JSON.stringify(operation));
      setPendingMovement(operation);
      const res = await shiftService.cashMovement(operation.payload as { type: string; amount: number; reason: string; idempotencyKey: string });
      localStorage.removeItem(pendingKey);
      setPendingMovement(null);
      toast.success(res.data.message || 'Movement recorded');
      loadData();
    } catch (error: any) {
      if (cashOperationRejected(error)) { localStorage.removeItem(pendingKey); setPendingMovement(null); }
      toast.error(error.response?.data?.error || 'Movement result is unconfirmed. Retry the saved request; do not move the cash again.');
    } finally {
      setMovementSubmitting(false);
    }
  };

  // Z-report: fetch the shift summary and open a printable receipt-style window
  const handlePrintZReport = async (shiftId: string) => {
    try {
      const res = await shiftService.getZReport(shiftId);
      const z = res.data.data;
      const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
      const line = (label: string, value: string, bold = false) =>
        `<tr${bold ? ' style="font-weight:bold;border-top:1px solid #000;"' : ''}><td>${escapeHtml(label)}</td><td style="text-align:right;">${escapeHtml(value)}</td></tr>`;
      const money = (n: number | null | undefined) => (n === null || n === undefined ? '—' : formatCurrency(n));

      const tenderRows = Object.entries(z.tenderBreakdown as Record<string, { count: number; total: number }>)
        .map(([m, d]) => line(`${formatEnumLabel(m)} (${d.count})`, money(d.total)))
        .join('');
      const movementRows = (z.cashMovements as any[])
        .map((m) =>
          line(
            `${formatEnumLabel(m.type)} — ${m.reason}`,
            money(m.type === 'PAID_IN' ? m.amount : -m.amount)
          )
        )
        .join('');

      const html = `<!DOCTYPE html><html><head><title>Z-Report</title><style>
        body { font-family: 'Courier New', monospace; font-size: 12px; width: 300px; margin: 0 auto; padding: 12px; }
        h2, h3 { text-align: center; margin: 4px 0; }
        table { width: 100%; border-collapse: collapse; }
        td { padding: 2px 0; vertical-align: top; }
        .rule { border-top: 1px dashed #000; margin: 8px 0; }
        .center { text-align: center; }
      </style></head><body>
        <h2>Z-REPORT</h2>
        <p class="center">${escapeHtml(z.location || '')}<br/>${escapeHtml(z.cashier)}<br/>
        ${formatDateTime(z.clockInAt, timezone)} — ${z.clockOutAt ? formatDateTime(z.clockOutAt, timezone) : 'Still open'}</p>
        <div class="rule"></div>
        <table>
          ${line('Transactions', String(z.totalTransactions))}
          ${line('Original sales (incl. tax)', money(z.totalSales))}
          ${line('Original sale tax', money(z.totalTax))}
          ${line('Discounts', money(z.totalDiscount))}
        </table>
        <div class="rule"></div>
        <h3>ORIGINAL SALE TENDERS</h3>
        <table>${tenderRows || line('No sales', '')}</table>
        ${movementRows ? `<div class="rule"></div><h3>CASH MOVEMENTS</h3><table>${movementRows}</table>` : ''}
        <div class="rule"></div>
        <h3>DRAWER</h3>
        <table>
          ${line('Starting Cash', money(z.startingCash))}
          ${line('Cash Sales (after change)', money(z.cashSales))}
          ${line('Cash Refunds', money(z.cashRefunds == null ? null : -z.cashRefunds))}
          ${line('Cash Voids', money(z.cashVoids == null ? null : -z.cashVoids))}
          ${line('Gift Card Cash Funding', money(z.cashGiftFunding))}
          ${line('House Account Cash Payments', money(z.cashHousePayments))}
          ${line('Movements (net)', money(z.cashMovementNet))}
          ${line('Expected', money(z.expectedCash), true)}
          ${line('Counted', money(z.endingCash))}
          ${line('Over / Short', money(z.cashDifference), true)}
        </table>
        ${z.reconciliationWarning ? `<p>${escapeHtml(z.reconciliationWarning)}</p>` : ''}
        <div class="rule"></div>
        <p class="center">Printed ${formatDateTime(new Date(), timezone)}</p>
      </body></html>`;

      if (!await printHtml(html)) toast.error('The Z-report could not be sent to the printer. Try again.');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to load Z-report');
    }
  };

  const handleClockOut = async () => {
    if (!currentShift) return;
    if (!endingCash.trim() || !Number.isFinite(Number(endingCash)) || Number(endingCash) < 0) {
      toast.error('Enter the actual cash count, including 0 for an empty drawer.'); return;
    }

    try {
      if (user?.id && locationId && await currentPaymentSession(user.id, locationId)) {
        toast.error('Finish or reverse the unfinished payment in POS before closing this drawer.'); return;
      }
      const response = await shiftService.clockOut({
        endingCash: parseFloat(endingCash) || 0,
      });
      setShowClockOutModal(false);
      setEndingCash('');
      // Show shift summary
      const summary = response.data?.data?.shiftSummary;
      if (summary) {
        setShiftSummary(summary);
        setShowSummaryModal(true);
      } else {
        toast.success('Clocked out successfully');
      }
      await loadData();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to clock out');
    }
  };

  const autoRefresh = useLegacyPageRefresh((current, signal) => loadData(true, current, signal), { key: JSON.stringify([locationId, page]), paused: isLoading });

  return (
    <ManagementPage className="">
      <PageHeader
        title={user?.role === 'CASHIER' ? 'My Shift' : 'Time & Shifts'}
        subtitle="Manage employee shifts and cash drawers"
        actions={!canClock || isLoading || loadError ? null : !currentShift ? (
          <Button variant="primary" onClick={() => setShowClockInModal(true)}>
            <LogIn className="h-4 w-4 mr-2" />
            Clock In
          </Button>
        ) : (
          <Button variant="outline" onClick={() => setShowClockOutModal(true)}>
            <LogOut className="h-4 w-4 mr-2" />
            Clock Out
          </Button>
        )}
      />
      {autoRefresh.notice}
      {pendingMovement && <div role="status" className="mb-4 p-3 rounded-lg border border-warning/40 bg-warning/10 space-y-2">
        <p>Saved cash movement: {formatEnumLabel(pendingMovement.label)} {formatCurrency(pendingMovement.amount)}. Retry to confirm the recorded result. Do not move the cash twice.</p>
        <Button onClick={() => submitCashMovement(pendingMovement)} disabled={movementSubmitting}>Retry saved cash movement</Button>
      </div>}

      {/* Shift Content */}
      <>
          {loadError && <div role="alert" className="border rounded p-4 mb-4"><p>{loadError}</p><Button onClick={() => void loadData()} variant="outline">Retry</Button></div>}
      {/* Current Shift */}
      {currentShift && (
        <Card className="mb-6 bg-primary/5 border-primary">
          <CardHeader>
            <CardTitle className="flex items-center">
              <Clock className="h-5 w-5 mr-2" />
              Current Shift
            </CardTitle>
          </CardHeader>
          <CardContent>
            {currentShift.reconciliationWarning && <p role="status" className="mb-4 text-sm text-warning">{currentShift.reconciliationWarning}</p>}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Clocked In</p>
                <p className="text-lg font-bold">{formatTime(currentShift.clockInAt)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Starting Cash</p>
                <p className="text-lg font-bold">
                  {formatCurrency(currentShift.startingCash)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Original Sales (incl. tax)</p>
                <p className="text-lg font-bold text-success">
                  {formatCurrency(currentShift.totalSales)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Transactions</p>
                <p className="text-lg font-bold">{currentShift.totalTransactions}</p>
              </div>
              {!currentShift.blindClose && <>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Expected in Drawer</p>
                <p className="text-lg font-bold text-primary">
                  {formatCurrency((currentShift as any).expectedDrawer ?? currentShift.startingCash)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Cash Refunds &amp; Voids Paid</p>
                <p className="text-lg font-bold tabular-nums">{formatCurrency((currentShift.cashRefunds || 0) + (currentShift.cashVoids || 0))}</p>
              </div>
              </>}
            </div>

            {currentShift.blindClose
              ? <p className="border-t pt-4 mt-4 text-sm text-muted-foreground">When you clock out, count the drawer and enter the total. The expected amount and any difference show after you close.</p>
              : <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t pt-4 mt-4">
              <div><p className="text-sm text-muted-foreground">Gift Card Cash Funding</p><p className="font-bold tabular-nums">{formatCurrency(currentShift.cashGiftFunding || 0)}</p></div>
              <div><p className="text-sm text-muted-foreground">House Account Cash Payments</p><p className="font-bold tabular-nums">{formatCurrency(currentShift.cashHousePayments || 0)}</p></div>
            </div>}
            {/* Cash movements this shift */}
            {((currentShift as any).cashMovements?.length ?? 0) > 0 && (
              <div className="mt-4 pt-3 border-t">
                <p className="text-sm font-medium mb-2">Cash movements this shift</p>
                <div className="space-y-1">
                  {((currentShift as any).cashMovements as any[]).map((m) => (
                    <div key={m.id} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        {formatEnumLabel(m.type)} — {m.reason}
                      </span>
                      <span className={`font-medium tabular-nums ${m.type === 'PAID_IN' ? 'text-success' : 'text-warning'}`}>
                        {m.type === 'PAID_IN' ? '+' : '-'}{formatCurrency(m.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Shift History */}
      <Card>
        <CardHeader>
          <CardTitle>Shift History</CardTitle>
        </CardHeader>
        {isLoading ? (
          <div className="p-8 text-center">
            <Spinner size="lg" className="mx-auto" />
            <p className="mt-4 text-muted-foreground">Loading shifts...</p>
          </div>
        ) : shifts.length === 0 ? (
          <EmptyState
            icon={Clock}
            title="No shifts found"
            hint="Clock in to start your first shift"
          />
        ) : (
          <Table scrollLabel="Shifts records">
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Clock In</TableHead>
                <TableHead>Clock Out</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Sales</TableHead>
                <TableHead>Transactions</TableHead>
                <TableHead>Cash Diff</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Z-Report</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shifts.map((shift) => {
                const durationMs = shift.clockOutAt
                  ? new Date(shift.clockOutAt).getTime() - new Date(shift.clockInAt).getTime()
                  : 0;
                const durationHours = Math.floor(durationMs / (1000 * 60 * 60));
                const durationMins = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));

                return (
                  <TableRow key={shift.id}>
                    <TableCell>
                      {shift.user && (
                        <p className="font-medium">
                          {shift.user.firstName} {shift.user.lastName}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{formatDateTime(shift.clockInAt, timezone)}</span>
                    </TableCell>
                    <TableCell>
                      {shift.clockOutAt ? (
                        <span className="text-sm">{formatDateTime(shift.clockOutAt, timezone)}</span>
                      ) : (
                        // Status already says Active; repeating it here read as two states.
                        <span className="text-sm text-muted-foreground" aria-label="Still open">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {shift.clockOutAt ? (
                        <span>{durationHours}h {durationMins}m</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">
                        {formatCurrency(shift.totalSales)}
                      </span>
                    </TableCell>
                    <TableCell>{shift.totalTransactions}</TableCell>
                    <TableCell>
                      {shift.cashDifference !== null ? (
                        <span
                          className={overShortTone(shift.cashDifference)}
                        >
                          {formatCurrency(shift.cashDifference)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {shift.isClosed ? (
                        <Badge variant="secondary">Closed</Badge>
                      ) : (
                        <Badge variant="success">Active</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {/* Blind close: the report states the expected cash, so it waits until the drawer is counted. */}
                      {currentShift?.blindClose && !shift.isClosed ? (
                        <span className="text-xs text-muted-foreground">After closing</span>
                      ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handlePrintZReport(shift.id)}
                        title="Print Z-report"
                      >
                        <Printer className="h-4 w-4" />
                      </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />

      {/* Clock In Modal */}
      <Modal
        isOpen={showClockInModal}
        onClose={() => setShowClockInModal(false)}
        title="Clock In"
      >
        <div className="space-y-4">
          <p className="text-muted-foreground">
            Enter the starting cash in your drawer to begin your shift.
          </p>

          <Input
            type="number"
            label="Starting Cash"
            value={startingCash}
            onChange={(e) => setStartingCash(e.target.value)}
            step="0.01"
            autoFocus
          />

          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setShowClockInModal(false)}
            >
              Cancel
            </Button>
            <Button variant="primary" className="flex-1" onClick={handleClockIn}>
              Clock In
            </Button>
          </div>
        </div>
      </Modal>

      {/* Clock Out Modal */}
      <Modal
        isOpen={showClockOutModal}
        onClose={() => setShowClockOutModal(false)}
        title="Clock Out"
        description="Count the cash in the drawer and enter the total."
        footer={<div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setShowClockOutModal(false)}>Cancel</Button>
          <Button type="submit" form="clock-out-form" disabled={!endingCash.trim()}>Clock Out</Button>
        </div>}
      >
        {currentShift && (() => {
          const shift = currentShift as typeof currentShift & { totalCashSales?: number; cashMovementNet?: number; expectedDrawer?: number };
          const expected = shift.blindClose ? null : shift.expectedDrawer ?? (shift.totalCashSales == null ? null : shift.startingCash + shift.totalCashSales);
          // Only lines that moved money are shown; zero rows were noise.
          const lines: [string, number][] = [
            ['Cash sales (after change)', shift.totalCashSales ?? 0],
            ['Cash refunds & voids paid', -((shift.cashRefunds || 0) + (shift.cashVoids || 0))],
            ['Gift card cash funding', shift.cashGiftFunding || 0],
            ['House account cash payments', shift.cashHousePayments || 0],
            ['Cash movements (net)', shift.cashMovementNet ?? 0],
          ];
          const counted = endingCash.trim() !== '' && Number.isFinite(Number(endingCash)) ? Number(endingCash) : null;
          const diff = counted === null || expected === null ? null : Math.round((counted - expected) * 100) / 100;
          return (
            <form id="clock-out-form" className="space-y-4" onSubmit={event => { event.preventDefault(); void handleClockOut(); }}>
              {shift.reconciliationWarning && <Alert tone="warning">{shift.reconciliationWarning}</Alert>}
              {shift.blindClose && <Alert tone="info">Count everything in the drawer and enter the total. The expected amount and any difference show after you close.</Alert>}
              {!shift.blindClose && <div className="rounded-lg border">
                <div className="flex items-baseline justify-between gap-3 border-b px-4 py-3">
                  <span className="text-sm font-medium">Expected in drawer</span>
                  <span className="text-xl font-semibold tabular-nums">{expected === null ? 'Unavailable' : formatCurrency(expected)}</span>
                </div>
                <dl className="space-y-1 px-4 py-3 text-sm">
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Starting cash</dt><dd className="tabular-nums">{formatCurrency(shift.startingCash)}</dd></div>
                  {lines.filter(([, amount]) => Math.abs(amount) >= 0.005).map(([label, amount]) => (
                    <div key={label} className="flex justify-between gap-3"><dt className="text-muted-foreground">{label}</dt><dd className="tabular-nums">{amount < 0 ? '−' + formatCurrency(-amount) : formatCurrency(amount)}</dd></div>
                  ))}
                </dl>
                <p className="border-t px-4 py-2 text-xs text-muted-foreground">All sales this shift, any payment type: {formatCurrency(shift.totalSales)}</p>
              </div>}

              <Input
                type="number"
                label="Counted cash"
                value={endingCash}
                onChange={(e) => setEndingCash(e.target.value)}
                step="0.01"
                min="0"
                placeholder="0.00"
                inputMode="decimal"
                autoFocus
              />
              <DrawerCountHelper onTotal={setEndingCash} />

              {diff !== null && !shift.blindClose && (
                <div role="status" className={cn('flex items-center justify-between rounded-lg border px-4 py-3',
                  Math.abs(diff) < 0.01 ? 'border-success/40 bg-success/10' : 'border-warning/40 bg-warning/10')}>
                  <span className="text-sm font-medium">{Math.abs(diff) < 0.01 ? 'Drawer balances' : diff > 0 ? 'Drawer is over by' : 'Drawer is short by'}</span>
                  {Math.abs(diff) >= 0.01 && <span className="text-lg font-semibold tabular-nums">{formatCurrency(Math.abs(diff))}</span>}
                </div>
              )}
            </form>
          );
        })()}
      </Modal>

      {/* Shift Summary Modal */}
      <Modal
        isOpen={showSummaryModal}
        onClose={() => setShowSummaryModal(false)}
        title="Shift Summary"
        size="lg"
      >
        {shiftSummary && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Duration</p>
                <p className="text-xl font-bold">{shiftSummary.duration}h</p>
              </div>
              <div className="p-3 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Transactions</p>
                <p className="text-xl font-bold">{shiftSummary.totalTransactions}</p>
              </div>
              <div className="p-3 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Original Sales (incl. tax)</p>
                <p className="text-xl font-bold text-success">{formatCurrency(shiftSummary.totalSales)}</p>
              </div>
              <div className="p-3 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Cash Difference</p>
                <p className={`text-xl font-bold ${overShortTone(shiftSummary.cashDifference)}`}>
                  {formatCurrency(shiftSummary.cashDifference)}
                </p>
              </div>
            </div>

            {/* Payment Breakdown */}
            <div className="border rounded-lg overflow-hidden">
              <div className="p-3 bg-muted font-medium text-sm">Original Sale Tenders</div>
              <div className="divide-y">
                {Object.entries(shiftSummary.paymentBreakdown).map(([method, data]: [string, any]) => (
                  <div key={method} className="flex justify-between items-center px-3 py-2 text-sm">
                    <span>{formatEnumLabel(method)}</span>
                    <div className="text-right">
                      <span className="font-medium">{formatCurrency(data.total)}</span>
                      <span className="text-muted-foreground ml-2">({data.count} txn{data.count !== 1 ? 's' : ''})</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Cash Reconciliation */}
            <div className="border rounded-lg overflow-hidden">
              <div className="p-3 bg-muted font-medium text-sm">Cash Reconciliation</div>
              <div className="p-3 space-y-1 text-sm">
                <div className="flex justify-between"><span>Starting Cash</span><span>{formatCurrency(shiftSummary.startingCash)}</span></div>
                <div className="flex justify-between"><span>Cash Sales (after change)</span><span>+{formatCurrency(shiftSummary.cashSales)}</span></div>
                <div className="flex justify-between"><span>Cash Refunds Paid</span><span>-{formatCurrency(shiftSummary.cashRefunds)}</span></div>
                <div className="flex justify-between"><span>Cash Voids Paid</span><span>-{formatCurrency(shiftSummary.cashVoids)}</span></div>
                <div className="flex justify-between"><span>Gift Card Cash Funding</span><span>{formatCurrency(shiftSummary.cashGiftFunding || 0)}</span></div>
                <div className="flex justify-between"><span>House Account Cash Payments</span><span>{formatCurrency(shiftSummary.cashHousePayments || 0)}</span></div>
                {(shiftSummary.cashMovementNet ?? 0) !== 0 && (
                  <div className="flex justify-between"><span>Cash Movements (net)</span><span>{formatCurrency(shiftSummary.cashMovementNet)}</span></div>
                )}
                <div className="flex justify-between font-medium border-t pt-1"><span>Expected</span><span>{formatCurrency(shiftSummary.expectedCash)}</span></div>
                <div className="flex justify-between"><span>Actual Count</span><span>{formatCurrency(shiftSummary.endingCash)}</span></div>
                <div className="flex justify-between font-bold border-t pt-1">
                  <span>Difference</span>
                  <span className={Math.abs(shiftSummary.cashDifference) < 0.01 ? 'text-success' : 'text-destructive'}>
                    {formatCurrency(shiftSummary.cashDifference)}
                  </span>
                </div>
              </div>
            </div>
            {shiftSummary.reconciliationWarning && <p className="text-sm text-warning">{shiftSummary.reconciliationWarning}</p>}
            <Button variant="primary" className="w-full" onClick={() => setShowSummaryModal(false)}>
              Done
            </Button>
          </div>
        )}
      </Modal>
      </>
    </ManagementPage>
  );
};
