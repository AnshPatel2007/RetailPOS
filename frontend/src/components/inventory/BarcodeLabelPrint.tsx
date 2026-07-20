import React, { useState } from 'react';
import JsBarcode from 'jsbarcode';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Product } from '@/types';
import { Printer, Minus, Plus } from 'lucide-react';

/**
 * Render a scannable Code128 barcode as an inline SVG string. Generated
 * locally — no network fonts, works offline, and scans reliably (the old
 * approach used a Code 39 webfont with negative letter-spacing, which
 * broke scanning and required internet).
 */
const barcodeSvg = (value: string): string => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  try {
    JsBarcode(svg, value, {
      format: 'CODE128',
      displayValue: false,
      margin: 0,
      height: 40,
      width: 2,
    });
    return svg.outerHTML;
  } catch {
    return `<div style="font-size:8px;color:#999;">invalid barcode</div>`;
  }
};

interface BarcodeLabelPrintProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
}

interface LabelItem {
  product: Product;
  quantity: number;
}

export const BarcodeLabelPrint: React.FC<BarcodeLabelPrintProps> = ({
  isOpen,
  onClose,
  products,
}) => {
  const [labelItems, setLabelItems] = useState<LabelItem[]>(() =>
    products.map((p) => ({ product: p, quantity: 1 }))
  );
  const [labelSize, setLabelSize] = useState<'small' | 'medium' | 'large'>('medium');

  // Update quantities when products prop changes
  React.useEffect(() => {
    setLabelItems(products.map((p) => ({ product: p, quantity: 1 })));
  }, [products]);

  const updateQuantity = (index: number, qty: number) => {
    setLabelItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, quantity: Math.max(0, qty) } : item))
    );
  };

  const totalLabels = labelItems.reduce((sum, item) => sum + item.quantity, 0);

  const handlePrint = () => {
    const labelsToprint = labelItems.filter((item) => item.quantity > 0);
    if (labelsToprint.length === 0) return;

    const sizes = {
      small: { width: '38mm', height: '25mm', fontSize: '8px', barcodeHeight: '6mm' },
      medium: { width: '50mm', height: '30mm', fontSize: '9px', barcodeHeight: '9mm' },
      large: { width: '62mm', height: '38mm', fontSize: '10px', barcodeHeight: '12mm' },
    };
    const size = sizes[labelSize];

    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const labelsHtml = labelsToprint
      .flatMap((item) => {
        const code = item.product.barcode || item.product.sku;
        const svg = barcodeSvg(code);
        return Array(item.quantity).fill(null).map(() => `
          <div class="label">
            <div class="product-name">${esc(item.product.name)}</div>
            <div class="barcode">${svg}</div>
            <div class="code-text">${esc(code)}</div>
            <div class="price">$${item.product.price.toFixed(2)}</div>
          </div>
        `);
      })
      .join('');

    const html = `<!DOCTYPE html>
<html>
<head>
  <title>Barcode Labels</title>
  <style>
    @media print {
      @page { margin: 2mm; }
      body { margin: 0; }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; }
    .labels-container {
      display: flex;
      flex-wrap: wrap;
      gap: 2mm;
      padding: 2mm;
    }
    .label {
      width: ${size.width};
      height: ${size.height};
      border: 1px solid #ccc;
      padding: 2mm;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      overflow: hidden;
      page-break-inside: avoid;
    }
    .product-name {
      font-size: ${size.fontSize};
      font-weight: bold;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
    }
    .barcode {
      margin: 1mm 0 0.5mm;
      width: 100%;
      display: flex;
      justify-content: center;
    }
    .barcode svg {
      height: ${size.barcodeHeight};
      max-width: 100%;
    }
    .code-text {
      font-size: ${size.fontSize};
      color: #555;
      letter-spacing: 1px;
    }
    .price {
      font-size: calc(${size.fontSize} + 2px);
      font-weight: bold;
    }
  </style>
</head>
<body>
  <div class="labels-container">${labelsHtml}</div>
  <script>window.onload = function() { window.print(); }</script>
</body>
</html>`;

    const printWindow = window.open('', '_blank', 'width=600,height=800');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Print Barcode Labels" size="lg">
      <div className="space-y-4">
        {/* Label size selector */}
        <div>
          <label className="block text-sm font-medium mb-1">Label Size</label>
          <div className="flex gap-2">
            {(['small', 'medium', 'large'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setLabelSize(s)}
                className={`px-3 py-1.5 rounded text-sm border ${
                  labelSize === s ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-accent'
                }`}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Product list with quantities */}
        <div className="max-h-[300px] overflow-y-auto border rounded-lg divide-y">
          {labelItems.map((item, index) => (
            <div key={item.product.id} className="flex items-center justify-between px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{item.product.name}</p>
                <p className="text-xs text-muted-foreground">{item.product.sku} {item.product.barcode ? `| ${item.product.barcode}` : ''}</p>
              </div>
              <div className="flex items-center gap-1 ml-3">
                <button
                  onClick={() => updateQuantity(index, item.quantity - 1)}
                  className="p-1 rounded hover:bg-accent"
                >
                  <Minus className="h-3 w-3" />
                </button>
                <Input
                  type="number"
                  min="0"
                  value={item.quantity}
                  onChange={(e) => updateQuantity(index, parseInt(e.target.value) || 0)}
                  className="w-14 text-center text-sm h-7"
                />
                <button
                  onClick={() => updateQuantity(index, item.quantity + 1)}
                  className="p-1 rounded hover:bg-accent"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between pt-2">
          <span className="text-sm text-muted-foreground">
            {totalLabels} label{totalLabels !== 1 ? 's' : ''} to print
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={handlePrint} disabled={totalLabels === 0}>
              <Printer className="h-4 w-4 mr-2" />
              Print Labels
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
