import React, { useState } from 'react';
import { CheckCircle, XCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { expenseService } from '@/services/api';
import { useConfirm } from '@/components/ui/useConfirm';

interface BulkActionsToolbarProps {
  selectedIds: string[];
  onClearSelection: () => void;
  onSuccess: () => void;
}

export const BulkActionsToolbar: React.FC<BulkActionsToolbarProps> = ({
  selectedIds,
  onClearSelection,
  onSuccess,
}) => {
  const [confirm, confirmDialog] = useConfirm();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleBulkApprove = async () => {
    if (!await confirm({ title: `Approve ${selectedIds.length} expense${selectedIds.length === 1 ? '' : 's'}?`, confirmLabel: 'Approve' })) return;

    setIsLoading(true);
    setError('');
    try {
      await expenseService.bulkApprove(selectedIds);
      onSuccess();
      onClearSelection();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to approve expenses');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBulkReject = async () => {
    if (!await confirm({ title: `Reject ${selectedIds.length} expense${selectedIds.length === 1 ? '' : 's'}?`, confirmLabel: 'Reject', destructive: true })) return;

    setIsLoading(true);
    setError('');
    try {
      await expenseService.bulkReject(selectedIds);
      onSuccess();
      onClearSelection();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to reject expenses');
    } finally {
      setIsLoading(false);
    }
  };

  if (selectedIds.length === 0) return null;

  return (
    <>
      {confirmDialog}
    <div className="bg-primary/10 border border-primary/20 rounded-md p-4 mb-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium">
            {selectedIds.length} expense{selectedIds.length > 1 ? 's' : ''} selected
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="default"
              onClick={handleBulkApprove}
              disabled={isLoading}
              className="bg-success hover:bg-success/90"
            >
              <CheckCircle className="h-4 w-4 mr-1" />
              Approve Selected
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleBulkReject}
              disabled={isLoading}
            >
              <XCircle className="h-4 w-4 mr-1" />
              Reject Selected
            </Button>
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onClearSelection}
          disabled={isLoading}
        >
          <X className="h-4 w-4 mr-1" />
          Deselect All
        </Button>
      </div>
      {error && (
        <div className="mt-2 text-sm text-destructive">{error}</div>
      )}
    </div>
    </>
  );
};
