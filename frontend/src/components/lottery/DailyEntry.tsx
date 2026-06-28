import React, { useState, useEffect } from 'react';
import { logger } from '../../utils/logger';
import { Save, CheckCircle, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { lotteryService } from '@/services/api';
import toast from 'react-hot-toast';

interface DailyEntryProps {
  locationId?: string;
  isReadOnly?: boolean;
  onUpdate?: () => void;
}

export const DailyEntry: React.FC<DailyEntryProps> = ({
  locationId,
  isReadOnly = false,
  onUpdate,
}) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [todayTransaction, setTodayTransaction] = useState<any>(null);
  const [formData, setFormData] = useState({
    onlineSalesCount: 0,
    onlineSalesAmount: 0,
    offlineSalesCount: 0,
    offlineSalesAmount: 0,
    cashoutAmount: 0,
    notes: '',
  });

  useEffect(() => {
    fetchTodayTransaction();
  }, [locationId]);

  const fetchTodayTransaction = async () => {
    setLoading(true);
    try {
      const params: any = { status: 'OPEN' };
      if (locationId) {
        params.locationId = locationId;
      }

      const response = await lotteryService.getTransactions(params);
      const transactions = response.data.data || [];

      // Find today's transaction
      const today = new Date().toDateString();
      const todayTx = transactions.find((tx: any) =>
        new Date(tx.transactionDate).toDateString() === today
      );

      if (todayTx) {
        setTodayTransaction(todayTx);
        setFormData({
          onlineSalesCount: todayTx.onlineSalesCount || 0,
          onlineSalesAmount: todayTx.onlineSalesAmount || 0,
          offlineSalesCount: todayTx.offlineSalesCount || 0,
          offlineSalesAmount: todayTx.offlineSalesAmount || 0,
          cashoutAmount: todayTx.cashoutAmount || 0,
          notes: todayTx.notes || '',
        });
      }
    } catch (error) {
      logger.error('Failed to fetch today\'s transaction:', error);
      toast.error('Failed to load today\'s data');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field: string, value: string | number) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const calculateNet = () => {
    const totalSales =
      (Number(formData.onlineSalesAmount) || 0) +
      (Number(formData.offlineSalesAmount) || 0);
    const net = totalSales - (Number(formData.cashoutAmount) || 0);
    return net;
  };

  const handleSave = async () => {
    if (isReadOnly) {
      toast.error('Cannot modify data in read-only mode');
      return;
    }

    setSaving(true);
    try {
      const data = {
        transactionDate: new Date().toISOString(),
        onlineSalesCount: Number(formData.onlineSalesCount) || 0,
        onlineSalesAmount: Number(formData.onlineSalesAmount) || 0,
        offlineSalesCount: Number(formData.offlineSalesCount) || 0,
        offlineSalesAmount: Number(formData.offlineSalesAmount) || 0,
        cashoutAmount: Number(formData.cashoutAmount) || 0,
        notes: formData.notes,
      };

      await lotteryService.upsertTransaction(data);
      toast.success('Transaction saved successfully');
      await fetchTodayTransaction();
      if (onUpdate) onUpdate();
    } catch (error: any) {
      logger.error('Failed to save transaction:', error);
      toast.error(error.response?.data?.message || 'Failed to save transaction');
    } finally {
      setSaving(false);
    }
  };

  const handleCloseDay = async () => {
    if (!todayTransaction) {
      toast.error('No transaction to close');
      return;
    }

    if (isReadOnly) {
      toast.error('Cannot close day in read-only mode');
      return;
    }

    if (!confirm('Are you sure you want to close today\'s lottery transactions? This cannot be undone.')) {
      return;
    }

    setSaving(true);
    try {
      await lotteryService.closeTransaction(todayTransaction.id, {
        notes: formData.notes,
      });
      toast.success('Day closed successfully');
      await fetchTodayTransaction();
      if (onUpdate) onUpdate();
    } catch (error: any) {
      logger.error('Failed to close day:', error);
      toast.error(error.response?.data?.message || 'Failed to close day');
    } finally {
      setSaving(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value || 0);
  };

  if (loading) {
    return (
      <Card className="p-6">
        <div className="text-center">Loading...</div>
      </Card>
    );
  }

  const netAmount = calculateNet();
  const isClosed = todayTransaction?.status === 'CLOSED' || todayTransaction?.status === 'RECONCILED';

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Daily Entry - {new Date().toLocaleDateString()}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Enter daily lottery sales and cashout information
            </p>
          </div>
          {isClosed && (
            <Badge variant="success" className="flex items-center gap-1">
              <CheckCircle className="h-3 w-3" />
              Closed
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Online Sales */}
          <div className="space-y-4">
            <h3 className="font-medium text-foreground">Online Sales</h3>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Number of Sales
              </label>
              <Input
                type="number"
                value={formData.onlineSalesCount}
                onChange={(e) => handleInputChange('onlineSalesCount', e.target.value)}
                disabled={isReadOnly || isClosed}
                min="0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Total Amount
              </label>
              <Input
                type="number"
                value={formData.onlineSalesAmount}
                onChange={(e) => handleInputChange('onlineSalesAmount', e.target.value)}
                disabled={isReadOnly || isClosed}
                min="0"
                step="0.01"
              />
            </div>
          </div>

          {/* Offline Sales */}
          <div className="space-y-4">
            <h3 className="font-medium text-foreground">Offline Sales (Scratch Tickets)</h3>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Number of Tickets Sold
              </label>
              <Input
                type="number"
                value={formData.offlineSalesCount}
                onChange={(e) => handleInputChange('offlineSalesCount', e.target.value)}
                disabled={isReadOnly || isClosed}
                min="0"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Updated automatically when scanning tickets
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Total Amount
              </label>
              <Input
                type="number"
                value={formData.offlineSalesAmount}
                onChange={(e) => handleInputChange('offlineSalesAmount', e.target.value)}
                disabled={isReadOnly || isClosed}
                min="0"
                step="0.01"
              />
            </div>
          </div>

          {/* Cashout */}
          <div className="space-y-4">
            <h3 className="font-medium text-foreground">Cashout</h3>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Cashout Amount
              </label>
              <Input
                type="number"
                value={formData.cashoutAmount}
                onChange={(e) => handleInputChange('cashoutAmount', e.target.value)}
                disabled={isReadOnly || isClosed}
                min="0"
                step="0.01"
              />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-4">
            <h3 className="font-medium text-foreground">Notes</h3>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Additional Notes
              </label>
              <textarea
                value={formData.notes}
                onChange={(e) => handleInputChange('notes', e.target.value)}
                disabled={isReadOnly || isClosed}
                className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                rows={3}
                placeholder="Any additional notes..."
              />
            </div>
          </div>
        </div>

        {/* Summary */}
        <div className="mt-6 p-4 bg-muted/50 rounded-lg">
          <h3 className="font-medium text-foreground mb-3">Summary</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Total Sales</p>
              <p className="text-lg font-semibold">
                {formatCurrency(
                  (Number(formData.onlineSalesAmount) || 0) +
                  (Number(formData.offlineSalesAmount) || 0)
                )}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Cashout</p>
              <p className="text-lg font-semibold">
                {formatCurrency(Number(formData.cashoutAmount) || 0)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Net Amount</p>
              <p
                className={`text-lg font-semibold ${
                  netAmount >= 0 ? 'text-green-500' : 'text-red-500'
                }`}
              >
                {formatCurrency(netAmount)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Status</p>
              <p className="text-lg font-semibold">
                {isClosed ? 'Closed' : 'Open'}
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        {!isReadOnly && !isClosed && (
          <div className="mt-6 flex gap-3 justify-end">
            <Button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Saving...' : 'Save'}
            </Button>
            <Button
              onClick={handleCloseDay}
              disabled={saving || !todayTransaction}
              variant="primary"
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700"
            >
              <CheckCircle className="h-4 w-4" />
              Close Day
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
};
