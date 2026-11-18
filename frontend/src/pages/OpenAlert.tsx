import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { ManagementPage } from '@/components/common/Workspace';
import { PageHeader } from '@/components/common/PageHeader';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/LoadingState';
import { apiErrorMessage } from '@/services/api';

/** Only a page of this app: a path, never another site. */
export const safeAppPath = (value: string | null) => value && /^\/(?![/\\])/.test(value) ? value : '/dashboard';

/**
 * Where a tapped phone alert lands (/alerts/open?store=…&to=…): the alert's store
 * first, for someone who runs several, then the page that deals with it.
 */
export function OpenAlert() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const user = useAuthStore(state => state.user);
  const switchStore = useAuthStore(state => state.switchStore);
  const store = params.get('store'), to = safeAppPath(params.get('to'));
  const [problem, setProblem] = useState('');

  useEffect(() => {
    if (!user) return;
    let active = true;
    void (async () => {
      if (store && store !== user.locationId) {
        if (!user.stores?.some(access => access.locationId === store)) { setProblem('This alert is for a store you no longer work in.'); return; }
        try { await switchStore(store); }
        catch (error) { if (active) setProblem(apiErrorMessage(error, (error as Error).message || 'The alert\'s store could not be opened.')); return; }
      }
      if (active) navigate(to, { replace: true });
    })();
    return () => { active = false; };
  }, [user?.id, store, to]);

  if (!problem) return <LoadingState label="Opening the alert…" />;
  const storeName = user?.stores?.find(access => access.locationId === store)?.name;
  return <ManagementPage>
    <PageHeader title="Alert" />
    <Alert tone="warning" title={problem} action={<Button variant="outline" onClick={() => navigate('/dashboard')}>Go to Dashboard</Button>}>
      {storeName ? `It belongs to ${storeName}. Switch stores from the top bar once this sale or payment is finished.` : null}
    </Alert>
  </ManagementPage>;
}
