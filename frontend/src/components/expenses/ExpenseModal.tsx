import { Select } from '@/components/ui/Select';
import React, { useState, useEffect, useId } from 'react';
import { Upload } from 'lucide-react';
import { expenseService, api } from '@/services/api';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { Expense } from '@/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { formatEnumLabel } from '@/lib/utils';
import { storeDateInput } from '@/lib/storeDates';
import { useAuthStore } from '@/store/authStore';

interface ExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  expense?: Expense | null;
  timezone: string;
}

const EXPENSE_CATEGORIES = [
  'UTILITIES',
  'RENT',
  'PAYROLL',
  'SUPPLIES',
  'INVENTORY_PURCHASE',
  'MARKETING',
  'MAINTENANCE',
  'INSURANCE',
  'TAXES',
  'SHIPPING',
  'SOFTWARE',
  'EQUIPMENT',
  'OTHER',
];

export const ExpenseModal: React.FC<ExpenseModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  expense,
  timezone,
}) => {
  const role = useAuthStore(s => s.user?.role);
  const recordTimezone = expense?.location?.timezone || timezone;
  const formId = useId();
  const [formData, setFormData] = useState({
    inventoryReceiptId: '',
    category: '',
    description: '',
    amount: '',
    vendor: '',
    receiptUrl: '',
    invoiceNumber: '',
    expenseDate: storeDateInput(new Date(), recordTimezone),
    dueDate: '',
    locationId: '',
  });
  const receipts = useScopedQuery<{ id: string; invoiceNumber: string | null; purchaseOrder: { orderNumber: string; supplier: { name: string } } }[]>(['expense-inventory-receipts'],
    async signal => (await api.get('/financial/inventory-costs/receipts', { signal })).data.data,
    isOpen && formData.category === 'INVENTORY_PURCHASE' && role !== 'CASHIER');

  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [uploadedReceiptUrl, setUploadedReceiptUrl] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (expense) {
      setFormData({
        inventoryReceiptId: expense.inventoryReceiptId || '',
        category: expense.category,
        description: expense.description,
        amount: expense.amount.toString(),
        vendor: expense.vendor || '',
        receiptUrl: expense.receiptUrl || '',
        invoiceNumber: expense.invoiceNumber || '',
        expenseDate: storeDateInput(expense.expenseDate, recordTimezone),
        dueDate: expense.dueDate ? storeDateInput(expense.dueDate, recordTimezone) : '',
        locationId: expense.locationId || '',
      });
      setUploadedReceiptUrl(expense.receiptUrl || '');
    } else {
      // Reset form for new expense
      setFormData({
        inventoryReceiptId: '',
        category: '',
        description: '',
        amount: '',
        vendor: '',
        receiptUrl: '',
        invoiceNumber: '',
        expenseDate: storeDateInput(new Date(), recordTimezone),
        dueDate: '',
        locationId: '',
      });
      setUploadedReceiptUrl('');
      setReceiptFile(null);
    }
  }, [expense, isOpen, recordTimezone]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'application/pdf'];
    if (!validTypes.includes(file.type)) {
      setError('Invalid file type. Only JPEG, PNG, GIF, and PDF are allowed.');
      return;
    }

    // Validate file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError('File size must be less than 5MB.');
      return;
    }

    setReceiptFile(file);
    setError('');

    // Auto-upload the file
    setIsUploading(true);
    try {
      const response = await expenseService.uploadReceipt(file);
      const fileUrl = response.data.data.url;
      setUploadedReceiptUrl(fileUrl);
      setFormData({ ...formData, receiptUrl: fileUrl });
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to upload receipt');
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validation
    if (!formData.category || !formData.description || !formData.amount) {
      setError('Please fill in all required fields');
      return;
    }

    setIsSubmitting(true);

    try {
      const data = {
        ...formData,
        inventoryReceiptId: formData.category === 'INVENTORY_PURCHASE' ? formData.inventoryReceiptId || null : null,
        amount: parseFloat(formData.amount),
        receiptUrl: uploadedReceiptUrl || formData.receiptUrl,
        // Preserve an existing timestamp unless its calendar date was actually edited.
        expenseDate: expense && formData.expenseDate === storeDateInput(expense.expenseDate, recordTimezone) ? expense.expenseDate : formData.expenseDate,
        dueDate: !formData.dueDate ? null : expense?.dueDate && formData.dueDate === storeDateInput(expense.dueDate, recordTimezone) ? expense.dueDate : formData.dueDate,
      };

      if (expense) {
        await expenseService.update(expense.id, data);
      } else {
        await expenseService.create(data);
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error || `Failed to ${expense ? 'update' : 'create'} expense`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={() => { if (!isSubmitting && !isUploading) onClose(); }} title={expense ? 'Edit Expense' : 'Add New Expense'} size="lg" footer={<div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting || isUploading}>
                Cancel
              </Button>
              <Button type="submit" form={formId} disabled={isSubmitting || isUploading}>
                {isSubmitting ? 'Saving...' : expense ? 'Update Expense' : 'Create Expense'}
              </Button>
            </div>}>
          <form id={formId} onSubmit={handleSubmit} className="space-y-4">
            <p className="text-xs text-muted-foreground">Dates use {recordTimezone}.</p>
            {error && (
              <div role="alert" className="bg-destructive/10 text-destructive px-4 py-2 rounded-md text-sm">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Category */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  Category <span className="text-destructive">*</span>
                </label>
                <Select
                  aria-label="Category"
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground"
                  required
                >
                  <option value="">Select category</option>
                  {EXPENSE_CATEGORIES.filter(cat => cat !== 'PAYROLL' || role === 'ADMIN').map((cat) => (
                    <option key={cat} value={cat}>
                      {formatEnumLabel(cat)}
                    </option>
                  ))}
                </Select>
                {formData.category === 'INVENTORY_PURCHASE' && <div className="mt-3 space-y-2"><label className="block text-sm">Inventory receipt (optional)<Select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm" value={formData.inventoryReceiptId} onChange={e => setFormData({ ...formData, inventoryReceiptId: e.target.value })}><option value="">Not linked to a receipt</option>{receipts.data?.map(receipt => <option key={receipt.id} value={receipt.id}>{receipt.invoiceNumber || receipt.purchaseOrder.orderNumber} · {receipt.purchaseOrder.supplier.name}</option>)}</Select></label><p className="text-xs text-muted-foreground">Purchases enter inventory when received. This record tracks the expense document and is not deducted again from profit.</p></div>}
              </div>

              {/* Amount */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  Amount <span className="text-destructive">*</span>
                </label>
                <Input
                  type="number"
                  step="0.01"
                  aria-label="Amount"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  placeholder="0.00"
                  required
                />
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium mb-1">
                Description <span className="text-destructive">*</span>
              </label>
              <textarea
                aria-label="Description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Enter expense description"
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground min-h-[80px]"
                required
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Vendor */}
              <div>
                <label className="block text-sm font-medium mb-1">Vendor</label>
                <Input
                  type="text"
                  value={formData.vendor}
                  onChange={(e) => setFormData({ ...formData, vendor: e.target.value })}
                  placeholder="Vendor name"
                />
              </div>

              {/* Invoice Number */}
              <div>
                <label className="block text-sm font-medium mb-1">Invoice Number</label>
                <Input
                  type="text"
                  value={formData.invoiceNumber}
                  onChange={(e) => setFormData({ ...formData, invoiceNumber: e.target.value })}
                  placeholder="INV-12345"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Expense Date */}
              <div>
                <label className="block text-sm font-medium mb-1">Expense Date</label>
                <Input
                  type="date"
                  aria-label="Expense Date"
                  value={formData.expenseDate}
                  onChange={(e) => setFormData({ ...formData, expenseDate: e.target.value })}
                />
              </div>

              {/* Due Date */}
              <div>
                <label className="block text-sm font-medium mb-1">Due Date</label>
                <Input
                  type="date"
                  aria-label="Due Date"
                  value={formData.dueDate}
                  onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                />
              </div>
            </div>

            {/* Receipt Upload */}
            <div>
              <label className="block text-sm font-medium mb-2">Receipt</label>
              <div className="space-y-2">
                {/* File Upload */}
                <div>
                  <label className="flex items-center gap-2 px-4 py-2 border border-dashed rounded-md cursor-pointer hover:bg-accent">
                    <Upload className="h-4 w-4" />
                    <span className="text-sm">
                      {isUploading ? 'Uploading...' : 'Upload Receipt (Image or PDF)'}
                    </span>
                    <input
                      type="file"
                      onChange={handleFileChange}
                      accept="image/*,.pdf"
                      className="hidden"
                      disabled={isUploading}
                    />
                  </label>
                  {receiptFile && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Selected: {receiptFile.name}
                    </p>
                  )}
                  {uploadedReceiptUrl && (
                    <p className="text-xs text-success mt-1">Receipt uploaded successfully!</p>
                  )}
                </div>

                <p className="text-xs text-muted-foreground">Uploaded receipts are private to your store.</p>
              </div>
            </div>

          </form>
    </Modal>
  );
};
