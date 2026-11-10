import React, { useEffect, useRef, useState } from 'react';
import { Delete } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import '@/styles/register.css';

interface PinPadProps {
  /** Called with 4-6 digits. Reject (throw) to keep the pad open; the message shows below. */
  onSubmit: (pin: string) => Promise<void>;
  submitLabel?: string;
  /** Shown above the pad, e.g. "Maria G., enter your PIN". */
  prompt?: React.ReactNode;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/** A PIN field that works by keyboard and by touch. Digits never echo on screen. */
export const PinPad: React.FC<PinPadProps> = ({ onSubmit, submitLabel = 'Unlock', prompt }) => {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);

  const press = (digit: string) => { setError(''); setPin(value => (value + digit).slice(0, 6)); input.current?.focus(); };
  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    if (!/^\d{4,6}$/.test(pin)) { setError('Enter your 4 to 6 digit PIN.'); return; }
    setBusy(true); setError('');
    try { await onSubmit(pin); }
    catch (failure: any) {
      setError(failure?.response?.data?.error || failure?.message || 'That did not work. Try again.');
      setPin('');
      input.current?.focus();
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="register-pin-pad">
      {prompt && <p className="text-center text-sm text-muted-foreground">{prompt}</p>}
      <input
        ref={input}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        aria-label="PIN"
        aria-describedby={error ? 'register-pin-error' : undefined}
        aria-invalid={!!error}
        maxLength={6}
        value={pin}
        disabled={busy}
        onChange={event => { setError(''); setPin(event.target.value.replace(/\D/g, '').slice(0, 6)); }}
        className="register-pin-input"
      />
      <p id="register-pin-error" role={error ? 'alert' : undefined} className="min-h-5 text-center text-sm text-destructive">{error}</p>
      <div className="register-pin-keys" aria-hidden="false">
        {KEYS.map(key => <button key={key} type="button" disabled={busy} onClick={() => press(key)} className="register-pin-key">{key}</button>)}
        <button type="button" disabled={busy || !pin} onClick={() => { setPin(value => value.slice(0, -1)); input.current?.focus(); }} className="register-pin-key" aria-label="Delete last digit"><Delete className="h-5 w-5" /></button>
        <button type="button" disabled={busy} onClick={() => press('0')} className="register-pin-key">0</button>
        <Button type="submit" variant="primary" disabled={busy || pin.length < 4} className="register-pin-key register-pin-submit">{busy ? '…' : submitLabel}</Button>
      </div>
    </form>
  );
};
