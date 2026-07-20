import React, { useState, useEffect, useRef } from 'react';
import { userService } from '@/services/api';
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
import { Search, Edit, Trash2, Key, Users, UserCheck, Plus, ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';

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
}

const STAFF_ROLES = ['MANAGER', 'CASHIER'] as const;

/**
 * Store-scoped staff management for admins: add/edit/deactivate managers and
 * cashiers at their own location. The backend enforces the same limits (own
 * location only, never an admin/super-admin role or account) — this UI just
 * doesn't offer the options that would be rejected anyway.
 */
export const Team: React.FC = () => {
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
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

  useEffect(() => {
    loadUsers();
  }, [debouncedSearch, filterRole]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadUsers = async () => {
    setIsLoading(true);
    try {
      // No locationId param — the backend scopes non-super-admins to their
      // own store automatically
      const res = await userService.getAll({
        search: debouncedSearch || undefined,
        role: filterRole || undefined,
      });
      setUsers(res.data.data);
    } catch {
      toast.error('Failed to load staff');
    } finally {
      setIsLoading(false);
    }
  };

  /** Only managers/cashiers are ever editable here — admin accounts are hands-off */
  const isManageable = (u: StaffUser) => (STAFF_ROLES as readonly string[]).includes(u.role);

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
    <div className="p-8">
      <PageHeader
        title="My Team"
        subtitle="Add and manage managers and cashiers for your store"
        actions={
          <Button variant="primary" onClick={openCreateModal}>
            <Plus className="h-4 w-4 mr-2" />
            Add Team Member
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg"><Users className="h-5 w-5 text-primary" /></div>
            <div>
              <p className="text-sm text-muted-foreground">Team Size</p>
              <p className="text-2xl font-bold">{users.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 bg-success/10 rounded-lg"><UserCheck className="h-5 w-5 text-success" /></div>
            <div>
              <p className="text-sm text-muted-foreground">Active</p>
              <p className="text-2xl font-bold">{activeCount}</p>
            </div>
          </CardContent>
        </Card>
      </div>

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
            <select
              value={filterRole}
              onChange={(e) => setFilterRole(e.target.value)}
              className="px-3 py-2 border border-input rounded-md bg-background text-foreground min-w-[150px]"
            >
              <option value="">All Roles</option>
              <option value="MANAGER">Manager</option>
              <option value="CASHIER">Cashier</option>
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Staff</CardTitle></CardHeader>
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto" />
          </div>
        ) : users.length === 0 ? (
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
          <Table>
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
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.role === 'MANAGER' ? 'default' : 'secondary'}>
                      {u.role.replace(/_/g, ' ')}
                    </Badge>
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
                        <Button variant="ghost" size="sm" onClick={() => { setEditingUser(u); setNewPassword(''); setShowPasswordModal(true); }} title="Reset Password">
                          <Key className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => openEditModal(u)} title="Edit">
                          <Edit className="h-4 w-4" />
                        </Button>
                        {u.isActive && (
                          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleteTarget(u)} title="Deactivate">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
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
            <label className="block text-sm font-medium mb-1">Role</label>
            <select
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value })}
              className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground"
            >
              <option value="CASHIER">Cashier</option>
              <option value="MANAGER">Manager</option>
            </select>
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
            <label className="block text-sm font-medium mb-1">Role</label>
            <select
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value })}
              className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground"
            >
              <option value="CASHIER">Cashier</option>
              <option value="MANAGER">Manager</option>
            </select>
          </div>
          <label className="flex items-center space-x-2">
            <input type="checkbox" checked={formData.isActive} onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })} className="rounded border-input" />
            <span className="text-sm">Active</span>
          </label>
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
    </div>
  );
};
