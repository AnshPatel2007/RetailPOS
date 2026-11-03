import { useEffect, useState } from 'react';
import { inventoryTransferService } from '@/services/api';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ArrowLeftRight, Check, Link2, Plus, Search, Store, Unlink } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface ConnectionStore { id: string; name: string; email: string; city: string; state: string; isActive: boolean }
interface Connection { id: string; locationA: { id: string; name: string }; locationB: { id: string; name: string } }
export function StoreConnections({ stores, store, onClose }: { stores: ConnectionStore[]; store: ConnectionStore; onClose: () => void }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'connected' | 'available'>('connected');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    inventoryTransferService.connections().then(response => { if (active) { setConnections(response.data.data); setError(''); } })
      .catch(() => { if (active) setError('Could not load store connections. Try again before making changes.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [store.id, retry]);
  const ownConnections = connections.filter(connection => connection.locationA.id === store.id || connection.locationB.id === store.id);
  const connectionByPartner = new Map(ownConnections.map(connection => [connection.locationA.id === store.id ? connection.locationB.id : connection.locationA.id, connection]));
  const partners = stores.filter(partner => partner.id !== store.id);
  const availableCount = partners.filter(partner => partner.isActive && !connectionByPartner.has(partner.id)).length;
  const filtered = partners.filter(partner => (tab === 'connected' ? connectionByPartner.has(partner.id) : partner.isActive && !connectionByPartner.has(partner.id)) && [partner.name, partner.email, partner.city, partner.state].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
  const mutate = async (partner: ConnectionStore, connection?: Connection) => {
    setBusy(partner.id);
    try {
      if (connection) await inventoryTransferService.disconnect(connection.id);
      else await inventoryTransferService.connect(store.id, partner.id);
      const response = await inventoryTransferService.connections();
      setConnections(response.data.data); setRemoving(null); setError('');
      toast.success(connection ? 'Stores disconnected' : `${partner.name} connected`);
    } catch (e: any) { setError(e.response?.data?.error || 'Could not update connections. Refresh and try again.'); }
    finally { setBusy(null); }
  };
  return <Modal isOpen onClose={() => { if (!busy) onClose(); }} title="Transfer connections" size="lg" className="rounded-2xl"><div className="space-y-5">
    <div className="flex items-center gap-4 rounded-xl border border-primary/20 bg-primary/5 p-4"><div className="rounded-xl bg-primary/10 p-3"><Store className="h-6 w-6 text-primary" /></div><div className="min-w-0"><p className="font-semibold break-words">{store.name}</p><p className="text-sm text-muted-foreground break-all">{store.email}</p></div><ArrowLeftRight className="ml-auto h-5 w-5 shrink-0 text-primary" /></div>
    <p className="text-sm leading-relaxed text-muted-foreground">Choose this store's transfer partners. Connected stores can send stock in both directions, and each owner keeps their own account.</p>
    {!store.isActive && <p className="rounded-lg bg-warning/10 p-3 text-sm">This store is inactive. Activate it before adding transfer partners.</p>}
    <div className="flex gap-1 rounded-xl bg-muted p-1" role="group" aria-label="Connection list">{[{ id: 'connected' as const, label: 'Connected', count: ownConnections.length }, { id: 'available' as const, label: 'Find stores', count: availableCount }].map(option => <button key={option.id} type="button" aria-pressed={tab === option.id} onClick={() => { setTab(option.id); setRemoving(null); }} className={cn('min-h-11 flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', tab === option.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{option.label} <span className="ml-1 text-xs text-muted-foreground">{loading ? '' : option.count}</span></button>)}</div>
    <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input aria-label="Search partner stores" placeholder="Search by store, owner email or city" className="pl-9 rounded-xl" value={query} onChange={event => setQuery(event.target.value)} /></div>
    {error && <div role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm"><p>{error}</p><Button variant="outline" size="sm" className="mt-2" disabled={Boolean(busy)} onClick={() => setRetry(value => value + 1)}>Retry</Button></div>}
    {loading ? <p role="status" className="py-8 text-center text-sm text-muted-foreground">Loading connections...</p> : <div className="max-h-80 space-y-3 overflow-y-auto pr-1">{filtered.map(partner => {
      const connection = connectionByPartner.get(partner.id);
      return <div key={partner.id} className="rounded-xl border p-4 space-y-3"><div className="flex flex-wrap items-center gap-3"><div className={cn('rounded-lg p-2', connection ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground')}>{connection ? <Link2 className="h-5 w-5" /> : <Store className="h-5 w-5" />}</div><div className="min-w-0 flex-1"><p className="font-medium break-words">{partner.name}{!partner.isActive && <span className="ml-2 text-xs text-muted-foreground">Inactive</span>}</p><p className="text-xs text-muted-foreground break-all">{partner.email}</p><p className="text-xs text-muted-foreground">{[partner.city, partner.state].filter(Boolean).join(', ')}</p></div>
        {connection ? <Button variant="ghost" size="sm" disabled={Boolean(busy) || Boolean(error)} aria-label={`Disconnect ${partner.name}`} onClick={() => setRemoving(connection.id)}><Unlink className="h-4 w-4 mr-2" />Disconnect</Button> : <Button variant="outline" size="sm" disabled={Boolean(busy) || Boolean(error) || !store.isActive} onClick={() => mutate(partner)}><Plus className="h-4 w-4 mr-2" />{busy === partner.id ? 'Connecting...' : 'Connect'}</Button>}
      </div>
      {connection && removing !== connection.id && <p className="flex items-center gap-1 text-xs text-success"><Check className="h-3 w-3" />Connected in both directions</p>}
      {connection && removing === connection.id && <div className="rounded-lg bg-destructive/5 p-3"><p className="text-sm">Disconnect {partner.name}? New shipments will stop. Shipments already in transit can still be received.</p><div className="flex justify-end gap-2 mt-3"><Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => setRemoving(null)}>Keep connected</Button><Button size="sm" variant="destructive" disabled={Boolean(busy)} onClick={() => mutate(partner, connection)}>{busy ? 'Disconnecting...' : 'Disconnect'}</Button></div></div>}
      </div>;
    })}
    {!filtered.length && !error && <div className="rounded-xl border border-dashed p-8 text-center"><Link2 className="mx-auto h-7 w-7 text-muted-foreground mb-3" /><p className="font-medium">{query ? 'No matching stores' : tab === 'connected' ? 'No transfer partners yet' : 'No more stores to connect'}</p><p className="mt-2 text-sm text-muted-foreground">{query ? 'Try a store name, email or city.' : tab === 'connected' ? 'Find a store to create your first connection.' : 'New active stores will be available here.'}</p>{!query && tab === 'connected' && <Button variant="outline" className="mt-4" onClick={() => setTab('available')}>Find stores</Button>}</div>}
    </div>}
  </div></Modal>;
}
