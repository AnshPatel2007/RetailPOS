import React, { useState } from 'react';
import { KeyRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { authService } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { useConfirm } from '@/components/ui/useConfirm';

/** Your own register PIN: sign in by name + PIN and unlock a locked register. */
export const RegisterPinCard: React.FC = () => {
  const user = useAuthStore(state => state.user);
  const [confirm, confirmDialog] = useConfirm();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [repeat, setRepeat] = useState('');
  const [saving, setSaving] = useState(false);
  if (!user || user.role === 'SUPER_ADMIN' || !user.locationId) return null;
  const hasPin = !!user.hasPin;
  const refresh = (value: boolean) => useAuthStore.setState(state => state.user ? { user: { ...state.user, hasPin: value } } : {});
  const problem = !/^\d{4,6}$/.test(pin) ? 'A PIN is 4 to 6 digits.' : pin !== repeat ? 'The two PINs do not match.' : '';

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (problem) { toast.error(problem); return; }
    setSaving(true);
    try {
      await authService.setPin(password, pin);
      refresh(true);
      toast.success(hasPin ? 'PIN changed' : 'PIN saved. Use it on registers set up for PIN sign-in.');
      setOpen(false); setPassword(''); setPin(''); setRepeat('');
    } catch (failure: any) {
      toast.error(failure.response?.data?.error || 'The PIN could not be saved.');
    } finally { setSaving(false); }
  };
  const remove = async () => {
    if (!await confirm({ title: 'Remove your PIN?', message: 'You will sign in with email and password on every register.', confirmLabel: 'Remove PIN', destructive: true })) return;
    try { await authService.removePin(); refresh(false); toast.success('PIN removed'); }
    catch (failure: any) { toast.error(failure.response?.data?.error || 'The PIN could not be removed.'); }
  };

  return (
    <Card>
      {confirmDialog}
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" />Register PIN {hasPin ? <Badge variant="success">Set</Badge> : <Badge variant="secondary">Not set</Badge>}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          On a register set up for PIN sign-in, tap your name and enter your PIN instead of your email and password. Your PIN also unlocks the register after a break.
        </p>
        {user.twoFactorEnabled ? (
          <p className="text-sm">Your account uses two-step sign-in, which a PIN would skip. Keep signing in with email, password and code.</p>
        ) : open ? (
          <form onSubmit={save} className="space-y-3">
            <Input label="Current password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label={hasPin ? 'New PIN' : 'PIN'} type="password" inputMode="numeric" autoComplete="off" maxLength={6} description="4 to 6 digits, not 1111 or 1234" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} required />
              <Input label="Repeat PIN" type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={repeat} onChange={e => setRepeat(e.target.value.replace(/\D/g, ''))} required />
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={saving || !password || !!problem}>{saving ? 'Saving…' : 'Save PIN'}</Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant={hasPin ? 'outline' : 'primary'} onClick={() => setOpen(true)}>{hasPin ? 'Change PIN' : 'Set a PIN'}</Button>
            {hasPin && <Button variant="ghost" onClick={remove}>Remove PIN</Button>}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
