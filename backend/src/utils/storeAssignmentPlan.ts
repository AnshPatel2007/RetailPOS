/**
 * Deciding which store owns a record created before stores existed (its
 * locationId is null), from where it has actually been used. Pure, so the
 * backfill script's choices are testable without a database.
 */
export interface StoreUsage { recordId: string; locationId: string; uses: number }

export type StoreAssignment =
  | { recordId: string; action: 'ASSIGN'; locationId: string }
  /** Used by several stores and safe to duplicate (categories): the busiest store keeps it, the others get a copy. */
  | { recordId: string; action: 'SPLIT'; locationId: string; copyTo: string[] }
  | { recordId: string; action: 'AMBIGUOUS'; locationIds: string[] }
  | { recordId: string; action: 'UNUSED' };

export function planStoreAssignments(recordIds: string[], usage: StoreUsage[], options: { splitShared: boolean; unusedTo?: string | null }): StoreAssignment[] {
  const byRecord = new Map<string, Map<string, number>>();
  for (const row of usage) {
    if (!row.locationId || row.uses <= 0) continue;
    const stores = byRecord.get(row.recordId) ?? new Map<string, number>();
    stores.set(row.locationId, (stores.get(row.locationId) ?? 0) + row.uses);
    byRecord.set(row.recordId, stores);
  }
  return recordIds.map(recordId => {
    const stores = [...(byRecord.get(recordId) ?? new Map<string, number>()).entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([locationId]) => locationId);
    if (stores.length === 0) return options.unusedTo ? { recordId, action: 'ASSIGN', locationId: options.unusedTo } : { recordId, action: 'UNUSED' };
    if (stores.length === 1) return { recordId, action: 'ASSIGN', locationId: stores[0] };
    return options.splitShared
      ? { recordId, action: 'SPLIT', locationId: stores[0], copyTo: stores.slice(1) }
      : { recordId, action: 'AMBIGUOUS', locationIds: stores };
  });
}
