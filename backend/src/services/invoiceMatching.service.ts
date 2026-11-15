import { Prisma } from '@prisma/client';
import type prisma from '../config/database';
import { barcodeVariants } from '../utils/barcode';
import { inferCatalogAgeRestriction } from './catalogAgeRestriction';

/**
 * Matching a supplier invoice's lines to this store's products.
 *
 * Reading (invoiceReading.service.ts) turns the photos into lines as printed;
 * this file decides, per line, which product it is and how many units arrived:
 *   SURE    the barcode, the supplier's item number, or a line an owner or
 *           manager confirmed on an earlier invoice from this supplier;
 *   CHECK   the closest product, which a person must confirm;
 *   NEW     nothing close: add it as a new item, pick one, or skip it;
 *   CREDIT  a return or credit line, never received.
 * An AI pick is only ever a suggestion (CHECK), never SURE. Nothing here writes
 * stock: receiving goes through the reviewed receipt import.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type Tier = 'SURE' | 'CHECK' | 'NEW' | 'CREDIT';
/** Where a line's case size came from; SET = typed by a person. */
export type UnitsSource = 'LEARNED' | 'PRINTED' | 'SUPPLIER' | 'PACK' | 'SET' | 'ONE';
export type InvoiceUnit = 'CASE' | 'EACH' | 'UNKNOWN';

/** One invoice line as printed (from the reading). */
export interface ReadLine {
  page: number;
  description: string;
  itemCode: string | null;
  upc: string | null;
  quantity: number | null;
  unit: InvoiceUnit;
  printedUnitsPerCase: number | null;
  unitPrice: number | null;
  lineTotal: number | null;
  changedByHand: boolean;
}

export interface LineProduct {
  productId: string;
  sellingUnitId: string | null;
  name: string;
  sku: string;
  /** Units in the matched pack (a carton of 10); null for the item itself. */
  unitsPerPackage: number | null;
}
export interface LineCandidate extends LineProduct { score: number }

export interface NewItem {
  name: string;
  price: number | null;
  categoryId: string | null;
  barcode: string | null;
  minimumAge: number | null;
  ebtEligible: boolean;
  isTaxable: boolean;
}

export interface Suggestion { name: string; categoryId: string | null; minimumAge: number | null; ageCheck: boolean }

/** One line of a delivery invoice under review: what was read, how it matched, and the decision. */
export interface InvoiceLine extends ReadLine {
  index: number;
  normalized: string;
  tier: Tier;
  reason: string;
  candidates: LineCandidate[];
  suggestion: Suggestion | null;
  product: LineProduct | null;
  newItem: NewItem | null;
  skip: boolean;
  /** SURE lines start confirmed; the others wait for an owner or manager. */
  confirmed: boolean;
  /** Changed by a person: kept as it is when the supplier changes and lines match again. */
  touched: boolean;
  /** Received, in the invoice's unit (cases, or single items). */
  receivedQuantity: number;
  unitsPerCase: number;
  unitsSource: UnitsSource;
  checkUnits: boolean;
  /** Cost of one invoice unit (one case, or one item). */
  caseCost: number | null;
}

/* ------------------------------------------------------------------ */
/* Text helpers (pure; unit tested)                                    */
/* ------------------------------------------------------------------ */

const plainNumber = (value: string) => String(Number(value));
/** "1/2", "1/4": a part of one gallon or pound, not a pack of items. */
const isFraction = (a: string, b: string) => Number(a) === 1 && [2, 3, 4, 8].includes(Number(b));

// Supplier abbreviations that are safe to spell out on both sides.
const WORDS: Record<string, string> = {
  cn: 'can', cns: 'can', btl: 'bottle', btls: 'bottle', bt: 'bottle', ctn: 'carton', ctns: 'carton', crtn: 'carton',
  bx: 'box', mtn: 'mountain', dt: 'diet', orig: 'original', reg: 'regular', choc: 'chocolate', chs: 'cheese', chz: 'cheese',
  crm: 'cream', pnt: 'peanut', bttr: 'butter', strwb: 'strawberry', strw: 'strawberry', rasp: 'raspberry', van: 'vanilla',
  sf: 'sugar free', zro: 'zero', cig: 'cigarette', cigs: 'cigarette', ltd: 'limited',
};

/**
 * One form for a line of supplier text, so "COKE CLASSIC 12Z CN 24CT" and
 * "Coke Classic 12 oz Can 24 ct" read the same: lower case, no punctuation,
 * sizes as 12oz / 2l / 750ml / 1gal / 5lb / 200g, counts as 24pk, pack
 * fractions as 2x12, common abbreviations spelled out, simple plurals dropped.
 */
export function normalizeInvoiceText(text: string): string {
  let value = (text || '').slice(0, 500).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  value = value.replace(/['’`]/g, '').replace(/&/g, ' and ').replace(/\bw\//g, ' with ');
  // Pack/size: "6/32OZ" is six 32 oz items, "1/2 GAL" half a gallon; a bare "2/12" is two twelves.
  value = value.replace(/\b(\d+)\s*\/\s*(\d+(?:\.\d+)?)\s*(?=(?:fl\.?\s*)?(?:oz|ozs|ounces?|z|ml|l|lt|ltr|gal|gallons?|lb|lbs|g)\b)/g, (_, a, b) =>
    Number(a) >= 2 ? ` ${Number(a)}pk ${b}` : isFraction(a, b) ? ` ${plainNumber(String(Number(a) / Number(b)))}` : ` ${b}`);
  value = value.replace(/(\d+)\s*\/\s*(\d+)/g, (_, a, b) => ` ${Number(a)}x${Number(b)} `);
  value = value.replace(/(\d+(?:\.\d+)?)\s*(?:fl\.?\s*)?(?:oz|ozs|ounces?|z)\b/g, (_, n) => ` ${plainNumber(n)}oz `);
  value = value.replace(/(\d+(?:\.\d+)?)\s*(?:ml|mls|milliliters?)\b/g, (_, n) => ` ${plainNumber(n)}ml `);
  value = value.replace(/(\d+(?:\.\d+)?)\s*(?:l|lt|ltr|ltrs|liters?|litres?)\b/g, (_, n) => ` ${plainNumber(n)}l `);
  value = value.replace(/(\d+(?:\.\d+)?)\s*(?:gal|gals|gallons?)\b/g, (_, n) => ` ${plainNumber(n)}gal `);
  value = value.replace(/(\d+(?:\.\d+)?)\s*(?:lb|lbs|pounds?)\b/g, (_, n) => ` ${plainNumber(n)}lb `);
  value = value.replace(/(\d+(?:\.\d+)?)\s*(?:g|gr|grams?)\b/g, (_, n) => ` ${plainNumber(n)}g `);
  value = value.replace(/(\d+)\s*(?:pk|pks|pack|packs|ct|cnt|count|pc|pcs)\b/g, (_, n) => ` ${Number(n)}pk `);
  value = value.replace(/[^a-z0-9. ]+/g, ' ').replace(/(^|\s)\.+|\.+(\s|$)/g, ' ');
  const tokens: string[] = [];
  for (const raw of value.split(/\s+/)) {
    if (!raw) continue;
    const word = WORDS[raw] ?? (raw.length > 3 && raw.endsWith('s') && !raw.endsWith('ss') && /^[a-z]+$/.test(raw) ? raw.slice(0, -1) : raw);
    tokens.push(...word.split(' '));
  }
  return tokens.join(' ');
}

const SIZE = /^\d+(?:\.\d+)?(?:oz|ml|l|gal|lb|g)$/;
const PACK = /^\d+pk$/;
const FRACTION = /^\d+x\d+$/;
const STOP = new Set(['and', 'the', 'of', 'with', 'a', 'cs', 'case', 'ea', 'each', 'pk', 'pack', 'ct', 'unit', 'item', 'new', 'x']);

/** The words that say what the item is (no sizes, counts, codes or filler). */
export function contentTokens(normalized: string): string[] {
  return normalized.split(' ').filter(token => token && !STOP.has(token) && !SIZE.test(token) && !PACK.test(token)
    && !FRACTION.test(token) && !/^\d+(?:\.\d+)?$/.test(token));
}

const sizeTokens = (normalized: string) => new Set(normalized.split(' ').filter(token => SIZE.test(token)));
const packTokens = (normalized: string) => new Set(normalized.split(' ').filter(token => PACK.test(token)));

function trigrams(text: string): Map<string, number> {
  const grams = new Map<string, number>();
  const padded = `  ${text} `;
  for (let i = 0; i < padded.length - 2; i++) {
    const gram = padded.slice(i, i + 3);
    grams.set(gram, (grams.get(gram) || 0) + 1);
  }
  return grams;
}

function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  const left = trigrams(a), right = trigrams(b);
  let shared = 0, total = 0;
  for (const [gram, count] of left) { shared += Math.min(count, right.get(gram) || 0); total += count; }
  for (const count of right.values()) total += count;
  return total ? (2 * shared) / total : 0;
}

/** Overlap of two word lists; a word that starts the other (CHOC / chocolate) counts most of the way. */
function wordOverlap(left: string[], right: string[]): number {
  if (!left.length || !right.length) return 0;
  const remaining = [...new Set(right)];
  let matched = 0;
  for (const word of new Set(left)) {
    let best = -1, credit = 0;
    remaining.forEach((other, index) => {
      const value = other === word ? 1 : (word.length >= 3 && other.length >= 3 && (other.startsWith(word) || word.startsWith(other))) ? 0.8 : 0;
      if (value > credit) { credit = value; best = index; }
    });
    if (best >= 0) { matched += credit; remaining.splice(best, 1); }
  }
  const leftSize = new Set(left).size, rightSize = new Set(right).size;
  return matched / (leftSize + rightSize - matched);
}

/**
 * How alike a line of supplier text and a product name are, 0 to 1. Words
 * count most, then letter groups (for spellings that differ). A different
 * printed size halves the score: 12 oz and 20 oz bottles are different items.
 */
export function similarity(invoiceText: string, productText: string): number {
  const a = normalizeInvoiceText(invoiceText), b = normalizeInvoiceText(productText);
  const wordsA = contentTokens(a), wordsB = contentTokens(b);
  if (!wordsA.length || !wordsB.length) return 0;
  let score = 0.65 * wordOverlap(wordsA, wordsB) + 0.35 * dice(wordsA.join(' '), wordsB.join(' '));
  const sizesA = sizeTokens(a), sizesB = sizeTokens(b);
  if (sizesA.size && sizesB.size) score *= [...sizesA].some(size => sizesB.has(size)) ? 1.15 : 0.5;
  const packsA = packTokens(a), packsB = packTokens(b);
  if (packsA.size && packsB.size && ![...packsA].some(pack => packsB.has(pack))) score *= 0.8;
  return Math.max(0, Math.min(1, Math.round(score * 1000) / 1000));
}

/**
 * Single items in one case when the text says so: "2/12" = 24, "4/6PK" = 24,
 * "24CT" = 24, "12-12OZ" = 12, "6/32OZ" = 6 (six 32 oz items). A printed
 * number from the reading wins. "1/2 GAL" is half a gallon, not a pack.
 */
export function unitsPerCase(text: string, printed?: number | null): number | null {
  if (printed && Number.isFinite(printed) && printed >= 1) return Math.min(100000, Math.round(printed));
  const value = (text || '').toLowerCase();
  const fraction = /(\d+)\s*\/\s*(\d+(?:\.\d+)?)\s*([a-z]*)/.exec(value);
  if (fraction) {
    const a = Number(fraction[1]), b = Number(fraction[2]), after = fraction[3];
    const measure = /^(?:fl|oz|ozs|z|gal|lb|lbs|l|lt|ltr|ml|g|in|ft)$/.test(after);
    if (measure) { if (a >= 2 && a <= 100000) return a; }
    else if (Number.isInteger(b) && b >= 2 && (a >= 2 || b >= 3) && a * b <= 100000) return a * b;
  }
  const counted = /(\d+)\s*(?:pk|pack|ct|cnt|count)\b/.exec(value);
  if (counted && Number(counted[1]) >= 1) return Math.min(100000, Number(counted[1]));
  const sized = /\b(\d+)\s*[-x]\s*\d+(?:\.\d+)?\s*(?:oz|z|ml|l|ltr)\b/.exec(value);
  if (sized && Number(sized[1]) >= 2) return Math.min(100000, Number(sized[1]));
  return null;
}

const SUFFIXES = new Set(['inc', 'incorporated', 'llc', 'llp', 'co', 'corp', 'corporation', 'company', 'ltd', 'limited', 'the', 'lp', 'plc']);

/** "The Coca-Cola Bottling Co., Inc." -> "coca cola bottling". */
export function normalizeSupplierName(name: string): string {
  return (name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]/g, '').replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ').split(' ').filter(word => word && !SUFFIXES.has(word)).join(' ');
}

/** The store supplier this printed vendor name is, if one clearly is. */
export function pickSupplier<T extends { id: string; name: string }>(vendorName: string | null, suppliers: T[]): T | null {
  const wanted = normalizeSupplierName(vendorName || '');
  if (!wanted) return null;
  const named = suppliers.map(supplier => ({ supplier, name: normalizeSupplierName(supplier.name) })).filter(entry => entry.name);
  const exact = named.find(entry => entry.name === wanted);
  if (exact) return exact.supplier;
  const prefix = named.filter(entry => Math.min(entry.name.length, wanted.length) >= 5 && (entry.name.startsWith(wanted + ' ') || wanted.startsWith(entry.name + ' ')));
  if (prefix.length === 1) return prefix[0].supplier;
  const scored = named.map(entry => ({ ...entry, score: wordOverlap(wanted.split(' '), entry.name.split(' ')) })).filter(entry => entry.score >= 0.75)
    .sort((a, b) => b.score - a.score);
  return scored.length && (scored.length === 1 || scored[0].score > scored[1].score) ? scored[0].supplier : null;
}

/** A supplier item number in one form: no spaces or dashes, upper case, no leading zeros. */
export function normalizeItemCode(code: string | null | undefined): string | null {
  const value = (code || '').toUpperCase().replace(/[\s-]/g, '').replace(/^0+(?=\d)/, '');
  return value && value.length <= 64 ? value : null;
}

function upcCheckDigit(digits11: string): string {
  let sum = 0;
  for (let i = 0; i < 11; i++) sum += Number(digits11[i]) * (i % 2 === 0 ? 3 : 1);
  return String((10 - (sum % 10)) % 10);
}

/** Barcode forms to look up for a printed UPC; invoices often leave out the check digit or the leading 0. */
export function printedUpcVariants(upc: string | null | undefined): string[] {
  const digits = (upc || '').replace(/[^0-9]/g, '');
  if (digits.length < 6 || digits.length > 14) return [];
  const forms = new Set<string>(barcodeVariants(digits));
  if (digits.length === 11) barcodeVariants(digits + upcCheckDigit(digits)).forEach(form => forms.add(form));
  if (digits.length === 10) barcodeVariants('0' + digits + upcCheckDigit('0' + digits)).forEach(form => forms.add(form));
  return [...forms];
}

/** "COKE CLASSIC 12Z CN" -> "Coke Classic 12 oz Can": a starting name for a new item. */
export function shelfName(description: string): string {
  // Case counts ("24CT", "2/12") describe the delivery, not the item on the shelf.
  const words = normalizeInvoiceText(description).split(' ').filter(word => word && !FRACTION.test(word) && !PACK.test(word) && !STOP.has(word));
  const named = words.map(word => {
    const size = /^(\d+(?:\.\d+)?)(oz|ml|l|gal|lb|g)$/.exec(word);
    if (size) return `${size[1]} ${size[2] === 'l' ? 'L' : size[2]}`;
    return word.charAt(0).toUpperCase() + word.slice(1);
  });
  return named.join(' ').slice(0, 250) || description.trim().slice(0, 250);
}

const roundTo = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

/** Base units received on a line, and its cost per base unit. */
export function lineUnits(line: Pick<InvoiceLine, 'receivedQuantity' | 'unitsPerCase' | 'caseCost'>) {
  const units = Math.max(0, Math.round((line.receivedQuantity || 0) * (line.unitsPerCase || 1)));
  const unitCost = line.caseCost === null || !(line.unitsPerCase >= 1) ? null : roundTo(line.caseCost / line.unitsPerCase, 4);
  return { units, unitCost };
}

/** Cost of one invoice unit: the printed price, else the line total over the quantity. */
export function caseCostOf(line: Pick<ReadLine, 'unitPrice' | 'lineTotal' | 'quantity'>): number | null {
  if (line.unitPrice !== null && line.unitPrice >= 0) return roundTo(line.unitPrice, 4);
  if (line.lineTotal !== null && line.quantity && line.quantity > 0) return roundTo(line.lineTotal / line.quantity, 4);
  return null;
}

/* ------------------------------------------------------------------ */
/* Matching against the store                                          */
/* ------------------------------------------------------------------ */

export interface PickRequest { line: number; description: string; itemCode: string | null; candidates: { key: number; name: string }[] }
export interface PickResult { line: number; candidate: number; confidence: 'high' | 'medium' | 'low'; name: string; category: string; minimumAge: number }
/** Chooses among a line's closest products, or suggests a new item. Returns null when unavailable. */
export type Picker = (requests: PickRequest[], categories: string[]) => Promise<PickResult[] | null>;

const productSelect = { id: true, name: true, sku: true, size: true, isActive: true, trackInventory: true } as const;
type ProductRow = Prisma.ProductGetPayload<{ select: typeof productSelect }>;

const asProduct = (product: { id: string; name: string; sku: string }, pack?: { id: string; name: string; unitsPerPackage: number } | null): LineProduct => ({
  productId: product.id, sellingUnitId: pack?.id ?? null, name: pack ? pack.name : product.name, sku: product.sku, unitsPerPackage: pack?.unitsPerPackage ?? null,
});

const receivable = (locationId: string): Prisma.ProductWhereInput => ({ locationId, isActive: true, trackInventory: true, sku: { not: 'MISC-001' } });

interface SureMatch { product: LineProduct; reason: string; unitsPerCase: number | null; unitsSource: UnitsSource | null }

/** The closest products to one line (with packs), best first. */
export async function closestProducts(db: Db, locationId: string, description: string, limit = 5): Promise<LineCandidate[]> {
  const words = contentTokens(normalizeInvoiceText(description)).filter(word => word.length >= 3)
    .sort((a, b) => b.length - a.length).slice(0, 4);
  if (!words.length) return [];
  const [products, packs] = await Promise.all([
    db.product.findMany({ where: { ...receivable(locationId), OR: words.flatMap(word => [
      { name: { contains: word, mode: 'insensitive' as const } }, { brand: { contains: word, mode: 'insensitive' as const } }]) },
    select: productSelect, take: 200, orderBy: { id: 'asc' } }),
    db.productSellingUnit.findMany({ where: { locationId, isActive: true, product: receivable(locationId),
      OR: words.map(word => ({ name: { contains: word, mode: 'insensitive' as const } })) },
    select: { id: true, name: true, unitsPerPackage: true, product: { select: productSelect } }, take: 100, orderBy: { id: 'asc' } }),
  ]);
  const scored: LineCandidate[] = [
    ...products.map(product => ({ ...asProduct(product), score: similarity(description, withSize(product)) })),
    ...packs.map(pack => ({ ...asProduct(pack.product, pack), score: similarity(description, pack.name) })),
  ];
  return scored.filter(candidate => candidate.score >= 0.15)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
}

const withSize = (product: Pick<ProductRow, 'name' | 'size'>) =>
  product.size && !normalizeInvoiceText(product.name).includes(normalizeInvoiceText(product.size)) ? `${product.name} ${product.size}` : product.name;

/** The learned matches, item numbers and barcodes that settle lines for sure. */
async function sureMatches(db: Db, locationId: string, supplierId: string | null, lines: ReadLine[]): Promise<Map<number, SureMatch>> {
  const found = new Map<number, SureMatch>();
  const codes = [...new Set(lines.map(line => normalizeItemCode(line.itemCode)).filter((code): code is string => !!code))];
  const texts = [...new Set(lines.map(line => normalizeInvoiceText(line.description)).filter(Boolean))];
  const upcs = lines.map(line => printedUpcVariants(line.upc));
  const allUpcs = [...new Set(upcs.flat())];

  const [learned, supplierItems, byBarcode, byPack, byCase] = await Promise.all([
    supplierId ? db.invoiceItemMatch.findMany({ where: { supplierId, locationId, OR: [{ itemCode: { in: codes } }, { normalizedText: { in: texts } }] },
      orderBy: [{ lastConfirmedAt: 'desc' }, { id: 'asc' }] }) : Promise.resolve([]),
    supplierId && codes.length ? db.productSupplier.findMany({ where: { supplierId, supplierSku: { not: null }, product: receivable(locationId) },
      select: { supplierSku: true, packSize: true, product: { select: productSelect } }, orderBy: { id: 'asc' } }) : Promise.resolve([]),
    allUpcs.length ? db.product.findMany({ where: { ...receivable(locationId), barcode: { in: allUpcs } }, select: { ...productSelect, barcode: true }, orderBy: { id: 'asc' } }) : Promise.resolve([]),
    allUpcs.length ? db.productSellingUnit.findMany({ where: { locationId, isActive: true, barcode: { in: allUpcs }, product: receivable(locationId) },
      select: { id: true, name: true, barcode: true, unitsPerPackage: true, product: { select: productSelect } }, orderBy: { id: 'asc' } }) : Promise.resolve([]),
    allUpcs.length ? db.productSupplier.findMany({ where: { packBarcode: { in: allUpcs }, product: receivable(locationId), supplier: { locationId } },
      select: { packBarcode: true, packSize: true, supplierId: true, product: { select: productSelect } }, orderBy: { id: 'asc' } }) : Promise.resolve([]),
  ]);

  // Learned rows point at items and packs that may since have been archived.
  const learnedProducts = learned.length ? await db.product.findMany({ where: { ...receivable(locationId), id: { in: learned.map(row => row.productId) } }, select: productSelect }) : [];
  const learnedPacks = learned.some(row => row.sellingUnitId) ? await db.productSellingUnit.findMany({ where: { locationId, isActive: true,
    id: { in: learned.flatMap(row => row.sellingUnitId ? [row.sellingUnitId] : []) } }, select: { id: true, name: true, unitsPerPackage: true, productId: true } }) : [];

  lines.forEach((line, index) => {
    const code = normalizeItemCode(line.itemCode);
    const text = normalizeInvoiceText(line.description);
    // 1. Confirmed on an earlier invoice from this supplier (item number first: the text can change).
    for (const row of [...learned.filter(entry => code && entry.itemCode === code), ...learned.filter(entry => entry.normalizedText === text)]) {
      const product = learnedProducts.find(candidate => candidate.id === row.productId);
      const pack = row.sellingUnitId ? learnedPacks.find(candidate => candidate.id === row.sellingUnitId && candidate.productId === row.productId) : null;
      if (!product || (row.sellingUnitId && !pack)) continue;
      found.set(index, { product: asProduct(product, pack), reason: 'You confirmed this item on an earlier invoice',
        unitsPerCase: pack ? pack.unitsPerPackage : row.unitsPerCase, unitsSource: pack ? 'PACK' : row.unitsPerCase ? 'LEARNED' : null });
      return;
    }
    // 2. The supplier's item number, recorded on the item.
    const item = code ? supplierItems.find(entry => normalizeItemCode(entry.supplierSku) === code) : undefined;
    if (item) {
      found.set(index, { product: asProduct(item.product), reason: `Supplier item number ${line.itemCode}`,
        unitsPerCase: item.packSize > 1 ? item.packSize : null, unitsSource: item.packSize > 1 ? 'SUPPLIER' : null });
      return;
    }
    // 3. The printed barcode: the item, one of its packs, or a supplier's case.
    const forms = upcs[index];
    if (!forms.length) return;
    const pack = byPack.find(entry => forms.includes(entry.barcode));
    if (pack) {
      found.set(index, { product: asProduct(pack.product, pack), reason: `Barcode ${line.upc}`, unitsPerCase: pack.unitsPerPackage, unitsSource: 'PACK' });
      return;
    }
    const supplierCase = byCase.find(entry => entry.packBarcode && forms.includes(entry.packBarcode) && (!supplierId || entry.supplierId === supplierId))
      ?? byCase.find(entry => entry.packBarcode && forms.includes(entry.packBarcode));
    if (supplierCase) {
      found.set(index, { product: asProduct(supplierCase.product), reason: `Case barcode ${line.upc}`,
        unitsPerCase: supplierCase.packSize > 1 ? supplierCase.packSize : null, unitsSource: supplierCase.packSize > 1 ? 'SUPPLIER' : null });
      return;
    }
    const product = byBarcode.find(entry => entry.barcode && forms.includes(entry.barcode));
    if (product) found.set(index, { product: asProduct(product), reason: `Barcode ${line.upc}`, unitsPerCase: null, unitsSource: null });
  });
  return found;
}

export interface MatchInput { locationId: string; supplierId: string | null; lines: ReadLine[] }
export interface MatchOptions { pick?: Picker }

/**
 * Match every line of an invoice. Lines a person already changed (`touched`)
 * can be passed in `keep` and come back unchanged, so choosing a different
 * supplier re-matches only what nobody decided yet.
 */
export async function matchInvoiceLines(db: Db, input: MatchInput, options: MatchOptions = {}, keep: InvoiceLine[] = []): Promise<InvoiceLine[]> {
  const { locationId, supplierId, lines } = input;
  const kept = new Map(keep.filter(line => line.touched).map(line => [line.index, line]));
  const pending = lines.map((line, index) => ({ line, index })).filter(({ index }) => !kept.has(index));
  const sure = await sureMatches(db, locationId, supplierId, pending.map(entry => entry.line));
  const sureByIndex = new Map(pending.flatMap(({ index }, position) => sure.has(position) ? [[index, sure.get(position)!] as const] : []));

  const categories = await db.category.findMany({ where: { locationId, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  const open = pending.filter(({ line, index }) => !sureByIndex.has(index) && !(line.quantity !== null && line.quantity < 0));
  const candidates = new Map<number, LineCandidate[]>();
  for (const { line, index } of open) candidates.set(index, await closestProducts(db, locationId, line.description));

  // Supplier packs give the case size of an item matched by name or barcode.
  const matchedIds = [...new Set([...sureByIndex.values()].map(match => match.product.productId).concat(open.flatMap(({ index }) => candidates.get(index)!.map(c => c.productId))))];
  const supplierPacks = supplierId && matchedIds.length ? await db.productSupplier.findMany({ where: { supplierId, productId: { in: matchedIds } }, select: { productId: true, packSize: true } }) : [];

  let picks: Map<number, PickResult> | null = null;
  if (options.pick && open.length) {
    const requests = open.map(({ line, index }) => ({ line: index, description: line.description, itemCode: line.itemCode,
      candidates: candidates.get(index)!.map((candidate, position) => ({ key: position + 1, name: candidate.name })) }));
    const results = await options.pick(requests, categories.map(category => category.name)).catch(() => null);
    if (results) picks = new Map(results.filter(result => candidates.has(result.line)).map(result => [result.line, result]));
  }

  const categoryId = (name: string | null | undefined) => {
    const wanted = (name || '').trim().toLowerCase();
    return wanted ? categories.find(category => category.name.trim().toLowerCase() === wanted)?.id ?? null : null;
  };

  return lines.map((line, index) => {
    if (kept.has(index)) return kept.get(index)!;
    const base = { ...line, index, normalized: normalizeInvoiceText(line.description), newItem: null, touched: false,
      caseCost: caseCostOf(line), receivedQuantity: line.quantity !== null && line.quantity > 0 ? line.quantity : 0 };
    if (line.quantity !== null && line.quantity < 0) {
      return { ...base, tier: 'CREDIT' as const, reason: 'A return or credit: nothing to receive', candidates: [], suggestion: null, product: null,
        skip: true, confirmed: true, unitsPerCase: 1, unitsSource: 'ONE' as const, checkUnits: false, receivedQuantity: 0 };
    }
    const match = sureByIndex.get(index);
    const lineCandidates = candidates.get(index) ?? [];
    const pick = picks?.get(index);
    let tier: Tier, reason: string, product: LineProduct | null = null, suggestion: Suggestion | null = null;
    if (match) {
      tier = 'SURE'; reason = match.reason; product = match.product;
    } else {
      const picked = pick && pick.candidate >= 1 && pick.confidence !== 'low' ? lineCandidates[pick.candidate - 1] : undefined;
      const best = lineCandidates[0];
      if (picked) {
        tier = 'CHECK'; reason = 'Looks like this item'; product = stripScore(picked);
      } else if (!pick && best && best.score >= 0.5) {
        tier = 'CHECK'; reason = 'The closest name'; product = stripScore(best);
      } else {
        tier = 'NEW'; reason = lineCandidates.length ? 'Not sure which item this is' : 'Not in your items yet';
      }
      const name = pick?.name?.trim() ? pick.name.trim().slice(0, 250) : shelfName(line.description);
      const suggestedCategory = categoryId(pick?.category);
      const inferred = inferCatalogAgeRestriction({ name: `${name} ${line.description}`,
        category: suggestedCategory ? categories.find(category => category.id === suggestedCategory)!.name : null });
      const age = pick && [18, 21].includes(pick.minimumAge) ? pick.minimumAge : inferred.minimumAge;
      suggestion = { name, categoryId: suggestedCategory, minimumAge: age ?? null, ageCheck: !age && inferred.status !== 'unknown' };
    }
    const units = caseSize(line, match, product, supplierPacks);
    return { ...base, tier, reason, candidates: lineCandidates, suggestion, product, skip: false, confirmed: tier === 'SURE', ...units };
  });
}

const stripScore = ({ score: _score, ...product }: LineCandidate): LineProduct => product;

/**
 * After a person picks a different supplier: lines nobody decided yet are
 * looked up again with that supplier's item numbers and confirmed matches.
 * A line that was sure only for the previous supplier keeps its item as a
 * suggestion to confirm.
 */
export async function rematchSupplier(db: Db, locationId: string, supplierId: string | null, lines: InvoiceLine[]): Promise<InvoiceLine[]> {
  const open = lines.filter(line => !line.touched && line.tier !== 'CREDIT');
  const sure = await sureMatches(db, locationId, supplierId, open);
  const ids = [...new Set([...sure.values()].map(match => match.product.productId))];
  const supplierPacks = supplierId && ids.length ? await db.productSupplier.findMany({ where: { supplierId, productId: { in: ids } }, select: { productId: true, packSize: true } }) : [];
  return lines.map(line => {
    const position = open.indexOf(line);
    if (position < 0) return line;
    const match = sure.get(position);
    if (match) return { ...line, tier: 'SURE' as const, reason: match.reason, product: match.product, confirmed: true, skip: false, newItem: null,
      ...caseSize(line, match, match.product, supplierPacks) };
    if (line.tier !== 'SURE') return line;
    return { ...line, tier: line.product ? 'CHECK' as const : 'NEW' as const, reason: line.product ? 'Matched for the other supplier' : line.reason, confirmed: false };
  });
}

/** Units per invoice unit: learned, printed, the supplier's case, the matched pack, else one (flagged when the line counts cases). */
function caseSize(line: ReadLine, match: SureMatch | undefined, product: LineProduct | null, supplierPacks: { productId: string; packSize: number }[]) {
  if (product?.sellingUnitId && product.unitsPerPackage) {
    const printed = unitsPerCase(line.description, line.printedUnitsPerCase);
    return { unitsPerCase: product.unitsPerPackage, unitsSource: 'PACK' as const, checkUnits: !!printed && printed !== product.unitsPerPackage && line.unit !== 'EACH' };
  }
  if (line.unit === 'EACH') return { unitsPerCase: 1, unitsSource: 'ONE' as const, checkUnits: false };
  const printed = unitsPerCase(line.description, line.printedUnitsPerCase);
  const explicit = line.printedUnitsPerCase && line.printedUnitsPerCase >= 1 ? printed : null;
  if (match?.unitsPerCase && match.unitsSource === 'LEARNED') {
    // A case size printed on this invoice that differs from last time: use it, and ask.
    if (explicit && explicit !== match.unitsPerCase) return { unitsPerCase: explicit, unitsSource: 'PRINTED' as const, checkUnits: true };
    return { unitsPerCase: match.unitsPerCase, unitsSource: 'LEARNED' as const, checkUnits: false };
  }
  if (printed) return { unitsPerCase: printed, unitsSource: 'PRINTED' as const, checkUnits: false };
  if (match?.unitsPerCase) return { unitsPerCase: match.unitsPerCase, unitsSource: match.unitsSource ?? 'SUPPLIER', checkUnits: false };
  const supplierCase = product ? supplierPacks.find(entry => entry.productId === product.productId && entry.packSize > 1) : undefined;
  if (supplierCase) return { unitsPerCase: supplierCase.packSize, unitsSource: 'SUPPLIER' as const, checkUnits: false };
  return { unitsPerCase: 1, unitsSource: 'ONE' as const, checkUnits: line.unit === 'CASE' };
}

/**
 * Problems worth a look before receiving: the same invoice already received
 * from this supplier, another copy waiting, and lines that do not add up to
 * the invoice total.
 */
export async function invoiceWarnings(db: Db, invoice: { id: string; locationId: string; supplierId: string | null; vendorName: string | null; invoiceNumber: string | null;
  subtotal: number | null; tax: number | null; fees: number | null; discount: number | null; total: number | null; lines: InvoiceLine[] }) {
  const warnings: { code: string; message: string; amount?: number; date?: string }[] = [];
  const number = invoice.invoiceNumber?.trim();
  if (number) {
    const receipt = invoice.supplierId ? await db.purchaseReceipt.findFirst({ where: { invoiceNumber: { equals: number, mode: 'insensitive' },
      purchaseOrder: { supplierId: invoice.supplierId, locationId: invoice.locationId } }, select: { createdAt: true }, orderBy: { createdAt: 'desc' } }) : null;
    if (receipt) warnings.push({ code: 'ALREADY_RECEIVED', message: `Invoice ${number} from this supplier was already received`, date: receipt.createdAt.toISOString() });
    const copies = await db.deliveryInvoice.findMany({ where: { locationId: invoice.locationId, id: { not: invoice.id }, invoiceNumber: { equals: number, mode: 'insensitive' },
      status: { in: ['READING', 'READY', 'FAILED', 'RECEIVED'] } }, select: { status: true, supplierId: true, vendorName: true, createdAt: true, receivedAt: true }, orderBy: { createdAt: 'desc' } });
    const sameVendor = (copy: { supplierId: string | null; vendorName: string | null }) => invoice.supplierId && copy.supplierId ? copy.supplierId === invoice.supplierId
      : normalizeSupplierName(copy.vendorName || '') === normalizeSupplierName(invoice.vendorName || '');
    const received = copies.find(copy => copy.status === 'RECEIVED' && sameVendor(copy));
    if (received && !receipt) warnings.push({ code: 'ALREADY_RECEIVED', message: `Invoice ${number} from this supplier was already received`, date: (received.receivedAt ?? received.createdAt).toISOString() });
    const waiting = copies.find(copy => copy.status !== 'RECEIVED' && sameVendor(copy));
    if (waiting) warnings.push({ code: 'ANOTHER_COPY', message: `Another photo of invoice ${number} is also waiting`, date: waiting.createdAt.toISOString() });
  }
  const priced = invoice.lines.filter(line => line.lineTotal !== null);
  if (invoice.total !== null && priced.length && priced.length === invoice.lines.length) {
    const cents = (value: number | null) => Math.round((value || 0) * 100);
    const counted = priced.reduce((sum, line) => sum + cents(line.lineTotal), 0) + cents(invoice.fees) + cents(invoice.tax) - cents(invoice.discount);
    const difference = (cents(invoice.total) - counted) / 100;
    if (Math.abs(difference) > 0.05) warnings.push({ code: 'TOTALS_DIFFER', message: 'The lines do not add up to the invoice total', amount: Math.round(difference * 100) / 100 });
  }
  return warnings;
}
