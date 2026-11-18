/**
 * The lines of a delivery received by scanning (pages/ReceiveDelivery.tsx).
 * Pure functions with no imports, so frontend/tests/delivery-lines.test.cjs can
 * load this file directly. Saving goes through the reviewed receipt import.
 */

export type DeliveryLineKind = 'PRODUCT' | 'PACK' | 'SUPPLIER_CASE' | 'NEW';

/** Stock on record when the item was scanned (base units). */
export interface RecordedStock { quantity: number; lowStockAlert: number; version: number }

export interface DeliveryLine {
  key: string;
  kind: DeliveryLineKind;
  /** The stocked product (a pack's single); null for an item new to the store. */
  productId: string | null;
  /** A store pack received sealed (for example a carton of 10), else null. */
  sellingUnitId: string | null;
  name: string;
  sku: string;
  barcode: string | null;
  tracked: boolean;
  /** Units in one case or pack; 1 when the line is counted in singles. */
  packSize: number;
  /** "Carton" for a store pack, null for supplier cases and singles. */
  packLabel: string | null;
  /** Cases or packs, as typed (used only when packSize > 1). */
  cases: string;
  /** Single units, as typed. */
  units: string;
  /** Cost of one case or pack (of one unit when packSize is 1), as typed. */
  cost: string;
  /** Cost per unit before this delivery, for the "was $x" note. */
  previousUnitCost: number | null;
  /** Selling price, new items only. */
  price: string;
  freeConfirmed: boolean;
  /** Null when unknown (not scanned) or not tracked. */
  recorded: RecordedStock | null;
  openExceptionId: string | null;
  /** Optional shelf count before the delivery, base units, as typed. */
  shelfCount: string;
  /** Retry key for posting this shelf count; replaced when the count is edited. */
  countKey: string;
  countSaved: boolean;
  countError: string;
  /** Units still expected on the linked order; null when not on it. */
  ordered: number | null;
}

/** What GET /products/resolve-barcode returns for one match (the parts used here). */
export interface ScanMatch {
  kind: 'PRODUCT' | 'PACK' | 'SUPPLIER_CASE';
  product: {
    id: string; name: string; sku: string; barcode: string | null; cost: number | string;
    stockQuantity: number; stockVersion: number; lowStockAlert: number; trackInventory: boolean;
    inventoryProductId?: string; sellingUnitId?: string | null; unitsPerPackage?: number;
    baseStockQuantity?: number; packageName?: string;
  };
  openExceptionId?: string | null;
  supplierCase?: { supplierId: string; packSize: number; packCost: number | null };
}

export interface OrderItemInput {
  productId: string; productName: string; sku: string; cost: number | string;
  packSize?: number; packCost?: number | string | null; outstanding: number;
}

export interface DeliveryDraft {
  supplier: { id: string; name: string } | null;
  order: { id: string; orderNumber: string } | null;
  lines: DeliveryLine[];
  invoice: { number: string; date: string; freight: string; tax: string; discount: string };
}

export const emptyDraft = (): DeliveryDraft => ({ supplier: null, order: null, lines: [],
  invoice: { number: '', date: '', freight: '', tax: '', discount: '' } });

/** A whole number typed in a quantity field; blank or invalid counts as 0. */
export const whole = (text: string) => { const value = Number(text.trim()); return text.trim() !== '' && Number.isSafeInteger(value) && value > 0 ? value : 0; };
/** A money amount typed in a field; null when blank or invalid. */
export const amount = (text: string) => { if (!text.trim()) return null; const value = Number(text); return Number.isFinite(value) && value >= 0 ? value : null; };
const wholeText = (text: string) => text.trim() === '' || /^\d+$/.test(text.trim());
const round4 = (value: number) => Math.round(value * 10000) / 10000;
const costText = (value: number) => value > 0 ? String(round4(value)) : '';

export const lineUnits = (line: DeliveryLine) => (line.packSize > 1 ? whole(line.cases) * line.packSize : 0) + whole(line.units);
export const unitCostOf = (line: DeliveryLine) => { const cost = amount(line.cost); return cost === null ? null : round4(cost / line.packSize); };
export const lineTotal = (line: DeliveryLine) => {
  const cost = amount(line.cost), unit = unitCostOf(line);
  if (cost === null || unit === null) return 0;
  return Math.round(((line.packSize > 1 ? cost * whole(line.cases) : 0) + unit * whole(line.units)) * 100) / 100;
};

const inventoryIdOf = (match: ScanMatch) => match.product.inventoryProductId || match.product.id;

/**
 * Which match a scan means. This supplier's case beats a store item; another
 * supplier's case is used only when nothing else matched. Matches for
 * different items come back as choices for the person to pick from.
 */
export function pickMatch<Match extends ScanMatch>(matches: Match[], supplierId: string | null): { match: Match } | { choices: Match[] } | null {
  if (!matches.length) return null;
  const own = matches.filter(match => match.kind === 'SUPPLIER_CASE' && match.supplierCase?.supplierId === supplierId);
  const usable = [...own, ...matches.filter(match => match.kind !== 'SUPPLIER_CASE')];
  const pool = usable.length ? usable : matches;
  return new Set(pool.map(inventoryIdOf)).size === 1 ? { match: pool[0] } : { choices: pool };
}

export function lineFromMatch(match: ScanMatch, newKey: () => string): DeliveryLine {
  const product = match.product;
  const packSize = match.kind === 'PACK' ? Math.max(1, product.unitsPerPackage || 1) : match.kind === 'SUPPLIER_CASE' ? Math.max(1, match.supplierCase?.packSize || 1) : 1;
  // A pack's projected cost is already per pack; products and supplier links carry a unit cost.
  const listed = Number(product.cost) || 0;
  const unitCost = match.kind === 'PACK' ? listed / packSize : listed;
  const caseCost = match.kind === 'SUPPLIER_CASE' && match.supplierCase?.packCost ? match.supplierCase.packCost : unitCost * packSize;
  return {
    key: newKey(), kind: match.kind, productId: inventoryIdOf(match),
    sellingUnitId: match.kind === 'PACK' ? product.sellingUnitId || null : null,
    name: product.name, sku: product.sku, barcode: product.barcode, tracked: product.trackInventory !== false,
    packSize, packLabel: match.kind === 'PACK' ? product.packageName || 'Pack' : null,
    cases: packSize > 1 ? '1' : '', units: packSize > 1 ? '' : '1',
    cost: costText(caseCost), previousUnitCost: unitCost > 0 ? round4(unitCost) : null,
    price: '', freeConfirmed: false,
    recorded: product.trackInventory === false ? null : { quantity: product.baseStockQuantity ?? product.stockQuantity, lowStockAlert: product.lowStockAlert ?? 0, version: product.stockVersion },
    openExceptionId: match.openExceptionId ?? null,
    shelfCount: '', countKey: newKey(), countSaved: false, countError: '', ordered: null,
  };
}

export function newItemLine(input: { code: string; name: string; sku: string; price: string; cost: string; units: string }, newKey: () => string): DeliveryLine {
  return { key: newKey(), kind: 'NEW', productId: null, sellingUnitId: null, name: input.name.trim(), sku: input.sku.trim() || input.code,
    barcode: input.code, tracked: true, packSize: 1, packLabel: null, cases: '', units: input.units.trim() || '1', cost: input.cost.trim(),
    previousUnitCost: null, price: input.price.trim(), freeConfirmed: false, recorded: null, openExceptionId: null,
    shelfCount: '', countKey: newKey(), countSaved: false, countError: '', ordered: null };
}

/**
 * Adds a scanned item. A second scan of the same case, pack or single adds one
 * more of it; a different size of an item already listed adds its singles to
 * that line (the import takes one line per item).
 */
export function addScan(lines: DeliveryLine[], incoming: DeliveryLine): { lines: DeliveryLine[]; key: string; note: string } {
  const index = incoming.productId ? lines.findIndex(line => line.productId === incoming.productId) : -1;
  if (index < 0) return { lines: [incoming, ...lines], key: incoming.key, note: `Added ${incoming.name}` };
  const line = lines[index];
  const sameSize = incoming.packSize === line.packSize && incoming.sellingUnitId === line.sellingUnitId;
  const bumped: DeliveryLine = sameSize
    ? line.packSize > 1 ? { ...line, cases: String(whole(line.cases) + 1) } : { ...line, units: String(whole(line.units) + 1) }
    : { ...line, units: String(whole(line.units) + incoming.packSize) };
  // A scan reads the item fresh; keep the older record only while a typed count depends on it.
  const updated: DeliveryLine = { ...bumped, barcode: line.barcode ?? incoming.barcode, tracked: incoming.tracked,
    previousUnitCost: line.previousUnitCost ?? incoming.previousUnitCost, openExceptionId: incoming.openExceptionId,
    recorded: line.shelfCount.trim() && !line.countSaved ? line.recorded ?? incoming.recorded : incoming.recorded };
  const note = sameSize ? `${line.name}: ${lineUnits(updated)} units` : `${line.name}: added ${incoming.packSize} single${incoming.packSize === 1 ? '' : 's'}, ${lineUnits(updated)} units in all`;
  return { lines: lines.map((current, at) => at === index ? updated : current), key: line.key, note };
}

/** Lines for what an order still expects; items already listed just learn their expected quantity. */
export function withOrderLines(lines: DeliveryLine[], items: OrderItemInput[], newKey: () => string): DeliveryLine[] {
  const expected = items.filter(item => item.outstanding > 0);
  const listed = lines.map(line => ({ ...line, ordered: expected.find(item => item.productId === line.productId)?.outstanding ?? null }));
  const added = expected.filter(item => !lines.some(line => line.productId === item.productId)).map((item): DeliveryLine => {
    const packSize = Math.max(1, item.packSize || 1);
    const unitCost = Number(item.cost) || 0;
    return { key: newKey(), kind: 'PRODUCT', productId: item.productId, sellingUnitId: null, name: item.productName, sku: item.sku, barcode: null,
      tracked: true, packSize, packLabel: null, cases: '', units: '', cost: costText(item.packCost ? Number(item.packCost) : unitCost * packSize),
      previousUnitCost: null, price: '', freeConfirmed: false, recorded: null, openExceptionId: null,
      shelfCount: '', countKey: newKey(), countSaved: false, countError: '', ordered: item.outstanding };
  });
  return [...listed, ...added];
}

/** Unlinking the order drops the expected lines nothing was entered for. */
export const withoutOrder = (lines: DeliveryLine[]) => lines.filter(line => line.ordered === null || lineUnits(line) > 0).map(line => ({ ...line, ordered: null }));

/** Lines still at zero get what the order expects; entered quantities are kept. */
export const fillAsOrdered = (lines: DeliveryLine[]) => lines.map(line => {
  if (line.ordered === null || line.ordered <= 0 || lineUnits(line) > 0) return line;
  if (line.packSize === 1) return { ...line, units: String(line.ordered) };
  const cases = Math.floor(line.ordered / line.packSize), rest = line.ordered % line.packSize;
  return { ...line, cases: cases ? String(cases) : '', units: rest ? String(rest) : '' };
});

/** The optional shelf count is offered for low items without an open exception. */
export const shelfCountOffered = (line: DeliveryLine) => !!line.recorded && !line.openExceptionId && line.productId !== null &&
  (line.recorded.quantity <= line.recorded.lowStockAlert || line.shelfCount.trim() !== '' || line.countSaved);

/** A typed shelf count that still has to be posted (before the receipt). */
export function pendingShelfCount(line: DeliveryLine) {
  if (!line.recorded || line.openExceptionId || !line.productId || line.countSaved || line.shelfCount.trim() === '' || !wholeText(line.shelfCount)) return null;
  const counted = Number(line.shelfCount.trim());
  return { productId: line.productId, recorded: line.recorded, counted, change: counted - line.recorded.quantity, expectedVersion: line.recorded.version, idempotencyKey: line.countKey };
}

/** What stops a line from being received. Lines with no quantity are left out, not flagged. */
export function lineIssues(line: DeliveryLine, order: { orderNumber: string } | null): string[] {
  const issues: string[] = [];
  if (!wholeText(line.cases) || !wholeText(line.units)) issues.push('Quantities are whole numbers.');
  if (!wholeText(line.shelfCount)) issues.push('The shelf count is a whole number.');
  const units = lineUnits(line);
  if (!units) return issues;
  if (!line.tracked) issues.push('Stock is not counted for this item, so a delivery cannot add to it.');
  const unitCost = unitCostOf(line);
  if (unitCost === null) issues.push('Enter the cost.');
  else if (unitCost === 0 && !line.freeConfirmed) issues.push('Enter the cost, or confirm these came free.');
  if (line.kind === 'NEW') {
    if (!line.name.trim()) issues.push('Enter a name.');
    if (!line.sku.trim()) issues.push('Enter a SKU.');
    if (!((amount(line.price) ?? 0) > 0)) issues.push('Enter the selling price.');
  }
  if (order) {
    if (line.kind === 'NEW') issues.push(`New items cannot be received on order ${order.orderNumber}. Choose "No order" to receive them.`);
    else if (line.ordered === null) issues.push(`Not on order ${order.orderNumber}. Remove it, or choose "No order".`);
    else if (units > line.ordered) issues.push(`Only ${line.ordered} left on order ${order.orderNumber}.`);
  }
  return issues;
}

/** Items for POST /products/imports/receipt/preview. */
export const receiptItems = (lines: DeliveryLine[]) => lines.filter(line => lineUnits(line) > 0).map(line => {
  const unitCost = unitCostOf(line) ?? 0;
  return {
    matchedProductId: line.productId, name: line.name.trim(), packSize: line.packSize,
    // Whole store packs (cartons) go on the shelf unopened.
    ...(line.sellingUnitId ? { sellingUnitId: line.sellingUnitId, receivedPackageQuantity: whole(line.cases) } : {}),
    unitQuantity: lineUnits(line), unitCost, zeroCostConfirmed: unitCost === 0 && line.freeConfirmed,
    ...(line.kind === 'NEW' ? { price: amount(line.price) ?? undefined, sku: line.sku.trim(), barcode: line.barcode } : {}),
  };
});

/** A saved draft from this browser, or null when it is missing or unreadable. */
export function parseDraft(text: string | null): DeliveryDraft | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as DeliveryDraft & { version?: number };
    if (value.version !== 1 || !Array.isArray(value.lines) || !value.invoice || value.lines.some(line => !line || typeof line.key !== 'string' || typeof line.packSize !== 'number')) return null;
    return { supplier: value.supplier ?? null, order: value.order ?? null, lines: value.lines, invoice: { ...emptyDraft().invoice, ...value.invoice } };
  } catch { return null; }
}
export const serializeDraft = (draft: DeliveryDraft) => JSON.stringify({ version: 1, ...draft });
