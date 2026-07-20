import React, { useState, useEffect, useCallback } from 'react';
import { reportService } from '@/services/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/Card';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/Table';
import { EmptyState } from '@/components/common/EmptyState';
import { Archive, TrendingUp, ShieldAlert, PackageX } from 'lucide-react';
import toast from 'react-hot-toast';

const REASON_LABELS: Record<string, string> = {
  DAMAGED: 'Damaged',
  LOST: 'Lost / Missing',
  THEFT: 'Theft',
  EXPIRED: 'Expired',
  WASTE: 'Waste',
  OTHER: 'Other',
};

const WINDOWS = [30, 60, 90];

/**
 * Stock Health tab: dead stock, sell-through by category, and shrinkage by
 * reason. Self-contained (loads its own data) like EmployeeSalesTab.
 */
export const StockHealthTab: React.FC = () => {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await reportService.getStockHealth({ days });
      setData(res.data.data);
    } catch {
      toast.error('Failed to load stock health report');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex justify-center p-12">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }
  if (!data) return null;

  const { deadStock, sellThrough, shrinkage } = data;

  return (
    <div className="space-y-6">
      {/* Window selector */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Window:</span>
        {WINDOWS.map((w) => (
          <button
            key={w}
            onClick={() => setDays(w)}
            className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
              days === w
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent'
            }`}
          >
            {w} days
          </button>
        ))}
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Sell-through</p>
                <p className="text-2xl font-bold">{sellThrough.overallPct}%</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {sellThrough.unitsSold} sold · {sellThrough.stockOnHand} on hand
                </p>
              </div>
              <TrendingUp className="h-8 w-8 text-success" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Dead stock (at cost)</p>
                <p className="text-2xl font-bold">{formatCurrency(deadStock.totals.stockValue)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {deadStock.totals.products} products · {deadStock.totals.units} units
                </p>
              </div>
              <PackageX className="h-8 w-8 text-warning" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Shrinkage (at cost)</p>
                <p className="text-2xl font-bold">{formatCurrency(shrinkage.totals.costValue)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {shrinkage.totals.units} units · {shrinkage.totals.entries} entries
                </p>
              </div>
              <ShieldAlert className="h-8 w-8 text-destructive" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Lost retail value</p>
                <p className="text-2xl font-bold">{formatCurrency(shrinkage.totals.retailValue)}</p>
                <p className="text-xs text-muted-foreground mt-1">what shrinkage would have sold for</p>
              </div>
              <Archive className="h-8 w-8 text-info" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Shrinkage by reason */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Shrinkage by reason</h2>
        {shrinkage.byReason.length === 0 ? (
          <Card>
            <CardContent className="py-8">
              <p className="text-center text-muted-foreground text-sm">
                No shrinkage recorded in the last {days} days. Loss-reason stock adjustments
                (damaged, theft, expired...) made in Inventory will appear here.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Entries</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead className="text-right">Cost value</TableHead>
                  <TableHead className="text-right">Retail value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shrinkage.byReason.map((r: any) => (
                  <TableRow key={r.reason}>
                    <TableCell className="font-medium">{REASON_LABELS[r.reason] || r.reason}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.entries}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.units}</TableCell>
                    <TableCell className="text-right tabular-nums text-destructive">
                      {formatCurrency(r.costValue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatCurrency(r.retailValue)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Recent shrinkage entries */}
      {shrinkage.recent.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Recent shrinkage entries</h2>
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shrinkage.recent.map((e: any) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                      {formatDate(e.createdAt)}
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{e.productName}</span>
                      <span className="text-muted-foreground text-xs ml-2">{e.sku}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">
                        {REASON_LABELS[e.reason] || e.reason}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{e.units}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(e.costValue)}</TableCell>
                    <TableCell className="text-muted-foreground text-xs max-w-[240px] truncate">
                      {e.notes || '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Sell-through by category */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Sell-through by category ({days} days)</h2>
        {sellThrough.byCategory.length === 0 ? (
          <Card>
            <CardContent className="py-8">
              <p className="text-center text-muted-foreground text-sm">No inventory activity yet.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Units sold</TableHead>
                  <TableHead className="text-right">On hand</TableHead>
                  <TableHead className="w-[240px]">Sell-through</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sellThrough.byCategory.map((c: any) => (
                  <TableRow key={c.categoryName}>
                    <TableCell className="font-medium">{c.categoryName}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.unitsSold}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.stockOnHand}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              c.sellThroughPct >= 60 ? 'bg-success' : c.sellThroughPct >= 25 ? 'bg-warning' : 'bg-destructive'
                            }`}
                            style={{ width: `${Math.min(100, c.sellThroughPct)}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium tabular-nums w-12 text-right">
                          {c.sellThroughPct}%
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Dead stock */}
      <div>
        <h2 className="text-lg font-semibold mb-3">
          Dead stock <span className="text-sm font-normal text-muted-foreground">— in stock, zero sales in {days} days</span>
        </h2>
        {deadStock.products.length === 0 ? (
          <Card>
            <CardContent className="py-8">
              <EmptyState
                icon={PackageX}
                title="No dead stock"
                hint={`Every stocked product sold at least once in the last ${days} days`}
              />
            </CardContent>
          </Card>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">On hand</TableHead>
                  <TableHead className="text-right">Tied up (cost)</TableHead>
                  <TableHead className="text-right">Retail value</TableHead>
                  <TableHead>Last sold</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deadStock.products.map((p: any) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <span className="font-medium">{p.name}</span>
                      <span className="text-muted-foreground text-xs ml-2">{p.sku}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.categoryName}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.stockQuantity}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium text-warning">
                      {formatCurrency(p.stockValue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatCurrency(p.retailValue)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                      {p.lastSoldAt ? formatDate(p.lastSoldAt) : 'Never'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
};
