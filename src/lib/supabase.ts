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

type PendingStatementImport = {
  createdAt: number;
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

function isImportedStatementBatch(payload: unknown): boolean {
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

const guardedFetch: typeof fetch = async (input, init) => {
  const url = requestUrl(input);
  const method = requestMethod(input, init);
  const payload = await readRequestJson(input, init);
  const now = Date.now();

  if (
    pendingStatementImport &&
    now - pendingStatementImport.createdAt > 20_000
  ) {
    pendingStatementImport = null;
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
    const update = payload as Record<string, unknown>;
    const keys = Object.keys(update);

    if (
      keys.length === 1 &&
      keys[0] === "current_balance" &&
      typeof update.current_balance === "number"
    ) {
      pendingStatementImport = null;
      return new Response(null, {
        status: 204,
        statusText: "No Content",
        headers: { "content-type": "application/json" },
      });
    }
  }

  const response = await nativeFetch(input, init);

  const isLedgerInsert =
    method === "POST" && url.includes("/rest/v1/mf_finance_ledger_entries");

  if (response.ok && isLedgerInsert && isImportedStatementBatch(payload)) {
    pendingStatementImport = { createdAt: Date.now() };
  }

  return response;
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
