import React, { useState, useRef } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { productService } from '@/services/api';
import { Upload, FileText, CheckCircle, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';

interface CSVImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: () => void;
}

interface ImportResult {
  total: number;
  created: number;
  updated: number;
  errors: string[];
}

export const CSVImportModal: React.FC<CSVImportModalProps> = ({
  isOpen,
  onClose,
  onImportComplete,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected && (selected.type === 'text/csv' || selected.name.endsWith('.csv'))) {
      setFile(selected);
      setResult(null);
    } else {
      toast.error('Please select a CSV file');
    }
  };

  const handleImport = async () => {
    if (!file) return;
    setIsImporting(true);
    setResult(null);

    try {
      const text = await file.text();
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) {
        toast.error('CSV file must have a header row and at least one data row');
        setIsImporting(false);
        return;
      }

      const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/['"]/g, ''));
      const rows = lines.slice(1);

      const created: number[] = [];
      const updated: number[] = [];
      const errors: string[] = [];

      for (let i = 0; i < rows.length; i++) {
        const values = rows[i].split(',').map((v) => v.trim().replace(/^['"]|['"]$/g, ''));
        const row: Record<string, string> = {};
        headers.forEach((h, idx) => { row[h] = values[idx] || ''; });

        const productData: any = {
          name: row.name || row.product_name || row.productname,
          sku: row.sku,
          barcode: row.barcode || row.upc || '',
          price: parseFloat(row.price || row.retail_price || '0'),
          cost: parseFloat(row.cost || row.wholesale_cost || '0'),
          stockQuantity: parseInt(row.stock || row.stockquantity || row.quantity || '0'),
          lowStockAlert: parseInt(row.lowstockalert || row.low_stock || '10'),
          categoryId: row.categoryid || row.category_id || undefined,
          isActive: row.active !== 'false' && row.isactive !== 'false',
          trackInventory: row.trackinventory !== 'false',
          isTaxable: row.istaxable !== 'false',
        };

        if (!productData.name || !productData.sku) {
          errors.push(`Row ${i + 2}: Missing required field (name or sku)`);
          continue;
        }

        try {
          // Try to find existing product by SKU to update
          const existing = await productService.getAll({ search: productData.sku, limit: 1 });
          const match = existing.data.data.find((p: any) => p.sku === productData.sku);

          if (match) {
            await productService.update(match.id, productData);
            updated.push(i);
          } else {
            await productService.create(productData);
            created.push(i);
          }
        } catch (err: any) {
          errors.push(`Row ${i + 2}: ${err.response?.data?.error || 'Failed to import'}`);
        }
      }

      setResult({
        total: rows.length,
        created: created.length,
        updated: updated.length,
        errors,
      });

      if (created.length > 0 || updated.length > 0) {
        onImportComplete();
      }
    } catch {
      toast.error('Failed to parse CSV file');
    } finally {
      setIsImporting(false);
    }
  };

  const handleClose = () => {
    setFile(null);
    setResult(null);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Import Products from CSV" size="lg">
      <div className="space-y-4">
        {!result ? (
          <>
            <div className="border-2 border-dashed rounded-lg p-8 text-center">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="hidden"
              />
              {file ? (
                <div className="flex items-center justify-center gap-2">
                  <FileText className="h-5 w-5 text-primary" />
                  <span className="font-medium">{file.name}</span>
                  <span className="text-sm text-muted-foreground">({(file.size / 1024).toFixed(1)} KB)</span>
                </div>
              ) : (
                <div>
                  <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
                  <p className="text-muted-foreground mb-2">Drop a CSV file here or click to browse</p>
                </div>
              )}
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                {file ? 'Change File' : 'Select CSV File'}
              </Button>
            </div>

            <div className="bg-muted p-3 rounded-lg text-xs text-muted-foreground">
              <p className="font-medium mb-1">Required columns: name, sku</p>
              <p>Optional: barcode, price, cost, stock, lowstockalert, categoryid, active, trackinventory, istaxable</p>
              <p className="mt-1">Existing products (matched by SKU) will be updated. New SKUs will create new products.</p>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button variant="primary" onClick={handleImport} disabled={!file || isImporting}>
                {isImporting ? 'Importing...' : 'Import'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 bg-muted rounded-lg text-center">
                <p className="text-2xl font-bold">{result.total}</p>
                <p className="text-xs text-muted-foreground">Total Rows</p>
              </div>
              <div className="p-3 bg-green-500/10 rounded-lg text-center">
                <p className="text-2xl font-bold text-green-600">{result.created}</p>
                <p className="text-xs text-muted-foreground">Created</p>
              </div>
              <div className="p-3 bg-blue-500/10 rounded-lg text-center">
                <p className="text-2xl font-bold text-blue-600">{result.updated}</p>
                <p className="text-xs text-muted-foreground">Updated</p>
              </div>
            </div>

            {result.errors.length > 0 && (
              <div className="border border-destructive/30 rounded-lg p-3">
                <div className="flex items-center gap-2 text-destructive text-sm font-medium mb-2">
                  <XCircle className="h-4 w-4" />
                  {result.errors.length} error{result.errors.length > 1 ? 's' : ''}
                </div>
                <div className="max-h-[150px] overflow-y-auto text-xs space-y-1">
                  {result.errors.map((err, i) => (
                    <p key={i} className="text-muted-foreground">{err}</p>
                  ))}
                </div>
              </div>
            )}

            {result.errors.length === 0 && (
              <div className="flex items-center gap-2 text-green-600 font-medium">
                <CheckCircle className="h-5 w-5" />
                All products imported successfully!
              </div>
            )}

            <Button variant="primary" className="w-full" onClick={handleClose}>
              Done
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
};
