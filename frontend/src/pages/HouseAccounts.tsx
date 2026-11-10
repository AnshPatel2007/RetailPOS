import { useConfirm } from '@/components/ui/useConfirm';
import { ManagementPage } from '@/components/common/Workspace';
import { useLegacyPageRefresh } from '@/hooks/useLegacyPageRefresh';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { houseAccountService, customerService, apiErrorMessage } from '@/services/api';
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
import { formatCurrency, formatDateTime, formatEnumLabel } from '@/lib/utils';
import { Search, Plus, BookUser, History, Mail, DollarSign } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/authStore';
import { useUrlFilter, useUrlPage } from '@/hooks/useUrlFilter';
import { can } from '@/lib/capabilities';
import { AccountReceipt, useAccountOperation } from '@/hooks/useAccountOperation';
import { AccountOperationFeedback, FundingFields, FundingMethod } from '@/components/accounts/AccountFunding';
import { Spinner } from '@/components/ui/LoadingState';

interface HouseAccount {
  id: string;
  customerId: string;
  creditLimit: number;
  balance: number;
  isActive: boolean;
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
  saleId: string | null;
  notes: string | null;
  createdAt: string;
}

/**
 * Charge-to-account management: open accounts with credit limits, take
 * payments against balances, review activity, and email statements.
 * Charging happens at the register via the House Account tender.
 */
export const HouseAccounts: React.FC = () => {
  const role = useAuthStore(state => state.user?.role);
  const manage = can(role, 'account.manage');
  const [accounts, setAccounts] = useState<HouseAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const requestVersion = useRef(0);
  const [loadError, setLoadError] = useState('');
  const [page, setPage] = useUrlPage();
  const [totalPages, setTotalPages] = useState(1);
  const [totalOutstanding, setTotalOutstanding] = useState<number | null>(null);
  const [confirmAccount, confirmDialog] = useConfirm();
  const [search, setSearch] = useUrlFilter('search');
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Open-account modal
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerResults, setCustomerResults] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<{ id: string; name: string } | null>(null);
  const [creditLimitInput, setCreditLimitInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Payment modal
  const [paymentAccount, setPaymentAccount] = useState<HouseAccount | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<FundingMethod>('CASH');
  const [reference, setReference] = useState('');
  const operation = useAccountOperation('house', () => {
    setPaymentAccount(null); setPaymentAmount(''); setPaymentNotes(''); setReference(''); void fetchAccounts();
  });

  // History modal
  const [historyAccount, setHistoryAccount] = useState<HouseAccount | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [txError, setTxError] = useState('');
  const historyVersion = useRef(0);

  const fetchAccounts = useCallback(async (quiet = false, active: () => boolean = () => true, signal?: AbortSignal) => {
    const version = ++requestVersion.current; if (!quiet) setLoadError('');
    if (!quiet) setLoading(true);
    try {
      const params: any = { page, limit: 25 };
      if (debouncedSearch) params.search = debouncedSearch;
      const res = await houseAccountService.getAll(params, signal);
      if (version !== requestVersion.current || !active()) return;
      setLoadError('');
      setAccounts(res.data.data);
      setTotalPages(res.data.pagination.totalPages);
      setTotalOutstanding(typeof res.data.summary?.outstanding === 'number' ? res.data.summary.outstanding : null);
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

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [search]);

  const searchCustomers = async (query: string) => {
    setCustomerSearch(query);
    if (query.length < 2) { setCustomerResults([]); return; }
    try {
      const res = await customerService.getAll({ search: query, limit: 5 });
      setCustomerResults(res.data.data || []);
    } catch { /* ignore */ }
  };

  const handleOpenAccount = async () => {
    if (!selectedCustomer) return;
    const limit = parseFloat(creditLimitInput);
    if (!limit || limit <= 0) { toast.error('Enter a valid credit limit'); return; }
    setSubmitting(true);
    try {
      await houseAccountService.create({ customerId: selectedCustomer.id, creditLimit: limit });
      toast.success(`Account opened for ${selectedCustomer.name} (${formatCurrency(limit)} limit)`);
      setShowOpenModal(false);
      setSelectedCustomer(null);
      setCustomerSearch('');
      setCreditLimitInput('');
      fetchAccounts();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to open account');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRecordPayment = async () => {
    if (!paymentAccount) return;
    const amount = parseFloat(paymentAmount);
    if (!amount || amount <= 0) { toast.error('Enter a valid amount'); return; }
    if (paymentMethod === 'CARD' && !reference.trim()) { toast.error('Enter the terminal approval reference'); return; }
    const result = await operation.submit({ path: '/house-accounts/' + paymentAccount.id + '/payment', label: paymentAccount.customer.firstName + ' ' + paymentAccount.customer.lastName, payload: {
      amount, paymentMethod, ...(paymentMethod === 'CARD' ? { reference: reference.trim() } : {}), ...(paymentNotes.trim() ? { notes: paymentNotes.trim() } : {}),
    } });
    if (result === 'unconfirmed') setPaymentAccount(null);
  };

  const openHistory = async (account: HouseAccount) => {
    const version = ++historyVersion.current;
    setHistoryAccount(account);
    setTransactions([]); setTxError(''); setTxLoading(true);
    try {
      const res = await houseAccountService.getTransactions(account.id);
      if (version === historyVersion.current) setTransactions(res.data.data);
    } catch {
      if (version === historyVersion.current) setTxError('Unable to load this account activity. Retry when connected.');
    } finally {
      if (version === historyVersion.current) setTxLoading(false);
    }
  };

  const handleEmailStatement = async (account: HouseAccount) => {
    try {
      const res = await houseAccountService.emailStatement(account.id);
      toast.success(res.data.message);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to email statement');
    }
  };


  const autoRefresh = useLegacyPageRefresh((current, signal) => fetchAccounts(true, current, signal), { key: JSON.stringify([page, debouncedSearch]), paused: loading });

  return (
    <ManagementPage className="">
      {confirmDialog}
      <PageHeader
        title="House Accounts"
        subtitle={`Charge-to-account for trusted customers${totalOutstanding ? ` · ${formatCurrency(totalOutstanding)} owed in total` : ''}`}
        icon={BookUser}
        actions={
          <>
            {manage && <Button variant="primary" size="sm" onClick={() => setShowOpenModal(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Open Account
            </Button>}
          </>
        }
      />
      {autoRefresh.notice}

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

      <div className="border rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : loadError ? (<div role="alert" className="p-4"><p>{loadError}</p><Button onClick={() => void fetchAccounts()} variant="outline" className="mt-3">Retry</Button></div>) : accounts.length === 0 ? (
          <EmptyState
            icon={BookUser}
            title="No house accounts"
            hint="Open an account to let a trusted customer or business charge purchases"
            action={manage &&
              <Button variant="primary" size="sm" onClick={() => setShowOpenModal(true)}>
                <Plus className="h-4 w-4 mr-1" /> Open Account
              </Button>
            }
          />
        ) : (
          <Table scrollLabel="House Accounts records">
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Balance Due</TableHead>
                <TableHead className="text-right">Limit</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((acc) => {
                const available = Math.max(0, Math.round((acc.creditLimit - acc.balance) * 100) / 100);
                return (
                  <TableRow key={acc.id} className={!acc.isActive ? 'bg-muted/40' : undefined}>
                    <TableCell>
                      <p className="font-medium">{acc.customer.firstName} {acc.customer.lastName}</p>
                      <p className="text-xs text-muted-foreground">{acc.customer.phone || acc.customer.email || ''}</p>
                    </TableCell>
                    <TableCell className={`text-right font-bold tabular-nums ${acc.balance > 0 ? 'text-warning' : 'text-success'}`}>
                      {formatCurrency(acc.balance)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(acc.creditLimit)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatCurrency(available)}</TableCell>
                    <TableCell>
                      <button
                        disabled={!manage}
                        aria-label={`${acc.isActive ? 'Freeze' : 'Reopen'} the account for ${acc.customer.firstName} ${acc.customer.lastName}`}
                        onClick={async () => {
                          const freezing = acc.isActive;
                          if (!await confirmAccount({
                            title: freezing ? 'Freeze this house account?' : 'Reopen this house account?',
                            message: freezing ? 'The customer can no longer charge to it. Payments are still accepted.' : 'The customer can charge to it again, up to the credit limit.',
                            confirmLabel: freezing ? 'Freeze' : 'Reopen', destructive: freezing,
                          })) return;
                          try {
                            await houseAccountService.update(acc.id, { isActive: !acc.isActive });
                            fetchAccounts();
                          } catch (error) { toast.error(apiErrorMessage(error, 'Failed to update the account')); }
                        }}
                        className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                          acc.isActive ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
                        }`}
                        title="Toggle active"
                      >
                        {acc.isActive ? 'Active' : 'Frozen'}
                      </button>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        <Button variant="outline" size="sm" onClick={() => openHistory(acc)} title="History" aria-label="History">
                          <History className="h-3 w-3" />
                        </Button>
                        {manage && <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEmailStatement(acc)}
                          title="Email statement"
                          aria-label="Email statement"
                          disabled={!acc.customer.email}
                        >
                          <Mail className="h-3 w-3" />
                        </Button>}
                        {manage && <Button
                          variant="primary"
                          size="sm"
                          onClick={() => { setPaymentMethod('CASH'); setReference(''); setPaymentAmount(''); setPaymentNotes(''); setPaymentAccount(acc); }}
                          disabled={acc.balance <= 0 || operation.blocked}
                        >
                          <DollarSign className="h-3 w-3 mr-1" /> Payment
                        </Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />

      {/* Open Account Modal */}
      <Modal isOpen={showOpenModal} onClose={() => setShowOpenModal(false)} title="Open House Account" size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Customer</label>
            {selectedCustomer ? (
              <div className="flex items-center justify-between p-2 border rounded bg-muted/50">
                <span className="font-medium">{selectedCustomer.name}</span>
                <Button variant="outline" size="sm" onClick={() => { setSelectedCustomer(null); setCustomerSearch(''); }}>
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
                        onClick={() => {
                          setSelectedCustomer({ id: c.id, name: `${c.firstName} ${c.lastName}` });
                          setCustomerResults([]);
                        }}
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

          <Input
            label="Credit limit ($)"
            type="number"
            min="1"
            step="1"
            placeholder="500"
            value={creditLimitInput}
            onChange={(e) => setCreditLimitInput(e.target.value)}
          />

          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" onClick={() => setShowOpenModal(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={handleOpenAccount}
              disabled={!selectedCustomer || !creditLimitInput || submitting}
            >
              {submitting ? 'Opening...' : 'Open Account'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Record Payment Modal */}
      <Modal
        isOpen={paymentAccount !== null}
        onClose={() => { if (!operation.busy) setPaymentAccount(null); }}
        title={paymentAccount ? `Payment — ${paymentAccount.customer.firstName} ${paymentAccount.customer.lastName}` : 'Payment'}
        size="sm"
      >
        {paymentAccount && (
          <div className="space-y-4">
            <div className="p-3 bg-muted/50 rounded-lg flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Balance due</span>
              <span className="text-xl font-bold text-warning">{formatCurrency(paymentAccount.balance)}</span>
            </div>
            <Input
              label="Amount received ($)"
              type="number"
              min="0.01"
              step="0.01"
              value={paymentAmount}
              onChange={(e) => setPaymentAmount(e.target.value)}
              autoFocus
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPaymentAmount(paymentAccount.balance.toFixed(2))}
              >
                Full balance ({formatCurrency(paymentAccount.balance)})
              </Button>
            </div>
            <FundingFields method={paymentMethod} setMethod={setPaymentMethod} reference={reference} setReference={setReference} />
            <Input
              label="Notes (optional)"
              placeholder="Payment notes..."
              value={paymentNotes}
              onChange={(e) => setPaymentNotes(e.target.value)}
            />
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" disabled={operation.busy} onClick={() => setPaymentAccount(null)}>Cancel</Button>
              <Button variant="primary" onClick={handleRecordPayment} disabled={!paymentAmount || operation.blocked || (paymentMethod === 'CARD' && !reference.trim())}>
                {operation.busy ? 'Saving...' : 'Record Payment'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* History Modal */}
      <Modal
        isOpen={historyAccount !== null}
        onClose={() => { historyVersion.current++; setHistoryAccount(null); setTransactions([]); setTxError(''); }}
        title={historyAccount ? `Activity — ${historyAccount.customer.firstName} ${historyAccount.customer.lastName}` : 'Activity'}
        size="lg"
      >
        <div className="max-h-[420px] overflow-y-auto border rounded-lg divide-y">
          {txLoading ? (
            <p className="text-center py-8 text-muted-foreground">Loading...</p>
          ) : txError ? (
            <div role="alert" className="p-4 space-y-3"><p>{txError}</p><Button variant="outline" onClick={() => { if (historyAccount) void openHistory(historyAccount); }}>Retry account activity</Button></div>
          ) : transactions.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">No activity yet</p>
          ) : (
            transactions.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between px-4 py-2">
                <div>
                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                    tx.type === 'CHARGE' ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'
                  }`}>
                    {formatEnumLabel(tx.type)}
                  </span>
                  {tx.operation && <Button variant="outline" size="sm" onClick={() => operation.showReceipt(tx.operation!, historyAccount ? historyAccount.customer.firstName + ' ' + historyAccount.customer.lastName : 'House account')}>Receipt</Button>}
                  {!tx.operation && tx.type === 'PAYMENT' && <p className="text-xs text-muted-foreground">Original payment details unavailable</p>}
                  {tx.notes && <span className="text-xs text-muted-foreground ml-2">{tx.notes}</span>}
                  <div className="text-xs text-muted-foreground mt-0.5">{formatDateTime(tx.createdAt)}</div>
                </div>
                <div className="text-right">
                  {/* Charges add to what is owed; payments and refund reversals (stored negative) reduce it. */}
                  <div className={`font-medium ${tx.type === 'PAYMENT' || tx.amount < 0 ? 'text-success' : ''}`}>
                    {tx.type === 'PAYMENT' || tx.amount < 0 ? '−' : '+'}{formatCurrency(Math.abs(tx.amount))}
                  </div>
                  <div className="text-xs text-muted-foreground">Owes: {formatCurrency(tx.balanceAfter)}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </Modal>
    </ManagementPage>
  );
};
