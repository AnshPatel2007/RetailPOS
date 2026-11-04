import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, CheckCircle, XCircle, Trash2, Edit } from 'lucide-react';
import { Expense } from '@/types';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { formatCurrency } from '@/lib/utils';
import { displayStoreDate } from '@/lib/storeDates';
import { expenseService } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { useConfirm } from '@/components/ui/useConfirm';

interface ExpenseDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  expense: Expense | null;
  onSuccess: () => void;
  onEdit: (expense: Expense) => void;
  timezone: string;
}

export const ExpenseDetailsModal: React.FC<ExpenseDetailsModalProps> = ({
  isOpen,
  onClose,
  expense,
  onSuccess,
  onEdit,
  timezone,
}) => {
  const [confirm, confirmDialog] = useConfirm();
  const { user } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen || !expense) return null;
  const formatDate = (value: string) => displayStoreDate(value, expense.location?.timezone || timezone);

  const handleApprove = async () => {
    if (!await confirm({ title: 'Approve this expense?', confirmLabel: 'Approve' })) return;

    setIsLoading(true);
    setError('');
    try {
      await expenseService.approve(expense.id);
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to approve expense');
    } finally {
      setIsLoading(false);
    }
  };

  const handleReject = async () => {
    if (!await confirm({ title: 'Reject this expense?', confirmLabel: 'Reject', destructive: true })) return;

    setIsLoading(true);
    setError('');
    try {
      await expenseService.reject(expense.id);
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to reject expense');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!await confirm({ title: 'Delete this expense?', message: 'This cannot be undone.', confirmLabel: 'Delete', destructive: true })) return;

    setIsLoading(true);
    setError('');
    try {
      await expenseService.delete(expense.id);
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete expense');
    } finally {
      setIsLoading(false);
    }
  };

  const handleReceipt = async () => {
    setIsLoading(true);
    setError('');
    try {
      const filename = expense.receiptUrl?.split('/').pop();
      if (!filename) throw new Error('Receipt not found');
      const response = await expenseService.downloadReceipt(filename);
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url; link.download = filename; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError('Unable to download this receipt. Check your access and try again.'); }
    finally { setIsLoading(false); }
  };
  const canEdit = expense.category !== 'PAYROLL' && expense.status === 'PENDING' && (user?.role === 'ADMIN' || user?.role === 'MANAGER');
  const canApprove = expense.category !== 'PAYROLL' && expense.status === 'PENDING' && (user?.role === 'ADMIN' || user?.role === 'MANAGER');
  const canDelete = expense.category !== 'PAYROLL' && user?.role === 'ADMIN';

  return (
    <Modal isOpen={isOpen} onClose={() => { if (!isLoading) onClose(); }} title="Expense Details" size="lg">
      {confirmDialog}
      <div className="space-y-6">
          {error && (
            <div className="bg-destructive/10 text-destructive px-4 py-2 rounded-md text-sm">
              {error}
            </div>
          )}

          {/* Header Info */}
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-2xl font-bold">{formatCurrency(expense.amount)}</h3>
              <p className="text-sm text-muted-foreground font-mono">{expense.expenseNumber}</p>
            </div>
            <span
              className={`px-3 py-1 rounded text-sm font-medium ${
                expense.status === 'PAID'
                  ? 'bg-success/10 text-success'
                  : expense.status === 'PENDING'
                  ? 'bg-warning/10 text-warning'
                  : expense.status === 'APPROVED'
                  ? 'bg-primary/10 text-primary'
                  : 'bg-destructive/10 text-destructive'
              }`}
            >
              {expense.status}
            </span>
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Category</p>
              <p className="font-medium">{expense.category.replace(/_/g, ' ')}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Expense Date</p>
              <p className="font-medium">{formatDate(expense.expenseDate)}</p>
            </div>
            {expense.vendor && (
              <div>
                <p className="text-sm text-muted-foreground">Vendor</p>
                <p className="font-medium">{expense.vendor}</p>
              </div>
            )}
            {expense.invoiceNumber && (
              <div>
                <p className="text-sm text-muted-foreground">Invoice Number</p>
                <p className="font-medium">{expense.invoiceNumber}</p>
              </div>
            )}
            {expense.dueDate && (
              <div>
                <p className="text-sm text-muted-foreground">Due Date</p>
                <p className="font-medium">{formatDate(expense.dueDate)}</p>
              </div>
            )}
            {expense.paidDate && (
              <div>
                <p className="text-sm text-muted-foreground">Paid Date</p>
                <p className="font-medium">{formatDate(expense.paidDate)}</p>
              </div>
            )}
            {expense.location && (
              <div>
                <p className="text-sm text-muted-foreground">Location</p>
                <p className="font-medium">{expense.location.name}</p>
              </div>
            )}
            <div>
              <p className="text-sm text-muted-foreground">Created By</p>
              <p className="font-medium">
                {expense.user ? `${expense.user.firstName} ${expense.user.lastName}` : 'N/A'}
              </p>
            </div>
          </div>

          {/* Description */}
          <div>
            <p className="text-sm text-muted-foreground mb-1">Description</p>
            <p className="text-sm bg-muted p-3 rounded-md">{expense.description}</p>
          </div>

          {/* Receipt */}
          {expense.receiptUrl && (
            <div>
              <p className="text-sm text-muted-foreground mb-2">Receipt</p>
              <button type="button" onClick={handleReceipt} disabled={isLoading} className="inline-flex items-center gap-2 text-primary hover:underline disabled:opacity-50"><FileText className="h-4 w-4" />Download Receipt</button>
            </div>
          )}

          {/* Metadata */}
          <div className="pt-4 border-t text-xs text-muted-foreground space-y-1">
            <p>Created: {formatDate(expense.createdAt)}</p>
            <p>Last Updated: {formatDate(expense.updatedAt)}</p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2 pt-4">
            {expense.category === 'PAYROLL' && user?.role === 'ADMIN' && <Link className="text-primary underline p-2" to={`/team-time/payroll?record=${expense.id}`}>Review payroll and payment</Link>}
            {canEdit && (
              <Button
                variant="outline"
                onClick={() => {
                  onEdit(expense);
                  onClose();
                }}
                disabled={isLoading}
              >
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </Button>
            )}
            {canApprove && (
              <>
                <Button
                  variant="default"
                  onClick={handleApprove}
                  disabled={isLoading}
                  className="bg-success hover:bg-success/90"
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Approve
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleReject}
                  disabled={isLoading}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Reject
                </Button>
              </>
            )}
            {canDelete && (
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={isLoading}
                className="ml-auto"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            )}
          </div>
              </div>
    </Modal>
  );
};
