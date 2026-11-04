import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ModalOverlay, Modal as AriaModal, Dialog } from 'react-aria-components';
import { useNavigate } from 'react-router-dom';
import { CornerDownLeft, Search, Users, Package } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { matchNavigation, navigationFor, type QuickFindEntry } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import { Kbd } from '@/components/ui/Kbd';

const MANAGERS = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'];
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const quickFindShortcut = isMac ? '⌘K' : 'Ctrl K';

/** Jump to any page, tab or setting by typing a few letters. Opens with Ctrl+K (⌘K on Mac). */
export function QuickFind({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const role = useAuthStore(state => state.user?.role);
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();

  const entries = useMemo(() => navigationFor(role), [role]);
  const results = useMemo(() => {
    const matches = matchNavigation(entries, query).slice(0, 12);
    const text = query.trim();
    if (!text) return matches;
    // A search that names no page can still find a record.
    const lookups: QuickFindEntry[] = [
      ...(role && MANAGERS.includes(role) ? [{ name: `Find products matching “${text}”`, href: '/inventory?search=' + encodeURIComponent(text), icon: Package, roles: [] }] : []),
      { name: `Find customers matching “${text}”`, href: '/customers?search=' + encodeURIComponent(text), icon: Users, roles: [] },
    ];
    return [...matches, ...lookups];
  }, [entries, query, role]);

  useEffect(() => { if (isOpen) { setQuery(''); setActive(0); } }, [isOpen]);
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const go = (entry: QuickFindEntry | undefined) => { if (!entry) return; onClose(); navigate(entry.href); };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => Math.min(results.length - 1, index + 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(0, index - 1)); }
    else if (event.key === 'Home' && event.ctrlKey) { event.preventDefault(); setActive(0); }
    else if (event.key === 'End' && event.ctrlKey) { event.preventDefault(); setActive(results.length - 1); }
    else if (event.key === 'Enter') { event.preventDefault(); go(results[active]); }
  };

  return <ModalOverlay isOpen={isOpen} onOpenChange={open => { if (!open) onClose(); }} isDismissable className="app-modal-overlay quick-find-overlay" style={{ zIndex: 60 }}>
    <AriaModal className="app-dialog quick-find w-full max-w-xl rounded-lg bg-background shadow-lg">
      <Dialog aria-label="Quick find" className="app-dialog-content outline-none">
        <div className="flex items-center gap-3 border-b px-4">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input autoFocus value={query} onChange={event => setQuery(event.target.value)} onKeyDown={onKeyDown}
            role="combobox" aria-expanded="true" aria-controls={id + '-list'} aria-autocomplete="list" aria-label="Find a page, tab or setting"
            aria-activedescendant={results[active] ? `${id}-${active}` : undefined}
            placeholder="Find a page, tab or setting…" className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground" />
          <Kbd>Esc</Kbd>
        </div>
        <ul ref={list} id={id + '-list'} role="listbox" aria-label="Results" className="min-h-0 overflow-y-auto p-2">
          {results.map((entry, index) => {
            const Icon = entry.icon;
            return <li key={entry.href + entry.name} id={`${id}-${index}`} role="option" aria-selected={index === active}
              onMouseMove={() => setActive(index)} onClick={() => go(entry)}
              className={cn('flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm', index === active ? 'bg-primary/10 text-primary' : 'text-foreground')}>
              <Icon className="h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              {entry.within && <span className="shrink-0 text-xs text-muted-foreground">{entry.within}</span>}
              {index === active && <CornerDownLeft className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
            </li>;
          })}
        </ul>
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t px-4 py-2 text-xs text-muted-foreground">
          <span><Kbd>↑</Kbd> <Kbd>↓</Kbd> to move</span><span><Kbd>Enter</Kbd> to open</span>
        </div>
      </Dialog>
    </AriaModal>
  </ModalOverlay>;
}

/** Opens quick-find from anywhere except the register, which owns its own keys. */
export function useQuickFindShortcut(enabled: boolean, open: () => void) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') { event.preventDefault(); open(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [enabled, open]);
}
