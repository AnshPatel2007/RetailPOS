import React, { useCallback, useState } from 'react';
import { today } from '@internationalized/date';
import { PageTabs } from '@/components/common/PageTabs';
import { PageHeader } from '@/components/common/PageHeader';
import { useAuthStore } from '@/store/authStore';
import { useEffectiveLocation } from '@/hooks/useEffectiveLocation';
import { useUrlFilter } from '@/hooks/useUrlFilter';
import { can } from '@/lib/capabilities';
import { DailyEntryTable } from '@/components/lottery/DailyEntryTable';
import { DailySummary } from '@/components/lottery/DailySummary';
import { LotteryGameSetup } from '@/components/lottery/LotteryGameSetup';
import { LotterySimpleDaily } from '@/components/lottery/LotterySimpleDaily';
import { LotteryReports } from '@/components/lottery/LotteryReports';
import { useCalendarTimezone } from '@/hooks/useCalendarTimezone';
import { Button } from '@/components/ui/Button';

export const Lottery: React.FC = () => {
  const { locationId, isReadOnly } = useEffectiveLocation();
  const role = useAuthStore(state => state.user?.role);
  const [tab, setTab] = useUrlFilter('tab', 'daily', false);
  const timezone = useCalendarTimezone();
  const [date, setDate] = useUrlFilter('date', today(timezone).toString(), false);
  const [history, setHistory] = useUrlFilter('history', '', false);
  const [dailyNavigation, setDailyNavigation] = useState<React.ReactNode>(null);
  const dailyStages = useCallback((node: React.ReactNode) => setDailyNavigation(node), []);
  const tabs = [{ id: 'daily', label: 'Daily Entry' }, ...(role !== 'CASHIER' ? [{ id: 'reports', label: 'Reports' }] : []),
    ...(can(role, 'lottery.manage') || isReadOnly ? [{ id: 'ticketTypes', label: 'Ticket Setup' }] : [])];
  const activeTab = tabs.some(view => view.id === tab) ? tab : 'daily';
  const [pageActions, setPageActions] = useState<{ view: string; node: React.ReactNode } | null>(null);
  const reportActions = useCallback((node: React.ReactNode) => setPageActions({ view: 'reports', node }), []);
  const setupActions = useCallback((node: React.ReactNode) => setPageActions({ view: 'ticketTypes', node }), []);
  const dailyActions = useCallback((node: React.ReactNode) => setPageActions({ view: 'daily', node }), []);

  return <div className="p-4 sm:p-8">
    <PageHeader title="Lottery" actions={pageActions?.view === activeTab ? pageActions.node : undefined}
      tabs={<PageTabs label="Lottery views" items={tabs} value={activeTab} onChange={setTab} />}
      secondaryTabs={activeTab === 'daily' && history !== 'legacy' ? dailyNavigation : undefined} />
    {locationId ? <>
      {history === 'legacy' && activeTab !== 'ticketTypes' && <div className="flex flex-wrap justify-between gap-3 items-center mb-4"><p className="text-sm text-muted-foreground">Earlier lottery records · Read only</p><Button variant="outline" onClick={() => setHistory('')}>Current lottery records</Button></div>}
      {activeTab === 'daily' && (history === 'legacy' ? <DailyEntryTable key={locationId} locationId={locationId} isReadOnly /> : <LotterySimpleDaily key={locationId + date} locationId={locationId} date={date} onDateChange={setDate} readOnly={isReadOnly} onActionsChange={dailyActions} onNavigationChange={dailyStages} />)}
      {activeTab === 'reports' && (history === 'legacy' ? <DailySummary key={locationId} locationId={locationId} onActionsChange={reportActions} /> : <LotteryReports key={locationId} locationId={locationId} readOnly={isReadOnly} onActionsChange={reportActions} />)}
      {activeTab === 'ticketTypes' && <LotteryGameSetup key={locationId} locationId={locationId} readOnly={isReadOnly} onActionsChange={setupActions} />}
    </> : <p className="text-sm text-muted-foreground">Select a store to view lottery records.</p>}
  </div>;
};
