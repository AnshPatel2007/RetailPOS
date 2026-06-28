import React, { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { formatCurrency } from '@/lib/utils';
import {
  CreditCard,
  DollarSign,
  Plus,
  X,
  Check,
  Gift,
  Wallet,
} from 'lucide-react';

type PaymentMethod = 'CASH' | 'CARD' | 'GIFT_CARD' | 'STORE_CREDIT';

interface Payment {
  paymentMethod: PaymentMethod;
  amount: number;
  reference?: string;
}

interface EnhancedPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  total: number;
  onComplete: (payments: Payment[], totalPaid: number) => Promise<void>;
  isProcessing: boolean;
}

const QUICK_AMOUNTS = [5, 10, 20, 50, 100];

export const EnhancedPaymentModal: React.FC<EnhancedPaymentModalProps> = ({
  isOpen,
  onClose,
  total,
  onComplete,
  isProcessing,
}) => {
  const [activeTab, setActiveTab] = useState<'single' | 'split'>('single');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [amountInput, setAmountInput] = useState('');
  const [payments, setPayments] = useState<Payment[]>([]);

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setActiveTab('single');
      setPaymentMethod('CASH');
      setAmountInput(total.toFixed(2));
      setPayments([]);
    }
  }, [isOpen, total]);

  const getTotalPaid = () => payments.reduce((sum, p) => sum + p.amount, 0);
  const getRemainingBalance = () => Math.max(0, total - getTotalPaid());
  const getChange = () => {
    if (activeTab === 'single') {
      const paid = parseFloat(amountInput) || 0;
      return Math.max(0, paid - total);
    }
    return Math.max(0, getTotalPaid() - total);
  };

  const handleQuickAmount = (amount: number) => {
    if (activeTab === 'single') {
      setAmountInput(amount.toFixed(2));
    } else {
      if (amount <= getRemainingBalance()) {
        setAmountInput(amount.toFixed(2));
      }
    }
  };

  const handleAddPayment = () => {
    const amount = parseFloat(amountInput);
    if (!amount || amount <= 0) return;

    if (activeTab === 'split') {
      const remaining = getRemainingBalance();
      if (amount > remaining) {
        return; // Don't allow overpayment in split mode
      }
      setPayments([...payments, { paymentMethod, amount }]);
      setAmountInput('');
    }
  };

  const handleRemovePayment = (index: number) => {
    setPayments(payments.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (activeTab === 'single') {
      const paid = parseFloat(amountInput);
      if (paid < total) return;
      await onComplete([{ paymentMethod, amount: paid }], paid);
    } else {
      if (getTotalPaid() < total) return;
      await onComplete(payments, getTotalPaid());
    }
  };

  const paymentMethods = [
    { value: 'CASH' as const, label: 'Cash', icon: DollarSign },
    { value: 'CARD' as const, label: 'Card', icon: CreditCard },
    { value: 'GIFT_CARD' as const, label: 'Gift Card', icon: Gift },
    { value: 'STORE_CREDIT' as const, label: 'Store Credit', icon: Wallet },
  ];

  const canSubmit = activeTab === 'single'
    ? parseFloat(amountInput) >= total
    : getTotalPaid() >= total;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Payment" size="lg">
      <div className="space-y-4">
        {/* Tabs */}
        <div className="flex border-b border-border">
          <button
            onClick={() => setActiveTab('single')}
            className={`flex-1 py-2 px-4 font-medium text-sm transition-colors ${
              activeTab === 'single'
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Single Payment
          </button>
          <button
            onClick={() => setActiveTab('split')}
            className={`flex-1 py-2 px-4 font-medium text-sm transition-colors ${
              activeTab === 'split'
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Split Payment
          </button>
        </div>

        {/* Payment Summary */}
        <div className="grid grid-cols-3 gap-3">
          <Card className="p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Total</p>
            <p className="text-lg font-bold">{formatCurrency(total)}</p>
          </Card>
          <Card className="p-3 text-center bg-primary/10 border-primary">
            <p className="text-xs text-muted-foreground mb-1">
              {activeTab === 'split' ? 'Remaining' : 'Amount'}
            </p>
            <p className="text-lg font-bold text-primary">
              {formatCurrency(activeTab === 'split' ? getRemainingBalance() : parseFloat(amountInput) || 0)}
            </p>
          </Card>
          <Card className="p-3 text-center bg-success/10 border-success">
            <p className="text-xs text-muted-foreground mb-1">Change</p>
            <p className="text-lg font-bold text-success">{formatCurrency(getChange())}</p>
          </Card>
        </div>

        {/* Split Payments List */}
        {activeTab === 'split' && payments.length > 0 && (
          <div className="space-y-2 max-h-32 overflow-y-auto">
            {payments.map((payment, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-2 bg-muted rounded"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {payment.paymentMethod.replace('_', ' ')}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-bold">{formatCurrency(payment.amount)}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemovePayment(index)}
                    className="text-destructive hover:text-destructive p-1"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
            <div className="p-2 bg-success/10 border border-success rounded">
              <div className="flex justify-between">
                <span className="text-sm font-medium">Total Paid</span>
                <span className="font-bold text-success">{formatCurrency(getTotalPaid())}</span>
              </div>
            </div>
          </div>
        )}

        {/* Payment Method Selection */}
        {(activeTab === 'single' || getRemainingBalance() > 0) && (
          <>
            <div>
              <label className="block text-sm font-medium mb-2">Payment Method</label>
              <div className="grid grid-cols-2 gap-2">
                {paymentMethods.map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    onClick={() => setPaymentMethod(value)}
                    className={`p-3 border-2 rounded-lg transition-all ${
                      paymentMethod === value
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-primary/50'
                    }`}
                  >
                    <Icon className="h-5 w-5 mx-auto mb-1" />
                    <p className="font-medium text-sm">{label}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Amount Input */}
            <div>
              <label className="block text-sm font-medium mb-2">
                {activeTab === 'split' ? 'Add Payment Amount' : 'Amount Tendered'}
              </label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  step="0.01"
                  min="0"
                  placeholder={activeTab === 'split' ? `Max: ${formatCurrency(getRemainingBalance())}` : '0.00'}
                  className="flex-1"
                  autoFocus
                />
                {activeTab === 'split' && (
                  <Button onClick={handleAddPayment} disabled={!amountInput || parseFloat(amountInput) <= 0}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add
                  </Button>
                )}
              </div>
            </div>

            {/* Quick Amount Buttons */}
            <div className="flex gap-2 flex-wrap">
              {QUICK_AMOUNTS.map((amount) => (
                <Button
                  key={amount}
                  variant="outline"
                  size="sm"
                  onClick={() => handleQuickAmount(amount)}
                  className="flex-1 min-w-[60px]"
                >
                  ${amount}
                </Button>
              ))}
              {activeTab === 'single' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAmountInput(total.toFixed(2))}
                  className="flex-1 min-w-[80px]"
                >
                  Exact
                </Button>
              )}
              {activeTab === 'split' && getRemainingBalance() > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPayments([...payments, {
                      paymentMethod,
                      amount: getRemainingBalance(),
                    }]);
                    setAmountInput('');
                  }}
                  className="flex-1 min-w-[80px]"
                >
                  Full Balance
                </Button>
              )}
            </div>
          </>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-4 border-t">
          <Button
            variant="outline"
            className="flex-1"
            onClick={onClose}
            disabled={isProcessing}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            onClick={handleSubmit}
            disabled={!canSubmit || isProcessing}
          >
            {isProcessing ? (
              'Processing...'
            ) : (
              <>
                <Check className="h-4 w-4 mr-2" />
                Complete Sale
              </>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

// Add Card component wrapper
const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => <div className={`border border-border rounded-lg ${className}`}>{children}</div>;
