import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateRebalancingPlan,
  deriveInvestmentPositions,
  operationGrossAmount,
  type InvestmentBetaOperation,
} from '../src/features/investments-beta/investment-beta-domain';

function operation(overrides: Partial<InvestmentBetaOperation>): InvestmentBetaOperation {
  return {
    id: overrides.id || crypto.randomUUID(),
    userId: 'user-1',
    type: overrides.type || 'buy',
    assetClass: overrides.assetClass || 'stock',
    symbol: overrides.symbol || 'PETR4',
    date: overrides.date || '2026-08-01',
    quantity: overrides.quantity ?? 1,
    unitPrice: overrides.unitPrice ?? 10,
    fees: overrides.fees ?? 0,
    currency: overrides.currency || 'BRL',
    createdAt: overrides.createdAt || '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

test('derives weighted average price from purchases', () => {
  const positions = deriveInvestmentPositions([
    operation({ quantity: 10, unitPrice: 20, fees: 2 }),
    operation({ id: 'second', date: '2026-08-02', createdAt: '2026-08-02T10:00:00.000Z', quantity: 10, unitPrice: 30, fees: 2 }),
  ]);

  assert.equal(positions.length, 1);
  assert.equal(positions[0].quantity, 20);
  assert.equal(positions[0].investedCost, 504);
  assert.equal(positions[0].averagePrice, 25.2);
});

test('sale reduces position at existing average cost', () => {
  const positions = deriveInvestmentPositions([
    operation({ quantity: 10, unitPrice: 20 }),
    operation({ id: 'sell', type: 'sell', date: '2026-08-03', createdAt: '2026-08-03T10:00:00.000Z', quantity: 4, unitPrice: 25 }),
  ]);

  assert.equal(positions[0].quantity, 6);
  assert.equal(positions[0].investedCost, 120);
  assert.equal(positions[0].averagePrice, 20);
  assert.equal(positions[0].currentPrice, 25);
});

test('gross amount includes fees on buys and subtracts them on sells', () => {
  assert.equal(operationGrossAmount({ type: 'buy', quantity: 2, unitPrice: 100, fees: 3 }), 203);
  assert.equal(operationGrossAmount({ type: 'sell', quantity: 2, unitPrice: 100, fees: 3 }), 197);
});

test('rebalancing plan directs contribution toward allocation deficits', () => {
  const positions = deriveInvestmentPositions([
    operation({ assetClass: 'stock', symbol: 'PETR4', quantity: 10, unitPrice: 100 }),
    operation({ id: 'fii', assetClass: 'fii', symbol: 'MXRF11', quantity: 20, unitPrice: 25 }),
  ]);
  const plan = calculateRebalancingPlan(positions, { stock: 50, fii: 50 }, 500);

  assert.ok(plan.length > 0);
  assert.equal(plan[0].assetClass, 'fii');
  assert.ok(plan[0].suggestedAmount > 0);
});
