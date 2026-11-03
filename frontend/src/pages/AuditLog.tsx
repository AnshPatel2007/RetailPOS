import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { ManagementPage } from '@/components/common/Workspace';
import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { FilterDropdown } from '@/components/common/FilterDropdown';
import { FilterChips } from '@/components/common/FilterChips';
import { formatEnumLabel } from '@/lib/utils';
import { Select } from '@/components/ui/Select';
import { useLegacyPageRefresh } from '@/hooks/useLegacyPageRefresh';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { auditLogService } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  Search,
  Filter,
  Shield,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { PageHeader } from '@/components/common/PageHeader';
import { Pagination } from '@/components/common/Pagination';
import { EmptyState } from '@/components/common/EmptyState';
import { StoreFilterSelect } from '@/components/common/StoreFilterSelect';

interface AuditEntry {
  id: string;
  userId: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  details: any;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: string;
  } | null;
}


function ActivityFilters({ filters, onFilterChange, onClear, actions, entities }: {
  filters: { action: string; entity: string }; onFilterChange: (value: { action: string; entity: string }) => void;
  onClear: () => void; actions: string[]; entities: string[];
}) {
  return <div className="space-y-4"><div className="flex items-center justify-between"><h3 className="text-sm font-medium">Activity filters</h3><Button type="button" variant="ghost" onClick={onClear}>Clear</Button></div>
    <Select label="Action" value={filters.action} onChange={event => onFilterChange({ ...filters, action: event.target.value })}><option value="">All actions</option>{actions.map(action => <option key={action} value={action}>{formatEnumLabel(action)}</option>)}</Select>
    <Select label="Entity" value={filters.entity} onChange={event => onFilterChange({ ...filters, entity: event.target.value })}><option value="">All entities</option>{entities.map(entity => <option key={entity} value={entity}>{formatEnumLabel(entity)}</option>)}</Select>
  </div>;
}

export const AuditLog: React.FC = () => {
  const user = useAuthStore(state => state.user);
  const requests = useRef(0);
  const [error, setError] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [loadedScope, setLoadedScope] = useState('');
  const [filterScope, setFilterScope] = useState('');
  const [filterError, setFilterError] = useState('');
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [locationId, setLocationId] = useState('');
  const [actions, setActions] = useState<string[]>([]);
  const [entities, setEntities] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const scopeKey = `${user?.id}:${user?.role}:${locationId || user?.locationId || ''}`;
  const visibleLogs = loadedScope === scopeKey ? logs : [];

  const fetchLogs = useCallback(async (quiet = false, active: () => boolean = () => true, signal?: AbortSignal) => {
    const current = ++requests.current;
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const params: any = { page, limit: 50 };
      if (debouncedSearch) params.search = debouncedSearch;
      if (actionFilter) params.action = actionFilter;
      if (entityFilter) params.entity = entityFilter;
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      if (locationId) params.locationId = locationId;

      const res = await auditLogService.getAll(params, signal);
      if (current !== requests.current || !active()) return;
      setError('');
      setLoadedScope(scopeKey); setTimezone(res.data.timezone);
      setLogs(res.data.data);
      setTotalPages(res.data.pagination.totalPages);
      setTotal(res.data.pagination.total);
    } catch (failure) {
      if (quiet) throw failure;
      if (current === requests.current) setError('Activity could not be loaded. Try again.');
    } finally {
      if (current === requests.current) setLoading(false);
    }
  }, [page, debouncedSearch, actionFilter, entityFilter, startDate, endDate, locationId, scopeKey]);

  // Debounce search input so we don't fetch on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    void fetchLogs();
    return () => { requests.current++; };
  }, [fetchLogs]);

  useEffect(() => {
    let cancelled = false; setFilterError(''); setExpandedRow(null);
    void Promise.all([auditLogService.getActions(locationId || undefined), auditLogService.getEntities(locationId || undefined)])
      .then(([actionsResponse, entitiesResponse]) => {
        if (cancelled) return;
        setActions(actionsResponse.data.data); setEntities(entitiesResponse.data.data); setFilterScope(scopeKey);
      }).catch(() => { if (!cancelled) setFilterError('Filter options could not be loaded. You can still search or refresh the page.'); });
    return () => { cancelled = true; };
  }, [locationId, scopeKey]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setDebouncedSearch(search);
  };

  const getActionColor = (action: string) => {
    if (action.includes('DELETE') || action.includes('VOID') || action.includes('REFUND'))
      return 'bg-destructive/10 text-destructive';
    if (action.includes('CREATE') || action.includes('ENABLED'))
      return 'bg-success/10 text-success';
    if (action.includes('UPDATE') || action.includes('EDIT') || action.includes('PRICE'))
      return 'bg-warning/10 text-warning';
    if (action.includes('LOGIN') || action.includes('AUTH'))
      return 'bg-info/10 text-info';
    return 'bg-muted text-muted-foreground';
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { timeZone: timezone, month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString(undefined, { timeZone: timezone, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const autoRefresh = useLegacyPageRefresh((current, signal) => fetchLogs(true, current, signal), { key: JSON.stringify([scopeKey, page, debouncedSearch, actionFilter, entityFilter, startDate, endDate]), paused: loading });

  return (
    <ManagementPage className=" space-y-4">
      <PageHeader
        title="Audit Log"
        subtitle={loadedScope === scopeKey && !error ? `${total} total entries | ${timezone}` : 'Store activity'}
        icon={Shield}
      />
      {autoRefresh.notice}

      {error && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive"><p>{error}</p><Button variant="outline" onClick={() => void fetchLogs()}>Retry</Button></div>}
      {filterError && <p role="status" className="text-sm text-muted-foreground">{filterError}</p>}
      {/* Search & Filters */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <DateRangePicker label="Activity dates" timezone={timezone} startDate={startDate} endDate={endDate} onChange={range => { setStartDate(range.startDate); setEndDate(range.endDate); setPage(1); }} />
          <StoreFilterSelect value={locationId} onChange={v => { setLocationId(v); setPage(1); setActionFilter(''); setEntityFilter(''); }} />
          <div className="relative"><Button type="button" variant="outline" onClick={() => setShowFilters(!showFilters)} aria-expanded={showFilters}><Filter size={16} />Filters</Button>
            <FilterDropdown isOpen={showFilters} onClose={() => setShowFilters(false)} title="Activity filters">
              <ActivityFilters filters={{ action: actionFilter, entity: entityFilter }} onFilterChange={filters => { setActionFilter(filters.action); setEntityFilter(filters.entity); setPage(1); }} onClear={() => { setActionFilter(''); setEntityFilter(''); setPage(1); }} actions={filterScope === scopeKey ? actions : []} entities={filterScope === scopeKey ? entities : []} />
            </FilterDropdown>
          </div>
        </div>
        <form role="search" onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search actions, entities, IDs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="primary" size="sm">Search</Button>
        </form>

<FilterChips filters={{ action: actionFilter, entity: entityFilter }} onChange={filters => { setActionFilter(filters.action); setEntityFilter(filters.entity); setPage(1); }} count={loadedScope === scopeKey && !error ? total : undefined} itemName="entries" />
      </div>

      {/* Table */}
      <div className="border rounded-lg bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <Table scrollLabel="Audit Log records" className="w-full text-sm">
            <TableHeader className="bg-muted/50 border-b">
              <TableRow>
                <TableHead className="text-left px-4 py-2 font-medium">Time</TableHead>
                <TableHead className="text-left px-4 py-2 font-medium">User</TableHead>
                <TableHead className="text-left px-4 py-2 font-medium">Action</TableHead>
                <TableHead className="text-left px-4 py-2 font-medium">Entity</TableHead>
                <TableHead className="text-left px-4 py-2 font-medium">Entity ID</TableHead>
                <TableHead className="text-left px-4 py-2 font-medium">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y">
              {loading || (!error && loadedScope !== scopeKey) ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : error ? <TableRow><TableCell colSpan={6} className="p-8 text-center">Activity unavailable</TableCell></TableRow> : visibleLogs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <EmptyState
                      icon={Shield}
                      title="No audit log entries found"
                      hint="Try widening the date range or clearing filters"
                    />
                  </TableCell>
                </TableRow>
              ) : (
                visibleLogs.map((log) => (
                  <React.Fragment key={log.id}>
                    <TableRow
                      className="hover:bg-muted/30 cursor-pointer"
                      onClick={() => setExpandedRow(expandedRow === log.id ? null : log.id)}
                    >
                      <TableCell className="px-4 py-2 whitespace-nowrap">
                        <div className="text-xs">{formatDate(log.createdAt)}</div>
                        <div className="text-xs text-muted-foreground">{formatTime(log.createdAt)}</div>
                      </TableCell>
                      <TableCell className="px-4 py-2">
                        {log.user ? (
                          <div>
                            <div className="font-medium">{log.user.firstName} {log.user.lastName}</div>
                            <div className="text-xs text-muted-foreground">{log.user.role === 'ADMIN' ? 'Owner' : formatEnumLabel(log.user.role)}</div>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">System</span>
                        )}
                      </TableCell>
                      <TableCell className="px-4 py-2">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${getActionColor(log.action)}`}>
                          {formatEnumLabel(log.action)}
                        </span>
                      </TableCell>
                      <TableCell className="px-4 py-2 text-xs">{log.entity ? formatEnumLabel(log.entity) : '-'}</TableCell>
                      <TableCell className="px-4 py-2 text-xs font-mono text-muted-foreground" title={log.entityId || undefined}>
                        {log.entityId ? log.entityId.slice(0, 8) + '...' : '-'}
                      </TableCell>
                      <TableCell className="px-4 py-2 text-xs text-muted-foreground">
                        {log.details ? <button type="button" className="min-h-11 underline" aria-expanded={expandedRow === log.id} aria-controls={'audit-details-' + log.id} onClick={event => { event.stopPropagation(); setExpandedRow(expandedRow === log.id ? null : log.id); }}>{expandedRow === log.id ? 'Hide details' : 'View details'}</button> : '-'}
                      </TableCell>
                    </TableRow>
                    {expandedRow === log.id && log.details && (
                      <TableRow>
                        <TableCell colSpan={6} className="px-4 py-3 bg-muted/20">
                          <pre id={'audit-details-' + log.id} className="text-xs overflow-x-auto whitespace-pre-wrap max-w-full">
                            {JSON.stringify(log.details, null, 2)}
                          </pre>
                          {log.ipAddress && (
                            <p className="text-xs text-muted-foreground mt-2">IP: {log.ipAddress}</p>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Pagination page={page} totalPages={loadedScope === scopeKey && !error ? totalPages : 0} onPageChange={setPage} totalItems={total} itemName="entries" />
    </ManagementPage>
  );
};
