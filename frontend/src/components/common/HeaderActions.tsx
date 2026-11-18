import { Children, Fragment, isValidElement, ReactElement, ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button as AriaButton, Dialog, DialogTrigger } from 'react-aria-components';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ControlPopover, useSmallScreen } from '@/components/ui/Overlay';

/** `pin` keeps a supporting action visible when others fold; `more` always folds it. */
export type HeaderPlacement = 'pin' | 'more';
type Action = ReactElement<{ 'data-header'?: HeaderPlacement }>;

function flatten(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap(child => isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment ? flatten(child.props.children) : [child]);
}

const isAction = (node: ReactNode): node is Action => isValidElement(node) && [Button, Link, 'button', 'a'].includes(node.type as typeof Button);

/** Which supporting actions stay beside the main one, and which go under "More". */
function arrange(actions: ReactNode[], limit: number) {
  if (!actions.every(isAction)) return null;
  const supporting = actions.slice(0, -1);
  const placed = (action: Action, placement: HeaderPlacement) => action.props['data-header'] === placement;
  const forced = supporting.some(action => placed(action, 'more'));
  if (!forced && actions.length <= limit) return null;
  const free = supporting.filter(action => !placed(action, 'more'));
  // "More" and the main action take two places; pinned actions get the rest first, then those nearest the main one.
  const kept = new Set([...free.filter(action => placed(action, 'pin')), ...free.filter(action => !placed(action, 'pin')).reverse()].slice(0, Math.max(0, limit - 2)));
  return { visible: supporting.filter(action => kept.has(action)), folded: supporting.filter(action => !kept.has(action)), main: actions[actions.length - 1] };
}

/**
 * A page header's buttons. The last child is the page's main action and always
 * shows, on the right. At most three buttons show on a computer and two on a
 * phone; the others fold into "More" with their own handlers, links and disabled
 * states. Mark a supporting action `data-header="pin"` to keep it visible, or
 * `data-header="more"` to always fold it.
 */
export function HeaderActions({ children }: { children: ReactNode }) {
  const mobile = useSmallScreen();
  const [open, setOpen] = useState(false);
  const layout = arrange(flatten(children), mobile ? 2 : 3);
  return <div className="page-actions ml-auto flex max-w-full flex-wrap items-center justify-end gap-2 [&>*]:max-w-full">
    {layout ? <><DialogTrigger isOpen={open} onOpenChange={setOpen}>
      <AriaButton type="button" className="page-action" aria-label="More actions"><MoreHorizontal aria-hidden="true" size={16} />More</AriaButton>
      <ControlPopover placement="bottom end"><Dialog aria-label="More actions" className="header-more-menu" onClick={event => { if ((event.target as HTMLElement).closest('button:not(:disabled),a')) setOpen(false); }}>
        {layout.folded}
      </Dialog></ControlPopover>
    </DialogTrigger>{layout.visible}{layout.main}</> : children}
  </div>;
}
