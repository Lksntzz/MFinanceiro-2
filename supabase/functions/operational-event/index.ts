import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import {
  consumeRateLimit,
  corsHeaders,
  createServiceClient,
  jsonResponse,
  readSupabaseKey,
  recordOperationalEvent,
  sanitizeOperationalContext,
  valueRateLimitSubject,
} from "../_shared/edge-security.ts";

const MAX_BODY_BYTES = 8 * 1024;
const ALLOWED_SEVERITIES = new Set(["info", "warning", "error"]);

function accepted(request: Request) {
  return jsonResponse(request, { accepted: true }, 202);
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
  if (request.method !== "POST") return jsonResponse(request, { error: "method_not_allowed" }, 405);

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return accepted(request);

  const authorization = String(request.headers.get("authorization") || "");
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) return accepted(request);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const publishableKey = readSupabaseKey(
    "SUPABASE_PUBLISHABLE_KEYS",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_ANON_KEY",
  );
  if (!supabaseUrl || !publishableKey) return accepted(request);

  try {
    const client = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) return accepted(request);

    const admin = createServiceClient();
    const subject = await valueRateLimitSubject("operational-event-user", data.user.id);
    const limit = await consumeRateLimit(admin, "operational-event", subject, 120, 600);
    if (!limit.allowed) return accepted(request);

    const payload = await request.json().catch(() => null) as {
      eventName?: unknown;
      area?: unknown;
      severity?: unknown;
      context?: unknown;
    } | null;
    if (!payload) return accepted(request);

    const eventName = String(payload.eventName || "").toLowerCase().trim();
    const area = String(payload.area || "").toLowerCase().trim();
    const severity = String(payload.severity || "error").toLowerCase();
    if (!/^[a-z0-9_.-]{3,80}$/.test(eventName)) return accepted(request);
    if (!/^[a-z0-9_.-]{2,60}$/.test(area)) return accepted(request);
    if (!ALLOWED_SEVERITIES.has(severity)) return accepted(request);

    const context = payload.context && typeof payload.context === "object" && !Array.isArray(payload.context)
      ? sanitizeOperationalContext(payload.context as Record<string, unknown>)
      : {};

    await recordOperationalEvent(
      admin,
      data.user.id,
      eventName,
      area,
      severity as "info" | "warning" | "error",
      context,
    );
  } catch (error) {
    console.warn("operational-event ingestion failed", error instanceof Error ? error.message : "unknown");
  }

  return accepted(request);
});
