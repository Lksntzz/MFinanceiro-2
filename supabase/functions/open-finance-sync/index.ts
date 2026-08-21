import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { createApiKey, fetchAccounts, fetchTransactions, PluggyAccount, PluggyTransaction } from "../_shared/pluggy.ts";
import { reportMfAdminServiceEvent } from "../_shared/mf-admin-telemetry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-open-finance-internal-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const allowedTriggerSources = new Set(["initial", "manual", "scheduled", "webhook", "retry"]);
const LOCK_STALE_MS = 10 * 60 * 1000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function env(name: string) { return Deno.env.get(name)?.trim() || ""; }
function readSupabaseKey(jsonName: string, directName: string, legacyName: string) {
  const direct = env(directName);
  if (direct) return direct;
  const encoded = env(jsonName);
  if (encoded) {
    try {
      const keys = JSON.parse(encoded) as Record<string, unknown>;
      if (typeof keys.default === 'string') return keys.default;
    } catch {
      // Fall through.
    }
  }
  return env(legacyName);
}
function isoDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}
function optionalFiniteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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

  const correlationId = crypto.randomUUID();
  const startedAt = Date.now();
  const supabaseUrl = env("SUPABASE_URL");
  const serviceKey = readSupabaseKey("SUPABASE_SECRET_KEYS", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = readSupabaseKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceKey) {
    reportMfAdminServiceEvent({
      module: 'open_finance.sync', operation: 'bootstrap', errorCode: 'OPEN_FINANCE_SYNC_BACKEND_UNCONFIGURED',
      message: 'Open Finance sync sem configuração de backend', category: 'infrastructure', severity: 'critical', correlationId,
    });
    return json({ error: "Supabase administrativo não configurado." }, 500);
  }

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
    const client = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) return json({ error: "Sessão inválida." }, 401);
    callerUserId = data.user.id;
  }

  let syncRunId: string | null = null;
  let lockedConnectionId: string | null = null;
  let diagnosticUserId: string | null = callerUserId;

  try {
    const body = await request.json() as {
      connectionId?: string;
      itemId?: string;
      dateFrom?: string;
      dateTo?: string;
      triggerSource?: string;
      providerEvent?: string;
      deletedTransactionIds?: string[];
    };

    let connectionQuery = admin
      .from("mf_bank_connections")
      .select("id,user_id,status,sync_status,provider,provider_connection_ref,institution_name,updated_at")
      .eq("provider", "pluggy");
    if (body.connectionId) connectionQuery = connectionQuery.eq("id", body.connectionId);
    else if (body.itemId) connectionQuery = connectionQuery.eq("provider_connection_ref", body.itemId);
    else throw new Error("Informe connectionId ou itemId.");
    if (callerUserId) connectionQuery = connectionQuery.eq("user_id", callerUserId);

    const { data: connection, error: connectionError } = await connectionQuery.single();
    if (connectionError || !connection) {
      reportMfAdminServiceEvent({
        module: 'open_finance.sync', operation: 'resolve_connection', errorCode: 'OPEN_FINANCE_CONNECTION_NOT_FOUND',
        message: 'Conexão Open Finance não encontrada', category: 'integration', severity: 'high', correlationId, userId: callerUserId,
      });
      throw new Error("Conexão Pluggy não encontrada.");
    }
    diagnosticUserId = connection.user_id;
    if (!connection.provider_connection_ref) throw new Error("Conexão sem Item Pluggy associado.");
    if (connection.status === "revoked" || connection.status === "revocation_pending") throw new Error("Essa conexão já foi revogada.");

    const staleBefore = new Date(Date.now() - LOCK_STALE_MS).toISOString();
    const isStaleLock = connection.sync_status === 'syncing'
      && Number.isFinite(Date.parse(String(connection.updated_at || '')))
      && Date.parse(String(connection.updated_at)) < Date.now() - LOCK_STALE_MS;

    let lockQuery = admin
      .from("mf_bank_connections")
      .update({ sync_status: "syncing", last_error: null })
      .eq("id", connection.id);
    lockQuery = connection.sync_status === 'syncing'
      ? lockQuery.eq('sync_status', 'syncing').lt('updated_at', staleBefore)
      : lockQuery.neq('sync_status', 'syncing');
    const { data: lock, error: lockError } = await lockQuery.select("id").maybeSingle();
    if (lockError) throw lockError;
    if (!lock) {
      reportMfAdminServiceEvent({
        module: 'open_finance.sync', operation: 'acquire_lock', errorCode: 'OPEN_FINANCE_ALREADY_SYNCING',
        message: 'Sincronização Open Finance já estava em andamento', category: 'performance', severity: 'medium',
        correlationId, userId: connection.user_id,
      });
      return json({ connectionId: connection.id, alreadySyncing: true }, 202);
    }
    lockedConnectionId = connection.id;
    if (isStaleLock) {
      reportMfAdminServiceEvent({
        module: 'open_finance.sync', operation: 'recover_lock', errorCode: 'OPEN_FINANCE_STALE_LOCK_RECOVERED',
        message: 'Lock antigo de sincronização Open Finance foi recuperado', category: 'infrastructure', severity: 'medium',
        correlationId, userId: connection.user_id,
      });
    }

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
    let accounts: PluggyAccount[];
    try {
      accounts = await fetchAccounts(apiKey, connection.provider_connection_ref);
    } catch (error) {
      reportMfAdminServiceEvent({
        module: 'open_finance.sync', operation: 'fetch_accounts', errorCode: 'OPEN_FINANCE_FETCH_ACCOUNTS_FAILED',
        message: 'Falha ao buscar contas no provedor Open Finance', category: 'integration', severity: 'high',
        correlationId, userId: connection.user_id, durationMs: Date.now() - startedAt,
      });
      throw error;
    }
    if (!accounts.length) {
      reportMfAdminServiceEvent({
        module: 'open_finance.sync', operation: 'fetch_accounts', errorCode: 'OPEN_FINANCE_NO_ACCOUNTS_RETURNED',
        message: 'Provedor Open Finance não retornou contas', category: 'data_anomaly', severity: 'high',
        impact: 'financial_risk', correlationId, userId: connection.user_id,
      });
      throw new Error('Nenhuma conta foi retornada pelo provedor.');
    }

    const { data: categoryRows, error: categoryError } = await admin
      .from("mf_transaction_categories")
      .select("id,name,category_type")
      .eq("user_id", connection.user_id)
      .eq("is_active", true);
    if (categoryError) throw categoryError;
    const categories = categoryRows || [];

    let receivedCount = 0;
    let importedCount = 0;
    let duplicateCount = 0;
    const reconciliations: Array<{ accountId: string; providerBalance: number }> = [];

    for (const providerAccount of accounts) {
      const providerBalance = optionalFiniteNumber(providerAccount.balance);
      if (providerBalance === undefined) {
        reportMfAdminServiceEvent({
          module: 'open_finance.sync', operation: 'validate_provider_balance', errorCode: 'OPEN_FINANCE_PROVIDER_BALANCE_MISSING',
          message: 'Provedor não informou saldo de conta Open Finance', category: 'data_anomaly', severity: 'high',
          impact: 'financial_risk', correlationId, userId: connection.user_id,
        });
        throw new Error('O provedor não informou o saldo necessário para sincronizar com segurança.');
      }

      const { data: accountIdRaw, error: accountError } = await admin.rpc('mf_upsert_open_finance_account_service', {
        p_user_id: connection.user_id,
        p_connection_id: connection.id,
        p_provider: 'pluggy',
        p_provider_account_ref: providerAccount.id,
        p_name: providerAccount.marketingName || providerAccount.name || `${connection.institution_name} · Open Finance`,
        p_account_type: accountType(providerAccount),
        p_currency: providerAccount.currencyCode || 'BRL',
        p_institution_name: connection.institution_name,
        p_provider_balance: providerBalance,
      });
      if (accountError || !accountIdRaw) {
        reportMfAdminServiceEvent({
          module: 'open_finance.sync', operation: 'upsert_account', errorCode: 'OPEN_FINANCE_ACCOUNT_UPSERT_FAILED',
          message: 'Falha ao preparar conta financeira do Open Finance', category: 'business_rule', severity: 'high',
          impact: 'financial_risk', correlationId, userId: connection.user_id,
        });
        throw accountError || new Error('Não foi possível preparar a conta Open Finance.');
      }
      const localAccountId = String(accountIdRaw);

      let transactions: PluggyTransaction[];
      try {
        transactions = await fetchTransactions(apiKey, providerAccount.id, body.dateFrom || null, body.dateTo || null);
      } catch (error) {
        reportMfAdminServiceEvent({
          module: 'open_finance.sync', operation: 'fetch_transactions', errorCode: 'OPEN_FINANCE_FETCH_TRANSACTIONS_FAILED',
          message: 'Falha ao buscar transações no provedor Open Finance', category: 'integration', severity: 'high',
          correlationId, userId: connection.user_id, durationMs: Date.now() - startedAt,
        });
        throw error;
      }
      receivedCount += transactions.length;

      let accountFailure: unknown = null;
      try {
        for (const transaction of transactions) {
          const date = isoDate(transaction.date);
          const rawAmount = optionalFiniteNumber(transaction.amount);
          const amount = rawAmount === undefined ? 0 : Math.abs(rawAmount);
          if (!date || amount === 0 || !transaction.id) continue;

          const type = transactionType(providerAccount, transaction);
          const providerCategory = String(transaction.category || "Outros").trim() || "Outros";
          const category = categories.find((item: any) => item.name?.toLowerCase() === providerCategory.toLowerCase() && (item.category_type === "both" || item.category_type === type))
            || categories.find((item: any) => item.name?.toLowerCase() === "outros" && (item.category_type === "both" || item.category_type === type))
            || categories.find((item: any) => item.category_type === "both" || item.category_type === type);
          if (!category) {
            reportMfAdminServiceEvent({
              module: 'open_finance.sync', operation: 'resolve_category', errorCode: 'OPEN_FINANCE_CATEGORY_MISSING',
              message: 'Nenhuma categoria financeira compatível para Open Finance', category: 'business_rule', severity: 'high',
              impact: 'financial_risk', correlationId, userId: connection.user_id,
            });
            throw new Error("Nenhuma categoria financeira ativa disponível para a sincronização.");
          }

          const description = String(transaction.description || transaction.descriptionRaw || "Movimentação Open Finance").trim().slice(0, 240);
          const { data: entryResult, error: entryError } = await admin.rpc('mf_upsert_open_finance_entry_service', {
            p_user_id: connection.user_id,
            p_account_id: localAccountId,
            p_external_id: transaction.id,
            p_description: description,
            p_provider_category: providerCategory,
            p_category_id: category.id,
            p_amount: amount,
            p_date: date,
            p_type: type,
            p_payment_method: providerAccount.type === "CREDIT" ? "credit_card" : "unspecified",
            p_status: transaction.status === "PENDING" ? "pending" : "paid",
            p_affects_balance: providerAccount.type !== "CREDIT" && transaction.status !== "PENDING",
            p_metadata: {
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
          });
          if (entryError) {
            reportMfAdminServiceEvent({
              module: 'open_finance.sync', operation: 'upsert_ledger', errorCode: 'OPEN_FINANCE_LEDGER_UPSERT_FAILED',
              message: 'Ledger recusou atualização do Open Finance', category: 'business_rule', severity: 'high',
              impact: 'financial_risk', correlationId, userId: connection.user_id,
            });
            throw entryError;
          }
          const inserted = Boolean(entryResult && typeof entryResult === 'object' && (entryResult as Record<string, unknown>).inserted === true);
          if (inserted) importedCount += 1;
          else duplicateCount += 1;
        }
      } catch (error) {
        accountFailure = error;
      } finally {
        // Keep the derived current balance equal to the provider even when a
        // partial transaction write fails. A retry can then safely finish history.
        const { error: reconcileError } = await admin.rpc('mf_reconcile_open_finance_account_balance_service', {
          p_user_id: connection.user_id,
          p_account_id: localAccountId,
          p_provider_balance: providerBalance,
        });
        if (reconcileError && !accountFailure) accountFailure = reconcileError;
        if (reconcileError) {
          reportMfAdminServiceEvent({
            module: 'open_finance.sync', operation: 'reconcile_balance', errorCode: 'OPEN_FINANCE_BALANCE_RECONCILE_FAILED',
            message: 'Falha ao reconciliar saldo derivado do Open Finance', category: 'business_rule', severity: 'critical',
            impact: 'financial_risk', correlationId, userId: connection.user_id,
          });
        }
      }
      if (accountFailure) throw accountFailure;
      reconciliations.push({ accountId: localAccountId, providerBalance });
    }

    const deletedTransactionIds = Array.isArray(body.deletedTransactionIds)
      ? body.deletedTransactionIds.map(String).filter(Boolean).slice(0, 2_000)
      : [];
    let voidedCount = 0;
    if (deletedTransactionIds.length) {
      const { data: voided, error: voidError } = await admin.rpc('mf_void_open_finance_entries_service', {
        p_user_id: connection.user_id,
        p_connection_id: connection.id,
        p_external_ids: deletedTransactionIds,
      });
      if (voidError) throw voidError;
      voidedCount = Number(voided || 0);

      // Deletion changes ledger effect, so reconcile every provider account once
      // more against the authoritative balances returned in this same sync.
      for (const reconciliation of reconciliations) {
        const { error: reconcileError } = await admin.rpc('mf_reconcile_open_finance_account_balance_service', {
          p_user_id: connection.user_id,
          p_account_id: reconciliation.accountId,
          p_provider_balance: reconciliation.providerBalance,
        });
        if (reconcileError) throw reconcileError;
      }
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

    return json({
      connectionId: connection.id,
      accounts: accounts.length,
      receivedCount,
      importedCount,
      updatedCount: duplicateCount,
      voidedCount,
    });
  } catch {
    const finishedAt = new Date().toISOString();
    const safeMessage = "Falha ao sincronizar Open Finance.";
    reportMfAdminServiceEvent({
      module: 'open_finance.sync', operation: 'sync', errorCode: 'OPEN_FINANCE_SYNC_FAILED',
      message: 'Sincronização Open Finance falhou', category: 'integration', severity: 'high', impact: 'partial_operation',
      correlationId, userId: diagnosticUserId, durationMs: Date.now() - startedAt,
      context: { has_sync_run: Boolean(syncRunId), had_connection_lock: Boolean(lockedConnectionId) },
    });
    if (syncRunId) {
      await admin.from("mf_bank_sync_runs")
        .update({ status: "failed", error_message: safeMessage, finished_at: finishedAt })
        .eq("id", syncRunId);
    }
    if (lockedConnectionId) {
      await admin.from("mf_bank_connections")
        .update({ sync_status: "error", last_error: safeMessage })
        .eq("id", lockedConnectionId);
    }
    return json({ error: safeMessage }, 400);
  }
});
