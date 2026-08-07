import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import {
  createPluggyConnectToken,
  deletePluggyItem,
  getPluggyItem,
  listOpenFinanceConnectorIds,
  randomSecret,
  resolvePluggyInstitution,
  sha256Hex,
} from "../_shared/open-finance-pluggy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function readSupabaseKey(jsonName: string, directName: string, legacyName: string) {
  const direct = Deno.env.get(directName);
  if (direct) return direct;
  const encoded = Deno.env.get(jsonName);
  if (encoded) {
    try {
      const keys = JSON.parse(encoded) as Record<string, unknown>;
      if (typeof keys.default === "string") return keys.default;
    } catch {
      // Fall through.
    }
  }
  return Deno.env.get(legacyName) || "";
}

function publicFunctionUrl(slug: string) {
  const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  return `${supabaseUrl}/functions/v1/${slug}`;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const authorization = request.headers.get("Authorization");
  const token = authorization?.replace(/^Bearer\s+/i, "");
  if (!authorization || !token) return json({ error: "Autenticação necessária." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const publishableKey = readSupabaseKey(
    "SUPABASE_PUBLISHABLE_KEYS",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_ANON_KEY",
  );
  const secretKey = readSupabaseKey(
    "SUPABASE_SECRET_KEYS",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  );
  if (!supabaseUrl || !publishableKey || !secretKey) {
    return json({ error: "Supabase não configurado na função." }, 500);
  }

  const supabase = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return json({ error: "Sessão inválida." }, 401);
  const user = userData.user;

  try {
    const body = await request.json() as {
      action?: "connect" | "complete" | "revoke";
      connectionId?: string;
      itemId?: string;
    };
    const action = body.action || "connect";

    if (action === "connect") {
      let connectionId = String(body.connectionId || "");
      let providerItemId: string | null = null;
      let connectionMetadata: Record<string, unknown> = {};

      if (connectionId) {
        const { data: existing, error } = await supabase
          .from("mf_bank_connections")
          .select("id,provider,provider_connection_ref,status,metadata")
          .eq("id", connectionId)
          .eq("user_id", user.id)
          .single();
        if (error || !existing) throw new Error("Conexão não encontrada.");
        if (existing.provider !== "pluggy") throw new Error("Esta conexão usa outro provedor.");
        providerItemId = existing.provider_connection_ref || null;
        connectionMetadata = existing.metadata && typeof existing.metadata === "object"
          ? existing.metadata as Record<string, unknown>
          : {};
      } else {
        const { data: prepared, error: prepareError } = await supabase.rpc("mf_prepare_bank_connection", {
          p_provider: "pluggy",
          p_institution_id: null,
          p_institution_name: "Open Finance",
          p_scopes: ["ACCOUNTS", "CREDIT_CARDS", "TRANSACTIONS"],
        });
        if (prepareError) throw prepareError;
        connectionId = String((prepared as Record<string, unknown>)?.connection_id || "");
        if (!connectionId) throw new Error("Não foi possível preparar a conexão.");
      }

      const redirectUri = (Deno.env.get("OPEN_FINANCE_REDIRECT_URI") || "").trim();
      if (!redirectUri.startsWith("https://")) {
        throw new Error("Configure OPEN_FINANCE_REDIRECT_URI com uma URL HTTPS do MF Financeiro.");
      }

      const webhookSecret = randomSecret();
      const webhookHash = await sha256Hex(webhookSecret);
      const webhookUrl = new URL(publicFunctionUrl("open-finance-webhook"));
      webhookUrl.searchParams.set("connectionId", connectionId);
      webhookUrl.searchParams.set("token", webhookSecret);

      const connectToken = await createPluggyConnectToken({
        clientUserId: user.id,
        webhookUrl: webhookUrl.toString(),
        oauthRedirectUri: redirectUri,
        itemId: providerItemId,
      });
      const connectorIds = await listOpenFinanceConnectorIds();

      const { error: updateError } = await admin
        .from("mf_bank_connections")
        .update({
          provider: "pluggy",
          status: "authorizing",
          sync_status: "idle",
          last_error: null,
          metadata: {
            ...connectionMetadata,
            webhook_token_sha256: webhookHash,
            connect_token_created_at: new Date().toISOString(),
            open_finance_only: true,
          },
        })
        .eq("id", connectionId)
        .eq("user_id", user.id);
      if (updateError) throw updateError;

      return json({
        provider: "pluggy",
        connectionId,
        connectToken,
        connectorIds,
        updateItem: providerItemId,
      });
    }

    if (action === "complete") {
      const connectionId = String(body.connectionId || "");
      const itemId = String(body.itemId || "");
      if (!connectionId || !itemId) throw new Error("Conexão ou Item inválido.");

      const { data: connection, error: connectionError } = await supabase
        .from("mf_bank_connections")
        .select("id,user_id,provider,provider_connection_ref,metadata")
        .eq("id", connectionId)
        .eq("user_id", user.id)
        .single();
      if (connectionError || !connection) throw new Error("Conexão não encontrada.");
      if (connection.provider !== "pluggy") throw new Error("Provedor da conexão inválido.");

      const item = await getPluggyItem(itemId);
      const itemClientUserId = typeof item.clientUserId === "string" ? item.clientUserId : "";
      if (itemClientUserId && itemClientUserId !== user.id) {
        throw new Error("O Item retornado pela Pluggy não pertence a este usuário.");
      }

      const institution = await resolvePluggyInstitution(item);
      if (!institution.isOpenFinance) {
        throw new Error("A instituição selecionada não é um conector Open Finance regulado.");
      }

      const { error: updateError } = await admin
        .from("mf_bank_connections")
        .update({
          provider_connection_ref: itemId,
          institution_id: institution.connectorId ? String(institution.connectorId) : null,
          institution_name: institution.name,
          display_name: institution.name,
          status: "active",
          sync_status: "queued",
          last_error: null,
          metadata: {
            ...(connection.metadata && typeof connection.metadata === "object"
              ? connection.metadata as Record<string, unknown>
              : {}),
            completed_at: new Date().toISOString(),
            execution_status: typeof item.executionStatus === "string" ? item.executionStatus : null,
            open_finance_only: true,
          },
        })
        .eq("id", connectionId)
        .eq("user_id", user.id);
      if (updateError) throw updateError;

      return json({
        provider: "pluggy",
        connectionId,
        itemId,
        institution: institution.name,
        status: "active",
      });
    }

    if (action === "revoke") {
      const connectionId = String(body.connectionId || "");
      if (!connectionId) throw new Error("Identificador da conexão inválido.");

      const { data: connection, error: connectionError } = await supabase
        .from("mf_bank_connections")
        .select("id,user_id,provider,provider_connection_ref,status,metadata")
        .eq("id", connectionId)
        .eq("user_id", user.id)
        .single();
      if (connectionError || !connection) throw new Error("Conexão não encontrada.");
      if (connection.provider !== "pluggy") throw new Error("Provedor da conexão inválido.");

      if (connection.status === "revoked") {
        return json({ connectionId, status: "revoked", alreadyRevoked: true });
      }

      const providerItemId = String(connection.provider_connection_ref || "");
      if (providerItemId) await deletePluggyItem(providerItemId);

      const revokedAt = new Date().toISOString();
      const { error: updateError } = await admin
        .from("mf_bank_connections")
        .update({
          status: "revoked",
          sync_status: "idle",
          next_sync_at: null,
          last_error: null,
          metadata: {
            ...(connection.metadata && typeof connection.metadata === "object"
              ? connection.metadata as Record<string, unknown>
              : {}),
            revoked_at: revokedAt,
            revoked_via: "mf_financeiro",
            open_finance_only: true,
          },
        })
        .eq("id", connectionId)
        .eq("user_id", user.id);
      if (updateError) throw updateError;

      await admin
        .from("mf_bank_account_links")
        .update({ status: "disconnected" })
        .eq("connection_id", connectionId)
        .eq("user_id", user.id);

      return json({ connectionId, status: "revoked", alreadyRevoked: false });
    }

    throw new Error("Ação Open Finance inválida.");
  } catch (error) {
    console.error("open-finance-session", error);
    return json({ error: error instanceof Error ? error.message : "Falha no Open Finance." }, 400);
  }
});
