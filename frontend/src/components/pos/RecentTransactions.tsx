import React, { useState, useEffect } from 'react';
import { saleService } from '@/services/api';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { ChevronDown, ChevronUp, CreditCard, Banknote, Clock, Receipt } from 'lucide-react';

interface RecentSale {
  id: string;
  saleNumber: string;
  total: number;
  paymentMethod: string;
  status: string;
  createdAt: string;
  customer?: { firstName: string; lastName: string } | null;
}

interface RecentTransactionsProps {
  refreshTrigger?: number;
  onViewReceipt?: (saleId: string) => void;
  initiallyExpanded?: boolean;
  disabled?: boolean;
}

export const RecentTransactions: React.FC<RecentTransactionsProps> = ({
  refreshTrigger,
  onViewReceipt,
  initiallyExpanded = false,
  disabled = false,
}) => {
  const [sales, setSales] = useState<RecentSale[]>([]);
  const [isExpanded, setIsExpanded] = useState(initiallyExpanded);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!isExpanded) return;
    const abort = new AbortController();
    setIsLoading(true); setError('');
    saleService.getAll({ limit: 10, sortBy: 'createdAt', sortOrder: 'desc' }, abort.signal)
      .then(response => { if (!abort.signal.aborted) setSales(response.data.data || []); })
      .catch(() => { if (!abort.signal.aborted) setError('Recent sales could not be loaded.'); })
      .finally(() => { if (!abort.signal.aborted) setIsLoading(false); });
    return () => abort.abort();
  }, [isExpanded, refreshTrigger, retry]);

  const getRelativeTime = (dateStr: string) => {
    const mins = Math.max(0, Math.round((Date.now() - new Date(dateStr).getTime()) / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const PaymentIcon = ({ method }: { method: string }) => {
    if (method === 'CASH') return <Banknote className="h-3.5 w-3.5 text-success" />;
    return <CreditCard className="h-3.5 w-3.5 text-info" />;
  };

  return (
    <div className="border-t border-border">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" />
          Recent Transactions
        </span>
        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {isExpanded && (
        <div className="px-4 pb-3 space-y-1.5 max-h-48 overflow-auto">
          {error ? <div role="alert" className="text-sm">{error} <button type="button" className="text-primary underline" onClick={() => setRetry(value => value + 1)}>Retry</button></div> : isLoading ? (
            <p className="text-xs text-muted-foreground text-center py-2">Loading...</p>
          ) : sales.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-2">No recent sales</p>
          ) : (
            sales.map((sale) => (
              <button
                key={sale.id}
                disabled={disabled}
                onClick={() => onViewReceipt?.(sale.id)}
                className={`w-full text-left rounded-lg border bg-card p-2 cursor-pointer hover:bg-accent/50 transition-colors disabled:opacity-50 ${
                  sale.status === 'REFUNDED' ? 'opacity-60' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <PaymentIcon method={sale.paymentMethod} />
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">
                        #{sale.saleNumber}
                        {sale.customer && (
                          <span className="text-muted-foreground ml-1">
                            — {sale.customer.firstName} {sale.customer.lastName}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {getRelativeTime(sale.createdAt)} · {formatDateTime(sale.createdAt)}
                        {sale.status === 'REFUNDED' && (
                          <span className="ml-1 text-destructive font-medium">Refunded</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-xs font-bold">{formatCurrency(sale.total)}</span>
                    <Receipt className="h-3 w-3 text-muted-foreground" />
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};
