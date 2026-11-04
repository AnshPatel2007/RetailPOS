import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Boxes, Search } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { DataPanel } from '@/components/common/Workspace';
import { Pagination } from '@/components/common/Pagination';
import { EmptyState } from '@/components/common/EmptyState';
import { productService } from '@/services/api';
import { formatCurrency } from '@/lib/utils';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';

export type PackRow =
  | { kind: 'PACK'; id: string; productId: string; name: string; containsName: string; unitsPerPackage: number; baseUnitName: string; barcode: string;
      sku: string | null; price: number; packCost: number; available: number; sealedQuantity: number; isActive: boolean }
  | { kind: 'VARIETY'; id: string; productId: string; name: string; barcode: string | null; sku: string; price: number; packCost: number;
      stockQuantity: number; isActive: boolean; itemsPerPack: number; contents: { name: string; quantity: number }[] };

const margin = (price: number, cost: number) => price > 0 ? `${((price - cost) / price * 100).toFixed(1)}%` : '—';
const PAGE_SIZE = 20;

/**
 * Inventory > Packs: cartons, 12-packs and cases of a single item (sharing its
 * stock) and variety packs (their own stock, opened into the items inside).
 */
export const PackCatalog: React.FC<{ locationId?: string | null; canManage: boolean; refreshKey: number; onEdit: (row: PackRow) => void }> = ({ locationId, canManage, refreshKey, onEdit }) => {
  const [search, setSearch] = useState('');
  const settled = useDebouncedValue(search);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<PackRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setError('');
    try {
      const res = await productService.getPacks({ search: settled || undefined, page, limit: PAGE_SIZE, locationId: locationId || undefined }, controller.signal);
      if (controller.signal.aborted) return;
      setRows(res.data.data); setTotal(res.data.pagination.total); setTotalPages(res.data.pagination.totalPages || 1);
    } catch (err: any) { if (!controller.signal.aborted) setError(err.response?.data?.error || 'Unable to load packs. Try again.'); }
  }, [settled, page, locationId]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { setPage(1); }, [settled]);

  return (
    <DataPanel
      toolbar={<div className="products-toolbar">
        <div className="products-search"><Search aria-hidden="true" /><Input type="search" aria-label="Search packs" placeholder="Search packs by name or barcode..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" /></div>
      </div>}
      footer={rows && !error ? <div className="products-results-footer">
        <span role="status">{total === 0 ? '0 packs' : `Showing ${(page - 1) * PAGE_SIZE + 1} to ${(page - 1) * PAGE_SIZE + rows.length} of ${total} packs`}</span>
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} itemName="packs" />
      </div> : undefined}>
      {error ? <div role="alert" className="p-6 space-y-3"><p>{error}</p><Button variant="outline" onClick={() => void load()}>Retry packs</Button></div>
        : rows === null ? <div className="p-8 text-center" role="status"><div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full mx-auto" /><p className="mt-3 text-muted-foreground">Loading packs...</p></div>
          : rows.length === 0 ? <EmptyState icon={Boxes} title="No packs yet" hint={settled ? 'Try another search.' : 'Add a carton, 12-pack or variety pack. A pack of one item shares that item\'s stock and cost.'} />
            : <Table>
              <TableHeader><TableRow>
                <TableHead>Pack</TableHead><TableHead>Contains</TableHead><TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Pack cost</TableHead><TableHead className="text-right">Margin</TableHead><TableHead className="text-right">Stock</TableHead>
                {canManage && <TableHead><span className="sr-only">Actions</span></TableHead>}
              </TableRow></TableHeader>
              <TableBody>{rows.map(row => (
                <TableRow key={row.id}>
                  <TableCell><div className="font-medium">{row.name}</div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary">{row.kind === 'PACK' ? 'Pack' : 'Variety pack'}</Badge>{row.barcode || row.sku}{!row.isActive && <Badge variant="warning">Inactive</Badge>}
                    </div></TableCell>
                  <TableCell className="text-sm">{row.kind === 'PACK' ? `${row.unitsPerPackage} × ${row.containsName}`
                    : row.contents.length ? `${row.itemsPerPack} items: ${row.contents.map(c => `${c.quantity} ${c.name}`).join(', ')}` : <span className="text-muted-foreground">Contents not set</span>}</TableCell>
                  <TableCell className="text-right">{formatCurrency(row.price)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(row.packCost)}</TableCell>
                  <TableCell className="text-right">{margin(row.price, row.packCost)}</TableCell>
                  <TableCell className="text-right text-sm">{row.kind === 'PACK'
                    ? <><div>{row.available} available</div><div className="text-xs text-muted-foreground">{row.sealedQuantity} unopened</div></>
                    : <div>{row.stockQuantity} in stock</div>}</TableCell>
                  {canManage && <TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => onEdit(row)} aria-label={`Edit ${row.name}`}>Edit</Button></TableCell>}
                </TableRow>))}</TableBody>
            </Table>}
    </DataPanel>
  );
};
