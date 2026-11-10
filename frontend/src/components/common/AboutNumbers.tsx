import React from 'react';
import { cn } from '@/lib/utils';

/**
 * How a page's figures are counted, one click away instead of in front of them.
 * The store's time zone stays visible because it decides what "today" means.
 */
export function AboutNumbers({ timezone, children, className }: { timezone?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-start gap-x-4 gap-y-1 text-xs text-muted-foreground', className)}>
      {timezone && <p>Store time: {timezone}</p>}
      <details className="max-w-2xl">
        <summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">About these numbers</summary>
        <div className="mt-2 space-y-1 text-sm leading-5">{children}</div>
      </details>
    </div>
  );
}
