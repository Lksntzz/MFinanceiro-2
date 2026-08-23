declare function reportOperationalEvent(
  eventName: string,
  area: string,
  severity: string,
  context: Record<string, unknown>,
): void;

// ruleid: mf-critical-operation-needs-correlation
reportOperationalEvent('import.failed', 'import', 'error', {
  route: '/app/import',
});

// ok: mf-critical-operation-needs-correlation
reportOperationalEvent('import.failed', 'import', 'error', {
  route: '/app/import',
  correlation_id: 'corr-123',
});

// ok: mf-critical-operation-needs-correlation
reportOperationalEvent('cache.warning', 'pwa', 'warning', { reason: 'stale' });
