import React, { useState } from 'react';
import { AlertTriangle, HelpCircle } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/LoadingState';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** May return a promise: the dialog then stays open, busy, until it settles. */
  onConfirm: () => unknown;
  title: string;
  message: React.ReactNode;
  /** Styles the confirm button red and shows a warning icon */
  destructive?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
}

/**
 * Replacement for window.confirm: a titled question with the consequence spelled
 * out, Cancel and one clearly labeled confirm button.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  destructive = false,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
}) => {
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    const result = onConfirm();
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      setBusy(true);
      try { await result; onClose(); } catch { /* the caller reports its own error; keep the dialog open */ }
      finally { setBusy(false); }
    } else onClose();
  };
  return (
    <Modal isOpen={isOpen} onClose={() => { if (!busy) onClose(); }} size="sm" label={title}>
      <div className="flex items-start gap-4">
        <div className={destructive ? 'p-2 rounded-full bg-destructive/10 text-destructive shrink-0' : 'p-2 rounded-full bg-primary/10 text-primary shrink-0'}>
          {destructive ? <AlertTriangle className="h-5 w-5" /> : <HelpCircle className="h-5 w-5" />}
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-semibold mb-1">{title}</h2>
          <div className="text-sm text-muted-foreground">{message}</div>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-6">
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button type="button" variant={destructive ? 'destructive' : 'primary'} onClick={() => void confirm()} disabled={busy}>
          {busy && <Spinner size="sm" className="border-current border-t-transparent" />}{confirmLabel}
        </Button>
      </div>
    </Modal>
  );
};
