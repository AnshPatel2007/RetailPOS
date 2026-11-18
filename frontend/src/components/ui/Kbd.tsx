import { cn } from '@/lib/utils';

/** A keyboard key shown on a button or hint, e.g. <Kbd>F2</Kbd>. */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <kbd className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-[11px] font-semibold leading-none text-foreground/80', className)}>{children}</kbd>;
}
