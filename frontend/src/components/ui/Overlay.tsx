import React, { createContext, useContext, useEffect, useState } from 'react';
import { Popover, type PopoverProps } from 'react-aria-components';
import { cn } from '@/lib/utils';

export const OverlayLevel = createContext(50);

export function useSmallScreen() {
  const [small, setSmall] = useState(() => window.matchMedia('(max-width: 639px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 639px)');
    const update = () => setSmall(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return small;
}

/** Child overlays share their parent's focus scope and always sit above it. */
export function ControlPopover({ className, children, ...props }: PopoverProps) {
  const level = useContext(OverlayLevel) + 5;
  return <Popover {...props} offset={6} className={cn('control-popover', typeof className === 'string' && className)}
    style={{ zIndex: level }} data-auto-refresh-pause="true">
    <OverlayLevel.Provider value={level}>{children as React.ReactNode}</OverlayLevel.Provider>
  </Popover>;
}
