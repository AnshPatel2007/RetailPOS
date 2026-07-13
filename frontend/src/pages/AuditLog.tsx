import React, { useState, useEffect, useCallback } from 'react';
import { auditLogService } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Filter,
  RefreshCw,
  Shield,
} from 'lucide-react';
import toast from 'react-hot-toast';

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

export const AuditLog: React.FC = () => {
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
  const [actions, setActions] = useState<string[]>([]);
  const [entities, setEntities] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 50 };
      if (debouncedSearch) params.search = debouncedSearch;
      if (actionFilter) params.action = actionFilter;
      if (entityFilter) params.entity = entityFilter;
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;

      const res = await auditLogService.getAll(params);
      setLogs(res.data.data);
      setTotalPages(res.data.pagination.totalPages);
      setTotal(res.data.pagination.total);
    } catch {
      toast.error('Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, actionFilter, entityFilter, startDate, endDate]);

  // Debounce search input so we don't fetch on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchFilters = async () => {
    try {
      const [actRes, entRes] = await Promise.all([
        auditLogService.getActions(),
        auditLogService.getEntities(),
      ]);
      setActions(actRes.data.data);
      setEntities(entRes.data.data);
    } catch {
      // non-critical
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    fetchFilters();
  }, []);

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
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className="p-8 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Audit Log</h1>
            <p className="text-sm text-muted-foreground">{total} total entries</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)}>
            <Filter className="h-4 w-4 mr-1" />
            Filters
          </Button>
          <Button variant="outline" size="sm" onClick={fetchLogs}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="space-y-3">
        <form onSubmit={handleSearch} className="flex gap-2">
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

        {showFilters && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 border rounded-lg bg-muted/50">
            <div>
              <label className="text-xs font-medium mb-1 block">Action</label>
              <select
                value={actionFilter}
                onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
                className="w-full rounded-md border px-2 py-1.5 text-sm bg-background"
              >
                <option value="">All Actions</option>
                {actions.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Entity</label>
              <select
                value={entityFilter}
                onChange={(e) => { setEntityFilter(e.target.value); setPage(1); }}
                className="w-full rounded-md border px-2 py-1.5 text-sm bg-background"
              >
                <option value="">All Entities</option>
                {entities.map((e) => (
                  <option key={e} value={e}>{e}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">From</label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
                className="text-sm h-8"
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">To</label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
                className="text-sm h-8"
              />
            </div>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Time</th>
                <th className="text-left px-4 py-2 font-medium">User</th>
                <th className="text-left px-4 py-2 font-medium">Action</th>
                <th className="text-left px-4 py-2 font-medium">Entity</th>
                <th className="text-left px-4 py-2 font-medium">Entity ID</th>
                <th className="text-left px-4 py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-muted-foreground">
                    Loading...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-muted-foreground">
                    No audit log entries found
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <React.Fragment key={log.id}>
                    <tr
                      className="hover:bg-muted/30 cursor-pointer"
                      onClick={() => setExpandedRow(expandedRow === log.id ? null : log.id)}
                    >
                      <td className="px-4 py-2 whitespace-nowrap">
                        <div className="text-xs">{formatDate(log.createdAt)}</div>
                        <div className="text-xs text-muted-foreground">{formatTime(log.createdAt)}</div>
                      </td>
                      <td className="px-4 py-2">
                        {log.user ? (
                          <div>
                            <div className="font-medium text-xs">{log.user.firstName} {log.user.lastName}</div>
                            <div className="text-xs text-muted-foreground">{log.user.role}</div>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">System</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${getActionColor(log.action)}`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs">{log.entity || '-'}</td>
                      <td className="px-4 py-2 text-xs font-mono text-muted-foreground">
                        {log.entityId ? log.entityId.slice(0, 8) + '...' : '-'}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {log.details ? 'Click to expand' : '-'}
                      </td>
                    </tr>
                    {expandedRow === log.id && log.details && (
                      <tr>
                        <td colSpan={6} className="px-4 py-3 bg-muted/20">
                          <pre className="text-xs overflow-x-auto whitespace-pre-wrap max-w-full">
                            {JSON.stringify(log.details, null, 2)}
                          </pre>
                          {log.ipAddress && (
                            <p className="text-xs text-muted-foreground mt-2">IP: {log.ipAddress}</p>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
