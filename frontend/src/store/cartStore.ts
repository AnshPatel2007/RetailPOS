import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { CartItem, Product, Customer } from '../types';

interface HeldSale {
  id: string;
  items: CartItem[];
  customer: Customer | null;
  notes: string;
  heldAt: string;
}

interface CartState {
  items: CartItem[];
  customer: Customer | null;
  notes: string;
  taxRate: number;
  heldSales: HeldSale[];

  addItem: (product: Product, quantity?: number) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  updateDiscount: (productId: string, discount: number) => void;
  updateNotes: (productId: string, notes: string) => void;
  updatePrice: (productId: string, price: number) => void;
  setCustomer: (customer: Customer | null) => void;
  setNotes: (notes: string) => void;
  setTaxRate: (rate: number) => void;
  clearCart: () => void;

  // Hold sales
  holdSale: () => void;
  restoreHeldSale: (id: string) => void;
  discardHeldSale: (id: string) => void;
  cleanupExpiredHeldSales: () => number;

  // Computed values
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
      heldSales: [],

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

      clearCart: () => {
        set({
          items: [],
          customer: null,
          notes: '',
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

      getSubtotal: () => {
        return Math.round(get().items.reduce((total, item) => {
          return total + item.product.price * item.quantity - item.discount;
        }, 0) * 100) / 100;
      },

      getTax: () => {
        const taxRate = get().taxRate;

        // Tax applies to taxable items only, net of their item discounts
        const taxableAmount = get().items.reduce((total, item) => {
          if (item.product.isTaxable) {
            return total + (item.product.price * item.quantity - item.discount);
          }
          return total;
        }, 0);

        return Math.round((Math.max(0, taxableAmount) * taxRate) / 100 * 100) / 100;
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
      // Only persist state, not computed functions
      partialize: (state) => ({
        items: state.items,
        customer: state.customer,
        notes: state.notes,
        taxRate: state.taxRate,
        heldSales: state.heldSales,
      }),
    }
  )
);
