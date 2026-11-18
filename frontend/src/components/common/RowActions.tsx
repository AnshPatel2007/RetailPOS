import { Button } from '@/components/ui/Button';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/ActionMenu';

type Optional<T> = T | false | null | undefined;

/**
 * A table row's actions: the one most used is a visible word ("Edit",
 * "Receive"); everything else sits under "…". Delete belongs in the menu, marked
 * `destructive`, and asks for confirmation where it is handled.
 */
export function RowActions({ name, primary, items = [] }: {
  /** What the row is, for screen readers: "Edit Fixture Coffee". */
  name: string;
  primary?: Optional<{ label: string; onAction: () => void; disabled?: boolean }>;
  /** Menu entries; falsy entries are skipped so they can be written as `canDelete && {…}`. */
  items?: Optional<ActionMenuItem>[];
}) {
  const menu = items.filter((item): item is ActionMenuItem => !!item);
  if (!primary && !menu.length) return null;
  return <div className="row-actions">
    {primary && <Button variant="ghost" disabled={primary.disabled} onClick={primary.onAction} aria-label={`${primary.label} ${name}`}>{primary.label}</Button>}
    {menu.length > 0 && <ActionMenu iconOnly label={`More actions for ${name}`} items={menu} />}
  </div>;
}
