import React from 'react';
import { LucideIcon } from 'lucide-react';
import { useWorkflowNavigation } from './WorkflowNavigation';
import { HeaderActions } from './HeaderActions';
import { PageTabStyleContext } from './PageTabs';

interface PageHeaderProps {
  title: string;
  /** Accepted for older pages; generic introductions are intentionally omitted. */
  subtitle?: React.ReactNode;
  /** Accepted for older pages; headers use text without decorative icon chips. */
  icon?: LucideIcon;
  /** Page-level actions. Put filters and clocks in the toolbar. */
  actions?: React.ReactNode;
  /** Optional extra row rendered below the title/actions line */
  children?: React.ReactNode;
  tabs?: React.ReactNode;
  secondaryTabs?: React.ReactNode;
  toolbar?: React.ReactNode;
}

function hasContent(node: React.ReactNode): boolean {
  if (node == null || typeof node === 'boolean') return false;
  if (typeof node === 'string') return node.trim().length > 0;
  if (Array.isArray(node)) return node.some(hasContent);
  if (React.isValidElement<{ children?: React.ReactNode }>(node) && node.type === React.Fragment) return hasContent(node.props.children);
  return true;
}

/**
 * Canonical page header: one consistent frame for every page — title on the
 * left, actions top-right — mirroring the POS top bar treatment.
 */
export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  actions,
  children,
  tabs,
  secondaryTabs,
  toolbar,
}) => {
  const workflow = useWorkflowNavigation();
  const nestedTabs = workflow?.secondaryTabs || secondaryTabs;
  const additionalTabs = workflow?.tabs && tabs;
  return (
    <header className="page-header mb-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h1 className="min-w-0 text-2xl font-semibold leading-8 tracking-tight break-words">{workflow?.title || title}</h1>
        {hasContent(actions) && (
          <HeaderActions>{actions}</HeaderActions>
        )}
      </div>
      {(workflow?.tabs || tabs) && <PageTabStyleContext.Provider value="primary"><div>{workflow?.tabs || tabs}</div></PageTabStyleContext.Provider>}
      {nestedTabs && <PageTabStyleContext.Provider value="subtle"><div className="page-secondary-row">{nestedTabs}</div></PageTabStyleContext.Provider>}
      {additionalTabs && <PageTabStyleContext.Provider value="subtle"><div className="page-secondary-row">{additionalTabs}</div></PageTabStyleContext.Provider>}
      {hasContent(toolbar) && <div className="page-toolbar flex flex-wrap items-center gap-2">{toolbar}</div>}
      {children}
    </header>
  );
};
