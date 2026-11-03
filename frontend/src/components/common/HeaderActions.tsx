import { Children, Fragment, isValidElement, ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button as AriaButton, Dialog, DialogTrigger } from 'react-aria-components';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ControlPopover, useSmallScreen } from '@/components/ui/Overlay';

function flatten(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap(child => isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment ? flatten(child.props.children) : [child]);
}

/** Preserve the original action handlers, links and primary action on small screens. */
export function HeaderActions({ children }: { children: ReactNode }) {
  const mobile = useSmallScreen();
  const [open, setOpen] = useState(false);
  const actions = flatten(children);
  const compact = mobile && actions.length > 2 && actions.every(action => isValidElement(action) && [Button, Link, 'button', 'a'].includes(action.type as typeof Button));
  return <div className="page-actions ml-auto flex max-w-full flex-wrap items-center justify-end gap-2 [&>*]:max-w-full">
    {compact ? <><DialogTrigger isOpen={open} onOpenChange={setOpen}>
      <AriaButton type="button" className="page-action"><MoreHorizontal aria-hidden="true" size={16} />More actions</AriaButton>
      <ControlPopover placement="bottom start"><Dialog aria-label="Page actions" className="flex w-56 flex-col gap-1 p-2 outline-none [&>button]:justify-start [&>a]:justify-start" onClick={event => { if ((event.target as HTMLElement).closest('button:not(:disabled),a')) setOpen(false); }}>
        {actions.slice(0, -1)}
      </Dialog></ControlPopover>
    </DialogTrigger>{actions.at(-1)}</> : children}
  </div>;
}
