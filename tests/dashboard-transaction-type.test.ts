import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeDashboardTransaction } from '../src/features/dashboard/dashboard-domain';

describe('normalizeDashboardTransaction', () => {
  it('tipo explícito vence o sinal do valor', () => {
    const expense = normalizeDashboardTransaction({
      date: '2026-08-14',
      amount: 50,
      type: 'expense',
    });
    assert.equal(expense?.type, 'expense');
    const income = normalizeDashboardTransaction({
      date: '2026-08-14',
      amount: -50,
      type: 'income',
    });
    assert.equal(income?.type, 'income');
  });

  it('sem tipo, usa o sinal do valor', () => {
    assert.equal(
      normalizeDashboardTransaction({ date: '2026-08-14', amount: -10 })?.type,
      'expense',
    );
    assert.equal(
      normalizeDashboardTransaction({ date: '2026-08-14', amount: 10 })?.type,
      'income',
    );
  });
});
