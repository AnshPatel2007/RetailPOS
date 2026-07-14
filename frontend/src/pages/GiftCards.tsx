import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Gift, Plus, Search, RefreshCw, CreditCard, Ban, DollarSign } from 'lucide-react';
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
  const [stats, setStats] = useState({ totalCards: 0, activeCards: 0, outstandingBalance: 0 });
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Debounce search
  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  // Issue form
  const [issueAmount, setIssueAmount] = useState('');
  const [issueCustomerId, setIssueCustomerId] = useState('');
  const [issueExpiry, setIssueExpiry] = useState('');

  // Reload form
  const [reloadAmount, setReloadAmount] = useState('');

  const fetchGiftCards = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await giftCardService.getAll({ page, limit: 20, search: debouncedSearch });
      setGiftCards(data.data);
      setTotal(data.total);
    } catch {
      toast.error('Failed to load gift cards');
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch]);

  useEffect(() => {
    fetchGiftCards();
  }, [fetchGiftCards]);

  const fetchStats = useCallback(async () => {
    try {
      const { data } = await giftCardService.getStats();
      setStats(data.data);
    } catch {
      // Stat cards fall back to zeros; the table error toast covers load failures
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const handleIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { data } = await giftCardService.issue({
        amount: parseFloat(issueAmount),
        customerId: issueCustomerId || undefined,
        expiresAt: issueExpiry || undefined,
      });
      toast.success(`Gift card issued: ${data.data.code}`);
      setShowIssueModal(false);
      setIssueAmount('');
      setIssueCustomerId('');
      setIssueExpiry('');
      fetchGiftCards();
      fetchStats();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to issue gift card');
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
      fetchStats();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to reload');
    }
  };

  const [deactivateTarget, setDeactivateTarget] = useState<GiftCard | null>(null);

  const handleDeactivate = async (card: GiftCard) => {
    try {
      await giftCardService.deactivate(card.id);
      toast.success('Gift card deactivated');
      fetchGiftCards();
      fetchStats();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to deactivate');
    }
  };

  const totalPages = Math.ceil(total / 20);

  return (
    <div className="p-8">
      <PageHeader
        title="Gift Cards"
        subtitle="Issue, manage, and track gift cards"
        actions={
          <Button variant="primary" onClick={() => setShowIssueModal(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Issue Gift Card
          </Button>
        }
      />

      {/* Search */}
      <div className="relative max-w-md mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search by code..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
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
              <p className="text-xl font-bold">{stats.totalCards}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 bg-success/10 rounded-lg">
              <CreditCard className="w-5 h-5 text-success" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Active</p>
              <p className="text-xl font-bold">{stats.activeCards}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 bg-info/10 rounded-lg">
              <DollarSign className="w-5 h-5 text-info" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Outstanding Balance</p>
              <p className="text-xl font-bold">{formatCurrency(stats.outstandingBalance)}</p>
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
            <EmptyState
              icon={Gift}
              title="No gift cards found"
              hint={search ? 'Try a different code' : 'Issue your first gift card to get started'}
            />
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
                      <Badge className={card.isActive ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}>
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
                              onClick={() => setDeactivateTarget(card)}
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

          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} totalItems={total} itemName="cards" />
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

      <ConfirmDialog
        isOpen={deactivateTarget !== null}
        onClose={() => setDeactivateTarget(null)}
        onConfirm={() => deactivateTarget && handleDeactivate(deactivateTarget)}
        title="Deactivate gift card?"
        message={`Gift card ${deactivateTarget?.code || ''} will no longer be usable for payments.`}
        destructive
        confirmLabel="Deactivate"
      />
    </div>
  );
};
