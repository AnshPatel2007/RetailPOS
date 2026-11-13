import React from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from './Button';

interface DialogActionsProps {
  /**
   * The main button's words: say what it does ("Save Supplier", "Issue Gift Card").
   * Leave out for a pop-up that only shows something: it then has no filled button.
   */
  confirmLabel?: React.ReactNode;
  /** What the main button does. Leave out when `form` names a form to submit. */
  onConfirm?: () => void;
  /** The id of a form in the pop-up's body: the main button submits it. */
  form?: string;
  /** The action is running: the main button shows a spinner and every button waits. */
  loading?: boolean;
  /** Only the main button is unavailable (nothing to save yet, a field is missing). */
  disabled?: boolean;
  /** `destructive` makes the main button red: delete, void, write off. */
  tone?: 'primary' | 'destructive';
  onCancel?: () => void;
  cancelLabel?: string;
  /** A delete (or cancel-the-record) button, kept apart on the left so it is never hit by mistake. */
  remove?: { label: string; onClick: () => void; disabled?: boolean; icon?: React.ReactNode };
  /** Other supporting buttons, shown between Cancel and the main button. */
  children?: React.ReactNode;
}

/**
 * The buttons of every pop-up. Pass it as the Modal's `footer` so the buttons
 * stay in view while the body scrolls: Cancel, then the one main button on the
 * right, with an optional delete button apart on the left.
 */
export function DialogActions({ confirmLabel, onConfirm, form, loading = false, disabled = false, tone = 'primary', onCancel, cancelLabel = 'Cancel', remove, children }: DialogActionsProps) {
  return <div className="dialog-actions">
    {remove && <Button type="button" variant="ghost" className="dialog-actions-remove text-destructive" disabled={loading || remove.disabled} onClick={remove.onClick}>{remove.icon ?? <Trash2 aria-hidden="true" />}{remove.label}</Button>}
    {onCancel && <Button type="button" disabled={loading} onClick={onCancel}>{cancelLabel}</Button>}
    {children}
    {confirmLabel != null && <Button type={form ? 'submit' : 'button'} form={form} variant={tone} loading={loading} disabled={disabled} onClick={onConfirm}>{confirmLabel}</Button>}
  </div>;
}
