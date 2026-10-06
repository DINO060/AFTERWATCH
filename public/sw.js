// Cache only the generic offline screen. Never cache a private page or API response.
const CACHE = 'afterwatch-shell-v3';
self.addEventListener('install', (event) =>
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add('/offline.html'))
      .then(() => self.skipWaiting()),
  ),
);
self.addEventListener('activate', (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('afterwatch-shell-') && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate' && new URL(event.request.url).origin === self.location.origin) {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match('/offline.html').then((response) => response || Response.error()),
      ),
    );
  }
});

// Phone notifications sent by the server (reminders, new episodes).
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(String(data.title || 'Afterwatch').slice(0, 120), {
      body: String(data.body || '').slice(0, 300),
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/' },
    }),
  );
});
// Tapping opens Afterwatch; links outside this site are ignored.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  let url = self.location.origin + '/';
  try {
    const target = new URL(
      (event.notification.data && event.notification.data.url) || '/',
      self.location.origin,
    );
    if (target.origin === self.location.origin) url = target.href;
  } catch {}
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
