import React from 'react';
import { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  hint?: string;
  /** Optional call-to-action rendered under the hint */
  action?: React.ReactNode;
}

/**
 * Standard empty state: centered icon, heading, muted hint, optional action.
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  hint,
  action,
}) => {
  return (
    <div className="px-4 py-8 sm:py-10 text-center">
      <Icon className="h-8 w-8 mx-auto text-muted-foreground/70 mb-3" aria-hidden="true" />
      <h3 className="text-lg font-semibold mb-1">{title}</h3>
      {hint && <p className="mx-auto max-w-md text-sm text-muted-foreground mb-3">{hint}</p>}
      {action}
    </div>
  );
};
