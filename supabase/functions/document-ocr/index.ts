import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { clampConfidence, normalizeLearningKey } from "../_shared/adaptive-learning.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const responseSchema = {
  type: "object",
  properties: {
    document_confidence: { type: "number", minimum: 0, maximum: 1 },
    document_kind: {
      type: "string",
      enum: ["utility_bill", "bill", "receipt", "invoice", "payment_slip", "pix_charge", "other"],
    },
    merchant_name: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
    amount: { type: ["number", "null"], description: "Positive monetary amount in BRL when visible" },
    due_date: { type: ["string", "null"], description: "ISO date YYYY-MM-DD" },
    document_date: { type: ["string", "null"], description: "ISO date YYYY-MM-DD" },
    reference_period: { type: ["string", "null"] },
    payment_status: { type: "string", enum: ["pending", "paid", "unknown"] },
    category_hint: { type: ["string", "null"] },
    field_confidence: {
      type: "object",
      additionalProperties: { type: "number", minimum: 0, maximum: 1 },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: [
    "document_confidence",
    "document_kind",
    "merchant_name",
    "description",
    "amount",
    "due_date",
    "document_date",
    "reference_period",
    "payment_status",
    "category_hint",
    "field_confidence",
    "warnings",
  ],
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
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
      // Fall through to the legacy environment variable.
    }
  }
  return Deno.env.get(legacyName) || "";
}

function isoDate(value: unknown): string | null {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function finitePositive(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function cleanText(value: unknown, maxLength: number): string | null {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  return text ? text.slice(0, maxLength) : null;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function interactionText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === "string") return payload.output_text;
  const outputs = Array.isArray(payload.outputs) ? payload.outputs : [];
  for (const output of outputs) {
    const item = output as Record<string, unknown>;
    if (item.type === "text" && typeof item.text === "string") return item.text;
  }
  const steps = Array.isArray(payload.steps) ? payload.steps : [];
  for (let stepIndex = steps.length - 1; stepIndex >= 0; stepIndex -= 1) {
    const step = steps[stepIndex] as Record<string, unknown>;
    const content = Array.isArray(step?.content) ? step.content : [];
    const textPart = content.find((part) => typeof (part as Record<string, unknown>)?.text === "string") as Record<string, unknown> | undefined;
    if (typeof textPart?.text === "string") return textPart.text;
  }
  throw new Error("O provedor de IA não retornou o JSON esperado.");
}

function confidenceMap(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    result[key] = clampConfidence(raw);
  }
  return result;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const authorization = request.headers.get("Authorization");
  const token = authorization?.replace(/^Bearer\s+/i, "");
  if (!authorization || !token) return json({ error: "Autenticação necessária." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const publishableKey = readSupabaseKey(
    "SUPABASE_PUBLISHABLE_KEYS",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_ANON_KEY",
  );
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY") || "";
  const model = Deno.env.get("GEMINI_DOCUMENT_OCR_MODEL") || Deno.env.get("GEMINI_OCR_MODEL") || "gemini-3.6-flash";
  if (!supabaseUrl || !publishableKey) return json({ error: "Supabase não configurado na função." }, 500);
  if (!geminiApiKey) return json({ error: "OCR/IA ainda não foi habilitado pelo administrador." }, 503);

  const supabase = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return json({ error: "Sessão inválida." }, 401);

  let extractionId = "";
  try {
    const body = await request.json() as { extractionId?: string };
    extractionId = String(body.extractionId || "");
    if (!/^[0-9a-f-]{36}$/i.test(extractionId)) throw new Error("Identificador da análise inválido.");

    const { data: extraction, error: extractionError } = await supabase
      .from("mf_document_extractions")
      .select("id,user_id,account_id,source_file_path,source_file_name,source_mime_type,source_file_size,document_type,status,result_metadata")
      .eq("id", extractionId)
      .eq("user_id", userData.user.id)
      .single();
    if (extractionError || !extraction) throw new Error("Análise não encontrada.");
    if (extraction.document_type !== "other") throw new Error("Este documento não pertence ao OCR de contas e recibos.");
    if (!["uploaded", "failed"].includes(extraction.status)) throw new Error("Este documento já está sendo processado ou revisado.");
    if (!ALLOWED_MIME_TYPES.has(extraction.source_mime_type)) throw new Error("Formato de documento não suportado.");

    const { error: startError } = await supabase
      .from("mf_document_extractions")
      .update({ status: "processing", provider: "google-gemini", model, error_message: null, started_at: new Date().toISOString() })
      .eq("id", extractionId)
      .eq("user_id", userData.user.id);
    if (startError) throw startError;

    const [{ data: file, error: downloadError }, { data: categoryRows, error: categoryError }] = await Promise.all([
      supabase.storage.from("mf-import-documents").download(extraction.source_file_path),
      supabase
        .from("mf_transaction_categories")
        .select("id,name,category_type")
        .eq("user_id", userData.user.id)
        .eq("is_active", true)
        .in("category_type", ["expense", "both"])
        .order("sort_order")
        .order("name"),
    ]);
    if (downloadError || !file) throw new Error("Não foi possível ler o documento privado enviado.");
    if (categoryError) throw categoryError;

    const categoryNames = (categoryRows || [])
      .map((row) => cleanText(row.name, 120))
      .filter((value): value is string => Boolean(value));
    const categoryMap = new Map(categoryNames.map((name) => [normalizeLearningKey(name), name]));

    const base64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
    const fileType = extraction.source_mime_type === "application/pdf" ? "document" : "image";
    const categoryInstruction = categoryNames.length
      ? `Se sugerir categoria, use EXATAMENTE um destes nomes: ${categoryNames.join(" | ")}. Se nenhum servir claramente, retorne null.`
      : "Não sugira categoria; retorne null.";

    const aiResponse = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": geminiApiKey },
      body: JSON.stringify({
        model,
        input: [
          {
            type: "text",
            text: [
              "Analise este documento financeiro brasileiro como conta, boleto, cobrança, fatura simples, recibo ou comprovante.",
              "Extraia somente informações realmente visíveis. Nunca invente empresa, valor, vencimento, data, período ou situação de pagamento.",
              "Use amount positivo em reais. Datas devem ser YYYY-MM-DD ou null.",
              "payment_status deve ser paid somente quando houver evidência clara de pagamento/recibo/comprovante; pending quando houver cobrança a vencer e nenhuma evidência de pagamento; caso contrário unknown.",
              "merchant_name deve ser o emissor/estabelecimento mais provável apenas quando estiver legível.",
              "description deve ser uma descrição curta útil ao usuário, sem dados sensíveis desnecessários.",
              categoryInstruction,
              "Dê confiança de 0 a 1 para o documento e para cada campo. Dúvida deve reduzir a confiança.",
              "A saída será obrigatoriamente revisada por uma pessoa antes de qualquer lançamento financeiro.",
            ].join(" "),
          },
          { type: fileType, data: base64, mime_type: extraction.source_mime_type },
        ],
        generation_config: { thinking_level: "low" },
        response_format: { type: "text", mime_type: "application/json", schema: responseSchema },
      }),
    });
    if (!aiResponse.ok) {
      const providerMessage = (await aiResponse.text()).slice(0, 500);
      throw new Error(`Falha no OCR/IA (${aiResponse.status}): ${providerMessage}`);
    }

    const interaction = await aiResponse.json() as Record<string, unknown>;
    const parsed = JSON.parse(interactionText(interaction)) as Record<string, unknown>;
    const rawCategory = cleanText(parsed.category_hint, 120);
    const matchedCategory = rawCategory ? categoryMap.get(normalizeLearningKey(rawCategory)) || null : null;
    const warnings = Array.isArray(parsed.warnings)
      ? parsed.warnings.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 240)).slice(0, 12)
      : [];
    if (rawCategory && !matchedCategory) warnings.push("A categoria sugerida pelo OCR não corresponde a uma categoria ativa e foi descartada.");

    const documentKind = ["utility_bill", "bill", "receipt", "invoice", "payment_slip", "pix_charge", "other"].includes(String(parsed.document_kind))
      ? String(parsed.document_kind)
      : "other";
    const paymentStatus = ["pending", "paid", "unknown"].includes(String(parsed.payment_status))
      ? String(parsed.payment_status)
      : "unknown";
    const metadata = {
      ...((extraction.result_metadata && typeof extraction.result_metadata === "object") ? extraction.result_metadata : {}),
      extraction_kind: "mobile_document",
      document_kind: documentKind,
      merchant_name: cleanText(parsed.merchant_name, 160),
      description: cleanText(parsed.description, 240),
      amount: finitePositive(parsed.amount),
      due_date: isoDate(parsed.due_date),
      document_date: isoDate(parsed.document_date),
      reference_period: cleanText(parsed.reference_period, 80),
      payment_status: paymentStatus,
      category_hint: matchedCategory,
      field_confidence: confidenceMap(parsed.field_confidence),
      warnings,
      requires_human_review: true,
    };

    const documentConfidence = clampConfidence(parsed.document_confidence);
    const { error: completeError } = await supabase
      .from("mf_document_extractions")
      .update({
        status: "reviewing",
        document_confidence: documentConfidence,
        result_metadata: metadata,
        completed_at: new Date().toISOString(),
      })
      .eq("id", extractionId)
      .eq("user_id", userData.user.id);
    if (completeError) throw completeError;

    return json({ extractionId, status: "reviewing", documentConfidence, metadata });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha inesperada no OCR/IA.";
    if (extractionId) {
      await supabase
        .from("mf_document_extractions")
        .update({ status: "failed", error_message: message.slice(0, 1000), completed_at: new Date().toISOString() })
        .eq("id", extractionId)
        .eq("user_id", userData.user.id);
    }
    return json({ error: message }, 400);
  }
});
