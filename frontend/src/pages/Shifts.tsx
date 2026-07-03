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
import { Clock, LogIn, LogOut } from 'lucide-react';

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
    } finally {
      setIsLoading(false);
    }
  };

  const handleClockIn = async () => {
    try {
      await shiftService.clockIn({
        startingCash: parseFloat(startingCash),
      });
      setShowClockInModal(false);
      setStartingCash('0');
      loadData();
      toast.success('Clocked in successfully');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to clock in');
    }
  };

  const handleClockOut = async () => {
    if (!currentShift) return;

    try {
      await shiftService.clockOut({
        endingCash: parseFloat(endingCash),
      });
      setShowClockOutModal(false);
      setEndingCash('0');
      await loadData(); // Reload data to update UI state
      toast.success('Clocked out successfully');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to clock out');
    }
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">Time & Shifts</h1>
          <p className="text-muted-foreground">
            Manage employee shifts and cash drawers
          </p>
        </div>
        {!currentShift ? (
          <Button variant="primary" onClick={() => setShowClockInModal(true)}>
            <LogIn className="h-4 w-4 mr-2" />
            Clock In
          </Button>
        ) : (
          <Button variant="destructive" onClick={() => setShowClockOutModal(true)}>
            <LogOut className="h-4 w-4 mr-2" />
            Clock Out
          </Button>
        )}
      </div>

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
            </div>
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
          <div className="p-12 text-center">
            <Clock className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No shifts found</h3>
            <p className="text-muted-foreground">Clock in to start your first shift</p>
          </div>
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
                      ) : shift.clockOutAt ? (
                        <Badge variant="warning">Pending Close</Badge>
                      ) : (
                        <Badge variant="success">Active</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
          <span className="px-3 py-1 text-sm text-muted-foreground">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next</Button>
        </div>
      )}

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
              <div className="flex justify-between font-bold pt-2 border-t">
                <span>Expected Cash in Drawer:</span>
                <span>
                  {formatCurrency(currentShift.startingCash + ((currentShift as any).totalCashSales ?? currentShift.totalSales))}
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

            {parseFloat(endingCash) > 0 && (
              <div className="p-4 bg-primary/10 border border-primary rounded-lg">
                <div className="flex justify-between items-center">
                  <span className="font-medium">Cash Difference:</span>
                  <span
                    className={`text-xl font-bold ${
                      Math.abs(parseFloat(endingCash) -
                        (currentShift.startingCash + ((currentShift as any).totalCashSales ?? currentShift.totalSales))) < 0.01
                        ? 'text-success'
                        : 'text-destructive'
                    }`}
                  >
                    {formatCurrency(
                      parseFloat(endingCash) -
                        (currentShift.startingCash + ((currentShift as any).totalCashSales ?? currentShift.totalSales))
                    )}
                  </span>
                </div>
              </div>
            )}

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
      </>
    </div>
  );
};
