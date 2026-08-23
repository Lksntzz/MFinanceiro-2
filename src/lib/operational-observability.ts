import { Capacitor } from '@capacitor/core';
import { supabase } from './supabase';

type Severity = 'info' | 'warning' | 'error';
type DiagSeverity = 'low' | 'medium' | 'high' | 'critical';
type DiagCategory =
  | 'code_exception'
  | 'infrastructure'
  | 'integration'
  | 'business_rule'
  | 'data_anomaly'
  | 'performance'
  | 'security'
  | 'unclassified';
type DiagImpact = 'none' | 'partial_operation' | 'financial_risk' | 'data_loss';
type ClientSurface = 'web' | 'pwa' | 'android' | 'ios' | 'unknown';
type SafePrimitive = string | number | boolean | null;

type OperationalOptions = {
  category?: DiagCategory;
  module?: string;
  operation?: string;
  errorCode?: string;
  impact?: DiagImpact;
  correlationId?: string;
  durationMs?: number;
  severity?: DiagSeverity;
};

type EventDescriptor = {
  title: string;
  category: DiagCategory;
  module: string;
  operation: string;
  errorCode: string;
  impact?: DiagImpact;
};

const BLOCKED_KEYS =
  /(amount|balance|card|account|email|name|description|document|file|token|secret|password|payload|statement|merchant|salary|income|expense|raw|preview|text)/i;
const MIN_EVENT_INTERVAL_MS = 60_000;
const SEND_TIMEOUT_MS = 1_200;
const CIRCUIT_FAILURE_LIMIT = 3;
const CIRCUIT_OPEN_MS = 60_000;
const lastSent = new Map<string, number>();
let consecutiveFailures = 0;
let circuitOpenUntil = 0;

const EVENT_DESCRIPTORS: Record<string, EventDescriptor> = {
  'runtime.window_error': {
    title: 'Erro global não tratado no navegador',
    category: 'code_exception',
    module: 'runtime.web',
    operation: 'window_error',
    errorCode: 'RUNTIME_WINDOW_ERROR',
  },
  'runtime.unhandled_rejection': {
    title: 'Promise rejeitada sem tratamento',
    category: 'code_exception',
    module: 'runtime.web',
    operation: 'unhandled_rejection',
    errorCode: 'RUNTIME_UNHANDLED_REJECTION',
  },
  'runtime.react_render_error': {
    title: 'Falha de renderização React',
    category: 'code_exception',
    module: 'runtime.web',
    operation: 'react_render',
    errorCode: 'RUNTIME_REACT_RENDER_ERROR',
    impact: 'partial_operation',
  },
  'runtime.service_worker_registration_failed': {
    title: 'Falha ao registrar Service Worker',
    category: 'infrastructure',
    module: 'service_worker',
    operation: 'register',
    errorCode: 'SERVICE_WORKER_REGISTRATION_FAILED',
  },
  'dashboard.refresh_failed': {
    title: 'Falha ao carregar workspace financeiro',
    category: 'integration',
    module: 'dashboard.workspace',
    operation: 'refresh',
    errorCode: 'DASHBOARD_REFRESH_FAILED',
    impact: 'partial_operation',
  },
  'dashboard.analytics_cursor_missing': {
    title: 'Paginação analítica sem cursor',
    category: 'data_anomaly',
    module: 'dashboard.analytics',
    operation: 'hydrate_ledger',
    errorCode: 'DASHBOARD_ANALYTICS_CURSOR_MISSING',
  },
  'dashboard.analytics_page_failed': {
    title: 'Falha ao carregar página analítica',
    category: 'integration',
    module: 'dashboard.analytics',
    operation: 'hydrate_ledger',
    errorCode: 'DASHBOARD_ANALYTICS_PAGE_FAILED',
  },
  'transaction.supporting_data_failed': {
    title: 'Falha ao carregar dados de apoio do lançamento',
    category: 'integration',
    module: 'transaction.manual',
    operation: 'load_supporting_data',
    errorCode: 'TRANSACTION_SUPPORTING_DATA_FAILED',
  },
  'transaction.create_failed': {
    title: 'Falha ao criar lançamento',
    category: 'business_rule',
    module: 'transaction.manual',
    operation: 'create',
    errorCode: 'TRANSACTION_CREATE_FAILED',
    impact: 'partial_operation',
  },
  'transaction.mark_paid_failed': {
    title: 'Falha ao concluir lançamento pendente',
    category: 'business_rule',
    module: 'transaction.pending',
    operation: 'mark_paid',
    errorCode: 'TRANSACTION_MARK_PAID_FAILED',
    impact: 'partial_operation',
  },
  'transaction.delete_failed': {
    title: 'Falha ao excluir lançamento',
    category: 'business_rule',
    module: 'transaction.manual',
    operation: 'delete',
    errorCode: 'TRANSACTION_DELETE_FAILED',
    impact: 'partial_operation',
  },
  'fixed_bill.pay_failed': {
    title: 'Falha ao registrar pagamento de conta fixa',
    category: 'business_rule',
    module: 'transaction.pending',
    operation: 'pay_fixed_bill',
    errorCode: 'FIXED_BILL_PAY_FAILED',
    impact: 'financial_risk',
  },
  'transaction.refresh_after_save_failed': {
    title: 'Lançamento salvo, mas atualização da interface falhou',
    category: 'integration',
    module: 'transaction.manual',
    operation: 'refresh_after_save',
    errorCode: 'TRANSACTION_REFRESH_AFTER_SAVE_FAILED',
  },
  'statement.format_unsupported': {
    title: 'Formato de extrato não suportado',
    category: 'data_anomaly',
    module: 'statement_import',
    operation: 'detect_format',
    errorCode: 'STATEMENT_FORMAT_UNSUPPORTED',
  },
  'statement.invalid_date_fallback': {
    title: 'Data inválida seria normalizada silenciosamente',
    category: 'business_rule',
    module: 'statement_import',
    operation: 'normalize',
    errorCode: 'STATEMENT_INVALID_DATE_FALLBACK',
    impact: 'financial_risk',
  },
  'statement.parse_empty': {
    title: 'Extrato processado sem lançamentos válidos',
    category: 'data_anomaly',
    module: 'statement_import',
    operation: 'parse',
    errorCode: 'STATEMENT_PARSE_EMPTY',
  },
  'statement.process_failed': {
    title: 'Falha ao processar arquivo de extrato',
    category: 'code_exception',
    module: 'statement_import',
    operation: 'process_file',
    errorCode: 'STATEMENT_FILE_READ_FAILED',
  },
  'statement.ocr_fallback_failed': {
    title: 'Fallback OCR/IA falhou',
    category: 'integration',
    module: 'statement_import.ocr',
    operation: 'fallback',
    errorCode: 'STATEMENT_OCR_FUNCTION_FAILED',
  },
  'statement.ocr_low_confidence': {
    title: 'OCR/IA retornou confiança baixa',
    category: 'data_anomaly',
    module: 'statement_import.ocr',
    operation: 'review',
    errorCode: 'STATEMENT_OCR_LOW_CONFIDENCE',
  },
  'statement.ocr_review_persist_failed': {
    title: 'Falha ao persistir revisão do OCR',
    category: 'integration',
    module: 'statement_import.ocr',
    operation: 'persist_review',
    errorCode: 'STATEMENT_OCR_REVIEW_PERSIST_FAILED',
    impact: 'partial_operation',
  },
  'statement.import_failed': {
    title: 'Falha ao confirmar importação de extrato',
    category: 'business_rule',
    module: 'statement_import.persistence',
    operation: 'commit',
    errorCode: 'STATEMENT_IMPORT_RPC_FAILED',
    impact: 'financial_risk',
  },
};

export function createOperationalCorrelationId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function cleanToken(value: string, maxLength: number) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength);
}

function cleanErrorCode(value: string) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9_.:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
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
    if (rawValue === null) {
      output[key] = null;
    } else if (typeof rawValue === 'boolean') {
      output[key] = rawValue;
    } else if (typeof rawValue === 'number') {
      output[key] = Number.isFinite(rawValue) ? rawValue : String(rawValue);
    } else if (typeof rawValue === 'string') {
      output[key] = rawValue.slice(0, 160);
    }
    if (Object.keys(output).length >= 12) break;
  }
  return output;
}

function clientSurface(): ClientSurface {
  const platform = Capacitor.getPlatform();
  if (platform === 'ios' || platform === 'android') return platform;
  if (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(display-mode: standalone)').matches
  )
    return 'pwa';
  return 'web';
}

function mapSeverity(value: Severity): DiagSeverity {
  if (value === 'info') return 'low';
  if (value === 'warning') return 'medium';
  return 'high';
}

function currentBuildId() {
  return typeof __MF_BUILD_ID__ !== 'undefined'
    ? String(__MF_BUILD_ID__)
    : 'unknown';
}

function environment(): 'production' | 'preview' | 'development' | 'unknown' {
  const explicit = String(import.meta.env.VITE_MF_DIAG_ENVIRONMENT || '')
    .trim()
    .toLowerCase();
  if (
    explicit === 'production' ||
    explicit === 'preview' ||
    explicit === 'development'
  )
    return explicit;
  return import.meta.env.PROD ? 'production' : 'development';
}

async function sendEvent(payload: Record<string, unknown>) {
  const ingestUrl = String(
    import.meta.env.VITE_MF_ADMIN_INGEST_URL || '',
  ).trim();
  if (!ingestUrl || Date.now() < circuitOpenUntil) return;

  try {
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) return;

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    try {
      const response = await fetch(ingestUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        keepalive: true,
        signal: controller.signal,
      });
      if (!response.ok && response.status !== 429)
        throw new Error('diagnostic_ingest_failed');
      consecutiveFailures = 0;
    } finally {
      window.clearTimeout(timer);
    }
  } catch {
    consecutiveFailures += 1;
    if (consecutiveFailures >= CIRCUIT_FAILURE_LIMIT) {
      circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
      consecutiveFailures = 0;
    }
  }
}

export function reportOperationalEvent(
  eventName: string,
  area: string,
  severity: Severity = 'error',
  context?: Record<string, unknown>,
  options: OperationalOptions = {},
) {
  const event = cleanToken(eventName, 80);
  const normalizedArea = cleanToken(area, 60);
  if (!event || !normalizedArea) return;

  const key = `${event}:${normalizedArea}`;
  const now = Date.now();
  if (now - (lastSent.get(key) || 0) < MIN_EVENT_INTERVAL_MS) return;
  lastSent.set(key, now);

  const descriptor = EVENT_DESCRIPTORS[event];
  const module = cleanToken(
    options.module || descriptor?.module || normalizedArea,
    80,
  );
  const operation = cleanToken(
    options.operation || descriptor?.operation || event,
    100,
  );
  const errorCode = cleanErrorCode(
    options.errorCode || descriptor?.errorCode || event.replace(/[.-]/g, '_'),
  );
  if (!module || !operation || !errorCode) return;

  const buildId = currentBuildId();
  const durationMs = Number(options.durationMs);
  const payload = {
    category: options.category || descriptor?.category || 'unclassified',
    module,
    operation,
    severity: options.severity || mapSeverity(severity),
    error_code: errorCode,
    app_version: buildId,
    deploy_id: buildId,
    surface: clientSurface(),
    environment: environment(),
    message: descriptor?.title || event,
    impact: options.impact || descriptor?.impact || 'none',
    correlation_id: options.correlationId,
    duration_ms:
      Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : undefined,
    technical_context: {
      route: safeRoute(),
      ...sanitizeContext(context),
    },
  };

  void sendEvent(payload);
}

export function installGlobalOperationalObservers() {
  if (typeof window === 'undefined') return () => {};

  const onError = () => {
    reportOperationalEvent('runtime.window_error', 'web-runtime', 'error');
  };
  const onRejection = () => {
    reportOperationalEvent(
      'runtime.unhandled_rejection',
      'web-runtime',
      'error',
    );
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
