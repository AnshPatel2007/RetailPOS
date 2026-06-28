import React, { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Receipt, hardware } from '@/services/hardware';
import { formatCurrency } from '@/lib/utils';
import { Printer, Mail, X, Check } from 'lucide-react';
import toast from 'react-hot-toast';

interface ReceiptPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  receipt: Receipt;
  onEmailReceipt?: (saleId: string, email: string) => Promise<void>;
  saleId?: string;
}

export const ReceiptPreviewModal: React.FC<ReceiptPreviewModalProps> = ({
  isOpen,
  onClose,
  receipt,
  onEmailReceipt,
  saleId,
}) => {
  const [showEmailInput, setShowEmailInput] = useState(false);
  const [email, setEmail] = useState('');
  const [isSendingEmail, setIsSendingEmail] = useState(false);

  const handlePrint = () => {
    hardware.printer.print(receipt);
    toast.success('Receipt sent to printer');
  };

  const handleSendEmail = async () => {
    if (!email || !onEmailReceipt || !saleId) return;
    setIsSendingEmail(true);
    try {
      await onEmailReceipt(saleId, email);
      toast.success(`Receipt emailed to ${email}`);
      setShowEmailInput(false);
      setEmail('');
    } catch {
      toast.error('Failed to send email receipt');
    } finally {
      setIsSendingEmail(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Receipt">
      <div className="space-y-4">
        {/* Receipt Preview */}
        <div className="bg-card text-foreground rounded-md p-4 max-h-[60vh] overflow-auto font-mono text-xs leading-relaxed">
          <div className="text-center font-bold text-sm mb-1">
            {hardware.getSettings().receiptPrinter.storeName || 'POS System'}
          </div>
          {hardware.getSettings().receiptPrinter.storeAddress && (
            <div className="text-center text-[10px]">
              {hardware.getSettings().receiptPrinter.storeAddress}
            </div>
          )}
          <div className="border-t border-dashed border-border my-2" />

          <div className="text-center">
            <div>Receipt #{receipt.saleNumber}</div>
            <div>{new Date(receipt.date).toLocaleString()}</div>
            {receipt.employeeName && <div>Cashier: {receipt.employeeName}</div>}
          </div>
          <div className="border-t border-dashed border-border my-2" />

          {/* Items */}
          <div className="space-y-1">
            {receipt.items.map((item, i) => (
              <div key={i}>
                <div className="font-medium">{item.name}</div>
                <div className="flex justify-between pl-2">
                  <span>{item.quantity} x ${item.price.toFixed(2)}</span>
                  <span>${item.total.toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-dashed border-border my-2" />

          {/* Totals */}
          <div className="space-y-0.5">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>{formatCurrency(receipt.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span>Tax</span>
              <span>{formatCurrency(receipt.tax)}</span>
            </div>
            {receipt.discount > 0 && (
              <div className="flex justify-between">
                <span>Discount</span>
                <span>-{formatCurrency(receipt.discount)}</span>
              </div>
            )}
            <div className="border-t border-border my-1" />
            <div className="flex justify-between font-bold text-sm">
              <span>TOTAL</span>
              <span>{formatCurrency(receipt.total)}</span>
            </div>
            <div className="flex justify-between">
              <span>Paid ({receipt.paymentMethod})</span>
              <span>{formatCurrency(receipt.amountPaid)}</span>
            </div>
            {receipt.change > 0 && (
              <div className="flex justify-between font-bold">
                <span>Change</span>
                <span>{formatCurrency(receipt.change)}</span>
              </div>
            )}
          </div>

          {receipt.customerName && (
            <>
              <div className="border-t border-dashed border-border my-2" />
              <div className="text-center">
                <div>Customer: {receipt.customerName}</div>
                {receipt.loyaltyPoints !== undefined && (
                  <div>Loyalty Points: {receipt.loyaltyPoints}</div>
                )}
              </div>
            </>
          )}

          <div className="border-t border-dashed border-border my-2" />
          <div className="text-center text-[10px]">
            {hardware.getSettings().receiptPrinter.footerText || 'Thank you for your business!'}
          </div>
        </div>

        {/* Email input */}
        {showEmailInput && (
          <div className="flex gap-2">
            <Input
              type="email"
              placeholder="customer@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSendEmail(); }}
              autoFocus
            />
            <Button
              variant="primary"
              size="sm"
              onClick={handleSendEmail}
              disabled={!email || isSendingEmail}
            >
              {isSendingEmail ? 'Sending...' : 'Send'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowEmailInput(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button variant="outline" onClick={handlePrint} className="flex-1">
            <Printer className="h-4 w-4 mr-2" />
            Print
          </Button>
          {onEmailReceipt && saleId && !showEmailInput && (
            <Button variant="outline" onClick={() => setShowEmailInput(true)} className="flex-1">
              <Mail className="h-4 w-4 mr-2" />
              Email
            </Button>
          )}
          <Button variant="primary" onClick={onClose} className="flex-1">
            <Check className="h-4 w-4 mr-2" />
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
};
