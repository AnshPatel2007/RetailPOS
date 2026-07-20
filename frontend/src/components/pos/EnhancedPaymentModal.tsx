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
  ShoppingBasket,
  BookUser,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useStoreSettingsStore } from '@/store/storeSettingsStore';

type PaymentMethod = 'CASH' | 'CARD' | 'GIFT_CARD' | 'STORE_CREDIT' | 'EBT' | 'HOUSE_ACCOUNT';

interface Payment {
  paymentMethod: PaymentMethod;
  amount: number;
  reference?: string;
}

interface EnhancedPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  total: number;
  onComplete: (payments: Payment[], totalPaid: number, pointsRedeemed?: number) => Promise<void>;
  isProcessing: boolean;
  initialPaymentMethod?: PaymentMethod;
  linkedCustomer: LinkedCustomer | null;
  onCustomerChange: (customer: LinkedCustomer | null) => void;
  /** SNAP-eligible portion of the sale — EBT tender is capped at this (0 hides the EBT tile) */
  ebtEligibleTotal?: number;
  /** Card surcharge %, from the location's cash-discount program (0 = off) */
  cardSurchargePercent?: number;
}

/**
 * Cash tender suggestions for a given amount due: the exact amount plus the
 * next round-ups ($1/$5/$10/$20) and common bills, deduped and capped at 5.
 */
const getCashSuggestions = (due: number): number[] => {
  const rounded = Math.round(due * 100) / 100;
  if (rounded <= 0) return [];
  const suggestions = new Set<number>([rounded]);
  [1, 5, 10, 20].forEach((step) => suggestions.add(Math.ceil(rounded / step) * step));
  [20, 50, 100].forEach((bill) => { if (bill >= rounded) suggestions.add(bill); });
  return [...suggestions].filter((v) => v >= rounded).sort((a, b) => a - b).slice(0, 5);
};

export const EnhancedPaymentModal: React.FC<EnhancedPaymentModalProps> = ({
  isOpen,
  onClose,
  total,
  onComplete,
  isProcessing,
  initialPaymentMethod,
  linkedCustomer,
  onCustomerChange,
  ebtEligibleTotal = 0,
  cardSurchargePercent = 0,
}) => {
  const [step, setStep] = useState<'customer' | 'payment'>('customer');
  const [activeTab, setActiveTab] = useState<'single' | 'split'>('single');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [amountInput, setAmountInput] = useState('');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [referenceInput, setReferenceInput] = useState('');
  const [pointsToRedeem, setPointsToRedeem] = useState('');

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

  // Reset ONLY when the modal opens. Keying this on linkedCustomer/total made the
  // modal wipe typed input and jump steps whenever the phone lookup linked a customer.
  useEffect(() => {
    if (isOpen) {
      setStep(linkedCustomer ? 'payment' : 'customer');
      setActiveTab('single');
      const defaultMethod = initialPaymentMethod && allPaymentMethods.find(m => m.value === initialPaymentMethod && m.enabled)
        ? initialPaymentMethod
        : (paymentMethods[0]?.value || 'CASH');
      setPaymentMethod(defaultMethod);
      setAmountInput((Math.round(total * 100) / 100).toFixed(2));
      setPayments([]);
      setReferenceInput('');
      setPointsToRedeem('');
      setCustomerPhone('');
      setIsSearching(false);
      setSearchDone(false);
      setShowCreateForm(false);
      setNewCustomerData({ firstName: '', lastName: '', email: '' });
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (points >= 2000) return { name: 'Gold', css: 'bg-warning/15 text-warning' };
    if (points >= 500) return { name: 'Silver', css: 'bg-secondary text-secondary-foreground' };
    return { name: 'Bronze', css: 'bg-muted text-muted-foreground' };
  };

  const POINTS_PER_DOLLAR = 100; // 100 points = $1
  const getPointsDiscount = () => {
    const pts = parseInt(pointsToRedeem) || 0;
    if (!linkedCustomer || pts <= 0) return 0;
    const maxPoints = Math.min(pts, linkedCustomer.loyaltyPoints);
    const maxDiscount = maxPoints / POINTS_PER_DOLLAR;
    return Math.round(Math.min(maxDiscount, total) * 100) / 100;
  };
  const effectiveTotal = Math.round((total - getPointsDiscount()) * 100) / 100;

  // Card surcharge (cash-discount program): % of the card-paid share of the
  // pre-surcharge total — the server recomputes this with the same rule
  const getCardPaidPlanned = () => {
    if (activeTab === 'single') return paymentMethod === 'CARD' ? effectiveTotal : 0;
    return Math.round(
      payments.filter((p) => p.paymentMethod === 'CARD').reduce((s, p) => s + p.amount, 0) * 100
    ) / 100;
  };
  const getSurcharge = () =>
    cardSurchargePercent > 0
      ? Math.round((cardSurchargePercent / 100) * Math.min(getCardPaidPlanned(), effectiveTotal) * 100) / 100
      : 0;
  const dueTotal = Math.round((effectiveTotal + getSurcharge()) * 100) / 100;

  const getTotalPaid = () => Math.round(payments.reduce((sum, p) => sum + p.amount, 0) * 100) / 100;
  const getRemainingBalance = () => Math.round(Math.max(0, dueTotal - getTotalPaid()) * 100) / 100;
  const getChange = () => {
    if (activeTab === 'single') {
      const paid = parseFloat(amountInput) || 0;
      return Math.max(0, paid - dueTotal);
    }
    return Math.max(0, getTotalPaid() - dueTotal);
  };

  // Switching tender in single mode re-fills the amount with what's actually due
  // (card includes the surcharge, cash doesn't)
  useEffect(() => {
    if (isOpen && step === 'payment' && activeTab === 'single') {
      setAmountInput(dueTotal.toFixed(2));
    }
  }, [paymentMethod]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleQuickAmount = (amount: number) => {
    if (activeTab === 'single') {
      setAmountInput(amount.toFixed(2));
    } else {
      if (amount <= getRemainingBalance()) {
        setAmountInput(amount.toFixed(2));
      }
    }
  };

  // Gift cards need the card number so the backend can debit the right card;
  // store credit is tied to the linked customer's account
  const getTenderError = (method: PaymentMethod, reference?: string): string | null => {
    if (method === 'GIFT_CARD' && !reference?.trim()) {
      return 'Enter the gift card number in the reference field';
    }
    if (method === 'STORE_CREDIT' && !linkedCustomer) {
      return 'Link a customer to pay with store credit';
    }
    if (method === 'HOUSE_ACCOUNT' && !linkedCustomer) {
      return 'Link a customer to charge their house account';
    }
    return null;
  };

  // EBT can only cover the SNAP-eligible portion of the sale (server enforces this too)
  const getEbtPaidSoFar = () =>
    Math.round(payments.filter((p) => p.paymentMethod === 'EBT').reduce((s, p) => s + p.amount, 0) * 100) / 100;

  const getEbtError = (amount: number): string | null => {
    if (paymentMethod !== 'EBT') return null;
    const cap = Math.round(ebtEligibleTotal * 100) / 100;
    if (activeTab === 'single') {
      const charge = Math.min(amount, effectiveTotal);
      if (charge > cap + 0.005) {
        return `EBT covers only ${formatCurrency(cap)} of this sale — use Split Payment for the rest`;
      }
    } else if (getEbtPaidSoFar() + amount > cap + 0.005) {
      return `EBT is capped at ${formatCurrency(cap)} (${formatCurrency(Math.max(0, cap - getEbtPaidSoFar()))} left)`;
    }
    return null;
  };

  const handleAddPayment = () => {
    const amount = parseFloat(amountInput);
    if (!amount || amount <= 0) return;

    if (activeTab === 'split') {
      const remaining = getRemainingBalance();
      if (amount > remaining) return;
      const tenderError = getTenderError(paymentMethod, referenceInput) || getEbtError(amount);
      if (tenderError) {
        toast.error(tenderError);
        return;
      }
      setPayments([...payments, { paymentMethod, amount, reference: referenceInput.trim() || undefined }]);
      setAmountInput('');
      setReferenceInput('');
    }
  };

  const handleRemovePayment = (index: number) => {
    setPayments(payments.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    const redeemed = parseInt(pointsToRedeem) || 0;
    if (activeTab === 'single') {
      const paid = parseFloat(amountInput);
      if (paid < dueTotal) return;
      const tenderError = getTenderError(paymentMethod, referenceInput) || getEbtError(paid);
      if (tenderError) {
        toast.error(tenderError);
        return;
      }
      // Only cash can be tendered over the total (change given); other methods
      // are charged exactly the amount due (surcharge included for card)
      const charge = paymentMethod === 'CASH' ? paid : Math.min(paid, dueTotal);
      await onComplete(
        [{ paymentMethod, amount: charge, reference: referenceInput.trim() || undefined }],
        charge,
        redeemed > 0 ? redeemed : undefined
      );
    } else {
      if (getTotalPaid() < dueTotal) return;
      await onComplete(payments, getTotalPaid(), redeemed > 0 ? redeemed : undefined);
    }
  };

  const getReferencePlaceholder = (method: PaymentMethod): string | null => {
    switch (method) {
      case 'CARD': return 'Transaction ID / last 4 digits';
      case 'GIFT_CARD': return 'Gift card number';
      case 'STORE_CREDIT': return 'Store credit account / ID';
      case 'EBT': return 'EBT card last 4 (optional)';
      default: return null;
    }
  };

  const enabledMethods = useStoreSettingsStore((s) => s.paymentMethods);

  const allPaymentMethods = [
    { value: 'CASH' as const, label: 'Cash', icon: DollarSign, enabled: enabledMethods.cash },
    { value: 'CARD' as const, label: 'Card', icon: CreditCard, enabled: enabledMethods.card },
    { value: 'GIFT_CARD' as const, label: 'Gift Card', icon: Gift, enabled: enabledMethods.giftCard },
    { value: 'STORE_CREDIT' as const, label: 'Store Credit', icon: Wallet, enabled: enabledMethods.storeCredit },
    // EBT only appears when the cart actually contains SNAP-eligible items
    { value: 'EBT' as const, label: 'EBT / SNAP', icon: ShoppingBasket, enabled: ebtEligibleTotal > 0 },
    // House account needs a linked customer (the server checks the account + limit)
    { value: 'HOUSE_ACCOUNT' as const, label: 'House Account', icon: BookUser, enabled: !!linkedCustomer },
  ];

  const paymentMethods = allPaymentMethods.filter((m) => m.enabled);

  const canSubmit = activeTab === 'single'
    ? parseFloat(amountInput) >= dueTotal
      && !getTenderError(paymentMethod, referenceInput)
      && !getEbtError(parseFloat(amountInput) || 0)
    : getTotalPaid() >= dueTotal;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={step === 'customer' ? 'Link Customer · Step 1 of 2' : 'Payment'} size="lg">
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
                          <Star className="h-3 w-3 text-warning" />
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
                    placeholder="Phone number (or last 4 digits)..."
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
                    <Star className="h-3 w-3 inline text-warning" /> {linkedCustomer.loyaltyPoints} pts
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

            {/* Loyalty Points Redemption */}
            {linkedCustomer && linkedCustomer.loyaltyPoints >= POINTS_PER_DOLLAR && (
              <div className="p-3 rounded-lg bg-warning/10 border border-warning/20">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium flex items-center gap-1">
                    <Star className="h-3.5 w-3.5 text-warning" />
                    Redeem Loyalty Points
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {linkedCustomer.loyaltyPoints} pts = {formatCurrency(linkedCustomer.loyaltyPoints / POINTS_PER_DOLLAR)} value
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={pointsToRedeem}
                    onChange={(e) => {
                      const v = parseInt(e.target.value) || 0;
                      setPointsToRedeem(Math.min(v, linkedCustomer.loyaltyPoints).toString());
                    }}
                    placeholder="Points to redeem"
                    min="0"
                    max={linkedCustomer.loyaltyPoints}
                    step={POINTS_PER_DOLLAR}
                    className="flex-1"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const maxRedeemable = Math.min(
                        linkedCustomer.loyaltyPoints,
                        Math.floor(total * POINTS_PER_DOLLAR)
                      );
                      setPointsToRedeem(maxRedeemable.toString());
                    }}
                  >
                    Max
                  </Button>
                  {parseInt(pointsToRedeem) > 0 && (
                    <Button variant="ghost" size="sm" onClick={() => setPointsToRedeem('')}>
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                {getPointsDiscount() > 0 && (
                  <p className="text-xs text-warning mt-1.5 font-medium">
                    -{formatCurrency(getPointsDiscount())} discount applied ({parseInt(pointsToRedeem)} pts)
                  </p>
                )}
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

            {/* Card surcharge callout */}
            {getSurcharge() > 0 && (
              <div className="p-2.5 rounded-lg bg-warning/10 border border-warning/30 text-sm flex items-center justify-between">
                <span>Card surcharge ({cardSurchargePercent}%)</span>
                <span className="font-bold tabular-nums">+{formatCurrency(getSurcharge())}</span>
              </div>
            )}

            {/* Payment Summary */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Card className="p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">Total</p>
                {getPointsDiscount() > 0 || getSurcharge() > 0 ? (
                  <>
                    <p className="text-xs text-muted-foreground line-through">{formatCurrency(total)}</p>
                    <p className="text-lg font-bold text-warning">{formatCurrency(dueTotal)}</p>
                  </>
                ) : (
                  <p className="text-lg font-bold">{formatCurrency(total)}</p>
                )}
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
                    <div>
                      <span className="text-sm font-medium">
                        {payment.paymentMethod.replace(/_/g, ' ')}
                      </span>
                      {payment.reference && (
                        <span className="text-xs text-muted-foreground ml-1">({payment.reference})</span>
                      )}
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
                        className={`p-3 min-h-[64px] border-2 rounded-lg transition-all ${
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

                {/* EBT eligibility banner */}
                {paymentMethod === 'EBT' && (
                  <div className="p-2.5 rounded-lg bg-info/10 border border-info/30 text-sm flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <ShoppingBasket className="h-4 w-4 text-info" />
                      EBT eligible on this sale
                    </span>
                    <span className="font-bold tabular-nums">
                      {formatCurrency(Math.max(0, Math.round(ebtEligibleTotal * 100) / 100 - getEbtPaidSoFar()))}
                    </span>
                  </div>
                )}

                {/* Reference input for non-cash methods */}
                {getReferencePlaceholder(paymentMethod) && (
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Reference{paymentMethod === 'GIFT_CARD' ? ' (required — card number)' : ''}
                    </label>
                    <Input
                      type="text"
                      value={referenceInput}
                      onChange={(e) => setReferenceInput(e.target.value)}
                      placeholder={getReferencePlaceholder(paymentMethod) || ''}
                    />
                  </div>
                )}

                {/* Quick Amount Buttons — smart cash suggestions from the amount due */}
                <div className="flex gap-2 flex-wrap">
                  {activeTab === 'single' && paymentMethod === 'CASH' ? (
                    getCashSuggestions(effectiveTotal).map((amount, i) => (
                      <Button
                        key={amount}
                        variant="outline"
                        size="sm"
                        onClick={() => handleQuickAmount(amount)}
                        className="flex-1 min-w-[64px] h-10 tabular-nums"
                      >
                        {i === 0 ? 'Exact' : formatCurrency(amount)}
                      </Button>
                    ))
                  ) : activeTab === 'single' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAmountInput(dueTotal.toFixed(2))}
                      className="flex-1 min-w-[80px] h-10"
                    >
                      Exact ({formatCurrency(dueTotal)})
                    </Button>
                  ) : getRemainingBalance() > 0 ? (
                    (() => {
                      // EBT quick-fill stops at the eligible cap, not the full remaining balance
                      const fill = paymentMethod === 'EBT'
                        ? Math.min(
                            getRemainingBalance(),
                            Math.max(0, Math.round(ebtEligibleTotal * 100) / 100 - getEbtPaidSoFar())
                          )
                        : getRemainingBalance();
                      return (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setAmountInput(fill.toFixed(2))}
                          className="flex-1 min-w-[80px] h-10"
                          disabled={fill <= 0}
                        >
                          {paymentMethod === 'EBT' ? 'EBT Max' : 'Exact'} ({formatCurrency(fill)})
                        </Button>
                      );
                    })()
                  ) : null}
                </div>
              </>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-4 border-t">
              <Button
                variant="outline"
                className="flex-1 h-12"
                onClick={onClose}
                disabled={isProcessing}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                className="flex-1 h-12 text-base font-semibold"
                onClick={handleSubmit}
                disabled={!canSubmit || isProcessing}
              >
                {isProcessing ? (
                  'Processing...'
                ) : (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Charge {formatCurrency(dueTotal)}
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
