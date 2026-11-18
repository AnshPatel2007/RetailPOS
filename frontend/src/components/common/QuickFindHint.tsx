import { useQuickFindStore } from '@/store/quickFindStore';
import { Kbd } from '@/components/ui/Kbd';
import { quickFindShortcut } from './QuickFind';

/** "Press Ctrl K to find any page" — clickable for people who don't use shortcuts. */
export function QuickFindHint() {
  const open = useQuickFindStore(state => state.open);
  return <button type="button" onClick={open} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
    Press <Kbd>{quickFindShortcut}</Kbd> to find any page
  </button>;
}
