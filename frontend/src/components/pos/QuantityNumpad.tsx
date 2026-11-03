import React, { useState, useEffect, useRef } from 'react';
import { Delete } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';

interface QuantityNumpadProps {
  initialQty?: number;
  maxQty?: number;
  onConfirm: (qty: number) => void;
  onCancel: () => void;
  productName: string;
}

export const QuantityNumpad: React.FC<QuantityNumpadProps> = ({
  initialQty = 1,
  maxQty,
  onConfirm,
  onCancel,
  productName,
}) => {
  const [value, setValue] = useState(String(initialQty));
  const replaceOnNextDigit = useRef(true);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (['Escape', 'Enter', 'Backspace'].includes(e.key) || /^\d$/.test(e.key)) e.preventDefault();
      if (e.key === 'Escape') { onCancel(); return; }
      if (e.key === 'Enter') { handleConfirm(); return; }
      if (e.key === 'Backspace') { handleBackspace(); return; }
      if (/^\d$/.test(e.key)) { handleDigit(e.key); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [value]);

  const handleDigit = (d: string) => {
    const replace = replaceOnNextDigit.current;
    replaceOnNextDigit.current = false;
    setValue((prev) => {
      const next = replace || prev === '0' ? d : prev + d;
      // Max 3 digits
      if (next.length > 3) return prev;
      return next;
    });
  };

  const handleBackspace = () => {
    replaceOnNextDigit.current = false;
    setValue((prev) => (prev.length <= 1 ? '0' : prev.slice(0, -1)));
  };

  const handleConfirm = () => {
    const qty = parseInt(value, 10);
    if (!qty || qty < 1) return;
    if (maxQty !== undefined && qty > maxQty) return;
    onConfirm(qty);
  };

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

  return (
    <Modal isOpen onClose={onCancel} title={`Quantity for ${productName}`} size="sm" className="pos-quantity-dialog">
        {maxQty !== undefined && (
          <p className="text-xs text-center text-muted-foreground mb-2">{maxQty} in stock</p>
        )}

        {/* Display */}
        <div className="bg-muted rounded-lg p-3 text-center mb-3">
          <output aria-label="Quantity" className="text-3xl font-bold tabular-nums">{value}</output>
        </div>
        {maxQty !== undefined && Number(value) > maxQty && <p role="alert" className="text-sm text-destructive mb-2">Only {maxQty} available.</p>}

        {/* Grid */}
        <div className="grid grid-cols-3 gap-2">
          {digits.slice(0, 9).map((d) => (
            <button
              key={d}
              onClick={() => handleDigit(d)}
              className="h-14 rounded-lg bg-background border border-border text-lg font-semibold hover:bg-accent transition-colors active:scale-95"
            >
              {d}
            </button>
          ))}
          {/* Bottom row: backspace, 0, confirm */}
          <button
            onClick={handleBackspace}
            aria-label="Delete last digit"
            className="h-14 rounded-lg bg-background border border-border flex items-center justify-center hover:bg-accent transition-colors active:scale-95"
          >
            <Delete className="h-5 w-5" />
          </button>
          <button
            onClick={() => handleDigit('0')}
            className="h-14 rounded-lg bg-background border border-border text-lg font-semibold hover:bg-accent transition-colors active:scale-95"
          >
            0
          </button>
          <button
            onClick={handleConfirm}
            disabled={Number(value) < 1 || (maxQty !== undefined && Number(value) > maxQty)}
            className="h-14 rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-colors active:scale-95"
          >
            OK
          </button>
        </div>

        <button
          onClick={onCancel}
          className="mt-2 w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel (Esc)
        </button>
    </Modal>
  );
};
