import { useState } from 'react';
import { formatCurrency } from '@/lib/utils';

const DENOMINATIONS: { label: string; cents: number }[] = [
  { label: '$100', cents: 10000 }, { label: '$50', cents: 5000 }, { label: '$20', cents: 2000 }, { label: '$10', cents: 1000 },
  { label: '$5', cents: 500 }, { label: '$1', cents: 100 }, { label: 'Quarters', cents: 25 }, { label: 'Dimes', cents: 10 },
  { label: 'Nickels', cents: 5 }, { label: 'Pennies', cents: 1 },
];

const centsIn = (counts: Record<number, string>) => DENOMINATIONS.reduce((sum, item) => sum + item.cents * (parseInt(counts[item.cents] || '0', 10) || 0), 0);
const COINS = new Set(['Quarters', 'Dimes', 'Nickels', 'Pennies']);

/**
 * Optional: count each bill and coin and let the total fill in the counted cash.
 * Closed by default so people who count with a calculator never see it.
 */
export function DrawerCountHelper({ onTotal }: { onTotal: (total: string) => void }) {
  const [counts, setCounts] = useState<Record<number, string>>({});
  const totalCents = centsIn(counts);
  const update = (cents: number, value: string) => {
    const next = { ...counts, [cents]: value.replace(/\D/g, '').slice(0, 5) };
    setCounts(next);
    onTotal((centsIn(next) / 100).toFixed(2));
  };
  return <details className="rounded-md border">
    <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">Count by bills and coins</summary>
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-t p-3 sm:grid-cols-5">
      {DENOMINATIONS.map(item => <label key={item.cents} className="text-xs text-muted-foreground">
        {item.label}
        <input inputMode="numeric" aria-label={`Number of ${COINS.has(item.label) ? item.label.toLowerCase() : item.label + ' bills'}`}
          value={counts[item.cents] || ''} onChange={event => update(item.cents, event.target.value)} placeholder="0"
          className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground tabular-nums" />
      </label>)}
    </div>
    <p className="border-t px-3 py-2 text-sm">Total from the count: <span className="font-semibold tabular-nums">{formatCurrency(totalCents / 100)}</span></p>
  </details>;
}
