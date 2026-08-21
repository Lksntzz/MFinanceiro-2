import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// MF Financeiro -> MF Administração. SERVER ONLY.
// Never import this helper from Vite/browser code.

type ServiceCategory =
  | 'code_exception'
  | 'infrastructure'
  | 'integration'
  | 'business_rule'
  | 'data_anomaly'
  | 'performance'
  | 'security'
  | 'unclassified';

type ServiceSeverity = 'low' | 'medium' | 'high' | 'critical';
type ServiceImpact = 'none' | 'partial_operation' | 'financial_risk' | 'data_loss';

type SafePrimitive = string | number | boolean | null;

export type ServiceDiagnosticEvent = {
  module: string;
  operation: string;
  errorCode: string;
  message: string;
  category?: ServiceCategory;
  severity?: ServiceSeverity;
  impact?: ServiceImpact;
  correlationId?: string;
  userId?: string | null;
  durationMs?: number;
  context?: Record<string, unknown>;
};

const BLOCKED_KEYS = /(amount|balance|card|account|email|name|description|document|file|token|secret|password|payload|statement|merchant|salary|income|expense|raw|preview|text|cpf|cnpj)/i;
const SEND_TIMEOUT_MS = 1_200;

function cleanIdentifier(value: unknown, maxLength: number) {
  return String(value || '')
    .replace(/[^A-Za-z0-9_.:/-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLength);
}

function diagnosticEnvironment(): 'production' | 'preview' | 'development' | 'unknown' {
  const value = String(Deno.env.get('MF_DIAG_ENVIRONMENT') || '').trim().toLowerCase();
  if (value === 'production' || value === 'preview' || value === 'development') return value;
  // Deployed Supabase Edge Functions run in a managed deployment isolate. Local
  // `supabase functions serve` has no deployment id and remains development.
  return Deno.env.get('DENO_DEPLOYMENT_ID') ? 'production' : 'development';
}

function sanitizeContext(input?: Record<string, unknown>) {
  const output: Record<string, SafePrimitive> = {};
  for (const [rawKey, rawValue] of Object.entries(input || {})) {
    const key = cleanIdentifier(rawKey, 48).toLowerCase();
    if (!key || BLOCKED_KEYS.test(key)) continue;
    if (rawValue === null || typeof rawValue === 'boolean') output[key] = rawValue as boolean | null;
    else if (typeof rawValue === 'number') output[key] = Number.isFinite(rawValue) ? rawValue : String(rawValue);
    else if (typeof rawValue === 'string') output[key] = rawValue.slice(0, 160);
    if (Object.keys(output).length >= 16) break;
  }
  return output;
}

function keepAlive(task: Promise<unknown>) {
  try {
    const runtime = (globalThis as typeof globalThis & {
      EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void };
    }).EdgeRuntime;
    if (typeof runtime?.waitUntil === 'function') {
      runtime.waitUntil(task);
      return;
    }
  } catch {
    // Telemetry may never affect the financial response.
  }
  void task;
}

export function reportMfAdminServiceEvent(event: ServiceDiagnosticEvent) {
  try {
    const url = String(Deno.env.get('MF_ADMIN_SERVICE_INGEST_URL') || '').trim();
    const secret = String(Deno.env.get('MF_ADMIN_SERVICE_INGEST_SECRET') || '').trim();
    if (!url || !secret) return;

    const module = cleanIdentifier(event.module, 80);
    const operation = cleanIdentifier(event.operation, 100);
    const errorCode = cleanIdentifier(event.errorCode.toUpperCase(), 120);
    if (!module || !operation || !errorCode) return;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    const durationMs = Number(event.durationMs);
    const body = {
      module,
      operation,
      error_code: errorCode,
      message: String(event.message || errorCode).slice(0, 180),
      category: event.category || 'unclassified',
      severity: event.severity || 'high',
      impact: event.impact || 'none',
      correlation_id: event.correlationId,
      surface: 'edge',
      environment: diagnosticEnvironment(),
      deploy_id: Deno.env.get('DENO_DEPLOYMENT_ID') || undefined,
      duration_ms: Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : undefined,
      technical_context: sanitizeContext(event.context),
      user_id: event.userId || undefined,
    };

    const task = fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mf-service-ingest-secret': secret,
        'x-mf-source-service': module,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    }).catch(() => {}).finally(() => clearTimeout(timer));

    keepAlive(task);
  } catch {
    // Intentional no-op: diagnostics are strictly best-effort and must never
    // throw into OCR, Open Finance, ledger, or any other product operation.
  }
}
