import { createClient } from "@supabase/supabase-js";

const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || "").trim();
const supabaseAnonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();

export const isSupabaseConfigured = () =>
  Boolean(
    supabaseUrl &&
      supabaseAnonKey &&
      supabaseUrl.startsWith("https://") &&
      !supabaseUrl.includes("your-project") &&
      supabaseAnonKey !== "your-anon-key",
  );

if (!isSupabaseConfigured()) {
  console.error(
    "Supabase não configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.",
  );
}

type AuthLock = <R>(
  name: string,
  acquireTimeout: number,
  fn: () => Promise<R>,
) => Promise<R>;

const authLockTails = new Map<string, Promise<void>>();

const processAuthLock: AuthLock = async <R>(
  name: string,
  _acquireTimeout: number,
  fn: () => Promise<R>,
): Promise<R> => {
  const previous = authLockTails.get(name) || Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const currentTail = previous.catch(() => undefined).then(() => gate);

  authLockTails.set(name, currentTail);
  await previous.catch(() => undefined);

  try {
    return await fn();
  } finally {
    release();
    if (authLockTails.get(name) === currentTail) {
      authLockTails.delete(name);
    }
  }
};

type StatementBalanceMode = "keep" | "apply_new" | "statement";

type StatementImportApproval = {
  reviewedAt?: number;
  mode?: StatementBalanceMode;
  periodStart?: string | null;
  periodEnd?: string | null;
};

type PendingStatementImport = {
  createdAt: number;
  mode: StatementBalanceMode;
  balanceBefore: number;
  netNew: number;
  insertedCount: number;
  duplicateCount: number;
  periodStart: string | null;
  periodEnd: string | null;
};

type LedgerEntryPayload = Record<string, unknown> & {
  user_id: string;
  date: string;
  description: string;
  amount: number;
  type: "income" | "expense";
  source: string;
  status: string;
  external_id?: string | null;
  metadata?: Record<string, unknown> | null;
};

let pendingStatementImport: PendingStatementImport | null = null;
const nativeFetch = globalThis.fetch.bind(globalThis);

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.method.toUpperCase();
  }
  return "GET";
}

function requestHeaders(input: RequestInfo | URL, init?: RequestInit): Headers {
  const headers = new Headers(
    typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
  );
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  }
  return headers;
}

function requestOption<T extends keyof RequestInit>(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  key: T,
): RequestInit[T] | undefined {
  if (init?.[key] !== undefined) return init[key];
  if (typeof Request === "undefined" || !(input instanceof Request)) return undefined;
  return (input as unknown as Record<string, RequestInit[T]>)[key as string];
}

async function readRequestJson(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<unknown> {
  try {
    const body = init?.body;
    if (typeof body === "string") return JSON.parse(body);
    if (typeof Request !== "undefined" && input instanceof Request) {
      const text = await input.clone().text();
      return text ? JSON.parse(text) : null;
    }
  } catch {
    return null;
  }
  return null;
}

function isImportedStatementBatch(payload: unknown): payload is LedgerEntryPayload[] {
  if (!Array.isArray(payload) || payload.length === 0) return false;

  return payload.every((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const item = entry as Record<string, unknown>;
    const source = String(item.source || "").trim().toLowerCase();

    return (
      typeof item.user_id === "string" &&
      typeof item.date === "string" &&
      typeof item.description === "string" &&
      typeof item.amount === "number" &&
      (item.type === "income" || item.type === "expense") &&
      item.status === "paid" &&
      Boolean(source) &&
      source !== "manual"
    );
  });
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeImportText(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dateKey(value: unknown): string {
  const raw = String(value || "").trim();
  const direct = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct) return direct[1];
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function canonicalEntryKey(entry: Record<string, unknown>): string {
  const amount = roundMoney(Number(entry.amount || 0)).toFixed(2);
  return [
    dateKey(entry.date),
    amount,
    normalizeImportText(entry.description || entry.descricao),
    normalizeImportText(entry.source || entry.origem),
  ].join("|");
}

async function sha256(value: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const bytes = new TextEncoder().encode(value);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(16).padStart(8, "0");
}

function currentApproval(): StatementImportApproval {
  if (typeof window === "undefined") return { mode: "keep" };
  const approval = (window as any).__mfStatementImportApproval as StatementImportApproval | undefined;
  const reviewedAt = Number(approval?.reviewedAt || 0);
  if (!reviewedAt || Date.now() - reviewedAt > 10 * 60_000) return { mode: "keep" };
  const mode: StatementBalanceMode = ["keep", "apply_new", "statement"].includes(String(approval?.mode))
    ? approval?.mode as StatementBalanceMode
    : "keep";
  return { ...approval, mode };
}

function clearApproval() {
  if (typeof window !== "undefined") delete (window as any).__mfStatementImportApproval;
}

function baseRequestInit(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  method: string,
  headers: Headers,
  body?: BodyInit | null,
): RequestInit {
  return {
    method,
    headers,
    body,
    signal: requestOption(input, init, "signal"),
    credentials: requestOption(input, init, "credentials"),
    cache: requestOption(input, init, "cache"),
    mode: requestOption(input, init, "mode"),
    redirect: requestOption(input, init, "redirect"),
    referrer: requestOption(input, init, "referrer"),
    referrerPolicy: requestOption(input, init, "referrerPolicy"),
    integrity: requestOption(input, init, "integrity"),
    keepalive: requestOption(input, init, "keepalive"),
  };
}

async function nativeFetchJson(url: string, headers: Headers): Promise<unknown> {
  const queryHeaders = new Headers(headers);
  queryHeaders.delete("content-type");
  queryHeaders.delete("content-length");
  queryHeaders.delete("prefer");
  queryHeaders.delete("range");
  queryHeaders.set("accept", "application/json");
  const response = await nativeFetch(url, { method: "GET", headers: queryHeaders });
  if (!response.ok) throw new Error(`Consulta de conferência falhou (${response.status}).`);
  return response.json();
}

function apiBase(url: string): string {
  const marker = "/rest/v1/";
  const index = url.indexOf(marker);
  return index >= 0 ? url.slice(0, index) : supabaseUrl;
}

function buildQueryUrl(base: string, table: string, params: Record<string, string>): string {
  const url = new URL(`${base}/rest/v1/${table}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}

function dispatchImportResult(detail: PendingStatementImport & { balanceAfter?: number }) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("mf:statement-import-result", { detail }));
}

async function prepareStatementImport(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  url: string,
  payload: LedgerEntryPayload[],
): Promise<Response> {
  const headers = requestHeaders(input, init);
  const base = apiBase(url);
  const userId = payload[0]?.user_id;
  const dates = payload.map((entry) => dateKey(entry.date)).filter(Boolean).sort();
  const periodStart = dates[0] || null;
  const periodEnd = dates[dates.length - 1] || null;
  const approval = currentApproval();

  let existingRows: Record<string, unknown>[] = [];
  let balanceBefore: number | null = null;

  try {
    const [existingResult, settingsResult] = await Promise.all([
      periodStart && periodEnd
        ? nativeFetchJson(
            buildQueryUrl(base, "mf_finance_ledger_entries", {
              select: "id,date,amount,description,descricao,source,origem,external_id",
              user_id: `eq.${userId}`,
              date: `gte.${periodStart}`,
              and: `(date.lte.${periodEnd})`,
              limit: "10000",
            }),
            headers,
          )
        : Promise.resolve([]),
      nativeFetchJson(
        buildQueryUrl(base, "mf_user_settings", {
          select: "current_balance",
          user_id: `eq.${userId}`,
          limit: "1",
        }),
        headers,
      ),
    ]);

    existingRows = Array.isArray(existingResult) ? existingResult as Record<string, unknown>[] : [];
    const settingsRows = Array.isArray(settingsResult) ? settingsResult as Record<string, unknown>[] : [];
    const parsedBalance = Number(settingsRows[0]?.current_balance);
    if (Number.isFinite(parsedBalance)) balanceBefore = roundMoney(parsedBalance);
  } catch (error) {
    console.warn("Não foi possível concluir toda a conferência de duplicidade:", error);
  }

  const legacyCounts = new Map<string, number>();
  const existingExternalIds = new Set<string>();
  existingRows.forEach((entry) => {
    const externalId = String(entry.external_id || "").trim();
    if (externalId) existingExternalIds.add(externalId);
    const key = canonicalEntryKey(entry);
    legacyCounts.set(key, (legacyCounts.get(key) || 0) + 1);
  });

  const incomingOccurrences = new Map<string, number>();
  const batchId = globalThis.crypto?.randomUUID?.() || `statement-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const freshEntries: LedgerEntryPayload[] = [];
  let duplicateCount = 0;

  for (const entry of payload) {
    const key = canonicalEntryKey(entry);
    const occurrence = (incomingOccurrences.get(key) || 0) + 1;
    incomingOccurrences.set(key, occurrence);
    const externalId = `statement:${await sha256(`${key}|${occurrence}`)}`;

    const externalDuplicate = existingExternalIds.has(externalId);
    const legacyCount = legacyCounts.get(key) || 0;
    const legacyDuplicate = !externalDuplicate && legacyCount > 0;

    if (externalDuplicate || legacyDuplicate) {
      duplicateCount += 1;
      if (legacyDuplicate) legacyCounts.set(key, legacyCount - 1);
      continue;
    }

    existingExternalIds.add(externalId);
    freshEntries.push({
      ...entry,
      external_id: externalId,
      metadata: {
        ...(entry.metadata && typeof entry.metadata === "object" ? entry.metadata : {}),
        import_batch_id: batchId,
        import_fingerprint: externalId,
        import_period_start: periodStart,
        import_period_end: periodEnd,
        balance_review_mode: approval.mode || "keep",
        reviewed_at: approval.reviewedAt || null,
      },
    });
  }

  const netNew = roundMoney(freshEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0));
  let mode: StatementBalanceMode = approval.mode || "keep";
  if (mode === "apply_new" && balanceBefore === null) mode = "keep";

  pendingStatementImport = {
    createdAt: Date.now(),
    mode,
    balanceBefore: balanceBefore ?? 0,
    netNew,
    insertedCount: freshEntries.length,
    duplicateCount,
    periodStart,
    periodEnd,
  };

  if (freshEntries.length === 0) {
    return new Response(null, {
      status: 201,
      statusText: "Created",
      headers: { "content-type": "application/json" },
    });
  }

  const targetUrl = new URL(url);
  targetUrl.searchParams.set("on_conflict", "user_id,external_id");
  const insertHeaders = new Headers(headers);
  insertHeaders.set("content-type", "application/json");
  const prefer = insertHeaders.get("prefer") || "";
  const preferParts = prefer.split(",").map((value) => value.trim()).filter(Boolean);
  if (!preferParts.some((value) => value.startsWith("resolution="))) {
    preferParts.push("resolution=ignore-duplicates");
  }
  insertHeaders.set("prefer", preferParts.join(","));

  const response = await nativeFetch(
    targetUrl.toString(),
    baseRequestInit(input, init, "POST", insertHeaders, JSON.stringify(freshEntries)),
  );

  if (!response.ok) pendingStatementImport = null;
  return response;
}

async function applyPendingBalanceDecision(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  url: string,
  payload: Record<string, unknown>,
): Promise<Response | null> {
  const pending = pendingStatementImport;
  if (!pending || typeof payload.current_balance !== "number") return null;

  let balanceAfter = pending.balanceBefore;
  let response: Response;

  if (pending.mode === "keep") {
    response = new Response(null, {
      status: 204,
      statusText: "No Content",
      headers: { "content-type": "application/json" },
    });
  } else {
    const headers = requestHeaders(input, init);
    headers.set("content-type", "application/json");
    const nextPayload = { ...payload };

    if (pending.mode === "apply_new") {
      balanceAfter = roundMoney(pending.balanceBefore + pending.netNew);
      nextPayload.current_balance = balanceAfter;
    } else {
      balanceAfter = roundMoney(Number(payload.current_balance));
    }

    response = await nativeFetch(
      url,
      baseRequestInit(input, init, "PATCH", headers, JSON.stringify(nextPayload)),
    );
  }

  if (response.ok) dispatchImportResult({ ...pending, balanceAfter });
  pendingStatementImport = null;
  clearApproval();
  return response;
}

const guardedFetch: typeof fetch = async (input, init) => {
  const url = requestUrl(input);
  const method = requestMethod(input, init);
  const payload = await readRequestJson(input, init);
  const now = Date.now();

  if (pendingStatementImport && now - pendingStatementImport.createdAt > 30_000) {
    dispatchImportResult({
      ...pendingStatementImport,
      balanceAfter: pendingStatementImport.balanceBefore,
    });
    pendingStatementImport = null;
    clearApproval();
  }

  const isSettingsBalanceUpdate =
    method === "PATCH" && url.includes("/rest/v1/mf_user_settings");

  if (
    isSettingsBalanceUpdate &&
    pendingStatementImport &&
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload)
  ) {
    const handled = await applyPendingBalanceDecision(
      input,
      init,
      url,
      payload as Record<string, unknown>,
    );
    if (handled) return handled;
  }

  const isLedgerInsert =
    method === "POST" && url.includes("/rest/v1/mf_finance_ledger_entries");

  if (isLedgerInsert && isImportedStatementBatch(payload)) {
    return prepareStatementImport(input, init, url, payload);
  }

  return nativeFetch(input, init);
};

export const supabase = createClient(
  supabaseUrl || "https://placeholder-project.supabase.co",
  supabaseAnonKey || "placeholder-key",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      lock: processAuthLock,
    },
    global: {
      fetch: guardedFetch,
    },
  },
);
