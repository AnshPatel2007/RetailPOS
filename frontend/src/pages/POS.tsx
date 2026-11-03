import { receiptFromSale } from '@/services/receiptFromSale';
import { isSaleReference, normalizeSaleReference } from '@/lib/receiptReference';
import { lineMoney, roundMoney, taxMoney } from '@/lib/money';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ModalOverlay, Modal as AriaModal, Dialog } from 'react-aria-components';
import { OverlayLevel } from '@/components/ui/Overlay';
import '@/styles/checkout.css';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart, X, DollarSign, Keyboard } from 'lucide-react';
import { productService, saleService, locationService, categoryService, promotionService, shiftService } from '@/services/api';
import { syncService } from '@/services/syncService';
import { checkoutIdentity } from '@/lib/checkoutIdentity';
import { offlineDb, db, TerminalCheckout } from '@/services/offlineDb';
import { TerminalRecovery } from '@/components/pos/TerminalRecovery';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useCartStore } from '@/store/cartStore';
import { useAuthStore } from '@/store/authStore';
import { useApprovalStore } from '@/store/approvalStore';
import { useEffectiveLocation } from '@/hooks/useEffectiveLocation';
import { useFavoritesStore } from '@/store/favoritesStore';
import { Product } from '@/types';
import { formatCurrency } from '@/lib/utils';
import { QuantityNumpad } from '@/components/pos/QuantityNumpad';
import { EnhancedPaymentModal } from '@/components/pos/EnhancedPaymentModal';
import { AgeVerificationModal, AgeVerificationResult } from '@/components/pos/AgeVerificationModal';
import { parsePriceEmbeddedBarcode } from '@/lib/priceBarcode';
import { publishDisplayState } from '@/lib/customerDisplay';
import { ReceiptPreviewModal } from '@/components/pos/ReceiptPreviewModal';
import { QuickRefundModal } from '@/components/pos/QuickRefundModal';
import { HeldSalesModal } from '@/components/pos/HeldSalesModal';
import { ProductGrid } from '@/components/pos/ProductGrid';
import { CartPanel } from '@/components/pos/CartPanel';
import { POSTopBar } from '@/components/pos/POSTopBar';
import { LinkedCustomer } from '@/components/pos/CustomerLinkSection';
import { hardware, Receipt } from '@/services/hardware';
import toast from 'react-hot-toast';
import { AdminViewBanner } from '@/components/AdminViewBanner';
import { RecentTransactions } from '@/components/pos/RecentTransactions';
import { useStoreSettingsStore } from '@/store/storeSettingsStore';
import { useLiveQuery } from 'dexie-react-hooks';
import { currentPaymentSession, savePaymentSession, finishPaymentSession, paymentTotal, type PaymentSession, type CheckoutPayment } from '@/services/paymentSession';
import { cashOperationRejected } from '@/services/pendingCashOperation';

type PaymentMethod = 'CASH' | 'CARD' | 'GIFT_CARD' | 'STORE_CREDIT' | 'EBT' | 'HOUSE_ACCOUNT';

/** Shown only when a product carries a recall / prohibited-sale hold. */
const saleHoldMessage = (product: Product) =>
  product.saleBlockedReason ? `${product.name} cannot be sold: ${product.saleBlockedReason}` : `${product.name} cannot be added`;

export const POS: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string; color?: string | null }[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [productsError, setProductsError] = useState('');
  const [productsRetry, setProductsRetry] = useState(0);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [initialPaymentMethod, setInitialPaymentMethod] = useState<'CASH' | 'CARD' | undefined>(undefined);
  const [isProcessing, setIsProcessing] = useState(false);
  const [linkedCustomer, setLinkedCustomer] = useState<LinkedCustomer | null>(null);
  const [showHeldSalesModal, setShowHeldSalesModal] = useState(false);
  const [numpadProduct, setNumpadProduct] = useState<Product | null>(null);
  const [lastReceipt, setLastReceipt] = useState<Receipt | null>(null);
  const [lastSaleId, setLastSaleId] = useState<string | null>(null);
  const [showReceiptPreview, setShowReceiptPreview] = useState(false);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundSaleId, setRefundSaleId] = useState<string>();
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 900px)');
    const closeMobileCart = () => { if (wide.matches) setMobileCartOpen(false); };
    wide.addEventListener('change', closeMobileCart);
    return () => wide.removeEventListener('change', closeMobileCart);
  }, []);
  const [showMiscModal, setShowMiscModal] = useState(false);
  const [miscPrice, setMiscPrice] = useState('');
  const [miscName, setMiscName] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

  const { user } = useAuthStore();
  const [checkoutShiftId, setCheckoutShiftId] = useState<string | null>(null);
  useEffect(() => {
    shiftService.getCurrent().then(res => setCheckoutShiftId(res.data.data?.id || null)).catch(() => {});
  }, [user?.id]);
  const { locationId, isReadOnly, storeName } = useEffectiveLocation();
  const [terminalAttempts, setTerminalAttempts] = useState<TerminalCheckout[]>([]);
  const [terminalLoading, setTerminalLoading] = useState(true);
  const [terminalStorageError, setTerminalStorageError] = useState('');
  const [terminalNeedsReview, setTerminalNeedsReview] = useState(false);
  const [terminalDurable, setTerminalDurable] = useState(true);
  useEffect(() => {
    let active = true;
    setTerminalLoading(true); setTerminalAttempts([]); setTerminalStorageError('');
    if (!user?.id || !locationId || isReadOnly) { setTerminalLoading(false); return; }
    db.terminalCheckouts.where('[userId+locationId]').equals([user.id, locationId]).filter(record => record.reconciliation?.status !== 'FINAL').sortBy('createdAt')
      .then(records => { if (active) { setTerminalAttempts(records); setTerminalNeedsReview(records.length > 0); } })
      .catch(() => { if (active) setTerminalStorageError('Unable to check saved terminal payments. Restore browser storage and reload before taking payment.'); })
      .finally(() => { if (active) setTerminalLoading(false); });
    return () => { active = false; };
  }, [user?.id, locationId, isReadOnly]);
  useEffect(() => { useStoreSettingsStore.getState().fetchSettings(locationId || undefined); }, [locationId]);
  const { favoriteIds, toggleFavorite, isFavorite } = useFavoritesStore();
  const {
    items, addItem, updateQuantity, updatePrice, clearCart, notes,
    getTax, getTotal, setTaxRate, setCustomer,
    getLineBreakdown, setPromotions, getEbtEligibleTotal, getRequiredAge,
    setCardSurchargePercent, cardSurchargePercent, taxRate,
    heldSales, holdSale, restoreHeldSale, discardHeldSale,
    cleanupExpiredHeldSales,
  } = useCartStore();

  // Age-restricted sales: verification survives until the sale completes or the
  // cart empties, so re-opening the payment modal doesn't re-prompt
  const [ageVerification, setAgeVerification] = useState<AgeVerificationResult | null>(null);
  const [showAgeModal, setShowAgeModal] = useState(false);
  const paymentScope = user?.id + ':' + locationId;
  const paymentRead = useLiveQuery(async () => {
    try { return { scope: paymentScope, session: user?.id && locationId && !isReadOnly ? await currentPaymentSession(user.id, locationId) : null, error: '' }; }
    catch { return { scope: paymentScope, session: null, error: 'Unable to read unfinished payments. Restore browser storage before taking payment.' }; }
  }, [paymentScope, isReadOnly]);
  const paymentReady = paymentRead?.scope === paymentScope;
  const pendingPayment = paymentReady ? paymentRead.session : null;
  const paymentReadError = paymentReady ? paymentRead.error : '';
  const resumePayment = () => {
    if (!pendingPayment || terminalAttempts.length) return;
    try {
      useCartStore.setState({ items: JSON.parse(pendingPayment.cartSnapshot), notes: pendingPayment.notes });
      setLinkedCustomer(pendingPayment.customer); setAgeVerification(pendingPayment.ageVerification);
      setCheckoutShiftId(pendingPayment.shiftId); setShowPaymentModal(true);
    } catch { toast.error('The saved cart needs review. Keep this register data for a manager.'); }
  };
  const savePayments = async (payments: CheckoutPayment[], points: number, total: number, event: PaymentSession['events'][number], revision: number | null) => {
    if (!user?.id || !locationId || isReadOnly || !checkoutShiftId || !paymentReady || paymentReadError) throw new Error('Load the current store, drawer and saved payments first.');
    if (pendingPayment?.status === 'SUBMITTED') throw new Error('Retry the original sale before changing any payments.');
    if ((pendingPayment?.revision ?? null) !== revision) throw new Error('Payment changed in another window. Close and reopen Payment before continuing.');
    if (event.action === 'ADDED' && navigator.onLine) {
      const currentShift = await shiftService.getCurrent();
      if (currentShift.data.data?.id !== checkoutShiftId) throw new Error('The original drawer is no longer open. Review received payments before taking more.');
    }
    if (useAuthStore.getState().user?.id !== user.id || useAuthStore.getState().user?.locationId !== locationId) throw new Error('Cashier or store changed. Reopen the original payment.');
    const session: PaymentSession = pendingPayment || {
      id: crypto.randomUUID(), userId: user.id, locationId, shiftId: checkoutShiftId, revision: 0, createdAt: Date.now(), status: 'OPEN',
      cartSnapshot: JSON.stringify(items), notes, customer: linkedCustomer, ageVerification, payments: [], pointsRedeemed: points, total, events: [],
    };
    const saved = await savePaymentSession({ ...session, payments, pointsRedeemed: points, total, status: payments.length ? 'OPEN' : 'CANCELLED', events: [...session.events, event] }, revision);
    if (event.payment?.paymentMethod === 'CASH' && event.payment.amount > 0 && hardware.drawer.shouldOpen('CASH')) hardware.drawer.open();
    return saved;
  };
  const [pendingPaymentMethod, setPendingPaymentMethod] = useState<'CASH' | 'CARD' | undefined>(undefined);
  const showAgeModalRef = useRef(false);
  useEffect(() => { showAgeModalRef.current = showAgeModal; }, [showAgeModal]);

  // A fresh cart means a fresh customer — never carry a verification over
  useEffect(() => {
    if (items.length === 0 && ageVerification) setAgeVerification(null);
  }, [items.length]);

  /** All checkout entry points funnel through here so the age gate always runs */
  const quoteInFlight = React.useRef(false);
  const startCheckout = async (method?: 'CASH' | 'CARD') => {
    if (isReadOnly || isProcessing || useApprovalStore.getState().request) return;
    if (terminalLoading || terminalStorageError) { toast.error(terminalStorageError || 'Checking saved terminal payments. Please wait.'); return; }
    if (terminalAttempts.length) { setTerminalNeedsReview(true); toast.error('Reconcile the previous terminal payment before starting another checkout.'); return; }
    if (!paymentReady || paymentReadError) { toast.error(paymentReadError || 'Checking unfinished payments. Please wait.'); return; }
    if (pendingPayment) { resumePayment(); return; }
    if (items.length === 0) return;
    if (quoteInFlight.current) return;
    quoteInFlight.current = true;
    try {
      localStorage.setItem('pos-storage-check', 'ready');
      localStorage.removeItem('pos-storage-check');
      await db.settings.put({ key: 'checkout_storage_ready', value: Date.now() });
    } catch {
      quoteInFlight.current = false;
      toast.error('Browser storage is unavailable. Restore storage before taking payment.');
      return;
    }
    if (navigator.onLine) {
      quoteInFlight.current = true;
      try {
        await useStoreSettingsStore.getState().fetchSettings(locationId || undefined);
        const configuration = useStoreSettingsStore.getState();
        if (!configuration.isLoaded || configuration.error) {
          toast.error(configuration.error || 'Load current store settings before checkout.');
          return;
        }
        const currentShift = await shiftService.getCurrent();
        if (!currentShift.data.data?.id) { toast.error('Clock in before taking payment.'); return; }
        setCheckoutShiftId(currentShift.data.data.id);
        const { data } = await saleService.quote(items.map(item => ({ productId: item.product.id, quantity: item.quantity, price: item.product.price, discount: item.discount, priceOverride: item.priceOverride, name: item.product.name })));
        useCartStore.getState().applyQuote(data.data);
      } catch (error: any) {
        toast.error(error.response?.data?.error || 'Could not verify the checkout total. Try again before taking payment.');
        return;
      } finally { quoteInFlight.current = false; }
    }
    quoteInFlight.current = false;
    const requiredAge = useCartStore.getState().getRequiredAge();
    if (requiredAge > 0 && (!ageVerification || ageVerification.verifiedForAge < requiredAge)) {
      setPendingPaymentMethod(method);
      setShowAgeModal(true);
      return;
    }
    setInitialPaymentMethod(method);
    setShowPaymentModal(true);
  };

  // Cleanup expired held sales on mount
  useEffect(() => {
    const expired = cleanupExpiredHeldSales();
    if (expired > 0) {
      toast(`Removed ${expired} expired held sale${expired > 1 ? 's' : ''} (older than 24h)`, { icon: '🧹' });
    }
  }, []);

  // Keep the cart store's customer in sync with the linked customer so held
  // sales retain (and restore) their customer
  useEffect(() => {
    setCustomer(linkedCustomer as any);
  }, [linkedCustomer, setCustomer]);

  // Load location tax + card-surcharge rates
  useEffect(() => {
    if (!locationId) return;
    locationService.getById(locationId).then((res) => {
      const loc = res.data?.data ?? res.data;
      if (typeof loc?.taxRate === 'number') setTaxRate(loc.taxRate);
      if (typeof loc?.cardSurchargePercent === 'number') setCardSurchargePercent(loc.cardSurchargePercent);
    }).catch(() => {});
  }, [locationId, setTaxRate, setCardSurchargePercent]);

  // Mirror the cart to the customer-facing display (second window, if open)
  useEffect(() => {
    if (isReadOnly) return;
    const breakdown = getLineBreakdown();
    const gross = Math.round(items.reduce((s, i) => s + i.product.price * i.quantity, 0) * 100) / 100;
    const savings = Math.round(
      Object.values(breakdown).reduce((s, l) => s + l.totalDiscount, 0) * 100
    ) / 100;
    publishDisplayState({
      storeName: '', // display falls back to its own store settings
      lines: items.map((i) => ({
        name: i.product.name,
        quantity: i.quantity,
        lineTotal: Math.round(
          (i.product.price * i.quantity - (breakdown[i.product.id]?.totalDiscount ?? i.discount)) * 100
        ) / 100,
        promoName: breakdown[i.product.id]?.promotionName,
      })),
      subtotal: gross,
      promoSavings: savings,
      tax: getTax(),
      total: getTotal(),
    });
  }, [items, taxRate, isReadOnly]);

  // Load active promotions so the cart preview prices lines like the server will.
  // Refreshed on focus; the engine re-checks day/time windows on every render.
  const loadPromotions = useCallback(() => {
    promotionService.getActive({ locationId: locationId || undefined }).then((res) => {
      setPromotions(res.data.data || []);
    }).catch(() => {});
  }, [setPromotions, locationId]);

  useEffect(() => {
    loadPromotions();
    const handleFocus = () => loadPromotions();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [loadPromotions]);

  // Load categories (and refresh on window focus)
  const loadCategories = useCallback(() => {
    categoryService.getAll({ locationId: locationId || undefined }).then((res) => {
      const all = res.data.data || [];
      // Only show categories that have at least one active product
      setCategories(all.filter((c: any) => c._count?.products > 0));
    }).catch(() => {});
  }, [locationId]);

  useEffect(() => {
    loadCategories();
    const handleFocus = () => loadCategories();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [loadCategories]);

  // Load products when search/category changes (debounce search)
  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true); setProductsError('');
    const timer = setTimeout(() => { void loadProducts(controller.signal); }, search ? 300 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search, selectedCategoryId, locationId, productsRetry]);

  // Barcode scanner
  useEffect(() => {
    const handleBarcodeScan = async (barcode: string) => {
      if (isReadOnly || pendingPayment || !paymentReady || paymentReadError) return;
      if (document.querySelector('[role="dialog"]')) return;
      // The age-verification modal handles its own license scans — don't let
      // AAMVA payload fragments trigger product searches underneath it
      if (showAgeModalRef.current) return;

      // Price-embedded barcodes (2-prefix scale/deli labels): the barcode itself
      // carries the price; the item code identifies the product
      const embedded = parsePriceEmbeddedBarcode(barcode);
      if (embedded) {
        toast.loading(`Reading price label...`, { id: 'barcode-search' });
        try {
          const resp = await productService.getAll({ search: embedded.itemCode, isActive: true, limit: 10 });
          const found = (resp.data.data || []).find(
            (p: Product) =>
              p.priceEmbedded &&
              (p.barcode === embedded.itemCode || p.sku === embedded.itemCode || p.barcode === barcode)
          );
          if (found) {
            if (!addItem(found, 1)) { toast.error(saleHoldMessage(found), { id: 'barcode-search' }); return; }
            // The label price wins — flags the line as an override so the server
            // (which allows it for priceEmbedded products) charges the same amount
            updatePrice(found.id, embedded.price);
            toast.success(`Added: ${found.name} — ${formatCurrency(embedded.price)}`, { id: 'barcode-search' });
          } else {
            toast.error(
              `No price-embedded product for code ${embedded.itemCode}. Flag the product as "Price-embedded barcode" in Inventory.`,
              { id: 'barcode-search' }
            );
          }
        } catch {
          toast.error('Failed to look up price label', { id: 'barcode-search' });
        }
        return;
      }

      // Receipt QR codes encode the sale number — scanning one pulls up the
      // receipt for returns/lookups instead of searching products
      if (isSaleReference(barcode)) {
        toast.loading('Looking up receipt...', { id: 'barcode-search' });
        try {
          const saleRes = await saleService.getAll({ saleNumber: normalizeSaleReference(barcode), limit: 1 });
          const found = saleRes.data.data?.[0];
          if (found) {
            toast.success(`Receipt ${barcode}`, { id: 'barcode-search' });
            setRefundSaleId(found.id); setShowRefundModal(true);
          } else {
            toast.error(`Sale not found: ${barcode}`, { id: 'barcode-search' });
          }
        } catch {
          toast.error('Failed to look up receipt', { id: 'barcode-search' });
        }
        return;
      }

      toast.loading(`Searching for barcode: ${barcode}`, { id: 'barcode-search' });
      try {
        const response = await productService.getAll({ search: barcode, isActive: true, limit: 10, includeSellingUnits: true });
        const found: Product[] = response.data.data;
        // A single can and its 12-pack share stock but have their own barcodes:
        // an exact barcode match decides which one was scanned.
        const exact = found.filter(p => p.barcode === barcode);
        const scanned = exact.length === 1 ? exact[0] : found.length === 1 ? found[0] : null;
        if (scanned) {
          if (!addItem(scanned)) { toast.error(saleHoldMessage(scanned), { id: 'barcode-search' }); return; }
          toast.success(`Added: ${scanned.name}`, { id: 'barcode-search' });
        } else if (found.length > 1) {
          setSearch(barcode);
          toast.success(`Found ${found.length} products`, { id: 'barcode-search' });
        } else {
          toast.error(`Product not found: ${barcode}`, { id: 'barcode-search' });
        }
      } catch {
        toast.error('Failed to search product', { id: 'barcode-search' });
      }
    };
    hardware.scanner.onScan(handleBarcodeScan);
    return () => { hardware.scanner.offScan(handleBarcodeScan); };
  }, [addItem, isReadOnly, pendingPayment, paymentReady, paymentReadError]);

  // Keyboard shortcuts
  const handleKeyboardShortcuts = useCallback((e: KeyboardEvent) => {
    if (e.defaultPrevented || document.querySelector('[role="menu"]')) return;
    if (isReadOnly || isProcessing || useApprovalStore.getState().request) return;
    if (document.querySelector('[data-payment-busy="true"]')) return;
    if (showPaymentModal && document.querySelector('[role="dialog"]')) return;
    const tag = (e.target as HTMLElement).tagName;
    const inInput = tag === 'INPUT' || tag === 'TEXTAREA';

    if (e.key === 'Escape') {
      e.preventDefault();
      // Close any open modal first, then navigate away
      if (showAgeModal) { setShowAgeModal(false); return; }
      if (showPaymentModal) { setShowPaymentModal(false); return; }
      if (showHeldSalesModal) { setShowHeldSalesModal(false); return; }
      if (showRefundModal) { setShowRefundModal(false); setRefundSaleId(undefined); return; }
      if (showMiscModal) { setShowMiscModal(false); return; }
      if (showReceiptPreview) { setShowReceiptPreview(false); return; }
      if (showShortcutsHelp) { setShowShortcutsHelp(false); return; }
      if (numpadProduct) { setNumpadProduct(null); return; }
      if (mobileCartOpen) { setMobileCartOpen(false); return; }
      if (inInput) { (e.target as HTMLElement).blur(); return; }
      navigate('/dashboard');
      return;
    }
    if (e.key === 'F1') { e.preventDefault(); startCheckout('CASH'); return; }
    if (e.key === 'F2') { e.preventDefault(); startCheckout('CARD'); return; }
    if (e.key === 'F4') { e.preventDefault(); startCheckout(undefined); return; }
    if (pendingPayment || !paymentReady || paymentReadError) return;
    if (e.key === 'F5') { e.preventDefault(); handleHoldSale(); return; }
    if (e.key === 'F6') { e.preventDefault(); setShowHeldSalesModal(true); return; }
    if (e.key === 'F7') { e.preventDefault(); setMiscPrice(''); setMiscName(''); setShowMiscModal(true); return; }
    if (e.key === 'F8') { e.preventDefault(); setShowRefundModal(true); return; }
    if (e.key === '?' && !inInput) { e.preventDefault(); setShowShortcutsHelp(prev => !prev); return; }
    if ((e.key === '/' || e.key === 'F3') && !inInput) {
      e.preventDefault();
      searchInputRef.current?.focus();
    }
  }, [items, showPaymentModal, showHeldSalesModal, showRefundModal, showMiscModal, showReceiptPreview, showShortcutsHelp, numpadProduct, showAgeModal, ageVerification, isReadOnly, isProcessing, pendingPayment, paymentReady, paymentReadError, mobileCartOpen]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyboardShortcuts);
    return () => window.removeEventListener('keydown', handleKeyboardShortcuts);
  }, [handleKeyboardShortcuts]);

  // --- Handlers ---

  const loadProducts = async (signal: AbortSignal) => {
    try {
      const isFavoritesTab = selectedCategoryId === 'FAVORITES';
      const response = await productService.getAll({
        locationId: locationId || undefined,
        search,
        categoryId: isFavoritesTab ? undefined : (selectedCategoryId || undefined),
        isActive: true,
        limit: 50,
        includeSellingUnits: true,
      }, signal);
      if (signal.aborted) return;
      let result = response.data.data;
      // Hide MISC product from grid — it's only used internally for ad-hoc charges
      result = result.filter((p: Product) => p.sku !== 'MISC-001');
      if (isFavoritesTab) {
        result = result.filter((p: Product) => favoriteIds.includes(p.id));
      }
      setProducts(result);

      // Cache products for offline use (fire-and-forget)
      // The sync service caches the complete catalog; filtered pages must not replace it.
    } catch (error: any) {
      if (signal.aborted || error.code === 'ERR_CANCELED') return;
      // Fallback to cached products when offline
      if (!navigator.onLine) {
        try {
          const cached = user?.id && locationId ? await offlineDb.getAllProducts({ userId: user.id, locationId }) : [];
          if (signal.aborted) return;
          if (!cached.length) throw new Error('No product cache available for this cashier and store');
          let result = cached
            .filter(p => p.isActive && p.sku !== 'MISC-001')
            .map(p => ({ ...p, category: p.categoryName ? { id: p.categoryId || '', name: p.categoryName } : null }) as any);
          if (search) {
            const q = search.toLowerCase();
            result = result.filter((p: any) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.barcode && p.barcode.includes(search)));
          }
          if (selectedCategoryId === 'FAVORITES') result = result.filter((p: Product) => favoriteIds.includes(p.id));
          else if (selectedCategoryId) result = result.filter((p: Product) => p.categoryId === selectedCategoryId);
          setProducts(result);
        } catch {
          if (!signal.aborted) { setProducts([]); setProductsError('No offline catalog is available for this cashier and store. Reconnect to load products.'); }
        }
      } else {
        setProducts([]);
        setProductsError(error.response?.data?.error || 'Unable to load products. Try again.');
      }
    } finally {
      if (!signal.aborted) setIsLoading(false);
    }
  };

  const getCartQty = (productId: string): number => {
    return items.find((i) => i.product.id === productId)?.quantity ?? 0;
  };

  // Recorded stock never blocks a sale (the customer is holding the item).
  const handleProductClick = (product: Product) => {
    if (isReadOnly) return;
    if (!addItem(product, 1)) toast.error(saleHoldMessage(product));
  };

  const handleHoldSale = () => {
    if (items.length === 0) { toast.error('Cart is empty'); return; }
    if (heldSales.length >= 5) { toast.error('Maximum 5 sales on hold'); return; }
    holdSale();
    setLinkedCustomer(null);
    toast.success('Sale placed on hold');
  };

  const handleAddMisc = () => {
    const price = parseFloat(miscPrice);
    if (!price || price <= 0) { toast.error('Enter a valid price'); return; }
    const label = miscName.trim() || 'Misc Item';
    const miscProduct: Product = {
      stockVersion: 0,
      id: `misc-${Date.now()}`,
      sku: 'MISC',
      name: label,
      description: null,
      categoryId: null,
      cost: 0,
      price,
      compareAtPrice: null,
      trackInventory: false,
      stockQuantity: 0,
      lowStockAlert: 0,
      barcode: null,
      image: null,
      isActive: true,
      isTaxable: true,
      allowBackorder: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    addItem(miscProduct, 1);
    setShowMiscModal(false);
    toast.success(`Added: ${label} — ${formatCurrency(price)}`);
  };

  const handleRestoreHeld = (id: string) => {
    restoreHeldSale(id);
    setShowHeldSalesModal(false);
    // Restore the customer that was linked when the sale was held
    const restoredCustomer = useCartStore.getState().customer;
    setLinkedCustomer(restoredCustomer as any);
    toast.success('Sale restored');
  };

  // Numpad confirms the TOTAL quantity for the item (it opens pre-filled with
  // the current cart quantity), so set rather than add
  const handleSetQuantity = (product: Product, qty: number) => {
    if (qty <= 0) return;
    const current = getCartQty(product.id);
    if (current === 0) {
      addItem(product, qty);
    } else if (qty !== current) {
      updateQuantity(product.id, qty);
    }
  };

  const handlePrintReceipt = () => {
    if (!lastReceipt) return;
    hardware.printer.print(lastReceipt);
    toast.success('Receipt sent to printer');
  };

  // Re-open a receipt from the recent-transactions list
  const handleViewRecentReceipt = async (saleId: string) => {
    try {
      const response = await saleService.getById(saleId);
      const sale = response.data.data;
      const receipt = receiptFromSale(sale);
      setLastReceipt(receipt);
      setLastSaleId(saleId);
      setShowReceiptPreview(true);
    } catch {
      toast.error('Could not load receipt');
    }
  };

  const handlePaymentComplete = async (
    payments: { paymentMethod: PaymentMethod; amount: number; reference?: string }[],
    totalPaid: number,
    pointsRedeemed?: number,
    confirmedTotal?: number,
    paymentSession?: PaymentSession
  ) => {
    if (isReadOnly || isProcessing || terminalAttempts.length || terminalLoading || terminalStorageError) return;
    if (items.length === 0) return;
    const total = getTotal();
    // Loyalty redemption reduces the amount due (100 pts = $1)
    const pointsValue = pointsRedeemed && pointsRedeemed > 0
      ? Math.round(Math.min(pointsRedeemed / 100, total) * 100) / 100
      : 0;
    const amountDue = Math.round((total - pointsValue) * 100) / 100;
    const primaryPayment = payments.reduce((a, b) => (a.amount >= b.amount ? a : b));
    const hasCashPayment = payments.some((p) => p.paymentMethod === 'CASH');
    setIsProcessing(true);
    const createdAt = Date.now();
    const fingerprint = JSON.stringify({ userId: user?.id, locationId, items, payments, pointsRedeemed, customerId: linkedCustomer?.id, notes });
    let attempt;
    try {
      attempt = paymentSession ? { key: paymentSession.id, createdAt: paymentSession.createdAt } : checkoutIdentity(localStorage, fingerprint, () => crypto.randomUUID(), createdAt);
    } catch {
      setIsProcessing(false);
      toast.error('Browser storage is unavailable. Enable storage before taking payment.');
      return;
    }
    let saleData: any = { idempotencyKey: attempt!.key };
    const hasCardPayment = payments.some(p => p.paymentMethod === 'CARD');
    let savedTerminalAttempt: TerminalCheckout | undefined;
    try {
      Object.assign(saleData, {
        items: items.map((item) => ({
          productId: item.product.id,
          quantity: item.quantity,
          price: item.product.price,
          discount: item.discount,
          notes: item.notes,
          ...(item.priceOverride ? { priceOverride: true } : {}),
          ...(item.product.id.startsWith('misc-') ? { name: item.product.name } : {}),
        })),
        paymentMethod: primaryPayment.paymentMethod,
        amountPaid: totalPaid,
        expectedTotal: confirmedTotal,
        payments: payments.map((p) => ({
          paymentMethod: p.paymentMethod,
          amount: p.amount,
          reference: p.reference,
        })),
      });

      if (linkedCustomer) saleData.customerId = linkedCustomer.id;
      if (pointsRedeemed && pointsRedeemed > 0) saleData.pointsRedeemed = pointsRedeemed;
      // Attach the age check so the server can log it against the sale
      if (getRequiredAge() > 0 && ageVerification) {
        saleData.ageVerification = {
          method: ageVerification.method,
          birthDate: ageVerification.birthDate,
        };
      }

      const noteParts: string[] = [];
      if (notes.trim()) noteParts.push(notes.trim());
      if (payments.length > 1) {
        const splitInfo = payments.map(p => `${p.paymentMethod}: ${formatCurrency(p.amount)}`).join(', ');
        noteParts.push(`Payments: ${splitInfo}`);
      }
      if (noteParts.length > 0) saleData.notes = noteParts.join(' | ');

      if (paymentSession) {
        saleData.expectedShiftId = paymentSession.shiftId;
        if (paymentSession.submission) saleData = paymentSession.submission;
        else await savePaymentSession({ ...paymentSession, status: 'SUBMITTED', submission: saleData }, paymentSession.revision);
      }

      if (hasCardPayment) {
        // A new save must belong to the drawer that received this payment.
        if (!checkoutShiftId || !user?.id || !locationId) throw new Error('A current store and drawer are required to save this payment.');
        saleData.expectedShiftId = paymentSession?.shiftId || checkoutShiftId;
        savedTerminalAttempt = {
          key: attempt.key, userId: user.id, locationId, createdAt: attempt.createdAt,
          payload: saleData, cartSnapshot: JSON.stringify(items), total: confirmedTotal ?? amountDue,
          references: payments.filter(p => p.paymentMethod === 'CARD').map(p => p.reference || ''),
          paymentSessionId: paymentSession?.id,
        };
        // Persist before sending: a dropped response or reload must retain the
        // same submission, including split tenders and terminal references.
        setTerminalAttempts([savedTerminalAttempt]);
        setTerminalDurable(false);
        await db.terminalCheckouts.put(savedTerminalAttempt);
        setTerminalDurable(true);
      }
      const response = await saleService.create(saleData);
      await db.transaction('rw', db.paymentSessions, db.terminalCheckouts, async () => {
        if (paymentSession) await finishPaymentSession(paymentSession.id, 'sale:' + response.data.data.id);
        if (savedTerminalAttempt) await db.terminalCheckouts.update(savedTerminalAttempt.key,{reconciliation:{receiptId:'sale:'+response.data.data.id,status:'FINAL',disposition:'MATCH_RECORDED',recordedAt:Date.now()}});
      });
      if (useAuthStore.getState().user?.id !== user?.id || useAuthStore.getState().user?.locationId !== locationId) return;
      if (savedTerminalAttempt) {
        if (useAuthStore.getState().user?.id !== savedTerminalAttempt.userId) return;
        setTerminalAttempts([]); setTerminalNeedsReview(false);
      }
      const createdSale = response.data.data;
      setLastSaleId(createdSale?.id || null);

      const chargedTotal = createdSale.total;
      const receipt = receiptFromSale(createdSale);

      setLastReceipt(receipt);

      // Open the drawer if ANY payment was cash (split sales may have cash as the smaller part)
      if (!paymentSession && hardware.drawer.shouldOpen(hasCashPayment ? 'CASH' : primaryPayment.paymentMethod)) {
        hardware.drawer.open();
      }

      const change = Math.max(0, totalPaid - chargedTotal);
      const message = linkedCustomer
        ? `Sale completed for ${linkedCustomer.firstName} ${linkedCustomer.lastName}!${change > 0 ? `\nChange: ${formatCurrency(change)}` : ''}`
        : `Sale completed!${change > 0 ? ` Change: ${formatCurrency(change)}` : ''}`;

      // Thank-you splash on the customer display
      publishDisplayState({
        storeName: '',
        lines: [],
        subtotal: 0,
        promoSavings: 0,
        tax: 0,
        total: 0,
        completed: { total: chargedTotal, change: Math.max(0, Math.round((totalPaid - chargedTotal) * 100) / 100) },
      });

      toast.success(message);
      localStorage.removeItem('pos-checkout-attempt');
      clearCart();
      setLinkedCustomer(null);
      setAgeVerification(null);
      setShowPaymentModal(false);
      setShowReceiptPreview(true);

    } catch (error: any) {
      // If network error, queue offline
      if (hasCardPayment) {
        setShowPaymentModal(false);
        setTerminalNeedsReview(true);
        if (!savedTerminalAttempt) {
          // Preserve the current form/cart when a failure happens before the
          // durable record can be built. No second sale is submitted.
          setShowPaymentModal(true);
        }
        toast.error('Card payment requires reconciliation. Do not charge again. ' + (error.response?.data?.error || error.message || 'Retry saving the original sale.'));
        return;
      }
      if (error.code === 'ERR_CANCELED') return;
      // A first, definitive rejection rolled back the sale. Keep received cash,
      // but let the cashier replace a declined account allocation. An uncertain
      // prior submission always keeps its frozen payload for reconciliation.
      if (paymentSession?.status === 'OPEN' && cashOperationRejected(error)) {
        const current = await currentPaymentSession(paymentSession.userId, paymentSession.locationId);
        if (current?.id === paymentSession.id && current.status === 'SUBMITTED') {
          const reviewed = await savePaymentSession({ ...current, status: 'OPEN', submission: undefined,
            events: [...current.events, { at: Date.now(), action: 'REJECTED', reference: error.response?.data?.error || 'Sale rejected' }] }, current.revision);
          toast.error(error.response?.data?.error || 'Sale rejected. Review the recorded payments.');
          return reviewed;
        }
      }
      const isNetworkError = !error.response && (error.code === 'ERR_NETWORK' || !navigator.onLine);
      if (isNetworkError && payments.every(p => p.paymentMethod === 'CASH') && !pointsRedeemed && checkoutShiftId && user?.locationId) {
        try {
          const cart = useCartStore.getState(), breakdown = cart.getLineBreakdown();
          const originalLines = items.map(item => {
            const discount = breakdown[item.product.id]?.totalDiscount || 0;
            const net = roundMoney(lineMoney(item.product.price, item.quantity) - discount);
            const tax = item.product.isTaxable ? taxMoney(net, cart.taxRate) : 0;
            return { productId: item.product.id, productName: item.product.name, sku: item.product.sku, quantity: item.quantity, price: item.product.price, discount, tax, total: roundMoney(net + tax), pointsEarned: 0 };
          });
          await syncService.queueCheckout({ payload: saleData, userId: user.id, locationId: user.locationId, shiftId: checkoutShiftId, createdAt: attempt!.createdAt || createdAt,
            originalReceipt: { items: originalLines, ageVerified: !!ageVerification },
            snapshot: { subtotal: roundMoney(originalLines.reduce((sum, item) => sum + lineMoney(item.price, item.quantity), 0)), tax: getTax(), discount: roundMoney(originalLines.reduce((sum, item) => sum + item.discount, 0)) }, expectedTotal: amountDue });
          if (paymentSession) await finishPaymentSession(paymentSession.id, 'offline:' + attempt!.key);
          localStorage.removeItem('pos-checkout-attempt');
          const change = totalPaid - total;
          toast.success(`Sale saved offline! Will sync when connection restores.${change > 0 ? ` Change: ${formatCurrency(change)}` : ''}`);

          if (!paymentSession && hardware.drawer.shouldOpen('CASH')) {
            hardware.drawer.open();
          }

          clearCart();
          setLinkedCustomer(null);
          setShowPaymentModal(false);
        } catch {
          toast.error('Failed to save sale offline');
        }
      } else {
        toast.error(error.response?.data?.error || (isNetworkError ? 'Offline sales require cash only, no loyalty redemption, and a previously loaded shift. Keep this cart and retry when connected.' : 'Failed to complete sale'));
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // Build category list with favorites pseudo-tab
  const allCategories = [
    ...(favoriteIds.length > 0 ? [{ id: 'FAVORITES', name: 'Favorites', color: '#eab308' }] : []),
    ...categories,
  ];

  return (
    <div className="pos-workspace">
      {/* Status bar: navigation, store, shift, connectivity, clock, cashier, theme */}
      <POSTopBar />
      {isReadOnly && <AdminViewBanner storeName={storeName || 'Selected store'} />}
      {terminalStorageError && <p role="alert" className="p-3 text-destructive">{terminalStorageError}</p>}
      {paymentReadError && <p role="alert" className="p-3 text-destructive">{paymentReadError}</p>}
      {pendingPayment && !showPaymentModal && !terminalAttempts.length && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border-b border-warning/40 bg-warning/10 p-3">
        <p>{pendingPayment.status === 'SUBMITTED' ? 'Sale confirmation pending. Do not take payment again.' : 'Payment incomplete. ' + formatCurrency(paymentTotal(pendingPayment.payments)) + ' recorded; ' + formatCurrency(Math.max(0, pendingPayment.total - paymentTotal(pendingPayment.payments))) + ' remaining.'}</p>
        <Button onClick={resumePayment}>Continue payment</Button>
      </div>}
      {!isReadOnly && terminalNeedsReview && terminalAttempts[0] && <TerminalRecovery
        key={terminalAttempts[0].key}
        attempt={terminalAttempts[0]}
        persisted={terminalDurable}
        onRecovered={(sale, recovered) => {
          setTerminalAttempts(previous => previous.filter(record => record.key !== recovered.key));
          if (JSON.stringify(useCartStore.getState().items) === recovered.cartSnapshot) {
            clearCart(); setLinkedCustomer(null); setAgeVerification(null);
          }
          localStorage.removeItem('pos-checkout-attempt');
          setLastSaleId(sale.id); setLastReceipt(receiptFromSale(sale));
          setShowReceiptPreview(true);
          toast.success('Sale confirmed. No additional terminal payment was taken.');
        }}
      />}

      {/* Quantity Numpad overlay */}
      {numpadProduct && (
        <QuantityNumpad
          initialQty={getCartQty(numpadProduct.id) || 1}
          productName={numpadProduct.name}
          onConfirm={(qty) => { handleSetQuantity(numpadProduct, qty); setNumpadProduct(null); }}
          onCancel={() => setNumpadProduct(null)}
        />
      )}

      {/* Main content: products left, cart right */}
      <fieldset disabled={!!pendingPayment || !paymentReady || !!paymentReadError} className="pos-workspace-body">
        {/* Left side - Products */}
        <ProductGrid
          products={products}
          categories={allCategories}
          selectedCategoryId={selectedCategoryId}
          onSelectCategory={setSelectedCategoryId}
          search={search}
          onSearchChange={setSearch}
          isLoading={isLoading}
          error={productsError}
          onRetry={() => setProductsRetry(value => value + 1)}
          onProductClick={isReadOnly ? () => {} : handleProductClick}
          getCartQty={getCartQty}
          isFavorite={isFavorite}
          toggleFavorite={toggleFavorite}
          searchInputRef={searchInputRef}
        />

        {/* Right side - Cart (desktop) */}
        <div className="pos-desktop-cart">
          {isReadOnly ? <RecentTransactions onViewReceipt={handleViewRecentReceipt} /> : <CartPanel
            onEditQuantity={setNumpadProduct}
            lastReceipt={lastReceipt}
            onPrintReceipt={handlePrintReceipt}
            onShowHeldSales={() => setShowHeldSalesModal(true)}
            onShowRefund={() => setShowRefundModal(true)}
            onCheckout={() => startCheckout(undefined)}
            onHoldSale={handleHoldSale}
          />}
        </div>
      </fieldset>

      {/* Mobile cart overlay */}
      {mobileCartOpen && !isReadOnly && !pendingPayment && (
        <ModalOverlay isOpen isDismissable onOpenChange={open => { if (!open) setMobileCartOpen(false); }} className="pos-cart-overlay" style={{ zIndex: 50 }}>
          <AriaModal className="pos-cart-sheet">
            <OverlayLevel.Provider value={50}>
            <Dialog aria-label="Current Sale" className="pos-cart-sheet-dialog" data-assistant-priority data-auto-refresh-pause="true">
              <CartPanel
                onClose={() => setMobileCartOpen(false)}
                onEditQuantity={setNumpadProduct}
                lastReceipt={lastReceipt}
                onPrintReceipt={handlePrintReceipt}
                onShowHeldSales={() => setShowHeldSalesModal(true)}
                onShowRefund={() => setShowRefundModal(true)}
                onCheckout={() => { setMobileCartOpen(false); startCheckout(undefined); }}
                onHoldSale={() => { handleHoldSale(); setMobileCartOpen(false); }}
              />
            </Dialog>
            </OverlayLevel.Provider>
          </AriaModal>
        </ModalOverlay>
      )}

      {/* Mobile floating cart button — shows the running total when the cart has items */}
      {!isReadOnly && !pendingPayment && (
        <button
          hidden={mobileCartOpen}
          aria-label="Open sale cart"
          data-assistant-avoid
          onClick={() => setMobileCartOpen(true)}
          className="pos-mobile-cart-button fixed z-40 flex items-center gap-2 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <ShoppingCart className="h-5 w-5" />
          {items.length > 0 && (
            <span className="font-bold tabular-nums">{formatCurrency(getTotal())}</span>
          )}
          {items.length > 0 && (
            <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-xs rounded-full w-6 h-6 flex items-center justify-center font-bold">
              {items.reduce((c, i) => c + i.quantity, 0)}
            </span>
          )}
        </button>
      )}

      {/* Modals */}
      <AgeVerificationModal
        isOpen={showAgeModal}
        requiredAge={getRequiredAge()}
        itemNames={items
          .filter((i) => (i.product.minimumAge || 0) > 0)
          .map((i) => i.product.name)}
        onConfirm={(result) => {
          setAgeVerification(result);
          setShowAgeModal(false);
          setInitialPaymentMethod(pendingPaymentMethod);
          setShowPaymentModal(true);
        }}
        onClose={() => setShowAgeModal(false)}
      />

      <EnhancedPaymentModal
        session={pendingPayment}
        onSavePayments={savePayments}
        items={items.map(item => ({ productId: item.product.id, quantity: item.quantity, price: item.product.price, discount: item.discount, priceOverride: item.priceOverride, name: item.product.name }))}
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        total={getTotal()}
        onComplete={handlePaymentComplete}
        isProcessing={isProcessing}
        initialPaymentMethod={initialPaymentMethod}
        linkedCustomer={linkedCustomer}
        onCustomerChange={setLinkedCustomer}
        ebtEligibleTotal={getEbtEligibleTotal()}
        cardSurchargePercent={cardSurchargePercent}
      />

      <HeldSalesModal
        isOpen={showHeldSalesModal}
        onClose={() => setShowHeldSalesModal(false)}
        heldSales={heldSales}
        onRestore={handleRestoreHeld}
        onDiscard={discardHeldSale}
      />

      <QuickRefundModal
        isOpen={showRefundModal}
        initialSaleId={refundSaleId}
        onClose={() => { setShowRefundModal(false); setRefundSaleId(undefined); }}
        onRefundComplete={() => {}}
      />

      {lastReceipt && (
        <ReceiptPreviewModal
          isOpen={showReceiptPreview}
          onClose={() => setShowReceiptPreview(false)}
          receipt={lastReceipt}
          saleId={lastSaleId || undefined}
          onEmailReceipt={async (saleId: string, email: string) => {
            await saleService.emailReceipt(saleId, email);
          }}
        />
      )}

      {/* Misc Item Modal (F7) */}
      <Modal isOpen={showMiscModal} onClose={() => setShowMiscModal(false)} title="Add Misc Item" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Add an item not in the system. Enter a price and optional name.
          </p>
          <Input
            type="number"
            label="Price"
            placeholder="0.00"
            value={miscPrice}
            onChange={(e) => setMiscPrice(e.target.value)}
            step="0.01"
            min="0"
            autoFocus
          />
          <Input
            type="text"
            label="Name (optional)"
            placeholder="Misc Item"
            value={miscName}
            onChange={(e) => setMiscName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddMisc(); }}
          />
          <div className="flex gap-3 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => setShowMiscModal(false)}>
              Cancel
            </Button>
            <Button variant="primary" className="flex-1" onClick={handleAddMisc} disabled={!miscPrice || parseFloat(miscPrice) <= 0}>
              <DollarSign className="h-4 w-4 mr-1" />
              Add to Cart
            </Button>
          </div>
        </div>
      </Modal>

      {/* Keyboard shortcuts help overlay */}
      {showShortcutsHelp && (
        <div data-assistant-priority className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowShortcutsHelp(false)}>
          <div className="bg-card border rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold flex items-center gap-2"><Keyboard className="h-5 w-5" /> Keyboard Shortcuts</h3>
              <button aria-label="Close keyboard shortcuts" onClick={() => setShowShortcutsHelp(false)} className="p-1 rounded hover:bg-accent"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-2 text-sm">
              {[
                ['F1', 'Pay with Cash'],
                ['F2', 'Pay with Card'],
                ['F3 / /', 'Search products'],
                ['F4', 'Checkout'],
                ['F5', 'Hold sale'],
                ['F6', 'Recall held sale'],
                ['F7', 'Add misc item'],
                ['F8', 'Refund'],
                ['Esc', 'Close / Back'],
                ['?', 'Toggle this help'],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-muted-foreground">{desc}</span>
                  <kbd className="px-2 py-0.5 bg-muted rounded text-xs font-mono font-bold">{key}</kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bottom shortcut hints bar (desktop only) */}
      <div className="hidden md:flex fixed bottom-0 left-0 right-0 bg-card/95 backdrop-blur border-t px-4 py-1.5 justify-center gap-4 text-xs text-muted-foreground z-30">
        <span><kbd className="px-1 bg-muted rounded font-mono text-xs">F1</kbd> Cash</span>
        <span><kbd className="px-1 bg-muted rounded font-mono text-xs">F2</kbd> Card</span>
        <span><kbd className="px-1 bg-muted rounded font-mono text-xs">F4</kbd> Pay</span>
        <span><kbd className="px-1 bg-muted rounded font-mono text-xs">F5</kbd> Hold</span>
        <span><kbd className="px-1 bg-muted rounded font-mono text-xs">F6</kbd> Recall</span>
        <span><kbd className="px-1 bg-muted rounded font-mono text-xs">F7</kbd> Misc</span>
        <span><kbd className="px-1 bg-muted rounded font-mono text-xs">F8</kbd> Refund</span>
        <span><kbd className="px-1 bg-muted rounded font-mono text-xs">Esc</kbd> Back</span>
        <span><kbd className="px-1 bg-muted rounded font-mono text-xs">?</kbd> Help</span>
      </div>
    </div>
  );
};
