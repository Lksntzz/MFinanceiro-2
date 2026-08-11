import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readDashboardWorkspaceCache,
  writeDashboardWorkspaceCache,
} from '../src/lib/dashboard-workspace-cache';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

test('dashboard workspace cache restores the last valid desktop snapshot', () => {
  const sessionStorage = new MemoryStorage();
  const previousWindow = (globalThis as any).window;
  (globalThis as any).window = { sessionStorage };

  try {
    writeDashboardWorkspaceCache('user-1', {
      settings: { id: 'settings-1', user_id: 'user-1', current_balance: 6975.36 } as any,
      accounts: [{ id: 'account-1', user_id: 'user-1', current_balance: 6975.36 }] as any,
      categories: [],
      fixedBills: [],
      cards: [],
      installments: [],
    });

    const cached = readDashboardWorkspaceCache('user-1');
    assert.ok(cached);
    assert.equal(cached?.settings.current_balance, 6975.36);
    assert.equal(cached?.accounts[0]?.current_balance, 6975.36);
    assert.equal(readDashboardWorkspaceCache('other-user'), null);
  } finally {
    if (previousWindow === undefined) delete (globalThis as any).window;
    else (globalThis as any).window = previousWindow;
  }
});
