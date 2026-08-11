import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { User } from "@supabase/supabase-js";
import {
  consumeRateLimit,
  corsHeaders,
  createServiceClient,
  jsonResponse,
  recordOperationalEvent,
  requestRateLimitSubject,
  safeOrigin,
  valueRateLimitSubject,
} from "../_shared/edge-security.ts";

type PreparedRequest = {
  request_id?: string | null;
  request_status?: string | null;
  normalized_email?: string | null;
  display_name?: string | null;
  existing_account?: boolean | null;
};

const INVITE_COOLDOWN_MS = 10 * 60 * 1000;
const TOKEN_TTL_MS = 10 * 60 * 1000;
const PUBLIC_IP_LIMIT = 8;
const PUBLIC_IP_WINDOW_SECONDS = 15 * 60;
const PUBLIC_EMAIL_LIMIT = 4;
const PUBLIC_EMAIL_WINDOW_SECONDS = 60 * 60;
const ADMIN_DECISION_LIMIT = 60;
const ADMIN_DECISION_WINDOW_SECONDS = 10 * 60;

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function normalizeName(value: unknown) {
  return String(value || "").trim().slice(0, 160);
}

function isValidEmail(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function accepted(request: Request) {
  return jsonResponse(request, {
    accepted: true,
    message: "Se o endereço estiver apto, o MF enviará as próximas instruções por e-mail.",
  }, 202);
}

function tokenValue(bytes = 32) {
  const buffer = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...buffer))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...hash].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function inviteApprovedRequest(
  service: ReturnType<typeof createServiceClient>,
  requestId: string,
  origin: string,
) {
  const { data: requestRow, error: loadError } = await service
    .from("mf_access_requests")
    .select("id,nome,email,status,activation_last_sent_at")
    .eq("id", requestId)
    .maybeSingle();
  if (loadError) throw loadError;
  if (!requestRow || !["approved", "aprovado"].includes(String(requestRow.status || "").toLowerCase())) return false;

  const lastSentAt = requestRow.activation_last_sent_at
    ? new Date(requestRow.activation_last_sent_at).getTime()
    : 0;
  if (lastSentAt && Date.now() - lastSentAt < INVITE_COOLDOWN_MS) return false;

  const email = normalizeEmail(requestRow.email);
  if (!isValidEmail(email)) return false;

  const inviteToken = tokenValue();
  const tokenHash = await sha256Hex(inviteToken);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

  const { error: reserveError } = await service
    .from("mf_access_requests")
    .update({
      activation_token_hash: tokenHash,
      activation_token_expires_at: expiresAt,
    })
    .eq("id", requestId);
  if (reserveError) throw reserveError;

  try {
    const displayName = normalizeName(requestRow.nome);
    const { data: inviteData, error: inviteError } = await service.auth.admin.inviteUserByEmail(email, {
      data: {
        ...(displayName ? { name: displayName } : {}),
        mf_access_request_id: requestId,
        mf_invite_token: inviteToken,
      },
      redirectTo: `${origin}/activate`,
    });
    if (inviteError) throw inviteError;

    if (inviteData.user?.id) {
      const { error: metadataError } = await service.auth.admin.updateUserById(inviteData.user.id, {
        user_metadata: displayName ? { name: displayName } : {},
      });
      if (metadataError) console.warn("access-request metadata cleanup failed");
    }

    const { error: completeError } = await service
      .from("mf_access_requests")
      .update({
        activation_token_hash: null,
        activation_token_expires_at: null,
        activation_last_sent_at: new Date().toISOString(),
      })
      .eq("id", requestId);
    if (completeError) throw completeError;
    return true;
  } catch (error) {
    await service
      .from("mf_access_requests")
      .update({ activation_token_hash: null, activation_token_expires_at: null })
      .eq("id", requestId);
    throw error;
  }
}

async function publicRequestAllowed(
  request: Request,
  service: ReturnType<typeof createServiceClient>,
  email: string,
) {
  const [ipSubject, emailSubject] = await Promise.all([
    requestRateLimitSubject(request, "access-request"),
    valueRateLimitSubject("access-request-email", email),
  ]);
  const [ipDecision, emailDecision] = await Promise.all([
    consumeRateLimit(service, "access-request-ip", ipSubject, PUBLIC_IP_LIMIT, PUBLIC_IP_WINDOW_SECONDS),
    consumeRateLimit(service, "access-request-email", emailSubject, PUBLIC_EMAIL_LIMIT, PUBLIC_EMAIL_WINDOW_SECONDS),
  ]);
  return ipDecision.allowed && emailDecision.allowed;
}

async function processPublicRequest(request: Request, name: string, email: string) {
  if (!name || !isValidEmail(email)) return;
  const service = createServiceClient();
  if (!await publicRequestAllowed(request, service, email)) return;

  const { data, error } = await service.rpc("mf_prepare_access_request", {
    p_nome: name,
    p_email: email,
  });
  if (error) throw error;

  const row = (Array.isArray(data) ? data[0] : data) as PreparedRequest | null;
  if (!row?.request_id || row.existing_account) return;
  if (!["approved", "aprovado"].includes(String(row.request_status || "").toLowerCase())) return;

  await inviteApprovedRequest(service, String(row.request_id), safeOrigin(request));
}

async function authorizeAdmin(request: Request): Promise<{
  user: User;
  service: ReturnType<typeof createServiceClient>;
} | null> {
  const authHeader = String(request.headers.get("authorization") || "");
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  const service = createServiceClient();
  const { data, error } = await service.auth.getUser(token);
  if (error || !data.user) return null;
  const role = String(data.user.app_metadata?.role || "").toLowerCase();
  if (role !== "admin" && role !== "owner") return null;
  return { user: data.user, service };
}

async function processAdminDecision(request: Request, payload: Record<string, unknown>) {
  const auth = await authorizeAdmin(request);
  if (!auth) return jsonResponse(request, { error: "unauthorized" }, 401);

  const rateSubject = await valueRateLimitSubject("access-admin", auth.user.id);
  const rateDecision = await consumeRateLimit(
    auth.service,
    "access-admin-decision",
    rateSubject,
    ADMIN_DECISION_LIMIT,
    ADMIN_DECISION_WINDOW_SECONDS,
  );
  if (!rateDecision.allowed) {
    await recordOperationalEvent(
      auth.service,
      auth.user.id,
      "security.rate_limit",
      "access-admin",
      "warning",
      { operation: "decision", retryable: true },
    ).catch(() => {});
    return jsonResponse(
      request,
      { error: "rate_limited" },
      429,
      { "Retry-After": String(rateDecision.retryAfterSeconds) },
    );
  }

  const requestId = String(payload.requestId || "").trim();
  const decision = String(payload.decision || "").trim().toLowerCase();
  if (!/^[0-9a-f-]{36}$/i.test(requestId) || !["approved", "denied"].includes(decision)) {
    return jsonResponse(request, { error: "invalid_request" }, 400);
  }

  const approved = decision === "approved";
  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await auth.service
    .from("mf_access_requests")
    .update({
      status: approved ? "aprovado" : "negado",
      observacao: null,
      aprovado_por: auth.user.id,
      aprovado_em: now,
      ...(!approved ? { activation_token_hash: null, activation_token_expires_at: null } : {}),
    })
    .eq("id", requestId)
    .select("id,status")
    .maybeSingle();
  if (updateError) return jsonResponse(request, { error: "decision_failed" }, 500);
  if (!updated) return jsonResponse(request, { error: "not_found" }, 404);

  if (approved) {
    try {
      await inviteApprovedRequest(auth.service, requestId, safeOrigin(request));
    } catch {
      await recordOperationalEvent(
        auth.service,
        auth.user.id,
        "access.invite_failed",
        "access-admin",
        "error",
        { operation: "invite", retryable: true },
      ).catch(() => {});
      return jsonResponse(request, {
        ok: true,
        status: "approved",
        invite: "pending",
        message: "A solicitação foi aprovada, mas o convite precisa ser reenviado.",
      });
    }
  }

  return jsonResponse(request, {
    ok: true,
    status: approved ? "approved" : "denied",
    invite: approved ? "sent_or_recent" : "none",
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
  if (request.method !== "POST") return jsonResponse(request, { error: "method_not_allowed" }, 405);

  let payload: Record<string, unknown> = {};
  try {
    payload = await request.json();
  } catch {
    return accepted(request);
  }

  if (String(payload.action || "request") === "decision") {
    try {
      return await processAdminDecision(request, payload);
    } catch {
      return jsonResponse(request, { error: "decision_failed" }, 500);
    }
  }

  const name = normalizeName(payload.name);
  const email = normalizeEmail(payload.email);
  if (name && isValidEmail(email)) {
    EdgeRuntime.waitUntil(
      processPublicRequest(request, name, email).catch(() => {
        // Public responses stay intentionally indistinguishable. Never surface
        // account existence, rate-limit state or backend processing details.
      }),
    );
  }

  return accepted(request);
});
