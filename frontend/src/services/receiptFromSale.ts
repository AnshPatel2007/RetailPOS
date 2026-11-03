import { lineMoney } from '@/lib/money';
import type { Receipt } from './hardware';

interface BookedSale {
  saleNumber: string; createdAt: string; subtotal: number; tax: number; discount: number; surcharge: number; total: number;
  amountPaid: number; changeDue: number; paymentMethod: string;
  pointsEarned?: number | null; pointsRedeemed?: number | null;
  items: { productName: string; quantity: number; price: number }[];
  payments?: { paymentMethod: string; amount: number }[];
  customer?: { firstName: string; lastName: string } | null;
  user?: { firstName: string; lastName: string };
}

// First print and reprint use the same booked facts, never today's catalog/cart.
// Item amounts are before discounts; the summary deducts all booked discounts.
export function receiptFromSale(sale: BookedSale): Receipt {
  return {
    saleNumber: sale.saleNumber, date: new Date(sale.createdAt).toLocaleString(),
    items: sale.items.map(item => ({ name: item.productName, quantity: item.quantity, price: item.price, total: lineMoney(item.price, item.quantity) })),
    subtotal: sale.subtotal, tax: sale.tax, discount: sale.discount, surcharge: sale.surcharge || undefined, total: sale.total,
    savings: sale.discount || undefined, amountPaid: sale.amountPaid, change: Math.max(0, sale.changeDue),
    paymentMethod: (sale.payments?.length || 0) > 1 ? sale.payments!.map(payment => payment.paymentMethod + ': $' + payment.amount.toFixed(2)).join(' / ') : sale.paymentMethod,
    employeeName: sale.user ? sale.user.firstName + ' ' + sale.user.lastName : '',
    customerName: sale.customer ? sale.customer.firstName + ' ' + sale.customer.lastName : undefined,
    pointsEarned: sale.pointsEarned ?? undefined, pointsRedeemed: sale.pointsRedeemed ?? undefined,
  };
}
