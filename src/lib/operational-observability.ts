import { supabase } from './supabase';

type Severity = 'info' | 'warning' | 'error';
type SafePrimitive = string | number | boolean | null;

const BLOCKED_KEYS = /(amount|balance|card|account|email|name|description|document|file|token|secret|password|payload|statement|merchant|salary|income|expense)/i;
const lastSent = new Map<string, number>();
const MIN_EVENT_INTERVAL_MS = 60_000;

function cleanToken(value: string, maxLength: number) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength);
}

function safeRoute() {
  if (typeof window === 'undefined') return 'unknown';
  return window.location.pathname
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')
    .replace(/\d{5,}/g, ':n')
    .slice(0, 180);
}

function sanitizeContext(input: Record<string, unknown> | undefined) {
  const output: Record<string, SafePrimitive> = {};
  for (const [rawKey, rawValue] of Object.entries(input || {})) {
    const key = cleanToken(rawKey, 48);
    if (!key || BLOCKED_KEYS.test(key)) continue;
    if (rawValue === null || typeof rawValue === 'boolean' || typeof rawValue === 'number') {
      output[key] = rawValue;
    } else if (typeof rawValue === 'string') {
      output[key] = rawValue.slice(0, 160);
    }
    if (Object.keys(output).length >= 12) break;
  }
  return output;
}

export async function reportOperationalEvent(
  eventName: string,
  area: string,
  severity: Severity = 'error',
  context?: Record<string, unknown>,
) {
  const event = cleanToken(eventName, 80);
  const normalizedArea = cleanToken(area, 60);
  if (!event || !normalizedArea) return;

  const key = `${event}:${normalizedArea}`;
  const now = Date.now();
  if (now - (lastSent.get(key) || 0) < MIN_EVENT_INTERVAL_MS) return;
  lastSent.set(key, now);

  try {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;

    await supabase.from('mf_operational_events').insert({
      user_id: data.user.id,
      event_name: event,
      area: normalizedArea,
      severity,
      context: {
        route: safeRoute(),
        ...sanitizeContext(context),
      },
    });
  } catch {
    // Observability must never become a dependency for the financial workflow.
  }
}

export function installGlobalOperationalObservers() {
  if (typeof window === 'undefined') return () => {};

  const onError = () => {
    void reportOperationalEvent('runtime.window_error', 'web-runtime', 'error');
  };
  const onRejection = () => {
    void reportOperationalEvent('runtime.unhandled_rejection', 'web-runtime', 'error');
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
