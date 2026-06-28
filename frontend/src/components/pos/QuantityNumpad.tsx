import React, { useState, useEffect, useRef } from 'react';
import { Delete } from 'lucide-react';

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
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCancel(); return; }
      if (e.key === 'Enter') { handleConfirm(); return; }
      if (e.key === 'Backspace') { handleBackspace(); return; }
      if (/^\d$/.test(e.key)) { handleDigit(e.key); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleDigit = (d: string) => {
    setValue((prev) => {
      const next = prev === '0' ? d : prev + d;
      // Max 3 digits
      if (next.length > 3) return prev;
      return next;
    });
  };

  const handleBackspace = () => {
    setValue((prev) => (prev.length <= 1 ? '1' : prev.slice(0, -1)));
  };

  const handleConfirm = () => {
    const qty = parseInt(value, 10);
    if (!qty || qty < 1) return;
    if (maxQty !== undefined && qty > maxQty) {
      onConfirm(maxQty);
    } else {
      onConfirm(qty);
    }
  };

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={(e) => { if (e.target === overlayRef.current) onCancel(); }}
    >
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-card border border-border rounded-xl shadow-2xl p-4 w-64 z-10">
        <p className="text-sm font-medium text-center mb-1 truncate text-foreground">{productName}</p>
        {maxQty !== undefined && (
          <p className="text-xs text-center text-muted-foreground mb-2">{maxQty} in stock</p>
        )}

        {/* Display */}
        <div className="bg-muted rounded-lg p-3 text-center mb-3">
          <span className="text-3xl font-bold tabular-nums">{value}</span>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-3 gap-2">
          {digits.slice(0, 9).map((d) => (
            <button
              key={d}
              onClick={() => handleDigit(d)}
              className="h-12 rounded-lg bg-background border border-border text-lg font-semibold hover:bg-accent transition-colors active:scale-95"
            >
              {d}
            </button>
          ))}
          {/* Bottom row: backspace, 0, confirm */}
          <button
            onClick={handleBackspace}
            className="h-12 rounded-lg bg-background border border-border flex items-center justify-center hover:bg-accent transition-colors active:scale-95"
          >
            <Delete className="h-5 w-5" />
          </button>
          <button
            onClick={() => handleDigit('0')}
            className="h-12 rounded-lg bg-background border border-border text-lg font-semibold hover:bg-accent transition-colors active:scale-95"
          >
            0
          </button>
          <button
            onClick={handleConfirm}
            className="h-12 rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-colors active:scale-95"
          >
            Add
          </button>
        </div>

        <button
          onClick={onCancel}
          className="mt-2 w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel (Esc)
        </button>
      </div>
    </div>
  );
};
