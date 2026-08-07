import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

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
      // Fall through to the legacy environment variable.
    }
  }
  return Deno.env.get(legacyName) || "";
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
  const providerApiUrl = Deno.env.get("OPEN_FINANCE_CONNECT_API_URL") || "";
  const providerApiKey = Deno.env.get("OPEN_FINANCE_PROVIDER_API_KEY") || "";
  const providerName = Deno.env.get("OPEN_FINANCE_PROVIDER") || "aggregator";
  const redirectUri = Deno.env.get("OPEN_FINANCE_REDIRECT_URI") || "";
  if (!supabaseUrl || !publishableKey) return json({ error: "Supabase não configurado na função." }, 500);

  const supabase = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return json({ error: "Sessão inválida." }, 401);

  try {
    const body = await request.json() as {
      action?: "connect" | "revoke";
      connectionId?: string;
      institutionId?: string;
      institutionName?: string;
      scopes?: string[];
    };
    const action = body.action || "connect";
    if (action !== "connect" && action !== "revoke") throw new Error("Ação Open Finance inválida.");
    if (action === "revoke") {
      const connectionId = String(body.connectionId || "");
      if (!/^[0-9a-f-]{36}$/i.test(connectionId)) throw new Error("Identificador da conexão inválido.");
      if (!secretKey) throw new Error("Atualização segura do Open Finance não configurada no servidor.");

      const { data: connection, error: connectionError } = await supabase
        .from("mf_bank_connections")
        .select("id,status")
        .eq("id", connectionId)
        .eq("user_id", userData.user.id)
        .single();
      if (connectionError || !connection) throw new Error("Conexão não encontrada.");
      if (["revoked", "revocation_pending"].includes(connection.status)) {
        return json({ connectionId, status: connection.status, alreadyRequested: true });
      }

      const supabaseAdmin = createClient(supabaseUrl, secretKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: updated, error: updateError } = await supabaseAdmin
        .from("mf_bank_connections")
        .update({ status: "revocation_pending", sync_status: "idle" })
        .eq("id", connectionId)
        .eq("user_id", userData.user.id)
        .select("id")
        .single();
      if (updateError || !updated) throw new Error("Não foi possível registrar a revogação.");
      return json({ connectionId, status: "revocation_pending", alreadyRequested: false });
    }

    const institutionName = String(body.institutionName || "").trim();
    if (institutionName.length < 2) throw new Error("Selecione uma instituição válida.");

    const { data: prepared, error: prepareError } = await supabase.rpc("mf_prepare_bank_connection", {
      p_provider: providerName,
      p_institution_id: String(body.institutionId || "").trim() || null,
      p_institution_name: institutionName,
      p_scopes: Array.isArray(body.scopes) && body.scopes.length
        ? body.scopes
        : ["ACCOUNTS_READ", "RESOURCES_READ"],
    });
    if (prepareError) throw prepareError;
    const connectionId = String((prepared as Record<string, unknown>)?.connection_id || "");
    if (!connectionId) throw new Error("Não foi possível preparar a conexão.");

    if (!providerApiUrl || !providerApiKey || !redirectUri) {
      return json({
        connectionId,
        status: "pending",
        configured: false,
        message: "A base está pronta; falta configurar o participante/agregador Open Finance no servidor.",
      }, 202);
    }
    if (!secretKey) throw new Error("Atualização segura do Open Finance não configurada no servidor.");

    const providerResponse = await fetch(providerApiUrl, {
      method: "POST",
      headers: { "Authorization": `Bearer ${providerApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        customerReference: userData.user.id,
        connectionReference: connectionId,
        institutionId: body.institutionId || null,
        institutionName,
        scopes: body.scopes || ["ACCOUNTS_READ", "RESOURCES_READ"],
        redirectUri,
      }),
    });
    if (!providerResponse.ok) throw new Error(`O provedor Open Finance recusou a sessão (${providerResponse.status}).`);
    const providerPayload = await providerResponse.json() as Record<string, unknown>;
    const authorizationUrl = String(providerPayload.authorization_url || providerPayload.connect_url || "");
    const providerReference = String(providerPayload.connection_id || providerPayload.id || "");
    if (!authorizationUrl.startsWith("https://")) throw new Error("O provedor não retornou uma URL segura de autorização.");

    const supabaseAdmin = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("mf_bank_connections")
      .update({
        status: "authorizing",
        provider_connection_ref: providerReference || null,
        metadata: { session_created_at: new Date().toISOString() },
      })
      .eq("id", connectionId)
      .eq("user_id", userData.user.id)
      .eq("status", "pending")
      .select("id")
      .single();
    if (updateError || !updated) throw new Error("Não foi possível registrar a autorização do provedor.");

    return json({ connectionId, status: "authorizing", configured: true, authorizationUrl });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Falha ao preparar o Open Finance." }, 400);
  }
});
