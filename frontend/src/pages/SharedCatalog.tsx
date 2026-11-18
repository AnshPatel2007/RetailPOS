import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Library, Search } from 'lucide-react';
import { DataPanel, ManagementPage, SummaryStrip } from '@/components/common/Workspace';
import { PageHeader } from '@/components/common/PageHeader';
import { ProductTabs } from '@/components/common/WorkflowNavigation';
import { RowActions } from '@/components/common/RowActions';
import { EmptyState } from '@/components/common/EmptyState';
import { Pagination } from '@/components/common/Pagination';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/LoadingState';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { CatalogItemPanel } from '@/components/catalog/CatalogItemPanel';
import { CatalogPricePanel } from '@/components/catalog/CatalogPricePanel';
import { AddAllToStorePanel, AddToStorePanel } from '@/components/catalog/AddToStorePanel';
import { LinkProductsWizard } from '@/components/catalog/LinkProductsWizard';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { useAuthStore } from '@/store/authStore';
import { catalogService } from '@/services/api';
import { plural } from '@/lib/sharedCatalog';
import { formatCurrency } from '@/lib/utils';
import type { CatalogItem, CatalogList } from '@/types/sharedCatalog';
import '@/styles/products.css';

type Panel = { kind: 'edit' | 'price' | 'add'; item: CatalogItem } | { kind: 'link' } | { kind: 'add-all' } | null;

/**
 * Shared Catalog (owners of several stores): one list of the items the stores share.
 * An item is edited and priced once here; each store keeps its own stock and cost, and
 * its own price unless it follows the shared one.
 */
export default function SharedCatalog() {
  const currentStoreId = useAuthStore(state => state.user?.locationId ?? null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const [query, setQuery] = useState(search);
  const [page, setPage] = useState(1);
  const [panel, setPanel] = useState<Panel>(null);
  // The item form links here with ?search=<sku>; take it into the search box, then tidy the address.
  useEffect(() => {
    if (searchParams.get('search') === null) return;
    setSearchParams(current => { const next = new URLSearchParams(current); next.delete('search'); return next; }, { replace: true });
  }, [searchParams, setSearchParams]);
  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const list = useScopedQuery<CatalogList>(['shared-catalog', query, page], async signal => (await catalogService.list({ search: query || undefined, page }, signal)).data.data);
  const data = list.data;
  const refresh = () => { void list.refresh(); };
  const close = () => setPanel(null);

  return (
    <ManagementPage className="products-workspace">
      <PageHeader title="Products" tabs={<ProductTabs value="catalog" />} actions={data && <>
        <Button onClick={() => setPanel({ kind: 'add-all' })}>Add All To A Store</Button>
        <Button variant="primary" onClick={() => setPanel({ kind: 'link' })}>Link Existing Products</Button>
      </>} />
      {list.error && !data ? <Alert tone="error" action={<Button variant="outline" onClick={refresh}>Retry</Button>}>{list.error}</Alert>
        : !data ? <div className="flex justify-center py-12"><Spinner size="lg" /></div>
        : <DataPanel
          summary={<SummaryStrip items={[
            { label: query ? 'Matching Shared Items' : 'Shared Items', value: data.pagination.total },
            { label: 'Stores', value: data.stores.length, detail: data.stores.map(store => store.name).join(', ') },
            { label: 'Not Shared Yet', value: data.unlinkedProducts, tone: data.unlinkedProducts ? 'warning' : 'default',
              detail: data.unlinkedProducts ? 'Items in your stores outside the shared catalog' : 'Every item is shared' },
          ]} />}
          toolbar={<div className="products-toolbar">
            <div className="products-search"><Search aria-hidden="true" /><Input type="search" aria-label="Search shared items" placeholder="Search by name, SKU, or barcode..."
              value={search} onChange={event => setSearch(event.target.value)} className="pl-10" /></div>
          </div>}
          footer={data.pagination.totalPages > 1 && <div className="products-results-footer">
            <span role="status">{plural(data.pagination.total, 'shared item')}</span>
            <Pagination page={page} totalPages={data.pagination.totalPages} onPageChange={setPage} itemName="shared items" />
          </div>}>
          {!data.items.length ? <EmptyState icon={Library} title={query ? 'No shared items match' : 'No shared items yet'}
              hint={query ? 'Try another name, SKU or barcode.' : 'Link the items your stores already have, or open an item and choose Add to Shared Catalog.'} />
            : <Table aria-label="Shared items">
              <TableHeader><TableRow>
                <TableHead>Item</TableHead><TableHead className="text-right">Shared price</TableHead><TableHead>Stores</TableHead>
                <TableHead><span className="sr-only">Actions</span></TableHead>
              </TableRow></TableHeader>
              <TableBody>{data.items.map(item => <TableRow key={item.id}>
                <TableCell>
                  <div className="font-medium">{item.name}</div>
                  <div className="text-xs text-muted-foreground">{[item.sku, item.barcode].filter(Boolean).join(' · ')}</div>
                  {!item.isActive && <Badge variant="secondary">Turned off</Badge>}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {item.defaultPrice === null ? '—' : formatCurrency(item.defaultPrice)}
                  {item.packs.filter(pack => pack.isActive).map(pack => <div key={pack.id} className="text-xs text-muted-foreground">
                    {pack.name} {pack.defaultPrice === null ? '—' : formatCurrency(pack.defaultPrice)}</div>)}
                </TableCell>
                <TableCell>
                  <ul className="flex flex-wrap gap-1.5" aria-label={`Stores for ${item.name}`}>
                    {item.listings.map(listing => <li key={listing.productId} className="catalog-store-chip">
                      <span>{listing.storeName}</span>{' '}<span className="tabular-nums font-medium">{formatCurrency(listing.price)}</span>
                      {listing.priceFollowsCatalog && <>{' '}<span className="catalog-store-chip-note">follows</span></>}
                    </li>)}
                    {item.missingStores.map(store => <li key={store.locationId} className="catalog-store-chip" data-missing="true">
                      <span>{store.storeName}</span>{' '}<span className="catalog-store-chip-note">not carried</span>
                    </li>)}
                  </ul>
                </TableCell>
                <TableCell className="whitespace-nowrap text-right">
                  <RowActions name={item.name} primary={{ label: 'Edit', onAction: () => setPanel({ kind: 'edit', item }) }}
                    items={[
                      { id: 'price', label: 'Set Price', onAction: () => setPanel({ kind: 'price', item }) },
                      item.missingStores.length > 0 && item.isActive && { id: 'add', label: 'Add To Store', onAction: () => setPanel({ kind: 'add', item }) },
                    ]} />
                </TableCell>
              </TableRow>)}</TableBody>
            </Table>}
        </DataPanel>}

      {panel?.kind === 'edit' && <CatalogItemPanel item={panel.item} onClose={close} onSaved={refresh} />}
      {panel?.kind === 'price' && <CatalogPricePanel item={panel.item} onClose={close} onSaved={refresh} />}
      {panel?.kind === 'add' && <AddToStorePanel item={panel.item} onClose={close} onSaved={refresh} />}
      {panel?.kind === 'add-all' && data && <AddAllToStorePanel stores={data.stores} onClose={close} onDone={refresh} />}
      {panel?.kind === 'link' && data && <LinkProductsWizard stores={data.stores} currentStoreId={currentStoreId} onClose={close} onLinked={refresh} />}
    </ManagementPage>
  );
}
