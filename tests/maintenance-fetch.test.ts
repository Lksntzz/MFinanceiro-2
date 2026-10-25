import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

// maintenance.ts decide a superfície (desktop/mobile) olhando para `window`.
(globalThis as any).window = {
  location: { pathname: '/', search: '' },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  matchMedia: () => ({ matches: false }),
  innerWidth: 1280,
  innerHeight: 800,
};

const { fetchMaintenanceConfig, fetchMaintenanceConfigWithStatus } =
  await import('../src/lib/maintenance');

type Reply = { data?: unknown; error?: { code?: string; message: string } };

function fakeDb(replies: Record<string, Reply>) {
  const calls: string[] = [];
  const db = {
    from(table: string) {
      calls.push(table);
      const reply = replies[table] ?? { data: null };
      const result = { data: reply.data ?? null, error: reply.error ?? null };
      // abortSignal() é o último elo antes do await (ou de maybeSingle()).
      const terminal = () =>
        Object.assign(Promise.resolve(result), {
          maybeSingle: () => Promise.resolve(result),
        });
      const builder: any = {
        select: () => builder,
        in: () => builder,
        order: () => builder,
        limit: () => builder,
        abortSignal: terminal,
      };
      return builder;
    },
  };
  return { db: db as any, calls };
}

const originalWarn = console.warn;
beforeEach(() => {
  console.warn = () => {};
});
afterEach(() => {
  console.warn = originalWarn;
});

describe('fetchMaintenanceConfigWithStatus', () => {
  it('lê a tabela principal e não marca como degradado', async () => {
    const { db, calls } = fakeDb({
      mf_global_settings: {
        data: [
          { key: 'desktop', maintenance_mode: true, maintenance_message: 'X' },
        ],
      },
    });
    const result = await fetchMaintenanceConfigWithStatus(db);
    assert.equal(result.degraded, false);
    assert.equal(result.config.maintenance_mode, true);
    assert.deepEqual(calls, ['mf_global_settings']);
  });

  it('em falha de rede (sem code) não consulta a segunda tabela', async () => {
    const { db, calls } = fakeDb({
      mf_global_settings: {
        error: { code: '', message: 'TypeError: Failed to fetch' },
      },
      mf_app_config: { data: { maintenance_mode: true } },
    });
    const result = await fetchMaintenanceConfigWithStatus(db);
    assert.equal(result.degraded, true);
    assert.equal(result.config.maintenance_mode, false);
    assert.deepEqual(calls, ['mf_global_settings']);
  });

  it('tabela ausente (PGRST205) cai para a tabela legada', async () => {
    const { db, calls } = fakeDb({
      mf_global_settings: {
        error: { code: 'PGRST205', message: 'schema cache' },
      },
      mf_app_config: {
        data: { maintenance_mode: true, maintenance_message: 'legado' },
      },
    });
    const result = await fetchMaintenanceConfigWithStatus(db);
    assert.equal(result.degraded, false);
    assert.equal(result.config.maintenance_mode, true);
    assert.deepEqual(calls, ['mf_global_settings', 'mf_app_config']);
  });

  it('erro de aplicação com code (ex.: permissão) ainda tenta a legada', async () => {
    const { db, calls } = fakeDb({
      mf_global_settings: { error: { code: '42501', message: 'denied' } },
      mf_app_config: { data: { maintenance_mode: false } },
    });
    const result = await fetchMaintenanceConfigWithStatus(db);
    assert.equal(result.degraded, false);
    assert.deepEqual(calls, ['mf_global_settings', 'mf_app_config']);
  });
});

describe('fetchMaintenanceConfig (compatibilidade)', () => {
  it('continua devolvendo só a configuração', async () => {
    const { db } = fakeDb({
      mf_global_settings: {
        error: { code: '', message: 'Failed to fetch' },
      },
    });
    const config = await fetchMaintenanceConfig(db);
    assert.equal(config.maintenance_mode, false);
  });
});
