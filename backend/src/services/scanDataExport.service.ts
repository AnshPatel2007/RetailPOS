/**
 * Tobacco and other manufacturer scan data for one store: a row for every item
 * sold in the chosen store days, and a negative row for every item returned or
 * voided, on the day the return or void happened (reversals count on their own
 * day, as everywhere in the POS). A pack or carton reports its own barcode and
 * how many units it holds. Dates and times are the store's.
 *
 * A general layout. The Altria and RJR program file layouts are not built yet.
 */
import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { MetricRange, recordedSaleWhere } from './financialMetrics.service';
import { csvCell, csvLine, csvMoney } from '../utils/csv';

export const SCAN_DATA_COLUMNS = ['Transaction Date', 'Transaction Time', 'Store ID', 'Store Name', 'Transaction ID', 'Type', 'UPC', 'Units Per Pack', 'SKU',
  'Item Description', 'Category', 'Quantity', 'Unit Price', 'Total Discount', 'Promotion Flag', 'Promotion Name', 'Final Price', 'Tax'] as const;

const lineSelect = {
  id: true, sellingUnitId: true, unitsPerPackage: true, sku: true, productName: true, quantity: true, price: true,
  discount: true, tax: true, total: true, promotionDiscount: true, promotionName: true,
  product: { select: { barcode: true, category: { select: { name: true } } } },
} satisfies Prisma.SaleItemSelect;
type Line = Prisma.SaleItemGetPayload<{ select: typeof lineSelect }>;

export interface ScanDataRow {
  at: Date; type: 'Sale' | 'Return' | 'Void'; saleNumber: string; line: Line;
  /** Negative for returns and voids. */
  quantity: number; discount: number; finalPrice: number; tax: number;
}

const cents = (value: number) => Math.round((value + Number.EPSILON) * 100);
/** This many of a line's units, as a share of one of its recorded amounts (to the cent). */
const share = (amount: Prisma.Decimal | number, part: number, whole: number) => Math.round(cents(Number(amount)) * part / whole) / 100;

export async function scanDataRows(locationId: string, range: MetricRange, categoryIds: string[]): Promise<ScanDataRow[]> {
  const inCategories = { product: { categoryId: { in: categoryIds } } } satisfies Prisma.SaleItemWhereInput;
  const [sold, returned, voided] = await Promise.all([
    prisma.saleItem.findMany({ where: { ...inCategories, sale: { locationId, sourceType: { not: 'DAILY_SUMMARY' }, ...recordedSaleWhere, createdAt: range } },
      select: { ...lineSelect, sale: { select: { saleNumber: true, createdAt: true } } } }),
    prisma.refundItem.findMany({ where: { quantity: { gt: 0 }, saleItem: inCategories, refund: { createdAt: range, sale: { locationId } } },
      select: { quantity: true, amount: true, taxAmount: true, refund: { select: { createdAt: true } }, saleItem: { select: { ...lineSelect, sale: { select: { saleNumber: true } } } } } }),
    prisma.saleVoid.findMany({ where: { locationId, createdAt: range },
      select: { createdAt: true, sale: { select: { saleNumber: true, items: { where: inCategories, select: lineSelect } } } } }),
  ]);
  const rows: ScanDataRow[] = [
    ...sold.map(({ sale, ...line }) => ({ at: sale.createdAt, type: 'Sale' as const, saleNumber: sale.saleNumber, line,
      quantity: line.quantity, discount: Number(line.discount), finalPrice: Number(line.total) - Number(line.tax), tax: Number(line.tax) })),
    // The refund line's own recorded amount and tax; an older refund without its tax takes the line's share.
    ...returned.map(({ quantity, amount, taxAmount, refund, saleItem: { sale, ...line } }) => {
      const tax = taxAmount === null ? share(line.tax, quantity, line.quantity) : Number(taxAmount);
      return { at: refund.createdAt, type: 'Return' as const, saleNumber: sale.saleNumber, line, quantity: -quantity,
        discount: -share(line.discount, quantity, line.quantity), finalPrice: -(Number(amount) - tax), tax: -tax };
    }),
    // A void reverses whole lines (a sale with returns cannot be voided).
    ...voided.flatMap(({ createdAt, sale }) => sale.items.map(line => ({ at: createdAt, type: 'Void' as const, saleNumber: sale.saleNumber, line,
      quantity: -line.quantity, discount: -Number(line.discount), finalPrice: -(Number(line.total) - Number(line.tax)), tax: -Number(line.tax) }))),
  ];
  return rows.sort((a, b) => a.at.getTime() - b.at.getTime() || a.saleNumber.localeCompare(b.saleNumber) || a.line.id.localeCompare(b.line.id) || a.type.localeCompare(b.type));
}

/** The export file: a header row, then one row per item, oldest first. */
export async function scanDataCsv(locationId: string, range: MetricRange, categoryIds: string[]) {
  const [store, rows] = await Promise.all([
    prisma.location.findUniqueOrThrow({ where: { id: locationId }, select: { id: true, name: true, timezone: true } }),
    scanDataRows(locationId, range, categoryIds),
  ]);
  const packIds = [...new Set(rows.flatMap(row => row.line.sellingUnitId ? [row.line.sellingUnitId] : []))];
  const packBarcodes = new Map((packIds.length ? await prisma.productSellingUnit.findMany({ where: { id: { in: packIds } }, select: { id: true, barcode: true } }) : [])
    .map(pack => [pack.id, pack.barcode]));
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: store.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: store.timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  let csv = csvLine(SCAN_DATA_COLUMNS.map(csvCell));
  for (const row of rows) {
    const { line } = row;
    // A pack or carton is reported by its own barcode; a single by its product's.
    const upc = (line.sellingUnitId ? packBarcodes.get(line.sellingUnitId) : line.product.barcode) || line.sku;
    csv += csvLine([csvCell(date.format(row.at)), csvCell(time.format(row.at)), csvCell(store.id), csvCell(store.name), csvCell(row.saleNumber), csvCell(row.type),
      csvCell(upc), csvCell(line.sellingUnitId ? line.unitsPerPackage : 1), csvCell(line.sku), csvCell(line.productName), csvCell(line.product.category?.name ?? ''),
      csvCell(row.quantity), csvMoney(Number(line.price)), csvMoney(row.discount), csvCell(Number(line.promotionDiscount) > 0 ? 'Y' : 'N'),
      csvCell(line.promotionName ?? ''), csvMoney(row.finalPrice), csvMoney(row.tax)]);
  }
  return { csv, rows: rows.length };
}
