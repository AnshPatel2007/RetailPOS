import React, { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { formatCurrency } from '@/lib/utils';
import { FileText, FileSpreadsheet } from 'lucide-react';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/Table';

interface ExportPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: 'sales' | 'inventory' | 'expenses' | 'locations';
  data: any[];
  /** Full range count when data contains only a paged preview. */
  totalItems?: number;
  onExportCSV: () => Promise<void>;
  /** Omit to hide the PDF button (e.g. when only CSV export is implemented) */
  onExportPDF?: () => Promise<void>;
}

const typeLabels: Record<string, string> = {
  sales: 'sale, return and void entries',
  inventory: 'products',
  expenses: 'expenses',
  locations: 'locations',
};

export const ExportPreviewModal: React.FC<ExportPreviewModalProps> = ({
  isOpen,
  onClose,
  type,
  data,
  totalItems,
  onExportCSV,
  onExportPDF,
}) => {
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const handleExport = async (format: 'csv' | 'pdf') => {
    setIsExporting(true);
    setExportError('');
    try {
      if (format === 'csv') await onExportCSV();
      else if (onExportPDF) await onExportPDF();
    } catch {
      setExportError('The export could not be downloaded. Retry when the connection is available.');
    } finally {
      setIsExporting(false);
    }
  };

  const previewRows = data.slice(0, 20);
  const hasMore = data.length > 20;

  const renderTable = () => {
    switch (type) {
      case 'sales':
        return (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sale #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>Entry</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewRows.map((sale: any) => (
                <TableRow key={sale.id}>
                  <TableCell className="font-mono text-xs">{sale.saleNumber}</TableCell>
                  <TableCell className="text-xs">
                    {sale.storeDate || new Date(sale.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-xs">
                    {typeof sale.customer === 'string' ? sale.customer : sale.customer
                      ? `${sale.customer.firstName} ${sale.customer.lastName}`
                      : '-'}
                  </TableCell>
                  <TableCell className="text-xs">{sale.sourceType === 'DAILY_SUMMARY' ? 'Card recorded; remainder unspecified' : sale.method || sale.paymentMethod}</TableCell>
                  <TableCell className="text-xs">{sale.sourceType === 'DAILY_SUMMARY' ? 'Daily summary' : sale.kind || sale.status}</TableCell>
                  <TableCell className="text-right text-xs font-medium">
                    {formatCurrency(sale.total)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        );

      case 'inventory':
        return (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Price</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewRows.map((product: any) => (
                <TableRow key={product.id}>
                  <TableCell className="font-mono text-xs">{product.sku}</TableCell>
                  <TableCell className="text-xs">{product.name}</TableCell>
                  <TableCell className="text-xs">{product.category?.name || '-'}</TableCell>
                  <TableCell className="text-right text-xs">{product.stockQuantity}</TableCell>
                  <TableCell className="text-right text-xs">
                    {formatCurrency(product.costPrice || 0)}
                  </TableCell>
                  <TableCell className="text-right text-xs font-medium">
                    {formatCurrency(product.price)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        );

      case 'expenses':
        return (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Expense #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewRows.map((exp: any) => (
                <TableRow key={exp.id}>
                  <TableCell className="font-mono text-xs">{exp.expenseNumber}</TableCell>
                  <TableCell className="text-xs">
                    {new Date(exp.date || exp.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-xs max-w-[200px] truncate">{exp.description}</TableCell>
                  <TableCell className="text-xs">{exp.category}</TableCell>
                  <TableCell className="text-xs">{exp.vendor || '-'}</TableCell>
                  <TableCell className="text-xs">{exp.status}</TableCell>
                  <TableCell className="text-right text-xs font-medium">
                    {formatCurrency(exp.amount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        );

      case 'locations':
        return (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Store</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Transactions</TableHead>
                <TableHead className="text-right">Expenses</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead className="text-right">Users</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewRows.map((loc: any, i: number) => (
                <TableRow key={i}>
                  <TableCell className="text-xs font-medium">{loc.locationName || loc.name}</TableCell>
                  <TableCell className="text-right text-xs">{formatCurrency(loc.revenue)}</TableCell>
                  <TableCell className="text-right text-xs">{loc.transactions}</TableCell>
                  <TableCell className="text-right text-xs">{formatCurrency(loc.expenses)}</TableCell>
                  <TableCell className="text-right text-xs font-medium">{formatCurrency(loc.profit)}</TableCell>
                  <TableCell className="text-right text-xs">{loc.activeUsers}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        );
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={() => { if (!isExporting) onClose(); }} title="Export Preview" size="lg">
      <div className="space-y-4">
        {exportError && <p role="alert" className="text-destructive text-sm">{exportError}</p>}
        <p className="text-sm text-muted-foreground">
          {totalItems ?? data.length} {typeLabels[type] || 'records'} will be exported.
          {totalItems !== undefined && totalItems > data.length ? ` Previewing ${previewRows.length} entries from the loaded pages. Downloads use the entire filtered range.` : hasMore && ` Showing first 20 of ${data.length}.`}
        </p>

        <div className="max-h-[50vh] overflow-auto border border-border rounded-md">
          {renderTable()}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" disabled={isExporting} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={onExportPDF ? 'outline' : 'primary'}
            onClick={() => handleExport('csv')}
            disabled={isExporting}
          >
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            {isExporting ? 'Exporting...' : 'Download CSV'}
          </Button>
          {onExportPDF && (
            <Button
              variant="primary"
              onClick={() => handleExport('pdf')}
              disabled={isExporting}
            >
              <FileText className="h-4 w-4 mr-2" />
              {isExporting ? 'Exporting...' : 'Download PDF'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
};
