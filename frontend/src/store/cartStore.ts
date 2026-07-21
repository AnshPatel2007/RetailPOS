import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { CartItem, Product, Customer, Promotion } from '../types';
import { applyPromotions, isPromotionActiveNow } from '../lib/promotionEngine';

interface HeldSale {
  id: string;
  items: CartItem[];
  customer: Customer | null;
  notes: string;
  heldAt: string;
}

/** Per-line pricing after manual discounts and automatic promotions */
export interface LineBreakdown {
  gross: number;
  manualDiscount: number;
  promoDiscount: number;
  totalDiscount: number; // manual + promo, clamped to the line total (mirrors backend)
  promotionName?: string;
}

interface CartState {
  items: CartItem[];
  customer: Customer | null;
  notes: string;
  taxRate: number;
  cardSurchargePercent: number; // location's card-surcharge rate (0 = off)
  heldSales: HeldSale[];
  promotions: Promotion[]; // active promotions, refreshed by the POS page (not persisted)

  addItem: (product: Product, quantity?: number) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  updateDiscount: (productId: string, discount: number) => void;
  updateNotes: (productId: string, notes: string) => void;
  updatePrice: (productId: string, price: number) => void;
  setCustomer: (customer: Customer | null) => void;
  setNotes: (notes: string) => void;
  setTaxRate: (rate: number) => void;
  setCardSurchargePercent: (rate: number) => void;
  setPromotions: (promotions: Promotion[]) => void;
  clearCart: () => void;
  resetForLogout: () => void;

  // Hold sales
  holdSale: () => void;
  restoreHeldSale: (id: string) => void;
  discardHeldSale: (id: string) => void;
  cleanupExpiredHeldSales: () => number;

  // Computed values
  getLineBreakdown: () => Record<string, LineBreakdown>;
  getPromoSavings: () => number;
  getEbtEligibleTotal: () => number;
  getRequiredAge: () => number;
  getSubtotal: () => number;
  getTax: () => number;
  getTotal: () => number;
  getItemCount: () => number;
}

/**
 * Cart store for POS checkout
 * Persisted to localStorage so cart survives page refreshes.
 */
export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      customer: null,
      notes: '',
      taxRate: 0,
      cardSurchargePercent: 0,
      heldSales: [],
      promotions: [],

      addItem: (product: Product, quantity = 1) => {
        const items = get().items;
        const existingItem = items.find((item) => item.product.id === product.id);

        if (existingItem) {
          set({
            items: items.map((item) =>
              item.product.id === product.id
                ? { ...item, quantity: item.quantity + quantity }
                : item
            ),
          });
        } else {
          set({
            items: [
              ...items,
              { product, quantity, discount: 0, notes: '' },
            ],
          });
        }
      },

      removeItem: (productId: string) => {
        set({
          items: get().items.filter((item) => item.product.id !== productId),
        });
      },

      updateQuantity: (productId: string, quantity: number) => {
        if (quantity <= 0) {
          get().removeItem(productId);
          return;
        }

        set({
          items: get().items.map((item) =>
            item.product.id === productId
              ? {
                  ...item,
                  quantity,
                  // Re-clamp fixed discounts so they never exceed the new line total
                  discount: Math.min(
                    item.discount,
                    Math.round(item.product.price * quantity * 100) / 100
                  ),
                }
              : item
          ),
        });
      },

      updateDiscount: (productId: string, discount: number) => {
        set({
          items: get().items.map((item) =>
            item.product.id === productId ? { ...item, discount } : item
          ),
        });
      },

      updateNotes: (productId: string, notes: string) => {
        set({
          items: get().items.map((item) =>
            item.product.id === productId ? { ...item, notes } : item
          ),
        });
      },

      updatePrice: (productId: string, price: number) => {
        set({
          items: get().items.map((item) =>
            item.product.id === productId
              ? {
                  ...item,
                  product: { ...item.product, price },
                  priceOverride: true,
                  discount: Math.min(
                    item.discount,
                    Math.round(price * item.quantity * 100) / 100
                  ),
                }
              : item
          ),
        });
      },

      setCustomer: (customer: Customer | null) => {
        set({ customer });
      },

      setNotes: (notes: string) => {
        set({ notes });
      },

      setTaxRate: (rate: number) => {
        set({ taxRate: rate });
      },

      setCardSurchargePercent: (rate: number) => {
        set({ cardSurchargePercent: rate });
      },

      setPromotions: (promotions: Promotion[]) => {
        set({ promotions });
      },

      clearCart: () => {
        set({
          items: [],
          customer: null,
          notes: '',
        });
      },

      // Unlike clearCart (used mid-session after checkout), this also drops
      // held sales and location-specific settings so a different cashier
      // logging into a different store never sees the previous session's data
      resetForLogout: () => {
        set({
          items: [],
          customer: null,
          notes: '',
          heldSales: [],
          taxRate: 0,
          cardSurchargePercent: 0,
        });
      },

      holdSale: () => {
        const { items, customer, notes, heldSales } = get();
        if (items.length === 0) return;

        const MAX_HELD = 5;
        if (heldSales.length >= MAX_HELD) return;

        const held: HeldSale = {
          id: `held-${Date.now()}`,
          items,
          customer,
          notes,
          heldAt: new Date().toISOString(),
        };

        set({
          heldSales: [...heldSales, held],
          items: [],
          customer: null,
          notes: '',
        });
      },

      restoreHeldSale: (id: string) => {
        const { items, customer, notes, heldSales } = get();
        const target = heldSales.find((h) => h.id === id);
        if (!target) return;

        const remainingHeld = heldSales.filter((h) => h.id !== id);

        // If there are active items, swap current cart back to held
        if (items.length > 0) {
          const currentAsHeld: HeldSale = {
            id: `held-${Date.now()}`,
            items,
            customer,
            notes,
            heldAt: new Date().toISOString(),
          };
          set({
            heldSales: [...remainingHeld, currentAsHeld],
            items: target.items,
            customer: target.customer,
            notes: target.notes,
          });
        } else {
          set({
            heldSales: remainingHeld,
            items: target.items,
            customer: target.customer,
            notes: target.notes,
          });
        }
      },

      discardHeldSale: (id: string) => {
        set({
          heldSales: get().heldSales.filter((h) => h.id !== id),
        });
      },

      cleanupExpiredHeldSales: () => {
        const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
        const now = Date.now();
        const before = get().heldSales.length;
        set({
          heldSales: get().heldSales.filter(
            (h) => now - new Date(h.heldAt).getTime() < MAX_AGE_MS
          ),
        });
        return before - get().heldSales.length;
      },

      // Mirrors backend createSale pricing: promo discounts are computed by the same
      // engine the server runs, and manual + promo discounts are clamped per line
      getLineBreakdown: () => {
        const { items, promotions } = get();
        const now = new Date();
        const active = promotions.filter((p) => isPromotionActiveNow(p, now));

        const promoResults = applyPromotions(
          items
            .filter((i) => !i.product.id.startsWith('misc-'))
            .map((i) => ({
              key: i.product.id,
              productId: i.product.id,
              categoryId: i.product.categoryId,
              unitPrice: i.product.price,
              quantity: i.quantity,
            })),
          active
        );

        const breakdown: Record<string, LineBreakdown> = {};
        for (const item of items) {
          const gross = item.product.price * item.quantity;
          const manualDiscount = Math.min(item.discount, gross);
          const promo = promoResults.get(item.product.id);
          const totalDiscount = Math.min(manualDiscount + (promo?.discount || 0), gross);
          const promoDiscount = Math.round((totalDiscount - manualDiscount) * 100) / 100;
          breakdown[item.product.id] = {
            gross: Math.round(gross * 100) / 100,
            manualDiscount: Math.round(manualDiscount * 100) / 100,
            promoDiscount,
            totalDiscount,
            promotionName: promoDiscount > 0 ? promo?.promotionName : undefined,
          };
        }
        return breakdown;
      },

      getPromoSavings: () => {
        const breakdown = get().getLineBreakdown();
        return Math.round(
          Object.values(breakdown).reduce((sum, line) => sum + line.promoDiscount, 0) * 100
        ) / 100;
      },

      // SNAP-eligible portion of the sale: eligible lines net of discounts plus
      // their tax — mirrors the backend cap in createSale
      getEbtEligibleTotal: () => {
        const { items, taxRate } = get();
        const breakdown = get().getLineBreakdown();
        return Math.round(items.reduce((total, item) => {
          if (!item.product.ebtEligible || item.product.id.startsWith('misc-')) return total;
          const line = breakdown[item.product.id];
          const net = Math.max(0, item.product.price * item.quantity - (line?.totalDiscount ?? item.discount));
          const tax = item.product.isTaxable ? Math.round((net * taxRate) / 100 * 100) / 100 : 0;
          return total + net + tax;
        }, 0) * 100) / 100;
      },

      // Strictest age requirement across cart items (0 = unrestricted)
      getRequiredAge: () => {
        return get().items.reduce(
          (max, item) => Math.max(max, item.product.minimumAge || 0),
          0
        );
      },

      getSubtotal: () => {
        const breakdown = get().getLineBreakdown();
        return Math.round(get().items.reduce((total, item) => {
          const line = breakdown[item.product.id];
          return total + item.product.price * item.quantity - (line?.totalDiscount ?? item.discount);
        }, 0) * 100) / 100;
      },

      getTax: () => {
        const taxRate = get().taxRate;
        const breakdown = get().getLineBreakdown();

        // Tax applies per taxable line, net of discounts, rounded per line like the backend
        return Math.round(get().items.reduce((total, item) => {
          if (!item.product.isTaxable) return total;
          const line = breakdown[item.product.id];
          const net = Math.max(0, item.product.price * item.quantity - (line?.totalDiscount ?? item.discount));
          return total + Math.round((net * taxRate) / 100 * 100) / 100;
        }, 0) * 100) / 100;
      },

      getTotal: () => {
        const subtotal = get().getSubtotal();
        const tax = get().getTax();
        return Math.round((subtotal + tax) * 100) / 100;
      },

      getItemCount: () => {
        return get().items.reduce((count, item) => count + item.quantity, 0);
      },
    }),
    {
      name: 'pos-cart',
      // Only persist state, not computed functions. Promotions are intentionally
      // excluded — the POS refetches the active list so stale promos never price a sale.
      partialize: (state) => ({
        items: state.items,
        customer: state.customer,
        notes: state.notes,
        taxRate: state.taxRate,
        cardSurchargePercent: state.cardSurchargePercent,
        heldSales: state.heldSales,
      }),
    }
  )
);
