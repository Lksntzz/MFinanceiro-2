import { createClient } from "@supabase/supabase-js";
import { sendAdminAccessRequestEmail } from "./_lib/email-service.js";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeName(name) {
  return String(name || "").trim();
}

function isValidEmail(email) {
  return /^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$/i.test(email);
}

function normalizeStatus(rawStatus) {
  const value = String(rawStatus || "").toLowerCase();
  if (["approved", "aprovado"].includes(value)) return "approved";
  if (["denied", "negado", "rejected"].includes(value)) return "denied";
  return "pending";
}

function statusMessage(status) {
  if (status === "approved") return "Acesso aprovado. Voce ja pode concluir o cadastro.";
  if (status === "denied") return "Acesso negado. Entre em contato com o administrador.";
  return "Solicitacao enviada com sucesso. Aguarde aprovacao do administrador.";
}

function getSupabaseAdminClient() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return {
      client: null,
      hasUrl: !!url,
      hasServiceRoleKey: !!serviceRoleKey,
    };
  }

  return {
    client: createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    }),
    hasUrl: true,
    hasServiceRoleKey: true,
  };
}

function isColumnMismatch(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("column") && message.includes("does not exist")
  );
}

async function persistUsingSchemaVariant(supabase, variant, name, email) {
  const table = "mf_access_requests";

  const selectResult = await supabase
    .from(table)
    .select("id,status,email,updated_at,created_at")
    .ilike("email", email)
    .limit(1);

  if (selectResult.error) {
    throw selectResult.error;
  }

  const existing = Array.isArray(selectResult.data) ? selectResult.data[0] : null;
  const existingStatus = normalizeStatus(existing?.status);
  const statusToStore =
    existingStatus === "approved" || existingStatus === "denied"
      ? existingStatus
      : "pending";
  const nowMs = Date.now();
  const existingUpdatedAtMs = existing?.updated_at ? new Date(existing.updated_at).getTime() : 0;
  const repeatedPendingWithinCooldown =
    existingStatus === "pending" &&
    Number.isFinite(existingUpdatedAtMs) &&
    existingUpdatedAtMs > 0 &&
    nowMs - existingUpdatedAtMs < 2 * 60 * 1000;

  const mappedStatus =
    variant.kind === "pt"
      ? statusToStore === "approved"
        ? "aprovado"
        : statusToStore === "denied"
          ? "negado"
          : "pendente"
      : statusToStore;

  if (existing?.id) {
    const updatePayload =
      variant.kind === "pt"
        ? {
            nome: name,
            email,
            status: mappedStatus,
            observacao: null,
          }
        : {
            name,
            email,
            status: mappedStatus,
            note: null,
          };

    const updateResult = await supabase
      .from(table)
      .update(updatePayload)
      .eq("id", existing.id)
      .select("status")
      .limit(1);

    if (updateResult.error) {
      throw updateResult.error;
    }

    const row = Array.isArray(updateResult.data) ? updateResult.data[0] : null;
    return {
      status: normalizeStatus(row?.status || mappedStatus),
      operation: "update",
      schemaVariant: variant.kind,
      notifyEmail: statusToStore === "pending" && !repeatedPendingWithinCooldown,
      notificationSuppressedReason: repeatedPendingWithinCooldown
        ? "duplicate_pending_within_cooldown"
        : null,
    };
  }

  const insertPayload =
    variant.kind === "pt"
      ? {
          nome: name,
          email,
          status: mappedStatus,
          observacao: null,
          aprovado_por: null,
          aprovado_em: null,
        }
      : {
          name,
          email,
          status: mappedStatus,
          note: null,
          approved_by: null,
          approved_at: null,
        };

  const insertResult = await supabase
    .from(table)
    .insert(insertPayload)
    .select("status")
    .limit(1);

  if (insertResult.error) {
    throw insertResult.error;
  }

  const row = Array.isArray(insertResult.data) ? insertResult.data[0] : null;
  return {
    status: normalizeStatus(row?.status || mappedStatus),
    operation: "insert",
    schemaVariant: variant.kind,
    notifyEmail: statusToStore === "pending",
    notificationSuppressedReason: null,
  };
}

async function saveAccessRequest(supabase, name, email) {
  const variants = [{ kind: "pt" }, { kind: "en" }];
  const errors = [];

  for (const variant of variants) {
    try {
      const result = await persistUsingSchemaVariant(supabase, variant, name, email);
      return result;
    } catch (error) {
      errors.push({
        variant: variant.kind,
        code: error?.code,
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
      });

      console.error("Supabase save attempt failed:", {
        variant: variant.kind,
        code: error?.code,
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
      });

      if (!isColumnMismatch(error)) {
        throw error;
      }
    }
  }

  const err = new Error("No compatible schema variant found for mf_access_requests.");
  err.details = errors;
  throw err;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Metodo nao permitido." });
  }

  const envPresence = {
    SUPABASE_URL: !!process.env.SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    BREVO_API_KEY: !!process.env.BREVO_API_KEY,
    ADMIN_NOTIFICATION_EMAIL: !!process.env.ADMIN_NOTIFICATION_EMAIL,
    ACCESS_REQUEST_SENDER_EMAIL: !!process.env.ACCESS_REQUEST_SENDER_EMAIL,
    ACCESS_REQUEST_SENDER_NAME: !!process.env.ACCESS_REQUEST_SENDER_NAME,
  };
  console.info("access-request env presence:", envPresence);

  try {
    const { client: supabase, hasUrl, hasServiceRoleKey } = getSupabaseAdminClient();
    if (!supabase) {
      console.error("Supabase client config error:", {
        hasSupabaseUrl: hasUrl,
        hasServiceRoleKey,
      });
      return res.status(500).json({ message: "Configuracao de servidor incompleta." });
    }

    const name = normalizeName(req.body?.name);
    const email = normalizeEmail(req.body?.email);

    if (!name) return res.status(400).json({ message: "Nome obrigatorio." });
    if (!email) return res.status(400).json({ message: "E-mail obrigatorio." });
    if (!isValidEmail(email)) return res.status(400).json({ message: "E-mail invalido." });

    let saveResult;
    try {
      saveResult = await saveAccessRequest(supabase, name, email);
      console.info("Supabase save success:", {
        operation: saveResult.operation,
        schemaVariant: saveResult.schemaVariant,
        normalizedStatus: saveResult.status,
      });
    } catch (error) {
      console.error("Falha ao salvar solicitacao no Supabase:", {
        code: error?.code || null,
        message: error?.message || String(error),
        details: error?.details || null,
        hint: error?.hint || null,
        schemaErrors: error?.details || null,
      });
      return res.status(500).json({
        message: "Falha ao registrar solicitacao no Supabase.",
        stage: "supabase_save",
      });
    }

    const status = saveResult.status || "pending";
    let emailSent = false;
    let emailWarning = null;

    if (status === "pending" && saveResult.notifyEmail !== false) {
      const emailResult = await sendAdminAccessRequestEmail({ name, email });
      emailSent = emailResult.sent === true;

      console.info("Brevo response:", {
        sent: emailResult.sent,
        httpStatus: emailResult.httpStatus || null,
        body: emailResult.body || null,
        reason: emailResult.reason || null,
      });

      if (!emailSent) {
        emailWarning = emailResult.reason || "email_not_sent";
        console.error("Falha no envio de e-mail apos gravacao:", {
          reason: emailWarning,
          httpStatus: emailResult.httpStatus || null,
          body: emailResult.body || null,
          error: emailResult.error || null,
        });
      }
    } else if (status === "pending" && saveResult.notifyEmail === false) {
      emailWarning = saveResult.notificationSuppressedReason || "email_suppressed";
      console.info("Notificacao de e-mail suprimida para evitar duplicidade:", {
        reason: emailWarning,
      });
    }

    return res.status(200).json({
      status,
      message: statusMessage(status),
      emailSent,
      warning: emailWarning,
    });
  } catch (error) {
    console.error("Erro inesperado em /api/access-request:", {
      message: error?.message || String(error),
      stack: error?.stack || null,
    });
    return res.status(500).json({
      message: "Erro interno inesperado no endpoint de solicitacao.",
      stage: "unexpected",
    });
  }
}
