import { ManagementPage, SummaryStrip } from '@/components/common/Workspace';
import { useLegacyPageRefresh } from '@/hooks/useLegacyPageRefresh';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Gift, Plus, Search, RefreshCw, Ban } from 'lucide-react';
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
import { useAuthStore } from '@/store/authStore';
import { useUrlFilter, useUrlPage } from '@/hooks/useUrlFilter';
import { can } from '@/lib/capabilities';
import { AccountReceipt, useAccountOperation } from '@/hooks/useAccountOperation';
import { AccountOperationFeedback, FundingFields, FundingMethod } from '@/components/accounts/AccountFunding';
import { AccountCustomer, AccountCustomerPicker } from '@/components/accounts/AccountCustomerPicker';
import { Spinner } from '@/components/ui/LoadingState';

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
  const requestVersion = useRef(0);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useUrlFilter('search');
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [showReloadModal, setShowReloadModal] = useState(false);
  const [selectedCard, setSelectedCard] = useState<GiftCard | null>(null);
  const [page, setPage] = useUrlPage();
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<{ totalCards: number; activeCards: number; outstandingBalance: number } | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Debounce search
  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  // Issue form
  const [issueAmount, setIssueAmount] = useState('');
  const [issueCustomer, setIssueCustomer] = useState<AccountCustomer | null>(null);
  const [issueExpiry, setIssueExpiry] = useState('');

  // Reload form
  const [reloadAmount, setReloadAmount] = useState('');
  const role = useAuthStore(state => state.user?.role);
  const manage = can(role, 'account.manage');
  const [fundingMethod, setFundingMethod] = useState<FundingMethod>('CASH');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [history, setHistory] = useState<{ card: GiftCard; transactions: { id: string; type: string; amount: number; createdAt: string; operation?: AccountReceipt }[] } | null>(null);
  const operation = useAccountOperation('gift', () => {
    setShowIssueModal(false); setShowReloadModal(false); setIssueAmount(''); setReloadAmount('');
    setIssueCustomer(null); setIssueExpiry(''); setReference(''); setReason('');
    void fetchGiftCards(); void fetchStats();
  });
  const funding = () => ({ paymentMethod: fundingMethod, ...(fundingMethod === 'CARD' ? { reference: reference.trim() } : {}), ...(fundingMethod === 'PROMOTIONAL' ? { notes: reason.trim() } : {}) });
  const openHistory = async (card: GiftCard) => {
    try { const response = await giftCardService.getById(card.id); setHistory({ card, transactions: response.data.data.transactions }); }
    catch { toast.error('Unable to load card history. Try again.'); }
  };

  const fetchGiftCards = useCallback(async (quiet = false, active: () => boolean = () => true, signal?: AbortSignal) => {
    const version = ++requestVersion.current; if (!quiet) setLoadError('');
    if (!quiet) setLoading(true);
    try {
      const { data } = await giftCardService.getAll({ page, limit: 20, search: debouncedSearch }, signal);
      if (version !== requestVersion.current || !active()) return;
      setLoadError('');
      setGiftCards(data.data);
      setTotal(data.total);
    } catch (failure) {
      if (quiet) throw failure;
      if (version === requestVersion.current) setLoadError('Unable to load accounts. Try again.');
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [page, debouncedSearch]);

  useEffect(() => {
    fetchGiftCards();
    return () => { requestVersion.current++; };
  }, [fetchGiftCards]);

  const fetchStats = useCallback(async (quiet = false, active: () => boolean = () => true, signal?: AbortSignal) => {
    try {
      const { data } = await giftCardService.getStats(signal);
      if (!active()) return;
      setStats(data.data);
    } catch (failure) {
      if (quiet) throw failure;
      setStats(null);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const handleIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await operation.submit({ path: '/gift-cards', label: 'New gift card', payload: {
      amount: Number(issueAmount), ...funding(), ...(issueCustomer ? { customerId: issueCustomer.id } : {}), ...(issueExpiry ? { expiresAt: issueExpiry } : {}),
    } });
    if (result === 'unconfirmed') setShowIssueModal(false);
  };
  const handleReload = async (e: React.FormEvent) => {
    e.preventDefault(); if (!selectedCard) return;
    const result = await operation.submit({ path: '/gift-cards/' + selectedCard.id + '/reload', label: selectedCard.code, payload: { amount: Number(reloadAmount), ...funding() } });
    if (result === 'unconfirmed') setShowReloadModal(false);
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

  const autoRefresh = useLegacyPageRefresh((current, signal) => Promise.all([fetchGiftCards(true, current, signal), fetchStats(true, current, signal)]), { key: JSON.stringify([page, debouncedSearch]), paused: loading });

  return (
    <ManagementPage className="">
      <PageHeader
        title="Gift Cards"
        subtitle="Issue, manage, and track gift cards"
        actions={manage &&
          <Button variant="primary" disabled={operation.blocked} onClick={() => { setFundingMethod('CASH'); setReference(''); setReason(''); setShowIssueModal(true); }}>
            <Plus className="w-4 h-4 mr-2" />
            Issue Gift Card
          </Button>
        }
      />
      {autoRefresh.notice}

      <AccountOperationFeedback operation={operation} />
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
      <SummaryStrip className="mb-6" items={[
        { label: 'Total cards', value: stats?.totalCards ?? '—' },
        { label: 'Active', value: stats?.activeCards ?? '—' },
        { label: 'Outstanding balance', value: stats ? formatCurrency(stats.outstandingBalance) : '—', detail: 'Owed to card holders' },
      ]} />

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>Gift Cards</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner size="lg" />
            </div>
          ) : loadError ? (<div role="alert" className="p-4"><p>{loadError}</p><Button onClick={() => void fetchGiftCards()} variant="outline" className="mt-3">Retry</Button></div>) : giftCards.length === 0 ? (
            <EmptyState
              icon={Gift}
              title="No gift cards found"
              hint={search ? 'Try a different code' : 'Issue your first gift card to get started'}
            />
          ) : (
            <Table scrollLabel="Gift Cards records">
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead className="text-right">Initial</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
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
                    <TableCell className="text-right whitespace-nowrap">{formatCurrency(card.initialBalance)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap font-medium">{formatCurrency(card.currentBalance)}</TableCell>
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
                        <Button variant="outline" size="sm" onClick={() => void openHistory(card)}>History</Button>
                        {manage && card.isActive && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={operation.blocked || (!!card.expiresAt && new Date(card.expiresAt) <= new Date())} onClick={() => { setFundingMethod('CASH'); setReference(''); setReason(''); setSelectedCard(card); setShowReloadModal(true); }}
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
      <Modal isOpen={showIssueModal} onClose={() => { if (!operation.busy) setShowIssueModal(false); }} title="Issue Gift Card">
        <form onSubmit={handleIssue} className="space-y-4">
          <div>
            <Input label="Amount"
              type="number"
              step="0.01"
              min="0.01"
              value={issueAmount}
              onChange={(e) => setIssueAmount(e.target.value)}
              required
              placeholder="50.00"
            />
          </div>
          <AccountCustomerPicker value={issueCustomer} onChange={setIssueCustomer} />
          <div>
            <Input label="Expiry date (optional)"
              type="date"
              value={issueExpiry}
              onChange={(e) => setIssueExpiry(e.target.value)}
            />
          </div>
          <FundingFields method={fundingMethod} setMethod={setFundingMethod} reference={reference} setReference={setReference} reason={reason} setReason={setReason} allowGrant={can(role, 'account.grant')} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" disabled={operation.busy} onClick={() => setShowIssueModal(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={operation.blocked}>
              Issue Card
            </Button>
          </div>
        </form>
      </Modal>

      {/* Reload Modal */}
      <Modal isOpen={showReloadModal} onClose={() => { if (!operation.busy) { setShowReloadModal(false); setSelectedCard(null); } }} title="Reload Gift Card">
        <form onSubmit={handleReload} className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Card: <span className="font-mono font-medium text-foreground">{selectedCard?.code}</span>
            <br />
            Current Balance: <span className="font-medium text-foreground">{selectedCard && formatCurrency(selectedCard.currentBalance)}</span>
          </p>
          <div>
            <Input label="Reload amount"
              type="number"
              step="0.01"
              min="0.01"
              value={reloadAmount}
              onChange={(e) => setReloadAmount(e.target.value)}
              required
            />
          </div>
          <FundingFields method={fundingMethod} setMethod={setFundingMethod} reference={reference} setReference={setReference} reason={reason} setReason={setReason} allowGrant={can(role, 'account.grant')} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" disabled={operation.busy} onClick={() => { setShowReloadModal(false); setSelectedCard(null); }}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={operation.blocked}>
              Reload
            </Button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!history} onClose={() => setHistory(null)} title="Gift card history" size="lg">
        <p className="font-mono mb-4">{history?.card.code}</p>
        <p className="text-sm text-muted-foreground mb-4">Latest 100 transactions</p>
        {history?.transactions.map(tx => <div key={tx.id} className="border-b py-3 flex justify-between items-center gap-3">
          <div><p>{tx.type} {formatCurrency(tx.amount)}</p><p className="text-sm text-muted-foreground">{new Date(tx.createdAt).toLocaleString()}</p>
            {!tx.operation && ['ISSUE', 'RELOAD'].includes(tx.type) && <p className="text-sm text-muted-foreground">Original funding details unavailable</p>}
          </div>
          {tx.operation && <Button variant="outline" size="sm" onClick={() => operation.showReceipt(tx.operation!, history.card.code)}>Receipt</Button>}
        </div>)}
        {history?.transactions.length === 0 && <p>No transactions recorded.</p>}
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
    </ManagementPage>
  );
};
