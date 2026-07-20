import React, { useState, useEffect, useCallback } from 'react';
import { developerService } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Card, CardContent } from '@/components/ui/Card';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/Table';
import { PageHeader } from '@/components/common/PageHeader';
import { formatDateTime } from '@/lib/utils';
import { Code2, Plus, Trash2, Copy, KeyRound, Webhook, Zap, CheckCircle2, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';

const EVENT_LABELS: Record<string, string> = {
  'sale.completed': 'Sale completed',
  'sale.refunded': 'Sale refunded',
  'product.low_stock': 'Product low stock',
};

const copyToClipboard = (text: string, what: string) => {
  navigator.clipboard.writeText(text).then(
    () => toast.success(`${what} copied`),
    () => toast.error('Copy failed — select and copy manually')
  );
};

/**
 * Developer settings: API keys for the read-only /api/v1 surface, and
 * webhook endpoints for sale/stock events. Secrets show exactly once.
 */
export const Developers: React.FC = () => {
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [availableEvents, setAvailableEvents] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Create-key flow
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<any | null>(null);

  // Create-webhook flow
  const [showHookModal, setShowHookModal] = useState(false);
  const [hookUrl, setHookUrl] = useState('');
  const [hookEvents, setHookEvents] = useState<string[]>([]);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [deleteHookTarget, setDeleteHookTarget] = useState<any | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [keysRes, hooksRes] = await Promise.all([
        developerService.listApiKeys(),
        developerService.listWebhooks(),
      ]);
      setApiKeys(keysRes.data.data);
      setWebhooks(hooksRes.data.data);
      setAvailableEvents(hooksRes.data.availableEvents || []);
    } catch {
      toast.error('Failed to load developer settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreateKey = async () => {
    if (!keyName.trim()) return;
    setSubmitting(true);
    try {
      const res = await developerService.createApiKey(keyName.trim());
      setNewKey(res.data.data.key);
      setKeyName('');
      load();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to create key');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateWebhook = async () => {
    if (!hookUrl.trim() || hookEvents.length === 0) return;
    setSubmitting(true);
    try {
      const res = await developerService.createWebhook({ url: hookUrl.trim(), events: hookEvents });
      setNewSecret(res.data.data.secret);
      setHookUrl('');
      setHookEvents([]);
      load();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to add webhook');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTest = async (id: string) => {
    try {
      const res = await developerService.testWebhook(id);
      if (res.data.data.delivered) toast.success(res.data.message);
      else toast.error(res.data.message);
      load();
    } catch {
      toast.error('Test failed');
    }
  };

  return (
    <div className="p-8">
      <PageHeader
        title="Developers"
        subtitle="API keys for the read-only /api/v1 endpoints, and webhooks for live events — see API.md in the project root"
        icon={Code2}
      />

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="space-y-8">
          {/* ─── API keys ─── */}
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="font-semibold text-lg flex items-center gap-2">
                    <KeyRound className="h-5 w-5 text-primary" /> API Keys
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Send as <code className="bg-muted px-1 rounded">X-API-Key</code> to
                    <code className="bg-muted px-1 rounded ml-1">/api/v1/…</code> (products, sales, customers, summary — read-only)
                  </p>
                </div>
                <Button variant="primary" size="sm" onClick={() => { setNewKey(null); setShowKeyModal(true); }}>
                  <Plus className="h-4 w-4 mr-1" /> New Key
                </Button>
              </div>

              {apiKeys.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No API keys yet</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Key</TableHead>
                      <TableHead>Last used</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {apiKeys.map((k) => (
                      <TableRow key={k.id} className={!k.isActive ? 'opacity-50' : undefined}>
                        <TableCell className="font-medium">{k.name}</TableCell>
                        <TableCell className="font-mono text-xs">{k.prefix}…</TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {k.lastUsedAt ? formatDateTime(k.lastUsedAt) : 'Never'}
                        </TableCell>
                        <TableCell>
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                            k.isActive ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
                          }`}>
                            {k.isActive ? 'Active' : 'Revoked'}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          {k.isActive && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-destructive"
                              onClick={() => setRevokeTarget(k)}
                            >
                              <Trash2 className="h-3 w-3 mr-1" /> Revoke
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* ─── Webhooks ─── */}
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="font-semibold text-lg flex items-center gap-2">
                    <Webhook className="h-5 w-5 text-primary" /> Webhooks
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    We POST signed JSON to your URL when events happen — verify the
                    <code className="bg-muted px-1 rounded ml-1">X-Webhook-Signature</code> header
                  </p>
                </div>
                <Button variant="primary" size="sm" onClick={() => { setNewSecret(null); setShowHookModal(true); }}>
                  <Plus className="h-4 w-4 mr-1" /> Add Endpoint
                </Button>
              </div>

              {webhooks.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No webhook endpoints yet</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>URL</TableHead>
                      <TableHead>Events</TableHead>
                      <TableHead>Last delivery</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {webhooks.map((w) => (
                      <TableRow key={w.id} className={!w.isActive ? 'opacity-50' : undefined}>
                        <TableCell className="font-mono text-xs max-w-[240px] truncate" title={w.url}>
                          {w.url}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {w.events.map((e: string) => (
                              <span key={e} className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
                                {EVENT_LABELS[e] || e}
                              </span>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {w.lastDeliveryAt ? (
                            <span className="flex items-center gap-1">
                              {w.lastStatus && w.lastStatus < 300 ? (
                                <CheckCircle2 className="h-3 w-3 text-success" />
                              ) : (
                                <XCircle className="h-3 w-3 text-destructive" />
                              )}
                              {formatDateTime(w.lastDeliveryAt)}
                              {w.lastStatus ? ` (${w.lastStatus})` : ''}
                            </span>
                          ) : 'Never'}
                        </TableCell>
                        <TableCell>
                          <button
                            onClick={async () => {
                              try {
                                await developerService.updateWebhook(w.id, { isActive: !w.isActive });
                                load();
                              } catch { toast.error('Failed to update'); }
                            }}
                            className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                              w.isActive ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
                            }`}
                            title={w.failCount >= 20 ? 'Auto-disabled after repeated failures — click to re-enable' : 'Toggle'}
                          >
                            {w.isActive ? 'Active' : 'Disabled'}
                          </button>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end">
                            <Button variant="outline" size="sm" onClick={() => handleTest(w.id)} title="Send test ping">
                              <Zap className="h-3 w-3 mr-1" /> Test
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-destructive"
                              onClick={() => setDeleteHookTarget(w)}
                              title="Delete"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Create key modal */}
      <Modal
        isOpen={showKeyModal}
        onClose={() => { setShowKeyModal(false); setNewKey(null); }}
        title={newKey ? 'API Key Created' : 'New API Key'}
        size="md"
      >
        {newKey ? (
          <div className="space-y-4">
            <p className="text-sm text-warning font-medium">
              Copy this key now — it will never be shown again.
            </p>
            <div className="flex gap-2 items-center p-3 bg-muted rounded-lg">
              <code className="text-xs font-mono flex-1 break-all">{newKey}</code>
              <Button variant="outline" size="sm" onClick={() => copyToClipboard(newKey, 'API key')}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Button variant="primary" className="w-full" onClick={() => { setShowKeyModal(false); setNewKey(null); }}>
              I've copied it
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <Input
              label="Key name"
              placeholder='e.g. "Website integration"'
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowKeyModal(false)}>Cancel</Button>
              <Button variant="primary" onClick={handleCreateKey} disabled={!keyName.trim() || submitting}>
                {submitting ? 'Creating...' : 'Create Key'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Create webhook modal */}
      <Modal
        isOpen={showHookModal}
        onClose={() => { setShowHookModal(false); setNewSecret(null); }}
        title={newSecret ? 'Webhook Added' : 'Add Webhook Endpoint'}
        size="md"
      >
        {newSecret ? (
          <div className="space-y-4">
            <p className="text-sm text-warning font-medium">
              Copy the signing secret now — it will never be shown again. Use it to verify the
              <code className="bg-muted px-1 rounded ml-1">X-Webhook-Signature</code> header.
            </p>
            <div className="flex gap-2 items-center p-3 bg-muted rounded-lg">
              <code className="text-xs font-mono flex-1 break-all">{newSecret}</code>
              <Button variant="outline" size="sm" onClick={() => copyToClipboard(newSecret, 'Signing secret')}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Button variant="primary" className="w-full" onClick={() => { setShowHookModal(false); setNewSecret(null); }}>
              I've copied it
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <Input
              label="Endpoint URL"
              placeholder="https://example.com/webhooks/pos"
              value={hookUrl}
              onChange={(e) => setHookUrl(e.target.value)}
              autoFocus
            />
            <div>
              <label className="block text-sm font-medium mb-1.5">Events</label>
              <div className="space-y-2">
                {availableEvents.map((e) => (
                  <label key={e} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={hookEvents.includes(e)}
                      onChange={() =>
                        setHookEvents((prev) =>
                          prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]
                        )
                      }
                      className="rounded border-input"
                    />
                    <span className="text-sm">{EVENT_LABELS[e] || e}</span>
                    <code className="text-[10px] text-muted-foreground">{e}</code>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowHookModal(false)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={handleCreateWebhook}
                disabled={!hookUrl.trim() || hookEvents.length === 0 || submitting}
              >
                {submitting ? 'Adding...' : 'Add Endpoint'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        onConfirm={async () => {
          try {
            await developerService.revokeApiKey(revokeTarget.id);
            toast.success('Key revoked');
            load();
          } catch { toast.error('Failed to revoke key'); }
          setRevokeTarget(null);
        }}
        title="Revoke API key?"
        message={revokeTarget ? `"${revokeTarget.name}" will stop working immediately. Anything using it will get 401s.` : ''}
        destructive
        confirmLabel="Revoke"
      />

      <ConfirmDialog
        isOpen={deleteHookTarget !== null}
        onClose={() => setDeleteHookTarget(null)}
        onConfirm={async () => {
          try {
            await developerService.deleteWebhook(deleteHookTarget.id);
            toast.success('Webhook deleted');
            load();
          } catch { toast.error('Failed to delete webhook'); }
          setDeleteHookTarget(null);
        }}
        title="Delete webhook endpoint?"
        message={deleteHookTarget ? `Events will stop being delivered to ${deleteHookTarget.url}.` : ''}
        destructive
        confirmLabel="Delete"
      />
    </div>
  );
};
