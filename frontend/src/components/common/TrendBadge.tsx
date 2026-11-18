import { TrendingDown, TrendingUp } from 'lucide-react';

/** A percent change in sales with an up/down arrow; nothing when there is no fair comparison. */
export const TrendBadge = ({ trend, label }: { trend?: number | null; label?: string }) => {
  if (trend === undefined || trend === null) return null;
  const up = trend >= 0;
  return (
    <div className="flex items-center gap-1">
      <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${up ? 'text-success' : 'text-destructive'}`}>
        {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
        {up ? '+' : ''}{trend}%
      </span>
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
    </div>
  );
};
