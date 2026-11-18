import type { CatalogFieldsPatch, CatalogItem, LinkGroup, SharedFields } from '@/types/sharedCatalog';
import { formatCurrency } from '@/lib/utils';

/**
 * Pure helpers for the Shared Catalog screens (pages/SharedCatalog.tsx and
 * components/catalog/*). Unit tested in tests/shared-catalog.test.cjs.
 */

/** The edit form's fields as typed: text, a 18/21 age choice and the selling rules. */
export interface SharedDraft {
  name: string; sku: string; barcode: string; categoryName: string; brand: string; productFamily: string; variant: string; size: string;
  description: string; baseUnitName: string; isTaxable: boolean; ebtEligible: boolean; priceEmbedded: boolean; minimumAge: string; saleBlockedReason: string;
}

export const draftOf = (item: SharedFields): SharedDraft => ({
  name: item.name, sku: item.sku, barcode: item.barcode ?? '', categoryName: item.categoryName ?? '', brand: item.brand ?? '',
  productFamily: item.productFamily ?? '', variant: item.variant ?? '', size: item.size ?? '', description: item.description ?? '',
  baseUnitName: item.baseUnitName, isTaxable: item.isTaxable, ebtEligible: item.ebtEligible, priceEmbedded: item.priceEmbedded,
  minimumAge: item.minimumAge ? String(item.minimumAge) : '', saleBlockedReason: item.saleBlockedReason ?? '',
});

const optional = (value: string) => value.trim() || null;

/** Only the fields the owner changed, ready to send; an emptied optional field becomes null. */
export function changedFields(item: SharedFields, draft: SharedDraft): CatalogFieldsPatch {
  const next: SharedFields = {
    name: draft.name.trim(), sku: draft.sku.trim(), barcode: optional(draft.barcode), categoryName: optional(draft.categoryName),
    brand: optional(draft.brand), productFamily: optional(draft.productFamily), variant: optional(draft.variant), size: optional(draft.size),
    description: optional(draft.description), baseUnitName: draft.baseUnitName.trim() || item.baseUnitName, isTaxable: draft.isTaxable,
    ebtEligible: draft.ebtEligible, priceEmbedded: draft.priceEmbedded, minimumAge: draft.minimumAge ? Number(draft.minimumAge) : null,
    saleBlockedReason: optional(draft.saleBlockedReason),
  };
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(next) as (keyof SharedFields)[]) if (next[key] !== (item[key] ?? null)) patch[key] = next[key];
  return patch as CatalogFieldsPatch;
}

/** What the edit form must have before saving, in plain words; null when it can be saved. */
export function draftProblem(draft: SharedDraft): string | null {
  if (!draft.name.trim()) return 'Enter the item name.';
  if (!draft.sku.trim()) return 'Enter the SKU.';
  const hold = draft.saleBlockedReason.trim();
  if (hold && hold.length < 3) return 'Describe the sale hold in a few words, or leave it empty.';
  return null;
}

/** A value in the link review: Yes/No, an age limit, a price, or "—" when empty. */
export function describeValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (field === 'price') return formatCurrency(Number(value));
  if (field === 'minimumAge') return `${value}+`;
  return String(value);
}

/** Groups that can be linked (no problem), with or without differences, and the ones that cannot. */
export function linkCounts(groups: Pick<LinkGroup, 'problem' | 'differences'>[]) {
  const ready = groups.filter(group => !group.problem);
  return { total: groups.length, same: ready.filter(group => !group.differences.length).length,
    differ: ready.filter(group => group.differences.length > 0).length, blocked: groups.length - ready.length };
}

/** Split a list into requests the server accepts (at most `size` each). */
export function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < rows.length; start += size) out.push(rows.slice(start, start + size));
  return out;
}

/** Which stores a shared price reaches: the ones that follow it, or every store that carries the item. */
export function priceReach(item: Pick<CatalogItem, 'listings'>) {
  const following = item.listings.filter(listing => listing.priceFollowsCatalog);
  return { following: following.map(listing => listing.storeName), all: item.listings.map(listing => listing.storeName) };
}

/** A price typed in a form: a positive amount rounded to the cent, or null. */
export function typedPrice(value: string): number | null {
  const amount = Number(value);
  return value.trim() && Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : null;
}

/** "3 items", "1 item". */
export const plural = (count: number, word: string, many = word + 's') => `${count} ${count === 1 ? word : many}`;
