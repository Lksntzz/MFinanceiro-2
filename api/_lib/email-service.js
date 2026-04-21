const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

export function buildAccessRequestEmail({ name, email, date }) {
  return {
    subject: "Nova solicitação de acesso - MFinanceiro",
    text: [
      "Você recebeu uma nova solicitação de acesso ao MFinanceiro.",
      "",
      `Nome: ${name}`,
      `E-mail: ${email}`,
      `Data: ${date}`,
      "",
      "Acesse o painel administrativo ou o Supabase para aprovar ou negar a solicitação.",
    ].join("\n"),
  };
}

export async function sendAdminAccessRequestEmail({ name, email }) {
  const brevoApiKey = process.env.BREVO_API_KEY;
  const adminEmail = String(process.env.ADMIN_NOTIFICATION_EMAIL || "").trim().toLowerCase();
  const senderEmail = String(process.env.ACCESS_REQUEST_SENDER_EMAIL || adminEmail).trim().toLowerCase();
  const senderName = String(process.env.ACCESS_REQUEST_SENDER_NAME || "MFinanceiro").trim();

  if (!brevoApiKey || !adminEmail || !senderEmail) {
    return { sent: false, reason: "email_env_not_configured" };
  }

  const date = new Date().toISOString();
  const template = buildAccessRequestEmail({ name, email, date });

  const response = await fetch(BREVO_URL, {
    method: "POST",
    headers: {
      "api-key": brevoApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: {
        name: senderName,
        email: senderEmail,
      },
      to: [{ email: adminEmail }],
      subject: template.subject,
      textContent: template.text,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { sent: false, reason: `email_send_failed:${response.status}:${body}` };
  }

  return { sent: true };
}
