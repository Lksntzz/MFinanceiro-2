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
  const { error } = await supabase.rpc("submit_access_request", {
    p_nome: trimmedName,
    p_email: normalized,
  });

  if (error) {
    console.error("Erro ao registrar solicitacao de acesso:", error);
    throw error;
  }

  const status: AccessRequestStatus = "pending";
  return {
    status,
    message: "Solicitacao enviada com sucesso. Aguarde aprovacao do administrador.",
    emailSent: false,
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
