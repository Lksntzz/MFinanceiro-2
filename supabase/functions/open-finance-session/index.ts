import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { createApiKey, createConnectToken, deleteItem, pluggyConfigured } from "../_shared/pluggy.ts";
import {
  consumeRateLimit,
  corsHeaders,
  createServiceClient,
  jsonResponse,
  readSupabaseKey,
  recordOperationalEvent,
  valueRateLimitSubject,
} from "../_shared/edge-security.ts";

const CONNECT_RATE_LIMIT = 10;
const CONNECT_RATE_WINDOW_SECONDS = 10 * 60;
const MANAGEMENT_RATE_LIMIT = 30;
const MANAGEMENT_RATE_WINDOW_SECONDS = 10 * 60;

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return jsonResponse(request, { error: "Método não permitido." }, 405);

  const authorization = request.headers.get("Authorization");
  const token = authorization?.replace(/^Bearer\s+/i, "");
  if (!authorization || !token) return jsonResponse(request, { error: "Autenticação necessária." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const publishableKey = readSupabaseKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY");
  if (!supabaseUrl || !publishableKey) return jsonResponse(request, { error: "Supabase não configurado na função." }, 500);

  const supabase = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return jsonResponse(request, { error: "Sessão inválida." }, 401);

  const admin = createServiceClient();
  let action = "connect";

  try {
    const body = await request.json().catch(() => ({})) as {
      action?: "connect" | "token" | "bind" | "revoke";
      connectionId?: string;
      itemId?: string;
      institutionId?: string;
      institutionName?: string;
      displayName?: string;
      scopes?: string[];
    };
    action = body.action || "connect";

    const isConnectAction = action === "token" || action === "connect";
    const rateSubject = await valueRateLimitSubject("open-finance-session-user", userData.user.id);
    const rateDecision = await consumeRateLimit(
      admin,
      isConnectAction ? "open-finance-connect" : "open-finance-management",
      rateSubject,
      isConnectAction ? CONNECT_RATE_LIMIT : MANAGEMENT_RATE_LIMIT,
      isConnectAction ? CONNECT_RATE_WINDOW_SECONDS : MANAGEMENT_RATE_WINDOW_SECONDS,
    );
    if (!rateDecision.allowed) {
      await recordOperationalEvent(admin, userData.user.id, "security.rate_limit", "open-finance", "warning", {
        operation: action,
        provider: "pluggy",
        retryable: true,
      }).catch(() => {});
      return jsonResponse(
        request,
        { error: "Muitas tentativas em pouco tempo. Aguarde e tente novamente." },
        429,
        { "Retry-After": String(rateDecision.retryAfterSeconds) },
      );
    }

    if (!pluggyConfigured()) {
      return jsonResponse(request, {
        configured: false,
        provider: "pluggy",
        error: "Pluggy ainda não foi configurado. Defina PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET nos secrets do Supabase.",
      }, 503);
    }

    if (isConnectAction) {
      const apiKey = await createApiKey();
      const webhookBase = (Deno.env.get("OPEN_FINANCE_WEBHOOK_URL") || `${supabaseUrl}/functions/v1/open-finance-webhook`).trim();
      const webhookSecret = (Deno.env.get("OPEN_FINANCE_WEBHOOK_SECRET") || "").trim();
      const webhookUrl = webhookSecret
        ? `${webhookBase}${webhookBase.includes("?") ? "&" : "?"}token=${encodeURIComponent(webhookSecret)}`
        : webhookBase;
      const connectToken = await createConnectToken(apiKey, userData.user.id, webhookUrl, body.itemId || null);
      return jsonResponse(request, {
        configured: true,
        provider: "pluggy",
        connectToken,
        accessToken: connectToken,
        expiresInSeconds: 1800,
      });
    }

    if (action === "bind") {
      const itemId = String(body.itemId || "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(itemId)) throw new Error("Item Pluggy inválido.");
      const institutionName = String(body.institutionName || body.displayName || "Instituição conectada").trim();
      const scopes = Array.isArray(body.scopes) && body.scopes.length ? body.scopes : ["ACCOUNTS_READ", "TRANSACTIONS_READ"];

      const { data: existing } = await supabase
        .from("mf_bank_connections")
        .select("id")
        .eq("user_id", userData.user.id)
        .eq("provider", "pluggy")
        .eq("provider_connection_ref", itemId)
        .maybeSingle();

      if (existing?.id) return jsonResponse(request, { configured: true, provider: "pluggy", connectionId: existing.id, itemId, status: "active" });

      const { data: prepared, error: prepareError } = await supabase.rpc("mf_prepare_bank_connection", {
        p_provider: "pluggy",
        p_institution_id: String(body.institutionId || "").trim() || null,
        p_institution_name: institutionName,
        p_scopes: scopes,
      });
      if (prepareError) throw prepareError;
      const connectionId = String((prepared as Record<string, unknown>)?.connection_id || "");
      if (!connectionId) throw new Error("Não foi possível registrar a conexão.");

      const { error: updateError } = await supabase
        .from("mf_bank_connections")
        .update({
          status: "active",
          sync_status: "idle",
          provider_connection_ref: itemId,
          display_name: body.displayName || institutionName,
          last_error: null,
          metadata: { provider: "pluggy", bound_at: new Date().toISOString() },
        })
        .eq("id", connectionId)
        .eq("user_id", userData.user.id);
      if (updateError) throw updateError;

      return jsonResponse(request, { configured: true, provider: "pluggy", connectionId, itemId, status: "active" });
    }

    if (action === "revoke") {
      const connectionId = String(body.connectionId || "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(connectionId)) throw new Error("Identificador da conexão inválido.");

      const { data: connection, error: connectionError } = await supabase
        .from("mf_bank_connections")
        .select("id,status,provider,provider_connection_ref")
        .eq("id", connectionId)
        .eq("user_id", userData.user.id)
        .single();
      if (connectionError || !connection) throw new Error("Conexão não encontrada.");
      if (connection.status === "revoked") return jsonResponse(request, { connectionId, status: "revoked", alreadyRevoked: true });
      if (connection.provider !== "pluggy" || !connection.provider_connection_ref) throw new Error("Conexão sem referência Pluggy válida.");

      const apiKey = await createApiKey();
      await deleteItem(apiKey, connection.provider_connection_ref);

      const { error: revokeError } = await admin
        .from("mf_bank_connections")
        .update({ status: "revoked", sync_status: "idle", last_error: null, next_sync_at: null })
        .eq("id", connectionId)
        .eq("user_id", userData.user.id);
      if (revokeError) throw revokeError;

      return jsonResponse(request, { connectionId, status: "revoked", alreadyRevoked: false });
    }

    throw new Error("Ação Open Finance inválida.");
  } catch (error) {
    await recordOperationalEvent(admin, userData.user.id, "open_finance.session_failed", "open-finance", "error", {
      operation: action,
      provider: "pluggy",
      retryable: true,
    }).catch(() => {});
    return jsonResponse(request, { error: error instanceof Error ? error.message : "Falha no Open Finance." }, 400);
  }
});
