import { receiptFromSale } from '@/services/receiptFromSale';
import { isSaleReference, normalizeSaleReference } from '@/lib/receiptReference';
import { lineMoney, roundMoney, taxMoney } from '@/lib/money';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ModalOverlay, Modal as AriaModal, Dialog } from 'react-aria-components';
import { OverlayLevel } from '@/components/ui/Overlay';
import '@/styles/checkout.css';
import { ShoppingCart, X, DollarSign, Keyboard } from 'lucide-react';
import { productService, saleService, locationService, categoryService, promotionService, shiftService } from '@/services/api';
import { syncService } from '@/services/syncService';
import { checkoutIdentity } from '@/lib/checkoutIdentity';
import { db, TerminalCheckout } from '@/services/offlineDb';
import { cachedProducts, lookupPriceEmbedded, lookupScan, rememberProducts, warmRegisterCatalog } from '@/services/registerCatalog';
import { connectionSettled, isOffline } from '@/services/connection';
import { recallOpenShift } from '@/services/openShift';
import { useOffline } from '@/hooks/useOffline';
import { TerminalRecovery } from '@/components/pos/TerminalRecovery';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useCartStore } from '@/store/cartStore';
import { useAuthStore } from '@/store/authStore';
import { useApprovalStore, requestManagerApproval } from '@/store/approvalStore';
import { approvalCovers, approvalKey, DISCOUNT_APPROVAL_PATH, type CheckoutLine, type DiscountApproval } from '@/services/discountApproval';
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
import { ProductGrid, type ScanStatus } from '@/components/pos/ProductGrid';
import { SaleComplete, paymentLabel, type CompletedSale } from '@/components/pos/SaleComplete';
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
  // Products shown per page of the grid; "Show more" adds the next set.
  const PRODUCT_PAGE = 50;
  const [productLimit, setProductLimit] = useState(PRODUCT_PAGE);
  const [hasMoreProducts, setHasMoreProducts] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [initialPaymentMethod, setInitialPaymentMethod] = useState<'CASH' | 'CARD' | undefined>(undefined);
  const [isProcessing, setIsProcessing] = useState(false);
  const [linkedCustomer, setLinkedCustomer] = useState<LinkedCustomer | null>(null);
  const [showHeldSalesModal, setShowHeldSalesModal] = useState(false);
  const [numpadProduct, setNumpadProduct] = useState<Product | null>(null);
  const [lastReceipt, setLastReceipt] = useState<Receipt | null>(null);
  const [lastSaleId, setLastSaleId] = useState<string | null>(null);
  const [showReceiptPreview, setShowReceiptPreview] = useState(false);
  const receiptPreviewOpen = useRef(false);
  useEffect(() => { receiptPreviewOpen.current = showReceiptPreview; }, [showReceiptPreview]);
  // The sale that just finished stays in the cart (change due, receipt options)
  // until the next item is added. Nothing pops up, so the next scan always counts.
  const [completedSale, setCompletedSale] = useState<CompletedSale | null>(null);
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const navigate = useNavigate();
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
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

  const { user } = useAuthStore();
  const [checkoutShiftId, setCheckoutShiftId] = useState<string | null>(null);
  const { locationId, isReadOnly, storeName } = useEffectiveLocation();
  // True while the POS server cannot be reached (browser offline, or no answer from the server).
  const offline = useOffline();
  useEffect(() => {
    let active = true;
    shiftService.getCurrent().then(res => { if (active) setCheckoutShiftId(res.data.data?.id || null); }).catch(async () => {
      // No answer from the server: use the drawer this register last saw open for this cashier.
      await connectionSettled();
      if (!isOffline() || !user?.id || !locationId) return;
      const remembered = await recallOpenShift({ userId: user.id, locationId });
      if (active && remembered) setCheckoutShiftId(remembered);
    });
    return () => { active = false; };
  }, [user?.id, locationId, offline]);
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
    heldSales, holdSale, restoreHeldSale, discardHeldSale, adoptHeldSalesFor,
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
    if (event.action === 'ADDED' && !isOffline()) {
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

  // The first item of the next sale replaces the finished sale's summary
  useEffect(() => {
    if (items.length > 0) setCompletedSale(null);
  }, [items.length]);

  /** All checkout entry points funnel through here so the age gate always runs */
  const quoteInFlight = React.useRef(false);
  // A manager's approval of this sale's discounts, taken before payment (see services/discountApproval).
  const discountApproval = React.useRef<DiscountApproval | null>(null);
  const checkoutLines = (): CheckoutLine[] => useCartStore.getState().items.map(item => ({ productId: item.product.id, quantity: item.quantity,
    price: item.product.price, discount: item.discount, ...(item.priceOverride ? { priceOverride: true } : {}), name: item.product.name }));
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
    if (!isOffline()) {
      quoteInFlight.current = true;
      try {
        // One request: server prices, the open drawer and current store settings, read together.
        const { data } = await saleService.quote(items.map(item => ({ productId: item.product.id, quantity: item.quantity, price: item.product.price, discount: item.discount, priceOverride: item.priceOverride, name: item.product.name })));
        const quote = data.data;
        let shiftId: string | null;
        if (quote.store !== undefined && quote.shiftId !== undefined) {
          if (!locationId || !useStoreSettingsStore.getState().applyServerSettings(quote.store, locationId)) {
            toast.error('Load current store settings before checkout.');
            return;
          }
          shiftId = quote.shiftId;
        } else {
          // A server from before this change (mid-deploy): ask for the two separately, as before.
          await useStoreSettingsStore.getState().fetchSettings(locationId || undefined);
          const configuration = useStoreSettingsStore.getState();
          if (!configuration.isLoaded || configuration.error) {
            toast.error(configuration.error || 'Load current store settings before checkout.');
            return;
          }
          shiftId = (await shiftService.getCurrent()).data.data?.id || null;
        }
        if (!shiftId) { toast.error('Clock in before taking payment.'); return; }
        setCheckoutShiftId(shiftId);
        useCartStore.getState().applyQuote(quote);
      } catch (error: any) {
        // No answer from the server at all (it went away between scans): carry on as an
        // offline cash sale below. Any answer that refuses the sale still stops here.
        await connectionSettled();
        if (!isOffline()) {
          toast.error(error.response?.data?.error || 'Could not verify the checkout total. Try again before taking payment.');
          return;
        }
      } finally { quoteInFlight.current = false; }
    }
    quoteInFlight.current = false;
    if (isOffline() && !checkoutShiftId) {
      toast.error('This register has not seen your open drawer yet. Reconnect once (or clock in) before selling offline.');
      return;
    }
    // A cashier's discount or price change is approved now, before any money is taken.
    if (user?.role === 'CASHIER' && !isOffline()) {
      const lines = checkoutLines();
      // The same rule as the server: a discount, or a hand-changed price (not a barcode-embedded one).
      const needsApproval = useCartStore.getState().items.some(item => item.discount > 0 || (item.priceOverride && !item.product.priceEmbedded && !item.product.id.startsWith('misc-')));
      if (needsApproval && !approvalCovers(discountApproval.current, lines)) {
        try {
          const token = await requestManagerApproval({ method: 'POST', path: DISCOUNT_APPROVAL_PATH, body: { items: lines } });
          discountApproval.current = { key: approvalKey(lines), token, expiresAt: Date.now() + 15 * 60_000 };
        } catch {
          toast.error('A manager needs to approve the discount before payment. Remove the discount to continue without one.');
          return;
        }
      }
    }
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

  const activePromotions = useCartStore(state => state.promotions);
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
  // Promotions change line prices, so a new promotion list republishes too.
  }, [items, taxRate, isReadOnly, activePromotions]);

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
  const favoritesKey = selectedCategoryId === 'FAVORITES' ? favoriteIds.join(',') : '';
  useEffect(() => { setProductLimit(PRODUCT_PAGE); }, [search, selectedCategoryId, locationId]);
  // What the grid currently shows. A scan typed into the search box clears it
  // again before any search starts; the grid still shows those results, so
  // nothing reloads. Once a load starts, the grid is no longer known to match
  // until that load finishes, so an aborted or failed load always reloads.
  const shownProducts = useRef('');
  useEffect(() => {
    const key = JSON.stringify([search, selectedCategoryId, locationId, productsRetry, productLimit, favoritesKey]);
    if (key === shownProducts.current) { setIsLoading(false); return; }
    const controller = new AbortController();
    if (productLimit === PRODUCT_PAGE) setIsLoading(true);
    setProductsError('');
    const timer = setTimeout(() => {
      shownProducts.current = '';
      void loadProducts(controller.signal).then(loaded => { if (loaded) shownProducts.current = key; });
    }, search ? 300 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search, selectedCategoryId, locationId, productsRetry, productLimit, favoritesKey]);

  // Barcode scanner
  useEffect(() => {
    const handleBarcodeScan = async (barcode: string) => {
      if (isReadOnly || pendingPayment || !paymentReady || paymentReadError) return;
      // The age-verification modal handles its own license scans — don't let
      // AAMVA payload fragments trigger product searches underneath it
      if (showAgeModalRef.current) return;
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs.length) {
        // Only the receipt viewer is open: the next customer's scan closes it and counts.
        if (dialogs.length === 1 && receiptPreviewOpen.current) setShowReceiptPreview(false);
        else return;
      }
      const added = (product: Product, price: number) => {
        hardware.sound.play('ok');
        setScanStatus({ kind: 'added', message: `Added ${product.name} · ${formatCurrency(price)}` });
      };
      const problem = (message: string, withNextSteps = false) => {
        hardware.sound.play('error');
        const role = useAuthStore.getState().user?.role;
        const actions = withNextSteps ? [
          { label: 'Sell as misc item', onClick: () => { setScanStatus(null); setMiscPrice(''); setMiscName(''); setShowMiscModal(true); } },
          ...(role === 'ADMIN' || role === 'MANAGER' ? [{ label: 'Add product', onClick: () => navigate('/inventory?newBarcode=' + encodeURIComponent(barcode)) }] : []),
        ] : undefined;
        setScanStatus({ kind: 'error', message, actions });
      };

      const currentUser = useAuthStore.getState().user;
      const scope = currentUser?.id && locationId ? { userId: currentUser.id, locationId } : null;
      const offline = isOffline();

      // Price-embedded barcodes (2-prefix scale/deli labels): the barcode itself
      // carries the price; the item code identifies the product
      const embedded = parsePriceEmbeddedBarcode(barcode);
      if (embedded) {
        const local = scope ? await lookupPriceEmbedded(embedded.itemCode, barcode, scope) : null;
        const cached = local?.kind === 'one' ? local.product : local?.kind === 'many' ? local.products[0] : null;
        if (!cached && offline) {
          problem(local?.kind === 'none' ? `No product is set up for price label ${embedded.itemCode}.` : 'Price labels cannot be read offline until the product list is saved on this register.', true);
          return;
        }
        if (!cached) setScanStatus({ kind: 'busy', message: 'Reading price label…' });
        try {
          const found = cached || ((await productService.getAll({ search: embedded.itemCode, isActive: true, limit: 10 })).data.data || []).find(
            (p: Product) =>
              p.priceEmbedded &&
              (p.barcode === embedded.itemCode || p.sku === embedded.itemCode || p.barcode === barcode)
          );
          if (found) {
            if (!addItem(found, 1)) { problem(saleHoldMessage(found)); return; }
            // The label price wins — flags the line as an override so the server
            // (which allows it for priceEmbedded products) charges the same amount
            updatePrice(found.id, embedded.price);
            added(found, embedded.price);
          } else {
            problem(`No product is set up for price label ${embedded.itemCode}. In Products, turn on "Price-embedded barcode" for it.`, true);
          }
        } catch {
          problem('Could not read the price label. Check the connection and scan again.');
        }
        return;
      }

      // Receipt QR codes encode the sale number — scanning one pulls up the
      // receipt for returns/lookups instead of searching products
      if (isSaleReference(barcode)) {
        setScanStatus({ kind: 'busy', message: 'Looking up receipt…' });
        try {
          const saleRes = await saleService.getAll({ saleNumber: normalizeSaleReference(barcode), limit: 1 });
          const found = saleRes.data.data?.[0];
          if (found) {
            hardware.sound.play('ok');
            setScanStatus(null);
            setRefundSaleId(found.id); setShowRefundModal(true);
          } else {
            problem(`No sale found for receipt ${barcode}.`);
          }
        } catch {
          problem('Could not look up that receipt. Check the connection and scan again.');
        }
        return;
      }

      const sell = (product: Product) => {
        if (!addItem(product)) { problem(saleHoldMessage(product)); return; }
        added(product, product.price);
      };
      const choose = (count: number) => {
        setSearch(barcode);
        setScanStatus({ kind: 'info', message: `${count} products match ${barcode}. Tap the one you are selling.` });
      };

      // This register's own copy of the catalog answers first: no network
      // request, and it keeps working offline. Checkout re-prices on the server.
      const local = scope ? await lookupScan(barcode, scope) : null;
      if (local?.kind === 'one') { sell(local.product); return; }
      if (local?.kind === 'many') { choose(local.products.length); return; }
      if (offline) {
        problem(local?.kind === 'none' ? `No product has barcode ${barcode}.`
          : `Could not look up ${barcode} offline. The product list is not saved on this register yet; reconnect once to save it.`, true);
        return;
      }

      setScanStatus({ kind: 'busy', message: `Looking up ${barcode}…` });
      try {
        // Not in this register's copy yet (added moments ago): an exact barcode lookup.
        const resolved = (await productService.resolveBarcode(barcode)).data.data.matches
          .filter(match => match.kind !== 'SUPPLIER_CASE').map(match => match.product);
        if (resolved.length && scope) void rememberProducts(resolved, scope, () => useAuthStore.getState().user?.id === scope.userId);
        if (resolved.length === 1) { sell(resolved[0]); return; }
        if (resolved.length > 1) { choose(resolved.length); return; }

        // Still nothing: a typed SKU or name fragment, as before.
        const response = await productService.getAll({ search: barcode, isActive: true, limit: 10, includeSellingUnits: true });
        const found: Product[] = response.data.data;
        // A single can and its 12-pack share stock but have their own barcodes:
        // an exact barcode match decides which one was scanned.
        const exact = found.filter(p => p.barcode === barcode);
        const scanned = exact.length === 1 ? exact[0] : found.length === 1 ? found[0] : null;
        if (scanned) sell(scanned);
        else if (found.length > 1) choose(found.length);
        else problem(`No product has barcode ${barcode}.`, true);
      } catch {
        problem(`Could not look up ${barcode}. Check the connection and scan again.`);
      }
    };
    hardware.scanner.onScan(handleBarcodeScan);
    return () => { hardware.scanner.offScan(handleBarcodeScan); };
  }, [addItem, isReadOnly, pendingPayment, paymentReady, paymentReadError, navigate, locationId]);

  // Have the on-device barcode index ready before the first scan, and rebuilt after each catalog sync.
  useEffect(() => {
    if (!user?.id || !locationId || isReadOnly) return;
    const scope = { userId: user.id, locationId };
    return syncService.subscribe(state => { if (state.status !== 'syncing') warmRegisterCatalog(scope); });
  }, [user?.id, locationId, isReadOnly]);

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
      // Close the top-most open thing first
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
      // An idle register stays put (leaving mid-shift by accident cost a sale); Esc just clears the search.
      if (search) setSearch('');
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
  }, [items, search, showPaymentModal, showHeldSalesModal, showRefundModal, showMiscModal, showReceiptPreview, showShortcutsHelp, numpadProduct, showAgeModal, ageVerification, isReadOnly, isProcessing, pendingPayment, paymentReady, paymentReadError, mobileCartOpen]);

  // A scanner aimed while the search box has focus types the code there. Treat it
  // as a scan: digits-only codes, receipt numbers, or anything typed at scanner speed.
  const handleSearchEnter = useCallback((value: string, typedFast: boolean) => {
    const code = value.trim();
    if (!code || /\s/.test(code)) return false;
    if (!(/^\d{6,}$/.test(code) || isSaleReference(code) || (typedFast && code.length >= 4))) return false;
    hardware.scanner.scanFromField(code);
    setSearch('');
    return true;
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyboardShortcuts);
    return () => window.removeEventListener('keydown', handleKeyboardShortcuts);
  }, [handleKeyboardShortcuts]);

  // --- Handlers ---

  const loadProducts = async (signal: AbortSignal) => {
    try {
      const isFavoritesTab = selectedCategoryId === 'FAVORITES';
      // Favorites load by id, so a starred item is found however large the catalog is.
      if (isFavoritesTab && !favoriteIds.length) { setProducts([]); setHasMoreProducts(false); return true; }
      const response = await productService.getAll({
        locationId: locationId || undefined,
        search,
        categoryId: isFavoritesTab ? undefined : (selectedCategoryId || undefined),
        ids: isFavoritesTab ? favoriteIds.join(',') : undefined,
        isActive: true,
        limit: isFavoritesTab ? Math.max(favoriteIds.length, 1) : productLimit,
        includeSellingUnits: true,
      }, signal);
      if (signal.aborted) return false;
      let result = response.data.data;
      // Hide MISC product from grid — it's only used internally for ad-hoc charges
      result = result.filter((p: Product) => p.sku !== 'MISC-001');
      if (isFavoritesTab) {
        result = result.filter((p: Product) => favoriteIds.includes(p.id));
      }
      setProducts(result);
      const total = response.data.pagination?.total;
      setHasMoreProducts(!isFavoritesTab && typeof total === 'number' && total > response.data.data.length);
      // The sync service caches the complete catalog; filtered pages must not replace it.
      return true;
    } catch (error: any) {
      if (signal.aborted || error.code === 'ERR_CANCELED') return false;
      // Fallback to cached products when the server cannot be reached
      await connectionSettled();
      if (isOffline()) {
        try {
          const cached = user?.id && locationId ? await cachedProducts({ userId: user.id, locationId }) : [];
          if (signal.aborted) return false;
          if (!cached.length) throw new Error('No product cache available for this store');
          let result = cached;
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
    // Offline results are not remembered: the grid reloads from the server once back online.
    return false;
  };

  const getCartQty = (productId: string): number => {
    return items.find((i) => i.product.id === productId)?.quantity ?? 0;
  };

  // Recorded stock never blocks a sale (the customer is holding the item).
  const handleProductClick = (product: Product) => {
    if (isReadOnly) return;
    if (!addItem(product, 1)) toast.error(saleHoldMessage(product));
  };

  // Held sales belong to one store: a register signed in to another store starts empty.
  useEffect(() => { if (locationId && !isReadOnly) adoptHeldSalesFor(locationId); }, [locationId, isReadOnly, adoptHeldSalesFor]);

  const handleHoldSale = () => {
    if (items.length === 0) { toast.error('Cart is empty'); return; }
    if (heldSales.length >= 5) { toast.error('Maximum 5 sales on hold'); return; }
    holdSale();
    setLinkedCustomer(null);
    setAgeVerification(null);
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
    // An ID check belongs to the customer standing at the counter: a recalled sale is checked again.
    setAgeVerification(null);
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

  const handlePrintReceipt = async () => {
    if (!lastReceipt) return;
    // The browser's print window opens; only say so when it actually did.
    if (await hardware.printer.print(lastReceipt)) toast.success('Print window opened');
    else toast.error('Receipt printing is turned off on this register (Settings > Devices).');
  };
  const emailCompletedReceipt = completedSale?.saleId
    ? (email: string) => saleService.emailReceipt(completedSale.saleId!, email).then(() => undefined)
    : undefined;
  const completedSaleProps = {
    completedSale,
    onViewReceipt: () => setShowReceiptPreview(true),
    onEmailReceipt: emailCompletedReceipt,
    onDismissCompleted: () => { setCompletedSale(null); searchInputRef.current?.focus(); },
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
      // The register approval goes with the sale when it still covers these exact lines.
      const approval = discountApproval.current;
      const response = await saleService.create(saleData, approvalCovers(approval, saleData.items)
        ? { headers: { 'X-Manager-Approval': approval!.token } } : undefined);
      discountApproval.current = null;
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

      const change = Math.max(0, Math.round((totalPaid - chargedTotal) * 100) / 100);

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

      localStorage.removeItem('pos-checkout-attempt');
      setCompletedSale({
        receipt, saleId: createdSale?.id || null, total: chargedTotal, paid: totalPaid, change,
        paymentLabel: paymentLabel(payments.map(payment => payment.paymentMethod)),
        customerName: linkedCustomer ? `${linkedCustomer.firstName} ${linkedCustomer.lastName}` : undefined,
      });
      setScanStatus(null);
      clearCart();
      setLinkedCustomer(null);
      setAgeVerification(null);
      setShowPaymentModal(false);

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
      const isNetworkError = isOffline() || (!error.response && error.code === 'ERR_NETWORK');
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
          const change = Math.max(0, Math.round((totalPaid - total) * 100) / 100);
          setCompletedSale({ receipt: null, saleId: null, total, paid: totalPaid, change, paymentLabel: 'Cash', offline: true,
            customerName: linkedCustomer ? `${linkedCustomer.firstName} ${linkedCustomer.lastName}` : undefined });
          setScanStatus(null);

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
          const receipt = receiptFromSale(sale);
          setLastSaleId(sale.id); setLastReceipt(receipt);
          setCompletedSale({ receipt, saleId: sale.id, total: receipt.total, paid: receipt.amountPaid, change: receipt.change, paymentLabel: paymentLabel(sale.payments?.length ? sale.payments.map((payment: { paymentMethod: string }) => payment.paymentMethod) : [sale.paymentMethod]) });
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
          onSearchChange={value => { setSearch(value); setScanStatus(status => status?.kind === 'busy' ? status : null); }}
          isLoading={isLoading}
          error={productsError}
          onRetry={() => setProductsRetry(value => value + 1)}
          onProductClick={isReadOnly ? () => {} : handleProductClick}
          getCartQty={getCartQty}
          isFavorite={isFavorite}
          toggleFavorite={toggleFavorite}
          searchInputRef={searchInputRef}
          onSearchEnter={handleSearchEnter}
          scanStatus={scanStatus}
          onDismissScanStatus={() => setScanStatus(null)}
          hasMore={hasMoreProducts}
          onLoadMore={() => setProductLimit(limit => limit + PRODUCT_PAGE)}
          emptyHint={selectedCategoryId === 'FAVORITES' && !search && !favoriteIds.length ? 'Star a product to keep it here for quick taps.' : undefined}
          topSlot={!isReadOnly && completedSale && items.length === 0 ? (
            <SaleComplete compact sale={completedSale} onViewReceipt={completedSale.receipt ? () => setShowReceiptPreview(true) : undefined} onDismiss={completedSaleProps.onDismissCompleted} />
          ) : undefined}
        />

        {/* Right side - Cart (desktop) */}
        <div className="pos-desktop-cart">
          {isReadOnly ? <RecentTransactions onViewReceipt={handleViewRecentReceipt} /> : <CartPanel
            onShowShortcuts={() => setShowShortcutsHelp(true)}
            onEditQuantity={setNumpadProduct}
            lastReceipt={lastReceipt}
            onPrintReceipt={handlePrintReceipt}
            onShowHeldSales={() => setShowHeldSalesModal(true)}
            onShowRefund={() => setShowRefundModal(true)}
            onCheckout={() => startCheckout(undefined)}
            onHoldSale={handleHoldSale}
            {...completedSaleProps}
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
                {...completedSaleProps}
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
        approvalNeeded={user?.role === 'CASHIER' && items.some(item => item.discount > 0 || (item.priceOverride && !item.product.priceEmbedded && !item.product.id.startsWith('misc-')))
          && !approvalCovers(discountApproval.current, checkoutLines())}
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
                ['F4', 'Choose payment'],
                ['F5', 'Hold sale'],
                ['F6', 'Recall held sale'],
                ['F7', 'Add misc item'],
                ['F8', 'Refund'],
                ['Esc', 'Close a window, or clear the search'],
                ['?', 'Show or hide this list'],
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

    </div>
  );
};
