import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * A phone alert tapped while the app is open: the service worker (public/push-sw.js)
 * asks this window to open it inside the app, so nothing reloads.
 */
export function PushAlertRouter() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const open = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string } | null;
      if (data?.type === 'pos:open-alert' && typeof data.url === 'string' && data.url.startsWith('/alerts/open')) navigate(data.url);
    };
    navigator.serviceWorker.addEventListener('message', open);
    return () => navigator.serviceWorker.removeEventListener('message', open);
  }, [navigate]);
  return null;
}
