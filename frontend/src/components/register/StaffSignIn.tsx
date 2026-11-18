import React, { useEffect, useState } from 'react';
import { ArrowLeft, UserRound } from 'lucide-react';
import axios from 'axios';
import { authService } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { useRegisterStore } from '@/store/registerStore';
import { Spinner } from '@/components/ui/LoadingState';
import { PinPad } from './PinPad';
import '@/styles/register.css';

interface Person { id: string; name: string; role: string }
const roleName = (role: string) => role === 'ADMIN' ? 'Owner' : role === 'MANAGER' ? 'Manager' : 'Cashier';

interface StaffSignInProps {
  /** Leave this person out (switching from them). */
  excludeUserId?: string;
  /** Shown under the names, e.g. what switching will clear. */
  note?: React.ReactNode;
  onSignedIn: () => void;
  /** No one on this register has a PIN, or the register was removed. */
  onUnavailable?: (reason: string) => void;
}

/** Tap your name, then enter your PIN. Lists only staff of this register's store who have a PIN. */
export const StaffSignIn: React.FC<StaffSignInProps> = ({ excludeUserId, note, onSignedIn, onUnavailable }) => {
  const device = useRegisterStore(state => state.device);
  const pinLogin = useAuthStore(state => state.pinLogin);
  // Right after "Sign out" the previous session is still closing; ask once it has.
  const signingOut = useAuthStore(state => state.isSigningOut);
  const [staff, setStaff] = useState<Person[] | null>(null);
  const [error, setError] = useState('');
  const [chosen, setChosen] = useState<Person | null>(null);

  useEffect(() => {
    if (!device || signingOut) return;
    let active = true;
    setError('');
    authService.registerStaff(device.token)
      .then(response => { if (active) setStaff(response.data.data.staff); })
      .catch((failure: any) => {
        if (!active || axios.isCancel(failure)) return;
        const message = failure.response?.data?.error || 'Could not load the staff list. Check the connection.';
        if (failure.response?.status === 401) { useRegisterStore.getState().setDevice(null); onUnavailable?.(message); }
        setError(message);
      });
    return () => { active = false; };
  }, [device?.token, signingOut]);

  if (!device) return null;
  if (error) return <p role="alert" className="text-sm text-destructive text-center">{error}</p>;
  if (!staff) return <div className="flex justify-center py-6"><Spinner /></div>;
  const people = staff.filter(person => person.id !== excludeUserId);

  if (chosen) {
    return (
      <div className="space-y-3">
        <button type="button" onClick={() => setChosen(null)} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Not {chosen.name}?
        </button>
        <PinPad key={chosen.id} prompt={<><span className="font-medium text-foreground">{chosen.name}</span>, enter your PIN</>} submitLabel="Sign in"
          onSubmit={async pin => { await pinLogin(chosen.id, pin); onSignedIn(); }} />
      </div>
    );
  }

  if (!people.length) {
    return <p className="text-sm text-muted-foreground text-center">{excludeUserId ? 'No one else on this register has a PIN yet.' : 'No one on this register has a PIN yet.'} Each person sets one in Settings &gt; Profile &amp; Security.</p>;
  }
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Who is signing in?</p>
      <ul className="register-staff-list">
        {people.map(person => (
          <li key={person.id}>
            <button type="button" onClick={() => setChosen(person)} className="register-staff-button">
              <span className="register-staff-avatar" aria-hidden="true"><UserRound className="h-5 w-5" /></span>
              <span className="min-w-0 text-left"><span className="block truncate font-medium">{person.name}</span><span className="block text-xs text-muted-foreground">{roleName(person.role)}</span></span>
            </button>
          </li>
        ))}
      </ul>
      {note}
    </div>
  );
};
