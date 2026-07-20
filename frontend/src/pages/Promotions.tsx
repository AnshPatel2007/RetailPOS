import React, { useState, useEffect, useCallback, useRef } from 'react';
import { promotionService, productService, categoryService } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/Table';
import { PageHeader } from '@/components/common/PageHeader';
import { Pagination } from '@/components/common/Pagination';
import { EmptyState } from '@/components/common/EmptyState';
import { formatCurrency } from '@/lib/utils';
import { Promotion, PromotionType } from '@/types';
import {
  Search,
  Plus,
  Tag,
  Pencil,
  Trash2,
  Power,
  RefreshCw,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';

const TYPE_LABELS: Record<PromotionType, string> = {
  QUANTITY_PRICE: 'N for $X (bundle price)',
  BOGO: 'Buy N get M (BOGO)',
  PERCENT_OFF: 'Percent off',
  AMOUNT_OFF: 'Amount off',
};

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Human-readable summary of what the deal does, e.g. "2 for $6.00" */
const dealSummary = (p: Promotion): string => {
  switch (p.type) {
    case 'QUANTITY_PRICE':
      return `${p.buyQuantity} for ${formatCurrency(p.bundlePrice || 0)}`;
    case 'BOGO':
      return (p.percentOff ?? 100) >= 100
        ? `Buy ${p.buyQuantity} get ${p.getQuantity} free`
        : `Buy ${p.buyQuantity} get ${p.getQuantity} at ${p.percentOff}% off`;
    case 'PERCENT_OFF':
      return `${p.percentOff}% off`;
    case 'AMOUNT_OFF':
      return `${formatCurrency(p.amountOff || 0)} off each`;
  }
};

const scheduleSummary = (p: Promotion): string => {
  const parts: string[] = [];
  if (p.startsAt || p.endsAt) {
    const fmt = (d: string) => new Date(d).toLocaleDateString();
    parts.push(`${p.startsAt ? fmt(p.startsAt) : '...'} – ${p.endsAt ? fmt(p.endsAt) : '...'}`);
  }
  if (p.daysOfWeek.length > 0 && p.daysOfWeek.length < 7) {
    parts.push(p.daysOfWeek.map((d) => DAY_LABELS[d]).join(', '));
  }
  if (p.startTime && p.endTime) {
    parts.push(`${p.startTime}–${p.endTime}`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'Always';
};

interface FormState {
  name: string;
  description: string;
  type: PromotionType;
  buyQuantity: string;
  getQuantity: string;
  bundlePrice: string;
  percentOff: string;
  amountOff: string;
  products: { id: string; name: string }[];
  categoryIds: string[];
  startsAt: string;
  endsAt: string;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  priority: string;
}

const emptyForm: FormState = {
  name: '',
  description: '',
  type: 'QUANTITY_PRICE',
  buyQuantity: '2',
  getQuantity: '1',
  bundlePrice: '',
  percentOff: '',
  amountOff: '',
  products: [],
  categoryIds: [],
  startsAt: '',
  endsAt: '',
  daysOfWeek: [],
  startTime: '',
  endTime: '',
  priority: '0',
};

export const Promotions: React.FC = () => {
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>();

  const [showFormModal, setShowFormModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Promotion | null>(null);

  // Product picker inside the form
  const [productSearch, setProductSearch] = useState('');
  const [productResults, setProductResults] = useState<any[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);

  const fetchPromotions = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 25 };
      if (debouncedSearch) params.search = debouncedSearch;
      const res = await promotionService.getAll(params);
      setPromotions(res.data.data);
      setTotalPages(res.data.pagination.totalPages);
    } catch {
      toast.error('Failed to load promotions');
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch]);

  useEffect(() => {
    fetchPromotions();
  }, [fetchPromotions]);

  useEffect(() => {
    categoryService.getAll().then((res) => setCategories(res.data.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [search]);

  const searchProducts = async (query: string) => {
    setProductSearch(query);
    if (query.length < 2) {
      setProductResults([]);
      return;
    }
    try {
      const res = await productService.getAll({ search: query, isActive: true, limit: 8 });
      setProductResults((res.data.data || []).filter((p: any) => p.sku !== 'MISC-001'));
    } catch {
      // ignore
    }
  };

  const addProduct = (p: any) => {
    if (!form.products.some((x) => x.id === p.id)) {
      setForm((f) => ({ ...f, products: [...f.products, { id: p.id, name: p.name }] }));
    }
    setProductSearch('');
    setProductResults([]);
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowFormModal(true);
  };

  const openEdit = async (p: Promotion) => {
    setEditingId(p.id);
    // Resolve product names for the chips (ids alone are unreadable)
    let products: { id: string; name: string }[] = p.productIds.map((id) => ({ id, name: id }));
    if (p.productIds.length > 0) {
      try {
        const res = await productService.getAll({ ids: p.productIds.join(','), limit: p.productIds.length });
        const byId = new Map((res.data.data || []).map((x: any) => [x.id, x.name]));
        products = p.productIds.map((id) => ({ id, name: (byId.get(id) as string) || 'Unknown product' }));
      } catch {
        // fall back to raw ids
      }
    }
    setForm({
      name: p.name,
      description: p.description || '',
      type: p.type,
      buyQuantity: p.buyQuantity?.toString() || '',
      getQuantity: p.getQuantity?.toString() || '',
      bundlePrice: p.bundlePrice?.toString() || '',
      percentOff: p.percentOff?.toString() || '',
      amountOff: p.amountOff?.toString() || '',
      products,
      categoryIds: p.categoryIds,
      startsAt: p.startsAt ? p.startsAt.slice(0, 10) : '',
      endsAt: p.endsAt ? p.endsAt.slice(0, 10) : '',
      daysOfWeek: p.daysOfWeek,
      startTime: p.startTime || '',
      endTime: p.endTime || '',
      priority: p.priority.toString(),
    });
    setShowFormModal(true);
  };

  const buildPayload = () => {
    const num = (s: string) => (s.trim() === '' ? undefined : parseFloat(s));
    const int = (s: string) => (s.trim() === '' ? undefined : parseInt(s, 10));
    return {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      type: form.type,
      buyQuantity: form.type === 'QUANTITY_PRICE' || form.type === 'BOGO' ? int(form.buyQuantity) : undefined,
      getQuantity: form.type === 'BOGO' ? int(form.getQuantity) : undefined,
      bundlePrice: form.type === 'QUANTITY_PRICE' ? num(form.bundlePrice) : undefined,
      percentOff:
        form.type === 'PERCENT_OFF' ? num(form.percentOff)
        : form.type === 'BOGO' ? (num(form.percentOff) ?? 100)
        : undefined,
      amountOff: form.type === 'AMOUNT_OFF' ? num(form.amountOff) : undefined,
      productIds: form.products.map((p) => p.id),
      categoryIds: form.categoryIds,
      startsAt: form.startsAt ? new Date(form.startsAt + 'T00:00:00').toISOString() : undefined,
      endsAt: form.endsAt ? new Date(form.endsAt + 'T23:59:59').toISOString() : undefined,
      daysOfWeek: form.daysOfWeek,
      startTime: form.startTime || undefined,
      endTime: form.endTime || undefined,
      priority: int(form.priority) ?? 0,
    };
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    if (form.products.length === 0 && form.categoryIds.length === 0) {
      toast.error('Select at least one product or category');
      return;
    }
    setIsSubmitting(true);
    try {
      if (editingId) {
        await promotionService.update(editingId, buildPayload());
        toast.success('Promotion updated');
      } else {
        await promotionService.create(buildPayload());
        toast.success('Promotion created');
      }
      setShowFormModal(false);
      fetchPromotions();
    } catch (err: any) {
      const details = err.response?.data?.errors?.[0]?.message;
      toast.error(details || err.response?.data?.error || 'Failed to save promotion');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggle = async (p: Promotion) => {
    try {
      await promotionService.toggle(p.id);
      toast.success(p.isActive ? `"${p.name}" deactivated` : `"${p.name}" activated`);
      fetchPromotions();
    } catch {
      toast.error('Failed to update promotion');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await promotionService.delete(deleteTarget.id);
      toast.success(`"${deleteTarget.name}" deleted`);
      fetchPromotions();
    } catch {
      toast.error('Failed to delete promotion');
    } finally {
      setDeleteTarget(null);
    }
  };

  const toggleDay = (day: number) => {
    setForm((f) => ({
      ...f,
      daysOfWeek: f.daysOfWeek.includes(day)
        ? f.daysOfWeek.filter((d) => d !== day)
        : [...f.daysOfWeek, day].sort(),
    }));
  };

  const toggleCategory = (id: string) => {
    setForm((f) => ({
      ...f,
      categoryIds: f.categoryIds.includes(id)
        ? f.categoryIds.filter((c) => c !== id)
        : [...f.categoryIds, id],
    }));
  };

  return (
    <div className="p-8">
      <PageHeader
        title="Promotions"
        subtitle="Automatic deals applied at the register — bundles, BOGO, and happy-hour pricing"
        icon={Tag}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={fetchPromotions} title="Refresh">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button variant="primary" size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1" />
              New Promotion
            </Button>
          </>
        }
      />

      <div className="relative max-w-md mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search promotions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="border rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        ) : promotions.length === 0 ? (
          <EmptyState
            icon={Tag}
            title="No promotions yet"
            hint={search ? 'Try adjusting your search' : 'Create your first deal — e.g. "2 energy drinks for $6"'}
            action={
              !search ? (
                <Button variant="primary" size="sm" onClick={openCreate}>
                  <Plus className="h-4 w-4 mr-1" /> New Promotion
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Deal</TableHead>
                <TableHead>Applies To</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead className="text-right">Uses</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {promotions.map((p) => (
                <TableRow key={p.id} className={!p.isActive ? 'opacity-60' : undefined}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell>{dealSummary(p)}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {[
                      p.productIds.length > 0 ? `${p.productIds.length} product${p.productIds.length > 1 ? 's' : ''}` : null,
                      p.categoryIds.length > 0 ? `${p.categoryIds.length} categor${p.categoryIds.length > 1 ? 'ies' : 'y'}` : null,
                    ].filter(Boolean).join(' + ')}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">{scheduleSummary(p)}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.timesUsed}</TableCell>
                  <TableCell>
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                      p.isActive ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
                    }`}>
                      {p.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      <Button variant="outline" size="sm" onClick={() => openEdit(p)} title="Edit">
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleToggle(p)}
                        title={p.isActive ? 'Deactivate' : 'Activate'}
                      >
                        <Power className={`h-3 w-3 ${p.isActive ? 'text-success' : 'text-muted-foreground'}`} />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDeleteTarget(p)}
                        title="Delete"
                        className="text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />

      {/* Create / Edit Modal */}
      <Modal
        isOpen={showFormModal}
        onClose={() => setShowFormModal(false)}
        title={editingId ? 'Edit Promotion' : 'New Promotion'}
        size="lg"
      >
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Name"
              placeholder='e.g. "Energy Drinks 2 for $6"'
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
            <div>
              <label className="block text-sm font-medium mb-1">Deal type</label>
              <select
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as PromotionType }))}
                className="w-full h-10 px-3 border border-input rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {(Object.keys(TYPE_LABELS) as PromotionType[]).map((t) => (
                  <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Type-specific fields */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3 bg-muted/40 rounded-lg">
            {form.type === 'QUANTITY_PRICE' && (
              <>
                <Input
                  label="Bundle size (N)"
                  type="number" min="1" step="1"
                  value={form.buyQuantity}
                  onChange={(e) => setForm((f) => ({ ...f, buyQuantity: e.target.value }))}
                />
                <Input
                  label="Bundle price ($)"
                  type="number" min="0" step="0.01" placeholder="6.00"
                  value={form.bundlePrice}
                  onChange={(e) => setForm((f) => ({ ...f, bundlePrice: e.target.value }))}
                />
                <div className="col-span-2 sm:col-span-1 flex items-end pb-2 text-xs text-muted-foreground">
                  {form.buyQuantity && form.bundlePrice
                    ? `→ ${form.buyQuantity} for ${formatCurrency(parseFloat(form.bundlePrice) || 0)}`
                    : 'e.g. 2 for $6.00'}
                </div>
              </>
            )}
            {form.type === 'BOGO' && (
              <>
                <Input
                  label="Buy (paid units)"
                  type="number" min="1" step="1"
                  value={form.buyQuantity}
                  onChange={(e) => setForm((f) => ({ ...f, buyQuantity: e.target.value }))}
                />
                <Input
                  label="Get (discounted)"
                  type="number" min="1" step="1"
                  value={form.getQuantity}
                  onChange={(e) => setForm((f) => ({ ...f, getQuantity: e.target.value }))}
                />
                <Input
                  label="% off those (100 = free)"
                  type="number" min="1" max="100" step="1" placeholder="100"
                  value={form.percentOff}
                  onChange={(e) => setForm((f) => ({ ...f, percentOff: e.target.value }))}
                />
              </>
            )}
            {form.type === 'PERCENT_OFF' && (
              <Input
                label="Percent off (%)"
                type="number" min="1" max="100" step="1"
                value={form.percentOff}
                onChange={(e) => setForm((f) => ({ ...f, percentOff: e.target.value }))}
              />
            )}
            {form.type === 'AMOUNT_OFF' && (
              <Input
                label="Amount off per unit ($)"
                type="number" min="0.01" step="0.01"
                value={form.amountOff}
                onChange={(e) => setForm((f) => ({ ...f, amountOff: e.target.value }))}
              />
            )}
          </div>

          {/* Targeting */}
          <div>
            <label className="block text-sm font-medium mb-1">Products (mix &amp; match group)</label>
            {form.products.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {form.products.map((p) => (
                  <span key={p.id} className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">
                    {p.name}
                    <button
                      onClick={() => setForm((f) => ({ ...f, products: f.products.filter((x) => x.id !== p.id) }))}
                      className="hover:text-destructive"
                      title="Remove"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="relative">
              <Input
                placeholder="Search products to add..."
                value={productSearch}
                onChange={(e) => searchProducts(e.target.value)}
              />
              {productResults.length > 0 && (
                <div className="absolute z-10 w-full mt-1 border rounded-lg bg-background shadow-lg max-h-[200px] overflow-y-auto">
                  {productResults.map((p: any) => (
                    <button
                      key={p.id}
                      onClick={() => addProduct(p)}
                      className="w-full px-3 py-2 text-left hover:bg-muted text-sm flex justify-between"
                    >
                      <span className="font-medium truncate">{p.name}</span>
                      <span className="text-muted-foreground ml-2 shrink-0">{formatCurrency(p.price)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {categories.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-1">Or whole categories</label>
              <div className="flex flex-wrap gap-1.5">
                {categories.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => toggleCategory(c.id)}
                    className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                      form.categoryIds.includes(c.id)
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background hover:bg-muted border-input'
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Schedule */}
          <div className="space-y-3 p-3 bg-muted/40 rounded-lg">
            <p className="text-sm font-medium">Schedule <span className="text-muted-foreground font-normal">(leave empty to run always)</span></p>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Starts"
                type="date"
                value={form.startsAt}
                onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))}
              />
              <Input
                label="Ends"
                type="date"
                value={form.endsAt}
                onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Days of week</label>
              <div className="flex gap-1">
                {DAY_LABELS.map((label, day) => (
                  <button
                    key={day}
                    onClick={() => toggleDay(day)}
                    className={`text-xs w-10 py-1.5 rounded border transition-colors ${
                      form.daysOfWeek.includes(day)
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background hover:bg-muted border-input'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="From time (happy hour)"
                type="time"
                value={form.startTime}
                onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
              />
              <Input
                label="To time"
                type="time"
                value={form.endTime}
                onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Priority (higher wins)"
              type="number" min="0" step="1"
              value={form.priority}
              onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
            />
            <Input
              label="Description (optional)"
              placeholder="Internal note..."
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>

          <div className="flex gap-2 justify-end pt-2 border-t">
            <Button variant="outline" onClick={() => setShowFormModal(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : editingId ? 'Save Changes' : 'Create Promotion'}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete promotion?"
        message={
          deleteTarget
            ? `"${deleteTarget.name}" will stop applying immediately. Past sales keep their recorded discounts.`
            : ''
        }
        destructive
        confirmLabel="Delete"
      />
    </div>
  );
};
