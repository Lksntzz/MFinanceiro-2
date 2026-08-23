import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = await readFile(
  new URL('../public/sw.js', import.meta.url),
  'utf8',
);

type WorkerRequest = {
  method: string;
  mode: string;
  url: string;
  destination: string;
  headers: { has(name: string): boolean };
};

function createWorkerHarness(options?: { cacheControl?: string }) {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const writes: string[] = [];
  const cachedResponse = { source: 'cache' };
  const networkResponse = {
    ok: true,
    type: 'basic',
    headers: {
      get: (name: string) =>
        name === 'cache-control' ? options?.cacheControl || '' : null,
    },
    clone() {
      return this;
    },
  };
  const cache = {
    addAll: async () => undefined,
    match: async (request: WorkerRequest | string) =>
      typeof request !== 'string' && request.url.includes('cached')
        ? cachedResponse
        : undefined,
    put: async (request: WorkerRequest) => {
      writes.push(request.url);
    },
  };
  const context = {
    URL,
    Set,
    Promise,
    fetch: async () => networkResponse,
    caches: {
      open: async () => cache,
      match: async (request: WorkerRequest | string) =>
        typeof request !== 'string' && request.url.includes('cached')
          ? cachedResponse
          : undefined,
      keys: async () => [],
      delete: async () => true,
    },
    self: {
      location: { origin: 'https://mf.example' },
      clients: { claim: async () => undefined },
      skipWaiting: () => undefined,
      addEventListener: (
        type: string,
        listener: (event: Record<string, unknown>) => void,
      ) => {
        listeners.set(type, listener);
      },
    },
  };
  runInNewContext(source, context, { filename: 'public/sw.js' });

  async function fetchThroughWorker(request: WorkerRequest) {
    let responsePromise: Promise<unknown> | null = null;
    listeners.get('fetch')?.({
      request,
      respondWith: (value: Promise<unknown>) => {
        responsePromise = Promise.resolve(value);
      },
    });
    return {
      intercepted: responsePromise !== null,
      response: responsePromise ? await responsePromise : undefined,
    };
  }

  return { fetchThroughWorker, writes };
}

function request(
  path: string,
  options?: Partial<WorkerRequest> & { authenticated?: boolean },
): WorkerRequest {
  return {
    method: 'GET',
    mode: 'cors',
    url: `https://mf.example${path}`,
    destination: '',
    headers: {
      has: (name: string) =>
        Boolean(
          options?.authenticated && ['authorization', 'apikey'].includes(name),
        ),
    },
    ...options,
  };
}

describe('service worker cache policy', () => {
  it('limits runtime caching to same-origin public static files', () => {
    assert.match(source, /url\.origin !== self\.location\.origin/);
    assert.match(source, /url\.pathname\.startsWith\('\/assets\/'\)/);
    assert.match(source, /STATIC_DESTINATIONS\.has\(request\.destination\)/);
    assert.match(source, /if \(!isCacheableStaticRequest\(request\)\) return/);
  });

  it('does not intercept API calls, including authenticated same-origin calls', async () => {
    const worker = createWorkerHarness();
    assert.equal(
      (await worker.fetchThroughWorker(request('/rest/v1/ledger'))).intercepted,
      false,
    );
    assert.equal(
      (
        await worker.fetchThroughWorker(
          request('/functions/v1/statement-ocr', { authenticated: true }),
        )
      ).intercepted,
      false,
    );
    assert.equal(
      (
        await worker.fetchThroughWorker(
          request('/assets/app.js', {
            destination: 'script',
            authenticated: true,
          }),
        )
      ).intercepted,
      false,
    );
  });

  it('serves public assets through the static cache policy', async () => {
    const worker = createWorkerHarness();
    const cached = await worker.fetchThroughWorker(
      request('/assets/cached.js', { destination: 'script' }),
    );
    assert.equal(cached.intercepted, true);
    assert.deepEqual(cached.response, { source: 'cache' });

    await worker.fetchThroughWorker(
      request('/assets/new.js', { destination: 'script' }),
    );
    assert.deepEqual(worker.writes, ['https://mf.example/assets/new.js']);
  });

  it('does not persist an asset response marked private or no-store', async () => {
    const worker = createWorkerHarness({ cacheControl: 'private, no-store' });
    await worker.fetchThroughWorker(
      request('/assets/private.js', { destination: 'script' }),
    );
    assert.deepEqual(worker.writes, []);
  });

  it('never caches authenticated or explicitly private responses', () => {
    assert.match(source, /request\.headers\.has\('authorization'\)/);
    assert.match(source, /request\.headers\.has\('apikey'\)/);
    assert.match(source, /private\|no-store/);
  });

  it('deletes only obsolete MF Financeiro cache versions', () => {
    assert.match(
      source,
      /key\.startsWith\(CACHE_PREFIX\) && key !== CACHE_NAME/,
    );
    assert.doesNotMatch(
      source,
      /key === CACHE_NAME \? Promise\.resolve\(\) : caches\.delete\(key\)/,
    );
  });
});
