export interface CheckoutItem {
  productId: string;
  quantity: number;
  price: number;
  discount?: number;
  priceOverride?: boolean;
  name?: string;
}
export interface CheckoutQuoteIntent {
  customerId?: string;
  pointsRedeemed?: number;
  paymentMethod?: string;
  payments?: { paymentMethod: string; amount: number }[];
}
export interface CheckoutQuote {
  baseTotal: number;
  total: number;
  totalTax: number;
  loyaltyDiscount: number;
  redeemedPoints: number;
  surcharge: number;
  availablePoints: number | null;
  pointsPerDollar: number;
  cardSurchargePercent: number;
}

