import { Checkbox } from '@/components/ui/Checkbox';
import { Select } from '@/components/ui/Select';
import React, { useState, useRef } from 'react';
import { Upload, Camera, Loader2, Check, AlertTriangle, Trash2 } from 'lucide-react';
import { productService, purchaseOrderService } from '@/services/api';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { sessionGeneration } from '@/services/sessionGeneration';
import { formatCurrency } from '@/lib/utils';
import { useInventoryImport } from '@/hooks/useInventoryImport';
import { ImportReview } from './ImportReview';

interface ScannedItem {
  zeroCostConfirmed?: boolean;
  lineDiscount?: number; damagedQty?: number; rejectedQty?: number;
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
  /** Set when the line is a pack of the matched item (e.g. its carton of 10). */
  sellingUnitId: string | null;
  packName: string | null;
  existingPrice: number | null;
  existingCost: number | null;
  price: number;
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

interface ExistingPack {
  sellingUnitId: string;
  name: string;
  unitsPerPackage: number;
  productId: string;
  productName: string;
  productSku: string;
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
  const [purchaseOrderId, setPurchaseOrderId] = useState(''), [invoiceDate, setInvoiceDate] = useState('');
  const [charges, setCharges] = useState({ freight: '0', acquisitionTax: '0', invoiceDiscount: '0' });
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [billedOverride, setBilledOverride] = useState<boolean | null>(null);
  const orders = useScopedQuery<{ id: string; orderNumber: string; status: string; supplier: { name: string } }[]>(['invoice-open-orders'],
    async signal => (await purchaseOrderService.getAll({ limit: 100 }, signal)).data.data, isOpen && step === 'review');
  const [items, setItems] = useState<ScannedItem[]>([]);
  const [existingProducts, setExistingProducts] = useState<ExistingProduct[]>([]);
  const [existingPacks, setExistingPacks] = useState<ExistingPack[]>([]);
  const workflow = useInventoryImport('RECEIPT', onSuccess, isOpen);
  const isApplying = workflow.busy;
  const [error, setError] = useState('');
  const scanRevision = useRef(0);
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

    const revision = ++scanRevision.current;
    const generation = sessionGeneration();
    setStep('scanning');
    setError('');

    try {
      const response = await productService.scanReceipt(selectedFile);
      if (revision !== scanRevision.current || generation !== sessionGeneration()) return;
      const data = response.data.data;

      setSupplier(data.supplier || '');
      setInvoiceNumber(data.invoiceNumber || '');
      setExistingProducts(data.existingProducts || []);
      setExistingPacks(data.existingPacks || []);

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
        sellingUnitId: item.sellingUnitId || null,
        packName: item.packName || null,
        existingPrice: item.existingPrice || null,
        existingCost: item.existingCost || null,
        price: item.existingPrice || 0,
        sku: '',
        categoryId: '',
        isNew: !item.matchedProductId,
      }));

      setItems(scannedItems);
      setStep('review');
    } catch (err: any) {
      if (revision !== scanRevision.current || generation !== sessionGeneration()) return;
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

  const matchToExisting = (index: number, value: string) => {
    // "pack:<id>" is a pack (e.g. a carton of 10): the line lands on its single, 10 units per pack.
    if (value.startsWith('pack:')) {
      const pack = existingPacks.find(candidate => candidate.sellingUnitId === value.slice(5));
      if (!pack) return;
      const item = items[index];
      const unitQuantity = item.quantity * pack.unitsPerPackage;
      updateItem(index, {
        matchedProductId: pack.productId, matchedProductName: pack.productName, matchedProductSku: pack.productSku,
        sellingUnitId: pack.sellingUnitId, packName: pack.name, packSize: pack.unitsPerPackage,
        unitCost: item.totalCost > 0 ? Math.round(item.totalCost / unitQuantity * 10000) / 10000 : item.unitCost,
        existingPrice: pack.price, existingCost: pack.cost, isNew: false,
      });
      return;
    }
    const product = existingProducts.find(p => p.id === value);
    if (!product) return;

    updateItem(index, {
      matchedProductId: product.id,
      matchedProductName: product.name,
      matchedProductSku: product.sku,
      sellingUnitId: null,
      packName: null,
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
      sellingUnitId: null,
      packName: null,
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

    setError('');
    const hasProblems = items.some(item => (item.damagedQty || 0) > 0 || (item.rejectedQty || 0) > 0);
    await workflow.review({ supplier, invoiceNumber: invoiceNumber || undefined,
      notes: deliveryNotes || undefined, ...(hasProblems ? { supplierBilledForProblems: billedOverride ?? !!invoiceNumber.trim() } : {}),
      purchaseOrderId: purchaseOrderId || undefined, invoiceDate: invoiceDate ? invoiceDate + 'T12:00:00.000Z' : undefined,
      freight: Number(charges.freight), acquisitionTax: Number(charges.acquisitionTax), invoiceDiscount: Number(charges.invoiceDiscount),
      items: items.map(item => ({ matchedProductId: item.matchedProductId, name: item.name,
        packSize: item.packSize, lineDiscount: item.lineDiscount || 0, damagedQty: item.damagedQty || 0, rejectedQty: item.rejectedQty || 0,
        // Whole packs that arrived unopened stay on the shelf as unopened packs.
        ...(item.sellingUnitId && !item.isNew ? { sellingUnitId: item.sellingUnitId,
          receivedPackageQuantity: Math.floor((item.unitQuantity - (item.damagedQty || 0) - (item.rejectedQty || 0)) / item.packSize) } : {}),
        unitQuantity: item.unitQuantity - (item.damagedQty || 0) - (item.rejectedQty || 0), unitCost: item.unitCost, zeroCostConfirmed: item.zeroCostConfirmed || false, price: item.isNew && item.price > 0 ? item.price : undefined,
        barcode: item.barcode, sku: item.sku || undefined, categoryId: item.categoryId || undefined })) });
  };

  const resetAndClose = () => {
    if (workflow.busy) return;
    scanRevision.current += 1;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setStep('upload');
    setSelectedFile(null);
    setPreviewUrl(null);
    setSupplier('');
    setInvoiceNumber('');
    setPurchaseOrderId(''); setInvoiceDate(''); setCharges({ freight: '0', acquisitionTax: '0', invoiceDiscount: '0' }); setBilledOverride(null);
    setItems([]);
    setExistingProducts([]);
    setExistingPacks([]);
    setError('');

    onClose();
  };

  const totalUnits = items.reduce((sum, item) => sum + item.unitQuantity, 0);
  const totalCost = items.reduce((sum, item) => sum + item.unitCost * item.unitQuantity, 0);

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={resetAndClose} size="xl" title={step === 'review' ? 'Review Scanned Items' : step === 'scanning' ? 'Analyzing Receipt...' : 'Scan Supplier Receipt'}>
          {(error || workflow.error) && (
            <div role="alert" className="bg-destructive/10 text-destructive px-4 py-2 rounded-md text-sm mb-4 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error || workflow.error}
            </div>
          )}

          {workflow.pending && <div className="space-y-3"><p>A saved receipt import needs confirmation.</p><Button disabled={workflow.busy} onClick={workflow.commit}>Retry saved import</Button></div>}
          {workflow.result && <div role="status"><p>Import complete: {workflow.result.created} created, {workflow.result.updated} updated.</p><Button className="mt-3" onClick={resetAndClose}>Done</Button></div>}
          {workflow.preview && !workflow.pending && <div className="space-y-4"><ImportReview preview={workflow.preview} /><div className="flex flex-wrap gap-2 justify-end"><Button variant="outline" disabled={workflow.busy} onClick={workflow.resetPreview}>Back to edit</Button>{workflow.preview.id && <Button disabled={workflow.busy} onClick={workflow.commit}>Apply reviewed import</Button>}</div></div>}
          {/* Step 1: Upload */}
          {step === 'upload' && !workflow.pending && !workflow.result && (
            <div className="space-y-6">
              <div
                role="button" tabIndex={0} aria-label="Choose receipt image"
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
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
                        Review the suggested products, quantities and costs before importing.
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground">JPEG, PNG up to 5MB</p>
                  </div>
                )}
                <input
                  aria-label="Receipt image"
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
          {step === 'review' && !workflow.preview && !workflow.pending && !workflow.result && (
            <div className="space-y-4">
              {/* Supplier Info */}
              <div className="grid grid-cols-2 gap-4 p-4 bg-muted rounded-lg">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Supplier</label>
                  <Input
                    aria-label="Supplier"
                    value={supplier}
                    onChange={(e) => setSupplier(e.target.value)}
                    placeholder="Supplier name"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Invoice #</label>
                  <Input
                    aria-label="Invoice number"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    placeholder="Invoice number"
                  />
                </div>
              </div>

              {/* Summary bar */}
              <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Purchase order<Select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm" value={purchaseOrderId} onChange={e => { setPurchaseOrderId(e.target.value); const order = orders.data?.find(order => order.id === e.target.value); if (order) setSupplier(order.supplier.name); }}><option value="">New invoice receipt</option>{orders.data?.filter(order => ['ORDERED','PARTIALLY_RECEIVED'].includes(order.status)).map(order => <option key={order.id} value={order.id}>{order.orderNumber} · {order.supplier.name}</option>)}</Select></label><Input label="Invoice date" type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} /></div>
              <div className="grid gap-3 sm:grid-cols-3">{(['freight','acquisitionTax','invoiceDiscount'] as const).map((field, index) => <Input key={field} label={['Freight','Nonrecoverable acquisition tax','Invoice discount'][index]} type="number" min={0} step="0.01" value={charges[field]} onChange={e => setCharges(old => ({ ...old, [field]: e.target.value }))} />)}</div>
              <p className="text-sm text-muted-foreground">Enter accepted sellable units. Shared invoice charges apply to accepted merchandise; damaged and rejected goods remain outside available inventory.</p>
              {items.some(item => (item.damagedQty || 0) > 0 || (item.rejectedQty || 0) > 0) && <Checkbox label="The invoice charged for the damaged or rejected items"
                checked={billedOverride ?? !!invoiceNumber.trim()} onChange={e => setBilledOverride(e.target.checked)} description="The supplier then owes a credit for them, listed under Purchasing > Credits Owed." />}
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
                            <span className="text-xs bg-info/10 text-info px-2 py-0.5 rounded-full font-medium">NEW</span>
                          ) : (
                            <span className="text-xs bg-success/10 text-success px-2 py-0.5 rounded-full font-medium">MATCHED</span>
                          )}
                          {!item.isNew && item.matchedProductSku && (
                            <span className="text-xs text-muted-foreground font-mono">{item.matchedProductSku}</span>
                          )}
                        </div>

                        {/* Product name */}
                        <Input
                          aria-label={'Product name for item ' + (index + 1)}
                          value={item.name}
                          onChange={(e) => updateItem(index, { name: e.target.value })}
                          placeholder="Product name"
                          className="mb-2 font-medium"
                        />

                        {item.isNew && <div className="grid grid-cols-2 gap-3 mb-3">
                          <label className="text-xs">SKU<Input aria-label={'SKU for item ' + (index + 1)} value={item.sku} onChange={e => updateItem(index, { sku: e.target.value })} /></label>
                          <label className="text-xs">Retail price<Input aria-label={'Retail price for item ' + (index + 1)} type="number" min="0.01" step="0.01" value={item.price || ''} onChange={e => updateItem(index, { price: Number(e.target.value) })} /></label>
                        </div>}
                        {/* Match to existing product */}
                        {item.isNew && (
                          <div className="mb-2">
                            <Select
                              aria-label={'Match item ' + (index + 1) + ' to existing product'}
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
                              {existingPacks.map(pack => (
                                <option key={pack.sellingUnitId} value={`pack:${pack.sellingUnitId}`}>
                                  {pack.name} (pack of {pack.unitsPerPackage} × {pack.productName})
                                </option>
                              ))}
                            </Select>
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
                        aria-label={'Remove item ' + (index + 1)}
                        onClick={() => removeItem(index)}
                        className="text-destructive shrink-0"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    {/* Quantity fields */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">
                          Cases/Packs
                        </label>
                        <Input
                          type="number"
                          min="1"
                          aria-label={'Cases or packs for item ' + (index + 1)}
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
                          aria-label={'Units per pack for item ' + (index + 1)}
                          value={item.packSize}
                          onChange={(e) => updateItem(index, { packSize: Math.max(1, parseInt(e.target.value) || 1), sellingUnitId: null, packName: null })}
                          readOnly={!!item.sellingUnitId}
                        />
                        {item.packName && <p className="mt-1 text-xs text-muted-foreground">{item.packName}</p>}
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
                          aria-label={'Unit cost for item ' + (index + 1)}
                          value={item.unitCost}
                          onChange={(e) => updateItem(index, { unitCost: parseFloat(e.target.value) || 0 })}
                        />
                      </div>
                    </div>
                    {item.packSize > 1 && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="sm:col-span-2">
                          <Input type="number" min="0" step="0.01" label={`Cost per pack of ${item.packSize}`}
                            aria-label={'Cost per pack for item ' + (index + 1)}
                            value={Math.round(item.unitCost * item.packSize * 100) / 100}
                            onChange={(e) => updateItem(index, { unitCost: Math.round((parseFloat(e.target.value) || 0) / item.packSize * 10000) / 10000 })} />
                        </div>
                        <p className="sm:col-span-2 self-end pb-2 text-xs text-muted-foreground">
                          {formatCurrency(item.unitCost * item.packSize)} ÷ {item.packSize} = {formatCurrency(item.unitCost)} per unit, which becomes the item's cost price.
                        </p>
                      </div>
                    )}

                    {item.unitCost === 0 && <Checkbox label="These goods are confirmed free" checked={item.zeroCostConfirmed || false} onChange={e => updateItem(index, { zeroCostConfirmed: e.target.checked })} />}
                    {/* Line total */}
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        {item.quantity} pack{item.quantity !== 1 ? 's' : ''} x {item.packSize} unit{item.packSize !== 1 ? 's' : ''} = {item.unitQuantity} units
                      </span>
                      <span className="font-medium">
                        Line total: {formatCurrency(item.unitCost * item.unitQuantity)}
                      </span>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">{(['lineDiscount','damagedQty','rejectedQty'] as const).map((field, fieldIndex) => <Input key={field} label={['Line discount (accepted goods)','Damaged units','Rejected units'][fieldIndex]} type="number" min={0} step={field === 'lineDiscount' ? '0.01' : '1'} value={item[field] || 0} onChange={e => updateItem(index, { [field]: Number(e.target.value) })} />)}</div>
                    {(!!item.damagedQty || !!item.rejectedQty) && <Input label="Delivery discrepancy reason" value={deliveryNotes} onChange={e => setDeliveryNotes(e.target.value)} />}
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
              <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t">
                <Button variant="outline" onClick={() => { setStep('upload'); setItems([]); }}>
                  Re-scan
                </Button>
                <div className="flex flex-wrap gap-2">
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
                        Reviewing...
                      </>
                    ) : (
                      <>
                        <Check className="h-4 w-4 mr-2" />
                        Review import ({items.length} item{items.length !== 1 ? 's' : ''})
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}
    </Modal>
  );
};
