import { formatEnumLabel } from '@/lib/utils';
import { Checkbox } from '@/components/ui/Checkbox';
import { ManagementPage, SummaryStrip } from '@/components/common/Workspace';
import { Select } from '@/components/ui/Select';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { AutoRefreshStatus } from '@/components/common/AutoRefreshStatus';
import React, { useState, useEffect, useRef } from 'react';
import { apiErrorMessage, organizationService, userService } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Badge } from '@/components/ui/Badge';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/Table';
import { Search, Edit, Trash2, Key, Users, Plus, ShieldAlert, Building2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { Spinner } from '@/components/ui/LoadingState';
import { ActionMenu } from '@/components/ui/ActionMenu';

interface StaffUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  isActive: boolean;
  locationId: string | null;
  createdAt: string;
  location: { id: string; name: string } | null;
  _count: { sales: number; shifts: number };
  /** Their role at this store (differs from `role` for someone whose home store is another one). */
  storeRole?: string;
  /** Works here through access an owner gave; their home store is another one. */
  alsoWorksHere?: boolean;
}

/** Access to the owner's stores (from GET /organization/access). */
interface AccessRow { id: string; locationId: string; role: string; userId: string; name: string; email: string; isHome: boolean; isOwner: boolean; homeLocationId: string | null }
interface AccessData { stores: { id: string; name: string; isActive: boolean }[]; access: AccessRow[] }

const STAFF_ROLES = ['MANAGER', 'CASHIER'] as const;

/**
 * Store-scoped staff management for admins: add/edit/deactivate managers and
 * cashiers at their own location. The backend enforces the same limits (own
 * location only, never an admin/super-admin role or account) — this UI just
 * doesn't offer the options that would be rejected anyway.
 */
export const Team: React.FC = () => {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [editingUser, setEditingUser] = useState<StaffUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StaffUser | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    role: 'CASHIER',
    isActive: true,
  });

  useEffect(() => {
    searchTimer.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(searchTimer.current);
  }, [search]);


  const query = useScopedQuery<StaffUser[]>(['team', debouncedSearch, filterRole], async signal => (await userService.getAll({ search: debouncedSearch || undefined, role: filterRole || undefined }, signal)).data.data);
  const users = query.data || [], isLoading = query.loading, loadUsers = query.refresh;
  const loadError = query.stale ? '' : query.error;

  /** Only this store's own managers/cashiers are editable here — admin accounts and visiting staff are hands-off */
  const isManageable = (u: StaffUser) => !u.alsoWorksHere && (STAFF_ROLES as readonly string[]).includes(u.role);

  // Owners of several stores let their staff work in their other stores too.
  const me = useAuthStore(state => state.user);
  const ownsSeveral = !!me?.organization?.isOwner && me.organization.storeCount > 1;
  const access = useScopedQuery<AccessData>(['organization-access'], async signal => (await organizationService.listAccess(signal)).data.data, ownsSeveral);
  const grants = (access.data?.access || []).filter(row => !row.isHome && !row.isOwner);
  const storeName = (id: string | null) => access.data?.stores.find(store => store.id === id)?.name || 'another store';
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantForm, setGrantForm] = useState({ email: '', locationId: '', role: 'CASHIER' as 'MANAGER' | 'CASHIER' });
  const [removeGrant, setRemoveGrant] = useState<AccessRow | null>(null);
  const grantPeople = users.filter(u => isManageable(u) && u.isActive);
  const grantStores = (access.data?.stores || []).filter(store => store.id !== me?.locationId && store.isActive);

  const openGrant = () => {
    setGrantForm({ email: grantPeople[0]?.email || '', locationId: grantStores[0]?.id || '', role: 'CASHIER' });
    setGrantOpen(true);
  };
  const handleGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await organizationService.grantAccess(grantForm);
      const person = grantPeople.find(u => u.email === grantForm.email);
      toast.success(`${person?.firstName || 'They'} can now work at ${storeName(grantForm.locationId)} as ${formatEnumLabel(grantForm.role).toLowerCase()}`);
      setGrantOpen(false);
      access.refresh();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Could not give access. Try again.'));
    } finally {
      setSubmitting(false);
    }
  };
  const handleRemoveGrant = async () => {
    if (!removeGrant) return;
    try {
      await organizationService.removeAccess(removeGrant.id);
      toast.success(`${removeGrant.name} no longer works at ${storeName(removeGrant.locationId)}`);
      access.refresh(); loadUsers();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Could not remove access. Try again.'));
    } finally {
      setRemoveGrant(null);
    }
  };

  const resetForm = () => {
    setFormData({ firstName: '', lastName: '', email: '', password: '', role: 'CASHIER', isActive: true });
  };

  const openCreateModal = () => {
    resetForm();
    setShowCreateModal(true);
  };

  const openEditModal = (u: StaffUser) => {
    setEditingUser(u);
    setFormData({
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      password: '',
      role: u.role,
      isActive: u.isActive,
    });
    setShowEditModal(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.password || formData.password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    setSubmitting(true);
    try {
      await userService.create(formData); // locationId omitted — server assigns the admin's own store
      toast.success(`${formData.firstName} added to your team`);
      setShowCreateModal(false);
      loadUsers();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to add team member');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setSubmitting(true);
    try {
      // locationId intentionally never sent — staff stay at this store
      await userService.update(editingUser.id, {
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email,
        role: formData.role,
        isActive: formData.isActive,
      });
      toast.success('Team member updated');
      setShowEditModal(false);
      setEditingUser(null);
      loadUsers();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to update team member');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setSubmitting(true);
    try {
      await userService.resetPassword(editingUser.id, newPassword);
      toast.success('Password reset');
      setShowPasswordModal(false);
      setEditingUser(null);
      setNewPassword('');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to reset password');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeactivate = async () => {
    if (!deleteTarget) return;
    try {
      await userService.delete(deleteTarget.id);
      toast.success(`${deleteTarget.firstName} deactivated`);
      loadUsers();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to deactivate');
    } finally {
      setDeleteTarget(null);
    }
  };

  const activeCount = users.filter((u) => u.isActive).length;


  return (
    <ManagementPage className="">
      <PageHeader
        title="My Team"
        subtitle="Add and manage managers and cashiers for your store"
        actions={<>
          {ownsSeveral && <Button variant="outline" onClick={openGrant} disabled={!access.data || !grantPeople.length || !grantStores.length}>
            <Building2 className="h-4 w-4 mr-2" />
            Give access to another store
          </Button>}
          <Button variant="primary" onClick={openCreateModal}>
            <Plus className="h-4 w-4 mr-2" />
            Add Team Member
          </Button>
        </>}
      />
      <AutoRefreshStatus state={query} />
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search team..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select
              aria-label="Staff role filter"
              value={filterRole}
              onChange={(e) => setFilterRole(e.target.value)}
              className="px-3 py-2 border border-input rounded-md bg-background text-foreground min-w-[150px]"
            >
              <option value="">All Roles</option>
              <option value="MANAGER">Manager</option>
              <option value="CASHIER">Cashier</option>
            </Select>
          </div>
        </CardContent>
      </Card>

      <SummaryStrip className="mb-6" items={[
        { label: 'Team size', value: users.length },
        { label: 'Active', value: activeCount },
      ]} />



      <Card>
        <CardHeader><CardTitle>Staff</CardTitle></CardHeader>
        {isLoading ? (
          <div className="p-8 text-center">
            <Spinner size="lg" className="mx-auto" />
          </div>
        ) : loadError ? (<div role="alert" className="p-4 space-y-3"><p>Staff could not be loaded.</p><Button variant="outline" onClick={loadUsers}>Retry</Button></div>) : users.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No team members yet"
            hint="Add a manager or cashier to get started"
            action={
              <Button variant="primary" size="sm" onClick={openCreateModal}>
                <Plus className="h-4 w-4 mr-1" /> Add Team Member
              </Button>
            }
          />
        ) : (
          <Table scrollLabel="Team records" aria-label="Staff">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Activity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <p className="font-medium">{u.firstName} {u.lastName}</p>
                    <p className="text-sm text-muted-foreground">{u.email}</p>
                    {u.alsoWorksHere && <p className="text-xs text-muted-foreground">Home store: {u.location?.name || 'another store'}</p>}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant={(u.storeRole || u.role) === 'MANAGER' ? 'default' : 'secondary'}>
                        {formatEnumLabel(u.storeRole || u.role)}
                      </Badge>
                      {u.alsoWorksHere && <Badge variant="secondary">Also works here</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <p className="text-sm">{u._count.sales} sales</p>
                    <p className="text-sm text-muted-foreground">{u._count.shifts} shifts</p>
                  </TableCell>
                  <TableCell>
                    {u.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="secondary">Inactive</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    {isManageable(u) ? (
                      <div className="flex justify-end gap-1">
                        <Button variant="outline" size="sm" onClick={() => openEditModal(u)}><Edit className="h-4 w-4" />Edit</Button>
                        <ActionMenu label={'More actions for ' + [u.firstName, u.lastName].filter(Boolean).join(' ')} iconOnly items={[
                          { id: 'password', label: 'Reset password', icon: <Key size={16} />, onAction: () => { setEditingUser(u); setNewPassword(''); setShowPasswordModal(true); } },
                          ...(u.isActive ? [{ id: 'deactivate', label: 'Deactivate', icon: <Trash2 size={16} />, destructive: true, onAction: () => setDeleteTarget(u) }] : []),
                        ]} />
                      </div>
                    ) : u.alsoWorksHere ? (
                      <span className="text-xs text-muted-foreground">Managed at their home store</span>
                    ) : (
                      <span className="text-xs text-muted-foreground flex items-center justify-end gap-1">
                        <ShieldAlert className="h-3 w-3" /> Admin-managed
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {ownsSeveral && <Card className="mt-6">
        <CardHeader><CardTitle>Access to your other stores</CardTitle></CardHeader>
        {access.loading ? <div className="p-6 text-center"><Spinner className="mx-auto" /></div>
          : access.error && !access.data ? <div role="alert" className="p-4 space-y-3"><p>{access.error}</p><Button variant="outline" onClick={access.refresh}>Retry</Button></div>
          : !grants.length ? <EmptyState icon={Building2} title="No one works in more than one store yet" hint="Give a manager or cashier access to another of your stores; they switch stores from the menu." />
          : <Table scrollLabel="Access to other stores" aria-label="Access to other stores">
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Works at</TableHead><TableHead>Role there</TableHead><TableHead>Home store</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>{grants.map(row => <TableRow key={row.id}>
              <TableCell><p className="font-medium">{row.name}</p><p className="text-sm text-muted-foreground">{row.email}</p></TableCell>
              <TableCell>{storeName(row.locationId)}</TableCell>
              <TableCell>{formatEnumLabel(row.role)}</TableCell>
              <TableCell>{storeName(row.homeLocationId)}</TableCell>
              <TableCell className="text-right"><Button variant="outline" size="sm" onClick={() => setRemoveGrant(row)} aria-label={`Remove ${row.name} from ${storeName(row.locationId)}`}>Remove</Button></TableCell>
            </TableRow>)}</TableBody>
          </Table>}
      </Card>}

      <Modal isOpen={grantOpen} onClose={() => setGrantOpen(false)} title="Give access to another store">
        <form onSubmit={handleGrant} className="space-y-4">
          <Select label="Team member" value={grantForm.email} onChange={(e) => setGrantForm({ ...grantForm, email: e.target.value })} required>
            {grantPeople.map(u => <option key={u.id} value={u.email}>{u.firstName} {u.lastName}</option>)}
          </Select>
          <Select label="Store" value={grantForm.locationId} onChange={(e) => setGrantForm({ ...grantForm, locationId: e.target.value })} required>
            {grantStores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}
          </Select>
          <Select label="Role there" value={grantForm.role} onChange={(e) => setGrantForm({ ...grantForm, role: e.target.value as 'MANAGER' | 'CASHIER' })}>
            <option value="CASHIER">Cashier</option>
            <option value="MANAGER">Manager</option>
          </Select>
          <p className="text-xs text-muted-foreground">They keep this store as their home and switch to the other store from the menu. Giving the same person access again changes their role there.</p>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setGrantOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" className="flex-1" disabled={submitting || !grantForm.email || !grantForm.locationId}>
              {submitting ? 'Saving...' : 'Give Access'}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={removeGrant !== null}
        onClose={() => setRemoveGrant(null)}
        onConfirm={handleRemoveGrant}
        title="Remove access?"
        message={removeGrant ? `${removeGrant.name} will no longer be able to work at ${storeName(removeGrant.locationId)}. Their home store stays the same.` : ''}
        destructive
        confirmLabel="Remove Access"
      />

      {/* Add Team Member */}
      <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="Add Team Member">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="First Name" value={formData.firstName} onChange={(e) => setFormData({ ...formData, firstName: e.target.value })} required />
            <Input label="Last Name" value={formData.lastName} onChange={(e) => setFormData({ ...formData, lastName: e.target.value })} required />
          </div>
          <Input label="Email" type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} required />
          <Input
            label="Password"
            type="password"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            placeholder="Min. 8 characters, upper/lower/number/symbol"
            required
          />
          <div>
            <Select
              label="Role"
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value })}
              className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground"
            >
              <option value="CASHIER">Cashier</option>
              <option value="MANAGER">Manager</option>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            They'll be assigned to your store automatically.
          </p>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setShowCreateModal(false)}>Cancel</Button>
            <Button type="submit" variant="primary" className="flex-1" disabled={submitting}>
              {submitting ? 'Adding...' : 'Add Team Member'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit Team Member */}
      <Modal isOpen={showEditModal} onClose={() => { setShowEditModal(false); setEditingUser(null); }} title="Edit Team Member">
        <form onSubmit={handleSaveEdit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="First Name" value={formData.firstName} onChange={(e) => setFormData({ ...formData, firstName: e.target.value })} required />
            <Input label="Last Name" value={formData.lastName} onChange={(e) => setFormData({ ...formData, lastName: e.target.value })} required />
          </div>
          <Input label="Email" type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} required />
          <div>
            <Select
              label="Role"
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value })}
              className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground"
            >
              <option value="CASHIER">Cashier</option>
              <option value="MANAGER">Manager</option>
            </Select>
          </div>
          <Checkbox label="Active" checked={formData.isActive} onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })} />
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => { setShowEditModal(false); setEditingUser(null); }}>Cancel</Button>
            <Button type="submit" variant="primary" className="flex-1" disabled={submitting}>
              {submitting ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Reset Password */}
      <Modal isOpen={showPasswordModal} onClose={() => { setShowPasswordModal(false); setEditingUser(null); setNewPassword(''); }} title="Reset Password">
        <form onSubmit={handleResetPassword} className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Reset password for {editingUser?.firstName} {editingUser?.lastName}
          </p>
          <Input
            label="New Password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Min. 8 characters, upper/lower/number/symbol"
            required
          />
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => { setShowPasswordModal(false); setEditingUser(null); }}>Cancel</Button>
            <Button type="submit" variant="primary" className="flex-1" disabled={submitting}>
              {submitting ? 'Resetting...' : 'Reset Password'}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeactivate}
        title="Deactivate team member?"
        message={deleteTarget ? `${deleteTarget.firstName} ${deleteTarget.lastName} will no longer be able to log in.` : ''}
        destructive
        confirmLabel="Deactivate"
      />
    </ManagementPage>
  );
};
