import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const responseSchema = {
  type: "object",
  properties: {
    document_confidence: { type: "number", minimum: 0, maximum: 1 },
    institution_name: { type: ["string", "null"] },
    period_start: { type: ["string", "null"], description: "ISO date YYYY-MM-DD" },
    period_end: { type: ["string", "null"], description: "ISO date YYYY-MM-DD" },
    statement_balance: { type: ["number", "null"] },
    warnings: { type: "array", items: { type: "string" } },
    transactions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: ["string", "null"], description: "ISO date YYYY-MM-DD" },
          description: { type: ["string", "null"] },
          amount: { type: ["number", "null"], description: "Always positive" },
          type: { type: ["string", "null"], enum: ["income", "expense", null] },
          category: { type: ["string", "null"] },
          source: { type: ["string", "null"] },
          external_id: { type: ["string", "null"] },
          running_balance: { type: ["number", "null"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          field_confidence: {
            type: "object",
            additionalProperties: { type: "number", minimum: 0, maximum: 1 },
          },
        },
        required: ["date", "description", "amount", "type", "category", "source", "external_id", "running_balance", "confidence", "field_confidence"],
      },
    },
  },
  required: ["document_confidence", "institution_name", "period_start", "period_end", "statement_balance", "warnings", "transactions"],
};

type JsonRecord = Record<string, unknown>;

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

function clampConfidence(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0;
}

function isoDate(value: unknown): string | null {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
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

function asRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is JsonRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function learningPrompt(hints: JsonRecord[]) {
  if (!hints.length) return "";
  const lines = hints.slice(0, 20).map((hint) => {
    const pattern = String(hint.pattern || "").slice(0, 80);
    const category = String(hint.category_name || "").slice(0, 80);
    const type = hint.transaction_type === "income" ? "income" : "expense";
    const confirmations = Math.max(0, Number(hint.confirmations || 0));
    const confidence = Math.round(clampConfidence(hint.confidence) * 100);
    return `- texto contém “${pattern}” e type=${type} → categoria “${category}” (${confirmations} revisões, ${confidence}% consistência)`;
  });
  return [
    "Aprendizados de categorização confirmados pelo próprio usuário:",
    ...lines,
    "Use esses aprendizados somente para o campo category e apenas quando a descrição visível realmente corresponder ao padrão.",
    "Nunca use o histórico aprendido para inventar ou alterar data, valor, descrição, saldo, type ou external_id.",
  ].join("\n");
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
  const model = Deno.env.get("GEMINI_OCR_MODEL") || "gemini-3.6-flash";
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
      .select("id,user_id,account_id,source_file_path,source_file_name,source_mime_type,source_file_size,status")
      .eq("id", extractionId)
      .eq("user_id", userData.user.id)
      .single();
    if (extractionError || !extraction) throw new Error("Análise não encontrada.");
    if (!["uploaded", "failed"].includes(extraction.status)) throw new Error("Este documento já está sendo processado ou revisado.");

    const { error: startError } = await supabase
      .from("mf_document_extractions")
      .update({ status: "processing", provider: "google-gemini", model, error_message: null, started_at: new Date().toISOString() })
      .eq("id", extractionId)
      .eq("user_id", userData.user.id);
    if (startError) throw startError;

    let adaptiveHints: JsonRecord[] = [];
    const { data: hintData, error: hintError } = await supabase.rpc("mf_get_adaptive_ocr_hints", {
      p_account_id: extraction.account_id || null,
      p_limit: 20,
    });
    if (hintError) {
      console.warn("Adaptive OCR hints unavailable", hintError.message);
    } else {
      adaptiveHints = asRecords(hintData);
    }

    const { data: file, error: downloadError } = await supabase.storage
      .from("mf-import-documents")
      .download(extraction.source_file_path);
    if (downloadError || !file) throw new Error("Não foi possível ler o documento privado enviado.");

    const base64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
    const fileType = extraction.source_mime_type === "application/pdf" ? "document" : "image";
    const learnedContext = learningPrompt(adaptiveHints);
    const aiResponse = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": geminiApiKey },
      body: JSON.stringify({
        model,
        input: [
          {
            type: "text",
            text: [
              "Extraia apenas transações realmente visíveis neste extrato financeiro brasileiro.",
              "Não invente datas, descrições, valores, saldos ou identificadores.",
              "Use amount positivo e type income/expense. Preserve o texto do estabelecimento.",
              "Dê confiança de 0 a 1 por linha e por campo. Se houver dúvida, reduza a confiança.",
              "Itens com confiança baixa serão obrigatoriamente revisados por uma pessoa.",
              learnedContext,
            ].filter(Boolean).join("\n"),
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
    const transactions = Array.isArray(parsed.transactions) ? parsed.transactions : [];
    if (transactions.length > 2000) throw new Error("O documento excedeu o limite de 2.000 lançamentos.");

    const ruleInput = transactions.map((raw, index) => {
      const item = raw as JsonRecord;
      const amount = Math.abs(Number(item.amount || 0));
      const type = item.type === "income" || item.type === "expense" ? item.type : "expense";
      return {
        id: String(index + 1),
        description: String(item.description || ""),
        source: String(item.source || parsed.institution_name || "OCR/IA"),
        amount: type === "expense" ? -amount : amount,
        type,
        account_id: extraction.account_id || null,
      };
    });

    let rulePreview = new Map<string, JsonRecord>();
    const { data: previewData, error: previewError } = await supabase.rpc("mf_preview_categorization_rules", {
      p_entries: ruleInput,
    });
    if (previewError) {
      console.warn("Categorization rule preview unavailable", previewError.message);
    } else {
      rulePreview = new Map(
        asRecords(previewData).map((preview) => [String(preview.entry_id || ""), preview]),
      );
    }

    let appliedRuleCount = 0;
    const items = transactions.map((raw, index) => {
      const item = raw as Record<string, unknown>;
      const amount = Math.abs(Number(item.amount || 0));
      const type = item.type === "income" || item.type === "expense" ? item.type : null;
      const confidence = clampConfidence(item.confidence);
      const valid = Boolean(isoDate(item.date) && String(item.description || "").trim() && amount > 0 && type);
      const preview = rulePreview.get(String(index + 1));
      const hasRule = Boolean(preview?.rule_id && preview?.category_name);
      if (hasRule) appliedRuleCount += 1;
      const categoryName = hasRule
        ? String(preview?.category_name || "Geral")
        : String(item.category || "Geral");
      const modelFieldConfidence = item.field_confidence && typeof item.field_confidence === "object"
        ? item.field_confidence as JsonRecord
        : {};
      const ruleConfidence = hasRule ? clampConfidence(preview?.confidence) : 0;
      const categoryConfidence = Math.max(clampConfidence(modelFieldConfidence.category), ruleConfidence);

      return {
        extraction_id: extractionId,
        user_id: userData.user.id,
        line_number: index + 1,
        transaction_date: isoDate(item.date),
        description: String(item.description || "").trim().slice(0, 240) || null,
        signed_amount: valid ? (type === "expense" ? -amount : amount) : null,
        transaction_type: type,
        source_name: String(item.source || parsed.institution_name || "OCR/IA").trim().slice(0, 120),
        external_id: String(item.external_id || "").trim().slice(0, 240) || null,
        running_balance: Number.isFinite(Number(item.running_balance)) ? Number(item.running_balance) : null,
        category_id: hasRule ? String(preview?.category_id || "") || null : null,
        category_name: categoryName.trim().slice(0, 120),
        overall_confidence: valid ? confidence : Math.min(confidence, 0.4),
        field_confidence: {
          ...modelFieldConfidence,
          category: categoryConfidence,
        },
        review_status: "pending",
        raw_payload: {
          ...item,
          model_category: item.category || null,
          categorization_rule: hasRule ? {
            id: preview?.rule_id,
            name: preview?.rule_name,
            origin: preview?.rule_origin || "manual",
            confidence: ruleConfidence,
          } : null,
        },
      };
    });

    const { error: clearError } = await supabase
      .from("mf_document_extraction_items")
      .delete()
      .eq("extraction_id", extractionId)
      .eq("user_id", userData.user.id);
    if (clearError) throw clearError;
    let storedItems: Record<string, unknown>[] = [];
    if (items.length) {
      const { data: insertedItems, error: insertError } = await supabase
        .from("mf_document_extraction_items")
        .insert(items)
        .select("id,line_number,transaction_date,description,signed_amount,transaction_type,source_name,external_id,running_balance,category_name,overall_confidence,field_confidence,review_status");
      if (insertError) throw insertError;
      storedItems = insertedItems || [];
    }

    const metadata = {
      institution_name: parsed.institution_name || null,
      period_start: isoDate(parsed.period_start),
      period_end: isoDate(parsed.period_end),
      statement_balance: Number.isFinite(Number(parsed.statement_balance)) ? Number(parsed.statement_balance) : null,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.slice(0, 20) : [],
      item_count: items.length,
      requires_human_review: true,
      adaptive_hint_count: adaptiveHints.length,
      categorization_rules_applied: appliedRuleCount,
    };
    const { error: completeError } = await supabase
      .from("mf_document_extractions")
      .update({
        status: "reviewing",
        document_confidence: clampConfidence(parsed.document_confidence),
        result_metadata: metadata,
        completed_at: new Date().toISOString(),
      })
      .eq("id", extractionId)
      .eq("user_id", userData.user.id);
    if (completeError) throw completeError;

    return json({
      extractionId,
      status: "reviewing",
      documentConfidence: clampConfidence(parsed.document_confidence),
      warnings: metadata.warnings,
      adaptiveHintCount: adaptiveHints.length,
      rulesApplied: appliedRuleCount,
      items: storedItems,
    });
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
