import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { toLocalISODate, toLocalMonthKey } from '../src/lib/local-date';

describe('local-date', () => {
  it('usa o dia local, não o dia UTC (23h30 do dia 31)', () => {
    // Construtor com componentes = horário local, independente do fuso do servidor.
    const lateNight = new Date(2026, 9, 31, 23, 30);
    assert.equal(toLocalISODate(lateNight), '2026-10-31');
    assert.equal(toLocalMonthKey(lateNight), '2026-10');
  });

  it('completa mês e dia com zero à esquerda', () => {
    assert.equal(toLocalISODate(new Date(2026, 0, 5, 8, 0)), '2026-01-05');
    assert.equal(toLocalMonthKey(new Date(2026, 0, 5, 8, 0)), '2026-01');
  });

  it('vira o mês corretamente na virada local', () => {
    assert.equal(toLocalMonthKey(new Date(2026, 11, 31, 23, 59)), '2026-12');
    assert.equal(toLocalISODate(new Date(2027, 0, 1, 0, 1)), '2027-01-01');
  });
});
