import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function readSupabaseKey(jsonName: string, directName: string, legacyName: string) {
  const direct = Deno.env.get(directName);
  if (direct) return direct;

  const encoded = Deno.env.get(jsonName);
  if (encoded) {
    try {
      const keys = JSON.parse(encoded) as Record<string, unknown>;
      if (typeof keys.default === 'string') return keys.default;
    } catch {
      // Fall through to the legacy variable.
    }
  }

  return Deno.env.get(legacyName) || '';
}

function constantTimeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const maxLength = Math.max(leftBytes.length, rightBytes.length);
  let mismatch = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < maxLength; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return mismatch === 0;
}

export function requireAutomationInternalAuth(request: Request) {
  const expected = (Deno.env.get('MF_N8N_INTERNAL_SECRET') || '').trim();
  if (!expected) throw new Error('AUTOMATION_INTERNAL_SECRET_NOT_CONFIGURED');

  const received = (request.headers.get('x-mf-internal-secret') || '').trim();
  if (!received || !constantTimeEqual(received, expected)) throw new Error('AUTOMATION_UNAUTHORIZED');
}

export function createAutomationAdminClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const secretKey = readSupabaseKey(
    'SUPABASE_SECRET_KEYS',
    'SUPABASE_SECRET_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  );

  if (!supabaseUrl || !secretKey) throw new Error('AUTOMATION_SUPABASE_ADMIN_NOT_CONFIGURED');

  return createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function allowedCorsHeaders(request: Request) {
  const origin = request.headers.get('Origin');
  if (!origin) return {};

  const configured = (Deno.env.get('MF_AUTOMATION_ALLOWED_ORIGINS') || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const localAllowed = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
  const explicitAllowed = configured.includes(origin);
  if (!localAllowed && !explicitAllowed) return {};

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'content-type, x-mf-internal-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}
