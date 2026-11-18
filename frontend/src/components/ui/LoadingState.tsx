import { cn } from '@/lib/utils';

const SIZES = { sm: 'h-4 w-4 border-2', md: 'h-6 w-6 border-2', lg: 'h-8 w-8 border-[3px]' };

/** The one spinner. Decorative: pair it with text or use LoadingState. */
export function Spinner({ size = 'md', className }: { size?: keyof typeof SIZES; className?: string }) {
  return <span aria-hidden="true" className={cn('inline-block animate-spin rounded-full border-primary border-t-transparent', SIZES[size], className)} />;
}

/** A centered "Loading orders…" block for a page, panel or table while data arrives. */
export function LoadingState({ label = 'Loading…', className, compact = false }: { label?: string; className?: string; compact?: boolean }) {
  return (
    <div role="status" className={cn('flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground', compact ? 'py-6' : 'py-14', className)}>
      <Spinner size={compact ? 'md' : 'lg'} />
      <span>{label}</span>
    </div>
  );
}
