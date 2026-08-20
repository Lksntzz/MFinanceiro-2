import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type AdminProfile = {
  id: string;
  role: "admin" | "viewer" | string;
  mfa_required: boolean;
};

type AccessRequestRow = {
  id: string;
  nome: string | null;
  email: string;
  status: string;
  observacao: string | null;
  aprovado_em: string | null;
  created_at: string;
  updated_at: string;
  decision_admin_id?: string | null;
  decision_correlation_id?: string | null;
  decision_source?: string | null;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-mf-access-approval-control-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function safeEqual(left: string, right: string) {
  if (!left || !right || left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
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

function isUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function normalizeDecision(value: unknown): "approved" | "denied" | null {
  const decision = String(value || "").trim().toLowerCase();
  return decision === "approved" || decision === "denied" ? decision : null;
}

function normalizeStatus(value: unknown) {
  const status = String(value || "").trim().toLowerCase();
  if (status === "approved" || status === "aprovado") return "approved";
  if (status === "denied" || status === "negado" || status === "rejected") return "denied";
  return "pending";
}

function sanitizeText(value: unknown, maxLength: number) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

async function verifyAdminIdentity(token: string) {
  const adminUrl = (Deno.env.get("MF_ADMIN_SUPABASE_URL") || "").replace(/\/$/, "");
  const adminKey = Deno.env.get("MF_ADMIN_PUBLISHABLE_KEY") || "";
  if (!adminUrl || !adminKey) return null;

  const userResponse = await fetch(`${adminUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: adminKey },
  });
  if (!userResponse.ok) return null;

  const user = await userResponse.json() as { id?: string };
  if (!user.id) return null;

  const profileResponse = await fetch(
    `${adminUrl}/rest/v1/admin_users?id=eq.${encodeURIComponent(user.id)}&select=id,role,mfa_required&limit=1`,
    { headers: { Authorization: `Bearer ${token}`, apikey: adminKey, Accept: "application/json" } },
  );
  if (!profileResponse.ok) return null;

  const profiles = await profileResponse.json() as AdminProfile[];
  const profile = profiles[0];
  if (!profile || profile.id !== user.id || !["admin", "viewer"].includes(String(profile.role))) return null;

  const claims = decodeJwtPayload(token);
  return {
    userId: user.id,
    role: String(profile.role),
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

async function listRequests(supabaseUrl: string, serviceRole: string) {
  const select = [
    "id",
    "nome",
    "email",
    "status",
    "observacao",
    "aprovado_em",
    "created_at",
    "updated_at",
    "decision_admin_id",
    "decision_correlation_id",
    "decision_source",
  ].join(",");
  const response = await fetch(
    `${supabaseUrl}/rest/v1/mf_access_requests?select=${encodeURIComponent(select)}&order=updated_at.desc&limit=500`,
    { headers: financeHeaders(serviceRole) },
  );
  if (!response.ok) throw new Error(`Falha ao listar solicitações (${response.status}).`);
  return response.json() as Promise<AccessRequestRow[]>;
}

async function getRequest(supabaseUrl: string, serviceRole: string, requestId: string) {
  const rows = await listRequests(supabaseUrl, serviceRole);
  return rows.find((row) => row.id === requestId) || null;
}

async function decideRequest(
  supabaseUrl: string,
  serviceRole: string,
  requestId: string,
  decision: "approved" | "denied",
  reason: string,
  adminUserId: string,
  correlationId: string,
) {
  const current = await getRequest(supabaseUrl, serviceRole, requestId);
  if (!current) return { status: 404, body: { error: "Solicitação não encontrada." } };
  if (normalizeStatus(current.status) !== "pending") {
    return { status: 409, body: { error: "A solicitação já possui decisão.", request: current } };
  }

  const nextStatus = decision === "approved" ? "aprovado" : "negado";
  const payload = {
    status: nextStatus,
    observacao: reason || null,
    aprovado_por: null,
    aprovado_em: new Date().toISOString(),
    decision_admin_id: adminUserId,
    decision_correlation_id: correlationId,
    decision_source: "mf_administracao",
  };

  const response = await fetch(
    `${supabaseUrl}/rest/v1/mf_access_requests?id=eq.${encodeURIComponent(requestId)}&status=in.(pending,pendente)&select=*`,
    {
      method: "PATCH",
      headers: { ...financeHeaders(serviceRole), Prefer: "return=representation" },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Falha ao registrar decisão (${response.status}): ${detail}`);
  }

  const rows = await response.json() as AccessRequestRow[];
  const updated = rows[0];
  if (!updated) {
    const latest = await getRequest(supabaseUrl, serviceRole, requestId);
    return { status: 409, body: { error: "A solicitação foi alterada por outra operação.", request: latest } };
  }
  return { status: 200, body: { request: updated } };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const expectedControlSecret =
    Deno.env.get("MF_ACCESS_APPROVAL_CONTROL_SECRET")
    || Deno.env.get("MF_MAINTENANCE_CONTROL_SECRET")
    || Deno.env.get("MF_ADMIN_SERVICE_INGEST_SECRET")
    || "";
  if (!expectedControlSecret) return json({ error: "Canal de aprovação administrativa não configurado." }, 503);

  const suppliedControlSecret = request.headers.get("x-mf-access-approval-control-secret") || "";
  if (!safeEqual(suppliedControlSecret, expectedControlSecret)) {
    return json({ error: "Canal de controle não autorizado." }, 401);
  }

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

  const action = String(body.action || "list").toLowerCase();

  try {
    if (action === "list") {
      return json({ requests: await listRequests(supabaseUrl, serviceRole), access: { role: identity.role, aal: identity.aal } });
    }

    if (action === "get") {
      const requestId = String(body.request_id || "");
      if (!isUuid(requestId)) return json({ error: "request_id inválido." }, 400);
      const row = await getRequest(supabaseUrl, serviceRole, requestId);
      if (!row) return json({ error: "Solicitação não encontrada." }, 404);
      return json({ request: row, access: { role: identity.role, aal: identity.aal } });
    }

    if (action !== "decide") return json({ error: "Ação inválida." }, 400);
    if (identity.role !== "admin") return json({ error: "Somente administradores podem aprovar ou negar usuários." }, 403);
    if (identity.aal !== "aal2") return json({ error: "A decisão exige uma sessão administrativa AAL2/MFA." }, 403);

    const requestId = String(body.request_id || "");
    const correlationId = String(body.correlation_id || "");
    if (!isUuid(requestId) || !isUuid(correlationId)) {
      return json({ error: "request_id e correlation_id devem ser UUIDs válidos." }, 400);
    }

    const decision = normalizeDecision(body.decision);
    if (!decision) return json({ error: "Decisão inválida. Use approved ou denied." }, 400);

    const reason = sanitizeText(body.reason, 500);
    if (reason.length < 4) return json({ error: "Informe uma justificativa com pelo menos 4 caracteres." }, 400);

    const result = await decideRequest(
      supabaseUrl,
      serviceRole,
      requestId,
      decision,
      reason,
      identity.userId,
      correlationId,
    );
    return json(result.body, result.status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha inesperada no controle de aprovação.";
    return json({ error: message }, 500);
  }
});
