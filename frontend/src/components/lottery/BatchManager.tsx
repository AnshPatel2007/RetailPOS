import React, { useState, useEffect } from 'react';
import { logger } from '../../utils/logger';
import {
  Package,
  Plus,
  Edit,
  Trash2,
  CheckCircle,
  XCircle,
  Archive,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import {
  Table,
  TableBody,
  TableRow,
  TableHeader,
  TableHead,
  TableCell,
} from '@/components/ui/Table';
import { Modal } from '@/components/ui/Modal';
import { lotteryService } from '@/services/api';
import toast from 'react-hot-toast';

interface BatchManagerProps {
  locationId?: string;
  isReadOnly?: boolean;
  onUpdate?: () => void;
}

export const BatchManager: React.FC<BatchManagerProps> = ({
  locationId,
  isReadOnly = false,
  onUpdate,
}) => {
  const [loading, setLoading] = useState(false);
  const [batches, setBatches] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingBatch, setEditingBatch] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState('ACTIVE');
  const [formData, setFormData] = useState({
    batchNumber: '',
    gameType: '',
    startTicketNum: '',
    endTicketNum: '',
    totalTickets: '',
    pricePerTicket: '',
    notes: '',
  });

  useEffect(() => {
    fetchBatches();
  }, [locationId, statusFilter]);

  const fetchBatches = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (locationId) {
        params.locationId = locationId;
      }
      if (statusFilter) {
        params.status = statusFilter;
      }

      const response = await lotteryService.getBatches(params);
      setBatches(response.data.data || []);
    } catch (error) {
      logger.error('Failed to fetch batches:', error);
      toast.error('Failed to load batches');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (batch?: any) => {
    if (batch) {
      setEditingBatch(batch);
      setFormData({
        batchNumber: batch.batchNumber,
        gameType: batch.gameType,
        startTicketNum: batch.startTicketNum,
        endTicketNum: batch.endTicketNum,
        totalTickets: batch.totalTickets.toString(),
        pricePerTicket: batch.pricePerTicket.toString(),
        notes: batch.notes || '',
      });
    } else {
      setEditingBatch(null);
      setFormData({
        batchNumber: '',
        gameType: '',
        startTicketNum: '',
        endTicketNum: '',
        totalTickets: '',
        pricePerTicket: '',
        notes: '',
      });
    }
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingBatch(null);
    setFormData({
      batchNumber: '',
      gameType: '',
      startTicketNum: '',
      endTicketNum: '',
      totalTickets: '',
      pricePerTicket: '',
      notes: '',
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isReadOnly) {
      toast.error('Cannot modify data in read-only mode');
      return;
    }

    try {
      const data = {
        batchNumber: formData.batchNumber,
        gameType: formData.gameType,
        startTicketNum: formData.startTicketNum,
        endTicketNum: formData.endTicketNum,
        totalTickets: Number(formData.totalTickets),
        pricePerTicket: Number(formData.pricePerTicket),
        notes: formData.notes || null,
      };

      if (editingBatch) {
        await lotteryService.updateBatch(editingBatch.id, data);
        toast.success('Batch updated successfully');
      } else {
        await lotteryService.createBatch(data);
        toast.success('Batch created successfully');
      }

      handleCloseModal();
      await fetchBatches();
      if (onUpdate) onUpdate();
    } catch (error: any) {
      logger.error('Failed to save batch:', error);
      toast.error(error.response?.data?.message || 'Failed to save batch');
    }
  };

  const handleDelete = async (id: string) => {
    if (isReadOnly) {
      toast.error('Cannot delete in read-only mode');
      return;
    }

    if (!confirm('Are you sure you want to delete this batch?')) {
      return;
    }

    try {
      await lotteryService.deleteBatch(id);
      toast.success('Batch deleted successfully');
      await fetchBatches();
      if (onUpdate) onUpdate();
    } catch (error: any) {
      logger.error('Failed to delete batch:', error);
      toast.error(error.response?.data?.message || 'Failed to delete batch');
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, any> = {
      ACTIVE: { variant: 'success', icon: CheckCircle },
      DEPLETED: { variant: 'secondary', icon: Archive },
      RETURNED: { variant: 'warning', icon: XCircle },
      INACTIVE: { variant: 'secondary', icon: XCircle },
    };

    const config = variants[status] || variants.ACTIVE;
    const Icon = config.icon;

    return (
      <Badge variant={config.variant} className="flex items-center gap-1">
        <Icon className="h-3 w-3" />
        {status}
      </Badge>
    );
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value || 0);
  };

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Package className="h-5 w-5" />
              Batch Management
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Manage lottery ticket batches and inventory
            </p>
          </div>
          {!isReadOnly && (
            <Button
              onClick={() => handleOpenModal()}
              className="flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              New Batch
            </Button>
          )}
        </div>

        {/* Filters */}
        <div className="mb-4">
          <div className="flex gap-2">
            {['ACTIVE', 'DEPLETED', 'RETURNED', 'INACTIVE'].map((status) => (
              <Button
                key={status}
                variant={statusFilter === status ? 'primary' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter(status)}
              >
                {status}
              </Button>
            ))}
            <Button
              variant={statusFilter === '' ? 'primary' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter('')}
            >
              All
            </Button>
          </div>
        </div>

        {/* Batches Table */}
        {loading ? (
          <div className="text-center py-8">Loading...</div>
        ) : batches.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No batches found. Create your first batch to get started.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Batch #</TableHead>
                <TableHead>Game Type</TableHead>
                <TableHead>Ticket Range</TableHead>
                <TableHead>Total Tickets</TableHead>
                <TableHead>Remaining</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((batch) => (
                <TableRow key={batch.id}>
                  <TableCell className="font-medium">{batch.batchNumber}</TableCell>
                  <TableCell>{batch.gameType}</TableCell>
                  <TableCell>
                    {batch.startTicketNum} - {batch.endTicketNum}
                  </TableCell>
                  <TableCell>{batch.totalTickets}</TableCell>
                  <TableCell>
                    <span
                      className={
                        batch.remainingTickets === 0
                          ? 'text-red-500 font-medium'
                          : batch.remainingTickets < batch.totalTickets * 0.2
                          ? 'text-orange-500 font-medium'
                          : ''
                      }
                    >
                      {batch.remainingTickets}
                    </span>
                  </TableCell>
                  <TableCell>{formatCurrency(batch.pricePerTicket)}</TableCell>
                  <TableCell>{getStatusBadge(batch.status)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {!isReadOnly && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleOpenModal(batch)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDelete(batch.id)}
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={showModal}
        onClose={handleCloseModal}
        title={editingBatch ? 'Edit Batch' : 'New Batch'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Batch Number *
              </label>
              <Input
                type="text"
                value={formData.batchNumber}
                onChange={(e) =>
                  setFormData({ ...formData, batchNumber: e.target.value })
                }
                required
                placeholder="e.g., B001"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Game Type *
              </label>
              <Input
                type="text"
                value={formData.gameType}
                onChange={(e) =>
                  setFormData({ ...formData, gameType: e.target.value })
                }
                required
                placeholder="e.g., $1 Scratch"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Start Ticket # *
              </label>
              <Input
                type="text"
                value={formData.startTicketNum}
                onChange={(e) =>
                  setFormData({ ...formData, startTicketNum: e.target.value })
                }
                required
                placeholder="e.g., 001"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                End Ticket # *
              </label>
              <Input
                type="text"
                value={formData.endTicketNum}
                onChange={(e) =>
                  setFormData({ ...formData, endTicketNum: e.target.value })
                }
                required
                placeholder="e.g., 030"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Total Tickets *
              </label>
              <Input
                type="number"
                value={formData.totalTickets}
                onChange={(e) =>
                  setFormData({ ...formData, totalTickets: e.target.value })
                }
                required
                min="1"
                placeholder="e.g., 30"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Price Per Ticket *
              </label>
              <Input
                type="number"
                value={formData.pricePerTicket}
                onChange={(e) =>
                  setFormData({ ...formData, pricePerTicket: e.target.value })
                }
                required
                min="0"
                step="0.01"
                placeholder="e.g., 1.00"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Notes
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) =>
                setFormData({ ...formData, notes: e.target.value })
              }
              className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              rows={3}
              placeholder="Additional notes..."
            />
          </div>

          <div className="flex gap-3 justify-end pt-4">
            <Button type="button" variant="outline" onClick={handleCloseModal}>
              Cancel
            </Button>
            <Button type="submit">
              {editingBatch ? 'Update' : 'Create'} Batch
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
