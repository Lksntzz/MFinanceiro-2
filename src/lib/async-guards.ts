export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} excedeu ${ms} ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Rejeita com TimeoutError se a promessa não terminar em `ms`.
 * A promessa original NÃO é cancelada: ela continua em segundo plano e seu
 * resultado é descartado por quem chamou. Use apenas quando isso for seguro
 * (ex.: renovação de sessão, cujo resultado chega por onAuthStateChange).
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = 'Operação',
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Intervalo até a próxima tentativa: dobra a cada falha consecutiva,
 * limitado a `maxMs`. Com 0 falhas retorna `baseMs`.
 */
export function nextBackoffDelay(
  baseMs: number,
  consecutiveFailures: number,
  maxMs: number,
): number {
  const failures = Math.max(0, Math.floor(consecutiveFailures));
  // Evita overflow com muitas falhas: 2 ** 30 já passa de qualquer teto útil.
  const factor = 2 ** Math.min(failures, 30);
  return Math.min(baseMs * factor, maxMs);
}
