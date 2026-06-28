import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { logger } from '../../utils/logger';
import {
  Lock,
  Calendar,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { lotteryService } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';

interface DailyEntryTableProps {
  locationId?: string;
  isReadOnly?: boolean;
  onUpdate?: () => void;
}

interface TicketType {
  id: string;
  ticketName: string;
  ticketCode: string;
  pricePerTicket: number;
  sortOrder: number;
}

interface DailyEntryRow {
  ticketTypeId: string;
  ticketName: string;
  ticketCode: string;
  pricePerTicket: number;
  openNumber: number;
  closeNumber: number;
  ticketsSold: number;
  total: number;
  entryId?: string;
  suggestedOpenNumber?: number | null;
  error?: string;
}

interface DayStatus {
  id?: string;
  totalTicketsSold: number;
  totalSales: number;
  manualCashoutAmount: number;
  netAmount: number;
  isClosed: boolean;
  closedAt?: string;
  closedBy?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export const DailyEntryTable: React.FC<DailyEntryTableProps> = ({
  locationId,
  isReadOnly = false,
  onUpdate,
}) => {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [entries, setEntries] = useState<DailyEntryRow[]>([]);
  const [dayStatus, setDayStatus] = useState<DayStatus>({
    totalTicketsSold: 0,
    totalSales: 0,
    manualCashoutAmount: 0,
    netAmount: 0,
    isClosed: false,
  });
  const [cashoutAmount, setCashoutAmount] = useState('0');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showSuccessToast, setShowSuccessToast] = useState(false);

  // Helper to check if selected date is in the past
  const isPastDate = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return selectedDate < today;
  }, [selectedDate]);

  // Refs for keyboard navigation
  const closeInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});
  const cashoutInputRef = useRef<HTMLInputElement>(null);
  const autoSaveTimerRef = useRef<NodeJS.Timeout>();

  // Log component mount
  useEffect(() => {
    logger.info('DailyEntryTable component mounted', {
      locationId,
      selectedDate,
      user: user?.email,
    });
    return () => {
      logger.info('DailyEntryTable component unmounted');
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    loadDailyData();
  }, [selectedDate, locationId]);

  // Auto-save functionality - immediate save after changes
  useEffect(() => {
    if (hasUnsavedChanges && !dayStatus.isClosed && !isReadOnly) {
      logger.debug('Scheduling auto-save', { delay: '500ms' });

      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }

      autoSaveTimerRef.current = setTimeout(() => {
        logger.info('Auto-save triggered');
        handleAutoSave();
      }, 500); // Auto-save after 500ms of inactivity (immediate feel)

      return () => {
        if (autoSaveTimerRef.current) {
          clearTimeout(autoSaveTimerRef.current);
        }
      };
    }
  }, [hasUnsavedChanges, entries, cashoutAmount]);

  const loadDailyData = async () => {
    const startTime = performance.now();
    logger.info('Loading daily lottery data', {
      selectedDate,
      locationId,
      user: user?.email,
    });

    setLoading(true);
    try {
      const params: any = { entryDate: selectedDate };
      if (locationId) {
        params.locationId = locationId;
      }

      logger.debug('Fetching ticket types');
      const ticketTypesRes = await lotteryService.getTicketTypes({
        ...params,
        isActive: 'true',
      });
      const ticketTypes: TicketType[] = ticketTypesRes.data.data || [];
      logger.info('Ticket types loaded', { count: ticketTypes.length });

      logger.debug('Fetching carry-forward data');
      const carryForwardRes = await lotteryService.getCarryForwardInfo(params);
      const carryForwardData = carryForwardRes.data.data || [];
      logger.info('Carry-forward data loaded', { count: carryForwardData.length });

      logger.debug('Fetching existing entries');
      const entriesRes = await lotteryService.getDailyEntries(params);
      const existingEntries = entriesRes.data.data || [];
      logger.info('Existing entries loaded', { count: existingEntries.length });

      logger.debug('Fetching day status');
      const dayStatusRes = await lotteryService.getDayStatus(params);
      const status = dayStatusRes.data.data;
      logger.info('Day status loaded', {
        isClosed: status?.isClosed,
        totalSales: status?.totalSales,
      });

      // Combine data into rows
      const rows: DailyEntryRow[] = ticketTypes.map((tt) => {
        const carryForward = carryForwardData.find((cf: any) => cf.ticketTypeId === tt.id);
        const existing = existingEntries.find((e: any) => e.ticketTypeId === tt.id);

        const openNumber = existing?.startNumber ?? carryForward?.suggestedStartNumber ?? 0;
        const closeNumber = existing?.endNumber ?? carryForward?.suggestedStartNumber ?? 0;
        const ticketsSold = closeNumber - openNumber;
        const total = ticketsSold * tt.pricePerTicket;

        return {
          ticketTypeId: tt.id,
          ticketName: tt.ticketName,
          ticketCode: tt.ticketCode,
          pricePerTicket: tt.pricePerTicket,
          openNumber,
          closeNumber,
          ticketsSold,
          total,
          entryId: existing?.id,
          suggestedOpenNumber: carryForward?.suggestedStartNumber,
        };
      });

      setEntries(rows);
      logger.info('Entry rows prepared', { rowCount: rows.length });

      if (status) {
        setDayStatus({
          id: status.id,
          totalTicketsSold: status.totalTicketsSold || 0,
          totalSales: status.totalSales || 0,
          manualCashoutAmount: status.manualCashoutAmount || 0,
          netAmount: status.netAmount || 0,
          isClosed: status.isClosed || false,
          closedAt: status.closedAt,
          closedBy: status.closedBy?.email,
          updatedAt: status.updatedAt,
          updatedBy: status.updatedBy?.email,
        });
        setCashoutAmount(String(status.manualCashoutAmount || 0));
      } else {
        // Calculate totals from entries
        const totalTickets = rows.reduce((sum, row) => sum + row.ticketsSold, 0);
        const totalSales = rows.reduce((sum, row) => sum + row.total, 0);
        setDayStatus({
          totalTicketsSold: totalTickets,
          totalSales,
          manualCashoutAmount: 0,
          netAmount: totalSales,
          isClosed: false,
        });
        setCashoutAmount('0');
      }

      setHasUnsavedChanges(false);
      const loadTime = performance.now() - startTime;
      logger.info('Daily data loaded successfully', {
        loadTime: `${loadTime.toFixed(2)}ms`,
        entriesCount: rows.length,
      });
    } catch (error: any) {
      logger.error('Failed to load daily data', {
        error: error.message,
        stack: error.stack,
        selectedDate,
        locationId,
      });
      toast.error('Failed to load daily data');
    } finally {
      setLoading(false);
    }
  };

  const validateEntry = useCallback((row: DailyEntryRow): string | undefined => {
    if (row.closeNumber < row.openNumber) {
      return 'Close number must be >= open number';
    }
    if (row.closeNumber < 0 || row.openNumber < 0) {
      return 'Numbers cannot be negative';
    }
    return undefined;
  }, []);

  const handleCloseNumberChange = useCallback((ticketTypeId: string, value: string) => {
    const numValue = parseFloat(value) || 0;
    logger.debug('Close number changed', {
      ticketTypeId,
      newValue: numValue,
      user: user?.email,
    });

    setEntries((prev) =>
      prev.map((row) => {
        if (row.ticketTypeId === ticketTypeId) {
          const closeNumber = numValue;
          const ticketsSold = Math.max(0, closeNumber - row.openNumber);
          const total = ticketsSold * row.pricePerTicket;
          const updatedRow = {
            ...row,
            closeNumber,
            ticketsSold,
            total,
          };
          const error = validateEntry(updatedRow);

          if (error) {
            logger.warn('Validation error on close number change', {
              ticketTypeId,
              error,
              openNumber: row.openNumber,
              closeNumber,
            });
          }

          return { ...updatedRow, error };
        }
        return row;
      })
    );

    setHasUnsavedChanges(true);

    // Recalculate totals
    setTimeout(() => {
      setEntries((currentEntries) => {
        const totalTickets = currentEntries.reduce((sum, row) => sum + row.ticketsSold, 0);
        const totalSales = currentEntries.reduce((sum, row) => sum + row.total, 0);
        const cashout = parseFloat(cashoutAmount) || 0;

        setDayStatus((prev) => ({
          ...prev,
          totalTicketsSold: totalTickets,
          totalSales,
          netAmount: totalSales - cashout,
        }));

        logger.debug('Totals recalculated', {
          totalTickets,
          totalSales,
          netAmount: totalSales - cashout,
        });

        return currentEntries;
      });
    }, 0);
  }, [cashoutAmount, validateEntry, user]);

  const handleCashoutChange = useCallback((value: string) => {
    logger.debug('Cashout amount changed', {
      newValue: value,
      user: user?.email,
    });

    setCashoutAmount(value);
    const cashout = parseFloat(value) || 0;

    if (cashout < 0) {
      logger.warn('Negative cashout amount entered', { cashout });
      toast.error('Cashout amount cannot be negative');
      return;
    }

    setDayStatus((prev) => ({
      ...prev,
      manualCashoutAmount: cashout,
      netAmount: prev.totalSales - cashout,
    }));
    setHasUnsavedChanges(true);
  }, [user]);

  const handleCloseInputFocus = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    // Auto-select all text when input receives focus
    e.target.select();
    logger.debug('Close input focused and text selected', {
      ticketTypeId: e.target.getAttribute('data-ticket-type-id'),
    });
  }, []);

  const handleCashoutInputFocus = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    // Auto-select all text when cashout input receives focus
    e.target.select();
    logger.debug('Cashout input focused and text selected');
  }, []);

  const handleAutoSave = async () => {
    if (isReadOnly || dayStatus.isClosed || !hasUnsavedChanges) {
      return;
    }

    logger.info('Auto-save started', { user: user?.email });
    setAutoSaving(true);

    try {
      await saveEntries();
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      setShowSuccessToast(true);
      setTimeout(() => setShowSuccessToast(false), 3000);
      logger.info('Auto-save completed successfully');
    } catch (error: any) {
      logger.error('Auto-save failed', {
        error: error.message,
        user: user?.email,
      });
      // Don't show error toast for auto-save failures
    } finally {
      setAutoSaving(false);
    }
  };

  const saveEntries = async () => {
    const startTime = performance.now();

    // Validate all entries
    const hasErrors = entries.some(row => row.error);
    if (hasErrors) {
      logger.warn('Validation errors prevent saving', {
        errors: entries.filter(r => r.error).map(r => ({
          ticketName: r.ticketName,
          error: r.error,
        })),
      });
      throw new Error('Please fix validation errors before saving');
    }

    logger.info('Saving daily entries', {
      entriesCount: entries.length,
      user: user?.email,
      selectedDate,
    });

    // Save or update each entry
    for (const row of entries) {
      if (row.ticketsSold === 0 && !row.entryId) {
        logger.debug('Skipping empty entry', { ticketName: row.ticketName });
        continue;
      }

      const data = {
        entryDate: new Date(selectedDate).toISOString(),
        ticketTypeId: row.ticketTypeId,
        startNumber: row.openNumber,
        endNumber: row.closeNumber,
      };

      if (row.entryId) {
        logger.debug('Updating existing entry', {
          entryId: row.entryId,
          ticketName: row.ticketName,
          startNumber: row.openNumber,
          endNumber: row.closeNumber,
        });
        await lotteryService.updateDailyEntry(row.entryId, {
          startNumber: row.openNumber,
          endNumber: row.closeNumber,
        });
      } else {
        logger.debug('Creating new entry', {
          ticketName: row.ticketName,
          startNumber: row.openNumber,
          endNumber: row.closeNumber,
        });
        await lotteryService.createDailyEntry(data);
      }
    }

    // Update day status cashout if changed
    if (dayStatus.id && parseFloat(cashoutAmount) !== dayStatus.manualCashoutAmount) {
      logger.info('Updating cashout amount', {
        dayStatusId: dayStatus.id,
        oldAmount: dayStatus.manualCashoutAmount,
        newAmount: parseFloat(cashoutAmount),
      });
      await lotteryService.updateDayStatusCashout(dayStatus.id, {
        manualCashoutAmount: parseFloat(cashoutAmount),
      });
    }

    const saveTime = performance.now() - startTime;
    logger.info('Daily entries saved successfully', {
      saveTime: `${saveTime.toFixed(2)}ms`,
      entriesCount: entries.length,
      user: user?.email,
    });
  };

  const handleCloseDay = async () => {
    if (!confirm('Are you sure you want to close this day? This will lock all entries and cannot be undone.')) {
      logger.info('Close day cancelled by user');
      return;
    }

    logger.info('Closing day', {
      selectedDate,
      totalSales: dayStatus.totalSales,
      cashout: parseFloat(cashoutAmount),
      netAmount: dayStatus.netAmount,
      user: user?.email,
    });

    setSaving(true);
    try {
      await lotteryService.closeDay({
        entryDate: new Date(selectedDate).toISOString(),
        manualCashoutAmount: parseFloat(cashoutAmount),
      });

      toast.success('Day closed successfully');
      logger.info('Day closed successfully', {
        selectedDate,
        user: user?.email,
      });

      await loadDailyData();
      if (onUpdate) onUpdate();
    } catch (error: any) {
      logger.error('Failed to close day', {
        error: error.message,
        stack: error.stack,
        selectedDate,
        user: user?.email,
      });
      toast.error(error.response?.data?.message || 'Failed to close day');
    } finally {
      setSaving(false);
    }
  };

  // Keyboard navigation handlers
  const handleKeyDown = (e: React.KeyboardEvent, ticketTypeId: string, rowIndex: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      logger.debug('Enter key pressed', { ticketTypeId, rowIndex });

      // Move to next row's close input
      const nextIndex = rowIndex + 1;
      if (nextIndex < entries.length) {
        const nextTicketTypeId = entries[nextIndex].ticketTypeId;
        closeInputRefs.current[nextTicketTypeId]?.focus();
      } else {
        // Move to cashout input
        cashoutInputRef.current?.focus();
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex = rowIndex + 1;
      if (nextIndex < entries.length) {
        const nextTicketTypeId = entries[nextIndex].ticketTypeId;
        closeInputRefs.current[nextTicketTypeId]?.focus();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIndex = rowIndex - 1;
      if (prevIndex >= 0) {
        const prevTicketTypeId = entries[prevIndex].ticketTypeId;
        closeInputRefs.current[prevTicketTypeId]?.focus();
      }
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value || 0);
  };

  const isDisabled = isReadOnly || dayStatus.isClosed || loading || isPastDate;

  // Memoized values for performance
  const hasValidationErrors = useMemo(() =>
    entries.some(row => row.error),
    [entries]
  );

  if (loading) {
    return (
      <Card className="p-8">
        <div className="flex flex-col items-center justify-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          <div className="text-center">
            <div className="text-sm font-medium text-foreground">
              Loading Daily Entries
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Please wait...
            </div>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Success Toast - Professional */}
      {showSuccessToast && !autoSaving && lastSaved && (
        <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-5">
          <div className="bg-card border border-border shadow-lg rounded px-4 py-2 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span className="text-sm text-foreground">
              Saved at {lastSaved.toLocaleTimeString()}
            </span>
          </div>
        </div>
      )}

      {/* Auto-saving indicator */}
      {autoSaving && (
        <div className="fixed bottom-4 right-4 z-50">
          <div className="bg-card border border-border shadow-lg rounded px-4 py-2 flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
            <span className="text-sm text-foreground">
              Saving...
            </span>
          </div>
        </div>
      )}

      {/* Error Summary Banner */}
      {hasValidationErrors && (
        <div className="bg-red-500/10 border border-red-500/20 rounded p-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-500">
                {entries.filter(r => r.error).length} validation {entries.filter(r => r.error).length === 1 ? 'error' : 'errors'}. Please correct before closing the day.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Past Date Warning Banner */}
      {isPastDate && !dayStatus.isClosed && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded p-4">
          <div className="flex items-start gap-2">
            <Info className="h-5 w-5 text-amber-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-500">
                Viewing past date - entries are read-only
              </p>
              <p className="text-xs text-amber-500 mt-1">
                Only today's date ({new Date().toLocaleDateString()}) can be edited. Historical data cannot be modified.
              </p>
            </div>
          </div>
        </div>
      )}

      <Card className="p-6">
        {/* Header */}
        <div className="space-y-6 mb-6">
          {/* Title and Status Row */}
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h2 className="text-2xl font-bold text-foreground">Daily Entry</h2>
                {/* Status badges */}
                {dayStatus.isClosed && (
                  <Badge className="bg-muted text-foreground border border-border">
                    <Lock className="h-3 w-3 mr-1" />
                    Closed
                  </Badge>
                )}
                {autoSaving && (
                  <Badge className="bg-blue-500/10 text-blue-500 border border-blue-500/20">
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Saving
                  </Badge>
                )}
                {!dayStatus.isClosed && !autoSaving && !hasUnsavedChanges && lastSaved && (
                  <Badge className="bg-green-500/10 text-green-500 border border-green-500/20">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Saved
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                Enter closing numbers for each ticket type. Changes save automatically.
              </p>
            </div>
          </div>

          {/* Date Selector Card */}
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-500/20 rounded-xl p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              {/* Left side - Date Info */}
              <div className="flex items-center gap-4">
                <div className="bg-card rounded-lg p-3 shadow-sm border border-blue-100">
                  <Calendar className="h-8 w-8 text-blue-500" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-blue-500 uppercase tracking-wide mb-1">
                    Entry Date
                  </div>
                  <div className="text-2xl font-bold text-foreground">
                    {new Date(selectedDate).toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric'
                    })}
                  </div>
                  <div className={cn(
                    "text-xs font-medium mt-1 flex items-center gap-1.5",
                    isPastDate ? "text-amber-500" : "text-green-500"
                  )}>
                    <div className={cn(
                      "w-1.5 h-1.5 rounded-full",
                      isPastDate ? "bg-amber-500/100" : "bg-green-500/100"
                    )} />
                    {isPastDate ? "Historical (Read-only)" : "Current (Editable)"}
                  </div>
                </div>
              </div>

              {/* Right side - Date Picker */}
              <div className="flex flex-col items-start sm:items-end gap-2">
                <label htmlFor="lottery-date-selector" className="text-xs font-medium text-muted-foreground">
                  Select Date
                </label>
                <input
                  id="lottery-date-selector"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => {
                    setSelectedDate(e.target.value);
                    logger.info('Date changed', {
                      newDate: e.target.value,
                      user: user?.email,
                    });
                  }}
                  max={new Date().toISOString().split('T')[0]}
                  disabled={loading}
                  className={cn(
                    "lottery-date-selector",
                    "px-4 py-2.5 rounded-lg border-2 font-medium text-sm",
                    "transition-all duration-200",
                    "focus:outline-none focus:ring-2 focus:ring-offset-2",
                    isPastDate
                      ? "bg-amber-500/10 border-amber-500/30 text-amber-500 focus:border-amber-500 focus:ring-amber-500/20"
                      : "bg-card border-primary/40 text-foreground focus:border-ring focus:ring-ring/30",
                    "hover:border-blue-400 hover:shadow-sm",
                    "disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto border border-border rounded">
          <table
            className="w-full border-collapse"
            role="grid"
            aria-label="Daily lottery ticket entries"
          >
            <thead className="bg-muted/50">
              <tr role="row">
                <th scope="col" className="border-b border-border px-3 py-3 text-center text-xs font-medium text-foreground w-12">
                  #
                </th>
                <th scope="col" className="border-b border-border px-3 py-3 text-left text-xs font-medium text-foreground">
                  Ticket Name
                </th>
                <th scope="col" className="border-b border-border px-3 py-3 text-right text-xs font-medium text-foreground w-32">
                  Open
                </th>
                <th scope="col" className="border-b border-border px-3 py-3 text-right text-xs font-medium text-foreground w-32">
                  Close
                </th>
                <th scope="col" className="border-b border-border px-3 py-3 text-right text-xs font-medium text-foreground w-28">
                  Price
                </th>
                <th scope="col" className="border-b border-border px-3 py-3 text-right text-xs font-medium text-foreground bg-muted/50">
                  Tickets Sold
                </th>
                <th scope="col" className="border-b border-border px-3 py-3 text-right text-xs font-medium text-foreground bg-muted/50">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((row, index) => (
                <tr
                  key={row.ticketTypeId}
                  role="row"
                  className={cn(
                    'transition-colors',
                    row.error ? 'bg-red-500/10' : 'hover:bg-muted/50',
                  )}
                >
                  <td role="gridcell" className="px-3 py-2.5 text-center">
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {index + 1}
                    </span>
                  </td>
                  <th scope="row" role="rowheader" className="px-3 py-2.5">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-foreground">{row.ticketName}</span>
                      <span className="text-xs text-muted-foreground font-mono">{row.ticketCode}</span>
                    </div>
                  </th>
                  <td role="gridcell" className="px-3 py-2.5 text-right">
                    <Input
                      type="number"
                      value={row.openNumber}
                      disabled
                      className="text-right text-sm tabular-nums bg-muted border border-border cursor-not-allowed"
                      min="0"
                      aria-label={`Opening number for ${row.ticketName}`}
                      aria-readonly="true"
                    />
                  </td>
                  <td role="gridcell" className="px-3 py-2.5 relative">
                    <Input
                      ref={(el) => (closeInputRefs.current[row.ticketTypeId] = el)}
                      type="number"
                      value={row.closeNumber}
                      onChange={(e) => handleCloseNumberChange(row.ticketTypeId, e.target.value)}
                      onKeyDown={(e) => handleKeyDown(e, row.ticketTypeId, index)}
                      onFocus={handleCloseInputFocus}
                      data-ticket-type-id={row.ticketTypeId}
                      disabled={isDisabled}
                      className={cn(
                        'text-right text-sm tabular-nums',
                        'border transition-colors',
                        'focus:border-ring focus:ring-1 focus:ring-ring',
                        row.error ? 'border-red-500 bg-red-500/10' : 'border-border bg-card'
                      )}
                      min={row.openNumber}
                      aria-label={`Closing number for ${row.ticketName}`}
                      aria-invalid={!!row.error}
                    />
                    {row.error && (
                      <div className="absolute left-0 right-0 top-full mt-1 z-10">
                        <div className="bg-red-500/10 border border-red-500/30 rounded p-2 shadow-md text-xs text-red-500">
                          {row.error}
                        </div>
                      </div>
                    )}
                  </td>
                  <td role="gridcell" className="px-3 py-2.5 text-right text-sm text-foreground tabular-nums">
                    {formatCurrency(row.pricePerTicket)}
                  </td>
                  <td role="gridcell" className="px-3 py-2.5 text-right bg-muted/50">
                    <div className="text-sm font-medium text-foreground tabular-nums">
                      {row.ticketsSold}
                    </div>
                  </td>
                  <td role="gridcell" className="px-3 py-2.5 text-right bg-muted/50">
                    <div className="text-sm font-medium text-foreground tabular-nums">
                      {formatCurrency(row.total)}
                    </div>
                  </td>
                </tr>
              ))}

              {entries.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center">
                    <p className="text-sm text-muted-foreground">
                      No ticket types configured. Please add ticket types in the <strong>Ticket Types</strong> tab first.
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Summary Section */}
      {entries.length > 0 && (
        <div className="space-y-4">
          <div className="border-t border-border" />

          {/* Summary grid */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Total Tickets Sold */}
            <Card className="bg-card border border-border">
              <div className="p-4">
                <div className="text-xs text-muted-foreground mb-2">
                  Total Tickets Sold
                </div>
                <div className="text-2xl font-semibold text-foreground tabular-nums">
                  {dayStatus.totalTicketsSold.toLocaleString()}
                </div>
              </div>
            </Card>

            {/* Total Sales */}
            <Card className="bg-card border border-border">
              <div className="p-4">
                <div className="text-xs text-muted-foreground mb-2">
                  Total Sales
                </div>
                <div className="text-2xl font-semibold text-foreground tabular-nums">
                  {formatCurrency(dayStatus.totalSales)}
                </div>
              </div>
            </Card>

            {/* Cashout Amount */}
            <Card className="bg-card border border-border">
              <div className="p-4">
                <label className="text-xs text-muted-foreground block mb-2">
                  Cashout (Winnings Paid)
                </label>
                <Input
                  ref={cashoutInputRef}
                  type="number"
                  value={cashoutAmount}
                  onChange={(e) => handleCashoutChange(e.target.value)}
                  onFocus={handleCashoutInputFocus}
                  disabled={isDisabled}
                  className="text-xl font-semibold border border-border focus:border-ring focus:ring-1 focus:ring-ring bg-card tabular-nums"
                  step="0.01"
                  min="0"
                />
              </div>
            </Card>

            {/* Net Amount */}
            <Card className={cn(
              "border",
              dayStatus.netAmount >= 0
                ? "bg-card border-border"
                : "bg-red-500/10 border-red-500/20"
            )}>
              <div className="p-4">
                <div className="text-xs text-muted-foreground mb-2">
                  Net Amount
                </div>
                <div className={cn(
                  "text-2xl font-semibold tabular-nums",
                  dayStatus.netAmount >= 0 ? "text-foreground" : "text-red-500"
                )}>
                  {formatCurrency(dayStatus.netAmount)}
                </div>
                <div className="text-xs text-muted-foreground mt-1 tabular-nums">
                  {formatCurrency(dayStatus.totalSales)} - {formatCurrency(dayStatus.manualCashoutAmount)}
                </div>
              </div>
            </Card>
          </div>

          {/* Action Section */}
          {!isReadOnly && !dayStatus.isClosed && (
            <div className="flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center pt-4 border-t border-border">
              <div className="flex items-start gap-2 text-xs text-muted-foreground">
                <Info className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                <span>
                  Closing the day locks all entries and cannot be undone.
                </span>
              </div>

              <Button
                onClick={handleCloseDay}
                disabled={saving || autoSaving || hasValidationErrors}
                className={cn(
                  "bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 text-sm font-medium shadow-sm",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
                title={autoSaving ? 'Please wait while changes are being saved...' : hasValidationErrors ? 'Please fix validation errors first' : ''}
              >
                <Lock className="h-4 w-4 mr-2" />
                Close Day
              </Button>
            </div>
          )}

          {/* Audit Trail */}
          {(dayStatus.closedAt || dayStatus.updatedAt) && (
            <div className="text-xs text-muted-foreground space-y-1 pt-3 border-t border-border bg-muted/50 px-3 py-2 rounded">
              {dayStatus.isClosed && dayStatus.closedAt && (
                <div>
                  <strong>Closed:</strong> {new Date(dayStatus.closedAt).toLocaleString()}
                  {dayStatus.closedBy && ` by ${dayStatus.closedBy}`}
                </div>
              )}
              {dayStatus.updatedAt && (
                <div>
                  <strong>Last updated:</strong> {new Date(dayStatus.updatedAt).toLocaleString()}
                  {dayStatus.updatedBy && ` by ${dayStatus.updatedBy}`}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
