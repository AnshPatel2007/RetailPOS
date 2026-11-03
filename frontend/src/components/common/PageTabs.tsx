import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

export interface PageTabItem {
  id: string;
  label: React.ReactNode;
  href?: string;
  disabled?: boolean;
}

export const pageTabClassName = 'page-tab inline-flex shrink-0 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50';

/** Style is determined by navigation level, never by the selected view. */
export const PageTabStyleContext = createContext<'primary' | 'subtle'>('primary');

export function PageTabs({ label, items, value, onChange, secondary = false }: {
  label: string;
  items: PageTabItem[];
  value: string;
  onChange?: (id: string) => void;
  secondary?: boolean;
}) {
  const prominent = useContext(PageTabStyleContext) === 'primary' && !secondary;
  const navigation = useRef<HTMLElement>(null);
  const [scroll, setScroll] = useState({ overflow: false, left: false, right: false });
  useEffect(() => {
    const element = navigation.current;
    if (!element) return;
    const measure = () => setScroll({ overflow: element.scrollWidth > element.clientWidth + 1, left: element.scrollLeft > 1, right: element.scrollLeft + element.clientWidth < element.scrollWidth - 1 });
    const resize = new ResizeObserver(measure); resize.observe(element);
    element.addEventListener('scroll', measure); measure();
    return () => { resize.disconnect(); element.removeEventListener('scroll', measure); };
  }, [items.length]);
  useEffect(() => {
    const element = navigation.current, active = element?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!element || !active || element.scrollWidth <= element.clientWidth + 1) return;
    const rect = element.getBoundingClientRect(), item = active.getBoundingClientRect();
    if (item.left < rect.left) element.scrollLeft -= rect.left - item.left;
    if (item.right > rect.right) element.scrollLeft += item.right - rect.right;
  }, [value, scroll.overflow]);
  if (items.length < 2) return null;
  return <div className={cn('page-tab-scroll-shell', secondary && 'page-tabs-secondary')}>
    <button type="button" className="tab-scroll-button" data-overflow={scroll.overflow} disabled={!scroll.left} aria-label={'Scroll ' + label.toLowerCase() + ' left'} onClick={() => navigation.current?.scrollBy({ left: -220 })}><ChevronLeft size={16} /></button>
    <nav ref={navigation} aria-label={label} className="page-tabs flex min-w-0 items-center gap-2">
    {items.map(item => {
      const active = item.id === value;
      const className = cn(pageTabClassName, active
        ? prominent ? 'border-primary/30 bg-primary/10 text-primary' : 'border-transparent bg-primary/10 text-primary'
        : prominent ? 'border-input bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground' : 'border-transparent bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground');
      return item.href && !item.disabled
        ? <Link key={item.id} to={item.href} aria-current={active ? 'page' : undefined} className={className}>{item.label}</Link>
        : <button key={item.id} type="button" disabled={item.disabled} onClick={() => onChange?.(item.id)} aria-current={active ? 'page' : undefined} className={className}>{item.label}</button>;
    })}
  </nav><button type="button" className="tab-scroll-button" data-overflow={scroll.overflow} disabled={!scroll.right} aria-label={'Scroll ' + label.toLowerCase() + ' right'} onClick={() => navigation.current?.scrollBy({ left: 220 })}><ChevronRight size={16} /></button></div>;
}
