import React, { useEffect, useRef, useState } from "react";
import { Github, LogIn, Mail, ShieldCheck, UserPlus, Wallet } from "lucide-react";
import { supabase } from "../lib/supabase";
import {
  mapSignupErrorMessage,
  requestAccess,
  resolveAuthState,
  type ResolvedAuthState,
} from "../lib/access-control";

type AuthMode = "identify" | "login" | "request" | "pending" | "activate" | "denied" | "admin";

const STORAGE_EMAIL = "mf-auth-email";
const STORAGE_NAME = "mf-auth-name";
const ADMIN_LOGIN_PATH = "/admin-login";
const ADMIN_OAUTH_INTENT = "mf-admin-oauth-intent";

function readStored(key: string) {
  try {
    return window.localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function writeStored(key: string, value: string) {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable without breaking the auth flow.
  }
}

function isAdminRoute() {
  return window.location.pathname.replace(/\/+$/, "") === ADMIN_LOGIN_PATH;
}

export default function Auth() {
  const adminRoute = isAdminRoute();
  const rememberedEmail = readStored(STORAGE_EMAIL);
  const rememberedName = readStored(STORAGE_NAME);

  const [mode, setMode] = useState<AuthMode>(adminRoute ? "admin" : "identify");
  const [name, setName] = useState(rememberedName);
  const [email, setEmail] = useState(rememberedEmail);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [introDone, setIntroDone] = useState(false);
  const requestInFlightRef = useRef(false);
  const lastRequestAtRef = useRef(0);

  const adminDenied = adminRoute && new URLSearchParams(window.location.search).get("denied") === "1";
  const isIdentify = mode === "identify";
  const isLogin = mode === "login";
  const isRequest = mode === "request";
  const isPending = mode === "pending";
  const isActivation = mode === "activate";
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

  function rememberIdentity(normalizedEmail: string, normalizedName = name.trim()) {
    writeStored(STORAGE_EMAIL, normalizedEmail);
    if (normalizedName) writeStored(STORAGE_NAME, normalizedName);
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
      if (!automatic) setInfo("Conta encontrada. Digite sua senha para entrar.");
      else setInfo(null);
      return;
    }

    if (state === "pending") {
      setMode("pending");
      setInfo("Sua solicitação está em análise. Esta tela será atualizada automaticamente quando houver uma decisão.");
      return;
    }

    if (state === "approved") {
      setMode("activate");
      setInfo("Seu acesso foi aprovado. Crie sua senha uma única vez para ativar a conta.");
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

  async function identifyEmail() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Informe seu e-mail para continuar.");
      return;
    }

    setLoading(true);
    clearMessages();
    try {
      rememberIdentity(normalizedEmail);
      const state = await resolveAuthState(normalizedEmail);
      applyResolvedState(state);
    } catch (err: any) {
      setError(String(err?.message || "Não foi possível verificar sua conta."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isPending) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return;

    let active = true;
    const check = async () => {
      try {
        const state = await resolveAuthState(normalizedEmail);
        if (!active || state === "pending") return;
        applyResolvedState(state, true);
      } catch {
        // Background polling stays silent; the user can keep waiting or change e-mail.
      }
    };

    void check();
    const interval = window.setInterval(() => void check(), 20000);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);

    return () => {
      active = false;
      window.clearInterval(interval);
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
    if (!normalizedEmail) {
      setError("Informe seu e-mail para solicitar acesso.");
      return;
    }

    setLoading(true);
    requestInFlightRef.current = true;
    clearMessages();
    try {
      const result = await requestAccess(normalizedName, normalizedEmail);
      rememberIdentity(normalizedEmail, normalizedName);
      if (result.status === "approved") applyResolvedState("approved");
      else if (result.status === "pending") applyResolvedState("pending");
      else if (result.status === "denied") applyResolvedState("denied");
      else applyResolvedState("new");
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

    if (isIdentify) {
      await identifyEmail();
      return;
    }

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
        if (state === "account") {
          setMode("login");
          setPassword("");
          setInfo("Sua conta já está ativa. Digite sua senha para entrar.");
          return;
        }
        if (state !== "approved") {
          applyResolvedState(state);
          return;
        }

        const { data, error: signUpError } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
        });

        if (signUpError) {
          const mapped = mapSignupErrorMessage(String(signUpError.message || ""));
          if (mapped === "Este e-mail já está cadastrado.") {
            setMode("login");
            setPassword("");
            setInfo("Sua conta já está ativa. Digite sua senha para entrar.");
            return;
          }
          throw signUpError;
        }

        rememberIdentity(normalizedEmail);
        if (!data.session) {
          setMode("login");
          setPassword("");
          setInfo("Conta criada. Confirme seu e-mail e depois entre com sua senha.");
        }
        return;
      }

      if (isLogin) {
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
      try { window.sessionStorage.removeItem(ADMIN_OAUTH_INTENT); } catch { /* noop */ }
      setError(String(err?.message || "Falha no acesso administrativo com GitHub."));
      setLoading(false);
    }
  }

  function changeEmail() {
    setMode("identify");
    setPassword("");
    setName(readStored(STORAGE_NAME));
    clearMessages();
  }

  function goToNormalAccess() {
    window.location.assign("/");
  }

  const title = isAdmin
    ? "Acesso administrativo"
    : isIdentify
      ? "Bem-vindo"
      : isLogin
        ? "Acesse sua conta"
        : isRequest
          ? "Solicite seu acesso"
          : isPending
            ? "Aguardando aprovação"
            : isActivation
              ? "Ative sua conta"
              : "Acesso não aprovado";

  const subtitle = isAdmin
    ? "Entrada exclusiva para administradores autorizados."
    : isIdentify
      ? "Informe seu e-mail. O MFinanceiro identifica automaticamente o próximo passo."
      : isLogin
        ? "Entre com seu e-mail e senha."
        : isRequest
          ? "Este e-mail ainda não possui conta. Envie seus dados para análise."
          : isPending
            ? "Você não precisa verificar manualmente. A aprovação é acompanhada em segundo plano."
            : isActivation
              ? "Defina sua senha para concluir o primeiro acesso."
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
              {isAdmin ? <ShieldCheck className="text-white" size={28} /> : <Wallet className="text-white" size={28} />}
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
              {adminDenied && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg">
                  Esta conta não possui autorização administrativa.
                </div>
              )}
              {error && <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg">{error}</div>}
              <button
                type="button"
                onClick={handleAdminGithub}
                disabled={loading}
                className="w-full bg-white/8 border border-white/10 text-white font-bold py-3 rounded-xl hover:bg-white/12 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loading ? <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <><Github size={20} /><span>Entrar com GitHub</span></>}
              </button>
              <button type="button" onClick={goToNormalAccess} className="w-full text-[10px] uppercase font-bold tracking-widest text-white/25 hover:text-white/55 transition-colors">
                Voltar ao acesso normal
              </button>
            </div>
          ) : isPending || isDenied ? (
            <div className="space-y-4">
              {isPending ? (
                <div className="p-4 rounded-xl border border-brand-primary/20 bg-brand-primary/8 text-sm text-white/65">
                  <strong className="block text-brand-primary mb-1">Solicitação recebida</strong>
                  Assim que o acesso for aprovado, esta tela muda automaticamente para a ativação da conta.
                </div>
              ) : (
                <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/8 text-sm text-red-300">
                  Sua solicitação não foi aprovada. Se acreditar que houve um engano, entre em contato com o administrador.
                </div>
              )}
              <button type="button" onClick={changeEmail} className="w-full text-[10px] uppercase font-bold tracking-widest text-white/25 hover:text-white/55 transition-colors">
                Usar outro e-mail
              </button>
            </div>
          ) : (
            <form onSubmit={handleAuth} className="space-y-4">
              {isRequest && (
                <div>
                  <label className="block text-sm text-white/60 mb-1">Nome</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none"
                    placeholder="Seu nome"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm text-white/60 mb-1">E-mail</label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(event) => { setEmail(event.target.value); setError(null); }}
                    disabled={!isIdentify && !isRequest}
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-3 focus:border-brand-primary outline-none disabled:opacity-60"
                    placeholder="seu@email.com"
                  />
                </div>
              </div>

              {(isLogin || isActivation) && (
                <div>
                  <label className="block text-sm text-white/60 mb-1">Senha</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none"
                    placeholder={isActivation ? "Crie uma senha com no mínimo 8 caracteres" : "Sua senha"}
                  />
                </div>
              )}

              {error && <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg">{error}</div>}
              {info && <div className="p-3 bg-brand-primary/10 border border-brand-primary/20 text-brand-primary text-sm rounded-lg">{info}</div>}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-brand-primary text-black font-bold py-3 rounded-xl hover:opacity-90 transition-opacity flex items-center justify-center gap-2 disabled:opacity-50 shadow-[0_4px_20px_rgba(0,242,255,0.2)]"
              >
                {loading ? (
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-black border-t-transparent" />
                ) : (
                  <>
                    {isIdentify ? <Mail size={20} /> : isLogin ? <LogIn size={20} /> : <UserPlus size={20} />}
                    <span>{isIdentify ? "Continuar" : isLogin ? "Entrar" : isRequest ? "Solicitar acesso" : "Criar senha e ativar"}</span>
                  </>
                )}
              </button>

              {!isIdentify && (
                <button type="button" onClick={changeEmail} className="w-full text-[10px] uppercase font-bold tracking-widest text-white/25 hover:text-white/55 transition-colors">
                  Usar outro e-mail
                </button>
              )}
            </form>
          )}
        </div>
      )}
    </div>
  );
}
