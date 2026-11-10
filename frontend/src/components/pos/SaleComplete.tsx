import React, { useState } from 'react';
import { CheckCircle2, Printer, Mail, Receipt as ReceiptIcon, X, CloudOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { formatCurrency, formatEnumLabel } from '@/lib/utils';
import type { Receipt } from '@/services/hardware';

/** The sale that just finished, kept on screen until the next item is added. */
export interface CompletedSale {
  receipt: Receipt | null;
  saleId: string | null;
  total: number;
  paid: number;
  change: number;
  /** "Cash", "Card", "Cash + Card"... */
  paymentLabel: string;
  customerName?: string;
  /** Saved on this register while offline; it has no receipt number yet. */
  offline?: boolean;
}

const methodNames: Record<string, string> = {
  CASH: 'Cash', CARD: 'Card', GIFT_CARD: 'Gift card', STORE_CREDIT: 'Store credit', EBT: 'EBT', HOUSE_ACCOUNT: 'House account',
};
export const paymentLabel = (methods: string[]) =>
  [...new Set(methods)].map(method => methodNames[method] || formatEnumLabel(method)).join(' + ') || 'Paid';

interface SaleCompleteProps {
  sale: CompletedSale;
  onPrint?: () => void;
  onViewReceipt?: () => void;
  onEmail?: (email: string) => Promise<void>;
  onDismiss: () => void;
  /** One-line version for the phone layout, where the cart is a sheet. */
  compact?: boolean;
}

export const SaleComplete: React.FC<SaleCompleteProps> = ({ sale, onPrint, onViewReceipt, onEmail, onDismiss, compact }) => {
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const hasChange = sale.change > 0.004;
  const amount = hasChange ? sale.change : sale.total;
  const label = hasChange ? 'Change due' : 'Paid in full';
  const detail = hasChange
    ? `Paid ${formatCurrency(sale.paid)} ${sale.paymentLabel.toLowerCase()} · Total ${formatCurrency(sale.total)}`
    : sale.paymentLabel === 'Cash' ? 'Cash, exact amount' : sale.paymentLabel;

  const sendEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!onEmail || !email.trim()) return;
    setSending(true);
    try {
      await onEmail(email.trim());
      toast.success(`Receipt emailed to ${email.trim()}`);
      setEmailOpen(false); setEmail('');
    } catch {
      toast.error('The receipt could not be emailed. Check the address and try again.');
    } finally { setSending(false); }
  };

  if (compact) {
    return (
      <section aria-label="Sale complete" data-sale-complete className="pos-sale-complete-strip">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-semibold">{label} </span>
          <span className="text-lg font-bold tabular-nums">{formatCurrency(amount)}</span>
        </p>
        {onViewReceipt && <Button variant="outline" size="sm" onClick={onViewReceipt}>Receipt</Button>}
        <button type="button" onClick={onDismiss} aria-label="Start a new sale" className="pos-cart-tool"><X className="h-4 w-4" /></button>
      </section>
    );
  }

  return (
    <section aria-labelledby="pos-sale-complete-title" data-sale-complete className="pos-sale-complete">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden="true" />
          <h3 id="pos-sale-complete-title" className="font-semibold">Sale complete</h3>
        </div>
        {sale.receipt?.saleNumber && <span className="text-xs text-muted-foreground tabular-nums">#{sale.receipt.saleNumber}</span>}
      </div>

      <div className="pos-sale-complete-amount" role="status">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p className={`font-bold tabular-nums tracking-tight ${hasChange ? 'text-5xl' : 'text-4xl'}`}>{formatCurrency(amount)}</p>
        <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
        {sale.customerName && <p className="mt-1 text-sm">Customer: {sale.customerName}</p>}
      </div>

      {sale.offline && (
        <p className="flex items-center gap-2 rounded-md bg-warning/10 p-2 text-sm text-warning">
          <CloudOff className="h-4 w-4 shrink-0" aria-hidden="true" />Saved on this register. It syncs when the connection is back.
        </p>
      )}

      {(sale.receipt || onEmail) && (
        <div className="flex flex-wrap gap-2">
          {sale.receipt && onPrint && <Button variant="outline" size="sm" onClick={onPrint}><Printer className="h-4 w-4 mr-1.5" />Print receipt</Button>}
          {onEmail && sale.saleId && !emailOpen && <Button variant="outline" size="sm" onClick={() => setEmailOpen(true)}><Mail className="h-4 w-4 mr-1.5" />Email</Button>}
          {sale.receipt && onViewReceipt && <Button variant="ghost" size="sm" onClick={onViewReceipt}><ReceiptIcon className="h-4 w-4 mr-1.5" />View receipt</Button>}
        </div>
      )}
      {emailOpen && (
        <form onSubmit={sendEmail} className="flex gap-2">
          <Input type="email" aria-label="Customer email" placeholder="customer@email.com" value={email} onChange={e => setEmail(e.target.value)} autoFocus required />
          <Button type="submit" variant="primary" size="sm" disabled={!email.trim() || sending}>{sending ? 'Sending…' : 'Send'}</Button>
          <Button type="button" variant="ghost" size="sm" aria-label="Close email receipt form" onClick={() => setEmailOpen(false)}><X className="h-4 w-4" /></Button>
        </form>
      )}

      <div className="flex items-center justify-between gap-2 border-t pt-3">
        <p className="text-sm text-muted-foreground">Scan or tap the next item to start a new sale.</p>
        <Button variant="ghost" size="sm" onClick={onDismiss}>New sale</Button>
      </div>
    </section>
  );
};
