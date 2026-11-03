import React from 'react';
import { cn } from '@/lib/utils';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'destructive' | 'secondary';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  className,
}) => {
  const variants = {
    default: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/15 text-warning',
    destructive: 'bg-destructive/10 text-destructive',
    secondary: 'bg-muted text-muted-foreground',
  };

  return (
    <span
      className={cn(
        'inline-flex w-fit max-w-full items-center whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium leading-4 transition-colors',
        variants[variant],
        className
      )}
    >
      {children}
    </span>
  );
};
