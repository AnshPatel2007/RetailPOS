import React, { useState, useEffect, useCallback } from 'react';
import { ClipboardCheck, Plus, CheckCircle, XCircle, Eye, Send } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PageHeader } from '@/components/common/PageHeader';
import { Pagination } from '@/components/common/Pagination';
import { EmptyState } from '@/components/common/EmptyState';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/Table';
import { cycleCountService, locationService, categoryService } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { useEffectiveLocation } from '@/hooks/useEffectiveLocation';
import toast from 'react-hot-toast';

interface CycleCountRecord {
  id: string;
  countNumber: string;
  locationId: string;
  status: string;
  type: string;
  categoryId: string | null;
  notes: string | null;
  createdBy: string;
  approvedBy: string | null;
  completedAt: string | null;
  createdAt: string;
  items: CycleCountItem[];
}

interface CycleCountItem {
  id: string;
  productId: string;
  expectedQty: number;
  countedQty: number | null;
  discrepancy: number | null;
  notes: string | null;
  product?: {
    id: string;
    name: string;
    sku: string;
  };
}

interface Location {
  id: string;
  name: string;
}

interface Category {
  id: string;
  name: string;
}

const statusColors: Record<string, string> = {
  IN_PROGRESS: 'bg-info/10 text-info',
  REVIEW: 'bg-warning/10 text-warning',
  APPROVED: 'bg-success/10 text-success',
  CANCELLED: 'bg-destructive/10 text-destructive',
};

export const CycleCount: React.FC = () => {
  const { user } = useAuthStore();
  const [counts, setCounts] = useState<CycleCountRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [locations, setLocations] = useState<Location[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  // Create modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createLocationId, setCreateLocationId] = useState('');
  const [createType, setCreateType] = useState('FULL');
  const [createCategoryId, setCreateCategoryId] = useState('');
  const [createNotes, setCreateNotes] = useState('');

  // Detail/counting modal
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedCount, setSelectedCount] = useState<CycleCountRecord | null>(null);
  const [itemCounts, setItemCounts] = useState<Record<string, number>>({});

  const fetchCounts = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await cycleCountService.getAll({ page, limit: 20, status: statusFilter || undefined });
      setCounts(data.data);
      setTotal(data.total);
    } catch {
      toast.error('Failed to load cycle counts');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  useEffect(() => {
    locationService.getAll().then(({ data }) => setLocations(data.data)).catch(() => {});
    categoryService.getAll().then(({ data }) => setCategories(data.data || [])).catch(() => {});
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await cycleCountService.create({
        locationId: createLocationId,
        type: createType,
        categoryId: createType === 'CATEGORY' ? createCategoryId : undefined,
        notes: createNotes || undefined,
      });
      toast.success('Cycle count started');
      setShowCreateModal(false);
      setCreateLocationId('');
      setCreateType('FULL');
      setCreateCategoryId('');
      setCreateNotes('');
      fetchCounts();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to start cycle count');
    }
  };

  const viewDetail = async (count: CycleCountRecord) => {
    try {
      const { data } = await cycleCountService.getById(count.id);
      setSelectedCount(data.data);
      const initial: Record<string, number> = {};
      data.data.items.forEach((item: CycleCountItem) => {
        if (item.countedQty !== null) initial[item.id] = item.countedQty;
      });
      setItemCounts(initial);
      setShowDetailModal(true);
    } catch {
      toast.error('Failed to load cycle count');
    }
  };

  const handleSaveItems = async () => {
    if (!selectedCount) return;
    const items = Object.entries(itemCounts).map(([id, countedQty]) => ({ id, countedQty }));
    if (items.length === 0) {
      toast.error('Enter at least one count');
      return;
    }
    try {
      await cycleCountService.updateItems(selectedCount.id, items);
      toast.success('Counts saved');
      const { data } = await cycleCountService.getById(selectedCount.id);
      setSelectedCount(data.data);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to save counts');
    }
  };

  // One shared confirm dialog for submit/approve/cancel
  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    destructive?: boolean;
    confirmLabel?: string;
    action: () => void;
  } | null>(null);

  const handleSubmit = async () => {
    if (!selectedCount) return;
    try {
      await cycleCountService.submit(selectedCount.id);
      toast.success('Submitted for review');
      setShowDetailModal(false);
      fetchCounts();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to submit');
    }
  };

  const handleApprove = async () => {
    if (!selectedCount) return;
    try {
      await cycleCountService.approve(selectedCount.id);
      toast.success('Cycle count approved, inventory adjusted');
      setShowDetailModal(false);
      fetchCounts();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to approve');
    }
  };

  const handleCancel = async () => {
    if (!selectedCount) return;
    try {
      await cycleCountService.cancel(selectedCount.id);
      toast.success('Cycle count cancelled');
      setShowDetailModal(false);
      fetchCounts();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to cancel');
    }
  };

  const totalPages = Math.ceil(total / 20);
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
  const { isReadOnly } = useEffectiveLocation();
  // Mutating routes are ADMIN/MANAGER only — hide the buttons cashiers can't use
  const canManage =
    !isReadOnly &&
    ['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(user?.role || '');

  return (
    <div className="p-8">
      <PageHeader
        title="Cycle Counts"
        subtitle="Physical inventory verification"
        actions={canManage && (
          <Button variant="primary" onClick={() => setShowCreateModal(true)}>
            <Plus className="w-4 h-4 mr-2" />
            New Count
          </Button>
        )}
      />

      {/* Status filter */}
      <div className="flex gap-2 mb-6">
        {['', 'IN_PROGRESS', 'REVIEW', 'APPROVED', 'CANCELLED'].map((status) => (
          <Button
            key={status}
            variant={statusFilter === status ? 'primary' : 'outline'}
            size="sm"
            onClick={() => { setStatusFilter(status); setPage(1); }}
          >
            {status ? status.replace(/_/g, ' ') : 'All'}
          </Button>
        ))}
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>Counts</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : counts.length === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title="No cycle counts found"
              hint={statusFilter ? 'Try a different status filter' : 'Start a count to verify physical inventory'}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Count #</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {counts.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => viewDetail(c)}>
                    <TableCell className="font-medium">{c.countNumber}</TableCell>
                    <TableCell>{locations.find(l => l.id === c.locationId)?.name || c.locationId}</TableCell>
                    <TableCell className="text-muted-foreground">{c.type}</TableCell>
                    <TableCell className="text-muted-foreground">{c.items?.length || 0}</TableCell>
                    <TableCell>
                      <Badge className={statusColors[c.status] || ''}>{c.status.replace(/_/g, ' ')}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} totalItems={total} itemName="counts" />
        </CardContent>
      </Card>

      {/* Create Modal */}
      <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="Start Cycle Count">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Location *</label>
            <select
              value={createLocationId}
              onChange={(e) => setCreateLocationId(e.target.value)}
              required
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-foreground"
            >
              <option value="">Select location...</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Count Type</label>
            <select
              value={createType}
              onChange={(e) => setCreateType(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-foreground"
            >
              <option value="FULL">Full Count</option>
              <option value="PARTIAL">Partial</option>
              <option value="CATEGORY">By Category</option>
            </select>
          </div>
          {createType === 'CATEGORY' && (
            <div>
              <label className="block text-sm font-medium mb-1">Category *</label>
              <select
                value={createCategoryId}
                onChange={(e) => setCreateCategoryId(e.target.value)}
                required
                className="w-full px-3 py-2 bg-background border border-input rounded-md text-foreground"
              >
                <option value="">Select category...</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea
              value={createNotes}
              onChange={(e) => setCreateNotes(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-foreground text-sm"
              rows={2}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => setShowCreateModal(false)}>Cancel</Button>
            <Button variant="primary" type="submit">Start Count</Button>
          </div>
        </form>
      </Modal>

      {/* Detail / Counting Modal */}
      <Modal
        isOpen={showDetailModal}
        onClose={() => { setShowDetailModal(false); setSelectedCount(null); }}
        title={`Cycle Count ${selectedCount?.countNumber || ''}`}
      >
        {selectedCount && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground">Status</p>
                <Badge className={statusColors[selectedCount.status] || ''}>{selectedCount.status}</Badge>
              </div>
              <div>
                <p className="text-muted-foreground">Type</p>
                <p>{selectedCount.type}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Location</p>
                <p>{locations.find(l => l.id === selectedCount.locationId)?.name || selectedCount.locationId}</p>
              </div>
            </div>

            {/* Items */}
            <div>
              <h4 className="text-sm font-medium mb-2">
                Items ({selectedCount.items.length})
                {selectedCount.status === 'IN_PROGRESS' && (
                  <span className="text-muted-foreground font-normal ml-2">— Enter counted quantities</span>
                )}
              </h4>
              <div className="max-h-[300px] overflow-y-auto space-y-1">
                {selectedCount.items.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 text-sm p-2 bg-muted/50 rounded">
                    <span className="flex-1 truncate" title={item.product?.sku}>{item.product?.name || item.productId}</span>
                    <span className="text-muted-foreground w-20 text-right">Expected: {item.expectedQty}</span>
                    {selectedCount.status === 'IN_PROGRESS' ? (
                      <Input
                        type="number"
                        min="0"
                        value={itemCounts[item.id] ?? ''}
                        onChange={(e) => setItemCounts({ ...itemCounts, [item.id]: parseInt(e.target.value) || 0 })}
                        placeholder="Count"
                        className="w-20 text-right"
                      />
                    ) : (
                      <>
                        <span className="w-20 text-right">Counted: {item.countedQty ?? '-'}</span>
                        {item.discrepancy !== null && item.discrepancy !== 0 && (
                          <span className={`w-16 text-right font-medium ${item.discrepancy > 0 ? 'text-success' : 'text-destructive'}`}>
                            {item.discrepancy > 0 ? '+' : ''}{item.discrepancy}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Summary for review/approved */}
            {(selectedCount.status === 'REVIEW' || selectedCount.status === 'APPROVED') && (
              <div className="p-3 bg-muted/50 rounded-lg text-sm">
                <p className="font-medium mb-1">Discrepancy Summary</p>
                <p className="text-muted-foreground">
                  Items with discrepancies: {selectedCount.items.filter(i => i.discrepancy && i.discrepancy !== 0).length} / {selectedCount.items.length}
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              {selectedCount.status === 'IN_PROGRESS' && canManage && (
                <>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setConfirmState({
                      title: 'Cancel cycle count?',
                      message: 'Entered counts will be discarded and no inventory will be adjusted.',
                      destructive: true,
                      confirmLabel: 'Cancel Count',
                      action: handleCancel,
                    })}
                  >
                    <XCircle className="w-4 h-4 mr-1" /> Cancel
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleSaveItems}>
                    <Eye className="w-4 h-4 mr-1" /> Save Progress
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setConfirmState({
                      title: 'Submit for review?',
                      message: 'Make sure all items have been counted before submitting.',
                      confirmLabel: 'Submit',
                      action: handleSubmit,
                    })}
                  >
                    <Send className="w-4 h-4 mr-1" /> Submit for Review
                  </Button>
                </>
              )}
              {selectedCount.status === 'REVIEW' && isAdmin && !isReadOnly && (
                <>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setConfirmState({
                      title: 'Reject cycle count?',
                      message: 'The count will be cancelled and no inventory will be adjusted.',
                      destructive: true,
                      confirmLabel: 'Reject',
                      action: handleCancel,
                    })}
                  >
                    Reject
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setConfirmState({
                      title: 'Approve cycle count?',
                      message: `${selectedCount.items.filter(i => i.discrepancy && i.discrepancy !== 0).length} item(s) with discrepancies will have their inventory adjusted.`,
                      confirmLabel: 'Approve & Adjust',
                      action: handleApprove,
                    })}
                  >
                    <CheckCircle className="w-4 h-4 mr-1" /> Approve & Adjust
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={confirmState !== null}
        onClose={() => setConfirmState(null)}
        onConfirm={() => confirmState?.action()}
        title={confirmState?.title || ''}
        message={confirmState?.message || ''}
        destructive={confirmState?.destructive}
        confirmLabel={confirmState?.confirmLabel}
      />
    </div>
  );
};
