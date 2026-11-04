import React, { useId } from 'react';
import { cn } from '@/lib/utils';

/** A multi-line text field that matches Input: label above, hint and error below. */
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: React.ReactNode; description?: React.ReactNode; error?: string;
}>(function Textarea({ label, description, error, className, id, rows = 3, ...props }, ref) {
  const generated = useId();
  const fieldId = id || generated;
  const describedBy = [description ? fieldId + '-hint' : '', error ? fieldId + '-error' : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="min-w-0 space-y-1.5">
      {label && <label htmlFor={fieldId} className="field-label">{label}</label>}
      <textarea ref={ref} id={fieldId} rows={rows} aria-invalid={!!error || undefined} aria-describedby={describedBy}
        className={cn('block w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
          error && 'border-destructive', className)} {...props} />
      {description && <p id={fieldId + '-hint'} className="field-description">{description}</p>}
      {error && <p id={fieldId + '-error'} role="alert" className="field-error">{error}</p>}
    </div>
  );
});
