import { ManagementPage } from '@/components/common/Workspace';
import { Select } from '@/components/ui/Select';
import { formatEnumLabel, formatDateTime } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { PageHeader } from '@/components/common/PageHeader';
import { Pagination } from '@/components/common/Pagination';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent } from '@/components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { productService } from '@/services/api';
import { useEffectiveLocation } from '@/hooks/useEffectiveLocation';
import { useUrlFilter, useUrlPage, useUrlFilterPatch } from '@/hooks/useUrlFilter';
import { DateRangePicker } from '@/components/ui/DateRangePicker';

interface Movement {
  id: string; type: string; quantity: number; previousQty: number; newQty: number;
  sourceId: string | null; notes: string | null; stockVersion: number | null; createdAt: string; actor: string;
  product: { id: string; name: string; sku: string };
}
interface Result { data: Movement[]; timezone: string; pagination: { total: number; totalPages: number } }

/** Database ids are unreadable at a glance: show the first 8 characters, full id on hover. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function shortReference(id?: string | null) {
  if (!id) return '—';
  return UUID.test(id) ? <span className="font-mono" title={id}>Ref {id.slice(0, 8).toUpperCase()}</span> : id;
}

/** Every kind of stock movement the system records, so each can be filtered. */
const MOVEMENT_TYPES = ['SALE', 'RETURN', 'PURCHASE', 'RECEIVED', 'CYCLE_COUNT', 'EXCEPTION_COUNT', 'MANUAL_COUNT', 'MISCOUNT', 'CORRECTION',
  'MISSING_RECEIPT', 'WRONG_SKU_SOLD', 'SOLD_WITHOUT_SCANNING', 'TRANSFER_NOT_RECORDED', 'DAMAGED', 'LOST', 'THEFT', 'EXPIRED', 'WASTE', 'OTHER',
  'ADJUSTMENT', 'IMPORT', 'TRANSFER_OUT', 'TRANSFER_IN', 'TRANSFER_RETURN', 'TRANSFER_LOSS', 'BUNDLE_OPEN', 'STOCK_RECLASS', 'SKU_CORRECTION'];

export function InventoryMovements() {
  const { locationId } = useEffectiveLocation();
  const [search, setSearch] = useUrlFilter('search');
  const [type, setType] = useUrlFilter('type');
  const [startDate] = useUrlFilter('startDate');
  const [endDate] = useUrlFilter('endDate');
  const patchFilters = useUrlFilterPatch();
  const [page, setPage] = useUrlPage();
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(timer);
  }, [search]);
  const query = useScopedQuery<Result>(['movements', locationId, debouncedSearch, type, startDate, endDate, page], async () => {
    const response = await productService.movements({ locationId: locationId || undefined, search: debouncedSearch || undefined,
      type: type || undefined, startDate: startDate || undefined, endDate: endDate || undefined, page, limit: 25 });
    return response.data;
  });
  const { data: result, loading, error } = query;
  return <ManagementPage className="">
    <PageHeader title="Movement History" icon={History} />
    {query.stale && <p role="status" className="mb-4 text-sm text-warning">Updates are unavailable. Showing previously loaded movements.</p>}
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-4">
      <Input label="Search movements" value={search} onChange={event => setSearch(event.target.value)} placeholder="Product, SKU or reference" />
      <Select label="Movement type" value={type} onChange={event => setType(event.target.value)}>
        <option value="">All types</option>{MOVEMENT_TYPES.map(value => <option key={value} value={value}>{formatEnumLabel(value)}</option>)}
      </Select>
      <DateRangePicker label="Movement dates" startDate={startDate} endDate={endDate} timezone={result?.timezone} onChange={range => patchFilters({ startDate: range.startDate, endDate: range.endDate })} />
    </div>
    <Card><CardContent className="pt-6">
      {error && <div role="alert" className="mb-4"><p>{error}</p><Button variant="outline" className="mt-3" onClick={query.refresh}>Retry</Button></div>}
      {loading ? <p role="status">Loading movements…</p>
        : result && <>
          <p className="text-sm text-muted-foreground mb-4">{result.pagination.total} recorded movements · Times in {result.timezone}. Older stock changes without a recorded movement are not included.</p>
          {result.data.length === 0 ? <p className="py-8 text-center text-muted-foreground">No recorded movements match these filters.</p> : <div className="overflow-x-auto"><Table scrollLabel="Inventory Movements records">
            <TableHeader><TableRow>{['When / Who', 'Product', 'Movement', 'Change', 'Before → After', 'Reference / Notes'].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader>
            <TableBody>{result.data.map(row => <TableRow key={row.id}>
              <TableCell className="whitespace-nowrap">{formatDateTime(row.createdAt, result.timezone)}<span className="block text-xs text-muted-foreground">{row.actor}</span></TableCell>
              <TableCell>{row.product.name}<span className="block text-xs text-muted-foreground">{row.product.sku}</span></TableCell>
              <TableCell className="whitespace-nowrap">{formatEnumLabel(row.type)}</TableCell>
              <TableCell className="text-right tabular-nums">{row.quantity > 0 ? '+' : ''}{row.quantity}</TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">{row.previousQty} → {row.newQty}</TableCell>
              <TableCell className="max-w-64 break-words text-xs">{shortReference(row.sourceId)}{row.notes && <span className="block mt-1 text-muted-foreground">{row.notes}</span>}</TableCell>
            </TableRow>)}</TableBody>
          </Table></div>}
          {page > 1 && result.pagination.totalPages < page && <Button variant="outline" onClick={() => setPage(1)}>Return to first page</Button>}
          <Pagination page={page} totalPages={result.pagination.totalPages} onPageChange={setPage} />
        </>}
    </CardContent></Card>
  </ManagementPage>;
}
