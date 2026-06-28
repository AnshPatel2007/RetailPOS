import React, { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { formatCurrency } from '@/lib/utils';
import { customerService } from '@/services/api';
import { LinkedCustomer } from '@/components/pos/CustomerLinkSection';
import {
  CreditCard,
  DollarSign,
  Plus,
  X,
  Check,
  Gift,
  Wallet,
  Phone,
  User,
  SkipForward,
  Award,
  Star,
  ArrowRight,
} from 'lucide-react';
import toast from 'react-hot-toast';

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
  initialPaymentMethod?: PaymentMethod;
  linkedCustomer: LinkedCustomer | null;
  onCustomerChange: (customer: LinkedCustomer | null) => void;
}

const QUICK_AMOUNTS = [5, 10, 20, 50, 100];

export const EnhancedPaymentModal: React.FC<EnhancedPaymentModalProps> = ({
  isOpen,
  onClose,
  total,
  onComplete,
  isProcessing,
  initialPaymentMethod,
  linkedCustomer,
  onCustomerChange,
}) => {
  const [step, setStep] = useState<'customer' | 'payment'>('customer');
  const [activeTab, setActiveTab] = useState<'single' | 'split'>('single');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [amountInput, setAmountInput] = useState('');
  const [payments, setPayments] = useState<Payment[]>([]);

  // Customer search state
  const [customerPhone, setCustomerPhone] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchDone, setSearchDone] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newCustomerData, setNewCustomerData] = useState({
    firstName: '',
    lastName: '',
    email: '',
  });

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setStep(linkedCustomer ? 'payment' : 'customer');
      setActiveTab('single');
      setPaymentMethod(initialPaymentMethod || 'CASH');
      setAmountInput(total.toFixed(2));
      setPayments([]);
      setCustomerPhone('');
      setIsSearching(false);
      setSearchDone(false);
      setShowCreateForm(false);
      setNewCustomerData({ firstName: '', lastName: '', email: '' });
    }
  }, [isOpen, total, initialPaymentMethod, linkedCustomer]);

  // Phone lookup with debounce
  useEffect(() => {
    if (step !== 'customer' || customerPhone.length < 3) {
      setSearchDone(false);
      return;
    }
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await customerService.searchByPhone(customerPhone);
        const customer = response.data.data;
        if (customer) {
          onCustomerChange(customer);
          setSearchDone(true);
        } else {
          onCustomerChange(null);
          setSearchDone(true);
        }
      } catch {
        onCustomerChange(null);
        setSearchDone(true);
      } finally {
        setIsSearching(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [customerPhone]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSkipCustomer = () => {
    onCustomerChange(null);
    setStep('payment');
  };

  const handleContinueWithCustomer = () => {
    setStep('payment');
  };

  const handleCreateCustomer = async () => {
    try {
      const response = await customerService.create({
        ...newCustomerData,
        phone: customerPhone,
      });
      onCustomerChange(response.data.data);
      setShowCreateForm(false);
      setNewCustomerData({ firstName: '', lastName: '', email: '' });
      toast.success('Customer created!');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to create customer');
    }
  };

  const getLoyaltyTier = (points: number) => {
    if (points >= 2000) return { name: 'Gold', css: 'bg-yellow-500/10 text-yellow-500' };
    if (points >= 500) return { name: 'Silver', css: 'bg-muted text-foreground' };
    return { name: 'Bronze', css: 'bg-amber-500/10 text-amber-500' };
  };

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
      if (amount > remaining) return;
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
    <Modal isOpen={isOpen} onClose={onClose} title={step === 'customer' ? 'Link Customer' : 'Payment'} size="lg">
      <div className="space-y-4">
        {step === 'customer' ? (
          /* ─── Customer Step ─── */
          <>
            <p className="text-sm text-muted-foreground">
              Link a customer to earn loyalty points, or skip to proceed.
            </p>

            {linkedCustomer ? (
              /* Customer found - show card */
              <div className="p-4 rounded-lg border-2 border-primary bg-primary/5">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <User className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">
                          {linkedCustomer.firstName} {linkedCustomer.lastName}
                        </p>
                        {(() => {
                          const tier = getLoyaltyTier(linkedCustomer.loyaltyPoints);
                          return (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex items-center gap-0.5 ${tier.css}`}>
                              <Award className="h-2.5 w-2.5" />
                              {tier.name}
                            </span>
                          );
                        })()}
                      </div>
                      <p className="text-sm text-muted-foreground">{linkedCustomer.phone}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs flex items-center gap-1">
                          <Star className="h-3 w-3 text-yellow-500" />
                          {linkedCustomer.loyaltyPoints} pts
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatCurrency(linkedCustomer.totalSpent)} spent
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {linkedCustomer.visitCount} visits
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => { onCustomerChange(null); setCustomerPhone(''); setSearchDone(false); }}
                    className="p-1 hover:bg-destructive/10 rounded"
                  >
                    <X className="h-4 w-4 text-destructive" />
                  </button>
                </div>
              </div>
            ) : (
              /* Phone search */
              <>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="tel"
                    placeholder="Enter customer phone number..."
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    className="pl-10"
                    autoFocus
                  />
                  {isSearching && (
                    <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                      <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
                    </div>
                  )}
                </div>

                {/* Not found - offer create */}
                {searchDone && !linkedCustomer && customerPhone.length >= 3 && !showCreateForm && (
                  <div className="p-3 rounded-lg border border-border bg-muted/50 text-center">
                    <p className="text-sm text-muted-foreground mb-2">No customer found for this number</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowCreateForm(true)}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Create New Customer
                    </Button>
                  </div>
                )}

                {/* Create form */}
                {showCreateForm && (
                  <div className="space-y-3 p-3 rounded-lg border border-border">
                    <p className="text-sm font-medium">New customer for {customerPhone}</p>
                    <Input
                      type="text"
                      placeholder="First name *"
                      value={newCustomerData.firstName}
                      onChange={(e) => setNewCustomerData({ ...newCustomerData, firstName: e.target.value })}
                      autoFocus
                    />
                    <Input
                      type="text"
                      placeholder="Last name *"
                      value={newCustomerData.lastName}
                      onChange={(e) => setNewCustomerData({ ...newCustomerData, lastName: e.target.value })}
                    />
                    <Input
                      type="email"
                      placeholder="Email (optional)"
                      value={newCustomerData.email}
                      onChange={(e) => setNewCustomerData({ ...newCustomerData, email: e.target.value })}
                    />
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setShowCreateForm(false)} className="flex-1">
                        Cancel
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={handleCreateCustomer}
                        disabled={!newCustomerData.firstName || !newCustomerData.lastName}
                        className="flex-1"
                      >
                        Create
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Customer step actions */}
            <div className="flex gap-3 pt-4 border-t">
              <Button variant="outline" className="flex-1" onClick={handleSkipCustomer}>
                <SkipForward className="h-4 w-4 mr-2" />
                Skip
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                onClick={handleContinueWithCustomer}
                disabled={!linkedCustomer}
              >
                Continue
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </>
        ) : (
          /* ─── Payment Step ─── */
          <>
            {/* Linked customer indicator */}
            {linkedCustomer && (
              <div className="flex items-center justify-between p-2 rounded-lg bg-primary/5 border border-primary/20">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">
                    {linkedCustomer.firstName} {linkedCustomer.lastName}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    <Star className="h-3 w-3 inline text-yellow-500" /> {linkedCustomer.loyaltyPoints} pts
                  </span>
                </div>
                <button
                  onClick={() => { onCustomerChange(null); }}
                  className="text-xs text-destructive hover:underline"
                >
                  Remove
                </button>
              </div>
            )}

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
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                      onClick={() => setAmountInput(getRemainingBalance().toFixed(2))}
                      className="flex-1 min-w-[80px]"
                    >
                      Exact ({formatCurrency(getRemainingBalance())})
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
          </>
        )}
      </div>
    </Modal>
  );
};

// Add Card component wrapper
const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => <div className={`border border-border rounded-lg ${className}`}>{children}</div>;
