import React, { useState, useEffect, useRef } from 'react';
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
import { useCheckoutQuote } from '@/hooks/useCheckoutQuote';
import type { CheckoutItem } from '@/types/checkout';
import { amountToComplete, paymentTotal, type CheckoutPayment as Payment, type CheckoutPaymentMethod as PaymentMethod, type PaymentSession } from '@/services/paymentSession';
import { toCents } from '@/lib/money';

interface EnhancedPaymentModalProps {
  session?: PaymentSession | null;
  onSavePayments: (payments: Payment[], points: number, total: number, event: PaymentSession['events'][number], revision: number | null) => Promise<PaymentSession>;
  items: CheckoutItem[];
  isOpen: boolean;
  onClose: () => void;
  total: number;
  onComplete: (payments: Payment[], totalPaid: number, pointsRedeemed?: number, confirmedTotal?: number, session?: PaymentSession) => Promise<PaymentSession | void>;
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
  session,
  onSavePayments,
  items,
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
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [amountInput, setAmountInput] = useState('');
  const amountEdited = useRef(false);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [referenceInput, setReferenceInput] = useState('');
  const [pointsToRedeem, setPointsToRedeem] = useState('');
  const [saving, setSaving] = useState(false);
  const paymentFlight = useRef(false);
  const [paymentError, setPaymentError] = useState('');
  const [reverseIndex, setReverseIndex] = useState<number | null>(null);
  const [reversalReference, setReversalReference] = useState('');
  const [draftRevision, setDraftRevision] = useState<number | null>(null);
  const [unsavedPayment, setUnsavedPayment] = useState(false);
  const changedElsewhere = !!session && session.status === 'OPEN' && session.revision !== draftRevision;
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => { if (unsavedPayment || paymentFlight.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [unsavedPayment]);

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
      amountEdited.current = false;
      setStep(session || linkedCustomer ? 'payment' : 'customer');
      const defaultMethod = initialPaymentMethod && allPaymentMethods.find(m => m.value === initialPaymentMethod && m.enabled)
        ? initialPaymentMethod
        : (paymentMethods[0]?.value || 'CASH');
      setPaymentMethod(defaultMethod);
      setAmountInput((Math.round(total * 100) / 100).toFixed(2));
      setPayments(session?.payments || []);
      setDraftRevision(session?.revision ?? null); setUnsavedPayment(false);
      setReferenceInput('');
      setPointsToRedeem(session?.pointsRedeemed ? String(session.pointsRedeemed) : '');
      setPaymentError(''); setReverseIndex(null); setReversalReference('');
      setCustomerPhone('');
      setIsSearching(false);
      setSearchDone(false);
      setShowCreateForm(false);
      setNewCustomerData({ firstName: '', lastName: '', email: '' });
    }
  }, [isOpen]);

  // Phone lookup with debounce
  useEffect(() => {
    if (step !== 'customer' || customerPhone.length < 3) {
      setSearchDone(false);
      return;
    }
    let current = true;
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await customerService.searchByPhone(customerPhone);
        if (!current) return;
        const customer = response.data.data;
        if (customer) {
          onCustomerChange(customer);
          setSearchDone(true);
        } else {
          onCustomerChange(null);
          setSearchDone(true);
        }
      } catch {
        if (!current) return;
        onCustomerChange(null);
        setSearchDone(true);
      } finally {
        if (current) setIsSearching(false);
      }
    }, 500);
    return () => { current = false; clearTimeout(timer); };
  }, [customerPhone, step]);

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

  const requestedPoints = linkedCustomer ? Math.max(0, parseInt(pointsToRedeem) || 0) : 0;
  const enteredAmount = /^\d+(?:\.\d{0,2})?$/.test(amountInput) ? Number(amountInput) : NaN;
  const candidate = Number.isFinite(enteredAmount) && enteredAmount > 0 && session?.status !== 'SUBMITTED'
    ? [{ paymentMethod, amount: enteredAmount }] : [];
  const quote = useCheckoutQuote(isOpen && step === 'payment' && session?.status !== 'SUBMITTED', items, {
    customerId: linkedCustomer?.id, pointsRedeemed: requestedPoints,
    paymentMethod: 'CASH', payments: [...payments, ...candidate],
  });
  const lastQuote = useRef(quote.data);
  if (quote.data) lastQuote.current = quote.data;
  const POINTS_PER_DOLLAR = quote.data?.pointsPerDollar || lastQuote.current?.pointsPerDollar || 100;
  const quotedBase = quote.data?.baseTotal ?? lastQuote.current?.baseTotal ?? total;
  const getPointsDiscount = () => Math.round(Math.min(requestedPoints / POINTS_PER_DOLLAR, quotedBase) * 100) / 100;
  const effectiveTotal = Math.round((quotedBase - getPointsDiscount()) * 100) / 100;
  const rate = quote.data?.cardSurchargePercent ?? lastQuote.current?.cardSurchargePercent ?? cardSurchargePercent;
  const getSurcharge = () => quote.data?.surcharge ?? Math.round(Math.min(effectiveTotal,
    paymentTotal([...payments, ...candidate].filter(p => p.paymentMethod === 'CARD') as Payment[])) * rate) / 100;
  const dueTotal = session?.status === 'SUBMITTED' ? session.total : quote.data?.total ?? Math.round((effectiveTotal + getSurcharge()) * 100) / 100;
  const offlineCashOnly = !quote.online && requestedPoints === 0 && paymentMethod === 'CASH'
    && payments.every(payment => payment.paymentMethod === 'CASH');
  const quoteReady = quote.online ? !!quote.data : offlineCashOnly;
  const getTotalPaid = () => paymentTotal(payments);
  const getRemainingBalance = () => Math.max(0, toCents(dueTotal) - toCents(getTotalPaid())) / 100;
  const getChange = () => Math.max(0, toCents(getTotalPaid()) + (paymentMethod === 'CASH' && Number.isFinite(enteredAmount) ? toCents(enteredAmount) : 0) - toCents(dueTotal)) / 100;
  const exactAmount = amountToComplete(effectiveTotal, rate, payments, paymentMethod);
  const locked = payments.length > 0;

  useEffect(() => {
    if (isOpen && !amountEdited.current) setAmountInput(exactAmount.toFixed(2));
  }, [exactAmount, isOpen, paymentMethod, step]);
  const handleQuickAmount = (amount: number) => { amountEdited.current = true; setAmountInput(amount.toFixed(2)); };
  const getTenderError = (method: PaymentMethod, reference?: string): string | null => {
    if (method === 'CARD' && !reference?.trim()) return 'Enter the approval reference from your separate terminal';
    if (method === 'CARD' && payments.some(p => p.paymentMethod === 'CARD' && p.reference === reference?.trim())) return 'This approval reference is already recorded';
    if (method === 'GIFT_CARD' && !reference?.trim()) return 'Enter the gift card number';
    if (['STORE_CREDIT', 'HOUSE_ACCOUNT'].includes(method) && !linkedCustomer) return 'Link a customer before using their account';
    return null;
  };
  const getEbtPaidSoFar = () => paymentTotal(payments.filter(p => p.paymentMethod === 'EBT'));
  const getEbtError = (amount: number): string | null => paymentMethod === 'EBT' && getEbtPaidSoFar() + amount > ebtEligibleTotal
    ? 'Use another payment method for the remaining balance' : null;

  const handleRemovePayment = async (index: number) => {
    if (paymentFlight.current || isProcessing || session?.status === 'SUBMITTED' || changedElsewhere) return;
    const payment = payments[index];
    if (payment.paymentMethod === 'CARD' && !reversalReference.trim()) { setReverseIndex(index); return; }
    if (payment.paymentMethod === 'CASH' && !window.confirm('Return ' + formatCurrency(payment.amount) + ' cash to the customer before removing this payment. Confirm cash has been returned?')) return;
    paymentFlight.current = true; setSaving(true); setPaymentError('');
    try {
      const next = payments.filter((_, position) => position !== index);
      const saved = await onSavePayments(next, requestedPoints, dueTotal, { at: Date.now(), action: 'REMOVED', payment, reference: reversalReference.trim() || undefined }, draftRevision);
      setDraftRevision(next.length ? saved.revision : null);
      setPayments(next); setReverseIndex(null); setReversalReference(''); amountEdited.current = false;
    } catch (error: any) { setPaymentError(error.message || 'Could not save the payment change. Keep this screen open.'); }
    finally { paymentFlight.current = false; setSaving(false); }
  };

  const handleSubmit = async () => {
    if (paymentFlight.current || isProcessing || changedElsewhere) return;
    if (session?.status === 'SUBMITTED') {
      paymentFlight.current = true; setSaving(true);
      try { await onComplete(session.payments, paymentTotal(session.payments), session.pointsRedeemed, session.total, session); }
      finally { paymentFlight.current = false; setSaving(false); }
      return;
    }
    if (!quoteReady) return;
    const redeemed = quote.data?.redeemedPoints ?? 0;
    const alreadyCovered = payments.length > 0 && getRemainingBalance() === 0;
    const amount = dueTotal === 0 ? 0 : enteredAmount;
    if (!alreadyCovered && (!Number.isFinite(amount) || amount < 0 || (amount === 0 && dueTotal > 0))) return;
    const error = alreadyCovered || dueTotal === 0 ? null : getTenderError(paymentMethod, referenceInput) || getEbtError(amount);
    if (error) { setPaymentError(error); return; }
    if (!alreadyCovered && paymentMethod !== 'CASH' && toCents(amount) > toCents(getRemainingBalance())) { setPaymentError('A non-cash payment cannot exceed the remaining balance. Enter the actual approved amount.'); return; }
    if (!alreadyCovered && payments.length >= 20) { setPaymentError('A sale can contain at most 20 payments.'); return; }
    paymentFlight.current = true; setSaving(true); setPaymentError('');
    try {
      const payment: Payment = { paymentMethod: dueTotal === 0 ? 'CASH' : paymentMethod, amount, reference: referenceInput.trim() || undefined };
      const next = alreadyCovered ? payments : [...payments, payment];
      const saved = await onSavePayments(next, redeemed, dueTotal, { at: Date.now(), action: alreadyCovered ? 'REVIEWED' : 'ADDED', payment: alreadyCovered ? undefined : payment }, draftRevision);
      setDraftRevision(saved.revision); setUnsavedPayment(false);
      setPayments(next); setReferenceInput(''); setAmountInput(''); amountEdited.current = false;
      if (toCents(paymentTotal(next)) >= toCents(dueTotal)) {
        const reviewed = await onComplete(next, paymentTotal(next), redeemed || undefined, dueTotal, saved);
        if (reviewed) { setPayments(reviewed.payments); setDraftRevision(reviewed.revision); }
      }
    } catch (error: any) { setUnsavedPayment(true); setPaymentError((error.message || 'Payment could not be saved.') + ' Keep this screen open and retry before taking more money.'); }
    finally { paymentFlight.current = false; setSaving(false); }
  };

  const getReferencePlaceholder = (method: PaymentMethod): string | null => {
    switch (method) {
      case 'CARD': return 'Terminal approval / transaction reference';
      case 'GIFT_CARD': return 'Gift card number';
      case 'STORE_CREDIT': return 'Store credit account / ID';
      case 'EBT': return 'EBT card last 4 (optional)';
      default: return null;
    }
  };

  const enabledMethods = useStoreSettingsStore((s) => s.paymentMethods);

  const allPaymentMethods = [
    { value: 'CASH' as const, label: 'Cash', icon: DollarSign, enabled: enabledMethods.cash },
    { value: 'CARD' as const, label: 'Card (external)', icon: CreditCard, enabled: enabledMethods.card },
    { value: 'GIFT_CARD' as const, label: 'Gift Card', icon: Gift, enabled: enabledMethods.giftCard },
    { value: 'STORE_CREDIT' as const, label: 'Store Credit', icon: Wallet, enabled: enabledMethods.storeCredit },
    // Launch gate: eligibility alone does not implement SNAP tax allocation/refunds.
    { value: 'EBT' as const, label: 'EBT / SNAP', icon: ShoppingBasket, enabled: false },
    // House account needs a linked customer (the server checks the account + limit)
    { value: 'HOUSE_ACCOUNT' as const, label: 'House Account', icon: BookUser, enabled: !!linkedCustomer },
  ];

  const paymentMethods = allPaymentMethods.filter((m) => m.enabled);

  const covered = payments.length > 0 && getRemainingBalance() === 0;
  const canSubmit = session?.status === 'SUBMITTED' || quoteReady && (covered || dueTotal === 0 ||
    Number.isFinite(enteredAmount) && enteredAmount > 0 && payments.length < 20 &&
    !getTenderError(paymentMethod, referenceInput) && !getEbtError(enteredAmount) &&
    (paymentMethod === 'CASH' || toCents(enteredAmount) <= toCents(getRemainingBalance())));
  const requestClose = () => { if (unsavedPayment) { toast.error('Save the entered payment before closing this screen.'); return; } if (!isProcessing && !paymentFlight.current) onClose(); };

  return (<>
    <Modal isOpen={isOpen} onClose={requestClose} title={step === 'customer' ? 'Link Customer · Step 1 of 2' : 'Payment'} size="lg" className="pos-payment-dialog" footer={step === 'payment' ? (
      <div className="space-y-3" data-payment-busy={saving || isProcessing ? 'true' : undefined}>
        <div role="status" aria-label="Payment balance" aria-live="polite" className={getRemainingBalance() > 0 ? 'text-warning font-semibold' : 'text-success font-semibold'}>
          {session?.status === 'SUBMITTED' ? 'Payment received — sale confirmation pending' : getRemainingBalance() > 0
            ? 'Payment incomplete · ' + formatCurrency(getRemainingBalance()) + ' still due' : 'Balance covered — confirming sale'}
        </div>
        {getChange() > 0 && <p className="font-semibold">Change: {formatCurrency(getChange())}</p>}
        {locked && <p className="text-xs text-muted-foreground">Saved on this register. Resume with the same cashier and store.</p>}
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1 h-12" onClick={requestClose} disabled={isProcessing || saving}>{locked ? 'Save & close' : 'Cancel'}</Button>
          <Button variant="primary" className="flex-1 h-12 text-base font-semibold" onClick={handleSubmit} disabled={!canSubmit || isProcessing || saving || changedElsewhere}>
            {isProcessing || saving ? 'Saving…' : session?.status === 'SUBMITTED' ? 'Retry saving sale' : covered ? 'Complete sale' : <><Check className="h-4 w-4" />{paymentMethod === 'CARD' ? 'Save payment' : 'Charge'} {formatCurrency(dueTotal === 0 ? 0 : Number.isFinite(enteredAmount) ? enteredAmount : 0)}</>}
          </Button>
        </div>
      </div>) : undefined}>
      {paymentError && <p role="alert" className="mb-3 text-sm text-destructive">{paymentError}</p>}
      {changedElsewhere && !saving && <p role="alert" className="mb-3 text-sm text-warning">Payment changed in another window. Close and reopen Payment before continuing.</p>}
      <fieldset disabled={saving || isProcessing || unsavedPayment || session?.status === 'SUBMITTED'} className="min-w-0">
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
                            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium flex items-center gap-0.5 ${tier.css}`}>
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
                  <button aria-label="Remove linked customer"
                    onClick={() => { onCustomerChange(null); setCustomerPhone(''); setSearchDone(false); }}
                    className="dialog-close inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                  disabled={locked}
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
                    disabled={locked}
                    value={pointsToRedeem}
                    onChange={(e) => {
                      const v = parseInt(e.target.value) || 0;
                      setPointsToRedeem(Math.max(0, Math.min(v, linkedCustomer.loyaltyPoints, Math.floor(total * POINTS_PER_DOLLAR + 0.000001))).toString());
                    }}
                    placeholder="Points to redeem"
                    min="0"
                    max={Math.max(0, Math.min(linkedCustomer.loyaltyPoints, Math.floor(total * POINTS_PER_DOLLAR + 0.000001)))}
                    step={POINTS_PER_DOLLAR}
                    className="flex-1"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (locked) return;
                      const maxRedeemable = Math.min(
                        linkedCustomer.loyaltyPoints,
                        Math.floor(total * POINTS_PER_DOLLAR + 0.000001)
                      );
                      setPointsToRedeem(maxRedeemable.toString());
                    }}
                  >
                    Max
                  </Button>
                  {parseInt(pointsToRedeem) > 0 && (
                    <Button disabled={locked} aria-label="Clear loyalty redemption" variant="ghost" size="sm" onClick={() => setPointsToRedeem('')}>
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

            {quote.pending && <p role="status" className="text-sm text-muted-foreground">Verifying final total…</p>}
            {quote.error && <div role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm"><p>{quote.error}</p><Button variant="outline" className="mt-2" onClick={quote.refresh}>Retry total</Button></div>}
            {!quote.online && <p role="status" className="text-sm text-warning">Offline: cached cash total only. Account payments and loyalty redemption require a connection.</p>}
            {ebtEligibleTotal > 0 && <p className="text-sm text-muted-foreground">EBT/SNAP is unavailable while tax allocation and original-tender refunds are being validated.</p>}
            {paymentMethod === 'CARD' && quoteReady && (
              <p className="text-sm text-muted-foreground">Use the actual approved amount and reference shown by your separate terminal. If it approves less, record that amount; the unpaid balance stays here. This POS does not send a charge to the terminal.</p>
            )}
            {/* Card surcharge callout */}
            {getSurcharge() > 0 && (
              <div className="p-2.5 rounded-lg bg-warning/10 border border-warning/30 text-sm flex items-center justify-between">
                <span>Card surcharge ({quote.data?.cardSurchargePercent ?? cardSurchargePercent}%)</span>
                <span className="font-bold tabular-nums">+{formatCurrency(getSurcharge())}</span>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2" aria-label="Payment totals">
              <Card className="p-3"><p className="text-xs text-muted-foreground">Total</p><p className="text-lg font-bold tabular-nums">{formatCurrency(dueTotal)}</p></Card>
              <Card className="p-3"><p className="text-xs text-muted-foreground">Recorded</p><p className="text-lg font-bold tabular-nums">{formatCurrency(getTotalPaid())}</p></Card>
              <Card className="p-3 border-primary bg-primary/5"><p className="text-xs text-muted-foreground">Remaining</p><p className="text-lg font-bold tabular-nums">{formatCurrency(getRemainingBalance())}</p></Card>
            </div>
            {payments.length > 0 && <div className="space-y-2" aria-label="Recorded payments">
              {payments.map((payment, index) => <div key={index} className="flex items-center justify-between gap-2 rounded border p-2">
                <div className="min-w-0"><p className="text-sm font-medium">{payment.paymentMethod.replace(/_/g, ' ')} · {formatCurrency(payment.amount)}</p>
                  {payment.reference && <p className="break-all text-xs text-muted-foreground">{payment.reference}</p>}
                  {!['CASH', 'CARD'].includes(payment.paymentMethod) && <p className="text-xs text-muted-foreground">Applied when the sale completes</p>}
                </div>
                <Button variant="ghost" size="sm" aria-label={'Remove payment ' + (index + 1)} onClick={() => handleRemovePayment(index)}>{payment.paymentMethod === 'CARD' ? 'Reverse' : payment.paymentMethod === 'CASH' ? 'Return cash' : 'Remove'}</Button>
              </div>)}
            </div>}

            {/* Payment Method Selection */}
            {getRemainingBalance() > 0 && (
              <>
                <div>
                  <label className="block text-sm font-medium mb-2">Payment Method</label>
                  <div className="grid grid-cols-2 gap-2">
                    {paymentMethods.map(({ value, label, icon: Icon }) => (
                      <button
                        key={value}
                        onClick={() => { amountEdited.current = false; setPaymentMethod(value); setReferenceInput(''); setPaymentError(''); }}
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
                    {paymentMethod === 'CARD' ? 'Approved amount' : 'Amount Tendered'}
                  </label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      value={amountInput}
                      onChange={(e) => { amountEdited.current = true; setAmountInput(e.target.value); }}
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      aria-label={paymentMethod === 'CARD' ? 'Approved amount' : 'Amount Tendered'}
                      className="flex-1"
                      autoFocus
                    />
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

                <div className="flex gap-2 flex-wrap">
                  {paymentMethod === 'CASH' ? getCashSuggestions(exactAmount).map((amount, index) => (
                    <Button key={amount} variant="outline" size="sm" onClick={() => handleQuickAmount(amount)} className="flex-1 min-w-[64px] h-10 tabular-nums">{index === 0 ? 'Exact' : formatCurrency(amount)}</Button>
                  )) : <Button variant="outline" onClick={() => handleQuickAmount(exactAmount)}>Remaining ({formatCurrency(exactAmount)})</Button>}
                </div>
              </>
            )}


          </>
        )}
      </div>
      </fieldset>
    </Modal>
    <Modal isOpen={reverseIndex !== null} onClose={() => { if (!saving) { setReverseIndex(null); setReversalReference(''); } }} title="Reverse terminal payment" size="sm" footer={<Button disabled={saving || !reversalReference.trim()} onClick={() => reverseIndex !== null && handleRemovePayment(reverseIndex)}>Confirm reversal</Button>}>
      <p className="mb-3 text-sm">Reverse the {reverseIndex !== null ? formatCurrency(payments[reverseIndex]?.amount || 0) : ''} payment on the separate terminal first. Removing this entry does not refund the card.</p>
      <Input label="Terminal reversal reference" value={reversalReference} onChange={event => setReversalReference(event.target.value)} />
    </Modal>
  </>);
};

// Add Card component wrapper
const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => <div className={`border border-border rounded-lg ${className}`}>{children}</div>;
