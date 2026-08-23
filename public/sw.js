const CACHE_PREFIX = 'mfinanceiro-assets-';
const CACHE_NAME = `${CACHE_PREFIX}v6`;
const SHARE_DB_NAME = 'mf-mobile-share';
const SHARE_STORE_NAME = 'shares';
const SHARE_DB_VERSION = 1;
const SHARE_MAX_BYTES = 20 * 1024 * 1024;
const SHARE_MAX_FILES = 5;
const SHARE_TTL_MS = 24 * 60 * 60 * 1000;
const NETWORK_ONLY_PATHS = new Set([
  '/sw.js',
  '/version.json',
  '/brand.css',
  '/manifest.json',
]);
const STATIC_DESTINATIONS = new Set([
  'script',
  'style',
  'image',
  'font',
  'manifest',
  'worker',
]);

function isCacheableStaticRequest(request) {
  if (request.method !== 'GET') return false;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.search) return false;
  if (request.headers.has('authorization') || request.headers.has('apikey'))
    return false;

  return (
    url.pathname.startsWith('/assets/') &&
    STATIC_DESTINATIONS.has(request.destination)
  );
}

function isCacheableStaticResponse(response) {
  if (!response?.ok || response.type !== 'basic') return false;

  const cacheControl = response.headers.get('cache-control') || '';
  return !/\b(?:private|no-store)\b/i.test(cacheControl);
}

function openShareDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SHARE_DB_NAME, SHARE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SHARE_STORE_NAME))
        db.createObjectStore(SHARE_STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error('share-db-open-failed'));
  });
}

async function storeSharedPayload(payload) {
  const db = await openShareDb();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(SHARE_STORE_NAME, 'readwrite');
      const store = transaction.objectStore(SHARE_STORE_NAME);
      const cutoff = Date.now() - SHARE_TTL_MS;
      const cursorRequest = store.openCursor();

      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        if (Number(cursor.value?.createdAt || 0) < cutoff) cursor.delete();
        cursor.continue();
      };

      store.put(payload);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error || new Error('share-db-write-failed'));
      transaction.onabort = () =>
        reject(transaction.error || new Error('share-db-write-aborted'));
    });
  } finally {
    db.close();
  }
}

function isAcceptedSharedFile(file) {
  if (!(file instanceof File)) return false;
  if (file.type === 'application/pdf') return true;
  return (
    file.type === 'image/jpeg' ||
    file.type === 'image/png' ||
    file.type === 'image/webp'
  );
}

async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const title = String(formData.get('title') || '').slice(0, 500);
    const text = String(formData.get('text') || '').slice(0, 12000);
    const url = String(formData.get('url') || '').slice(0, 4000);
    const incomingFiles = formData
      .getAll('files')
      .filter(isAcceptedSharedFile)
      .slice(0, SHARE_MAX_FILES);
    const totalBytes = incomingFiles.reduce(
      (sum, file) => sum + Number(file.size || 0),
      0,
    );

    if (totalBytes > SHARE_MAX_BYTES) {
      return Response.redirect(
        new URL('/share?error=too-large', self.location.origin).href,
        303,
      );
    }

    if (
      !title.trim() &&
      !text.trim() &&
      !url.trim() &&
      incomingFiles.length === 0
    ) {
      return Response.redirect(
        new URL('/share?error=empty', self.location.origin).href,
        303,
      );
    }

    const id = crypto.randomUUID();
    await storeSharedPayload({
      id,
      createdAt: Date.now(),
      title,
      text,
      url,
      files: incomingFiles.map((file) => ({
        name: String(file.name || 'documento').slice(0, 240),
        type: file.type || 'application/octet-stream',
        size: file.size,
        lastModified: file.lastModified || Date.now(),
        blob: file,
      })),
    });

    return Response.redirect(
      new URL(`/share?id=${encodeURIComponent(id)}`, self.location.origin).href,
      303,
    );
  } catch (error) {
    console.error('MF share target error:', error);
    return Response.redirect(
      new URL('/share?error=invalid', self.location.origin).href,
      303,
    );
  }
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.method === 'POST' && url.pathname === '/share') {
    event.respondWith(handleShareTarget(request));
    return;
  }

  if (request.method !== 'GET') return;

  // HTML/navigation and stable control files must always come from the network.
  if (request.mode === 'navigate' || NETWORK_ONLY_PATHS.has(url.pathname)) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  // Vite fingerprints production assets in /assets/. Cache-first is safe because
  // a content change produces a new URL/hash instead of overwriting an old file.
  if (!isCacheableStaticRequest(request)) return;

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;

        const response = await fetch(request);
        if (isCacheableStaticResponse(response))
          await cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }
});
