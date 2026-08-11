import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const BRAPI_BASE = "https://brapi.dev";
const BASE_ORIGINS = new Set([
  "https://mfinanceiro.com.br",
  "https://www.mfinanceiro.com.br",
]);

function allowedOrigin(request: Request) {
  const origin = request.headers.get("Origin") || "";
  if (!origin) return "https://mfinanceiro.com.br";
  try {
    const hostname = new URL(origin).hostname;
    const configured = (Deno.env.get("MF_ALLOWED_ORIGINS") || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (BASE_ORIGINS.has(origin) || configured.includes(origin) || hostname.endsWith(".vercel.app")) return origin;
  } catch {
    // Invalid origins are rejected below by omitting them from the allow list.
  }
  return "https://mfinanceiro.com.br";
}

function corsHeaders(request: Request) {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(request),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function readSupabaseKey(jsonName: string, directName: string, legacyName: string) {
  const direct = Deno.env.get(directName);
  if (direct) return direct;
  const encoded = Deno.env.get(jsonName);
  if (encoded) {
    try {
      const keys = JSON.parse(encoded) as Record<string, unknown>;
      if (typeof keys.default === "string") return keys.default;
    } catch {
      // Fall through to the legacy secret name.
    }
  }
  return Deno.env.get(legacyName) || "";
}

function normalizeSymbol(value: unknown) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function marketUrl(action: "quote" | "income", symbol: string, assetClass: string) {
  if (action === "quote") {
    if (assetClass === "crypto") {
      return `${BRAPI_BASE}/api/v2/crypto?coin=${encodeURIComponent(symbol)}&currency=BRL`;
    }
    if (["stock", "fii", "etf", "bdr"].includes(assetClass)) {
      return `${BRAPI_BASE}/api/v2/stocks/quote?symbols=${encodeURIComponent(symbol)}`;
    }
    throw new Error("Classe sem cotação conectada neste beta.");
  }

  if (assetClass === "fii") {
    return `${BRAPI_BASE}/api/v2/fii/dividends?symbols=${encodeURIComponent(symbol)}`;
  }
  if (["stock", "etf", "bdr"].includes(assetClass)) {
    return `${BRAPI_BASE}/api/v2/stocks/dividends?symbols=${encodeURIComponent(symbol)}`;
  }
  throw new Error("Esta classe não possui proventos conectados neste beta.");
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return json(request, { error: "Método não permitido." }, 405);

  const authorization = request.headers.get("Authorization");
  const token = authorization?.replace(/^Bearer\s+/i, "");
  if (!authorization || !token) return json(request, { error: "Autenticação necessária." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const publishableKey = readSupabaseKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY");
  if (!supabaseUrl || !publishableKey) return json(request, { error: "Supabase não configurado na função." }, 500);

  const supabase = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return json(request, { error: "Sessão inválida." }, 401);

  try {
    const body = await request.json().catch(() => ({})) as {
      action?: "quote" | "income";
      symbol?: string;
      assetClass?: string;
    };
    const action = body.action === "income" ? "income" : "quote";
    const symbol = normalizeSymbol(body.symbol);
    const assetClass = String(body.assetClass || "stock").trim().toLowerCase();
    if (!/^[A-Z0-9.\-]{1,20}$/.test(symbol)) throw new Error("Ticker ou símbolo inválido.");

    const url = marketUrl(action, symbol, assetClass);
    const brapiToken = (Deno.env.get("BRAPI_TOKEN") || "").trim();
    const headers = brapiToken ? { Authorization: `Bearer ${brapiToken}` } : undefined;
    const response = await fetch(url, { headers });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const providerMessage = String((payload as Record<string, unknown>)?.message || "Falha na fonte de mercado.");
      return json(request, {
        error: providerMessage,
        provider: "brapi",
        providerStatus: response.status,
        configured: Boolean(brapiToken),
      }, response.status >= 500 ? 502 : response.status);
    }

    return json(request, {
      provider: "brapi",
      configured: Boolean(brapiToken),
      payload,
    });
  } catch (error) {
    return json(request, { error: error instanceof Error ? error.message : "Falha na consulta de mercado." }, 400);
  }
});
