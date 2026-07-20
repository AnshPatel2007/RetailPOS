import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart, X, DollarSign, Keyboard } from 'lucide-react';
import { productService, saleService, locationService, categoryService, promotionService } from '@/services/api';
import { syncService } from '@/services/syncService';
import { offlineDb } from '@/services/offlineDb';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useCartStore } from '@/store/cartStore';
import { useAuthStore } from '@/store/authStore';
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

type PaymentMethod = 'CASH' | 'CARD' | 'GIFT_CARD' | 'STORE_CREDIT' | 'EBT' | 'HOUSE_ACCOUNT';

export const POS: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string; color?: string | null }[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [initialPaymentMethod, setInitialPaymentMethod] = useState<'CASH' | 'CARD' | undefined>(undefined);
  const [isProcessing, setIsProcessing] = useState(false);
  const [linkedCustomer, setLinkedCustomer] = useState<LinkedCustomer | null>(null);
  const [showHeldSalesModal, setShowHeldSalesModal] = useState(false);
  const [numpadProduct, setNumpadProduct] = useState<Product | null>(null);
  const [lastReceipt, setLastReceipt] = useState<Receipt | null>(null);
  const [lastSaleId, setLastSaleId] = useState<string | null>(null);
  const [salesRefreshTrigger, setSalesRefreshTrigger] = useState(0);
  const [showReceiptPreview, setShowReceiptPreview] = useState(false);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [showMiscModal, setShowMiscModal] = useState(false);
  const [miscPrice, setMiscPrice] = useState('');
  const [miscName, setMiscName] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

  const { user } = useAuthStore();
  const { locationId } = useEffectiveLocation();
  const { favoriteIds, toggleFavorite, isFavorite } = useFavoritesStore();
  const {
    items, addItem, updateQuantity, updatePrice, clearCart, notes,
    getSubtotal, getTax, getTotal, setTaxRate, setCustomer,
    getLineBreakdown, setPromotions, getEbtEligibleTotal, getRequiredAge,
    setCardSurchargePercent, cardSurchargePercent, taxRate,
    heldSales, holdSale, restoreHeldSale, discardHeldSale,
    cleanupExpiredHeldSales,
  } = useCartStore();

  // Age-restricted sales: verification survives until the sale completes or the
  // cart empties, so re-opening the payment modal doesn't re-prompt
  const [ageVerification, setAgeVerification] = useState<AgeVerificationResult | null>(null);
  const [showAgeModal, setShowAgeModal] = useState(false);
  const [pendingPaymentMethod, setPendingPaymentMethod] = useState<'CASH' | 'CARD' | undefined>(undefined);
  const showAgeModalRef = useRef(false);
  useEffect(() => { showAgeModalRef.current = showAgeModal; }, [showAgeModal]);

  // A fresh cart means a fresh customer — never carry a verification over
  useEffect(() => {
    if (items.length === 0 && ageVerification) setAgeVerification(null);
  }, [items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  /** All checkout entry points funnel through here so the age gate always runs */
  const startCheckout = (method?: 'CASH' | 'CARD') => {
    if (items.length === 0) return;
    const requiredAge = getRequiredAge();
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [items, taxRate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load active promotions so the cart preview prices lines like the server will.
  // Refreshed on focus; the engine re-checks day/time windows on every render.
  const loadPromotions = useCallback(() => {
    promotionService.getActive().then((res) => {
      setPromotions(res.data.data || []);
    }).catch(() => {});
  }, [setPromotions]);

  useEffect(() => {
    loadPromotions();
    const handleFocus = () => loadPromotions();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [loadPromotions]);

  // Load categories (and refresh on window focus)
  const loadCategories = useCallback(() => {
    categoryService.getAll().then((res) => {
      const all = res.data.data || [];
      // Only show categories that have at least one active product
      setCategories(all.filter((c: any) => c._count?.products > 0));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    loadCategories();
    const handleFocus = () => loadCategories();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [loadCategories]);

  // Load products when search/category changes (debounce search)
  useEffect(() => {
    if (search) {
      const timer = setTimeout(() => loadProducts(), 300);
      return () => clearTimeout(timer);
    }
    loadProducts();
  }, [search, selectedCategoryId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Barcode scanner
  useEffect(() => {
    const handleBarcodeScan = async (barcode: string) => {
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
            addItem(found, 1);
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
      if (/^SALE-\d{8}-\d{4}$/.test(barcode)) {
        toast.loading('Looking up receipt...', { id: 'barcode-search' });
        try {
          const saleRes = await saleService.getAll({ saleNumber: barcode, limit: 1 });
          const found = saleRes.data.data?.[0];
          if (found) {
            toast.success(`Receipt ${barcode}`, { id: 'barcode-search' });
            handleViewRecentReceipt(found.id);
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
        const response = await productService.getAll({ search: barcode, isActive: true, limit: 10 });
        const found = response.data.data;
        if (found.length === 1) {
          addItem(found[0]);
          toast.success(`Added: ${found[0].name}`, { id: 'barcode-search' });
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
  }, [addItem]);

  // Keyboard shortcuts
  const handleKeyboardShortcuts = useCallback((e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    const inInput = tag === 'INPUT' || tag === 'TEXTAREA';

    if (e.key === 'Escape') {
      e.preventDefault();
      // Close any open modal first, then navigate away
      if (showAgeModal) { setShowAgeModal(false); return; }
      if (showPaymentModal) { setShowPaymentModal(false); return; }
      if (showHeldSalesModal) { setShowHeldSalesModal(false); return; }
      if (showRefundModal) { setShowRefundModal(false); return; }
      if (showMiscModal) { setShowMiscModal(false); return; }
      if (showReceiptPreview) { setShowReceiptPreview(false); return; }
      if (showShortcutsHelp) { setShowShortcutsHelp(false); return; }
      if (numpadProduct) { setNumpadProduct(null); return; }
      if (inInput) { (e.target as HTMLElement).blur(); return; }
      navigate('/dashboard');
      return;
    }
    if (e.key === 'F1') { e.preventDefault(); startCheckout('CASH'); return; }
    if (e.key === 'F2') { e.preventDefault(); startCheckout('CARD'); return; }
    if (e.key === 'F4') { e.preventDefault(); startCheckout(undefined); return; }
    if (e.key === 'F5') { e.preventDefault(); handleHoldSale(); return; }
    if (e.key === 'F6') { e.preventDefault(); setShowHeldSalesModal(true); return; }
    if (e.key === 'F7') { e.preventDefault(); setMiscPrice(''); setMiscName(''); setShowMiscModal(true); return; }
    if (e.key === 'F8') { e.preventDefault(); if (user?.role !== 'CASHIER') setShowRefundModal(true); return; }
    if (e.key === '?' && !inInput) { e.preventDefault(); setShowShortcutsHelp(prev => !prev); return; }
    if ((e.key === '/' || e.key === 'F3') && !inInput) {
      e.preventDefault();
      searchInputRef.current?.focus();
    }
  }, [items, showPaymentModal, showHeldSalesModal, showRefundModal, showMiscModal, showReceiptPreview, showShortcutsHelp, numpadProduct, showAgeModal, ageVerification]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    window.addEventListener('keydown', handleKeyboardShortcuts);
    return () => window.removeEventListener('keydown', handleKeyboardShortcuts);
  }, [handleKeyboardShortcuts]);

  // --- Handlers ---

  const loadProducts = async () => {
    setIsLoading(true);
    try {
      const isFavoritesTab = selectedCategoryId === 'FAVORITES';
      const response = await productService.getAll({
        search,
        categoryId: isFavoritesTab ? undefined : (selectedCategoryId || undefined),
        isActive: true,
        limit: 50,
      });
      let result = response.data.data;
      // Hide MISC product from grid — it's only used internally for ad-hoc charges
      result = result.filter((p: Product) => p.sku !== 'MISC-001');
      if (isFavoritesTab) {
        result = result.filter((p: Product) => favoriteIds.includes(p.id));
      }
      setProducts(result);

      // Cache products for offline use (fire-and-forget)
      if (!search && !selectedCategoryId) {
        offlineDb.cacheProducts(result).catch(() => {});
      }
    } catch {
      // Fallback to cached products when offline
      if (!navigator.onLine) {
        try {
          const cached = await offlineDb.getAllProducts();
          let result = cached
            .filter(p => p.isActive && p.sku !== 'MISC-001')
            .map(p => ({ ...p, category: p.categoryName ? { id: p.categoryId || '', name: p.categoryName } : null }) as any);
          if (search) {
            const q = search.toLowerCase();
            result = result.filter((p: any) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.barcode && p.barcode.includes(search)));
          }
          setProducts(result);
        } catch {
          // no cached data available
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  const getCartQty = (productId: string): number => {
    return items.find((i) => i.product.id === productId)?.quantity ?? 0;
  };

  const isOutOfStock = (product: Product): boolean => {
    return product.trackInventory && product.stockQuantity <= 0;
  };

  const handleProductClick = (product: Product) => {
    if (isOutOfStock(product)) {
      toast.error(`${product.name} is out of stock`);
      return;
    }
    setNumpadProduct(product);
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
    if (product.trackInventory && qty > product.stockQuantity) {
      toast.error(`Only ${product.stockQuantity} in stock`);
      qty = product.stockQuantity;
    }
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
      const receipt: Receipt = {
        saleNumber: sale.saleNumber,
        date: new Date(sale.createdAt).toLocaleString(),
        items: (sale.items || []).map((item: any) => ({
          name: item.productName || item.product?.name || 'Item',
          quantity: item.quantity,
          price: item.price,
          total: item.total,
        })),
        subtotal: sale.subtotal,
        tax: sale.tax,
        discount: sale.discount,
        surcharge: sale.surcharge > 0 ? sale.surcharge : undefined,
        total: sale.total,
        // SaleItem.discount already includes the promotion portion
        savings: (sale.items || []).reduce((s: number, i: any) => s + (i.discount || 0), 0) || undefined,
        paymentMethod: sale.payments?.length > 1
          ? sale.payments.map((p: any) => `${p.paymentMethod}: ${formatCurrency(p.amount)}`).join(' / ')
          : sale.paymentMethod,
        amountPaid: sale.amountPaid,
        change: Math.max(0, sale.changeDue ?? 0),
        employeeName: sale.user ? `${sale.user.firstName} ${sale.user.lastName}` : '',
        customerName: sale.customer
          ? `${sale.customer.firstName} ${sale.customer.lastName}`
          : undefined,
      };
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
    pointsRedeemed?: number
  ) => {
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

    try {
      const saleData: any = {
        idempotencyKey: crypto.randomUUID(),
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
        payments: payments.map((p) => ({
          paymentMethod: p.paymentMethod,
          amount: p.amount,
          reference: p.reference,
        })),
      };

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
        noteParts.push(`Split payment: ${splitInfo}`);
      }
      if (noteParts.length > 0) saleData.notes = noteParts.join(' | ');

      const response = await saleService.create(saleData);
      const createdSale = response.data.data;
      const saleNumber = createdSale?.saleNumber || `SALE-${Date.now()}`;
      setLastSaleId(createdSale?.id || null);

      const lineBreakdown = getLineBreakdown();
      const totalSavings = Math.round(
        Object.values(lineBreakdown).reduce((s, l) => s + l.totalDiscount, 0) * 100
      ) / 100;
      // The server's totals are authoritative (they include any card surcharge)
      const chargedTotal = createdSale?.total ?? amountDue;
      const saleSurcharge = createdSale?.surcharge || 0;

      const receipt: Receipt = {
        saleNumber,
        date: new Date().toLocaleString(),
        items: items.map(item => ({
          name: item.product.name,
          quantity: item.quantity,
          price: item.product.price,
          total: item.product.price * item.quantity
            - (lineBreakdown[item.product.id]?.totalDiscount ?? item.discount),
        })),
        subtotal: getSubtotal(),
        tax: getTax(),
        discount: pointsValue,
        surcharge: saleSurcharge > 0 ? saleSurcharge : undefined,
        total: chargedTotal,
        savings: totalSavings > 0 ? totalSavings : undefined,
        paymentMethod: payments.length > 1
          ? payments.map(p => `${p.paymentMethod}: ${formatCurrency(p.amount)}`).join(' / ')
          : primaryPayment.paymentMethod,
        amountPaid: totalPaid,
        change: Math.max(0, Math.round((totalPaid - chargedTotal) * 100) / 100),
        employeeName: user ? `${user.firstName} ${user.lastName}` : 'Unknown',
        customerName: linkedCustomer
          ? `${linkedCustomer.firstName} ${linkedCustomer.lastName}`
          : undefined,
        loyaltyPoints: linkedCustomer?.loyaltyPoints,
      };

      setLastReceipt(receipt);

      // Open the drawer if ANY payment was cash (split sales may have cash as the smaller part)
      if (hardware.drawer.shouldOpen(hasCashPayment ? 'CASH' : primaryPayment.paymentMethod)) {
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
      clearCart();
      setLinkedCustomer(null);
      setAgeVerification(null);
      setShowPaymentModal(false);
      setShowReceiptPreview(true);
      setSalesRefreshTrigger((n) => n + 1);

    } catch (error: any) {
      // If network error, queue offline
      const isNetworkError = !error.response && (error.code === 'ERR_NETWORK' || !navigator.onLine);
      if (isNetworkError && primaryPayment.paymentMethod === 'CASH') {
        try {
          await syncService.createOfflineSale({
            customerId: linkedCustomer?.id,
            items: items.map((item) => ({
              productId: item.product.id,
              sku: item.product.sku,
              productName: item.product.name,
              quantity: item.quantity,
              price: item.product.price,
              discount: item.discount,
              isTaxable: item.product.isTaxable,
            })),
            paymentMethod: primaryPayment.paymentMethod,
            amountPaid: totalPaid,
            notes: notes.trim() || undefined,
            // Cart tax rate is a percent; offline sale math expects a fraction
            taxRate: useCartStore.getState().taxRate / 100,
          });

          const change = totalPaid - total;
          toast.success(`Sale saved offline! Will sync when connection restores.${change > 0 ? ` Change: ${formatCurrency(change)}` : ''}`);

          if (hardware.drawer.shouldOpen('CASH')) {
            hardware.drawer.open();
          }

          clearCart();
          setLinkedCustomer(null);
          setShowPaymentModal(false);
        } catch {
          toast.error('Failed to save sale offline');
        }
      } else {
        toast.error(error.response?.data?.error || 'Failed to complete sale');
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
    <div className="h-screen flex flex-col">
      {/* Status bar: navigation, store, shift, connectivity, clock, cashier, theme */}
      <POSTopBar />

      {/* Quantity Numpad overlay */}
      {numpadProduct && (
        <QuantityNumpad
          initialQty={getCartQty(numpadProduct.id) || 1}
          maxQty={numpadProduct.trackInventory ? numpadProduct.stockQuantity : undefined}
          productName={numpadProduct.name}
          onConfirm={(qty) => { handleSetQuantity(numpadProduct, qty); setNumpadProduct(null); }}
          onCancel={() => setNumpadProduct(null)}
        />
      )}

      {/* Main content: products left, cart right */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        {/* Left side - Products */}
        <ProductGrid
          products={products}
          categories={allCategories}
          selectedCategoryId={selectedCategoryId}
          onSelectCategory={setSelectedCategoryId}
          search={search}
          onSearchChange={setSearch}
          isLoading={isLoading}
          onProductClick={handleProductClick}
          getCartQty={getCartQty}
          isFavorite={isFavorite}
          toggleFavorite={toggleFavorite}
          searchInputRef={searchInputRef}
        />

        {/* Right side - Cart (desktop) */}
        <div className="hidden md:flex">
          <CartPanel
            lastReceipt={lastReceipt}
            onPrintReceipt={handlePrintReceipt}
            onShowHeldSales={() => setShowHeldSalesModal(true)}
            onShowRefund={() => setShowRefundModal(true)}
            onCheckout={() => startCheckout(undefined)}
            onHoldSale={handleHoldSale}
            linkedCustomer={linkedCustomer}
            onCustomerChange={setLinkedCustomer}
            onViewRecentReceipt={handleViewRecentReceipt}
            refreshTrigger={salesRefreshTrigger}
          />
        </div>
      </div>

      {/* Mobile cart overlay */}
      {mobileCartOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileCartOpen(false)} />
          <div className="relative mt-auto bg-background rounded-t-2xl shadow-2xl max-h-[85vh] flex flex-col z-10">
            <div className="flex items-center justify-between p-3 border-b">
              <h2 className="text-lg font-bold">Cart ({items.reduce((c, i) => c + i.quantity, 0)})</h2>
              <button onClick={() => setMobileCartOpen(false)} className="p-2 rounded-md hover:bg-accent">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto">
              <CartPanel
                lastReceipt={lastReceipt}
                onPrintReceipt={handlePrintReceipt}
                onShowHeldSales={() => setShowHeldSalesModal(true)}
                onShowRefund={() => setShowRefundModal(true)}
                onCheckout={() => { setMobileCartOpen(false); startCheckout(undefined); }}
                onHoldSale={() => { handleHoldSale(); setMobileCartOpen(false); }}
                linkedCustomer={linkedCustomer}
                onCustomerChange={setLinkedCustomer}
                onViewRecentReceipt={(saleId) => { setMobileCartOpen(false); handleViewRecentReceipt(saleId); }}
                refreshTrigger={salesRefreshTrigger}
              />
            </div>
          </div>
        </div>
      )}

      {/* Mobile floating cart button — shows the running total when the cart has items */}
      {!mobileCartOpen && (
        <button
          onClick={() => setMobileCartOpen(true)}
          className="md:hidden fixed bottom-4 right-4 z-40 h-14 flex items-center gap-2 px-5 bg-primary text-primary-foreground rounded-full shadow-lg hover:bg-primary/90 transition-colors"
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
        onClose={() => setShowRefundModal(false)}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowShortcutsHelp(false)}>
          <div className="bg-card border rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold flex items-center gap-2"><Keyboard className="h-5 w-5" /> Keyboard Shortcuts</h3>
              <button onClick={() => setShowShortcutsHelp(false)} className="p-1 rounded hover:bg-accent"><X className="h-4 w-4" /></button>
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
                ...(user?.role !== 'CASHIER' ? [['F8', 'Refund']] : []),
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
      <div className="hidden md:flex fixed bottom-0 left-0 right-0 bg-card/95 backdrop-blur border-t px-4 py-1.5 justify-center gap-4 text-[11px] text-muted-foreground z-30">
        <span><kbd className="px-1 bg-muted rounded font-mono text-[10px]">F1</kbd> Cash</span>
        <span><kbd className="px-1 bg-muted rounded font-mono text-[10px]">F2</kbd> Card</span>
        <span><kbd className="px-1 bg-muted rounded font-mono text-[10px]">F4</kbd> Pay</span>
        <span><kbd className="px-1 bg-muted rounded font-mono text-[10px]">F5</kbd> Hold</span>
        <span><kbd className="px-1 bg-muted rounded font-mono text-[10px]">F6</kbd> Recall</span>
        <span><kbd className="px-1 bg-muted rounded font-mono text-[10px]">F7</kbd> Misc</span>
        {user?.role !== 'CASHIER' && <span><kbd className="px-1 bg-muted rounded font-mono text-[10px]">F8</kbd> Refund</span>}
        <span><kbd className="px-1 bg-muted rounded font-mono text-[10px]">Esc</kbd> Back</span>
        <span><kbd className="px-1 bg-muted rounded font-mono text-[10px]">?</kbd> Help</span>
      </div>
    </div>
  );
};
