import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { syncPluggyConnection, type OpenFinanceConnectionRow } from "../_shared/open-finance-pluggy.ts";

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

  try {
    const body = await request.json() as { connectionId?: string; triggerSource?: "manual" | "retry" };
    const connectionId = String(body.connectionId || "");
    if (!connectionId) throw new Error("Informe a conexão.");

    const { data: connection, error: connectionError } = await supabase
      .from("mf_bank_connections")
      .select("id,user_id,provider,provider_connection_ref,institution_id,institution_name,status,sync_status,metadata")
      .eq("id", connectionId)
      .eq("user_id", userData.user.id)
      .single();
    if (connectionError || !connection) throw new Error("Conexão não encontrada.");
    if (connection.provider !== "pluggy") throw new Error("Esta conexão usa outro provedor.");
    if (["revoked", "revocation_pending"].includes(connection.status)) {
      throw new Error("O consentimento desta conexão foi revogado.");
    }
    if (!connection.provider_connection_ref) {
      throw new Error("Finalize a autorização da instituição antes de sincronizar.");
    }
    if (connection.sync_status === "syncing") {
      return json({ connectionId, status: "syncing", alreadyRunning: true }, 202);
    }

    const result = await syncPluggyConnection(
      admin,
      connection as OpenFinanceConnectionRow,
      body.triggerSource === "retry" ? "retry" : "manual",
    );
    return json({ connectionId, ...result });
  } catch (error) {
    console.error("open-finance-sync", error);
    return json({ error: error instanceof Error ? error.message : "Falha ao sincronizar Open Finance." }, 400);
  }
});
