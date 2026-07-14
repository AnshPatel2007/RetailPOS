import React from 'react';
import { LucideIcon } from 'lucide-react';

interface PageHeaderProps {
  title: string;
  subtitle?: React.ReactNode;
  /** Optional leading icon rendered in a tinted chip next to the title */
  icon?: LucideIcon;
  /** Right-aligned actions (buttons, filters, clocks) */
  actions?: React.ReactNode;
  /** Optional extra row rendered below the title/actions line */
  children?: React.ReactNode;
}

/**
 * Canonical page header: one consistent frame for every page — title on the
 * left, actions top-right — mirroring the POS top bar treatment.
 */
export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  icon: Icon,
  actions,
  children,
}) => {
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {Icon && (
            <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
              <Icon className="h-6 w-6" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-3xl font-bold truncate">{title}</h1>
            {subtitle && (
              <p className="text-muted-foreground mt-1">{subtitle}</p>
            )}
          </div>
        </div>
        {actions && (
          <div className="flex items-center gap-2 shrink-0">{actions}</div>
        )}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
};
