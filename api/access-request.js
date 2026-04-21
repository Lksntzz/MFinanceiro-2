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

function statusMessage(status) {
  if (status === "approved") return "Acesso aprovado. Voce ja pode concluir o cadastro.";
  if (status === "denied") return "Acesso negado. Entre em contato com o administrador.";
  if (status === "pending") return "Solicitacao enviada com sucesso. Aguarde aprovacao do administrador.";
  return "Solicitacao registrada.";
}

function getSupabaseAdminClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return {
      client: null,
      hasUrl: !!url,
      hasServiceRoleKey: !!key,
    };
  }

  return {
    client: createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    }),
    hasUrl: true,
    hasServiceRoleKey: true,
  };
}

function isFunctionMissingError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return code === "42883" || (message.includes("function") && message.includes("does not exist"));
}

async function saveAccessRequest(supabase, name, email) {
  const firstTry = await supabase.rpc("mf_request_access", {
    p_name: name,
    p_email: email,
  });

  if (!firstTry.error) {
    return { data: firstTry.data, rpcUsed: "mf_request_access" };
  }

  console.error("Supabase RPC mf_request_access error:", {
    code: firstTry.error.code,
    message: firstTry.error.message,
    details: firstTry.error.details,
    hint: firstTry.error.hint,
  });

  if (!isFunctionMissingError(firstTry.error)) {
    throw firstTry.error;
  }

  const fallbackTry = await supabase.rpc("submit_access_request", {
    p_nome: name,
    p_email: email,
  });

  if (fallbackTry.error) {
    console.error("Supabase RPC submit_access_request error:", {
      code: fallbackTry.error.code,
      message: fallbackTry.error.message,
      details: fallbackTry.error.details,
      hint: fallbackTry.error.hint,
    });
    throw fallbackTry.error;
  }

  return { data: fallbackTry.data, rpcUsed: "submit_access_request" };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Metodo nao permitido." });
  }

  const envPresence = {
    BREVO_API_KEY: !!process.env.BREVO_API_KEY,
    ADMIN_NOTIFICATION_EMAIL: !!process.env.ADMIN_NOTIFICATION_EMAIL,
    ACCESS_REQUEST_SENDER_EMAIL: !!process.env.ACCESS_REQUEST_SENDER_EMAIL,
    ACCESS_REQUEST_SENDER_NAME: !!process.env.ACCESS_REQUEST_SENDER_NAME,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_URL: !!(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL),
  };
  console.info("access-request env presence:", envPresence);

  try {
    const { client: supabase, hasUrl, hasServiceRoleKey } = getSupabaseAdminClient();
    if (!supabase) {
      console.error("access-request config error:", {
        SUPABASE_URL: hasUrl,
        SUPABASE_SERVICE_ROLE_KEY: hasServiceRoleKey,
      });
      return res.status(500).json({ message: "Configuracao de servidor incompleta." });
    }

    const name = normalizeName(req.body?.name);
    const email = normalizeEmail(req.body?.email);

    if (!name) {
      return res.status(400).json({ message: "Nome obrigatorio." });
    }
    if (!email) {
      return res.status(400).json({ message: "E-mail obrigatorio." });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ message: "E-mail invalido." });
    }

    let saveResult;
    try {
      saveResult = await saveAccessRequest(supabase, name, email);
    } catch (error) {
      console.error("Falha ao salvar solicitacao no Supabase:", {
        code: error?.code,
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
      });
      return res.status(500).json({
        message: "Falha ao registrar solicitacao no Supabase.",
        stage: "supabase_save",
      });
    }

    const row = Array.isArray(saveResult.data) ? saveResult.data[0] : null;
    const status = row?.status || "pending";

    let emailSent = false;
    let emailWarning = null;

    if (status === "pending") {
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
        console.error("Falha ao enviar e-mail de notificacao ao administrador:", {
          reason: emailWarning,
          httpStatus: emailResult.httpStatus || null,
          body: emailResult.body || null,
          error: emailResult.error || null,
        });
      }
    }

    return res.status(200).json({
      status,
      message: statusMessage(status),
      emailSent,
      warning: emailWarning,
      rpcUsed: saveResult.rpcUsed,
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

