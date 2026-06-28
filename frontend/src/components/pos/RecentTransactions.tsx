import React, { useState, useEffect } from 'react';
import { saleService } from '@/services/api';
import { formatCurrency } from '@/lib/utils';
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
}

export const RecentTransactions: React.FC<RecentTransactionsProps> = ({
  refreshTrigger,
  onViewReceipt,
}) => {
  const [sales, setSales] = useState<RecentSale[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const loadRecent = async () => {
    setIsLoading(true);
    try {
      const response = await saleService.getAll({ limit: 10, sortBy: 'createdAt', sortOrder: 'desc' });
      setSales(response.data.data || []);
    } catch {
      // silently fail
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isExpanded) loadRecent();
  }, [isExpanded, refreshTrigger]);

  const getRelativeTime = (dateStr: string) => {
    const mins = Math.round((Date.now() - new Date(dateStr).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const PaymentIcon = ({ method }: { method: string }) => {
    if (method === 'CASH') return <Banknote className="h-3.5 w-3.5 text-green-500" />;
    return <CreditCard className="h-3.5 w-3.5 text-blue-500" />;
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
        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
      </button>

      {isExpanded && (
        <div className="px-4 pb-3 space-y-1.5 max-h-48 overflow-auto">
          {isLoading ? (
            <p className="text-xs text-muted-foreground text-center py-2">Loading...</p>
          ) : sales.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-2">No recent sales</p>
          ) : (
            sales.map((sale) => (
              <button
                key={sale.id}
                onClick={() => onViewReceipt?.(sale.id)}
                className={`w-full text-left rounded-lg border shadow-sm bg-card p-2 cursor-pointer hover:bg-accent/50 transition-colors ${
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
                      <p className="text-[10px] text-muted-foreground">
                        {getRelativeTime(sale.createdAt)}
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
