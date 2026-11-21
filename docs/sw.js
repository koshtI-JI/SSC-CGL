// Self-destructing Service Worker: claims clients, clears all offline Workbox caches,
// reloads open tabs to fetch the latest page, and unregisters itself.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        await self.clients.claim();
      } catch {
        // Ignore claim errors
      }
      try {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((name) => caches.delete(name)));
      } catch {
        // Ignore cache deletion errors
      }
      try {
        const clientList = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true,
        });
        await Promise.all(
          clientList.map((client) =>
            'navigate' in client ? client.navigate(client.url).catch(() => null) : null
          )
        );
      } catch {
        // Ignore client navigation errors
      }
      try {
        await self.registration.unregister();
      } catch {
        // Ignore unregister errors
      }
    })()
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request, { cache: 'no-store' }));
});
