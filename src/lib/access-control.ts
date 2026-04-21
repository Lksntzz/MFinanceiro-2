import { supabase } from "./supabase";

export type AccessRequestStatus = "pending" | "approved" | "denied" | "not_found";

interface AccessStatusRow {
  status: AccessRequestStatus;
  name: string | null;
  email: string | null;
  approved_at: string | null;
  note: string | null;
}

export interface AccessRequestResponse {
  status: AccessRequestStatus;
  message: string;
  emailSent?: boolean;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function fetchAccessStatus(email: string): Promise<AccessRequestStatus> {
  const normalized = normalizeEmail(email);
  if (!normalized) return "not_found";

  const { data, error } = await supabase.rpc("mf_get_access_status", {
    p_email: normalized,
  });

  if (error) {
    throw error;
  }

  const row = Array.isArray(data) ? (data[0] as AccessStatusRow | undefined) : undefined;
  return row?.status ?? "not_found";
}

export async function requestAccess(name: string, email: string): Promise<AccessRequestResponse> {
  const normalized = normalizeEmail(email);
  const trimmedName = name.trim();
  const response = await fetch("/api/access-request", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: trimmedName,
      email: normalized,
    }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const serverMessage = String(payload?.message || "").trim();
    if (serverMessage) {
      throw new Error(serverMessage);
    }
    if (response.status === 404 || response.status === 405) {
      throw new Error("Endpoint /api/access-request indisponivel na versao publicada. Atualize o deploy de producao.");
    }
    throw new Error(`Falha ao registrar solicitacao (HTTP ${response.status}).`);
  }

  const status = String(payload?.status || "pending") as AccessRequestStatus;
  return {
    status,
    message: String(payload?.message || "Solicitacao enviada com sucesso."),
    emailSent: payload?.emailSent === true,
  };
}

export function getAccessStatusMessage(status: AccessRequestStatus): string {
  if (status === "approved") {
    return "Seu e-mail esta aprovado. Agora voce pode concluir o cadastro.";
  }
  if (status === "pending") {
    return "Sua solicitacao esta pendente de aprovacao do administrador.";
  }
  if (status === "denied") {
    return "Seu acesso foi negado. Entre em contato com o administrador para revisao.";
  }
  return "Seu e-mail ainda nao possui solicitacao. Envie um pedido de acesso.";
}

export function mapSignupErrorMessage(rawMessage: string): string {
  const msg = rawMessage || "";
  if (msg.includes("MF_ACCESS_DENIED")) {
    return "Cadastro bloqueado: este e-mail ainda nao foi aprovado.";
  }
  return rawMessage;
}
