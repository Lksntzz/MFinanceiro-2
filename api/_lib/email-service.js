const RESEND_URL = "https://api.resend.com/emails";

function normalizeAdminEmails(raw) {
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function buildAccessRequestEmail({ name, email, date }) {
  return {
    subject: "Nova solicitacao de acesso - MFinanceiro",
    text: [
      "Voce recebeu uma nova solicitacao de acesso ao MFinanceiro.",
      "",
      `Nome: ${name}`,
      `E-mail: ${email}`,
      `Data: ${date}`,
      "",
      "Acesse o painel administrativo ou o Supabase para aprovar ou negar a solicitacao.",
    ].join("\n"),
  };
}

export async function sendAdminAccessRequestEmail({ name, email }) {
  const resendApiKey = process.env.RESEND_API_KEY;
  const from = process.env.ACCESS_REQUEST_EMAIL_FROM || process.env.EMAIL_FROM;
  const to = normalizeAdminEmails(process.env.ACCESS_REQUEST_ADMIN_EMAILS || process.env.ADMIN_EMAILS);

  if (!resendApiKey || !from || to.length === 0) {
    return { sent: false, reason: "email_env_not_configured" };
  }

  const date = new Date().toISOString();
  const template = buildAccessRequestEmail({ name, email, date });

  const response = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject: template.subject,
      text: template.text,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { sent: false, reason: `email_send_failed:${response.status}:${body}` };
  }

  return { sent: true };
}

