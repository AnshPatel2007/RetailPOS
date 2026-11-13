import { useThemeStore, type Look } from '@/store/themeStore';
import { cn } from '@/lib/utils';

const looks: { id: Look; label: string }[] = [{ id: 'classic', label: 'Classic' }, { id: 'new', label: 'New' }];
const label = (look: Look) => looks.find(option => option.id === look)!.label;

/**
 * Temporary: flips between the Classic and New looks so the owner can compare
 * them on every real screen. It goes away once one look is chosen.
 */
export function LookSwitch({ collapsed = false, className }: { collapsed?: boolean; className?: string }) {
  const { look, setLook } = useThemeStore();
  if (collapsed) {
    const next: Look = look === 'new' ? 'classic' : 'new';
    return <button type="button" className={cn('look-switch-single', className)} onClick={() => setLook(next)}
      aria-label={`Look: ${label(look)}. Switch to ${label(next)}`} title={`Look: ${label(look)}. Switch to ${label(next)}`}>{label(look)[0]}</button>;
  }
  return <div role="group" aria-label="Look" className={cn('look-switch', className)}>
    <span className="look-switch-label" aria-hidden="true">Look</span>
    {looks.map(option => <button key={option.id} type="button" aria-pressed={look === option.id} onClick={() => setLook(option.id)}>{option.label}</button>)}
  </div>;
}
