import { Button, Menu, MenuItem, MenuTrigger } from 'react-aria-components';
import { MoreHorizontal } from 'lucide-react';
import { ControlPopover } from './Overlay';
import type { ReactNode } from 'react';

export interface ActionMenuItem { id: string; label: string; icon?: ReactNode; disabled?: boolean; destructive?: boolean; onAction: () => void }
export function ActionMenu({ label = 'More actions', items, iconOnly = false }: { label?: string; items: ActionMenuItem[]; iconOnly?: boolean }) {
  return <MenuTrigger><Button type="button" aria-label={label} className={iconOnly ? 'action-menu-icon' : 'page-action'}><MoreHorizontal size={16} aria-hidden="true" />{!iconOnly && label}</Button>
    <ControlPopover placement="bottom end"><Menu aria-label={label} className="control-list action-menu" items={items} disabledKeys={items.filter(item => item.disabled).map(item => item.id)}>
      {item => <MenuItem id={item.id} textValue={item.label} onAction={item.onAction} className={'control-option' + (item.destructive ? ' text-destructive' : '')}><span className="flex items-center gap-2">{item.icon}{item.label}</span></MenuItem>}
    </Menu></ControlPopover>
  </MenuTrigger>;
}
