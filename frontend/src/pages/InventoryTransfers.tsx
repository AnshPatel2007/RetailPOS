import React, { useState, useEffect, useCallback } from 'react';
import { ArrowLeftRight, Plus, Truck, CheckCircle, XCircle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/Table';
import { inventoryTransferService, locationService, productService } from '@/services/api';
import toast from 'react-hot-toast';

interface Transfer {
  id: string;
  transferNumber: string;
  fromLocationId: string;
  toLocationId: string;
  status: string;
  notes: string | null;
  createdAt: string;
  shippedAt: string | null;
  receivedAt: string | null;
  items: TransferItem[];
}

interface TransferItem {
  id: string;
  productId: string;
  quantity: number;
  receivedQty: number | null;
}

interface Location {
  id: string;
  name: string;
}

interface Product {
  id: string;
  name: string;
  sku: string;
  stockQuantity: number;
}

const statusColors: Record<string, string> = {
  PENDING: 'bg-yellow-500/10 text-yellow-500',
  IN_TRANSIT: 'bg-blue-500/10 text-blue-500',
  RECEIVED: 'bg-green-500/10 text-green-500',
  CANCELLED: 'bg-red-500/10 text-red-500',
};

export const InventoryTransfers: React.FC = () => {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [locations, setLocations] = useState<Location[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  // Create modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [fromLocationId, setFromLocationId] = useState('');
  const [toLocationId, setToLocationId] = useState('');
  const [transferItems, setTransferItems] = useState<{ productId: string; quantity: number }[]>([]);
  const [notes, setNotes] = useState('');

  // Detail modal
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedTransfer, setSelectedTransfer] = useState<Transfer | null>(null);

  const fetchTransfers = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await inventoryTransferService.getAll({ page, limit: 20, status: statusFilter || undefined });
      setTransfers(data.data);
      setTotal(data.total);
    } catch {
      toast.error('Failed to load transfers');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    fetchTransfers();
  }, [fetchTransfers]);

  useEffect(() => {
    locationService.getAll().then(({ data }) => setLocations(data.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (fromLocationId) {
      productService.getAll({ locationId: fromLocationId, limit: 200 })
        .then(({ data }) => setProducts(data.data))
        .catch(() => {});
    }
  }, [fromLocationId]);

  const addItem = () => {
    setTransferItems([...transferItems, { productId: '', quantity: 1 }]);
  };

  const removeItem = (index: number) => {
    setTransferItems(transferItems.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: string, value: string | number) => {
    setTransferItems(transferItems.map((item, i) =>
      i === index ? { ...item, [field]: value } : item
    ));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const validItems = transferItems.filter(i => i.productId && i.quantity > 0);
    if (!validItems.length) {
      toast.error('Add at least one item');
      return;
    }
    try {
      await inventoryTransferService.create({
        fromLocationId,
        toLocationId,
        items: validItems,
        notes: notes || undefined,
      });
      toast.success('Transfer created');
      setShowCreateModal(false);
      resetCreateForm();
      fetchTransfers();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to create transfer');
    }
  };

  const resetCreateForm = () => {
    setFromLocationId('');
    setToLocationId('');
    setTransferItems([]);
    setNotes('');
  };

  const handleShip = async (id: string) => {
    try {
      await inventoryTransferService.ship(id);
      toast.success('Transfer shipped');
      fetchTransfers();
      setShowDetailModal(false);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to ship');
    }
  };

  const handleReceive = async (id: string) => {
    try {
      await inventoryTransferService.receive(id);
      toast.success('Transfer received');
      fetchTransfers();
      setShowDetailModal(false);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to receive');
    }
  };

  const handleCancel = async (id: string) => {
    if (!confirm('Cancel this transfer?')) return;
    try {
      await inventoryTransferService.cancel(id);
      toast.success('Transfer cancelled');
      fetchTransfers();
      setShowDetailModal(false);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to cancel');
    }
  };

  const viewDetail = async (transfer: Transfer) => {
    try {
      const { data } = await inventoryTransferService.getById(transfer.id);
      setSelectedTransfer(data.data);
      setShowDetailModal(true);
    } catch {
      toast.error('Failed to load transfer details');
    }
  };

  const totalPages = Math.ceil(total / 20);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">Inventory Transfers</h1>
          <p className="text-muted-foreground">Transfer stock between locations</p>
        </div>
        <Button variant="primary" onClick={() => setShowCreateModal(true)}>
          <Plus className="w-4 h-4 mr-2" />
          New Transfer
        </Button>
      </div>

      {/* Status filter */}
      <div className="flex gap-2 mb-6">
        {['', 'PENDING', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED'].map((status) => (
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
          <CardTitle>Transfers</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : transfers.length === 0 ? (
            <div className="p-12 text-center">
              <ArrowLeftRight className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No transfers found</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Transfer #</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transfers.map((t) => (
                  <TableRow key={t.id} className="cursor-pointer" onClick={() => viewDetail(t)}>
                    <TableCell className="font-medium">{t.transferNumber}</TableCell>
                    <TableCell>{locations.find(l => l.id === t.fromLocationId)?.name || t.fromLocationId}</TableCell>
                    <TableCell>{locations.find(l => l.id === t.toLocationId)?.name || t.toLocationId}</TableCell>
                    <TableCell className="text-muted-foreground">{t.items?.length || 0}</TableCell>
                    <TableCell>
                      <Badge className={statusColors[t.status] || ''}>{t.status.replace(/_/g, ' ')}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{new Date(t.createdAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-4">
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
              <span className="px-3 py-1 text-sm text-muted-foreground">Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Modal */}
      <Modal isOpen={showCreateModal} onClose={() => { setShowCreateModal(false); resetCreateForm(); }} title="New Inventory Transfer">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">From Location *</label>
              <select
                value={fromLocationId}
                onChange={(e) => setFromLocationId(e.target.value)}
                required
                className="w-full px-3 py-2 bg-background border border-input rounded-md text-foreground"
              >
                <option value="">Select...</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">To Location *</label>
              <select
                value={toLocationId}
                onChange={(e) => setToLocationId(e.target.value)}
                required
                className="w-full px-3 py-2 bg-background border border-input rounded-md text-foreground"
              >
                <option value="">Select...</option>
                {locations.filter(l => l.id !== fromLocationId).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">Items</label>
              <button type="button" onClick={addItem} className="text-xs text-primary hover:underline">+ Add Item</button>
            </div>
            {transferItems.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-3 border border-dashed border-border rounded-lg">
                No items added. Click "+ Add Item" above.
              </p>
            )}
            {transferItems.map((item, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <select
                  value={item.productId}
                  onChange={(e) => updateItem(i, 'productId', e.target.value)}
                  className="flex-1 px-3 py-2 bg-background border border-input rounded-md text-foreground text-sm"
                >
                  <option value="">Select product...</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name} (Stock: {p.stockQuantity})</option>)}
                </select>
                <Input
                  type="number"
                  min="1"
                  value={item.quantity}
                  onChange={(e) => updateItem(i, 'quantity', parseInt(e.target.value))}
                  className="w-20"
                />
                <Button variant="ghost" size="sm" type="button" onClick={() => removeItem(i)} className="text-destructive hover:text-destructive">
                  <XCircle className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-foreground text-sm"
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => { setShowCreateModal(false); resetCreateForm(); }}>Cancel</Button>
            <Button variant="primary" type="submit">Create Transfer</Button>
          </div>
        </form>
      </Modal>

      {/* Detail Modal */}
      <Modal isOpen={showDetailModal} onClose={() => { setShowDetailModal(false); setSelectedTransfer(null); }} title={`Transfer ${selectedTransfer?.transferNumber || ''}`}>
        {selectedTransfer && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Status</p>
                <Badge className={statusColors[selectedTransfer.status] || ''}>{selectedTransfer.status.replace(/_/g, ' ')}</Badge>
              </div>
              <div>
                <p className="text-muted-foreground">Created</p>
                <p>{new Date(selectedTransfer.createdAt).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-muted-foreground">From</p>
                <p>{locations.find(l => l.id === selectedTransfer.fromLocationId)?.name || selectedTransfer.fromLocationId}</p>
              </div>
              <div>
                <p className="text-muted-foreground">To</p>
                <p>{locations.find(l => l.id === selectedTransfer.toLocationId)?.name || selectedTransfer.toLocationId}</p>
              </div>
            </div>

            {selectedTransfer.notes && (
              <p className="text-sm text-muted-foreground">Notes: {selectedTransfer.notes}</p>
            )}

            <div>
              <h4 className="text-sm font-medium mb-2">Items ({selectedTransfer.items.length})</h4>
              <div className="space-y-1">
                {selectedTransfer.items.map((item) => (
                  <div key={item.id} className="flex justify-between text-sm p-2 bg-muted/50 rounded">
                    <span>{item.productId}</span>
                    <span className="text-muted-foreground">
                      Qty: {item.quantity}
                      {item.receivedQty !== null && ` / Received: ${item.receivedQty}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              {selectedTransfer.status === 'PENDING' && (
                <>
                  <Button variant="destructive" size="sm" onClick={() => handleCancel(selectedTransfer.id)}>Cancel</Button>
                  <Button variant="primary" size="sm" onClick={() => handleShip(selectedTransfer.id)}>
                    <Truck className="w-4 h-4 mr-1" /> Ship
                  </Button>
                </>
              )}
              {selectedTransfer.status === 'IN_TRANSIT' && (
                <Button variant="primary" size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => handleReceive(selectedTransfer.id)}>
                  <CheckCircle className="w-4 h-4 mr-1" /> Receive
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
