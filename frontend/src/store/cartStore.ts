import { lineMoney, roundMoney, taxMoney } from '@/lib/money';
import { lineKey, newLineId } from '@/lib/cartLines';
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
  /** The store the held sales belong to; they stay on this register across sign-ins there. */
  heldLocationId: string | null;
  promotions: Promotion[]; // active promotions, refreshed by the POS page (not persisted)

  applyQuote: (quote: any) => void;
  /** `separateLine`: a price-label scan, added as a line of its own at the label's price. */
  addItem: (product: Product, quantity?: number, options?: { separateLine?: boolean; price?: number }) => boolean;
  // Lines are addressed by their line key (lib/cartLines): the product's id, or a price-label line's own id.
  removeItem: (line: string) => void;
  updateQuantity: (line: string, quantity: number) => void;
  updateDiscount: (line: string, discount: number) => void;
  updateNotes: (line: string, notes: string) => void;
  updatePrice: (line: string, price: number) => void;
  setCustomer: (customer: Customer | null) => void;
  setNotes: (notes: string) => void;
  setTaxRate: (rate: number) => void;
  setCardSurchargePercent: (rate: number) => void;
  setPromotions: (promotions: Promotion[]) => void;
  clearCart: () => void;
  resetForLogout: () => void;
  /** Keep held sales only when the register is signed in to the same store. */
  adoptHeldSalesFor: (locationId: string) => void;

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
      heldLocationId: null,
      promotions: [],

      applyQuote: (quote) => set({
        items: get().items.map(item => {
          const product = quote.products.find((p: Product) => p.id === item.product.id);
          return product ? { ...item, product: { ...product, ...(item.priceOverride ? { price: item.product.price } : {}) } } : item;
        }),
        taxRate: quote.taxRate, cardSurchargePercent: quote.cardSurchargePercent, promotions: quote.promotions,
      }),
      addItem: (product: Product, quantity = 1, options = {}) => {
        const items = get().items;
        // Recorded stock never limits the cart; only recalls/prohibited items do.
        if (!Number.isSafeInteger(quantity) || quantity <= 0 || product.saleBlockedReason) return false;

        // A price label carries its own price: each scan is a line of its own, so two
        // packages of one product are charged what each label says.
        if (options.separateLine) {
          set({ items: [...items, { product: { ...product, price: options.price ?? product.price }, quantity, discount: 0, notes: '',
            priceOverride: true, lineId: newLineId(items, product.id) }] });
          return true;
        }

        // The product's ordinary line (a price-label line of the same product is not it).
        const existingItem = items.find((item) => lineKey(item) === product.id);
        if (existingItem) {
          set({
            items: items.map((item) =>
              lineKey(item) === product.id
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
        return true;
      },

      removeItem: (line: string) => {
        set({
          items: get().items.filter((item) => lineKey(item) !== line),
        });
      },

      updateQuantity: (line: string, quantity: number) => {
        const item = get().items.find(candidate => lineKey(candidate) === line);
        if (!Number.isSafeInteger(quantity) || !item) return;
        if (quantity <= 0) {
          get().removeItem(line);
          return;
        }

        set({
          items: get().items.map((item) =>
            lineKey(item) === line
              ? {
                  ...item,
                  quantity,
                  // Re-clamp fixed discounts so they never exceed the new line total
                  discount: Math.min(
                    item.discount,
                    lineMoney(item.product.price, quantity)
                  ),
                }
              : item
          ),
        });
      },

      updateDiscount: (line: string, discount: number) => {
        set({
          items: get().items.map((item) =>
            lineKey(item) === line ? { ...item, discount } : item
          ),
        });
      },

      updateNotes: (line: string, notes: string) => {
        set({
          items: get().items.map((item) =>
            lineKey(item) === line ? { ...item, notes } : item
          ),
        });
      },

      updatePrice: (line: string, price: number) => {
        set({
          items: get().items.map((item) =>
            lineKey(item) === line
              ? {
                  ...item,
                  product: { ...item.product, price },
                  priceOverride: true,
                  discount: Math.min(
                    item.discount,
                    lineMoney(price, item.quantity)
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

      // Unlike clearCart (used mid-session after checkout), this also drops the
      // store's settings. Held sales stay on the register for the next cashier at
      // the same store; adoptHeldSalesFor drops them if another store signs in.
      resetForLogout: () => {
        set({
          items: [],
          customer: null,
          notes: '',
          taxRate: 0,
          cardSurchargePercent: 0,
        });
      },

      adoptHeldSalesFor: (locationId: string) => {
        const { heldLocationId, heldSales } = get();
        if (heldLocationId === locationId) return;
        // Sales held before the store was recorded were made in this sign-in, so they are kept.
        set({ heldLocationId: locationId, heldSales: heldLocationId === null ? heldSales : [] });
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
              key: lineKey(i),
              productId: i.product.id,
              categoryId: i.product.categoryId,
              unitPrice: i.product.price,
              quantity: i.quantity,
            })),
          active
        );

        // One entry per cart line, by its line key (lib/cartLines).
        const breakdown: Record<string, LineBreakdown> = {};
        for (const item of items) {
          const gross = lineMoney(item.product.price, item.quantity);
          const manualDiscount = roundMoney(Math.min(item.discount, gross));
          const promo = promoResults.get(lineKey(item));
          const totalDiscount = roundMoney(Math.min(manualDiscount + (promo?.discount || 0), gross));
          const promoDiscount = Math.round((totalDiscount - manualDiscount) * 100) / 100;
          breakdown[lineKey(item)] = {
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

      // Eligible merchandise before tax. Tender remains gated until allocation
      // and original-tender refunds are validated.
      getEbtEligibleTotal: () => {
        const { items } = get();
        const breakdown = get().getLineBreakdown();
        return Math.round(items.reduce((total, item) => {
          if (!item.product.ebtEligible || item.product.id.startsWith('misc-')) return total;
          const line = breakdown[lineKey(item)];
          const net = Math.max(0, lineMoney(item.product.price, item.quantity) - (line?.totalDiscount ?? item.discount));
          return total + net;
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
          const line = breakdown[lineKey(item)];
          return total + lineMoney(item.product.price, item.quantity) - (line?.totalDiscount ?? item.discount);
        }, 0) * 100) / 100;
      },

      getTax: () => {
        const taxRate = get().taxRate;
        const breakdown = get().getLineBreakdown();

        // Tax applies per taxable line, net of discounts, rounded per line like the backend
        return Math.round(get().items.reduce((total, item) => {
          if (!item.product.isTaxable) return total;
          const line = breakdown[lineKey(item)];
          const net = Math.max(0, lineMoney(item.product.price, item.quantity) - (line?.totalDiscount ?? item.discount));
          return total + taxMoney(roundMoney(net), taxRate);
        }, 0) * 100) / 100;
      },

      getTotal: () => {
        const subtotal = get().getSubtotal();
        const tax = get().getTax();
        return roundMoney(subtotal + tax);
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
        heldLocationId: state.heldLocationId,
      }),
    }
  )
);
