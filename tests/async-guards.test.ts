import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  nextBackoffDelay,
  TimeoutError,
  withTimeout,
} from '../src/lib/async-guards';

describe('withTimeout', () => {
  it('resolve com o valor quando a promessa termina a tempo', async () => {
    const value = await withTimeout(Promise.resolve(42), 200, 'teste');
    assert.equal(value, 42);
  });

  it('rejeita com TimeoutError quando a promessa demora demais', async () => {
    const never = new Promise<number>(() => {});
    await assert.rejects(
      withTimeout(never, 20, 'renovação'),
      (error: unknown) =>
        error instanceof TimeoutError &&
        error.name === 'TimeoutError' &&
        error.message.includes('renovação'),
    );
  });

  it('propaga o erro original quando a promessa falha a tempo', async () => {
    await assert.rejects(
      withTimeout(Promise.reject(new Error('falhou')), 200, 'teste'),
      /falhou/,
    );
  });
});

describe('nextBackoffDelay', () => {
  it('usa o intervalo base sem falhas', () => {
    assert.equal(nextBackoffDelay(30_000, 0, 240_000), 30_000);
  });

  it('dobra a cada falha consecutiva', () => {
    assert.equal(nextBackoffDelay(30_000, 1, 240_000), 60_000);
    assert.equal(nextBackoffDelay(30_000, 2, 240_000), 120_000);
  });

  it('respeita o teto e não estoura com muitas falhas', () => {
    assert.equal(nextBackoffDelay(30_000, 3, 240_000), 240_000);
    assert.equal(nextBackoffDelay(30_000, 500, 240_000), 240_000);
  });

  it('trata valores inválidos como zero falhas', () => {
    assert.equal(nextBackoffDelay(30_000, -3, 240_000), 30_000);
  });
});
