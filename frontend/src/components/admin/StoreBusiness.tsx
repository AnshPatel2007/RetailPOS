import { useCallback, useEffect, useState } from 'react';
import { Building2, Plus, UserMinus } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { apiErrorMessage, locationService, organizationAdminService } from '@/services/api';

interface Organization {
  id: string;
  name: string;
  locations: { id: string; name: string; isActive: boolean }[];
  owners: { userId: string; name: string; email: string; homeLocationId: string | null }[];
}
interface BusinessStore { id: string; name: string }

const NEW_BUSINESS = '__new__';
const OWN_BUSINESS = '__own__';

/**
 * Platform admin: which business a store belongs to, and who owns that business.
 * Owners run every store of their business as ADMIN; moving a store ends the old
 * business's access to it. Granting ownership is only done here.
 */
export function StoreBusiness({ store, onClose, onChanged }: { store: BusinessStore; onClose: () => void; onChanged: () => void }) {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState('');
  const [newName, setNewName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [confirmMove, setConfirmMove] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setOrganizations((await organizationAdminService.getAll()).data.data);
      setError('');
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not load businesses. Try again before making changes.'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const current = organizations.find(organization => organization.locations.some(location => location.id === store.id));
  const others = organizations.filter(organization => organization.id !== current?.id);
  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await work();
      toast.success(done);
      setConfirmMove(false); setTarget(''); setNewName(''); setOwnerEmail('');
      await load();
      onChanged();
    } catch (e) {
      toast.error(apiErrorMessage(e, 'That change could not be saved. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const move = () => run(async () => {
    let organizationId: string | null = target;
    if (target === NEW_BUSINESS) organizationId = (await organizationAdminService.create(newName.trim())).data.data.id;
    if (target === OWN_BUSINESS) organizationId = null;
    await locationService.moveToOrganization(store.id, organizationId);
  }, `${store.name} moved`);

  return <Modal isOpen onClose={() => { if (!busy) onClose(); }} title="Business and owners" size="lg">
    <div className="space-y-6">
      <div className="flex items-center gap-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
        <div className="rounded-xl bg-primary/10 p-3"><Building2 className="h-6 w-6 text-primary" /></div>
        <div className="min-w-0">
          <p className="font-semibold break-words">{store.name}</p>
          <p className="text-sm text-muted-foreground break-words">{loading ? 'Loading…' : current ? `Part of ${current.name}` : 'No business found'}</p>
        </div>
      </div>
      {error && <div role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm"><p>{error}</p>
        <Button variant="outline" size="sm" className="mt-2" disabled={busy} onClick={() => { void load(); }}>Retry</Button></div>}

      {current && <section aria-labelledby="business-stores" className="space-y-2">
        <h3 id="business-stores" className="font-medium">Stores in {current.name}</h3>
        <ul className="text-sm text-muted-foreground">{current.locations.map(location =>
          <li key={location.id}>{location.name}{!location.isActive && ' (inactive)'}</li>)}</ul>
        <p className="text-xs text-muted-foreground">Stores of one business can send each other stock, and its owners run all of them.</p>
      </section>}

      {current && <section aria-labelledby="business-owners" className="space-y-3">
        <h3 id="business-owners" className="font-medium">Owners</h3>
        {current.owners.length ? <ul className="space-y-2">{current.owners.map(owner => <li key={owner.userId} className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
          <div className="min-w-0 flex-1"><p className="font-medium break-words">{owner.name}</p><p className="text-xs text-muted-foreground break-all">{owner.email}</p></div>
          <Button variant="ghost" size="sm" disabled={busy} aria-label={`Remove ${owner.name} as owner`}
            onClick={() => { void run(() => organizationAdminService.removeOwner(current.id, owner.userId), `${owner.name} is no longer an owner`); }}>
            <UserMinus className="h-4 w-4 mr-2" />Remove
          </Button>
        </li>)}</ul> : <p className="text-sm text-muted-foreground">No owners yet.</p>}
        <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void run(() => organizationAdminService.addOwner(current.id, ownerEmail.trim()), 'Owner added'); }}>
          <div className="min-w-[220px] flex-1"><Input label="Add an owner (email)" type="email" value={ownerEmail} onChange={event => setOwnerEmail(event.target.value)} required /></div>
          <Button type="submit" variant="outline" disabled={busy || !ownerEmail.trim()}><Plus className="h-4 w-4 mr-2" />Add Owner</Button>
        </form>
        <p className="text-xs text-muted-foreground">An owner must be an admin of one of this business&apos;s stores. They get admin access to every store in it.</p>
      </section>}

      {current && <section aria-labelledby="business-move" className="space-y-3">
        <h3 id="business-move" className="font-medium">Move this store</h3>
        <Select label="Move to" value={target} onChange={event => { setTarget(event.target.value); setConfirmMove(false); }} placeholder="Choose a business…">
          {others.map(organization => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
          <option value={NEW_BUSINESS}>A new business…</option>
          {current.locations.length > 1 && <option value={OWN_BUSINESS}>A business of its own</option>}
        </Select>
        {target === NEW_BUSINESS && <Input label="New business name" value={newName} onChange={event => setNewName(event.target.value)} required />}
        {target && !confirmMove && <Button variant="outline" disabled={busy || (target === NEW_BUSINESS && !newName.trim())} onClick={() => setConfirmMove(true)}>Move Store</Button>}
        {confirmMove && <div className="rounded-lg bg-destructive/5 p-3">
          <p className="text-sm">Move {store.name}? Owners of {current.name} lose access to it, and access between it and {current.name}&apos;s other stores ends. Its own staff and records stay with the store.</p>
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmMove(false)}>Keep it here</Button>
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => { void move(); }}>{busy ? 'Moving…' : 'Move Store'}</Button>
          </div>
        </div>}
      </section>}
    </div>
  </Modal>;
}
