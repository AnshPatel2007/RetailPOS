import React from 'react';
import { AlertTriangle, HelpCircle } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: React.ReactNode;
  /** Styles the confirm button red and shows a warning icon */
  destructive?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
}

/**
 * Styled replacement for window.confirm. The confirm button closes the
 * dialog and then runs onConfirm.
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
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm">
      <div className="flex items-start gap-4">
        <div
          className={
            destructive
              ? 'p-2 rounded-full bg-destructive/10 text-destructive shrink-0'
              : 'p-2 rounded-full bg-primary/10 text-primary shrink-0'
          }
        >
          {destructive ? (
            <AlertTriangle className="h-5 w-5" />
          ) : (
            <HelpCircle className="h-5 w-5" />
          )}
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-semibold mb-1">{title}</h2>
          <div className="text-sm text-muted-foreground">{message}</div>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-6">
        <Button variant="outline" onClick={onClose}>
          {cancelLabel}
        </Button>
        <Button
          variant={destructive ? 'destructive' : 'primary'}
          onClick={() => {
            onClose();
            onConfirm();
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
};
