import React from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from './LoadingState';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'outline' | 'ghost';
export type ButtonSize = 'md' | 'lg' | 'icon';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * `primary` (filled) is the one main action of a page header, pop-up footer or
   * card. Everything else stays `outline` (the default) or `ghost`.
   */
  variant?: ButtonVariant;
  /** `md` is 36px (44px on touch screens); `lg` is 48px, for the register and phone action bars. */
  size?: ButtonSize;
  /** Shows a spinner and ignores clicks while the action runs. */
  loading?: boolean;
  children: React.ReactNode;
}

const baseStyles = 'app-button inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0 [&>svg]:!m-0';
const variants: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-muted text-muted-foreground hover:bg-muted/80',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
  ghost: 'hover:bg-accent hover:text-accent-foreground',
};
const sizes: Record<ButtonSize, string> = {
  md: 'h-9 px-3 text-sm',
  lg: 'h-12 px-8 text-lg',
  icon: 'h-9 w-9 p-0',
};

/** Button styling for things that must stay links (e.g. <Link to="/">). */
export function buttonClassName({ variant = 'outline', size = 'md', className }: { variant?: ButtonVariant; size?: ButtonSize; className?: string }) {
  return cn(baseStyles, variants[variant], sizes[size], className);
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({
  variant = 'outline',
  size = 'md',
  loading = false,
  disabled,
  className,
  children,
  ...props
}, ref) => {
  const iconOnly = size === 'icon' || (React.Children.count(children) === 1 && React.isValidElement(children)
    && (children.type === 'svg' || (typeof children.type === 'object' && children.type !== null)));
  const spinner = loading && <Spinner size="sm" className="border-current border-t-transparent" />;
  return (
    <button
      ref={ref}
      className={cn(baseStyles, variants[variant], sizes[size], iconOnly && size !== 'lg' && 'w-9 p-0', className)}
      data-variant={variant}
      data-control-size={size === 'lg' ? 'large' : 'standard'}
      data-icon-only={iconOnly || undefined}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      {...props}
    >
      {iconOnly && loading ? spinner : <>{spinner}{children}</>}
    </button>
  );
});
Button.displayName = 'Button';
