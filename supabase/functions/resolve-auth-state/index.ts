import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const PROD_ORIGIN = "https://mfinanceiro.com.br";

function safeOrigin(request: Request) {
  const raw = String(request.headers.get("origin") || "").trim();
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    const allowed = url.origin === PROD_ORIGIN
      || hostname === "localhost"
      || hostname === "127.0.0.1"
      || hostname.endsWith(".vercel.app");
    return allowed ? url.origin : PROD_ORIGIN;
  } catch {
    return PROD_ORIGIN;
  }
}

function headers(request: Request) {
  return {
    "Access-Control-Allow-Origin": safeOrigin(request),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "Content-Type": "application/json",
  };
}

Deno.serve((request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(request) });
  return new Response(
    JSON.stringify({
      error: "endpoint_retired",
      message: "A verificação pública de estado de conta foi desativada.",
    }),
    { status: 410, headers: headers(request) },
  );
});
