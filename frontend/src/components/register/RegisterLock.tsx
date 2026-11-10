import { formatTime } from '@/lib/utils';
import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useCartStore } from '@/store/cartStore';
import { useRegisterStore, canLockRegister } from '@/store/registerStore';
import { authService } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { PinPad } from './PinPad';
import { StaffSignIn } from './StaffSignIn';
import '@/styles/register.css';

const shortName = (user: { firstName: string; lastName: string }) => `${user.firstName} ${user.lastName ? user.lastName[0] + '.' : ''}`.trim();

/**
 * Covers the whole app while the register is locked. Everything underneath stays
 * as it was (cart, open sale); the signed-in person unlocks with their PIN, or
 * someone else signs in by name + PIN (which ends the previous session).
 */
export const RegisterLock: React.FC = () => {
  const { pathname } = useLocation();
  const user = useAuthStore(state => state.user);
  const isAuthenticated = useAuthStore(state => state.isAuthenticated);
  const logout = useAuthStore(state => state.logout);
  const { device, lockedBy, unlock } = useRegisterStore();
  const itemCount = useCartStore(state => state.items.reduce((count, item) => count + item.quantity, 0));
  const heldCount = useCartStore(state => state.heldSales.length);
  const [switching, setSwitching] = useState(false);
  const [now, setNow] = useState(new Date());
  const root = useRef<HTMLDivElement>(null);
  const shown = isAuthenticated && !!user && !!lockedBy && pathname !== '/customer-display';

  // A lock set by someone else (or a session that changed) is not this person's lock.
  useEffect(() => {
    if (isAuthenticated && user && lockedBy && lockedBy !== user.id) unlock();
  }, [isAuthenticated, user?.id, lockedBy]);
  useEffect(() => { if (!shown) setSwitching(false); }, [shown]);
  useEffect(() => {
    if (!shown) return;
    const timer = setInterval(() => setNow(new Date()), 30000);
    // Keys typed elsewhere must not reach the register underneath (F1 charge, scans...).
    const guard = (event: KeyboardEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) {
        event.preventDefault(); event.stopPropagation();
        root.current.querySelector<HTMLElement>('input, button')?.focus();
      }
    };
    window.addEventListener('keydown', guard, true);
    return () => { clearInterval(timer); window.removeEventListener('keydown', guard, true); };
  }, [shown]);

  if (!shown || !user) return null;
  const pinUsable = canLockRegister(user, device);
  const inProgress = [itemCount ? `${itemCount} ${itemCount === 1 ? 'item' : 'items'} in the current sale` : '', heldCount ? `${heldCount} held ${heldCount === 1 ? 'sale' : 'sales'}` : ''].filter(Boolean).join(' and ');

  return (
    <div ref={root} role="dialog" aria-modal="true" aria-labelledby="register-lock-title" className="register-lock"
      // Keys inside the lock screen stay here too: they must not reach the register's shortcuts or the scanner.
      onKeyDown={event => event.stopPropagation()}>
      <div className="register-lock-card">
        <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span className="truncate">{[device?.storeName, device?.name].filter(Boolean).join(' · ')}</span>
          <span className="tabular-nums">{formatTime(now)}</span>
        </div>
        <div className="text-center space-y-1">
          <span className="register-lock-icon" aria-hidden="true"><Lock className="h-6 w-6" /></span>
          <h1 id="register-lock-title" className="text-2xl font-semibold">Register locked</h1>
          <p className="text-sm text-muted-foreground">{switching ? 'Sign in as someone else' : `${shortName(user)} is signed in`}{!switching && inProgress ? ` · ${inProgress}` : ''}</p>
        </div>

        {switching ? (
          <>
            <StaffSignIn excludeUserId={user.id} onSignedIn={() => unlock()}
              note={itemCount ? <p className="rounded-md bg-warning/10 p-2 text-sm text-warning">{shortName(user)} has {itemCount} {itemCount === 1 ? 'item' : 'items'} in the current sale. It is cleared when someone else signs in; unlock and hold or finish it first to keep it. Held sales stay on this register.</p> : undefined} />
            <Button variant="ghost" className="w-full" onClick={() => setSwitching(false)}>Back to {shortName(user)}</Button>
          </>
        ) : pinUsable ? (
          <PinPad prompt="Enter your PIN to unlock" onSubmit={async pin => { await authService.verifyPin(pin); unlock(); }} />
        ) : (
          <p className="text-sm text-center text-muted-foreground">PIN unlock is not available here. Sign out and sign in again.</p>
        )}

        {!switching && (
          <div className="flex flex-wrap justify-center gap-2 border-t pt-4">
            {device && <Button variant="outline" onClick={() => setSwitching(true)}>Switch cashier</Button>}
            <Button variant="ghost" onClick={() => { void logout(); }}>Sign out</Button>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Lock the register after the idle time chosen for this computer. Never while a
 * window (payment, approval...) is open: those finish first.
 */
export function useAutoLock() {
  const { pathname } = useLocation();
  const user = useAuthStore(state => state.user);
  const { device, lockedBy, lock } = useRegisterStore();
  const minutes = device?.autoLockMinutes || 0;
  const enabled = canLockRegister(user, device) && minutes > 0 && !lockedBy && pathname !== '/customer-display';
  useEffect(() => {
    if (!enabled || !user) return;
    let last = Date.now();
    const active = () => { last = Date.now(); };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach(name => window.addEventListener(name, active, { capture: true, passive: true }));
    const timer = setInterval(() => {
      if (Date.now() - last < minutes * 60000) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) { last = Date.now(); return; }
      lock(user.id);
    }, 10000);
    return () => { clearInterval(timer); events.forEach(name => window.removeEventListener(name, active, { capture: true })); };
  }, [enabled, minutes, user?.id]);
}

/** Mounted once inside the router: idle auto-lock plus the lock screen. */
export const RegisterLockLayer: React.FC = () => {
  useAutoLock();
  return <RegisterLock />;
};
