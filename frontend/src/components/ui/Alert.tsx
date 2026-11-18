import React from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

type Tone = 'info' | 'success' | 'warning' | 'error';
const TONES: Record<Tone, { box: string; icon: React.ElementType }> = {
  info: { box: 'border-info/30 bg-info/10', icon: Info },
  success: { box: 'border-success/30 bg-success/10', icon: CheckCircle2 },
  warning: { box: 'border-warning/40 bg-warning/10', icon: AlertTriangle },
  error: { box: 'border-destructive/30 bg-destructive/10', icon: XCircle },
};

/**
 * The one way to show a message on a page or in a form: a tinted box with an
 * icon, an optional bold title, the message and an optional action on the right.
 * Errors and warnings are announced to screen readers.
 */
export function Alert({ tone = 'info', title, children, action, className }: {
  tone?: Tone; title?: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode; className?: string;
}) {
  const { box, icon: Icon } = TONES[tone];
  return (
    <div role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'}
      className={cn('flex items-start gap-3 rounded-lg border px-4 py-3 text-sm text-foreground', box, className)}>
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', tone === 'error' ? 'text-destructive' : tone === 'warning' ? 'text-warning' : tone === 'success' ? 'text-success' : 'text-info')} aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-0.5">
        {title && <p className="font-semibold leading-5">{title}</p>}
        {children && <div className="leading-5 text-foreground/80">{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}
