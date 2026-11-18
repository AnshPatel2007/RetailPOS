import { useEffect, useState } from 'react';
import { saleService } from '@/services/api';
import { connectionSettled, isOffline, subscribeConnection } from '@/services/connection';

import type { CheckoutItem, CheckoutQuoteIntent, CheckoutQuote } from '@/types/checkout';

export function useCheckoutQuote(active: boolean, items: CheckoutItem[], intent: CheckoutQuoteIntent) {
  // "Online" means the POS server answers (a store's internet can be down while the browser still says online).
  const [online, setOnline] = useState(!isOffline());
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; data?: CheckoutQuote; error?: string } | null>(null);
  const key = JSON.stringify({ items, ...intent, retry });
  useEffect(() => subscribeConnection(offline => { setOnline(!offline); setRetry(value => value + 1); }), []);
  useEffect(() => {
    if (!active || !online) { setResult(null); return; }
    const controller = new AbortController();
    let current = true;
    const timer = setTimeout(async () => {
      const { items: lines, ...selection } = JSON.parse(key);
      delete selection.retry;
      try {
        const response = await saleService.quote(lines, selection, controller.signal);
        if (current) setResult({ key, data: response.data.data });
      } catch (error: any) {
        // No answer from the server at all: the register is offline now, not showing a pricing error.
        await connectionSettled();
        if (current && !isOffline()) setResult({ key, error: error.response?.data?.error || 'Could not verify the final total. Retry before taking payment.' });
      }
    }, 150);
    return () => { current = false; clearTimeout(timer); controller.abort(); };
  }, [active, online, key]);
  // Compare the key during render, so a changed selection cannot submit an old
  // quote before the effect runs. Late responses never enable Charge.
  const matching = active && result?.key === key ? result : null;
  return {
    online,
    data: matching?.data,
    error: matching?.error,
    pending: active && online && !matching,
    refresh: () => setRetry(value => value + 1),
  };
}
