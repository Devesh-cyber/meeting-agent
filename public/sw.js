// Service worker: lets the app show system notifications on phones and computers,
// and opens the right screen when a notification is tapped.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const tab = event.notification.data?.tab || 'today';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) {
        c.postMessage({ tab });
        return c.focus();
      }
    }
    return self.clients.openWindow(`/?tab=${tab}`);
  })());
});