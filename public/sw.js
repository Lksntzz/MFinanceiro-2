const CACHE_NAME = 'mfinanceiro-assets-v4';
const NETWORK_ONLY_PATHS = new Set([
  '/sw.js',
  '/version.json',
  '/brand.css',
  '/manifest.json',
]);

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.map((key) => {
          if (key === CACHE_NAME) return Promise.resolve();
          if (key.startsWith('mfinanceiro-')) return caches.delete(key);
          return Promise.resolve();
        }),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // HTML/navigation and stable control files must always come from the network.
  if (request.mode === 'navigate' || NETWORK_ONLY_PATHS.has(url.pathname)) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  // Vite fingerprints production assets in /assets/. Cache-first is safe because
  // a content change produces a new URL/hash instead of overwriting an old file.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;

        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  // Everything else uses the browser/network normally and is never persisted
  // by this service worker.
  event.respondWith(fetch(request));
});
