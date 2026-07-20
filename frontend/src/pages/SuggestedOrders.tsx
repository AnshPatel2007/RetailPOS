import React, { useState, useEffect, useCallback } from 'react';
import { purchaseOrderService } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/Table';
import { formatCurrency } from '@/lib/utils';
import { ClipboardList, RefreshCw, ShoppingCart, AlertTriangle, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface SuggestedItem {
  productId: string;
  name: string;
  sku: string;
  stock: number;
  lowStockAlert: number;
  velocityPerDay: number;
  daysOfCover: number | null;
  suggestedQty: number;
  cost: number;
  urgent: boolean;
}

interface SupplierGroup {
  supplierId: string | null;
  supplierName: string;
  leadTimeDays: number | null;
  estimatedTotal: number;
  items: SuggestedItem[];
}

/**
 * Velocity-based reorder plan: what to order, how much, from whom — with
 * editable quantities and one-click PO creation per supplier.
 */
export const SuggestedOrders: React.FC = () => {
  const [groups, setGroups] = useState<SupplierGroup[]>([]);
  const [meta, setMeta] = useState<{ velocityWindowDays: number; coverTargetDays: number } | null>(null);
  const [loading, setLoading] = useState(true);
  // qty overrides + deselections, keyed by productId
  const [qtyOverrides, setQtyOverrides] = useState<Record<string, number>>({});
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const [createdFor, setCreatedFor] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await purchaseOrderService.getSuggested();
      setGroups(res.data.data.suppliers);
      setMeta({
        velocityWindowDays: res.data.data.velocityWindowDays,
        coverTargetDays: res.data.data.coverTargetDays,
      });
      setQtyOverrides({});
      setExcluded(new Set());
      setCreatedFor(new Set());
    } catch {
      toast.error('Failed to load reorder suggestions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const qtyFor = (item: SuggestedItem) => qtyOverrides[item.productId] ?? item.suggestedQty;

  const activeItems = (g: SupplierGroup) =>
    g.items.filter((i) => !excluded.has(i.productId) && qtyFor(i) > 0);

  const groupTotal = (g: SupplierGroup) =>
    Math.round(activeItems(g).reduce((s, i) => s + i.cost * qtyFor(i), 0) * 100) / 100;

  const handleCreatePO = async (g: SupplierGroup) => {
    if (!g.supplierId) return;
    const items = activeItems(g).map((i) => ({
      productId: i.productId,
      quantity: qtyFor(i),
      cost: i.cost,
    }));
    if (items.length === 0) {
      toast.error('No items selected for this supplier');
      return;
    }
    setCreatingFor(g.supplierId);
    try {
      const res = await purchaseOrderService.create({
        supplierId: g.supplierId,
        items,
        notes: `Auto-suggested reorder (${meta?.velocityWindowDays}-day velocity, ${meta?.coverTargetDays}-day cover)`,
      });
      toast.success(`PO ${res.data.data.orderNumber} created for ${g.supplierName}`);
      setCreatedFor((prev) => new Set(prev).add(g.supplierId!));
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to create purchase order');
    } finally {
      setCreatingFor(null);
    }
  };

  return (
    <div className="p-8">
      <PageHeader
        title="Suggested Orders"
        subtitle={
          meta
            ? `Based on ${meta.velocityWindowDays}-day sales velocity, targeting ${meta.coverTargetDays} days of cover`
            : 'What to reorder, from whom, and how much'
        }
        icon={ClipboardList}
        actions={
          <Button variant="outline" size="sm" onClick={load} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
        }
      />

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="py-10">
            <EmptyState
              icon={CheckCircle2}
              title="Nothing needs reordering"
              hint="Every tracked product has healthy stock for the next week"
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => {
            const done = g.supplierId ? createdFor.has(g.supplierId) : false;
            return (
              <Card key={g.supplierId ?? 'unassigned'} className={done ? 'opacity-60' : undefined}>
                <CardContent className="pt-5">
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <div>
                      <h2 className="font-semibold text-lg">{g.supplierName}</h2>
                      <p className="text-xs text-muted-foreground">
                        {g.items.length} product{g.items.length > 1 ? 's' : ''}
                        {g.leadTimeDays ? ` · ~${g.leadTimeDays} day lead time` : ''}
                        {' · '}est. {formatCurrency(groupTotal(g))}
                      </p>
                    </div>
                    {g.supplierId ? (
                      done ? (
                        <span className="flex items-center gap-1.5 text-success text-sm font-medium">
                          <CheckCircle2 className="h-4 w-4" /> PO created
                        </span>
                      ) : (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleCreatePO(g)}
                          disabled={creatingFor !== null || activeItems(g).length === 0}
                        >
                          <ShoppingCart className="h-4 w-4 mr-1.5" />
                          {creatingFor === g.supplierId ? 'Creating...' : `Create PO (${activeItems(g).length})`}
                        </Button>
                      )
                    ) : (
                      <span className="text-xs text-warning">
                        Link these products to a supplier to order them here
                      </span>
                    )}
                  </div>

                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8"></TableHead>
                          <TableHead>Product</TableHead>
                          <TableHead className="text-right">On hand</TableHead>
                          <TableHead className="text-right">Sells / day</TableHead>
                          <TableHead className="text-right">Days left</TableHead>
                          <TableHead className="text-right w-28">Order qty</TableHead>
                          <TableHead className="text-right">Est. cost</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {g.items.map((item) => {
                          const isExcluded = excluded.has(item.productId);
                          return (
                            <TableRow key={item.productId} className={isExcluded ? 'opacity-40' : undefined}>
                              <TableCell>
                                <input
                                  type="checkbox"
                                  checked={!isExcluded}
                                  onChange={() =>
                                    setExcluded((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(item.productId)) next.delete(item.productId);
                                      else next.add(item.productId);
                                      return next;
                                    })
                                  }
                                  className="rounded border-input"
                                />
                              </TableCell>
                              <TableCell>
                                <span className="font-medium">{item.name}</span>
                                <span className="text-muted-foreground text-xs ml-2">{item.sku}</span>
                                {item.urgent && (
                                  <span className="ml-2 inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">
                                    <AlertTriangle className="h-2.5 w-2.5" />
                                    {item.stock === 0 ? 'OUT' : 'URGENT'}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {item.stock}
                                {item.lowStockAlert > 0 && (
                                  <span className="text-muted-foreground text-xs"> / {item.lowStockAlert}</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{item.velocityPerDay}</TableCell>
                              <TableCell className="text-right tabular-nums">
                                {item.daysOfCover === null ? '—' : item.daysOfCover}
                              </TableCell>
                              <TableCell className="text-right">
                                <input
                                  type="number"
                                  min="0"
                                  value={qtyFor(item)}
                                  onChange={(e) =>
                                    setQtyOverrides((prev) => ({
                                      ...prev,
                                      [item.productId]: Math.max(0, parseInt(e.target.value) || 0),
                                    }))
                                  }
                                  disabled={isExcluded}
                                  className="w-20 text-right px-2 py-1 border border-input rounded bg-background text-sm tabular-nums"
                                />
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatCurrency(item.cost * qtyFor(item))}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};
