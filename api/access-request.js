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
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Metodo nao permitido." });
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
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

  const { data, error } = await supabase.rpc("mf_request_access", {
    p_name: name,
    p_email: email,
  });

  if (error) {
    return res.status(500).json({ message: "Falha ao registrar solicitacao.", details: error.message });
  }

  const row = Array.isArray(data) ? data[0] : null;
  const status = row?.status || "pending";

  let emailSent = false;
  let emailWarning = null;

  if (status === "pending") {
    const emailResult = await sendAdminAccessRequestEmail({ name, email });
    emailSent = emailResult.sent === true;
    if (!emailSent) {
      emailWarning = emailResult.reason || "email_not_sent";
      console.error("Falha ao enviar e-mail de notificação ao administrador:", emailWarning);
    }
  }

  return res.status(200).json({
    status,
    message: statusMessage(status),
    emailSent,
    warning: emailWarning,
  });
}
