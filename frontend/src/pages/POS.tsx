import React, { useState, useEffect, useRef, useCallback } from 'react';
import { productService, saleService, locationService, categoryService } from '@/services/api';
import { useCartStore } from '@/store/cartStore';
import { useAuthStore } from '@/store/authStore';
import { useEffectiveLocation } from '@/hooks/useEffectiveLocation';
import { useFavoritesStore } from '@/store/favoritesStore';
import { Product } from '@/types';
import { formatCurrency } from '@/lib/utils';
import { QuantityNumpad } from '@/components/pos/QuantityNumpad';
import { EnhancedPaymentModal } from '@/components/pos/EnhancedPaymentModal';
import { ReceiptPreviewModal } from '@/components/pos/ReceiptPreviewModal';
import { QuickRefundModal } from '@/components/pos/QuickRefundModal';
import { HeldSalesModal } from '@/components/pos/HeldSalesModal';
import { ProductGrid } from '@/components/pos/ProductGrid';
import { CartPanel } from '@/components/pos/CartPanel';
import { LinkedCustomer } from '@/components/pos/CustomerLinkSection';
import { hardware, Receipt } from '@/services/hardware';
import toast from 'react-hot-toast';

type PaymentMethod = 'CASH' | 'CARD' | 'GIFT_CARD' | 'STORE_CREDIT';

export const POS: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string; color?: string | null }[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [linkedCustomer, setLinkedCustomer] = useState<LinkedCustomer | null>(null);
  const [showHeldSalesModal, setShowHeldSalesModal] = useState(false);
  const [numpadProduct, setNumpadProduct] = useState<Product | null>(null);
  const [lastReceipt, setLastReceipt] = useState<Receipt | null>(null);
  const [showReceiptPreview, setShowReceiptPreview] = useState(false);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [saleRefreshTrigger, setSaleRefreshTrigger] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { user } = useAuthStore();
  const { locationId } = useEffectiveLocation();
  const { favoriteIds, toggleFavorite, isFavorite } = useFavoritesStore();
  const {
    items, addItem, clearCart, notes,
    getSubtotal, getTax, getTotal, setTaxRate,
    heldSales, holdSale, restoreHeldSale, discardHeldSale,
  } = useCartStore();

  // Load location tax rate
  useEffect(() => {
    if (!locationId) return;
    locationService.getById(locationId).then((res) => {
      const rate = res.data?.data?.taxRate ?? res.data?.taxRate;
      if (typeof rate === 'number') setTaxRate(rate);
    }).catch(() => {});
  }, [locationId, setTaxRate]);

  // Load categories
  useEffect(() => {
    categoryService.getAll().then((res) => {
      setCategories(res.data.data || []);
    }).catch(() => {});
  }, []);

  // Load products when search/category changes
  useEffect(() => {
    loadProducts();
  }, [search, selectedCategoryId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Barcode scanner
  useEffect(() => {
    const handleBarcodeScan = async (barcode: string) => {
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

    if (e.key === 'F1' || e.key === 'F2') { e.preventDefault(); if (items.length > 0) setShowPaymentModal(true); return; }
    if (e.key === 'F4') { e.preventDefault(); if (items.length > 0) setShowPaymentModal(true); return; }
    if (e.key === 'F5') { e.preventDefault(); handleHoldSale(); return; }
    if (e.key === 'F6') { e.preventDefault(); setShowHeldSalesModal(true); return; }
    if ((e.key === '/' || e.key === 'F3') && !inInput) {
      e.preventDefault();
      searchInputRef.current?.focus();
    }
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

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
      if (isFavoritesTab) {
        result = result.filter((p: Product) => favoriteIds.includes(p.id));
      }
      setProducts(result);
    } catch {
      // silently fail
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

  const handleAddToCart = (product: Product, qty = 1) => {
    if (isOutOfStock(product)) {
      toast.error(`${product.name} is out of stock`);
      return;
    }
    if (product.trackInventory) {
      const currentInCart = getCartQty(product.id);
      if (currentInCart + qty > product.stockQuantity) {
        const canAdd = product.stockQuantity - currentInCart;
        if (canAdd <= 0) {
          toast.error(`Only ${product.stockQuantity} in stock — already all in cart`);
          return;
        }
        toast(`Only ${canAdd} more available (${product.stockQuantity} total in stock)`, { icon: '⚠️' });
        addItem(product, canAdd);
        return;
      }
    }
    addItem(product, qty);
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

  const handleRestoreHeld = (id: string) => {
    restoreHeldSale(id);
    setShowHeldSalesModal(false);
    setLinkedCustomer(null);
    toast.success('Sale restored');
  };

  const handlePrintReceipt = () => {
    if (!lastReceipt) return;
    hardware.printer.print(lastReceipt);
    toast.success('Receipt sent to printer');
  };

  const handlePaymentComplete = async (
    payments: { paymentMethod: PaymentMethod; amount: number; reference?: string }[],
    totalPaid: number
  ) => {
    if (items.length === 0) return;
    const total = getTotal();
    const primaryPayment = payments.reduce((a, b) => (a.amount >= b.amount ? a : b));
    setIsProcessing(true);

    try {
      const saleData: any = {
        items: items.map((item) => ({
          productId: item.product.id,
          quantity: item.quantity,
          price: item.product.price,
          discount: item.discount,
          notes: item.notes,
        })),
        paymentMethod: primaryPayment.paymentMethod,
        amountPaid: totalPaid,
      };

      if (linkedCustomer) saleData.customerId = linkedCustomer.id;

      const noteParts: string[] = [];
      if (notes.trim()) noteParts.push(notes.trim());
      if (payments.length > 1) {
        const splitInfo = payments.map(p => `${p.paymentMethod}: ${formatCurrency(p.amount)}`).join(', ');
        noteParts.push(`Split payment: ${splitInfo}`);
      }
      if (noteParts.length > 0) saleData.notes = noteParts.join(' | ');

      const response = await saleService.create(saleData);
      const saleNumber = response.data.data?.saleNumber || `SALE-${Date.now()}`;

      const receipt: Receipt = {
        saleNumber,
        date: new Date().toISOString(),
        items: items.map(item => ({
          name: item.product.name,
          quantity: item.quantity,
          price: item.product.price,
          total: item.product.price * item.quantity,
        })),
        subtotal: getSubtotal(),
        tax: getTax(),
        discount: 0,
        total: getTotal(),
        paymentMethod: primaryPayment.paymentMethod,
        amountPaid: totalPaid,
        change: totalPaid - getTotal(),
        employeeName: user ? `${user.firstName} ${user.lastName}` : 'Unknown',
        customerName: linkedCustomer
          ? `${linkedCustomer.firstName} ${linkedCustomer.lastName}`
          : undefined,
        loyaltyPoints: linkedCustomer?.loyaltyPoints,
      };

      setLastReceipt(receipt);

      if (hardware.drawer.shouldOpen(primaryPayment.paymentMethod)) {
        hardware.drawer.open();
      }

      const change = totalPaid - total;
      const message = linkedCustomer
        ? `Sale completed for ${linkedCustomer.firstName} ${linkedCustomer.lastName}!${change > 0 ? `\nChange: ${formatCurrency(change)}` : ''}`
        : `Sale completed!${change > 0 ? ` Change: ${formatCurrency(change)}` : ''}`;

      toast.success(message);
      clearCart();
      setLinkedCustomer(null);
      setShowPaymentModal(false);
      setShowReceiptPreview(true);
      setSaleRefreshTrigger((n) => n + 1);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to complete sale');
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
    <div className="h-screen flex">
      {/* Quantity Numpad overlay */}
      {numpadProduct && (
        <QuantityNumpad
          initialQty={getCartQty(numpadProduct.id) || 1}
          maxQty={numpadProduct.trackInventory ? numpadProduct.stockQuantity : undefined}
          productName={numpadProduct.name}
          onConfirm={(qty) => { handleAddToCart(numpadProduct, qty); setNumpadProduct(null); }}
          onCancel={() => setNumpadProduct(null)}
        />
      )}

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

      {/* Right side - Cart */}
      <CartPanel
        linkedCustomer={linkedCustomer}
        onCustomerChange={setLinkedCustomer}
        lastReceipt={lastReceipt}
        onPrintReceipt={handlePrintReceipt}
        onShowHeldSales={() => setShowHeldSalesModal(true)}
        onShowRefund={() => setShowRefundModal(true)}
        onCheckout={() => { if (items.length > 0) setShowPaymentModal(true); }}
        onHoldSale={handleHoldSale}
        saleRefreshTrigger={saleRefreshTrigger}
      />

      {/* Modals */}
      <EnhancedPaymentModal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        total={getTotal()}
        onComplete={handlePaymentComplete}
        isProcessing={isProcessing}
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
        onRefundComplete={() => setSaleRefreshTrigger((n) => n + 1)}
      />

      {lastReceipt && (
        <ReceiptPreviewModal
          isOpen={showReceiptPreview}
          onClose={() => setShowReceiptPreview(false)}
          receipt={lastReceipt}
        />
      )}
    </div>
  );
};
