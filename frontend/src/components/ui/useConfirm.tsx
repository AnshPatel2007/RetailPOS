import React, { useCallback, useRef, useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';

interface ConfirmOptions { title: string; message?: React.ReactNode; confirmLabel?: string; cancelLabel?: string; destructive?: boolean }

/**
 * In-app replacement for window.confirm, usable inside async handlers:
 *   const [confirm, confirmDialog] = useConfirm();
 *   if (!(await confirm({ title: 'Delete this budget?', destructive: true }))) return;
 *   ...render {confirmDialog} once in the component.
 */
export function useConfirm(): [(options: ConfirmOptions) => Promise<boolean>, React.ReactNode] {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const confirm = useCallback((next: ConfirmOptions) => new Promise<boolean>(resolve => {
    resolver.current?.(false);
    resolver.current = resolve;
    setOptions(next);
  }), []);
  const settle = (value: boolean) => { resolver.current?.(value); resolver.current = null; setOptions(null); };
  const dialog = (
    <ConfirmDialog isOpen={!!options} onClose={() => settle(false)} onConfirm={() => settle(true)}
      title={options?.title || ''} message={options?.message} confirmLabel={options?.confirmLabel || 'Confirm'}
      cancelLabel={options?.cancelLabel} destructive={options?.destructive} />
  );
  return [confirm, dialog];
}
