import React from 'react';
import { cn } from '@/lib/utils';

/** Presentational workspace primitives. Queries and drafts belong to the caller. */
export function ManagementPage({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('management-page', className)} {...props} />;
}

interface DataPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  toolbar?: React.ReactNode;
  summary?: React.ReactNode;
  selection?: React.ReactNode;
  footer?: React.ReactNode;
}

export function DataPanel({ toolbar, summary, selection, footer, children, className, ...props }: DataPanelProps) {
  return <div className={cn('data-panel', className)} {...props}>
    {summary && <div className="data-panel-summary">{summary}</div>}
    {toolbar && <div className="data-panel-toolbar">{toolbar}</div>}
    {selection && <div className="data-panel-selection">{selection}</div>}
    <div className="data-panel-content">{children}</div>
    {footer && <div className="data-panel-footer">{footer}</div>}
  </div>;
}

export interface SummaryItem {
  label: React.ReactNode;
  value: React.ReactNode;
  detail?: React.ReactNode;
  tone?: 'default' | 'warning' | 'danger' | 'success';
  action?: React.ReactNode;
}

export function SummaryStrip({ items, className, emphasis = false }: {
  items: SummaryItem[];
  className?: string;
  emphasis?: boolean;
}) {
  return <dl className={cn('summary-strip', emphasis && 'summary-strip-emphasis', className)}>
    {items.map((item, index) => <div key={index} className="summary-item" data-tone={item.tone || 'default'}>
      <dt>{item.label}</dt>
      <dd className="summary-value">{item.value}</dd>
      {item.detail && <dd className="summary-detail">{item.detail}</dd>}
      {item.action && <dd className="summary-action">{item.action}</dd>}
    </div>)}
  </dl>;
}

export function FormSection({ title, description, children, className, collapsible, defaultOpen, summary, ...props }: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Render as a section the user opens when needed (native <details>). */
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** Short line shown next to a collapsed section's title, e.g. "Carton x10". */
  summary?: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, 'title'>) {
  const id = React.useId();
  if (collapsible) return <section className={cn('form-section form-section-collapsible', className)} aria-labelledby={id} {...props}>
    {/* A required field inside a closed section would block saving invisibly: open it instead. */}
    <details open={defaultOpen} onInvalidCapture={event => { (event.currentTarget as HTMLDetailsElement).open = true; }}>
      <summary className="form-section-summary">
        <span id={id} className="form-section-summary-title">{title}</span>
        {summary && <span className="form-section-summary-hint">{summary}</span>}
      </summary>
      {description && <p className="form-section-description">{description}</p>}
      <div className="form-section-fields">{children}</div>
    </details>
  </section>;
  return <section className={cn('form-section', className)} aria-labelledby={id} {...props}>
    <div className="form-section-heading">
      <h3 id={id}>{title}</h3>
      {description && <p>{description}</p>}
    </div>
    <div className="form-section-fields">{children}</div>
  </section>;
}
