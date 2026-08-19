export const AUTOMATION_CONTRACT_VERSION = '1.0.0' as const;

export const AUTOMATION_ACTIONS = [
  'pulse.context',
  'budget.context',
  'card.context',
  'goal.context',
  'agenda.context',
  'recurrence.candidates',
  'data_quality.check',
  'notification.create',
] as const;

export const INTERNAL_AUTOMATION_ACTIONS = ['targets.list'] as const;

export type AutomationAction = typeof AUTOMATION_ACTIONS[number];
export type InternalAutomationAction = typeof INTERNAL_AUTOMATION_ACTIONS[number];
export type AnyAutomationAction = AutomationAction | InternalAutomationAction;

export const ACTION_SCOPE: Record<AutomationAction, string> = {
  'pulse.context': 'pulse',
  'budget.context': 'budget',
  'card.context': 'cards',
  'goal.context': 'goals',
  'agenda.context': 'agenda',
  'recurrence.candidates': 'recurrence',
  'data_quality.check': 'data_quality',
  'notification.create': 'notifications',
};

export const TARGET_MODULES = [
  'pulse',
  'budget',
  'cards',
  'goals',
  'agenda',
  'recurrence',
  'data_quality',
] as const;

export type TargetModule = typeof TARGET_MODULES[number];

export interface AutomationUserContext {
  context_ref: string;
  mode: 'automation_initiated';
  scope: string;
  expires_at?: string;
}

export interface AutomationEnvelope {
  version: typeof AUTOMATION_CONTRACT_VERSION;
  action: AutomationAction;
  correlation_id: string;
  idempotency_key: string;
  user_context: AutomationUserContext;
  payload: Record<string, unknown>;
}

export interface AutomationTargetEnvelope {
  version: typeof AUTOMATION_CONTRACT_VERSION;
  action: 'targets.list';
  correlation_id: string;
  idempotency_key: string;
  payload: {
    module: TargetModule;
    limit?: number;
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PAYLOAD_BYTES = 16 * 1024;

const FORBIDDEN_KEYS = new Set([
  'authorization',
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
  'service_role',
  'servicerole',
  'service_role_key',
  'password',
  'senha',
  'cookie',
  'set-cookie',
  'cpf',
  'cnpj',
  'cvv',
  'card_number',
  'cardnumber',
  'pan',
  'pdf',
  'image_base64',
  'raw_document',
  'raw_statement',
  'statement_balance',
  'balance',
  'saldo',
  'amount',
  'valor',
  'description',
  'descricao',
]);

function normalizeKey(value: string) {
  return value.trim().toLowerCase().replace(/[\s.-]+/g, '_');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function buildIdempotencyKey(action: string, correlationId: string) {
  return `${action}:${correlationId}`;
}

export function findForbiddenKeys(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findForbiddenKeys(item, `${path}[${index}]`));
  }
  if (!isPlainObject(value)) return [];

  const matches: string[] = [];
  for (const [key, nested] of Object.entries(value)) {
    const normalized = normalizeKey(key);
    if (FORBIDDEN_KEYS.has(normalized)) matches.push(`${path}.${key}`);
    matches.push(...findForbiddenKeys(nested, `${path}.${key}`));
  }
  return matches;
}

export function assertSafePayload(payload: unknown) {
  if (!isPlainObject(payload)) throw new Error('AUTOMATION_PAYLOAD_INVALID');
  const serialized = JSON.stringify(payload);
  if (new TextEncoder().encode(serialized).byteLength > MAX_PAYLOAD_BYTES) {
    throw new Error('AUTOMATION_PAYLOAD_TOO_LARGE');
  }
  const forbidden = findForbiddenKeys(payload);
  if (forbidden.length) throw new Error('AUTOMATION_PAYLOAD_FORBIDDEN_FIELD');
}

export function sanitizeNotificationText(value: unknown, maxLength: number) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
  if (!text) throw new Error('AUTOMATION_NOTIFICATION_TEXT_REQUIRED');
  if (/(?:R\$|BRL|US\$|€|£)/i.test(text)) throw new Error('AUTOMATION_NOTIFICATION_FINANCIAL_VALUE_FORBIDDEN');
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text)) throw new Error('AUTOMATION_NOTIFICATION_PII_FORBIDDEN');
  const digits = text.replace(/\D/g, '');
  if (digits.length >= 11) throw new Error('AUTOMATION_NOTIFICATION_PII_FORBIDDEN');
  return text;
}

export function isSafeActionPath(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (!value.startsWith('/app')) return false;
  if (value.includes('://') || value.includes('\\') || value.includes('\n') || value.includes('\r')) return false;
  return value.length <= 240;
}

export function validateAutomationEnvelope(input: unknown): AutomationEnvelope {
  if (!isPlainObject(input)) throw new Error('AUTOMATION_ENVELOPE_INVALID');
  if (input.version !== AUTOMATION_CONTRACT_VERSION) throw new Error('AUTOMATION_VERSION_UNSUPPORTED');
  if (!AUTOMATION_ACTIONS.includes(input.action as AutomationAction)) throw new Error('AUTOMATION_ACTION_INVALID');
  if (!isUuid(input.correlation_id)) throw new Error('AUTOMATION_CORRELATION_ID_INVALID');
  if (input.idempotency_key !== buildIdempotencyKey(String(input.action), input.correlation_id)) {
    throw new Error('AUTOMATION_IDEMPOTENCY_KEY_INVALID');
  }
  if (!isPlainObject(input.user_context)) throw new Error('AUTOMATION_CONTEXT_INVALID');
  if (!isUuid(input.user_context.context_ref)) throw new Error('AUTOMATION_CONTEXT_REF_INVALID');
  if (input.user_context.mode !== 'automation_initiated') throw new Error('AUTOMATION_CONTEXT_MODE_INVALID');

  const action = input.action as AutomationAction;
  const expectedScope = ACTION_SCOPE[action];
  if (input.user_context.scope !== expectedScope) throw new Error('AUTOMATION_CONTEXT_SCOPE_INVALID');

  assertSafePayload(input.payload ?? {});

  return {
    version: AUTOMATION_CONTRACT_VERSION,
    action,
    correlation_id: input.correlation_id,
    idempotency_key: input.idempotency_key as string,
    user_context: {
      context_ref: input.user_context.context_ref,
      mode: 'automation_initiated',
      scope: expectedScope,
      expires_at: typeof input.user_context.expires_at === 'string' ? input.user_context.expires_at : undefined,
    },
    payload: (input.payload ?? {}) as Record<string, unknown>,
  };
}

export function validateTargetEnvelope(input: unknown): AutomationTargetEnvelope {
  if (!isPlainObject(input)) throw new Error('AUTOMATION_ENVELOPE_INVALID');
  if (input.version !== AUTOMATION_CONTRACT_VERSION) throw new Error('AUTOMATION_VERSION_UNSUPPORTED');
  if (input.action !== 'targets.list') throw new Error('AUTOMATION_ACTION_INVALID');
  if (!isUuid(input.correlation_id)) throw new Error('AUTOMATION_CORRELATION_ID_INVALID');
  if (input.idempotency_key !== buildIdempotencyKey('targets.list', input.correlation_id)) {
    throw new Error('AUTOMATION_IDEMPOTENCY_KEY_INVALID');
  }
  if (!isPlainObject(input.payload)) throw new Error('AUTOMATION_PAYLOAD_INVALID');
  if (!TARGET_MODULES.includes(input.payload.module as TargetModule)) throw new Error('AUTOMATION_TARGET_MODULE_INVALID');
  const rawLimit = Number(input.payload.limit ?? 100);
  const limit = Number.isInteger(rawLimit) ? Math.min(200, Math.max(1, rawLimit)) : 100;
  return {
    version: AUTOMATION_CONTRACT_VERSION,
    action: 'targets.list',
    correlation_id: input.correlation_id,
    idempotency_key: input.idempotency_key as string,
    payload: { module: input.payload.module as TargetModule, limit },
  };
}
