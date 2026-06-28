import React, { useState, useEffect, useCallback } from 'react';
import { Gift, Plus, Search, RefreshCw, CreditCard, Ban, DollarSign } from 'lucide-react';
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
import { giftCardService } from '@/services/api';
import { formatCurrency } from '@/lib/utils';
import toast from 'react-hot-toast';

interface GiftCard {
  id: string;
  code: string;
  initialBalance: number;
  currentBalance: number;
  isActive: boolean;
  expiresAt: string | null;
  customerId: string | null;
  createdAt: string;
}

export const GiftCards: React.FC = () => {
  const [giftCards, setGiftCards] = useState<GiftCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [showReloadModal, setShowReloadModal] = useState(false);
  const [selectedCard, setSelectedCard] = useState<GiftCard | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  // Issue form
  const [issueAmount, setIssueAmount] = useState('');
  const [issueCustomerId, setIssueCustomerId] = useState('');
  const [issueExpiry, setIssueExpiry] = useState('');

  // Reload form
  const [reloadAmount, setReloadAmount] = useState('');

  const fetchGiftCards = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await giftCardService.getAll({ page, limit: 20, search });
      setGiftCards(data.data);
      setTotal(data.total);
    } catch {
      toast.error('Failed to load gift cards');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    fetchGiftCards();
  }, [fetchGiftCards]);

  const handleIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { data } = await giftCardService.issue({
        initialBalance: parseFloat(issueAmount),
        customerId: issueCustomerId || undefined,
        expiresAt: issueExpiry || undefined,
      });
      toast.success(`Gift card issued: ${data.data.code}`);
      setShowIssueModal(false);
      setIssueAmount('');
      setIssueCustomerId('');
      setIssueExpiry('');
      fetchGiftCards();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to issue gift card');
    }
  };

  const handleReload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCard) return;
    try {
      await giftCardService.reload(selectedCard.id, { amount: parseFloat(reloadAmount) });
      toast.success('Gift card reloaded');
      setShowReloadModal(false);
      setReloadAmount('');
      setSelectedCard(null);
      fetchGiftCards();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to reload');
    }
  };

  const handleDeactivate = async (card: GiftCard) => {
    if (!confirm(`Deactivate gift card ${card.code}?`)) return;
    try {
      await giftCardService.deactivate(card.id);
      toast.success('Gift card deactivated');
      fetchGiftCards();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to deactivate');
    }
  };

  const totalPages = Math.ceil(total / 20);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">Gift Cards</h1>
          <p className="text-muted-foreground">Issue, manage, and track gift cards</p>
        </div>
        <Button variant="primary" onClick={() => setShowIssueModal(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Issue Gift Card
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-md mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search by code..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="pl-10"
        />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Gift className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Cards</p>
              <p className="text-xl font-bold">{total}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 bg-green-500/10 rounded-lg">
              <CreditCard className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Active</p>
              <p className="text-xl font-bold">{giftCards.filter(g => g.isActive).length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <DollarSign className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Outstanding Balance</p>
              <p className="text-xl font-bold">
                {formatCurrency(giftCards.reduce((sum, g) => sum + (g.isActive ? g.currentBalance : 0), 0))}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>Gift Cards</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : giftCards.length === 0 ? (
            <div className="p-12 text-center">
              <Gift className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No gift cards found</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Initial</TableHead>
                  <TableHead>Balance</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {giftCards.map((card) => (
                  <TableRow key={card.id}>
                    <TableCell className="font-mono font-medium">{card.code}</TableCell>
                    <TableCell>{formatCurrency(card.initialBalance)}</TableCell>
                    <TableCell className="font-medium">{formatCurrency(card.currentBalance)}</TableCell>
                    <TableCell>
                      <Badge className={card.isActive ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}>
                        {card.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {card.expiresAt ? new Date(card.expiresAt).toLocaleDateString() : 'Never'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(card.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {card.isActive && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => { setSelectedCard(card); setShowReloadModal(true); }}
                              title="Reload"
                            >
                              <RefreshCw className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeactivate(card)}
                              className="text-destructive hover:text-destructive"
                              title="Deactivate"
                            >
                              <Ban className="w-4 h-4" />
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

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-4">
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                Previous
              </Button>
              <span className="px-3 py-1 text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                Next
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Issue Modal */}
      <Modal isOpen={showIssueModal} onClose={() => setShowIssueModal(false)} title="Issue Gift Card">
        <form onSubmit={handleIssue} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Amount *</label>
            <Input
              type="number"
              step="0.01"
              min="1"
              value={issueAmount}
              onChange={(e) => setIssueAmount(e.target.value)}
              required
              placeholder="50.00"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Customer ID (optional)</label>
            <Input
              value={issueCustomerId}
              onChange={(e) => setIssueCustomerId(e.target.value)}
              placeholder="Leave blank for anonymous"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Expiry Date (optional)</label>
            <Input
              type="date"
              value={issueExpiry}
              onChange={(e) => setIssueExpiry(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => setShowIssueModal(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit">
              Issue Card
            </Button>
          </div>
        </form>
      </Modal>

      {/* Reload Modal */}
      <Modal isOpen={showReloadModal} onClose={() => { setShowReloadModal(false); setSelectedCard(null); }} title="Reload Gift Card">
        <form onSubmit={handleReload} className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Card: <span className="font-mono font-medium text-foreground">{selectedCard?.code}</span>
            <br />
            Current Balance: <span className="font-medium text-foreground">{selectedCard && formatCurrency(selectedCard.currentBalance)}</span>
          </p>
          <div>
            <label className="block text-sm font-medium mb-1">Reload Amount *</label>
            <Input
              type="number"
              step="0.01"
              min="1"
              value={reloadAmount}
              onChange={(e) => setReloadAmount(e.target.value)}
              required
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => { setShowReloadModal(false); setSelectedCard(null); }}>
              Cancel
            </Button>
            <Button variant="primary" type="submit">
              Reload
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
