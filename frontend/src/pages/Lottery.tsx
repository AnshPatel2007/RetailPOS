import React, { useState, useEffect } from 'react';
import { logger } from '../utils/logger';
import {
  Ticket,
  FileText,
  RefreshCw,
  DollarSign,
  TrendingUp,
  Calendar,
  Settings,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { lotteryService } from '@/services/api';
import { useEffectiveLocation } from '@/hooks/useEffectiveLocation';
import { AdminViewBanner } from '@/components/AdminViewBanner';
import { DailyEntryTable } from '@/components/lottery/DailyEntryTable';
import { DailySummary } from '@/components/lottery/DailySummary';
import { TicketTypeSettings } from '@/components/lottery/TicketTypeSettings';
import toast from 'react-hot-toast';

// Tab types
type TabType = 'daily' | 'reports' | 'ticketTypes';

export const Lottery: React.FC = () => {
  const { locationId, isReadOnly, isAdminViewing, storeName } = useEffectiveLocation();
  const [activeTab, setActiveTab] = useState<TabType>('daily');
  const [todayTransaction, setTodayTransaction] = useState<any>(null);

  useEffect(() => {
    fetchDashboardData();
  }, [locationId]);

  const fetchDashboardData = async () => {
    try {
      const params: any = {};
      if (locationId) {
        params.locationId = locationId;
      }

      const transactionsRes = await lotteryService.getTransactions({ ...params, status: 'OPEN' });

      // Get today's transaction if exists
      const transactions = transactionsRes.data.data || [];
      const today = new Date().toDateString();
      const todayTx = transactions.find((tx: any) =>
        new Date(tx.transactionDate).toDateString() === today
      );
      setTodayTransaction(todayTx || null);
    } catch (error) {
      logger.error('Failed to fetch lottery data:', error);
      toast.error('Failed to load lottery data');
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value || 0);
  };

  const tabs = [
    { id: 'daily' as TabType, label: 'Daily Entry', icon: Calendar },
    { id: 'reports' as TabType, label: 'Reports', icon: FileText },
    { id: 'ticketTypes' as TabType, label: 'Ticket Types', icon: Settings },
  ];

  return (
    <div className="p-8">
      {isAdminViewing && <AdminViewBanner storeName={storeName || ''} />}

      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">Lottery Management</h1>
          <p className="text-muted-foreground">
            Track lottery sales and daily transactions
          </p>
        </div>
        <Button
          onClick={fetchDashboardData}
          variant="outline"
          className="flex items-center gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Today's Sales</p>
              <p className="text-2xl font-bold mt-1">
                {formatCurrency(
                  (todayTransaction?.onlineSalesAmount || 0) +
                  (todayTransaction?.offlineSalesAmount || 0)
                )}
              </p>
            </div>
            <div className="bg-blue-500/10 p-3 rounded-full">
              <DollarSign className="h-6 w-6 text-blue-500" />
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Online Sales</p>
              <p className="text-2xl font-bold mt-1">
                {todayTransaction?.onlineSalesCount || 0}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {formatCurrency(todayTransaction?.onlineSalesAmount || 0)}
              </p>
            </div>
            <div className="bg-green-500/10 p-3 rounded-full">
              <TrendingUp className="h-6 w-6 text-green-500" />
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Offline Sales</p>
              <p className="text-2xl font-bold mt-1">
                {todayTransaction?.offlineSalesCount || 0}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {formatCurrency(todayTransaction?.offlineSalesAmount || 0)}
              </p>
            </div>
            <div className="bg-purple-500/10 p-3 rounded-full">
              <Ticket className="h-6 w-6 text-purple-500" />
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Cashout</p>
              <p className="text-2xl font-bold mt-1">
                {formatCurrency(todayTransaction?.cashoutAmount || 0)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Net: {formatCurrency(todayTransaction?.netAmount || 0)}
              </p>
            </div>
            <div className="bg-orange-500/10 p-3 rounded-full">
              <DollarSign className="h-6 w-6 text-orange-500" />
            </div>
          </div>
        </Card>
      </div>

      {/* Tabs */}
      <div className="border-b border-border">
        <nav className="-mb-px flex space-x-8">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm
                  ${
                    activeTab === tab.id
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                  }
                `}
              >
                <Icon className="h-5 w-5" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="mt-6">
        {activeTab === 'daily' && (
          <DailyEntryTable
            locationId={locationId || undefined}
            isReadOnly={isReadOnly}
            onUpdate={fetchDashboardData}
          />
        )}

        {activeTab === 'reports' && (
          <DailySummary locationId={locationId || undefined} />
        )}

        {activeTab === 'ticketTypes' && (
          <TicketTypeSettings
            locationId={locationId || undefined}
            isReadOnly={isReadOnly}
          />
        )}
      </div>
    </div>
  );
};
