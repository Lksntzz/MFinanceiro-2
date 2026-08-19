import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {
  allowedCorsHeaders,
  createAutomationAdminClient,
  requireAutomationInternalAuth,
} from '../_shared/mf-automation-auth.ts';
import {
  AUTOMATION_CONTRACT_VERSION,
  validateAutomationEnvelope,
  validateTargetEnvelope,
} from '../_shared/mf-automation-contract.ts';
import {
  executeAutomationAction,
  listAutomationTargets,
} from '../_shared/mf-automation-actions.ts';

const MAX_REQUEST_BYTES = 64 * 1024;

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...allowedCorsHeaders(request),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function safeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : 'AUTOMATION_GATEWAY_ERROR';
  return /^[A-Z0-9_]{3,96}$/.test(message) ? message : 'AUTOMATION_GATEWAY_ERROR';
}

async function readBody(request: Request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(length) && length > MAX_REQUEST_BYTES) throw new Error('AUTOMATION_REQUEST_TOO_LARGE');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) throw new Error('AUTOMATION_REQUEST_TOO_LARGE');
  try {
    return JSON.parse(text || '{}') as unknown;
  } catch {
    throw new Error('AUTOMATION_JSON_INVALID');
  }
}

async function idempotencyGet(admin: ReturnType<typeof createAutomationAdminClient>, key: string) {
  const { data, error } = await admin.rpc('mf_automation_idempotency_get', { p_key: key });
  if (error) throw new Error('AUTOMATION_IDEMPOTENCY_READ_FAILED');
  if (!data) return null;
  return data as Record<string, unknown>;
}

async function idempotencyPut(
  admin: ReturnType<typeof createAutomationAdminClient>,
  input: {
    key: string;
    action: string;
    correlationId: string;
    contextRef?: string | null;
    response: Record<string, unknown>;
  },
) {
  const { error } = await admin.rpc('mf_automation_idempotency_put', {
    p_key: input.key,
    p_action: input.action,
    p_correlation_id: input.correlationId,
    p_context_ref: input.contextRef || null,
    p_response: input.response,
    p_ttl_seconds: 86_400,
  });
  if (error) throw new Error('AUTOMATION_IDEMPOTENCY_WRITE_FAILED');
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: allowedCorsHeaders(request) });
  }
  if (request.method !== 'POST') {
    return json(request, { success: false, error: { code: 'METHOD_NOT_ALLOWED' } }, 405);
  }

  let correlationId: string | null = null;
  let action: string | null = null;

  try {
    requireAutomationInternalAuth(request);
    const admin = createAutomationAdminClient();
    const body = await readBody(request) as Record<string, unknown>;

    if (body.action === 'targets.list') {
      const envelope = validateTargetEnvelope(body);
      correlationId = envelope.correlation_id;
      action = envelope.action;

      const cached = await idempotencyGet(admin, envelope.idempotency_key);
      if (cached) return json(request, cached, 200);

      const data = await listAutomationTargets(admin, envelope.payload.module, envelope.payload.limit || 100);
      const response = {
        success: true,
        status: 'processed',
        version: AUTOMATION_CONTRACT_VERSION,
        action: envelope.action,
        correlation_id: envelope.correlation_id,
        data,
      };
      await idempotencyPut(admin, {
        key: envelope.idempotency_key,
        action: envelope.action,
        correlationId: envelope.correlation_id,
        response,
      });
      return json(request, response, 200);
    }

    const envelope = validateAutomationEnvelope(body);
    correlationId = envelope.correlation_id;
    action = envelope.action;

    const cached = await idempotencyGet(admin, envelope.idempotency_key);
    if (cached) return json(request, cached, 200);

    const data = await executeAutomationAction(
      admin,
      envelope.action,
      envelope.user_context.context_ref,
      envelope.payload,
    );

    const response = {
      success: true,
      status: 'processed',
      version: AUTOMATION_CONTRACT_VERSION,
      action: envelope.action,
      correlation_id: envelope.correlation_id,
      data,
    };

    await idempotencyPut(admin, {
      key: envelope.idempotency_key,
      action: envelope.action,
      correlationId: envelope.correlation_id,
      contextRef: envelope.user_context.context_ref,
      response,
    });

    return json(request, response, 200);
  } catch (error) {
    const code = safeErrorCode(error);
    const status = code === 'AUTOMATION_UNAUTHORIZED' ? 401
      : code.endsWith('_NOT_CONFIGURED') ? 503
      : code.includes('TOO_LARGE') ? 413
      : code.includes('INVALID') || code.includes('FORBIDDEN') || code.includes('REQUIRED') || code.includes('UNSUPPORTED') ? 400
      : 500;

    console.error(JSON.stringify({
      source: 'mf-automation-gateway',
      action,
      correlation_id: correlationId,
      error_code: code,
    }));

    return json(request, {
      success: false,
      status: 'failed',
      version: AUTOMATION_CONTRACT_VERSION,
      action,
      correlation_id: correlationId,
      error: { code },
    }, status);
  }
});
