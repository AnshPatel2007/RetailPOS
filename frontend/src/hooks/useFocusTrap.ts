import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const activeTraps: HTMLElement[] = [];
export const isTopFocusTrap = (element: HTMLElement | null) => activeTraps.at(-1) === element;

export function useFocusTrap(isActive: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isActive) return;

    // Save the previously focused element
    previousFocusRef.current = document.activeElement as HTMLElement;

    const container = containerRef.current;
    if (!container) return;
    activeTraps.push(container);

    // A disabled fieldset disables descendants without adding a disabled
    // attribute to each control. Hidden/inert controls cannot be trap endpoints.
    const focusableElementsIn = () => Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(element =>
      !element.matches(':disabled') && !element.closest('[hidden], [inert]') && element.tabIndex >= 0
      && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
    const focusableElements = focusableElementsIn();
    if (focusableElements.length > 0) {
      focusableElements[0].focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !isTopFocusTrap(container)) return;

      const focusable = focusableElementsIn();
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (!focusable.includes(document.activeElement as HTMLElement)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const index = activeTraps.indexOf(container);
      if (index >= 0) activeTraps.splice(index, 1);
      // Restore focus
      previousFocusRef.current?.focus();
    };
  }, [isActive]);

  return containerRef;
}
