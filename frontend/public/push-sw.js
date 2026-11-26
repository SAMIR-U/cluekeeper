// Imported by the generated Workbox service worker. Keep this file free of imports.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch { data = { body: event.data?.text() ?? '' }; }

  const base = self.registration.scope;
  const notification = {
    body: data.body || '',
    icon: new URL('pwa-192x192.png', base).href,
    badge: new URL('pwa-192x192.png', base).href,
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    data: { url: data.url || base, type: data.type || null },
  };

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) client.postMessage({ source: 'cluekeeper-push', notification: data });
    await self.registration.showNotification(data.title || 'ClueKeeper', notification);
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const base = self.registration.scope;
  const requested = new URL(event.notification.data?.url || base, base);
  const target = requested.origin === self.location.origin && requested.href.startsWith(base) ? requested.href : base;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const current = clients.find((client) => new URL(client.url).origin === self.location.origin);
    if (current) return current.focus();
    return self.clients.openWindow(target);
  })());
});
