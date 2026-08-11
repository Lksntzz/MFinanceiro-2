import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.103.0";

declare global {
  var EdgeRuntime: {
    waitUntil(promise: Promise<unknown>): void;
  };
}

export type OperationalSeverity = "info" | "warning" | "error";
export type SafePrimitive = string | number | boolean | null;

const PROD_ORIGIN = "https://mfinanceiro.com.br";
const VERCEL_PRODUCTION_ALIAS = "m-financeiro-2.vercel.app";
const VERCEL_TEAM_SUFFIX = "-lucasmanga95-4135s-projects.vercel.app";
const SAFE_CONTEXT_KEYS = new Set([
  "route",
  "component",
  "operation",
  "status",
  "provider",
  "method",
  "build",
  "retryable",
  "online",
  "visibility",
  "duration_bucket",
  "count_bucket",
  "http_status",
  "error_code",
  "reason_code",
  "surface",
]);

export function env(name: string) {
  return Deno.env.get(name)?.trim() || "";
}

export function readSupabaseKey(jsonName: string, directName: string, legacyName: string) {
  const direct = env(directName);
  if (direct) return direct;
  const encoded = env(jsonName);
  if (encoded) {
    try {
      const keys = JSON.parse(encoded) as Record<string, unknown>;
      if (typeof keys.default === "string") return keys.default;
    } catch {
      // Fall through to the legacy environment variable.
    }
  }
  return env(legacyName);
}

export function serviceRoleKey() {
  return readSupabaseKey("SUPABASE_SECRET_KEYS", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
}

export function createServiceClient(): SupabaseClient {
  const url = env("SUPABASE_URL");
  const key = serviceRoleKey();
  if (!url || !key) throw new Error("server_not_configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function safeOrigin(request: Request) {
  const raw = String(request.headers.get("origin") || "").trim();
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    const allowed = url.origin === PROD_ORIGIN
      || hostname === "localhost"
      || hostname === "127.0.0.1"
      || hostname === VERCEL_PRODUCTION_ALIAS
      || hostname.endsWith(VERCEL_TEAM_SUFFIX);
    return allowed ? url.origin : PROD_ORIGIN;
  } catch {
    return PROD_ORIGIN;
  }
}

export function corsHeaders(request: Request, extraAllowedHeaders: string[] = []) {
  const allowedHeaders = ["authorization", "x-client-info", "apikey", "content-type", ...extraAllowedHeaders];
  return {
    "Access-Control-Allow-Origin": safeOrigin(request),
    "Access-Control-Allow-Headers": Array.from(new Set(allowedHeaders)).join(", "),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
  };
}

export function jsonResponse(
  request: Request,
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}

function cleanToken(value: unknown, maxLength: number) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength);
}

function sanitizeRoute(value: unknown) {
  const raw = String(value || "").split("?")[0];
  const route = raw
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ":id")
    .replace(/\d{5,}/g, ":n")
    .replace(/[^a-zA-Z0-9_./:-]+/g, "-")
    .slice(0, 180);
  return route || "unknown";
}

export function sanitizeOperationalContext(input: Record<string, unknown> | undefined) {
  const output: Record<string, SafePrimitive> = {};
  for (const [rawKey, rawValue] of Object.entries(input || {})) {
    const key = cleanToken(rawKey, 48);
    if (!SAFE_CONTEXT_KEYS.has(key)) continue;

    if (key === "route") {
      output.route = sanitizeRoute(rawValue);
    } else if (rawValue === null) {
      output[key] = null;
    } else if (typeof rawValue === "boolean") {
      output[key] = rawValue;
    } else if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      output[key] = rawValue;
    } else if (typeof rawValue === "string") {
      output[key] = cleanToken(rawValue, 120);
    }

    if (Object.keys(output).length >= 12) break;
  }
  return output;
}

function clientIp(request: Request) {
  const forwarded = String(request.headers.get("x-forwarded-for") || "").split(",")[0]?.trim();
  return forwarded
    || String(request.headers.get("cf-connecting-ip") || "").trim()
    || String(request.headers.get("x-real-ip") || "").trim()
    || "unknown";
}

async function hmacHex(value: string) {
  const secret = serviceRoleKey();
  if (!secret) throw new Error("rate_limit_secret_unavailable");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  return [...signature].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function requestRateLimitSubject(request: Request, suffix = "") {
  return hmacHex(`ip:${clientIp(request)}:${suffix}`);
}

export async function valueRateLimitSubject(namespace: string, value: string) {
  return hmacHex(`${namespace}:${value}`);
}

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export async function consumeRateLimit(
  admin: SupabaseClient,
  scope: string,
  keyHash: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitDecision> {
  const { data, error } = await admin.rpc("mf_consume_rate_limit", {
    p_scope: cleanToken(scope, 80),
    p_key_hash: keyHash,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) throw error;

  const row = (Array.isArray(data) ? data[0] : data) as {
    allowed?: boolean;
    remaining?: number;
    retry_after_seconds?: number;
  } | null;
  if (!row || typeof row.allowed !== "boolean") throw new Error("invalid_rate_limit_response");

  return {
    allowed: row.allowed,
    remaining: Math.max(0, Number(row.remaining || 0)),
    retryAfterSeconds: Math.max(1, Number(row.retry_after_seconds || 1)),
  };
}

export async function recordOperationalEvent(
  admin: SupabaseClient,
  userId: string,
  eventName: string,
  area: string,
  severity: OperationalSeverity,
  context?: Record<string, unknown>,
) {
  const event = cleanToken(eventName, 80);
  const normalizedArea = cleanToken(area, 60);
  if (!event || !normalizedArea || !userId) return;

  const { error } = await admin.from("mf_operational_events").insert({
    user_id: userId,
    event_name: event,
    area: normalizedArea,
    severity,
    context: sanitizeOperationalContext(context),
  });
  if (error) throw error;
}
