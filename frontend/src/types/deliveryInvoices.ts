/** A delivery invoice someone photographed, as the server reports it (services/deliveryInvoice.service.ts). */
export type InvoiceStatus = 'READING' | 'READY' | 'FAILED' | 'RECEIVED' | 'DISCARDED';
/** SURE: barcode, supplier item number or a match confirmed before. CHECK: a suggestion. NEW: not an item yet. CREDIT: a return or credit. */
export type InvoiceTier = 'SURE' | 'CHECK' | 'NEW' | 'CREDIT';
export type UnitsSource = 'LEARNED' | 'PRINTED' | 'SUPPLIER' | 'PACK' | 'SET' | 'ONE';

export interface InvoiceProduct {
  productId: string;
  sellingUnitId: string | null;
  name: string;
  sku: string;
  unitsPerPackage: number | null;
}

export interface InvoiceNewItem {
  name: string;
  price: number | null;
  categoryId: string | null;
  barcode: string | null;
  minimumAge: 18 | 21 | null;
  ebtEligible: boolean;
  isTaxable: boolean;
}

export interface InvoiceLine {
  index: number;
  page: number;
  description: string;
  itemCode: string | null;
  upc: string | null;
  quantity: number | null;
  unit: 'CASE' | 'EACH' | 'UNKNOWN';
  printedUnitsPerCase: number | null;
  unitPrice: number | null;
  lineTotal: number | null;
  changedByHand: boolean;
  tier: InvoiceTier;
  reason: string;
  candidates: (InvoiceProduct & { score: number })[];
  suggestion: { name: string; categoryId: string | null; minimumAge: number | null; ageCheck: boolean } | null;
  product: InvoiceProduct | null;
  newItem: InvoiceNewItem | null;
  skip: boolean;
  confirmed: boolean;
  touched: boolean;
  receivedQuantity: number;
  unitsPerCase: number;
  unitsSource: UnitsSource;
  checkUnits: boolean;
  caseCost: number | null;
  /** Base units received, and the cost of one. */
  units: number;
  unitCost: number | null;
  current: { name: string; sku: string; cost: number | null; price: number; stockQuantity: number; available: boolean } | null;
  /** Percent change of the unit cost against the item's cost today. */
  costChange: number | null;
  suggestedPrice: number | null;
}

export interface InvoiceCounts {
  sure: number; check: number; new: number; credit: number;
  lines: number; waiting: number; skipped: number; units: number; cost: number | null;
}

export interface InvoiceSummary {
  id: string;
  status: InvoiceStatus;
  vendorName: string | null;
  invoiceNumber: string | null;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
  pageCount: number;
  lineCount: number;
  error: string | null;
  // Owners and managers only:
  supplier?: { id: string; name: string } | null;
  invoiceDate?: string | null;
  total?: number | null;
  counts?: InvoiceCounts;
  version?: number;
  receivedAt?: string | null;
  receivedBy?: { id: string; name: string } | null;
  purchaseOrderId?: string | null;
  purchaseReceiptId?: string | null;
}

export interface InvoiceWarning { code: 'ALREADY_RECEIVED' | 'ANOTHER_COPY' | 'TOTALS_DIFFER'; message: string; amount?: number; date?: string }

export interface InvoiceDetail extends InvoiceSummary {
  supplier: { id: string; name: string } | null;
  invoiceDate: string | null;
  total: number | null;
  counts: InvoiceCounts;
  version: number;
  subtotal: number | null;
  tax: number | null;
  fees: number | null;
  discount: number | null;
  notes: string[];
  warnings: InvoiceWarning[];
  pages: { pageNumber: number; mimeType: string }[];
  lines: InvoiceLine[];
  categories: { id: string; name: string }[];
  costAlertPercent: number;
  replayed?: boolean;
}

/** One change to a line, as PATCH /delivery-invoices/:id takes it. */
export interface InvoiceLinePatch {
  index: number;
  confirmed?: boolean;
  skip?: boolean;
  product?: { productId: string; sellingUnitId?: string | null };
  newItem?: InvoiceNewItem;
  receivedQuantity?: number;
  unitsPerCase?: number;
  caseCost?: number | null;
}

export interface InvoicePatch {
  version: number;
  supplierId?: string | null;
  vendorName?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  tax?: number | null;
  fees?: number | null;
  discount?: number | null;
  total?: number | null;
  lines?: InvoiceLinePatch[];
}
