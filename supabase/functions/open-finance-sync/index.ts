import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { createApiKey, fetchAccounts, fetchTransactions, PluggyAccount, PluggyTransaction } from "../_shared/pluggy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-open-finance-internal-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const allowedTriggerSources = new Set(["initial", "manual", "scheduled", "webhook", "retry"]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function env(name: string) { return Deno.env.get(name)?.trim() || ""; }
function isoDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}
function accountType(account: PluggyAccount) {
  if (account.type === "CREDIT") return "credit";
  if (account.subtype === "SAVINGS_ACCOUNT") return "savings";
  return "checking";
}
function transactionType(account: PluggyAccount, transaction: PluggyTransaction): "income" | "expense" {
  if (account.type === "CREDIT") return Number(transaction.amount || 0) >= 0 ? "expense" : "income";
  if (transaction.type === "CREDIT") return "income";
  if (transaction.type === "DEBIT") return "expense";
  return Number(transaction.amount || 0) >= 0 ? "income" : "expense";
}
function triggerSource(value: unknown, callerUserId: string | null) {
  const source = String(value || "").trim();
  if (allowedTriggerSources.has(source)) return source;
  return callerUserId ? "manual" : "webhook";
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const supabaseUrl = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = env("SUPABASE_PUBLISHABLE_KEY") || env("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "Supabase administrativo não configurado." }, 500);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const internalSecret = env("OPEN_FINANCE_INTERNAL_SECRET");
  const suppliedInternal = request.headers.get("x-open-finance-internal-secret") || "";
  let callerUserId: string | null = null;

  if (internalSecret && suppliedInternal === internalSecret) {
    callerUserId = null;
  } else {
    const authorization = request.headers.get("Authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    if (!token || !anonKey) return json({ error: "Autenticação necessária." }, 401);
    const client = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) return json({ error: "Sessão inválida." }, 401);
    callerUserId = data.user.id;
  }

  let syncRunId: string | null = null;
  let lockedConnectionId: string | null = null;
  try {
    const body = await request.json() as { connectionId?: string; itemId?: string; dateFrom?: string; dateTo?: string; triggerSource?: string };
    let connectionQuery = admin.from("mf_bank_connections").select("*").eq("provider", "pluggy");
    if (body.connectionId) connectionQuery = connectionQuery.eq("id", body.connectionId);
    else if (body.itemId) connectionQuery = connectionQuery.eq("provider_connection_ref", body.itemId);
    else throw new Error("Informe connectionId ou itemId.");
    if (callerUserId) connectionQuery = connectionQuery.eq("user_id", callerUserId);

    const { data: connection, error: connectionError } = await connectionQuery.single();
    if (connectionError || !connection) throw new Error("Conexão Pluggy não encontrada.");
    if (!connection.provider_connection_ref) throw new Error("Conexão sem item Pluggy associado.");
    if (connection.status === "revoked" || connection.status === "revocation_pending") throw new Error("Essa conexão já foi revogada.");

    // Atomic per-connection lock: webhook + manual refresh may arrive together.
    const { data: lock, error: lockError } = await admin
      .from("mf_bank_connections")
      .update({ sync_status: "syncing", last_error: null })
      .eq("id", connection.id)
      .neq("sync_status", "syncing")
      .select("id")
      .maybeSingle();
    if (lockError) throw lockError;
    if (!lock) {
      return json({
        connectionId: connection.id,
        itemId: connection.provider_connection_ref,
        alreadySyncing: true,
      }, 202);
    }
    lockedConnectionId = connection.id;

    const { data: syncRun, error: runError } = await admin.from("mf_bank_sync_runs").insert({
      user_id: connection.user_id,
      connection_id: connection.id,
      trigger_source: triggerSource(body.triggerSource, callerUserId),
      status: "running",
      requested_from: body.dateFrom || null,
      requested_to: body.dateTo || null,
      started_at: new Date().toISOString(),
    }).select("id").single();
    if (runError) throw runError;
    syncRunId = syncRun.id;

    const apiKey = await createApiKey();
    const accounts = await fetchAccounts(apiKey, connection.provider_connection_ref);
    let receivedCount = 0;
    let importedCount = 0;
    let duplicateCount = 0;

    const { data: categoryRows, error: categoryError } = await admin
      .from("mf_transaction_categories")
      .select("id,name,category_type")
      .eq("user_id", connection.user_id)
      .eq("is_active", true);
    if (categoryError) throw categoryError;
    const categories = categoryRows || [];

    for (const providerAccount of accounts) {
      const { data: existingAccount, error: existingAccountError } = await admin
        .from("mf_account_balances")
        .select("id")
        .eq("user_id", connection.user_id)
        .eq("provider", "pluggy")
        .eq("provider_account_ref", providerAccount.id)
        .maybeSingle();
      if (existingAccountError) throw existingAccountError;

      let localAccountId = existingAccount?.id || null;
      const providerBalance = Number(providerAccount.balance || 0);
      const safeBalance = Number.isFinite(providerBalance) ? providerBalance : 0;
      const accountPayload = {
        user_id: connection.user_id,
        name: providerAccount.marketingName || providerAccount.name || `${connection.institution_name} · Open Finance`,
        account_type: accountType(providerAccount),
        currency: providerAccount.currencyCode || "BRL",
        institution_name: connection.institution_name,
        current_balance: safeBalance,
        is_active: true,
        provider: "pluggy",
        provider_account_ref: providerAccount.id,
        bank_connection_id: connection.id,
      };

      if (localAccountId) {
        const { error } = await admin.from("mf_account_balances").update(accountPayload).eq("id", localAccountId).eq("user_id", connection.user_id);
        if (error) throw error;
      } else {
        const { data, error } = await admin.from("mf_account_balances").insert({ ...accountPayload, opening_balance: safeBalance, is_default: false }).select("id").single();
        if (error || !data) throw error || new Error("Não foi possível criar a conta Open Finance.");
        localAccountId = data.id;
      }

      const transactions = await fetchTransactions(apiKey, providerAccount.id, body.dateFrom || null, body.dateTo || null);
      receivedCount += transactions.length;

      for (const transaction of transactions) {
        const date = isoDate(transaction.date);
        const amount = Math.abs(Number(transaction.amount || 0));
        if (!date || !Number.isFinite(amount) || amount === 0) continue;

        const type = transactionType(providerAccount, transaction);
        const providerCategory = String(transaction.category || "Outros").trim() || "Outros";
        const category = categories.find((item: any) => item.name?.toLowerCase() === providerCategory.toLowerCase() && (item.category_type === "both" || item.category_type === type))
          || categories.find((item: any) => item.name?.toLowerCase() === "outros" && (item.category_type === "both" || item.category_type === type))
          || categories.find((item: any) => item.category_type === "both" || item.category_type === type);
        if (!category) throw new Error("Nenhuma categoria financeira ativa disponível para a sincronização.");

        const description = transaction.description || transaction.descriptionRaw || "Movimentação Open Finance";
        const payload = {
          user_id: connection.user_id,
          external_id: transaction.id,
          description,
          descricao: description,
          category: providerCategory,
          categoria: providerCategory,
          category_id: category.id,
          amount,
          valor: amount,
          date,
          data: transaction.date,
          type,
          tipo: type,
          source: "Open Finance · Pluggy",
          origem: "Open Finance · Pluggy",
          source_import: "open_finance_pluggy",
          payment_method: providerAccount.type === "CREDIT" ? "credit_card" : "unspecified",
          status: transaction.status === "PENDING" ? "pending" : "paid",
          status_importacao: "imported",
          affects_balance: providerAccount.type !== "CREDIT" && transaction.status !== "PENDING",
          account_id: localAccountId,
          metadata: {
            provider: "pluggy",
            item_id: connection.provider_connection_ref,
            provider_account_id: providerAccount.id,
            provider_transaction_id: transaction.id,
            provider_code: transaction.providerCode || null,
            provider_id: transaction.providerId || null,
            provider_category_id: transaction.categoryId || null,
            raw_type: transaction.type || null,
            credit_card_metadata: transaction.creditCardMetadata || null,
          },
        };

        const { error: insertError } = await admin.from("mf_finance_ledger_entries").insert(payload);
        if (insertError) {
          if (insertError.code === "23505") duplicateCount += 1;
          else throw insertError;
        } else importedCount += 1;
      }

      const { error: balanceError } = await admin
        .from("mf_account_balances")
        .update({ current_balance: safeBalance, updated_at: new Date().toISOString() })
        .eq("id", localAccountId)
        .eq("user_id", connection.user_id);
      if (balanceError) throw balanceError;
    }

    const finishedAt = new Date().toISOString();
    const { error: finishRunError } = await admin.from("mf_bank_sync_runs").update({
      status: "completed",
      received_count: receivedCount,
      imported_count: importedCount,
      duplicate_count: duplicateCount,
      finished_at: finishedAt,
    }).eq("id", syncRunId);
    if (finishRunError) throw finishRunError;

    const { error: finishConnectionError } = await admin.from("mf_bank_connections").update({
      status: "active",
      sync_status: "idle",
      last_synced_at: finishedAt,
      next_sync_at: null,
      last_error: null,
    }).eq("id", connection.id);
    if (finishConnectionError) throw finishConnectionError;
    lockedConnectionId = null;

    return json({ connectionId: connection.id, itemId: connection.provider_connection_ref, accounts: accounts.length, receivedCount, importedCount, duplicateCount });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao sincronizar Open Finance.";
    const finishedAt = new Date().toISOString();
    if (syncRunId) {
      await admin.from("mf_bank_sync_runs").update({ status: "failed", error_message: message, finished_at: finishedAt }).eq("id", syncRunId);
    }
    if (lockedConnectionId) {
      await admin.from("mf_bank_connections").update({ sync_status: "error", last_error: message }).eq("id", lockedConnectionId);
    }
    return json({ error: message }, 400);
  }
});
