import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateImportBalanceValidation } from '../src/features/importer/import-review';
import type { ImportedTransaction } from '../src/types';

function tx(
  id: string,
  type: ImportedTransaction['type'],
  amount: number,
  status: ImportedTransaction['status'] = 'ready',
  runningBalance?: number,
): ImportedTransaction {
  return {
    id,
    date: `2026-08-0${id}`,
    description: `TESTE ${id}`,
    amount,
    type,
    category: 'Geral',
    status,
    confidence: 1,
    original_description: `TESTE ${id}`,
    running_balance: runningBalance,
  };
}

test('uses document final balance when OCR rows have no running balance', () => {
  const items = [
    tx('1', 'income', 500),
    tx('2', 'expense', 120.5),
    tx('3', 'expense', 35.9),
  ];

  const result = calculateImportBalanceValidation(items, 1343.6);

  assert.ok(result);
  assert.equal(result.statementFinal, 1343.6);
  assert.ok(Math.abs(result.expectedFinal - 1343.6) < 0.001);
  assert.ok(Math.abs(result.diff) < 0.001);
  assert.equal(result.isClose, true);
});

test('document final balance reveals a deselected OCR row', () => {
  const items = [
    tx('1', 'income', 500),
    tx('2', 'expense', 120.5),
    tx('3', 'expense', 35.9, 'pending'),
  ];

  const result = calculateImportBalanceValidation(items, 1343.6);

  assert.ok(result);
  assert.ok(Math.abs(result.expectedFinal - 1379.5) < 0.001);
  assert.ok(Math.abs(result.diff - 35.9) < 0.001);
  assert.equal(result.isClose, false);
});

test('does not invent a balance when neither running nor document balance exists', () => {
  const items = [tx('1', 'income', 500)];
  assert.equal(calculateImportBalanceValidation(items), null);
});

test('prefers explicit running balances over document-level fallback', () => {
  const items = [
    tx('1', 'income', 500, 'ready', 1500),
    tx('2', 'expense', 120.5, 'ready', 1379.5),
    tx('3', 'expense', 35.9, 'ready', 1343.6),
  ];

  const result = calculateImportBalanceValidation(items, 9999);

  assert.ok(result);
  assert.equal(result.statementFinal, 1343.6);
  assert.ok(Math.abs(result.diff) < 0.001);
});
