import React from 'react';
import { Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
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
  /** Focus target for the main button (e.g. to move focus there when it becomes the next step). */
  confirmRef?: React.Ref<HTMLButtonElement>;
  /** The id of a hint that explains the main button (e.g. why it is unavailable). */
  confirmDescribedBy?: string;
  onCancel?: () => void;
  cancelLabel?: React.ReactNode;
  /** A delete (or cancel-the-record) button, kept apart on the left so it is never hit by mistake. */
  remove?: { label: string; onClick: () => void; disabled?: boolean; icon?: React.ReactNode; title?: string };
  /** `lg`: the register's 48px buttons, sharing the footer's width evenly. */
  size?: 'md' | 'lg';
  /** Other supporting buttons, shown between Cancel and the main button. */
  children?: React.ReactNode;
}

/**
 * The buttons of every pop-up. Pass it as the Modal's `footer` so the buttons
 * stay in view while the body scrolls: Cancel, then the one main button on the
 * right, with an optional delete button apart on the left.
 */
export function DialogActions({ confirmLabel, onConfirm, form, loading = false, disabled = false, tone = 'primary', confirmRef, confirmDescribedBy, onCancel, cancelLabel = 'Cancel', remove, size = 'md', children }: DialogActionsProps) {
  const large = size === 'lg';
  return <div className="dialog-actions" data-size={large ? 'lg' : undefined}>
    {remove && <Button type="button" variant="ghost" className="dialog-actions-remove text-destructive" disabled={loading || remove.disabled} title={remove.title} onClick={remove.onClick}>{remove.icon ?? <Trash2 aria-hidden="true" />}{remove.label}</Button>}
    {onCancel && <Button type="button" className={cn(large && 'h-12')} disabled={loading} onClick={onCancel}>{cancelLabel}</Button>}
    {children}
    {confirmLabel != null && <Button ref={confirmRef} type={form ? 'submit' : 'button'} form={form} variant={tone} className={cn(large && 'h-12 text-base font-semibold')}
      aria-describedby={confirmDescribedBy} loading={loading} disabled={disabled} onClick={onConfirm}>{confirmLabel}</Button>}
  </div>;
}
