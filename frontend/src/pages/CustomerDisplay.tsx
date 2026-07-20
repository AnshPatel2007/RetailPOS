import React, { useState, useEffect } from 'react';
import { subscribeDisplayState, DisplayState } from '@/lib/customerDisplay';
import { formatCurrency } from '@/lib/utils';
import { useStoreSettingsStore } from '@/store/storeSettingsStore';
import { ShoppingBag, Tag, CheckCircle2 } from 'lucide-react';

/**
 * Second-screen customer display. Open this route in a new window and drag it
 * to the customer-facing monitor — it mirrors the register's cart live via a
 * BroadcastChannel (no server round-trips).
 */
export const CustomerDisplay: React.FC = () => {
  const [state, setState] = useState<DisplayState | null>(null);
  const settingsStoreName = useStoreSettingsStore((s) => s.storeInfo.storeName);

  useEffect(() => subscribeDisplayState(setState), []);

  // Clear the "thank you" splash after a few seconds
  useEffect(() => {
    if (state?.completed) {
      const t = setTimeout(() => {
        setState((s) => (s ? { ...s, completed: null } : s));
      }, 6000);
      return () => clearTimeout(t);
    }
  }, [state?.completed]);

  const storeName = state?.storeName || settingsStoreName || 'Welcome';
  const hasItems = (state?.lines.length ?? 0) > 0;

  // ─── Thank-you splash after checkout ───
  if (state?.completed) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-background text-center px-8">
        <CheckCircle2 className="h-24 w-24 text-success mb-6" />
        <h1 className="text-5xl font-bold mb-3">Thank you!</h1>
        <p className="text-2xl text-muted-foreground mb-8">{storeName}</p>
        <div className="text-3xl font-semibold tabular-nums">
          Paid {formatCurrency(state.completed.total)}
        </div>
        {state.completed.change > 0 && (
          <div className="text-2xl text-muted-foreground mt-2 tabular-nums">
            Change {formatCurrency(state.completed.change)}
          </div>
        )}
      </div>
    );
  }

  // ─── Idle / welcome ───
  if (!hasItems) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-background text-center px-8">
        <ShoppingBag className="h-20 w-20 text-primary/40 mb-6" />
        <h1 className="text-5xl font-bold mb-3">{storeName}</h1>
        <p className="text-2xl text-muted-foreground">Welcome!</p>
      </div>
    );
  }

  // ─── Live cart ───
  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="px-8 py-5 border-b flex items-center justify-between">
        <h1 className="text-2xl font-bold">{storeName}</h1>
        <span className="text-muted-foreground text-lg">
          {state!.lines.reduce((c, l) => c + l.quantity, 0)} item
          {state!.lines.reduce((c, l) => c + l.quantity, 0) !== 1 ? 's' : ''}
        </span>
      </header>

      <div className="flex-1 overflow-y-auto px-8 py-4">
        <table className="w-full text-xl">
          <tbody>
            {state!.lines.map((line, i) => (
              <tr key={i} className="border-b border-border/50">
                <td className="py-3">
                  <span className="font-medium">{line.name}</span>
                  {line.quantity > 1 && (
                    <span className="text-muted-foreground ml-2">× {line.quantity}</span>
                  )}
                  {line.promoName && (
                    <span className="ml-3 inline-flex items-center gap-1 text-sm text-success">
                      <Tag className="h-3.5 w-3.5" />
                      {line.promoName}
                    </span>
                  )}
                </td>
                <td className="py-3 text-right tabular-nums font-medium">
                  {formatCurrency(line.lineTotal)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="px-8 py-6 border-t bg-card">
        <div className="max-w-md ml-auto space-y-2 text-xl">
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal</span>
            <span className="tabular-nums">{formatCurrency(state!.subtotal)}</span>
          </div>
          {state!.promoSavings > 0 && (
            <div className="flex justify-between text-success">
              <span>You saved</span>
              <span className="tabular-nums">-{formatCurrency(state!.promoSavings)}</span>
            </div>
          )}
          <div className="flex justify-between text-muted-foreground">
            <span>Tax</span>
            <span className="tabular-nums">{formatCurrency(state!.tax)}</span>
          </div>
          <div className="flex justify-between text-4xl font-bold pt-3 border-t">
            <span>Total</span>
            <span className="tabular-nums">{formatCurrency(state!.total)}</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
