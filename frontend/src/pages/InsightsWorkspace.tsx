import { lazy, Suspense } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { WorkflowNavigation } from '@/components/common/WorkflowNavigation';
import { PageTabs } from '@/components/common/PageTabs';
import { PageHeader } from '@/components/common/PageHeader';
import { useUrlFilter } from '@/hooks/useUrlFilter';
import { useEffectiveLocation } from '@/hooks/useEffectiveLocation';
import type { ReportView } from './Reports';

const Reports = lazy(() => import('./Reports').then(module => ({ default: module.Reports })));
type View = { id: string; label: string; report: ReportView };
/**
 * The reports a store uses day to day. Analysis extras (ABC, product matrix,
 * forecasts, what-if, anomalies, bundles, leaderboards) were removed: they
 * repeated these reports, Finances or Purchasing.
 */
const sections: Record<string, { label: string; views: View[] }> = {
  overview: { label: 'Overview', views: [{ id: 'summary', label: 'Overall Report', report: 'overall' }] },
  sales: { label: 'Sales', views: [{ id: 'transactions', label: 'Transactions & Refunds', report: 'sales' }] },
  inventory: { label: 'Inventory', views: [{ id: 'stock-health', label: 'Stock Health', report: 'stock-health' }] },
  staff: { label: 'Staff', views: [{ id: 'sales', label: 'Employee Sales', report: 'employee' }] },
  exports: { label: 'Exports', views: [{ id: 'exports', label: 'Report & Accounting Exports', report: 'exports' }] },
};
const navigation = Object.entries(sections).map(([id, section]) => ({ label: section.label, path: '/insights/reports/' + id }));

export function InsightsWorkspace() {
  const { section = 'overview' } = useParams();
  const selected = sections[section] || sections.overview;
  const [view, setView] = useUrlFilter('view', selected.views[0].id, false);
  const active = selected.views.find(option => option.id === view) || selected.views[0];
  const { locationId } = useEffectiveLocation();
  return <WorkflowNavigation label="Reports" views={navigation}
    secondaryTabs={selected.views.length > 1 ? <PageTabs secondary label={selected.label + ' report views'} items={selected.views.map(option => ({ id: option.id, label: option.label }))} value={active.id} onChange={setView} /> : undefined}>
    <Suspense fallback={<div className="p-4 sm:p-8"><PageHeader title="Reports" /><p role="status">Loading view…</p></div>}>
      <Reports key={section + active.id + locationId} view={active.report} />
    </Suspense>
  </WorkflowNavigation>;
}

/** Preserve legacy query filters and map the old selected tab to its new home (removed views open the Overview). */
export function LegacyInsightsRedirect({ source }: { source: 'reports' | 'analytics' }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const oldTab = params.get('tab') || (source === 'reports' ? 'sales' : 'overview');
  const match = source === 'reports' ? Object.entries(sections).flatMap(([section, item]) => item.views.map(view => ({ section, view })))
    .find(({ view }) => view.report === oldTab) : undefined;
  const section = match?.section || 'overview';
  params.delete('tab'); params.set('view', match?.view.id || 'summary');
  return <Navigate to={'/insights/reports/' + section + '?' + params.toString() + location.hash} replace />;
}
