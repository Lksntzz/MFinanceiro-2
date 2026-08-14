import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type MaintenanceScope = "mobile" | "desktop" | "both";
type MaintenanceAction = "get" | "set";

type MaintenanceRow = {
  key: string;
  maintenance_mode: boolean;
  maintenance_message: string;
  updated_at: string;
};

type AdminProfile = {
  id: string;
  role: "admin" | "viewer" | string;
  mfa_required: boolean;
};

const DEFAULT_ADMIN_URL = "https://lyhsttditfrxmfnnligk.supabase.co";
const DEFAULT_ADMIN_PUBLISHABLE_KEY = "sb_publishable_WzbybFQdgY1O8-PeKrlYNw_0cv1euNa";
const DEFAULT_MESSAGE = "Estamos realizando melhorias importantes. O MF Financeiro estará disponível novamente em breve.";

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

function bearerToken(request: Request) {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const encoded = token.split(".")[1] || "";
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded));
  } catch {
    return {};
  }
}

function normalizeScope(value: unknown): MaintenanceScope | null {
  const scope = String(value || "").trim().toLowerCase();
  return scope === "mobile" || scope === "desktop" || scope === "both" ? scope : null;
}

function safeMessage(value: unknown) {
  const message = String(value || "").trim();
  return (message || DEFAULT_MESSAGE).slice(0, 240);
}

async function verifyAdminIdentity(token: string) {
  const adminUrl = (Deno.env.get("MF_ADMIN_SUPABASE_URL") || DEFAULT_ADMIN_URL).replace(/\/$/, "");
  const adminKey = Deno.env.get("MF_ADMIN_PUBLISHABLE_KEY") || DEFAULT_ADMIN_PUBLISHABLE_KEY;

  const userResponse = await fetch(`${adminUrl}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: adminKey,
    },
  });
  if (!userResponse.ok) return null;

  const user = await userResponse.json() as { id?: string };
  if (!user.id) return null;

  const profileResponse = await fetch(
    `${adminUrl}/rest/v1/admin_users?id=eq.${encodeURIComponent(user.id)}&select=id,role,mfa_required&limit=1`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: adminKey,
        Accept: "application/json",
      },
    },
  );
  if (!profileResponse.ok) return null;

  const profiles = await profileResponse.json() as AdminProfile[];
  const profile = profiles[0];
  if (!profile || profile.id !== user.id || !["admin", "viewer"].includes(String(profile.role))) return null;

  const claims = decodeJwtPayload(token);
  return {
    userId: user.id,
    role: String(profile.role),
    mfaRequired: profile.mfa_required === true,
    aal: String(claims.aal || "aal1"),
  };
}

function financeHeaders(serviceRole: string) {
  return {
    Authorization: `Bearer ${serviceRole}`,
    apikey: serviceRole,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function readMaintenanceState(supabaseUrl: string, serviceRole: string) {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/mf_global_settings?key=in.(global,mobile,desktop)&select=key,maintenance_mode,maintenance_message,updated_at&order=key.asc`,
    { headers: financeHeaders(serviceRole) },
  );

  if (!response.ok) {
    throw new Error(`Falha ao consultar o estado de manutenção (${response.status}).`);
  }

  const rows = await response.json() as MaintenanceRow[];
  const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));
  return {
    global: byKey.global || null,
    mobile: byKey.mobile || byKey.global || null,
    desktop: byKey.desktop || byKey.global || null,
  };
}

async function setMaintenanceState(
  supabaseUrl: string,
  serviceRole: string,
  scope: MaintenanceScope,
  enabled: boolean,
  message: string,
) {
  const timestamp = new Date().toISOString();
  const keys = scope === "both" ? ["mobile", "desktop"] : [scope];
  const payload = keys.map((key) => ({
    key,
    maintenance_mode: enabled,
    maintenance_message: message,
    updated_at: timestamp,
  }));

  const response = await fetch(
    `${supabaseUrl}/rest/v1/mf_global_settings?on_conflict=key`,
    {
      method: "POST",
      headers: {
        ...financeHeaders(serviceRole),
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Falha ao persistir manutenção (${response.status}): ${detail}`);
  }

  return readMaintenanceState(supabaseUrl, serviceRole);
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const token = bearerToken(request);
  if (!token) return json({ error: "Autenticação administrativa necessária." }, 401);

  const identity = await verifyAdminIdentity(token);
  if (!identity) return json({ error: "Sessão do MF Administração inválida ou não autorizada." }, 403);

  const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRole) return json({ error: "Backend financeiro não configurado." }, 500);

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: "Payload JSON inválido." }, 400);
  }

  const action = String(body.action || "get") as MaintenanceAction;

  try {
    if (action === "get") {
      return json({
        state: await readMaintenanceState(supabaseUrl, serviceRole),
        access: { role: identity.role, aal: identity.aal },
      });
    }

    if (action !== "set") return json({ error: "Ação inválida." }, 400);
    if (identity.role !== "admin") return json({ error: "Somente administradores podem alterar a manutenção." }, 403);
    if (identity.aal !== "aal2") return json({ error: "A operação exige uma sessão administrativa AAL2/MFA." }, 403);

    const scope = normalizeScope(body.scope);
    if (!scope) return json({ error: "Escopo inválido. Use mobile, desktop ou both." }, 400);

    const enabled = body.enabled === true;
    const message = safeMessage(body.message);
    if (enabled && message.length < 10) {
      return json({ error: "Informe uma mensagem de manutenção com pelo menos 10 caracteres." }, 400);
    }

    const state = await setMaintenanceState(supabaseUrl, serviceRole, scope, enabled, message);
    return json({ state, changed: { scope, enabled } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha inesperada no controle de manutenção.";
    return json({ error: message }, 500);
  }
});
