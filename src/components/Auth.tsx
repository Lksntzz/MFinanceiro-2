import React, { useEffect, useRef, useState } from "react";
import { CheckCircle2, Github, LogIn, Mail, ShieldCheck, UserPlus, Wallet } from "lucide-react";
import { supabase } from "../lib/supabase";
import {
  mapSignupErrorMessage,
  requestAccess,
  resolveAuthState,
  type ResolvedAuthState,
} from "../lib/access-control";

type AuthMode =
  | "request"
  | "login"
  | "pending"
  | "activate"
  | "confirm-email"
  | "confirmed"
  | "denied"
  | "admin";

const STORAGE_EMAIL = "mf-auth-email";
const STORAGE_NAME = "mf-auth-name";
const AWAITING_CONFIRMATION_EMAIL = "mf-awaiting-email-confirmation";
const CONFIRMED_EMAIL_STORAGE = "mf-confirmed-email";
const ADMIN_LOGIN_PATH = "/admin-login";
const ADMIN_OAUTH_INTENT = "mf-admin-oauth-intent";

function readLocal(key: string) {
  try {
    return window.localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function writeLocal(key: string, value: string) {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable without breaking the auth flow.
  }
}

function readSession(key: string) {
  try {
    return window.sessionStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function writeSession(key: string, value: string) {
  try {
    if (value) window.sessionStorage.setItem(key, value);
    else window.sessionStorage.removeItem(key);
  } catch {
    // Session storage is only a convenience for the confirmation return screen.
  }
}

function isAdminRoute() {
  return window.location.pathname.replace(/\/+$/, "") === ADMIN_LOGIN_PATH;
}

function isConfirmationReturn() {
  return new URLSearchParams(window.location.search).get("email_confirmed") === "1";
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim().toLowerCase());
}

function loginStateMessage(state: ResolvedAuthState) {
  if (state === "pending") return "Sua solicitação ainda está aguardando aprovação.";
  if (state === "approved") return "Seu acesso foi aprovado. Volte à solicitação para cadastrar sua senha.";
  if (state === "confirmation_pending") return "Sua conta foi criada, mas o e-mail ainda precisa ser confirmado.";
  if (state === "denied") return "Esta solicitação de acesso não foi aprovada.";
  return "Este e-mail ainda não possui conta. Solicite acesso na tela principal.";
}

export default function Auth() {
  const adminRoute = isAdminRoute();
  const confirmationReturn = !adminRoute && isConfirmationReturn();
  const rememberedEmail = readSession(CONFIRMED_EMAIL_STORAGE) || readLocal(STORAGE_EMAIL);
  const rememberedName = readLocal(STORAGE_NAME);

  const [mode, setMode] = useState<AuthMode>(
    adminRoute ? "admin" : confirmationReturn ? "confirmed" : "request",
  );
  const [name, setName] = useState(rememberedName);
  const [email, setEmail] = useState(rememberedEmail);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [introDone, setIntroDone] = useState(false);
  const requestInFlightRef = useRef(false);
  const lastRequestAtRef = useRef(0);

  const adminDenied = adminRoute && new URLSearchParams(window.location.search).get("denied") === "1";
  const isRequest = mode === "request";
  const isLogin = mode === "login";
  const isPending = mode === "pending";
  const isActivation = mode === "activate";
  const isConfirmEmail = mode === "confirm-email";
  const isConfirmed = mode === "confirmed";
  const isDenied = mode === "denied";
  const isAdmin = mode === "admin";

  useEffect(() => {
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      setIntroDone(true);
      return;
    }
    const timer = window.setTimeout(() => setIntroDone(true), 1450);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isConfirmed) return;

    const syncConfirmedEmail = () => {
      const nextEmail = readSession(CONFIRMED_EMAIL_STORAGE) || readLocal(STORAGE_EMAIL);
      if (nextEmail) setEmail(nextEmail);
    };

    syncConfirmedEmail();
    window.addEventListener("mf:confirmed-email", syncConfirmedEmail);
    return () => window.removeEventListener("mf:confirmed-email", syncConfirmedEmail);
  }, [isConfirmed]);

  function rememberIdentity(normalizedEmail: string, normalizedName = name.trim()) {
    writeLocal(STORAGE_EMAIL, normalizedEmail);
    if (normalizedName) writeLocal(STORAGE_NAME, normalizedName);
  }

  function clearMessages() {
    setError(null);
    setInfo(null);
  }

  function applyResolvedState(state: ResolvedAuthState, automatic = false) {
    setPassword("");
    setError(null);

    if (state === "account") {
      setMode("login");
      setInfo(automatic ? null : "Conta encontrada. Digite sua senha para entrar.");
      return;
    }

    if (state === "confirmation_pending") {
      setMode("confirm-email");
      setInfo("Sua conta foi criada. Confirme o e-mail enviado para continuar.");
      return;
    }

    if (state === "pending") {
      setMode("pending");
      setInfo("Sua solicitação está em análise. A tela será atualizada automaticamente após a aprovação.");
      return;
    }

    if (state === "approved") {
      setMode("activate");
      setName(readLocal(STORAGE_NAME) || name);
      setInfo("Seu acesso foi aprovado. Cadastre sua senha para criar a conta.");
      return;
    }

    if (state === "denied") {
      setMode("denied");
      setInfo(null);
      return;
    }

    setMode("request");
    setInfo(null);
  }

  useEffect(() => {
    if (!isRequest) return;

    const normalizedEmail = email.trim().toLowerCase();
    if (!validEmail(normalizedEmail)) return;

    let active = true;
    const timer = window.setTimeout(async () => {
      setCheckingEmail(true);
      try {
        const state = await resolveAuthState(normalizedEmail);
        if (!active || state === "new") return;
        rememberIdentity(normalizedEmail);
        applyResolvedState(state, true);
      } catch {
        // The request form remains usable if the background lookup is temporarily unavailable.
      } finally {
        if (active) setCheckingEmail(false);
      }
    }, 650);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [email, isRequest]);

  useEffect(() => {
    if (!isPending) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!validEmail(normalizedEmail)) return;

    let active = true;
    const check = async () => {
      try {
        const state = await resolveAuthState(normalizedEmail);
        if (!active || state === "pending") return;
        applyResolvedState(state, true);
      } catch {
        // Background polling stays silent.
      }
    };

    void check();
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);

    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
    };
  }, [email, isPending]);

  async function handleRequestAccess() {
    if (requestInFlightRef.current) return;
    if (Date.now() - lastRequestAtRef.current < 5000) {
      setInfo("Aguarde alguns segundos antes de enviar novamente.");
      return;
    }

    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedName) {
      setError("Informe seu nome para solicitar acesso.");
      return;
    }
    if (!validEmail(normalizedEmail)) {
      setError("Informe um e-mail válido para solicitar acesso.");
      return;
    }

    setLoading(true);
    requestInFlightRef.current = true;
    clearMessages();

    try {
      const existingState = await resolveAuthState(normalizedEmail);
      if (existingState !== "new") {
        rememberIdentity(normalizedEmail, normalizedName);
        applyResolvedState(existingState);
        return;
      }

      const result = await requestAccess(normalizedName, normalizedEmail);
      rememberIdentity(normalizedEmail, normalizedName);

      if (result.status === "approved") applyResolvedState("approved");
      else if (result.status === "pending") applyResolvedState("pending");
      else if (result.status === "denied") applyResolvedState("denied");
      else setInfo("Solicitação enviada. Aguarde a aprovação do administrador.");
    } catch (err: any) {
      setError(String(err?.message || "Falha ao enviar a solicitação de acesso."));
    } finally {
      lastRequestAtRef.current = Date.now();
      requestInFlightRef.current = false;
      setLoading(false);
    }
  }

  async function handleAuth(event: React.FormEvent) {
    event.preventDefault();

    if (isRequest) {
      await handleRequestAccess();
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    setLoading(true);
    clearMessages();

    try {
      if (isActivation) {
        const state = await resolveAuthState(normalizedEmail);

        if (state === "account" || state === "confirmation_pending") {
          applyResolvedState(state);
          return;
        }

        if (state !== "approved") {
          applyResolvedState(state);
          return;
        }

        const redirectTo = `${window.location.origin}/?email_confirmed=1`;
        const normalizedName = name.trim() || readLocal(STORAGE_NAME);

        const { data, error: signUpError } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            data: normalizedName ? { name: normalizedName } : undefined,
            emailRedirectTo: redirectTo,
          },
        });

        if (signUpError) {
          const mapped = mapSignupErrorMessage(String(signUpError.message || ""));
          if (mapped === "Este e-mail já está cadastrado.") {
            const nextState = await resolveAuthState(normalizedEmail);
            applyResolvedState(nextState);
            return;
          }
          throw signUpError;
        }

        rememberIdentity(normalizedEmail, normalizedName);
        writeLocal(AWAITING_CONFIRMATION_EMAIL, normalizedEmail);
        setPassword("");

        if (data.session) {
          writeSession(CONFIRMED_EMAIL_STORAGE, normalizedEmail);
          writeLocal(AWAITING_CONFIRMATION_EMAIL, "");
          await supabase.auth.signOut({ scope: "local" });
          setMode("confirmed");
          setInfo(null);
        } else {
          setMode("confirm-email");
          setInfo("Enviamos um link de confirmação para seu e-mail. Abra a mensagem e confirme seu endereço.");
        }
        return;
      }

      if (isLogin) {
        const state = await resolveAuthState(normalizedEmail);
        if (state !== "account") {
          setError(loginStateMessage(state));
          return;
        }
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });
        if (signInError) throw signInError;
        rememberIdentity(normalizedEmail);
      }
    } catch (err: any) {
      setError(mapSignupErrorMessage(String(err?.message || "Falha na autenticação.")));
    } finally {
      setLoading(false);
    }
  }

  async function handleAdminGithub() {
    setLoading(true);
    clearMessages();
    try {
      window.sessionStorage.setItem(ADMIN_OAUTH_INTENT, "1");
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "github",
        options: { redirectTo: `${window.location.origin}${ADMIN_LOGIN_PATH}` },
      });
      if (oauthError) throw oauthError;
    } catch (err: any) {
      try {
        window.sessionStorage.removeItem(ADMIN_OAUTH_INTENT);
      } catch {
        // noop
      }
      setError(String(err?.message || "Falha no acesso administrativo com GitHub."));
      setLoading(false);
    }
  }

  function useAnotherEmail() {
    setMode("request");
    setName("");
    setEmail("");
    setPassword("");
    clearMessages();
  }

  function continueAfterConfirmation() {
    const confirmedEmail = readSession(CONFIRMED_EMAIL_STORAGE) || email || readLocal(STORAGE_EMAIL);
    if (confirmedEmail) {
      setEmail(confirmedEmail);
      writeLocal(STORAGE_EMAIL, confirmedEmail);
    }
    writeSession(CONFIRMED_EMAIL_STORAGE, "");
    window.history.replaceState({}, "", "/");
    setMode("login");
    setPassword("");
    setError(null);
    setInfo("E-mail confirmado. Digite sua senha para entrar.");
  }

  function goToNormalAccess() {
    window.location.assign("/");
  }

  function openEmailLogin() {
    setMode("login");
    setPassword("");
    clearMessages();
  }

  const title = isAdmin
    ? "Acesso administrativo"
    : isLogin
      ? "Acesse sua conta"
      : isRequest
        ? "Solicite seu acesso"
        : isPending
          ? "Aguardando aprovação"
          : isActivation
            ? "Crie sua senha"
            : isConfirmEmail
              ? "Confirme seu e-mail"
              : isConfirmed
                ? "E-mail aprovado"
                : "Acesso não aprovado";

  const subtitle = isAdmin
    ? "Entrada exclusiva para administradores autorizados."
    : isLogin
      ? "Entre com seu e-mail e senha."
      : isRequest
        ? "Informe seu nome e e-mail para pedir acesso ao MFinanceiro."
        : isPending
          ? "Assim que o administrador aprovar, esta tela muda automaticamente."
          : isActivation
            ? "Seu acesso foi aprovado. Cadastre a senha da sua conta."
            : isConfirmEmail
              ? "Abra a mensagem enviada pelo MFinanceiro e clique no link de confirmação."
              : isConfirmed
                ? "Seu endereço foi validado com sucesso. Agora você já pode entrar."
                : "Esta solicitação não foi aprovada.";

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#050505] overflow-hidden">
      <style>{`
        @keyframes mf-auth-logo-intro {
          0% { opacity: 0; transform: scale(.74) translateY(18px); filter: blur(10px); }
          42% { opacity: 1; transform: scale(1.08) translateY(0); filter: blur(0); }
          76% { opacity: 1; transform: scale(1) translateY(0); }
          100% { opacity: 0; transform: scale(.78) translateY(-16px); }
        }
        @keyframes mf-auth-card-in {
          from { opacity: 0; transform: translateY(18px) scale(.985); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes mf-auth-mark-in {
          from { opacity: 0; transform: scale(1.45); }
          to { opacity: 1; transform: scale(1); }
        }
        .mf-auth-intro { animation: mf-auth-logo-intro 1.45s cubic-bezier(.22,.8,.2,1) forwards; }
        .mf-auth-card { animation: mf-auth-card-in .48s cubic-bezier(.22,.8,.2,1) both; }
        .mf-auth-mark { animation: mf-auth-mark-in .55s cubic-bezier(.22,.8,.2,1) both; }
        @media (prefers-reduced-motion: reduce) {
          .mf-auth-intro,.mf-auth-card,.mf-auth-mark { animation: none !important; }
        }
      `}</style>

      {!introDone && (
        <div className="mf-auth-intro absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="h-20 w-20 rounded-[24px] bg-gradient-to-br from-brand-primary to-brand-secondary flex items-center justify-center mb-5 shadow-[0_0_55px_rgba(0,242,255,0.28)]">
            <Wallet className="text-white" size={40} />
          </div>
          <h1 className="text-5xl font-black tracking-[-0.06em]">MFinanceiro</h1>
          <p className="mt-3 text-[11px] uppercase font-bold tracking-[0.34em] text-white/35">Controle Financeiro Inteligente</p>
        </div>
      )}

      {introDone && (
        <div className="mf-auth-card glass-card w-full max-w-md p-8 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-brand-primary via-brand-secondary to-brand-primary" />

          <div className="flex flex-col items-center mb-8">
            <div className="mf-auth-mark h-14 w-14 rounded-2xl bg-gradient-to-br from-brand-primary to-brand-secondary flex items-center justify-center mb-4 shadow-[0_0_28px_rgba(0,242,255,0.24)]">
              {isAdmin ? <ShieldCheck className="text-white" size={28} /> : isConfirmed ? <CheckCircle2 className="text-white" size={28} /> : <Wallet className="text-white" size={28} />}
            </div>
            <h1 className="text-3xl font-black tracking-tighter">MFinanceiro</h1>
            <p className="text-white/40 mt-2 text-xs uppercase font-bold tracking-widest">Controle Financeiro Inteligente</p>
          </div>

          <div className="mb-5 text-center">
            <h2 className="text-sm font-bold text-white/85">{title}</h2>
            <p className="mt-1 text-[11px] text-white/35">{subtitle}</p>
          </div>

          {isAdmin ? (
            <div className="space-y-4">
              {adminDenied && <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg">Esta conta não possui autorização administrativa.</div>}
              {error && <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg">{error}</div>}
              <button type="button" onClick={handleAdminGithub} disabled={loading} className="w-full bg-white/8 border border-white/10 text-white font-bold py-3 rounded-xl hover:bg-white/12 transition-all flex items-center justify-center gap-2 disabled:opacity-50">
                {loading ? <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <><Github size={20} /><span>Entrar com GitHub</span></>}
              </button>
              <button type="button" onClick={goToNormalAccess} className="w-full text-[10px] uppercase font-bold tracking-widest text-white/25 hover:text-white/55 transition-colors">Voltar ao acesso normal</button>
            </div>
          ) : isPending || isDenied || isConfirmEmail || isConfirmed ? (
            <div className="space-y-4">
              {isPending && <div className="p-4 rounded-xl border border-brand-primary/20 bg-brand-primary/8 text-sm text-white/65"><strong className="block text-brand-primary mb-1">Solicitação recebida</strong>Seu pedido está aguardando a aprovação do administrador. Você não precisa verificar manualmente.</div>}
              {isDenied && <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/8 text-sm text-red-300">Sua solicitação não foi aprovada. Se acreditar que houve um engano, entre em contato com o administrador.</div>}
              {isConfirmEmail && <div className="p-4 rounded-xl border border-brand-primary/20 bg-brand-primary/8 text-sm text-white/65"><strong className="block text-brand-primary mb-1">Verifique sua caixa de entrada</strong>O link enviado para <span className="text-white">{email}</span> confirma seu endereço. Depois da confirmação, você volta ao MFinanceiro.</div>}
              {isConfirmed && <><div className="p-4 rounded-xl border border-green-500/20 bg-green-500/8 text-sm text-green-300"><strong className="block mb-1">E-mail aprovado</strong>Seu endereço foi confirmado. Clique abaixo para acessar sua conta.</div><button type="button" onClick={continueAfterConfirmation} className="w-full bg-brand-primary text-black font-bold py-3 rounded-xl hover:opacity-90 transition-opacity flex items-center justify-center gap-2 shadow-[0_4px_20px_rgba(0,242,255,0.2)]"><LogIn size={20} />Ir para entrar</button></>}
              {!isConfirmed && <button type="button" onClick={useAnotherEmail} className="w-full text-[10px] uppercase font-bold tracking-widest text-white/25 hover:text-white/55 transition-colors">Usar outro e-mail</button>}
            </div>
          ) : (
            <form onSubmit={handleAuth} className="space-y-4">
              {(isRequest || isActivation) && <div><label className="block text-sm text-white/60 mb-1">Nome</label><input type="text" required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} disabled={isActivation} className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none disabled:opacity-60" placeholder="Seu nome" /></div>}
              <div><label className="block text-sm text-white/60 mb-1">E-mail</label><div className="relative"><Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" /><input type="email" required autoComplete="email" value={email} onChange={(event) => { setEmail(event.target.value); setError(null); setInfo(null); }} disabled={isActivation} className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-3 focus:border-brand-primary outline-none disabled:opacity-60" placeholder="seu@email.com" /></div>{isRequest && checkingEmail && <p className="mt-1.5 text-[10px] text-white/25">Verificando se este e-mail já possui conta...</p>}</div>
              {(isLogin || isActivation) && <div><label className="block text-sm text-white/60 mb-1">Senha</label><input type="password" required minLength={8} autoComplete={isActivation ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none" placeholder={isActivation ? "Crie uma senha com no mínimo 8 caracteres" : "Sua senha"} /></div>}
              {error && <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg">{error}</div>}
              {info && <div className="p-3 bg-brand-primary/10 border border-brand-primary/20 text-brand-primary text-sm rounded-lg">{info}</div>}
              <button type="submit" disabled={loading || (isRequest && checkingEmail)} className="w-full bg-brand-primary text-black font-bold py-3 rounded-xl hover:opacity-90 transition-opacity flex items-center justify-center gap-2 disabled:opacity-50 shadow-[0_4px_20px_rgba(0,242,255,0.2)]">{loading ? <div className="h-5 w-5 animate-spin rounded-full border-2 border-black border-t-transparent" /> : <>{isLogin ? <LogIn size={20} /> : <UserPlus size={20} />}<span>{isLogin ? "Entrar" : isRequest ? "Solicitar acesso" : "Cadastrar senha e continuar"}</span></>}</button>
              {!isRequest && <button type="button" onClick={useAnotherEmail} className="w-full text-[10px] uppercase font-bold tracking-widest text-white/25 hover:text-white/55 transition-colors">Usar outro e-mail</button>}
            </form>
          )}

          {isRequest && (
            <section className="mt-4 border-t border-white/10 pt-4" aria-labelledby="mf-existing-access-title">
              <div id="mf-existing-access-title" className="mb-2 flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.12em] text-white/30 before:h-px before:flex-1 before:bg-white/10 after:h-px after:flex-1 after:bg-white/10">
                Já possui acesso?
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <button type="button" onClick={openEmailLogin} disabled={loading} className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 text-[10px] font-bold text-white/75 transition hover:border-brand-primary/30 hover:bg-brand-primary/[0.07] hover:text-white disabled:opacity-50">
                  <Mail size={16} /> Entrar com e-mail
                </button>
                <button type="button" onClick={handleAdminGithub} disabled={loading} className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 text-[10px] font-bold text-white/75 transition hover:border-brand-primary/30 hover:bg-brand-primary/[0.07] hover:text-white disabled:opacity-50">
                  <Github size={16} /> Entrar com GitHub
                </button>
              </div>
              <p className="mt-2 min-h-4 text-center text-[9px] leading-relaxed text-white/30">GitHub é validado como acesso administrativo.</p>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
