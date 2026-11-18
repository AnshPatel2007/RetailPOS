import type { ReactElement } from 'react';
import { Tooltip as AriaTooltip, TooltipTrigger } from 'react-aria-components';

/** The trigger retains its own accessible name; the tooltip supplies extra context. */
export function Tooltip({ children, content }: { children: ReactElement; content: string }) {
  return <TooltipTrigger delay={400}>{children}<AriaTooltip className="app-tooltip" offset={6}>{content}</AriaTooltip></TooltipTrigger>;
}
