import React, { useId } from 'react';
import { cn } from '@/lib/utils';

/**
 * A labeled checkbox with an optional one-line explanation underneath. The
 * whole row is clickable and at least 36px tall (44px on touch screens).
 */
export const Checkbox = React.forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: React.ReactNode; description?: React.ReactNode;
}>(function Checkbox({ label, description, className, id, ...props }, ref) {
  const generated = useId();
  const inputId = id || generated;
  return (
    <label htmlFor={inputId} className={cn('app-checkbox flex min-h-9 cursor-pointer items-start gap-3 py-1.5 text-sm', props.disabled && 'cursor-not-allowed opacity-60', className)}>
      <input ref={ref} id={inputId} type="checkbox" aria-describedby={description ? inputId + '-hint' : undefined}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-primary" {...props} />
      <span className="min-w-0">
        <span className="font-medium leading-5">{label}</span>
        {description && <span id={inputId + '-hint'} className="block text-xs leading-4 text-muted-foreground">{description}</span>}
      </span>
    </label>
  );
});
