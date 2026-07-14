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
    <div className="p-12 text-center">
      <Icon className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
      <h3 className="text-lg font-medium mb-2">{title}</h3>
      {hint && <p className="text-muted-foreground mb-4">{hint}</p>}
      {action}
    </div>
  );
};
