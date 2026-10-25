import assert from 'node:assert/strict';
import test from 'node:test';
import {
  installmentVisibleInMonth,
  monthOffset,
} from '../src/lib/calendar-rules';

test('monthOffset conta meses entre datas, inclusive virada de ano', () => {
  const now = new Date(2026, 9, 15);
  assert.equal(monthOffset(now, new Date(2026, 9, 1)), 0);
  assert.equal(monthOffset(now, new Date(2026, 11, 31)), 2);
  assert.equal(monthOffset(now, new Date(2027, 1, 1)), 4);
  assert.equal(monthOffset(now, new Date(2026, 8, 30)), -1);
});

test('parcela só aparece nos meses em que ainda restam parcelas', () => {
  // parcela 2 de 4: restam 3 (2, 3 e 4) -> meses 0, 1 e 2
  assert.equal(installmentVisibleInMonth(2, 4, 0), true);
  assert.equal(installmentVisibleInMonth(2, 4, 2), true);
  assert.equal(installmentVisibleInMonth(2, 4, 3), false);
  assert.equal(installmentVisibleInMonth(2, 4, -1), false);
});

test('parcela concluída ou com dados inválidos não aparece', () => {
  assert.equal(installmentVisibleInMonth(5, 4, 0), false);
  assert.equal(installmentVisibleInMonth(Number.NaN, 1, 0), true);
});
