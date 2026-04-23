import { supabase } from "./supabase";

export type AccessRequestStatus = "pending" | "approved" | "denied" | "none";

export async function fetchAccessStatus(email: string): Promise<AccessRequestStatus> {
  if (!supabase) return "none";

  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return "none";

  try {
    const { data, error } = await supabase
      .from("mf_access_requests")
      .select("status")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (error) throw error;
    if (!data?.status) return "none";

    const status = String(data.status).toLowerCase();

    if (status === "approved" || status === "aprovado") return "approved";
    if (status === "denied" || status === "negado" || status === "rejected") return "denied";
    return "pending";
  } catch (err) {
    console.error("Error fetching access status:", err);
    return "none";
  }
}

export function getAccessStatusMessage(status: AccessRequestStatus): string {
  switch (status) {
    case "approved":
      return "Seu acesso foi aprovado! Agora você pode finalizar seu cadastro.";
    case "pending":
      return "Sua solicitação está em análise. Você receberá um e-mail quando for aprovada.";
    case "denied":
      return "Infelizmente sua solicitação de acesso foi negada. Entre em contato com o suporte.";
    default:
      return "Você ainda não possui uma solicitação de acesso vinculada a este e-mail.";
  }
}

export async function requestAccess(name: string, email: string, password?: string) {
  if (!supabase) throw new Error("Supabase not configured");

  const normalizedName = String(name || "").trim();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedPassword = String(password || "").trim();

  if (!normalizedName) throw new Error("Informe seu nome para solicitar acesso.");
  if (!normalizedEmail) throw new Error("Informe seu e-mail para solicitar acesso.");
  if (!normalizedPassword) throw new Error("Informe uma senha para prosseguir.");

  try {
    console.log("requestAccess payload", {
      name: normalizedName,
      email: normalizedEmail,
      password: normalizedPassword,
      status: "pending",
    });

    const { data, error } = await supabase
      .from("mf_access_requests")
      .insert({
        name: normalizedName,
        email: normalizedEmail,
        password: normalizedPassword,
        status: "pending",
      })
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") {
        throw new Error("Já existe uma solicitação para este e-mail.");
      }
      throw error;
    }

    return data;
  } catch (err: any) {
    console.error("Request access error:", err);
    throw err;
  }
}

export function mapSignupErrorMessage(message: string): string {
  const msg = String(message || "").toLowerCase();

  if (msg.includes("user already registered")) return "Este e-mail já está cadastrado.";
  if (msg.includes("email not confirmed")) return "E-mail ainda não confirmado. Verifique sua caixa de entrada.";
  if (msg.includes("invalid login credentials")) return "E-mail ou senha incorretos.";
  if (msg.includes("violates not-null constraint")) return "Não foi possível salvar a solicitação. Verifique os campos obrigatórios.";
  if (msg.includes("row-level security")) return "Sua solicitação foi bloqueada pela política de acesso do banco.";
  return message;
}