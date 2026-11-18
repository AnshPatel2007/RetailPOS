import { useId, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { DialogActions } from '@/components/ui/DialogActions';
import { Select } from '@/components/ui/Select';
import { Checkbox } from '@/components/ui/Checkbox';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Pagination } from '@/components/common/Pagination';
import { apiErrorMessage, catalogService } from '@/services/api';
import { chunks, describeValue, linkCounts, plural } from '@/lib/sharedCatalog';
import { formatCurrency } from '@/lib/utils';
import type { CatalogStore, LinkGroup, LinkPreview } from '@/types/sharedCatalog';

const PAGE = 50;
// The server takes at most 200 groups per request.
const BATCH = 200;
const groupKey = (group: LinkGroup) => group.members.map(member => member.productId).sort().join(',');

/**
 * Link the items the stores already have: the same barcode (any UPC/EAN form), or the
 * same SKU and name, in two or more stores becomes one shared item. The owner picks the
 * main store (its name and selling rules win where the stores differ), reviews every
 * match and its differences, and links the ones chosen. Prices and stock never change.
 */
export function LinkProductsWizard({ stores, currentStoreId, onClose, onLinked }: {
  stores: CatalogStore[]; currentStoreId: string | null; onClose: () => void; onLinked: () => void;
}) {
  const formId = useId();
  const [primary, setPrimary] = useState(stores.some(store => store.id === currentStoreId) ? currentStoreId! : stores[0]?.id ?? '');
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [makeMatch, setMakeMatch] = useState(true);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ text: string; changed: boolean } | null>(null);
  // One key per batch, kept while this review stands, so a retried batch is never applied twice.
  const keys = useRef<string[]>([]);

  const find = async () => {
    setBusy('Finding matches...'); setError(null);
    try {
      const data = (await catalogService.previewLinks(primary)).data.data;
      setPreview(data); setPage(1); keys.current = [];
      setSelected(new Set(data.groups.filter(group => !group.problem).map(groupKey)));
    } catch (failure) { setError({ text: apiErrorMessage(failure, 'Could not find matches. Try again.'), changed: false }); }
    finally { setBusy(null); }
  };

  const link = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!preview) { void find(); return; }
    const chosen = preview.groups.filter(group => !group.problem && selected.has(groupKey(group)));
    if (!chosen.length) return;
    setError(null);
    let linked = 0, products = 0;
    try {
      const batches = chunks(chosen, BATCH);
      for (const [index, batch] of batches.entries()) {
        setBusy(batches.length > 1 ? `Linking (${index + 1} of ${batches.length})...` : 'Linking...');
        keys.current[index] ??= crypto.randomUUID();
        const result = (await catalogService.applyLinks({ idempotencyKey: keys.current[index], primaryLocationId: primary,
          groups: batch.map(group => ({ fingerprint: group.fingerprint, productIds: group.members.map(member => member.productId), makeStoresMatch: makeMatch })) })).data.data;
        linked += result.linked; products += result.products;
      }
      toast.success(`${plural(products, 'store item')} linked as ${plural(linked, 'shared item')}`);
      onLinked();
      onClose();
    } catch (failure) {
      const status = (failure as { response?: { status?: number } }).response?.status;
      if (linked) onLinked();
      setError({ text: (linked ? `${plural(linked, 'shared item')} linked. ` : '') + apiErrorMessage(failure, 'Linking stopped. Try again.'), changed: status === 409 });
    } finally { setBusy(null); }
  };

  const toggle = (key: string) => setSelected(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const counts = preview ? linkCounts(preview.groups) : null;
  const chosenCount = preview ? preview.groups.filter(group => !group.problem && selected.has(groupKey(group))).length : 0;
  const shown = preview ? preview.groups.slice((page - 1) * PAGE, page * PAGE) : [];
  const primaryName = stores.find(store => store.id === primary)?.name ?? 'the main store';

  return <Modal isOpen onClose={() => { if (!busy) onClose(); }} size="xl" title="Link Existing Products"
    description={preview ? `Main store: ${primaryName}` : 'Find the items your stores already share.'}
    footer={<DialogActions form={formId} loading={!!busy} onCancel={onClose}
      confirmLabel={preview ? `Link ${plural(chosenCount, 'item')}` : 'Find Matches'} disabled={preview ? chosenCount === 0 : !primary}>
      {preview && <Button type="button" variant="ghost" disabled={!!busy} onClick={() => { setPreview(null); setError(null); }}>Change main store</Button>}
    </DialogActions>}>
    <form id={formId} onSubmit={link} className="space-y-4" aria-busy={!!busy}>
      {error && <Alert tone="error" action={error.changed ? <Button type="button" variant="outline" onClick={() => void find()}>Review again</Button> : undefined}>{error.text}</Alert>}
      {busy && <p role="status" className="text-sm text-muted-foreground">{busy}</p>}
      {!preview ? <fieldset disabled={!!busy} className="min-w-0 space-y-3">
        <Select label="Main store" value={primary} onChange={event => setPrimary(event.target.value)}>
          {stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}
        </Select>
        <p className="text-sm text-muted-foreground">Items with the same barcode, or the same SKU and name, in two or more stores are matched. Where the stores differ, the shared item takes the main store&apos;s name and selling rules. Nothing changes until you review the matches and link them.</p>
      </fieldset>
      : !preview.groups.length ? <Alert tone="info" title="No matches">No item is in more than one store with the same barcode, or the same SKU and name. Add single items to the shared catalog from their item form instead.</Alert>
      : <div className="space-y-4">
        <p className="text-sm" role="status">
          {plural(counts!.total, 'match', 'matches')} found: {counts!.same} the same in every store, {counts!.differ} with differences{counts!.blocked ? `, ${counts!.blocked} that cannot be linked as they are` : ''}.
        </p>
        <Checkbox label="Make every store's item match the shared one" checked={makeMatch} onChange={event => setMakeMatch(event.target.checked)} disabled={!!busy}
          description="Name, barcode, category and selling rules. Prices and stock stay each store's own." />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={!!busy} onClick={() => setSelected(new Set(preview.groups.filter(group => !group.problem).map(groupKey)))}>Select all</Button>
          <Button type="button" variant="ghost" disabled={!!busy} onClick={() => setSelected(new Set())}>Select none</Button>
        </div>
        <ul className="divide-y rounded-md border" aria-label="Matches">
          {shown.map(group => {
            const key = groupKey(group);
            return <li key={key} className="space-y-2 p-3 text-sm">
              <div className="flex items-start gap-3">
                <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-primary" aria-label={`Link ${group.shared.name}`}
                  checked={!group.problem && selected.has(key)} disabled={!!group.problem || !!busy} onChange={() => toggle(key)} />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{group.shared.name}</span>
                    <Badge variant="secondary">{group.match === 'BARCODE' ? 'Same barcode' : 'Same SKU and name'}</Badge>
                    {group.existingCatalogItemId && <Badge>Joins {group.existingName}</Badge>}
                    {group.differences.length > 0 && <Badge variant="warning">Differs: {group.differences.map(difference => difference.label).join(', ')}</Badge>}
                  </div>
                  <ul className="text-muted-foreground">
                    {group.members.map(member => <li key={member.productId}>{member.storeName}: {member.name} · {formatCurrency(member.price)} · {member.stockQuantity} in stock</li>)}
                  </ul>
                  {group.problem && <p className="text-warning">{group.problem}</p>}
                  {group.differences.length > 0 && <details>
                    <summary className="cursor-pointer text-xs font-medium">See the differences</summary>
                    <dl className="mt-1 grid gap-1 text-xs">
                      {group.differences.map(difference => <div key={difference.field}>
                        <dt className="inline font-medium">{difference.label}: </dt>
                        <dd className="inline">{difference.field !== 'price' && <>shared {describeValue(difference.field, difference.shared)}; </>}
                          {difference.stores.map(store => `${store.storeName} ${describeValue(difference.field, store.value)}`).join('; ')}
                          {difference.field === 'price' && ' (each store keeps its price)'}</dd>
                      </div>)}
                    </dl>
                  </details>}
                </div>
              </div>
            </li>;
          })}
        </ul>
        {preview.groups.length > PAGE && <Pagination page={page} totalPages={Math.ceil(preview.groups.length / PAGE)} onPageChange={setPage}
          totalItems={preview.groups.length} itemName="matches" />}
      </div>}
    </form>
  </Modal>;
}
