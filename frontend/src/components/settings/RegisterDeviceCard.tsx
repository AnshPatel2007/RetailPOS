import React, { useEffect, useState } from 'react';
import { MonitorSmartphone } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { authService } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { useRegisterStore } from '@/store/registerStore';
import { useConfirm } from '@/components/ui/useConfirm';
import { formatDate } from '@/lib/utils';

interface StoreRegister { id: string; name: string; createdAt: string; lastUsedAt: string | null; createdBy: string | null }
const AUTO_LOCK = [0, 1, 2, 5, 10, 15, 30];

/**
 * Settings > Devices: set this computer up as a register (staff sign in by name +
 * PIN, the screen locks when idle) and see or remove the store's registers.
 */
export const RegisterDeviceCard: React.FC<{ readOnly?: boolean }> = ({ readOnly }) => {
  const user = useAuthStore(state => state.user);
  const { device, setDevice, setAutoLock } = useRegisterStore();
  const [confirm, confirmDialog] = useConfirm();
  const [name, setName] = useState('Front counter');
  const [busy, setBusy] = useState(false);
  const [registers, setRegisters] = useState<StoreRegister[] | null>(null);
  const canManage = !readOnly && (user?.role === 'ADMIN' || user?.role === 'MANAGER') && !!user?.locationId;
  const here = device && device.locationId === user?.locationId ? device : null;

  const load = () => { if (canManage) authService.listRegisters().then(response => setRegisters(response.data.data)).catch(() => setRegisters(null)); };
  useEffect(load, [canManage, device?.id]);
  if (!user || user.role === 'SUPER_ADMIN') return null;

  const setUp = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const { data } = await authService.createRegister(name.trim());
      setDevice({ id: data.data.id, name: data.data.name, storeName: data.data.storeName, locationId: user.locationId!, token: data.data.token, autoLockMinutes: 5 });
      toast.success(`This computer is now "${data.data.name}". Staff with a PIN can sign in here by name.`);
    } catch (failure: any) {
      toast.error(failure.response?.data?.error || 'This computer could not be set up.');
    } finally { setBusy(false); }
  };
  const remove = async (register: { id: string; name: string }, thisComputer: boolean) => {
    if (!await confirm({ title: `Stop PIN sign-in on ${register.name}?`, message: thisComputer ? 'Staff on this computer will sign in with email and password again.' : 'Anyone at that computer signs in with email and password from now on.', confirmLabel: 'Remove register', destructive: true })) return;
    try {
      await authService.removeRegister(register.id);
      if (thisComputer || device?.id === register.id) setDevice(null);
      toast.success('Register removed');
      load();
    } catch (failure: any) { toast.error(failure.response?.data?.error || 'The register could not be removed.'); }
  };

  return (
    <Card className="lg:col-span-2">
      {confirmDialog}
      <CardHeader><CardTitle className="flex items-center gap-2"><MonitorSmartphone className="h-5 w-5" />This computer as a register</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {here ? (
          <>
            <p className="text-sm">This computer is <span className="font-medium">{here.name}</span> at {here.storeName}. Staff sign in here by tapping their name and entering their PIN.</p>
            <div className="max-w-xs">
              <label className="block text-sm font-medium mb-1" htmlFor="register-auto-lock">Lock the screen after</label>
              <Select id="register-auto-lock" value={here.autoLockMinutes} disabled={!canManage}
                onChange={event => { setAutoLock(Number(event.target.value)); toast.success('Saved for this computer'); }}
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground">
                {AUTO_LOCK.map(minutes => <option key={minutes} value={minutes}>{minutes === 0 ? 'Never' : `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} without use`}</option>)}
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">The open sale stays as it was; the same person unlocks with their PIN.</p>
            </div>
            {canManage && <Button variant="outline" onClick={() => remove(here, true)}>Stop using as a register</Button>}
          </>
        ) : device ? (
          <div className="space-y-2">
            <p className="text-sm">This computer is set up as <span className="font-medium">{device.name}</span> for {device.storeName}, not for your store.</p>
            {canManage && <Button variant="outline" onClick={() => { setDevice(null); toast.success('Register setup removed from this computer'); }}>Forget it on this computer</Button>}
          </div>
        ) : canManage ? (
          <form onSubmit={setUp} className="space-y-3">
            <p className="text-sm text-muted-foreground">Set this computer up once. Afterwards staff sign in by tapping their name and entering their PIN, and the screen can lock between customers.</p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-64 max-w-full"><Input label="Register name" value={name} maxLength={60} onChange={event => setName(event.target.value)} required /></div>
              <Button type="submit" variant="primary" disabled={busy || !name.trim()}>{busy ? 'Setting up…' : 'Set up this computer'}</Button>
            </div>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">Ask a manager to set up this computer as a register so staff can sign in with a PIN.</p>
        )}

        {canManage && registers && registers.length > 0 && (
          <div className="border-t pt-4">
            <p className="text-sm font-medium mb-2">Registers at your store</p>
            <ul className="divide-y rounded-md border">
              {registers.map(register => (
                <li key={register.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">{register.name}</span>{register.id === device?.id && <span className="text-muted-foreground"> · this computer</span>}
                    <span className="block text-xs text-muted-foreground">Set up {formatDate(register.createdAt)}{register.createdBy ? ` by ${register.createdBy}` : ''} · {register.lastUsedAt ? `last PIN sign-in ${formatDate(register.lastUsedAt)}` : 'no PIN sign-ins yet'}</span>
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => remove(register, register.id === device?.id)}>Remove</Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
