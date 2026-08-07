import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import {
  getPluggyItem,
  itemIsReady,
  resolvePluggyInstitution,
  sha256Hex,
  syncPluggyConnection,
  type OpenFinanceConnectionRow,
} from "../_shared/open-finance-pluggy.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function readSecretKey() {
  const direct = Deno.env.get("SUPABASE_SECRET_KEY");
  if (direct) return direct;
  const encoded = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (encoded) {
    try {
      const keys = JSON.parse(encoded) as Record<string, unknown>;
      if (typeof keys.default === "string") return keys.default;
    } catch {
      // Fall through.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

function schedule(task: Promise<unknown>) {
  if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
    EdgeRuntime.waitUntil(task);
    return;
  }
  void task.catch((error) => console.error("Open Finance background task", error));
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const url = new URL(request.url);
  const connectionId = url.searchParams.get("connectionId") || "";
  const webhookToken = url.searchParams.get("token") || "";
  if (!connectionId || !webhookToken) return json({ error: "Webhook inválido." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const secretKey = readSecretKey();
  if (!supabaseUrl || !secretKey) return json({ error: "Servidor não configurado." }, 500);

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let eventDbId: string | null = null;

  try {
    const { data: connection, error: connectionError } = await admin
      .from("mf_bank_connections")
      .select("id,user_id,provider,provider_connection_ref,institution_id,institution_name,status,sync_status,metadata")
      .eq("id", connectionId)
      .eq("provider", "pluggy")
      .single();
    if (connectionError || !connection) return json({ error: "Conexão não encontrada." }, 404);

    const metadata = record(connection.metadata);
    const expectedHash = text(metadata.webhook_token_sha256);
    const receivedHash = await sha256Hex(webhookToken);
    if (!expectedHash || !constantTimeEqual(expectedHash, receivedHash)) {
      return json({ error: "Assinatura do webhook inválida." }, 401);
    }

    const payload = record(await request.json());
    const eventName = text(payload.event);
    const eventId = text(payload.eventId);
    const itemId = text(payload.itemId || payload.id);
    const clientUserId = text(payload.clientUserId);
    if (!eventName || !eventId) return json({ error: "Evento inválido." }, 400);
    if (clientUserId && clientUserId !== connection.user_id) {
      return json({ error: "Usuário do evento não corresponde à conexão." }, 403);
    }

    const safePayload = {
      event: eventName,
      eventId,
      itemId: itemId || null,
      accountId: text(payload.accountId) || null,
      transactionIds: Array.isArray(payload.transactionIds)
        ? payload.transactionIds.filter((value) => typeof value === "string").slice(0, 500)
        : [],
      triggeredBy: text(payload.triggeredBy) || null,
      clientUserId: clientUserId || null,
    };

    const { data: inserted, error: eventError } = await admin
      .from("mf_bank_webhook_events")
      .insert({
        provider: "pluggy",
        event_id: eventId,
        connection_id: connection.id,
        user_id: connection.user_id,
        event_name: eventName,
        payload: safePayload,
        status: "accepted",
      })
      .select("id")
      .single();

    if (eventError) {
      if (eventError.code === "23505") return json({ ok: true, duplicate: true });
      throw eventError;
    }
    eventDbId = inserted?.id || null;

    if (itemId && connection.provider_connection_ref && itemId !== connection.provider_connection_ref) {
      throw new Error("O Item do webhook não corresponde à conexão registrada.");
    }

    if (eventName === "item/deleted") {
      await admin.from("mf_bank_connections").update({
        status: "revoked",
        sync_status: "idle",
        next_sync_at: null,
        last_error: null,
      }).eq("id", connection.id);
      await admin.from("mf_bank_account_links").update({ status: "disconnected" }).eq("connection_id", connection.id);
    } else if (eventName === "item/error") {
      const errorData = record(payload.error);
      const message = text(errorData.message) || text(payload.error) || "A instituição informou erro na conexão.";
      await admin.from("mf_bank_connections").update({
        status: "error",
        sync_status: "error",
        last_error: message.slice(0, 1000),
      }).eq("id", connection.id);
    } else if (eventName.startsWith("item/") && itemId) {
      const item = await getPluggyItem(itemId);
      const itemClientUserId = text(item.clientUserId);
      if (itemClientUserId && itemClientUserId !== connection.user_id) {
        throw new Error("O Item informado no webhook não pertence ao usuário.");
      }
      const institution = await resolvePluggyInstitution(item);
      if (!institution.isOpenFinance) throw new Error("O Item não usa um conector Open Finance.");

      await admin.from("mf_bank_connections").update({
        provider_connection_ref: itemId,
        institution_id: institution.connectorId ? String(institution.connectorId) : null,
        institution_name: institution.name,
        display_name: institution.name,
        status: itemIsReady(item) ? "active" : "authorizing",
        sync_status: itemIsReady(item) ? "queued" : "idle",
        last_error: null,
        metadata: {
          ...metadata,
          last_webhook_event: eventName,
          last_execution_status: text(item.executionStatus) || null,
        },
      }).eq("id", connection.id);

      if (itemIsReady(item)) {
        schedule(syncPluggyConnection(
          admin,
          {
            ...connection,
            provider_connection_ref: itemId,
            institution_id: institution.connectorId ? String(institution.connectorId) : null,
            institution_name: institution.name,
            status: "active",
          } as OpenFinanceConnectionRow,
          eventName === "item/created" ? "initial" : "webhook",
        ));
      }
    } else if (eventName === "transactions/deleted") {
      const refs = Array.isArray(payload.transactionIds)
        ? payload.transactionIds.filter((value): value is string => typeof value === "string").slice(0, 500)
        : [];
      if (refs.length > 0) {
        const { error } = await admin.rpc("mf_mark_open_finance_transactions_deleted", {
          p_connection_id: connection.id,
          p_provider_refs: refs,
        });
        if (error) throw error;
      }
    } else if (eventName === "transactions/created" || eventName === "transactions/updated") {
      if (connection.provider_connection_ref) {
        schedule(syncPluggyConnection(admin, connection as OpenFinanceConnectionRow, "webhook"));
      }
    }

    if (eventDbId) {
      await admin.from("mf_bank_webhook_events").update({
        status: "processed",
        processed_at: new Date().toISOString(),
      }).eq("id", eventDbId);
    }

    return json({ ok: true });
  } catch (error) {
    console.error("open-finance-webhook", error);
    if (eventDbId) {
      await admin.from("mf_bank_webhook_events").update({
        status: "failed",
        error_message: error instanceof Error ? error.message.slice(0, 1000) : "Falha no webhook.",
        processed_at: new Date().toISOString(),
      }).eq("id", eventDbId);
    }
    return json({ error: error instanceof Error ? error.message : "Falha no webhook." }, 400);
  }
});
