import type { SupabaseClient } from "@supabase/supabase-js";

const PLUGGY_API_URL = "https://api.pluggy.ai";
const BRAZIL_TIME_ZONE = "America/Sao_Paulo";

let cachedApiKey: { token: string; expiresAt: number } | null = null;

type JsonRecord = Record<string, unknown>;

export type OpenFinanceConnectionRow = {
  id: string;
  user_id: string;
  provider: string;
  provider_connection_ref?: string | null;
  institution_id?: string | null;
  institution_name: string;
  status: string;
  sync_status: string;
  metadata?: JsonRecord | null;
};

function env(name: string) {
  return (Deno.env.get(name) || "").trim();
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function lastDigits(value: unknown) {
  const cleaned = asString(value).replace(/\s+/g, "");
  if (!cleaned) return "";
  return cleaned.length <= 4 ? cleaned : `•••• ${cleaned.slice(-4)}`;
}

function dayFromDate(value: unknown) {
  const text = asString(value);
  const match = /^\d{4}-\d{2}-(\d{2})/.exec(text);
  return match ? Number(match[1]) : null;
}

function dateInBrazil(value: unknown) {
  const text = asString(value);
  if (!text) return "";
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) return text.slice(0, 10);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BRAZIL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomSecret(bytes = 32) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function getPluggyApiKey() {
  if (cachedApiKey && cachedApiKey.expiresAt > Date.now() + 5 * 60_000) {
    return cachedApiKey.token;
  }

  const clientId = env("PLUGGY_CLIENT_ID");
  const clientSecret = env("PLUGGY_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("Pluggy não configurada. Defina PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET.");
  }

  const response = await fetch(`${PLUGGY_API_URL}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ clientId, clientSecret }),
  });
  const payload = await response.json().catch(() => ({})) as JsonRecord;
  const token = asString(payload.accessToken || payload.apiKey);
  if (!response.ok || !token) {
    throw new Error(`Não foi possível autenticar na Pluggy (${response.status}).`);
  }

  cachedApiKey = { token, expiresAt: Date.now() + 110 * 60_000 };
  return token;
}

export async function pluggyRequest(path: string, init: RequestInit = {}) {
  const apiKey = await getPluggyApiKey();
  const response = await fetch(`${PLUGGY_API_URL}${path}`, {
    ...init,
    headers: {
      "X-API-KEY": apiKey,
      "Accept": "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = asRecord(payload);
    throw new Error(
      asString(detail.message) ||
      asString(detail.error) ||
      `Pluggy respondeu com HTTP ${response.status}.`,
    );
  }
  return payload;
}

export async function deletePluggyItem(itemId: string) {
  const apiKey = await getPluggyApiKey();
  const response = await fetch(`${PLUGGY_API_URL}/items/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
    headers: { "X-API-KEY": apiKey, "Accept": "application/json" },
  });
  if (![200, 204, 404].includes(response.status)) {
    const payload = await response.json().catch(() => ({})) as JsonRecord;
    throw new Error(asString(payload.message) || `A Pluggy não revogou o consentimento (${response.status}).`);
  }
  return { alreadyDeleted: response.status === 404 };
}

export async function listOpenFinanceConnectorIds() {
  const payload = await pluggyRequest("/connectors?countries=BR&isOpenFinance=true");
  const record = asRecord(payload);
  const results = asArray(record.results || payload);
  return results
    .map((item) => asNumber(asRecord(item).id))
    .filter((id): id is number => id !== null);
}

export async function createPluggyConnectToken(input: {
  clientUserId: string;
  webhookUrl: string;
  oauthRedirectUri: string;
  itemId?: string | null;
}) {
  const body: JsonRecord = {
    options: {
      clientUserId: input.clientUserId,
      webhookUrl: input.webhookUrl,
      oauthRedirectUri: input.oauthRedirectUri,
      avoidDuplicates: true,
    },
  };
  if (input.itemId) body.itemId = input.itemId;

  const payload = asRecord(await pluggyRequest("/connect_token", {
    method: "POST",
    body: JSON.stringify(body),
  }));
  const connectToken = asString(payload.accessToken || payload.connectToken);
  if (!connectToken) throw new Error("A Pluggy não retornou o Connect Token.");
  return connectToken;
}

export async function getPluggyItem(itemId: string) {
  return asRecord(await pluggyRequest(`/items/${encodeURIComponent(itemId)}`));
}

export async function getPluggyConnector(connectorId: unknown) {
  const id = asNumber(connectorId);
  if (id === null) return {};
  return asRecord(await pluggyRequest(`/connectors/${id}`));
}

export async function getPluggyAccounts(itemId: string) {
  const payload = await pluggyRequest(`/accounts?itemId=${encodeURIComponent(itemId)}`);
  const record = asRecord(payload);
  return asArray(record.results || payload).map(asRecord);
}

export async function getPluggyTransactions(accountId: string) {
  const transactions: JsonRecord[] = [];
  let path = `/v2/transactions?accountId=${encodeURIComponent(accountId)}`;

  for (let page = 0; page < 100 && path; page += 1) {
    const payload = asRecord(await pluggyRequest(path));
    transactions.push(...asArray(payload.results).map(asRecord));
    const next = asString(payload.next);
    if (!next) break;
    path = next.startsWith("?") ? `/v2/transactions${next}` : next.startsWith("/") ? next : `/v2/transactions?${next}`;
  }

  return transactions;
}

export function sanitizePluggyAccount(account: JsonRecord) {
  const creditData = asRecord(account.creditData);
  const accountType = asString(account.type).toUpperCase();
  return {
    providerAccountId: asString(account.id),
    providerAccountType: accountType,
    subtype: asString(account.subtype),
    name: asString(account.marketingName) || asString(account.name) || "Conta Open Finance",
    maskedNumber: lastDigits(account.number),
    currency: asString(account.currencyCode) || "BRL",
    balance: asNumber(account.balance),
    creditLimit: asNumber(creditData.creditLimit),
    availableCreditLimit: asNumber(creditData.availableCreditLimit),
    metadata: {
      brand: asString(creditData.brand) || null,
      closingDay: dayFromDate(creditData.balanceCloseDate),
      dueDay: dayFromDate(creditData.balanceDueDate),
      level: asString(creditData.level) || null,
      holderType: asString(creditData.holderType) || null,
    },
  };
}

function inferPaymentMethod(transaction: JsonRecord, accountType: string) {
  if (accountType === "CREDIT") return "credit_card";
  const searchable = [
    asString(transaction.description),
    asString(transaction.operationCategory),
    asString(asRecord(transaction.paymentData).paymentMethod),
  ].join(" ").toUpperCase();
  if (searchable.includes("PIX")) return "pix";
  if (searchable.includes("BOLETO")) return "boleto";
  if (searchable.includes("TED") || searchable.includes("DOC") || searchable.includes("TRANSFER")) return "bank_transfer";
  if (searchable.includes("CASH") || searchable.includes("SAQUE")) return "cash";
  if (searchable.includes("DEBIT")) return "debit_card";
  return "unspecified";
}

export function sanitizePluggyTransaction(transaction: JsonRecord, accountType: string) {
  const rawAmount = Math.abs(asNumber(transaction.amount) || 0);
  const pluggyType = asString(transaction.type).toUpperCase();
  const type = pluggyType === "CREDIT" ? "income" : "expense";
  const signedAmount = type === "income" ? rawAmount : -rawAmount;
  const status = asString(transaction.status).toUpperCase() === "PENDING" ? "pending" : "paid";
  const merchant = asRecord(transaction.merchant);
  const creditCardMetadata = asRecord(transaction.creditCardMetadata);

  return {
    providerTransactionId: asString(transaction.id),
    providerCode: asString(transaction.providerCode) || null,
    transactionDate: dateInBrazil(transaction.date),
    description:
      asString(transaction.description) ||
      asString(transaction.descriptionRaw) ||
      asString(merchant.name) ||
      "Movimentação Open Finance",
    signedAmount,
    type,
    status,
    paymentMethod: inferPaymentMethod(transaction, accountType),
    providerUpdatedAt: asString(transaction.updatedAt) || null,
    metadata: {
      pluggyCategory: asString(transaction.category) || null,
      pluggyCategoryId: asString(transaction.categoryId) || null,
      providerCode: asString(transaction.providerCode) || null,
      providerId: asString(transaction.providerId) || null,
      operationCategory: asString(transaction.operationCategory) || null,
      merchantName: asString(merchant.name) || null,
      installmentNumber: asNumber(creditCardMetadata.installmentNumber),
      totalInstallments: asNumber(creditCardMetadata.totalInstallments),
      totalAmount: asNumber(creditCardMetadata.totalAmount),
    },
  };
}

export function itemIsReady(item: JsonRecord) {
  const status = asString(item.executionStatus).toUpperCase();
  return status === "SUCCESS" || status === "PARTIAL_SUCCESS";
}

function connectorFromItem(item: JsonRecord) {
  return asRecord(item.connector);
}

export async function resolvePluggyInstitution(item: JsonRecord) {
  let connector = connectorFromItem(item);
  if (!asString(connector.name) || typeof connector.isOpenFinance !== "boolean") {
    connector = await getPluggyConnector(connector.id || item.connectorId);
  }
  return {
    connectorId: asNumber(connector.id || item.connectorId),
    name: asString(connector.name) || "Open Finance",
    isOpenFinance: connector.isOpenFinance === true,
  };
}

export async function syncPluggyConnection(
  admin: SupabaseClient,
  connection: OpenFinanceConnectionRow,
  triggerSource: "initial" | "manual" | "scheduled" | "webhook" | "retry" = "manual",
) {
  const itemId = asString(connection.provider_connection_ref);
  if (!itemId) throw new Error("A conexão ainda não possui um Item da Pluggy.");

  const { data: claimed, error: claimError } = await admin
    .from("mf_bank_connections")
    .update({ sync_status: "syncing", last_error: null })
    .eq("id", connection.id)
    .eq("user_id", connection.user_id)
    .neq("sync_status", "syncing")
    .select("id")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) {
    return { received: 0, imported: 0, duplicate: 0, updated: 0, mappingRequired: 0, failures: 0, status: "skipped" };
  }

  const { data: run, error: runError } = await admin
    .from("mf_bank_sync_runs")
    .insert({
      user_id: connection.user_id,
      connection_id: connection.id,
      trigger_source: triggerSource,
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (runError || !run) {
    await admin.from("mf_bank_connections").update({ sync_status: "error", last_error: runError?.message || "Falha ao iniciar sincronização." }).eq("id", connection.id);
    throw new Error(runError?.message || "Não foi possível iniciar a sincronização.");
  }

  let received = 0;
  let imported = 0;
  let duplicate = 0;
  let updated = 0;
  let mappingRequired = 0;
  let failures = 0;

  try {
    const item = await getPluggyItem(itemId);
    const itemUserId = asString(item.clientUserId);
    if (itemUserId && itemUserId !== connection.user_id) {
      throw new Error("O Item da Pluggy não pertence a este usuário.");
    }
    if (!itemIsReady(item)) {
      throw new Error(`A instituição ainda não terminou a atualização (${asString(item.executionStatus) || "PROCESSING"}).`);
    }

    const accounts = await getPluggyAccounts(itemId);
    for (const providerAccount of accounts) {
      try {
        const sanitizedAccount = sanitizePluggyAccount(providerAccount);
        if (!sanitizedAccount.providerAccountId || !["BANK", "CREDIT"].includes(sanitizedAccount.providerAccountType)) {
          continue;
        }

        const { data: staged, error: stageError } = await admin.rpc("mf_stage_open_finance_account", {
          p_connection_id: connection.id,
          p_provider_account: sanitizedAccount,
        });
        if (stageError) throw stageError;

        const stage = asRecord(staged);
        if (stage.mapped !== true) {
          mappingRequired += 1;
          continue;
        }

        const providerTransactions = await getPluggyTransactions(sanitizedAccount.providerAccountId);
        const transactions = providerTransactions.map((transaction) =>
          sanitizePluggyTransaction(transaction, sanitizedAccount.providerAccountType)
        );
        const { data: ingested, error: ingestError } = await admin.rpc("mf_ingest_open_finance_account", {
          p_connection_id: connection.id,
          p_provider_account_ref: sanitizedAccount.providerAccountId,
          p_provider_balance: sanitizedAccount.balance,
          p_transactions: transactions,
        });
        if (ingestError) throw ingestError;
        const result = asRecord(ingested);
        received += Number(result.received || 0);
        imported += Number(result.imported || 0);
        duplicate += Number(result.duplicate || 0);
        updated += Number(result.updated || 0);
      } catch (accountError) {
        failures += 1;
        console.error("Open Finance account sync failed", accountError);
      }
    }

    const syncStatus = failures > 0 || mappingRequired > 0 ? "partial" : "completed";
    const runStatus = failures > 0 || mappingRequired > 0 ? "partial" : "completed";
    const now = new Date();
    const nextSync = new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString();

    await admin.from("mf_bank_sync_runs").update({
      status: runStatus,
      received_count: received,
      imported_count: imported,
      duplicate_count: duplicate,
      updated_count: updated,
      mapping_required_count: mappingRequired,
      finished_at: now.toISOString(),
      error_message: failures > 0 ? `${failures} conta(s) não puderam ser sincronizadas.` : null,
    }).eq("id", run.id);

    await admin.from("mf_bank_connections").update({
      status: "active",
      sync_status: syncStatus,
      last_synced_at: now.toISOString(),
      next_sync_at: nextSync,
      last_error: failures > 0 ? `${failures} conta(s) com erro na última sincronização.` : null,
    }).eq("id", connection.id).eq("user_id", connection.user_id);

    return { received, imported, duplicate, updated, mappingRequired, failures, status: runStatus };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao sincronizar Open Finance.";
    const finishedAt = new Date().toISOString();
    await admin.from("mf_bank_sync_runs").update({
      status: "failed",
      received_count: received,
      imported_count: imported,
      duplicate_count: duplicate,
      updated_count: updated,
      mapping_required_count: mappingRequired,
      error_message: message,
      finished_at: finishedAt,
    }).eq("id", run.id);

    await admin.from("mf_bank_connections").update({
      sync_status: "error",
      last_error: message,
    }).eq("id", connection.id).eq("user_id", connection.user_id);
    throw error;
  }
}
