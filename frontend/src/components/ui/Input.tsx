import React from 'react';
import { cn } from '@/lib/utils';
import { DateControl } from './DateControl';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  description?: string;
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, description, error, className, id, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id || generatedId;
    const errorId = inputId + '-error';
    if (['date', 'month', 'datetime-local'].includes(props.type || '')) {
      return <DateControl {...props} ref={ref} id={inputId} label={label} description={description} error={error} className={className} />;
    }
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium mb-1.5 text-foreground">
            {label}
          </label>
        )}
        <input
          {...props}
          ref={ref}
          id={inputId}
          aria-label={props['aria-label'] || (!label && !props['aria-labelledby'] ? props.placeholder : undefined)}
          aria-invalid={error ? true : props['aria-invalid']}
          aria-describedby={[props['aria-describedby'], description ? inputId + '-description' : undefined, error ? errorId : undefined].filter(Boolean).join(' ') || undefined}
          className={cn(
            'app-input flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
            error && 'border-destructive',
            className
          )}
        />
        {description && <p id={inputId + '-description'} className="field-description">{description}</p>}
        {error && (
          <p id={errorId} role="alert" className="mt-1 text-sm text-destructive">{error}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
