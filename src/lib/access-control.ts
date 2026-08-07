import { supabase } from "./supabase";

export type AccessRequestStatus = "pending" | "approved" | "denied" | "none";
export type ResolvedAuthState = "account" | "pending" | "approved" | "denied" | "new";

function normalizeStatus(raw: unknown): AccessRequestStatus {
  const status = String(raw || "").toLowerCase();
  if (status === "approved" || status === "aprovado") return "approved";
  if (status === "denied" || status === "negado" || status === "rejected") return "denied";
  if (status === "pending" || status === "pendente") return "pending";
  return "none";
}

function normalizeResolvedState(raw: unknown): ResolvedAuthState | null {
  const state = String(raw || "").trim().toLowerCase();
  if (state === "account" || state === "pending" || state === "approved" || state === "denied" || state === "new") {
    return state;
  }
  return null;
}

export async function resolveAuthState(email: string): Promise<ResolvedAuthState> {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) throw new Error("Informe seu e-mail para continuar.");

  const { data, error } = await supabase.functions.invoke("resolve-auth-state", {
    body: { email: normalizedEmail },
  });

  if (error) {
    console.error("Error resolving auth state:", error);
    throw new Error("Não foi possível verificar sua conta agora. Tente novamente em instantes.");
  }

  const state = normalizeResolvedState((data as any)?.state);
  if (!state) throw new Error("Não foi possível identificar o estado da sua conta.");
  return state;
}

export async function fetchAccessStatus(email: string): Promise<AccessRequestStatus> {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return "none";

  try {
    const { data, error } = await supabase.rpc("check_access_request_status", {
      p_email: normalizedEmail,
    });

    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return normalizeStatus(row?.status);
  } catch (err) {
    console.error("Error fetching access status:", err);
    return "none";
  }
}

export function getAccessStatusMessage(status: AccessRequestStatus): string {
  switch (status) {
    case "approved":
      return "Seu acesso foi aprovado. Agora você pode ativar sua conta.";
    case "pending":
      return "Sua solicitação está em análise. Esta tela será atualizada automaticamente quando houver uma decisão.";
    case "denied":
      return "Sua solicitação de acesso foi negada. Entre em contato com o suporte.";
    default:
      return "Não encontramos uma solicitação vinculada a este e-mail.";
  }
}

export async function requestAccess(name: string, email: string) {
  const normalizedName = String(name || "").trim();
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!normalizedName) throw new Error("Informe seu nome para solicitar acesso.");
  if (!normalizedEmail) throw new Error("Informe seu e-mail para solicitar acesso.");

  const { data, error } = await supabase.rpc("submit_access_request", {
    p_nome: normalizedName,
    p_email: normalizedEmail,
  });

  if (error) {
    const message = String(error.message || "").toLowerCase();
    if (message.includes("email_invalido")) throw new Error("Informe um e-mail válido.");
    if (message.includes("nome_obrigatorio")) throw new Error("Informe seu nome.");
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    id: row?.request_id ?? null,
    status: normalizeStatus(row?.status),
    message: row?.message ?? "solicitacao_recebida",
  };
}

export function mapSignupErrorMessage(message: string): string {
  const msg = String(message || "").toLowerCase();

  if (msg.includes("user already registered")) return "Este e-mail já está cadastrado.";
  if (msg.includes("email not confirmed")) return "E-mail ainda não confirmado. Verifique sua caixa de entrada.";
  if (msg.includes("invalid login credentials")) return "E-mail ou senha incorretos.";
  if (msg.includes("password should be at least")) return "A senha não atende aos requisitos mínimos de segurança.";
  if (msg.includes("row-level security")) return "A operação foi bloqueada pela política de segurança do banco.";
  return message;
}
