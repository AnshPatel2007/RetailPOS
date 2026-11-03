import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApprovalStore } from '@/store/approvalStore';
import { api } from '@/services/api';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { formatCurrency } from '@/lib/utils';

export const ManagerApprovalDialog: React.FC = () => {
  const { request, finish } = useApprovalStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<{ action: string; amount: number; items: { name: string; quantity: number; price: number; discount: number }[] } | null>(null);
  useEffect(() => {
    setEmail(''); setPassword(''); setCode(''); setReason(''); setError(''); setSummary(null);
    if (!request) return;
    let active = true;
    api.post('/approvals/preview', { request }).then(r => { if (active) setSummary(r.data.data); }).catch(() => { if (active) setError('Unable to verify the action details. Cancel and try again.'); });
    return () => { active = false; };
  }, [request]);
  if (!request) return null;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await api.post('/approvals', { request, email, password, twoFactorCode: code || undefined, reason });
      finish?.(response.data.data.token);
    } catch (err: unknown) {
      const response = (err as { response?: { data?: { error?: string } } }).response;
      setError(response?.data?.error || 'Manager verification failed');
    } finally { setBusy(false); setPassword(''); setCode(''); }
  };
  return createPortal(<div className="relative z-[100]">
    <Modal isOpen priority="approval" onClose={() => { if (!busy) finish?.(null); }} title="Manager approval">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-muted-foreground">A manager at this store must approve this action. Your cashier session stays signed in.</p>
        {summary ? <div className="rounded border p-3 space-y-2">
          <p className="font-semibold">{summary.action} · {formatCurrency(summary.amount)}</p>
          {summary.items.map((item, index) => <p key={index} className="text-sm">{item.quantity} × {item.name} at {formatCurrency(item.price)}{item.discount > 0 ? ` · discount ${formatCurrency(item.discount)}` : ''}</p>)}
        </div> : <p role="status">Verifying action details…</p>}
        {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
        <Input label="Reason" value={reason} onChange={e => setReason(e.target.value)} required maxLength={500} />
        <Input label="Manager email" type="email" autoComplete="off" value={email} onChange={e => setEmail(e.target.value)} required />
        <Input label="Manager password" type="password" autoComplete="off" value={password} onChange={e => setPassword(e.target.value)} required />
        <Input label="Authentication code (if enabled)" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} />
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => finish?.(null)}>Cancel</Button><Button type="submit" disabled={busy || !summary}>{busy ? 'Verifying…' : 'Approve this action'}</Button></div>
      </form>
    </Modal>
  </div>, document.body);
};
