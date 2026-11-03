import { ManagementPage } from '@/components/common/Workspace';
import { Select } from '@/components/ui/Select';
import { useLegacyPageRefresh } from '@/hooks/useLegacyPageRefresh';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { storeCreditService, customerService } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
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
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils';
import {
  Search,
  Plus,
  Wallet,
  History,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/authStore';
import { useUrlFilter, useUrlPage } from '@/hooks/useUrlFilter';
import { can } from '@/lib/capabilities';
import { AccountReceipt, useAccountOperation } from '@/hooks/useAccountOperation';
import { AccountOperationFeedback } from '@/components/accounts/AccountFunding';

interface StoreCreditAccount {
  id: string;
  customerId: string;
  balance: number;
  createdAt: string;
  updatedAt: string;
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    email: string | null;
  };
}

interface Transaction {
  operation?: AccountReceipt;
  id: string;
  type: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  notes: string | null;
  saleId: string | null;
  createdAt: string;
}

export const StoreCredits: React.FC = () => {
  const role = useAuthStore(state => state.user?.role);
  const manage = can(role, 'account.manage');
  const [accounts, setAccounts] = useState<StoreCreditAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const requestVersion = useRef(0);
  const [loadError, setLoadError] = useState('');
  const [page, setPage] = useUrlPage();
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useUrlFilter('search');
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>();
  const [showAddModal, setShowAddModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<StoreCreditAccount | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [txError, setTxError] = useState('');
  const historyVersion = useRef(0);

  // Add credit form
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerResults, setCustomerResults] = useState<any[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedCustomerName, setSelectedCustomerName] = useState('');
  const [creditAmount, setCreditAmount] = useState('');
  const [creditNotes, setCreditNotes] = useState('');
  const [source, setSource] = useState<'GOODWILL' | 'CORRECTION'>('GOODWILL');
  const operation = useAccountOperation('credit', () => { setShowAddModal(false); resetAddForm(); void fetchAccounts(); });

  const fetchAccounts = useCallback(async (quiet = false, active: () => boolean = () => true, signal?: AbortSignal) => {
    const version = ++requestVersion.current; if (!quiet) setLoadError('');
    if (!quiet) setLoading(true);
    try {
      const params: any = { page, limit: 25 };
      if (debouncedSearch) params.search = debouncedSearch;
      const res = await storeCreditService.getAll(params, signal);
      if (version !== requestVersion.current || !active()) return;
      setLoadError('');
      setAccounts(res.data.data);
      setTotalPages(res.data.pagination.totalPages);
    } catch (failure) {
      if (quiet) throw failure;
      if (version === requestVersion.current) setLoadError('Unable to load accounts. Try again.');
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [page, debouncedSearch]);

  useEffect(() => {
    fetchAccounts();
    return () => { requestVersion.current++; };
  }, [fetchAccounts]);
  useEffect(() => () => { historyVersion.current++; }, []);

  // Live search, debounced — no submit button needed
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [search]);

  const openHistory = async (account: StoreCreditAccount) => {
    const version = ++historyVersion.current;
    setSelectedAccount(account);
    setShowHistoryModal(true);
    setTransactions([]); setTxError(''); setTxLoading(true);
    try {
      const res = await storeCreditService.getTransactions(account.customerId);
      if (version === historyVersion.current) setTransactions(res.data.data);
    } catch {
      if (version === historyVersion.current) setTxError('Unable to load this account activity. Retry when connected.');
    } finally {
      if (version === historyVersion.current) setTxLoading(false);
    }
  };

  const searchCustomers = async (query: string) => {
    setCustomerSearch(query);
    if (query.length < 2) {
      setCustomerResults([]);
      return;
    }
    try {
      const res = await customerService.getAll({ search: query, limit: 5 });
      setCustomerResults(res.data.data || []);
    } catch {
      // ignore
    }
  };

  const selectCustomer = (c: any) => {
    setSelectedCustomerId(c.id);
    setSelectedCustomerName(`${c.firstName} ${c.lastName}`);
    setCustomerSearch(`${c.firstName} ${c.lastName}`);
    setCustomerResults([]);
  };

  const handleAddCredit = async () => {
    if (!selectedCustomerId || !creditAmount) return;
    const amount = parseFloat(creditAmount);
    if (isNaN(amount) || amount <= 0) {
      toast.error('Enter a valid amount');
      return;
    }

    if (creditNotes.trim().length < 3) { toast.error('Enter a reason for the credit'); return; }
    const result = await operation.submit({ path: '/store-credit/' + selectedCustomerId + '/credit', label: selectedCustomerName, payload: { amount, source, notes: creditNotes.trim() } });
    if (result === 'unconfirmed') setShowAddModal(false);
  };

  const resetAddForm = () => {
    setCustomerSearch('');
    setCustomerResults([]);
    setSelectedCustomerId('');
    setSelectedCustomerName('');
    setCreditAmount('');
    setCreditNotes(''); setSource('GOODWILL');
  };

  const autoRefresh = useLegacyPageRefresh((current, signal) => fetchAccounts(true, current, signal), { key: JSON.stringify([page, debouncedSearch]), paused: loading });

  return (
    <ManagementPage className="">
      <PageHeader
        title="Store Credits"
        subtitle="Issue and track customer store credit balances"
        icon={Wallet}
        actions={
          <>
            {manage && <Button variant="primary" size="sm" disabled={operation.blocked} onClick={() => setShowAddModal(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Issue Credit
            </Button>}
          </>
        }
      />
      {autoRefresh.notice}

      {/* Search */}
      <AccountOperationFeedback operation={operation} />
      <div className="relative max-w-md mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, phone, or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Accounts table */}
      <div className="border rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        ) : loadError ? (<div role="alert" className="p-4"><p>{loadError}</p><Button onClick={() => void fetchAccounts()} variant="outline" className="mt-3">Retry</Button></div>) : accounts.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="No store credit accounts found"
            hint={search ? 'Try adjusting your search' : 'Issue a credit to create the first account'}
          />
        ) : (
          <Table scrollLabel="Store Credits records">
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Last Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((acc) => (
                <TableRow key={acc.id}>
                  <TableCell className="font-medium">
                    {acc.customer.firstName} {acc.customer.lastName}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {acc.customer.phone || acc.customer.email || '-'}
                  </TableCell>
                  <TableCell className="text-right font-bold text-success">
                    {formatCurrency(acc.balance)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {formatDate(acc.updatedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      <Button variant="outline" size="sm" onClick={() => openHistory(acc)}>
                        <History className="h-3 w-3 mr-1" /> History
                      </Button>
                      {manage && <Button
                        disabled={operation.blocked}
                        variant="primary"
                        size="sm"
                        onClick={() => {
                          setSelectedCustomerId(acc.customerId);
                          setSelectedCustomerName(`${acc.customer.firstName} ${acc.customer.lastName}`);
                          setCustomerSearch(`${acc.customer.firstName} ${acc.customer.lastName}`);
                          setShowAddModal(true);
                        }}
                      >
                        <Plus className="h-3 w-3 mr-1" /> Add
                      </Button>}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />

      {/* Add Credit Modal */}
      <Modal isOpen={showAddModal} onClose={() => { if (!operation.busy) { setShowAddModal(false); resetAddForm(); } }} title="Issue Store Credit" size="md">
        <div className="space-y-4">
          {/* Customer search */}
          <div>
            <label className="block text-sm font-medium mb-1">Customer</label>
            {selectedCustomerId ? (
              <div className="flex items-center justify-between p-2 border rounded bg-muted/50">
                <span className="font-medium">{selectedCustomerName}</span>
                <Button variant="outline" size="sm" onClick={() => { setSelectedCustomerId(''); setSelectedCustomerName(''); setCustomerSearch(''); }}>
                  Change
                </Button>
              </div>
            ) : (
              <div className="relative">
                <Input
                  placeholder="Search customer by name, phone..."
                  value={customerSearch}
                  onChange={(e) => searchCustomers(e.target.value)}
                />
                {customerResults.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 border rounded-lg bg-background shadow-lg max-h-[200px] overflow-y-auto">
                    {customerResults.map((c: any) => (
                      <button
                        key={c.id}
                        onClick={() => selectCustomer(c)}
                        className="w-full px-3 py-2 text-left hover:bg-muted text-sm"
                      >
                        <span className="font-medium">{c.firstName} {c.lastName}</span>
                        {c.phone && <span className="text-muted-foreground ml-2">{c.phone}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Amount */}
          <div>
            <Input label="Amount ($)"
              type="number"
              min="0.01"
              step="0.01"
              placeholder="0.00"
              value={creditAmount}
              onChange={(e) => setCreditAmount(e.target.value)}
            />
          </div>

          <p className="text-sm text-muted-foreground">For a returned purchase, issue credit from the original sale refund. This form records a goodwill credit or an owner-approved correction.</p>
          <label className="block text-sm font-medium">Credit source
            <Select className="block w-full h-11 mt-1 rounded border bg-background px-3" value={source} onChange={e => setSource(e.target.value as 'GOODWILL' | 'CORRECTION')}>
              <option value="GOODWILL">Goodwill credit</option>{can(role, 'account.grant') && <option value="CORRECTION">Balance correction</option>}
            </Select>
          </label>
          {/* Notes */}
          <div>
            <Input label="Credit reason" required minLength={3} maxLength={500}
              placeholder="Reason for credit..."
              value={creditNotes}
              onChange={(e) => setCreditNotes(e.target.value)}
            />
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" disabled={operation.busy} onClick={() => { setShowAddModal(false); resetAddForm(); }}>Cancel</Button>
            <Button
              variant="primary"
              onClick={handleAddCredit}
              disabled={!selectedCustomerId || !creditAmount || creditNotes.trim().length < 3 || operation.blocked}
            >
              {operation.busy ? 'Processing...' : 'Issue Credit'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Transaction History Modal */}
      <Modal
        isOpen={showHistoryModal}
        onClose={() => { historyVersion.current++; setShowHistoryModal(false); setSelectedAccount(null); setTransactions([]); setTxError(''); }}
        title={`Transaction History - ${selectedAccount?.customer.firstName} ${selectedAccount?.customer.lastName}`}
        size="lg"
      >
        <div className="space-y-3">
          {selectedAccount && (
            <div className="p-3 bg-muted/50 rounded-lg flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Current Balance</span>
              <span className="text-xl font-bold text-success">{formatCurrency(selectedAccount.balance)}</span>
            </div>
          )}

          <div className="max-h-[400px] overflow-y-auto border rounded-lg divide-y">
            {txLoading ? (
              <p className="text-center py-8 text-muted-foreground">Loading...</p>
            ) : txError ? (
              <div role="alert" className="p-4 space-y-3"><p>{txError}</p><Button variant="outline" onClick={() => { if (selectedAccount) void openHistory(selectedAccount); }}>Retry account activity</Button></div>
            ) : transactions.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground">No transactions yet</p>
            ) : (
              transactions.map((tx) => (
                <div key={tx.id} className="flex items-center justify-between px-4 py-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                        tx.type === 'CREDIT' ? 'bg-success/10 text-success' :
                        tx.type === 'DEBIT' ? 'bg-destructive/10 text-destructive' :
                        'bg-info/10 text-info'
                      }`}>
                        {tx.type}
                      </span>
                      {tx.operation && <Button variant="outline" size="sm" onClick={() => operation.showReceipt(tx.operation!, selectedAccount ? selectedAccount.customer.firstName + ' ' + selectedAccount.customer.lastName : 'Store credit')}>Receipt</Button>}
                      {!tx.operation && tx.type === 'CREDIT' && !tx.saleId && <p className="text-xs text-muted-foreground">Original source details unavailable</p>}
                      {tx.notes && <span className="text-xs text-muted-foreground">{tx.notes}</span>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {formatDateTime(tx.createdAt)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`font-medium ${tx.amount >= 0 ? 'text-success' : 'text-destructive'}`}>
                      {tx.amount >= 0 ? '+' : '-'}{formatCurrency(Math.abs(tx.amount))}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Bal: {formatCurrency(tx.balanceAfter)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </Modal>
    </ManagementPage>
  );
};
