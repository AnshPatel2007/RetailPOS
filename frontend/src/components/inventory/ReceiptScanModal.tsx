import React, { useState, useRef } from 'react';
import { X, Upload, Camera, Loader2, Check, AlertTriangle, Trash2 } from 'lucide-react';
import { productService } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { formatCurrency } from '@/lib/utils';
import toast from 'react-hot-toast';

interface ScannedItem {
  name: string;
  quantity: number;
  packSize: number;
  unitQuantity: number;
  unitCost: number;
  totalCost: number;
  barcode: string | null;
  matchedProductId: string | null;
  matchedProductName: string | null;
  matchedProductSku: string | null;
  existingPrice: number | null;
  existingCost: number | null;
  // User-editable fields
  sku: string;
  categoryId: string;
  isNew: boolean;
}

interface ExistingProduct {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  price: number;
  cost: number;
}

interface ReceiptScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type Step = 'upload' | 'scanning' | 'review';

export const ReceiptScanModal: React.FC<ReceiptScanModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [step, setStep] = useState<Step>('upload');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [supplier, setSupplier] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [items, setItems] = useState<ScannedItem[]>([]);
  const [existingProducts, setExistingProducts] = useState<ExistingProduct[]>([]);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please select an image file (JPEG, PNG, etc.)');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('File size must be less than 5MB');
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setError('');
  };

  const handleScan = async () => {
    if (!selectedFile) return;

    setStep('scanning');
    setError('');

    try {
      const response = await productService.scanReceipt(selectedFile);
      const data = response.data.data;

      setSupplier(data.supplier || '');
      setInvoiceNumber(data.invoiceNumber || '');
      setExistingProducts(data.existingProducts || []);

      // Process items
      const scannedItems: ScannedItem[] = (data.items || []).map((item: any) => ({
        name: item.name || '',
        quantity: item.quantity || 1,
        packSize: item.packSize || 1,
        unitQuantity: item.unitQuantity || (item.quantity || 1) * (item.packSize || 1),
        unitCost: item.unitCost || 0,
        totalCost: item.totalCost || 0,
        barcode: item.barcode || null,
        matchedProductId: item.matchedProductId || null,
        matchedProductName: item.matchedProductName || null,
        matchedProductSku: item.matchedProductSku || null,
        existingPrice: item.existingPrice || null,
        existingCost: item.existingCost || null,
        sku: '',
        categoryId: '',
        isNew: !item.matchedProductId,
      }));

      setItems(scannedItems);
      setStep('review');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to scan receipt. Please try again with a clearer image.');
      setStep('upload');
    }
  };

  const updateItem = (index: number, updates: Partial<ScannedItem>) => {
    setItems(prev => prev.map((item, i) => {
      if (i !== index) return item;
      const updated = { ...item, ...updates };
      // Recalculate unitQuantity when quantity or packSize changes
      if ('quantity' in updates || 'packSize' in updates) {
        updated.unitQuantity = updated.quantity * updated.packSize;
      }
      return updated;
    }));
  };

  const removeItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  const matchToExisting = (index: number, productId: string) => {
    const product = existingProducts.find(p => p.id === productId);
    if (!product) return;

    updateItem(index, {
      matchedProductId: product.id,
      matchedProductName: product.name,
      matchedProductSku: product.sku,
      existingPrice: product.price,
      existingCost: product.cost,
      isNew: false,
    });
  };

  const unmatchProduct = (index: number) => {
    updateItem(index, {
      matchedProductId: null,
      matchedProductName: null,
      matchedProductSku: null,
      existingPrice: null,
      existingCost: null,
      isNew: true,
    });
  };

  const handleApply = async () => {
    if (items.length === 0) {
      setError('No items to apply');
      return;
    }

    // Validate: new products need a name
    const invalid = items.find(item => item.isNew && !item.name.trim());
    if (invalid) {
      setError('All new products must have a name');
      return;
    }

    setIsApplying(true);
    setError('');

    try {
      const payload = {
        supplier,
        invoiceNumber: invoiceNumber || undefined,
        items: items.map(item => ({
          matchedProductId: item.matchedProductId,
          name: item.name,
          unitQuantity: item.unitQuantity,
          unitCost: item.unitCost,
          barcode: item.barcode,
          sku: item.sku || undefined,
          categoryId: item.categoryId || undefined,
        })),
      };

      const response = await productService.applyReceipt(payload);
      const result = response.data.data;

      toast.success(`${result.processedCount} product(s) updated from receipt`);
      resetAndClose();
      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to apply receipt data');
    } finally {
      setIsApplying(false);
    }
  };

  const resetAndClose = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setStep('upload');
    setSelectedFile(null);
    setPreviewUrl(null);
    setSupplier('');
    setInvoiceNumber('');
    setItems([]);
    setExistingProducts([]);
    setError('');
    setIsApplying(false);
    onClose();
  };

  const totalUnits = items.reduce((sum, item) => sum + item.unitQuantity, 0);
  const totalCost = items.reduce((sum, item) => sum + item.unitCost * item.unitQuantity, 0);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-5xl max-h-[90vh] flex flex-col">
        <CardHeader className="flex flex-row items-center justify-between shrink-0">
          <CardTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            {step === 'upload' && 'Scan Supplier Receipt'}
            {step === 'scanning' && 'Analyzing Receipt...'}
            {step === 'review' && 'Review Scanned Items'}
          </CardTitle>
          <button onClick={resetAndClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto">
          {error && (
            <div className="bg-destructive/10 text-destructive px-4 py-2 rounded-md text-sm mb-4 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {/* Step 1: Upload */}
          {step === 'upload' && (
            <div className="space-y-6">
              <div
                className="border-2 border-dashed border-input rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                {previewUrl ? (
                  <div className="space-y-4">
                    <img
                      src={previewUrl}
                      alt="Receipt preview"
                      className="max-h-64 mx-auto rounded-md object-contain"
                    />
                    <p className="text-sm text-muted-foreground">{selectedFile?.name}</p>
                    <p className="text-xs text-muted-foreground">Click to change image</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <Upload className="h-12 w-12 mx-auto text-muted-foreground" />
                    <div>
                      <p className="font-medium">Upload supplier receipt or invoice</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Take a photo or upload an image of your supplier receipt/invoice.
                        The system will read and extract all products automatically.
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground">JPEG, PNG up to 5MB</p>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={resetAndClose}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={handleScan}
                  disabled={!selectedFile}
                >
                  <Camera className="h-4 w-4 mr-2" />
                  Scan Receipt
                </Button>
              </div>
            </div>
          )}

          {/* Step 2: Scanning */}
          {step === 'scanning' && (
            <div className="py-16 text-center space-y-4">
              <Loader2 className="h-12 w-12 mx-auto text-primary animate-spin" />
              <div>
                <p className="font-medium text-lg">Analyzing your receipt...</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Reading product names, quantities, and prices. This may take a moment.
                </p>
              </div>
            </div>
          )}

          {/* Step 3: Review */}
          {step === 'review' && (
            <div className="space-y-4">
              {/* Supplier Info */}
              <div className="grid grid-cols-2 gap-4 p-4 bg-muted rounded-lg">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Supplier</label>
                  <Input
                    value={supplier}
                    onChange={(e) => setSupplier(e.target.value)}
                    placeholder="Supplier name"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Invoice #</label>
                  <Input
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    placeholder="Invoice number"
                  />
                </div>
              </div>

              {/* Summary bar */}
              <div className="flex items-center justify-between p-3 bg-primary/5 rounded-lg text-sm">
                <span>{items.length} item{items.length !== 1 ? 's' : ''} found</span>
                <span>{totalUnits} total units</span>
                <span>Total cost: {formatCurrency(totalCost)}</span>
              </div>

              {/* Items table */}
              <div className="space-y-3">
                {items.map((item, index) => (
                  <div key={index} className="border border-input rounded-lg p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          {item.isNew ? (
                            <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 px-2 py-0.5 rounded-full font-medium">NEW</span>
                          ) : (
                            <span className="text-xs bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 px-2 py-0.5 rounded-full font-medium">MATCHED</span>
                          )}
                          {!item.isNew && item.matchedProductSku && (
                            <span className="text-xs text-muted-foreground font-mono">{item.matchedProductSku}</span>
                          )}
                        </div>

                        {/* Product name */}
                        <Input
                          value={item.name}
                          onChange={(e) => updateItem(index, { name: e.target.value })}
                          placeholder="Product name"
                          className="mb-2 font-medium"
                        />

                        {/* Match to existing product */}
                        {item.isNew && (
                          <div className="mb-2">
                            <select
                              value=""
                              onChange={(e) => {
                                if (e.target.value) matchToExisting(index, e.target.value);
                              }}
                              className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
                            >
                              <option value="">Match to existing product...</option>
                              {existingProducts.map(p => (
                                <option key={p.id} value={p.id}>
                                  {p.name} ({p.sku})
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        {!item.isNew && (
                          <button
                            onClick={() => unmatchProduct(index)}
                            className="text-xs text-muted-foreground hover:text-foreground mb-2 underline"
                          >
                            Create as new product instead
                          </button>
                        )}
                      </div>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeItem(index)}
                        className="text-destructive shrink-0"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    {/* Quantity fields */}
                    <div className="grid grid-cols-4 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">
                          Cases/Packs
                        </label>
                        <Input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => updateItem(index, { quantity: Math.max(1, parseInt(e.target.value) || 1) })}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">
                          Units per Pack
                        </label>
                        <Input
                          type="number"
                          min="1"
                          value={item.packSize}
                          onChange={(e) => updateItem(index, { packSize: Math.max(1, parseInt(e.target.value) || 1) })}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">
                          Total Units
                        </label>
                        <div className="h-10 flex items-center px-3 bg-muted rounded-md font-bold text-sm">
                          {item.unitQuantity}
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">
                          Unit Cost
                        </label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.unitCost}
                          onChange={(e) => updateItem(index, { unitCost: parseFloat(e.target.value) || 0 })}
                        />
                      </div>
                    </div>

                    {/* Line total */}
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        {item.quantity} pack{item.quantity !== 1 ? 's' : ''} x {item.packSize} unit{item.packSize !== 1 ? 's' : ''} = {item.unitQuantity} units
                      </span>
                      <span className="font-medium">
                        Line total: {formatCurrency(item.unitCost * item.unitQuantity)}
                      </span>
                    </div>

                    {!item.isNew && item.existingCost != null && item.unitCost > 0 && Math.abs(item.unitCost - item.existingCost) > 0.01 && (
                      <p className="text-xs text-warning flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Cost changed from {formatCurrency(item.existingCost)} to {formatCurrency(item.unitCost)} per unit
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {items.length === 0 && (
                <div className="py-8 text-center text-muted-foreground">
                  <p>No items to process. All items have been removed.</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-between pt-4 border-t">
                <Button variant="outline" onClick={() => { setStep('upload'); setItems([]); }}>
                  Re-scan
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={resetAndClose}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    onClick={handleApply}
                    disabled={isApplying || items.length === 0}
                  >
                    {isApplying ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Applying...
                      </>
                    ) : (
                      <>
                        <Check className="h-4 w-4 mr-2" />
                        Confirm & Apply ({items.length} item{items.length !== 1 ? 's' : ''})
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
