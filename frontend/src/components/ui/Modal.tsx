import React, { useContext, useLayoutEffect, useRef, useState } from 'react';
import { ModalOverlay, Modal as AriaModal, Dialog, Heading, Button } from 'react-aria-components';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { OverlayLevel } from './Overlay';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  /** One short line under the title saying what the form does. */
  description?: React.ReactNode;
  /** Accessible name when the dialog shows no title bar (e.g. a confirmation). */
  label?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  priority?: 'normal' | 'approval';
}

/** Keep the full focused control clear of fixed dialog headers and footers.
 * WebKit can otherwise scroll only the text caret into a short dialog body. */
function revealFocusedControl(event: React.FocusEvent<HTMLDivElement>) {
  const body = event.currentTarget, control = event.target;
  if (!(control instanceof HTMLElement) || !body.contains(control)) return;
  requestAnimationFrame(() => {
    if (!body.isConnected || document.activeElement !== control) return;
    const visible = body.getBoundingClientRect(), field = control.getBoundingClientRect();
    if (field.bottom > visible.bottom - 8) body.scrollTop += field.bottom - visible.bottom + 8;
    else if (field.top < visible.top + 8) body.scrollTop -= visible.top - field.top + 8;
  });
}

/** React Aria's focus walker checks [disabled], but native fieldsets disable
 * descendants through :disabled. Keep those descendants out of its tab order. */
function DisabledFieldsetTabStops() {
  const marker = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const container = marker.current?.parentElement;
    if (!container) return;
    const previous = new Map<HTMLElement, string | null>();
    const restore = (element: HTMLElement, value: string | null) => {
      if (value === null) element.removeAttribute('tabindex'); else element.setAttribute('tabindex', value);
    };
    const synchronize = () => {
      for (const [element, value] of previous) {
        if (!container.contains(element) || !element.matches(':disabled')) { restore(element, value); previous.delete(element); }
      }
      for (const element of container.querySelectorAll<HTMLElement>('fieldset:disabled input, fieldset:disabled select, fieldset:disabled textarea, fieldset:disabled button')) {
        if (!element.matches(':disabled') || element.hasAttribute('disabled')) continue;
        if (!previous.has(element)) previous.set(element, element.getAttribute('tabindex'));
        if (element.tabIndex !== -1) element.tabIndex = -1;
      }
    };
    synchronize();
    const observer = new MutationObserver(synchronize);
    observer.observe(container, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'tabindex'] });
    return () => { observer.disconnect(); for (const [element, value] of previous) restore(element, value); };
  }, []);
  return <span ref={marker} hidden />;
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, description, label, children, footer, size = 'md', className, priority }) => {
  const parentLevel = useContext(OverlayLevel);
  const origin = useRef<HTMLSpanElement>(null);
  const [backgroundAllowed, setBackgroundAllowed] = useState(false);
  // Portals must preserve the explicit live-status opt-out of their owning view.
  useLayoutEffect(() => {
    setBackgroundAllowed(origin.current?.closest('[data-auto-refresh]')?.getAttribute('data-auto-refresh') === 'allow');
  });
  const level = priority === 'approval' ? Math.max(100, parentLevel + 10) : parentLevel + 10;
  const sizes = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };
  return <><span ref={origin} hidden /><ModalOverlay isOpen={isOpen} onOpenChange={open => { if (!open) onClose(); }} isDismissable className="app-modal-overlay" style={{ zIndex: level }} data-auto-refresh={backgroundAllowed ? 'allow' : undefined}>
    <AriaModal className={cn('app-dialog w-full bg-background rounded-lg shadow-lg flex flex-col', sizes[size], className)}>
      <OverlayLevel.Provider value={level}>
        <Dialog aria-label={title || label || 'Confirmation'} className="app-dialog-content outline-none" data-auto-refresh-pause="true">
          <DisabledFieldsetTabStops />
          {title && <div className="flex items-center justify-between gap-3 p-4 border-b shrink-0">
            <div className="min-w-0"><Heading slot="title" className="text-lg font-semibold">{title}</Heading>{description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}</div>
            <Button type="button" onPress={onClose} className="dialog-close inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Close"><X size={16} /></Button>
          </div>}
          <div className="dialog-body min-h-0 p-4 overflow-y-auto" onFocusCapture={revealFocusedControl}>{children}</div>
          {footer && <div className="dialog-footer shrink-0 border-t bg-background p-4 rounded-b-lg">{footer}</div>}
        </Dialog>
      </OverlayLevel.Provider>
    </AriaModal>
  </ModalOverlay></>;
};
