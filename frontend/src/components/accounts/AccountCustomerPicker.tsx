import { useEffect, useState } from 'react';
import { customerService } from '@/services/api';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export interface AccountCustomer { id: string; firstName: string; lastName: string; phone?: string }
export function AccountCustomerPicker({ value, onChange }: { value: AccountCustomer | null; onChange: (value: AccountCustomer | null) => void }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<AccountCustomer[]>([]);
  const [status, setStatus] = useState('');
  useEffect(() => {
    let active = true;
    setResults([]);
    if (value || search.trim().length < 2) { setStatus(''); return; }
    setStatus('Searching...');
    const timer = setTimeout(() => {
      customerService.getAll({ search: search.trim(), page: 1, limit: 5 }).then(response => {
        if (active) { setResults(response.data.data); setStatus(response.data.data.length ? '' : 'No customers found'); }
      }).catch(() => { if (active) setStatus('Customer search failed. Change the search to retry.'); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [search, value]);
  return <div className="space-y-2">
    {value ? <div className="flex justify-between items-center rounded border p-2"><span>{value.firstName} {value.lastName}</span><Button type="button" variant="outline" onClick={() => { onChange(null); setSearch(''); }}>Change customer</Button></div> : <>
      <Input label="Customer (optional)" placeholder="Search by name or phone" value={search} onChange={e => setSearch(e.target.value)} />
      <p className="text-xs text-muted-foreground">Leave unselected for an anonymous gift card.</p>
      {status && <p role="status" className="text-sm text-muted-foreground">{status}</p>}
      {results.map(customer => <button type="button" key={customer.id} className="block w-full text-left rounded border p-3 hover:bg-muted" onClick={() => onChange(customer)}>{customer.firstName} {customer.lastName} {customer.phone}</button>)}
    </>}
  </div>;
}
