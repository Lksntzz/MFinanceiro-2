import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.103.0";

type AuthState = "account" | "pending" | "approved" | "denied" | "new";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function normalizeRequestStatus(value: unknown): Exclude<AuthState, "account" | "new"> | "none" {
  const status = String(value || "").trim().toLowerCase();
  if (status === "approved" || status === "aprovado") return "approved";
  if (status === "denied" || status === "negado" || status === "rejected") return "denied";
  if (status === "pending" || status === "pendente") return "pending";
  return "none";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let payload: { email?: unknown } = {};
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const email = normalizeEmail(payload.email);
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "invalid_email" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "server_not_configured" }, 503);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    let accountExists = false;
    for (let page = 1; page <= 50; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw error;
      const users = data?.users || [];
      if (users.some((user) => normalizeEmail(user.email) === email)) {
        accountExists = true;
        break;
      }
      if (users.length < 1000) break;
    }

    if (accountExists) return json({ state: "account" satisfies AuthState });

    const { data, error } = await admin.rpc("check_access_request_status", { p_email: email });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    const requestStatus = normalizeRequestStatus(row?.status);

    if (requestStatus === "approved") return json({ state: "approved" satisfies AuthState });
    if (requestStatus === "pending") return json({ state: "pending" satisfies AuthState });
    if (requestStatus === "denied") return json({ state: "denied" satisfies AuthState });
    return json({ state: "new" satisfies AuthState });
  } catch (error) {
    console.error("resolve-auth-state failed", error);
    return json({ error: "lookup_failed" }, 503);
  }
});
