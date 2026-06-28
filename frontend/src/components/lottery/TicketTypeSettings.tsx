import React, { useState, useEffect } from 'react';
import { logger } from '../../utils/logger';
import { Plus, Edit2, Trash2, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { lotteryService } from '@/services/api';
import toast from 'react-hot-toast';

interface TicketTypeSettingsProps {
  locationId?: string;
  isReadOnly?: boolean;
}

interface TicketType {
  id: string;
  ticketName: string;
  ticketCode: string;
  pricePerTicket: number;
  sortOrder: number;
  isActive: boolean;
}

export const TicketTypeSettings: React.FC<TicketTypeSettingsProps> = ({
  locationId,
  isReadOnly = false,
}) => {
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [formData, setFormData] = useState({
    ticketName: '',
    ticketCode: '',
    pricePerTicket: '',
    sortOrder: '0',
  });

  useEffect(() => {
    fetchTicketTypes();
  }, [locationId]);

  const fetchTicketTypes = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (locationId) {
        params.locationId = locationId;
      }

      const response = await lotteryService.getTicketTypes(params);
      setTicketTypes(response.data.data || []);
    } catch (error) {
      logger.error('Failed to fetch ticket types:', error);
      toast.error('Failed to load ticket types');
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = () => {
    setIsAdding(true);
    setFormData({
      ticketName: '',
      ticketCode: '',
      pricePerTicket: '',
      sortOrder: String(ticketTypes.length),
    });
  };

  const handleEdit = (ticketType: TicketType) => {
    setEditingId(ticketType.id);
    setFormData({
      ticketName: ticketType.ticketName,
      ticketCode: ticketType.ticketCode,
      pricePerTicket: String(ticketType.pricePerTicket),
      sortOrder: String(ticketType.sortOrder),
    });
  };

  const handleCancel = () => {
    setIsAdding(false);
    setEditingId(null);
    setFormData({
      ticketName: '',
      ticketCode: '',
      pricePerTicket: '',
      sortOrder: '0',
    });
  };

  const handleSave = async () => {
    if (!formData.ticketName || !formData.ticketCode || !formData.pricePerTicket) {
      toast.error('Please fill all required fields');
      return;
    }

    try {
      const data = {
        ticketName: formData.ticketName,
        ticketCode: formData.ticketCode.toUpperCase(),
        pricePerTicket: parseFloat(formData.pricePerTicket),
        sortOrder: parseInt(formData.sortOrder) || 0,
      };

      if (editingId) {
        await lotteryService.updateTicketType(editingId, data);
        toast.success('Ticket type updated successfully');
      } else {
        await lotteryService.createTicketType(data);
        toast.success('Ticket type created successfully');
      }

      handleCancel();
      await fetchTicketTypes();
    } catch (error: any) {
      logger.error('Failed to save ticket type:', error);
      toast.error(error.response?.data?.message || 'Failed to save ticket type');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this ticket type?')) {
      return;
    }

    try {
      await lotteryService.deleteTicketType(id);
      toast.success('Ticket type deleted successfully');
      await fetchTicketTypes();
    } catch (error: any) {
      logger.error('Failed to delete ticket type:', error);
      toast.error(error.response?.data?.message || 'Failed to delete ticket type');
    }
  };

  const handleToggleActive = async (ticketType: TicketType) => {
    try {
      await lotteryService.updateTicketType(ticketType.id, {
        isActive: !ticketType.isActive,
      });
      toast.success(`Ticket type ${ticketType.isActive ? 'deactivated' : 'activated'}`);
      await fetchTicketTypes();
    } catch (error: any) {
      logger.error('Failed to toggle ticket type:', error);
      toast.error(error.response?.data?.message || 'Failed to update ticket type');
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value);
  };

  if (loading) {
    return (
      <Card className="p-6">
        <div className="text-center">Loading ticket types...</div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-xl font-semibold">Lottery Ticket Types</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Manage ticket types used in daily lottery entries
            </p>
          </div>
          {!isReadOnly && !isAdding && (
            <Button onClick={handleAdd} className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Add Ticket Type
            </Button>
          )}
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Order</TableHead>
              <TableHead>Ticket Name</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isAdding && (
              <TableRow className="bg-blue-500/10">
                <TableCell>
                  <Input
                    type="number"
                    value={formData.sortOrder}
                    onChange={(e) =>
                      setFormData({ ...formData, sortOrder: e.target.value })
                    }
                    className="w-20"
                    min="0"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="text"
                    value={formData.ticketName}
                    onChange={(e) =>
                      setFormData({ ...formData, ticketName: e.target.value })
                    }
                    placeholder="e.g., $1 Scratch-Off"
                    autoFocus
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="text"
                    value={formData.ticketCode}
                    onChange={(e) =>
                      setFormData({ ...formData, ticketCode: e.target.value.toUpperCase() })
                    }
                    placeholder="e.g., SCRATCH_001"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    value={formData.pricePerTicket}
                    onChange={(e) =>
                      setFormData({ ...formData, pricePerTicket: e.target.value })
                    }
                    placeholder="0.00"
                    step="0.01"
                    min="0"
                  />
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground">New</span>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex gap-2 justify-end">
                    <Button size="sm" onClick={handleSave} className="flex items-center gap-1">
                      <Save className="h-3 w-3" />
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCancel}
                      className="flex items-center gap-1"
                    >
                      <X className="h-3 w-3" />
                      Cancel
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )}

            {ticketTypes.map((ticketType) => (
              <TableRow key={ticketType.id}>
                {editingId === ticketType.id ? (
                  <>
                    <TableCell>
                      <Input
                        type="number"
                        value={formData.sortOrder}
                        onChange={(e) =>
                          setFormData({ ...formData, sortOrder: e.target.value })
                        }
                        className="w-20"
                        min="0"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="text"
                        value={formData.ticketName}
                        onChange={(e) =>
                          setFormData({ ...formData, ticketName: e.target.value })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="text"
                        value={formData.ticketCode}
                        onChange={(e) =>
                          setFormData({ ...formData, ticketCode: e.target.value.toUpperCase() })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        value={formData.pricePerTicket}
                        onChange={(e) =>
                          setFormData({ ...formData, pricePerTicket: e.target.value })
                        }
                        step="0.01"
                        min="0"
                      />
                    </TableCell>
                    <TableCell>
                      <span
                        className={`px-2 py-1 rounded text-xs ${
                          ticketType.isActive
                            ? 'bg-green-500/10 text-green-500'
                            : 'bg-muted text-foreground'
                        }`}
                      >
                        {ticketType.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-2 justify-end">
                        <Button size="sm" onClick={handleSave} className="flex items-center gap-1">
                          <Save className="h-3 w-3" />
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleCancel}
                          className="flex items-center gap-1"
                        >
                          <X className="h-3 w-3" />
                          Cancel
                        </Button>
                      </div>
                    </TableCell>
                  </>
                ) : (
                  <>
                    <TableCell className="text-center">{ticketType.sortOrder}</TableCell>
                    <TableCell className="font-medium">{ticketType.ticketName}</TableCell>
                    <TableCell className="font-mono text-sm">{ticketType.ticketCode}</TableCell>
                    <TableCell>{formatCurrency(ticketType.pricePerTicket)}</TableCell>
                    <TableCell>
                      <button
                        onClick={() => handleToggleActive(ticketType)}
                        disabled={isReadOnly}
                        className={`px-2 py-1 rounded text-xs ${
                          ticketType.isActive
                            ? 'bg-green-500/10 text-green-500 hover:bg-green-500/20'
                            : 'bg-muted text-foreground hover:bg-muted'
                        } ${isReadOnly ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                      >
                        {ticketType.isActive ? 'Active' : 'Inactive'}
                      </button>
                    </TableCell>
                    <TableCell className="text-right">
                      {!isReadOnly && (
                        <div className="flex gap-2 justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleEdit(ticketType)}
                            className="flex items-center gap-1"
                          >
                            <Edit2 className="h-3 w-3" />
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDelete(ticketType.id)}
                            className="flex items-center gap-1 text-red-500 hover:text-red-500"
                          >
                            <Trash2 className="h-3 w-3" />
                            Delete
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </>
                )}
              </TableRow>
            ))}

            {ticketTypes.length === 0 && !isAdding && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  No ticket types configured. Click "Add Ticket Type" to get started.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
};
