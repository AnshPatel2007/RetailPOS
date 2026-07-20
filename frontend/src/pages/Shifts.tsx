import React, { useState, useEffect } from 'react';
import { shiftService } from '@/services/api';
import { Shift } from '@/types';
import { formatCurrency, formatDateTime, formatTime } from '@/lib/utils';
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
import { Clock, LogIn, LogOut, Banknote, Printer, ArrowDownToLine, ArrowUpFromLine, Landmark } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Pagination } from '@/components/common/Pagination';
import { EmptyState } from '@/components/common/EmptyState';

export const Shifts: React.FC = () => {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [currentShift, setCurrentShift] = useState<Shift | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showClockInModal, setShowClockInModal] = useState(false);
  const [showClockOutModal, setShowClockOutModal] = useState(false);
  const [startingCash, setStartingCash] = useState('0');
  const [endingCash, setEndingCash] = useState('0');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    loadData();
  }, [page]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [currentResponse, shiftsResponse] = await Promise.all([
        shiftService.getCurrent().catch(() => ({ data: { data: null } })),
        shiftService.getAll({ page, limit: 20 }),
      ]);

      setCurrentShift(currentResponse.data.data || null);
      setShifts(shiftsResponse.data.data);
      setTotalPages(shiftsResponse.data.pagination?.totalPages || 1);
    } catch (error) {
      console.error('Failed to load shifts:', error);
      toast.error('Failed to load shifts');
    } finally {
      setIsLoading(false);
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

  // Cash movement modal (safe drop / paid in / paid out on the open shift)
  const [showMovementModal, setShowMovementModal] = useState(false);
  const [movementType, setMovementType] = useState<'SAFE_DROP' | 'PAID_IN' | 'PAID_OUT'>('SAFE_DROP');
  const [movementAmount, setMovementAmount] = useState('');
  const [movementReason, setMovementReason] = useState('');
  const [movementSubmitting, setMovementSubmitting] = useState(false);

  const MOVEMENT_TYPES = [
    { value: 'SAFE_DROP' as const, label: 'Safe Drop', icon: Landmark, hint: 'Cash pulled from the drawer to the safe' },
    { value: 'PAID_IN' as const, label: 'Paid In', icon: ArrowDownToLine, hint: 'Cash added to the drawer' },
    { value: 'PAID_OUT' as const, label: 'Paid Out', icon: ArrowUpFromLine, hint: 'Cash removed for an expense (vendor, supplies...)' },
  ];

  const handleCashMovement = async () => {
    const amount = parseFloat(movementAmount);
    if (!amount || amount <= 0) { toast.error('Enter a valid amount'); return; }
    if (!movementReason.trim()) { toast.error('A reason is required'); return; }
    setMovementSubmitting(true);
    try {
      const res = await shiftService.cashMovement({
        type: movementType,
        amount,
        reason: movementReason.trim(),
      });
      toast.success(res.data.message || 'Movement recorded');
      setShowMovementModal(false);
      setMovementAmount('');
      setMovementReason('');
      loadData();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to record movement');
    } finally {
      setMovementSubmitting(false);
    }
  };

  // Z-report: fetch the shift summary and open a printable receipt-style window
  const handlePrintZReport = async (shiftId: string) => {
    try {
      const res = await shiftService.getZReport(shiftId);
      const z = res.data.data;
      const line = (label: string, value: string, bold = false) =>
        `<tr${bold ? ' style="font-weight:bold;border-top:1px solid #000;"' : ''}><td>${label}</td><td style="text-align:right;">${value}</td></tr>`;
      const money = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `$${n.toFixed(2)}`);

      const tenderRows = Object.entries(z.tenderBreakdown as Record<string, { count: number; total: number }>)
        .map(([m, d]) => line(`${m.replace(/_/g, ' ')} (${d.count})`, money(d.total)))
        .join('');
      const movementRows = (z.cashMovements as any[])
        .map((m) =>
          line(
            `${m.type.replace(/_/g, ' ')} — ${m.reason}`,
            `${m.type === 'PAID_IN' ? '+' : '-'}${money(m.amount)}`
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
        <p class="center">${z.location || ''}<br/>${z.cashier}<br/>
        ${new Date(z.clockInAt).toLocaleString()} — ${z.clockOutAt ? new Date(z.clockOutAt).toLocaleString() : 'OPEN'}</p>
        <div class="rule"></div>
        <table>
          ${line('Transactions', String(z.totalTransactions))}
          ${line('Gross Sales', money(z.totalSales))}
          ${line('Tax Collected', money(z.totalTax))}
          ${line('Discounts', money(z.totalDiscount))}
        </table>
        <div class="rule"></div>
        <h3>TENDERS</h3>
        <table>${tenderRows || line('No sales', '')}</table>
        ${movementRows ? `<div class="rule"></div><h3>CASH MOVEMENTS</h3><table>${movementRows}</table>` : ''}
        <div class="rule"></div>
        <h3>DRAWER</h3>
        <table>
          ${line('Starting Cash', money(z.startingCash))}
          ${line('Cash Sales (net)', money(z.cashSales))}
          ${line('Movements (net)', money(z.cashMovementNet))}
          ${line('Expected', money(z.expectedCash), true)}
          ${line('Counted', money(z.endingCash))}
          ${line('Over / Short', money(z.cashDifference), true)}
        </table>
        <div class="rule"></div>
        <p class="center">Printed ${new Date().toLocaleString()}</p>
        <script>window.onload = function() { window.print(); }</script>
      </body></html>`;

      const win = window.open('', '_blank', 'width=400,height=700');
      if (win) {
        win.document.write(html);
        win.document.close();
      } else {
        toast.error('Popup blocked — allow popups to print the Z-report');
      }
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to load Z-report');
    }
  };

  const handleClockOut = async () => {
    if (!currentShift) return;

    try {
      const response = await shiftService.clockOut({
        endingCash: parseFloat(endingCash) || 0,
      });
      setShowClockOutModal(false);
      setEndingCash('0');
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

  return (
    <div className="p-8">
      <PageHeader
        title="Time & Shifts"
        subtitle="Manage employee shifts and cash drawers"
        actions={!currentShift ? (
          <Button variant="primary" onClick={() => setShowClockInModal(true)}>
            <LogIn className="h-4 w-4 mr-2" />
            Clock In
          </Button>
        ) : (
          <>
            <Button variant="outline" onClick={() => setShowMovementModal(true)}>
              <Banknote className="h-4 w-4 mr-2" />
              Cash Movement
            </Button>
            <Button variant="destructive" onClick={() => setShowClockOutModal(true)}>
              <LogOut className="h-4 w-4 mr-2" />
              Clock Out
            </Button>
          </>
        )}
      />

      {/* Shift Content */}
      <>
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
                <p className="text-sm text-muted-foreground mb-1">Total Sales</p>
                <p className="text-lg font-bold text-success">
                  {formatCurrency(currentShift.totalSales)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Transactions</p>
                <p className="text-lg font-bold">{currentShift.totalTransactions}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Expected in Drawer</p>
                <p className="text-lg font-bold text-primary">
                  {formatCurrency((currentShift as any).expectedDrawer ?? currentShift.startingCash)}
                </p>
              </div>
            </div>

            {/* Cash movements this shift */}
            {((currentShift as any).cashMovements?.length ?? 0) > 0 && (
              <div className="mt-4 pt-3 border-t">
                <p className="text-sm font-medium mb-2">Cash movements this shift</p>
                <div className="space-y-1">
                  {((currentShift as any).cashMovements as any[]).map((m) => (
                    <div key={m.id} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        {m.type.replace(/_/g, ' ')} — {m.reason}
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
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto"></div>
            <p className="mt-4 text-muted-foreground">Loading shifts...</p>
          </div>
        ) : shifts.length === 0 ? (
          <EmptyState
            icon={Clock}
            title="No shifts found"
            hint="Clock in to start your first shift"
          />
        ) : (
          <Table>
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
                      <span className="text-sm">{formatDateTime(shift.clockInAt)}</span>
                    </TableCell>
                    <TableCell>
                      {shift.clockOutAt ? (
                        <span className="text-sm">{formatDateTime(shift.clockOutAt)}</span>
                      ) : (
                        <Badge variant="success">Active</Badge>
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
                          className={
                            shift.cashDifference === 0
                              ? 'text-success'
                              : shift.cashDifference > 0
                              ? 'text-primary'
                              : 'text-destructive'
                          }
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
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handlePrintZReport(shift.id)}
                        title="Print Z-report"
                      >
                        <Printer className="h-4 w-4" />
                      </Button>
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
      >
        {currentShift && (
          <div className="space-y-4">
            <div className="p-4 bg-muted rounded-lg space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Starting Cash:</span>
                <span className="font-medium">
                  {formatCurrency(currentShift.startingCash)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Sales:</span>
                <span className="font-medium text-success">
                  {formatCurrency(currentShift.totalSales)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cash Sales (net):</span>
                <span className="font-medium">
                  {formatCurrency((currentShift as any).totalCashSales ?? currentShift.totalSales)}
                </span>
              </div>
              {((currentShift as any).cashMovementNet ?? 0) !== 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cash Movements (net):</span>
                  <span className="font-medium">
                    {formatCurrency((currentShift as any).cashMovementNet)}
                  </span>
                </div>
              )}
              <div className="flex justify-between font-bold pt-2 border-t">
                <span>Expected Cash in Drawer:</span>
                <span>
                  {formatCurrency(
                    (currentShift as any).expectedDrawer ??
                      currentShift.startingCash + ((currentShift as any).totalCashSales ?? currentShift.totalSales)
                  )}
                </span>
              </div>
            </div>

            <Input
              type="number"
              label="Ending Cash (Actual Count)"
              value={endingCash}
              onChange={(e) => setEndingCash(e.target.value)}
              step="0.01"
              autoFocus
            />

            {endingCash.trim() !== '' && !isNaN(parseFloat(endingCash)) && (() => {
              const expected =
                (currentShift as any).expectedDrawer ??
                currentShift.startingCash + ((currentShift as any).totalCashSales ?? currentShift.totalSales);
              const diff = parseFloat(endingCash) - expected;
              return (
                <div className="p-4 bg-primary/10 border border-primary rounded-lg">
                  <div className="flex justify-between items-center">
                    <span className="font-medium">Cash Difference:</span>
                    <span className={`text-xl font-bold ${Math.abs(diff) < 0.01 ? 'text-success' : 'text-destructive'}`}>
                      {formatCurrency(diff)}
                    </span>
                  </div>
                </div>
              );
            })()}

            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowClockOutModal(false)}
              >
                Cancel
              </Button>
              <Button variant="primary" className="flex-1" onClick={handleClockOut}>
                Clock Out
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Cash Movement Modal */}
      <Modal
        isOpen={showMovementModal}
        onClose={() => setShowMovementModal(false)}
        title="Cash Movement"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {MOVEMENT_TYPES.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => setMovementType(value)}
                className={`p-3 border-2 rounded-lg transition-all ${
                  movementType === value
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                <Icon className="h-5 w-5 mx-auto mb-1" />
                <p className="font-medium text-xs">{label}</p>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {MOVEMENT_TYPES.find((t) => t.value === movementType)?.hint}
          </p>

          <Input
            type="number"
            label="Amount"
            value={movementAmount}
            onChange={(e) => setMovementAmount(e.target.value)}
            step="0.01"
            min="0"
            placeholder="0.00"
            autoFocus
          />
          <Input
            label="Reason"
            value={movementReason}
            onChange={(e) => setMovementReason(e.target.value)}
            placeholder={movementType === 'SAFE_DROP' ? 'e.g. Drawer over $200' : 'e.g. Windex from vendor'}
          />

          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => setShowMovementModal(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              onClick={handleCashMovement}
              disabled={movementSubmitting || !movementAmount || !movementReason.trim()}
            >
              {movementSubmitting ? 'Saving...' : 'Record'}
            </Button>
          </div>
        </div>
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
                <p className="text-sm text-muted-foreground">Total Sales</p>
                <p className="text-xl font-bold text-success">{formatCurrency(shiftSummary.totalSales)}</p>
              </div>
              <div className="p-3 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Cash Difference</p>
                <p className={`text-xl font-bold ${Math.abs(shiftSummary.cashDifference) < 0.01 ? 'text-success' : 'text-destructive'}`}>
                  {formatCurrency(shiftSummary.cashDifference)}
                </p>
              </div>
            </div>

            {/* Payment Breakdown */}
            <div className="border rounded-lg overflow-hidden">
              <div className="p-3 bg-muted font-medium text-sm">Payment Breakdown</div>
              <div className="divide-y">
                {Object.entries(shiftSummary.paymentBreakdown).map(([method, data]: [string, any]) => (
                  <div key={method} className="flex justify-between items-center px-3 py-2 text-sm">
                    <span>{method.replace(/_/g, ' ')}</span>
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
                <div className="flex justify-between"><span>Cash Sales (net)</span><span>+{formatCurrency(shiftSummary.cashSales)}</span></div>
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

            <Button variant="primary" className="w-full" onClick={() => setShowSummaryModal(false)}>
              Done
            </Button>
          </div>
        )}
      </Modal>
      </>
    </div>
  );
};
