import { Button } from '@/components/ui/Button';

interface AutoRefreshStatusProps {
  state: { stale: boolean; error: string; refreshing: boolean; refresh: () => void };
}

/** A quiet update failure keeps the last good content visible and offers recovery. */
export function AutoRefreshStatus({ state }: AutoRefreshStatusProps) {
  if (!state.stale) return null;
  return <div role="status" className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground">
    <span>Showing previously loaded data. {state.error}</span>
    <Button type="button" variant="outline" size="sm" onClick={state.refresh} disabled={state.refreshing}>Retry</Button>
  </div>;
}
