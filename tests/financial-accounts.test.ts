import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeAccounts,
  sumActiveBalance,
} from '../src/lib/financial-accounts';

test('saldo total ignora contas arquivadas', () => {
  const total = sumActiveBalance([
    { current_balance: 100, is_active: true },
    { current_balance: 50, is_active: false },
    { current_balance: 25.5, is_active: true },
  ]);
  assert.equal(total, 125.5);
});

test('conta sem is_active conta como ativa e valor inválido vira 0', () => {
  const accounts = normalizeAccounts([
    { id: 'a', current_balance: '10.5', is_active: true },
    { id: 'b', current_balance: null, is_active: true },
  ]);
  assert.equal(sumActiveBalance(accounts), 10.5);
  assert.equal(sumActiveBalance([{ current_balance: 7 } as never]), 7);
});
