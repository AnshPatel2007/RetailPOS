import React, { useState, useEffect } from 'react';
import { X, Upload, Link as LinkIcon } from 'lucide-react';
import { expenseService } from '@/services/api';
import { Expense } from '@/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';

interface ExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  expense?: Expense | null;
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
}) => {
  const [formData, setFormData] = useState({
    category: '',
    description: '',
    amount: '',
    vendor: '',
    receiptUrl: '',
    invoiceNumber: '',
    expenseDate: new Date().toISOString().split('T')[0],
    dueDate: '',
    locationId: '',
  });

  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [uploadedReceiptUrl, setUploadedReceiptUrl] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (expense) {
      setFormData({
        category: expense.category,
        description: expense.description,
        amount: expense.amount.toString(),
        vendor: expense.vendor || '',
        receiptUrl: expense.receiptUrl || '',
        invoiceNumber: expense.invoiceNumber || '',
        expenseDate: expense.expenseDate.split('T')[0],
        dueDate: expense.dueDate ? expense.dueDate.split('T')[0] : '',
        locationId: expense.locationId || '',
      });
      setUploadedReceiptUrl(expense.receiptUrl || '');
    } else {
      // Reset form for new expense
      setFormData({
        category: '',
        description: '',
        amount: '',
        vendor: '',
        receiptUrl: '',
        invoiceNumber: '',
        expenseDate: new Date().toISOString().split('T')[0],
        dueDate: '',
        locationId: '',
      });
      setUploadedReceiptUrl('');
      setReceiptFile(null);
    }
  }, [expense]);

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
        amount: parseFloat(formData.amount),
        receiptUrl: uploadedReceiptUrl || formData.receiptUrl,
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{expense ? 'Edit Expense' : 'Add New Expense'}</CardTitle>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-destructive/10 text-destructive px-4 py-2 rounded-md text-sm">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Category */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  Category <span className="text-destructive">*</span>
                </label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground"
                  required
                >
                  <option value="">Select category</option>
                  {EXPENSE_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>

              {/* Amount */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  Amount <span className="text-destructive">*</span>
                </label>
                <Input
                  type="number"
                  step="0.01"
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
                  value={formData.expenseDate}
                  onChange={(e) => setFormData({ ...formData, expenseDate: e.target.value })}
                />
              </div>

              {/* Due Date */}
              <div>
                <label className="block text-sm font-medium mb-1">Due Date</label>
                <Input
                  type="date"
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

                {/* Or URL */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">OR</span>
                </div>
                <div className="flex gap-2">
                  <LinkIcon className="h-4 w-4 mt-2 text-muted-foreground" />
                  <Input
                    type="url"
                    value={formData.receiptUrl}
                    onChange={(e) => setFormData({ ...formData, receiptUrl: e.target.value })}
                    placeholder="Enter receipt URL"
                  />
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting || isUploading}>
                {isSubmitting ? 'Saving...' : expense ? 'Update Expense' : 'Create Expense'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};
