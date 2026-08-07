import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function env(name: string) { return Deno.env.get(name)?.trim() || ""; }

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const expectedSecret = env("OPEN_FINANCE_WEBHOOK_SECRET");
  const suppliedSecret = new URL(request.url).searchParams.get("token") || request.headers.get("x-open-finance-webhook-secret") || "";
  if (!expectedSecret || suppliedSecret !== expectedSecret) return json({ error: "Webhook não autorizado." }, 401);

  const supabaseUrl = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
  const internalSecret = env("OPEN_FINANCE_INTERNAL_SECRET");
  if (!supabaseUrl || !serviceKey || !internalSecret) return json({ error: "Webhook não configurado." }, 500);

  try {
    const payload = await request.json() as {
      event?: string;
      eventId?: string;
      itemId?: string;
      accountId?: string;
      transactionIds?: string[];
      createdTransactionsLink?: string;
      error?: unknown;
    };
    const event = String(payload.event || "");
    const itemId = String(payload.itemId || "");
    if (!itemId) return json({ accepted: true, ignored: "missing-item" }, 202);

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: connection } = await admin
      .from("mf_bank_connections")
      .select("id,user_id,status")
      .eq("provider", "pluggy")
      .eq("provider_connection_ref", itemId)
      .maybeSingle();

    if (!connection) {
      return json({ accepted: true, event, itemId, deferred: true }, 202);
    }

    if (event === "item/error") {
      await admin.from("mf_bank_connections").update({
        status: "error",
        sync_status: "error",
        last_error: JSON.stringify(payload.error || "Erro informado pelo Pluggy").slice(0, 1000),
      }).eq("id", connection.id);
      return json({ accepted: true, event, connectionId: connection.id });
    }

    if (event === "item/deleted") {
      await admin.from("mf_bank_connections").update({ status: "revoked", sync_status: "idle", next_sync_at: null }).eq("id", connection.id);
      return json({ accepted: true, event, connectionId: connection.id });
    }

    const syncEvents = new Set([
      "item/created",
      "item/updated",
      "transactions/created",
      "transactions/updated",
      "transactions/deleted",
    ]);
    if (!syncEvents.has(event)) return json({ accepted: true, event, ignored: true });

    const syncResponse = await fetch(`${supabaseUrl}/functions/v1/open-finance-sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-open-finance-internal-secret": internalSecret,
      },
      body: JSON.stringify({ itemId, triggerSource: `pluggy:${event}` }),
    });
    const syncPayload = await syncResponse.json().catch(() => ({}));
    if (!syncResponse.ok) {
      await admin.from("mf_bank_connections").update({ sync_status: "error", last_error: JSON.stringify(syncPayload).slice(0, 1000) }).eq("id", connection.id);
      return json({ accepted: true, event, syncQueued: false, syncError: syncPayload }, 202);
    }

    return json({ accepted: true, event, connectionId: connection.id, sync: syncPayload });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Falha ao processar webhook." }, 400);
  }
});
