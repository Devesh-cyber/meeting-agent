// Service worker: shows reminders pushed from the server (even when the app is closed)
// and opens the right screen when you tap one.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Minutes', body: event.data?.text() || '' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Minutes', {
    body: data.body || '',
    tag: data.tag,
    renotify: !!data.tag,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.location.origin) && 'focus' in w) {
        w.postMessage({ open: url });
        return w.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
