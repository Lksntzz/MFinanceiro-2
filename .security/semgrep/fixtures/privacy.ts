declare function reportOperationalEvent(
  eventName: string,
  area: string,
  severity: string,
  context: Record<string, unknown>,
): void;

declare function reportException(error: unknown, context: Record<string, unknown>): void;

// ruleid: mf-no-pii-in-telemetry
reportOperationalEvent('import.failed', 'import', 'error', { email: 'blocked@example.test' });

// ruleid: mf-no-pii-in-telemetry
reportException(new Error('test'), { token: 'blocked' });

// ok: mf-no-pii-in-telemetry
reportOperationalEvent('import.failed', 'import', 'error', { route: '/app/import', parser: 'ofx' });
