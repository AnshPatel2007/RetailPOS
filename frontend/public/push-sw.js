/*
 * Phone alerts (loaded into the app's service worker by vite.config.ts): shows an
 * alert the POS server sent, and on a tap opens it. An open window is focused and
 * asked to go to the alert inside the app (never reloaded: it may hold a sale);
 * otherwise a new window opens.
 */
self.addEventListener('push', event => {
  let alert = {};
  try { alert = event.data ? event.data.json() : {}; } catch (error) { alert = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(alert.title || 'Store alert', {
    body: alert.body || '',
    tag: alert.tag || undefined,
    renotify: Boolean(alert.tag),
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: alert.url || '/' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.url) || '/';
  const url = new URL(path, self.location.origin);
  // Only the app's own pages.
  if (url.origin !== self.location.origin) return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (open) {
      await open.focus();
      open.postMessage({ type: 'pos:open-alert', url: url.pathname + url.search });
      return;
    }
    await self.clients.openWindow(url.href);
  })());
});
