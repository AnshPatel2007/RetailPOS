import React, { useState, useEffect, useRef } from 'react';
import { logger } from '../../utils/logger';
import { ScanBarcode, CheckCircle, XCircle, Package } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import {
  Table,
  TableBody,
  TableRow,
  TableHeader,
  TableHead,
  TableCell,
} from '@/components/ui/Table';
import { lotteryService } from '@/services/api';
import { hardware } from '@/services/hardware';
import toast from 'react-hot-toast';

interface TicketScannerProps {
  locationId?: string;
  isReadOnly?: boolean;
  onUpdate?: () => void;
}

export const TicketScanner: React.FC<TicketScannerProps> = ({
  locationId,
  isReadOnly = false,
  onUpdate,
}) => {
  const [scanning, setScanning] = useState(false);
  const [manualBarcode, setManualBarcode] = useState('');
  const [recentScans, setRecentScans] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string>('');
  const [scanCount, setScanCount] = useState(0);
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchBatches();
    fetchRecentScans();
  }, [locationId]);

  useEffect(() => {
    if (!isReadOnly) {
      startScanning();
    }
    return () => {
      stopScanning();
    };
  }, [isReadOnly]);

  const fetchBatches = async () => {
    try {
      const params: any = { status: 'ACTIVE' };
      if (locationId) {
        params.locationId = locationId;
      }

      const response = await lotteryService.getBatches(params);
      const activeBatches = response.data.data || [];
      setBatches(activeBatches);

      // Auto-select first batch if available
      if (activeBatches.length > 0 && !selectedBatchId) {
        setSelectedBatchId(activeBatches[0].id);
      }
    } catch (error) {
      logger.error('Failed to fetch batches:', error);
    }
  };

  const fetchRecentScans = async () => {
    try {
      const params: any = { limit: '10' };
      if (locationId) {
        params.locationId = locationId;
      }

      const response = await lotteryService.getScans(params);
      setRecentScans(response.data.data || []);
    } catch (error) {
      logger.error('Failed to fetch recent scans:', error);
    }
  };

  const startScanning = () => {
    if (isReadOnly) return;

    setScanning(true);
    // Register barcode scan handler
    hardware.scanner.onScan(handleBarcodeScanned);

    // Focus input for manual entry
    if (barcodeInputRef.current) {
      barcodeInputRef.current.focus();
    }
  };

  const stopScanning = () => {
    setScanning(false);
    // Scanner cleanup happens automatically
  };

  const handleBarcodeScanned = async (barcode: string) => {
    if (isReadOnly) {
      toast.error('Cannot scan in read-only mode');
      return;
    }

    if (!barcode || barcode.trim() === '') {
      return;
    }

    try {
      const data: any = {
        barcode: barcode.trim(),
        batchId: selectedBatchId || null,
      };

      // If batch is selected, try to extract ticket info
      if (selectedBatchId) {
        const selectedBatch = batches.find((b) => b.id === selectedBatchId);
        if (selectedBatch) {
          data.gameType = selectedBatch.gameType;
          data.amount = selectedBatch.pricePerTicket;
        }
      }

      const response = await lotteryService.scanTicket(data);
      const scan = response.data.data;

      toast.success(`Ticket scanned successfully! Count: ${scan.offlineSalesCount || 0}`);

      // Update scan count
      setScanCount((prev) => prev + 1);

      // Refresh data
      await Promise.all([fetchRecentScans(), fetchBatches()]);

      if (onUpdate) onUpdate();

      // Clear manual input
      setManualBarcode('');

      // Refocus input
      if (barcodeInputRef.current) {
        barcodeInputRef.current.focus();
      }
    } catch (error: any) {
      logger.error('Failed to scan ticket:', error);
      toast.error(error.response?.data?.message || 'Failed to scan ticket');
    }
  };

  const handleManualScan = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualBarcode.trim()) {
      handleBarcodeScanned(manualBarcode);
    }
  };

  const formatDateTime = (date: string) => {
    return new Date(date).toLocaleString();
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value || 0);
  };

  return (
    <div className="space-y-4">
      {/* Scanner Card */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-6">
          <ScanBarcode className="h-6 w-6 text-primary" />
          <h2 className="text-xl font-semibold">Ticket Scanner</h2>
          {scanning && (
            <Badge variant="success" className="ml-2 flex items-center gap-1">
              <div className="h-2 w-2 bg-green-500 rounded-full animate-pulse" />
              Scanning Active
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Batch Selection */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Select Batch (Optional)
            </label>
            <select
              value={selectedBatchId}
              onChange={(e) => setSelectedBatchId(e.target.value)}
              disabled={isReadOnly}
              className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Auto-detect batch</option>
              {batches.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.batchNumber} - {batch.gameType} ({batch.remainingTickets}{' '}
                  remaining)
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              {batches.length === 0
                ? 'No active batches available. Create a batch first.'
                : 'Select a batch to auto-fill ticket information'}
            </p>
          </div>

          {/* Manual Barcode Entry */}
          <form onSubmit={handleManualScan}>
            <label className="block text-sm font-medium text-foreground mb-2">
              Manual Barcode Entry
            </label>
            <div className="flex gap-2">
              <Input
                ref={barcodeInputRef}
                type="text"
                value={manualBarcode}
                onChange={(e) => setManualBarcode(e.target.value)}
                disabled={isReadOnly}
                placeholder="Scan or type barcode..."
                className="flex-1"
              />
              <Button type="submit" disabled={isReadOnly || !manualBarcode.trim()}>
                Scan
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Use barcode scanner or type manually
            </p>
          </form>
        </div>

        {/* Scan Statistics */}
        <div className="mt-6 p-4 bg-muted/50 rounded-lg">
          <h3 className="font-medium text-foreground mb-3">Today's Scan Statistics</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Scans This Session</p>
              <p className="text-2xl font-bold text-primary">{scanCount}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Recent Scans</p>
              <p className="text-2xl font-bold">{recentScans.length}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Active Batches</p>
              <p className="text-2xl font-bold">{batches.length}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Scanner Status</p>
              <div className="flex items-center gap-2 mt-1">
                {scanning ? (
                  <Badge variant="success" className="flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" />
                    Ready
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="flex items-center gap-1">
                    <XCircle className="h-3 w-3" />
                    Inactive
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Recent Scans */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Recent Scans</h3>
        {recentScans.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No scans yet. Start scanning tickets to see them here.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Barcode</TableHead>
                <TableHead>Ticket #</TableHead>
                <TableHead>Game Type</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentScans.map((scan) => (
                <TableRow key={scan.id}>
                  <TableCell className="text-sm">
                    {formatDateTime(scan.scannedAt || scan.createdAt)}
                  </TableCell>
                  <TableCell className="font-mono text-sm">{scan.barcode}</TableCell>
                  <TableCell>{scan.ticketNumber || '-'}</TableCell>
                  <TableCell>{scan.gameType || '-'}</TableCell>
                  <TableCell>
                    {scan.amount ? formatCurrency(scan.amount) : '-'}
                  </TableCell>
                  <TableCell>
                    <Badge variant="success" className="flex items-center gap-1 w-fit">
                      <CheckCircle className="h-3 w-3" />
                      Scanned
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Active Batches Info */}
      {batches.length > 0 && (
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Package className="h-5 w-5" />
            <h3 className="text-lg font-semibold">Active Batches</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {batches.map((batch) => (
              <div
                key={batch.id}
                className="p-4 border border-border rounded-lg hover:border-primary transition-colors"
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="font-medium">{batch.batchNumber}</p>
                    <p className="text-sm text-muted-foreground">{batch.gameType}</p>
                  </div>
                  <Badge variant="success">Active</Badge>
                </div>
                <div className="mt-3 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total:</span>
                    <span className="font-medium">{batch.totalTickets}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Remaining:</span>
                    <span
                      className={`font-medium ${
                        batch.remainingTickets === 0
                          ? 'text-red-500'
                          : batch.remainingTickets < batch.totalTickets * 0.2
                          ? 'text-orange-500'
                          : 'text-green-500'
                      }`}
                    >
                      {batch.remainingTickets}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Price:</span>
                    <span className="font-medium">
                      {formatCurrency(batch.pricePerTicket)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};
