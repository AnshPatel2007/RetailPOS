type EnvironmentReason = 'focus' | 'online' | 'availability';
const listeners = new Set<(reason: EnvironmentReason) => void>();
const dirtyForms = new Set<HTMLFormElement>();
let cleanup: (() => void) | undefined;

function visible(element: Element) {
  return !element.closest('[hidden], [inert], [aria-hidden="true"]') && element.getClientRects().length > 0;
}

/** Explicitly editable/reviewed state is never replaced by a background read. */
export function canRefreshInBackground() {
  if (typeof document === 'undefined' || typeof navigator === 'undefined') return false;
  if (document.visibilityState !== 'visible' || navigator.onLine === false) return false;
  for (const form of dirtyForms) {
    if (!form.isConnected) { dirtyForms.delete(form); continue; }
    if (visible(form) && !form.closest('[data-auto-refresh="allow"]')) return false;
  }
  return !Array.from(document.querySelectorAll('[aria-modal="true"], dialog[open], [data-auto-refresh-pause="true"]'))
    .some(element => visible(element) && !element.closest('[data-auto-refresh="allow"]'));
}

/** One set of browser listeners is shared by every mounted query. No timers while hidden. */
export function subscribeRefreshEnvironment(listener: (reason: EnvironmentReason) => void) {
  listeners.add(listener);
  if (!cleanup && typeof document !== 'undefined' && typeof window !== 'undefined') {
    const notify = (reason: EnvironmentReason) => { listeners.forEach(callback => callback(reason)); };
    const focus = () => notify('focus');
    const online = () => notify('online');
    const availability = () => notify('availability');
    const visibility = () => notify(document.visibilityState === 'visible' ? 'focus' : 'availability');
    const edited = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const form = target.closest('form');
      if (!form || form.getAttribute('role') === 'search' || form.closest('[data-auto-refresh="allow"]')) return;
      if (target.matches('input[type="search"], input[type="submit"], input[type="button"], button')) return;
      dirtyForms.add(form); availability();
    };
    const reset = (event: Event) => {
      if (event.target instanceof HTMLFormElement) dirtyForms.delete(event.target);
      availability();
    };
    window.addEventListener('focus', focus);
    window.addEventListener('online', online);
    window.addEventListener('offline', availability);
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('input', edited, true);
    document.addEventListener('change', edited, true);
    document.addEventListener('reset', reset, true);
    const observer = new MutationObserver(availability);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'inert', 'aria-hidden', 'aria-modal', 'open', 'data-auto-refresh', 'data-auto-refresh-pause'] });
    cleanup = () => {
      window.removeEventListener('focus', focus); window.removeEventListener('online', online); window.removeEventListener('offline', availability);
      document.removeEventListener('visibilitychange', visibility); document.removeEventListener('input', edited, true);
      document.removeEventListener('change', edited, true); document.removeEventListener('reset', reset, true);
      observer.disconnect(); dirtyForms.clear();
    };
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { cleanup?.(); cleanup = undefined; }
  };
}
