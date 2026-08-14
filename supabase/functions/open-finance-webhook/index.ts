import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { createApiKey, fetchItem } from "../_shared/pluggy.ts";
import { reportMfAdminServiceEvent } from "../_shared/mf-admin-telemetry.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function env(name: string) { return Deno.env.get(name)?.trim() || ""; }
function isUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const expectedSecret = env("OPEN_FINANCE_WEBHOOK_SECRET");
  const suppliedSecret = new URL(request.url).searchParams.get("token") || request.headers.get("x-open-finance-webhook-secret") || "";
  // Do not emit telemetry for unauthorized public requests: that would allow an
  // attacker to generate diagnostic noise intentionally.
  if (!expectedSecret || suppliedSecret !== expectedSecret) return json({ error: "Webhook não autorizado." }, 401);

  const correlationId = crypto.randomUUID();
  const startedAt = Date.now();
  const supabaseUrl = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
  const internalSecret = env("OPEN_FINANCE_INTERNAL_SECRET");
  if (!supabaseUrl || !serviceKey || !internalSecret) {
    reportMfAdminServiceEvent({
      module: 'open_finance.webhook', operation: 'bootstrap', errorCode: 'OPEN_FINANCE_WEBHOOK_UNCONFIGURED',
      message: 'Webhook Open Finance sem configuração de backend', category: 'infrastructure', severity: 'critical', correlationId,
    });
    return json({ error: "Webhook não configurado." }, 500);
  }

  let diagnosticUserId: string | null = null;
  let event = '';
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
    event = String(payload.event || "").slice(0, 100);
    const itemId = String(payload.itemId || "").trim();
    if (!itemId) return json({ accepted: true, ignored: "missing-item" }, 202);

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    let { data: connection } = await admin
      .from("mf_bank_connections")
      .select("id,user_id,status")
      .eq("provider", "pluggy")
      .eq("provider_connection_ref", itemId)
      .maybeSingle();
    diagnosticUserId = connection?.user_id || null;

    // The browser callback is not the source of truth. Connect Token stores our
    // Supabase user id as clientUserId, so a signed provider webhook can recover
    // ownership server-side even if the user closed the widget.
    if (!connection && event !== "item/deleted") {
      try {
        const apiKey = await createApiKey();
        const item = await fetchItem(apiKey, itemId);
        const userId = String(item.clientUserId || "").trim();
        if (isUuid(userId)) {
          const { data: authUser, error: authUserError } = await admin.auth.admin.getUserById(userId);
          if (!authUserError && authUser.user) {
            diagnosticUserId = userId;
            const connectorId = item.connector?.id == null ? null : String(item.connector.id);
            const institutionName = String(item.connector?.name || "Instituição Open Finance").trim();
            const { data: inserted, error: insertError } = await admin
              .from("mf_bank_connections")
              .insert({
                user_id: userId,
                provider: "pluggy",
                provider_connection_ref: itemId,
                institution_id: connectorId,
                institution_name: institutionName,
                display_name: institutionName,
                status: event === "item/error" ? "error" : "active",
                sync_status: event === "item/error" ? "error" : "idle",
                scopes: ["ACCOUNTS_READ", "TRANSACTIONS_READ"],
                last_error: event === "item/error" ? "O provedor informou erro na conexão." : null,
                metadata: {
                  provider: "pluggy",
                  auto_bound_by_webhook: true,
                  ownership_verified: true,
                  pluggy_execution_status: item.executionStatus || null,
                  pluggy_status: item.status || null,
                  bound_at: new Date().toISOString(),
                },
              })
              .select("id,user_id,status")
              .single();

            if (!insertError && inserted) {
              connection = inserted;
            } else {
              const { data: racedConnection } = await admin
                .from("mf_bank_connections")
                .select("id,user_id,status")
                .eq("provider", "pluggy")
                .eq("provider_connection_ref", itemId)
                .maybeSingle();
              if (racedConnection) connection = racedConnection;
            }
          }
        }
      } catch {
        reportMfAdminServiceEvent({
          module: 'open_finance.webhook', operation: 'auto_bind', errorCode: 'OPEN_FINANCE_WEBHOOK_BIND_FAILED',
          message: 'Webhook não conseguiu vincular conexão Open Finance', category: 'integration', severity: 'high',
          correlationId, userId: diagnosticUserId, durationMs: Date.now() - startedAt,
        });
      }
    }

    if (!connection) {
      return json({ accepted: true, event, deferred: true }, 202);
    }
    diagnosticUserId = connection.user_id;

    if (event === "item/error") {
      await admin.from("mf_bank_connections").update({
        status: "error",
        sync_status: "error",
        last_error: "O provedor informou erro na conexão.",
      }).eq("id", connection.id);
      reportMfAdminServiceEvent({
        module: 'open_finance.webhook', operation: 'item_error', errorCode: 'OPEN_FINANCE_PROVIDER_ITEM_ERROR',
        message: 'Provedor informou erro no Item Open Finance', category: 'integration', severity: 'high',
        impact: 'partial_operation', correlationId, userId: connection.user_id,
      });
      return json({ accepted: true, event, connectionId: connection.id });
    }

    if (event === "item/deleted") {
      await admin.from("mf_bank_connections")
        .update({ status: "revoked", sync_status: "idle", next_sync_at: null, last_error: null })
        .eq("id", connection.id);
      await admin.from("mf_financial_accounts")
        .update({ is_active: false })
        .eq("user_id", connection.user_id)
        .eq("bank_connection_id", connection.id)
        .eq("provider", "pluggy");
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

    const deletedTransactionIds = event === 'transactions/deleted' && Array.isArray(payload.transactionIds)
      ? payload.transactionIds.map(String).filter(Boolean).slice(0, 2_000)
      : [];

    const syncResponse = await fetch(`${supabaseUrl}/functions/v1/open-finance-sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-open-finance-internal-secret": internalSecret,
      },
      body: JSON.stringify({
        itemId,
        triggerSource: "webhook",
        providerEvent: event,
        deletedTransactionIds,
      }),
    });
    await syncResponse.json().catch(() => ({}));
    if (!syncResponse.ok) {
      const safeFailure = `Sincronização Open Finance falhou (HTTP ${syncResponse.status}).`;
      await admin.from("mf_bank_connections")
        .update({ sync_status: "error", last_error: safeFailure })
        .eq("id", connection.id);
      reportMfAdminServiceEvent({
        module: 'open_finance.webhook', operation: 'dispatch_sync', errorCode: 'OPEN_FINANCE_WEBHOOK_SYNC_FAILED',
        message: 'Webhook não conseguiu concluir sincronização Open Finance', category: 'integration', severity: 'high',
        impact: 'partial_operation', correlationId, userId: connection.user_id, durationMs: Date.now() - startedAt,
        context: { provider_status: syncResponse.status },
      });
      return json({ accepted: true, event, connectionId: connection.id, syncQueued: false }, 202);
    }

    return json({ accepted: true, event, connectionId: connection.id, syncQueued: true });
  } catch {
    reportMfAdminServiceEvent({
      module: 'open_finance.webhook', operation: event || 'process', errorCode: 'OPEN_FINANCE_WEBHOOK_FAILED',
      message: 'Processamento de webhook Open Finance falhou', category: 'integration', severity: 'high',
      impact: 'partial_operation', correlationId, userId: diagnosticUserId, durationMs: Date.now() - startedAt,
    });
    return json({ error: "Falha ao processar webhook." }, 400);
  }
});
