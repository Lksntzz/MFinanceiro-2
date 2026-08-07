import React, { useEffect, useRef, useState } from "react";
import { Github, KeyRound, LogIn, Mail, ShieldCheck, UserPlus, Wallet } from "lucide-react";
import { supabase } from "../lib/supabase";
import {
  getAccessStatusMessage,
  mapSignupErrorMessage,
  requestAccess,
  resolveAccessEntryState,
} from "../lib/access-control";

type AuthMode = "identify" | "request" | "pending" | "activate" | "login";

const ADMIN_LOGIN_PATH = "/admin-login";
const ADMIN_OAUTH_INTENT = "mf-admin-oauth-intent";

function normalizeEmail(value: string) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function setAdminOAuthIntent(active: boolean) {
  try {
    if (active) window.sessionStorage.setItem(ADMIN_OAUTH_INTENT, "1");
    else window.sessionStorage.removeItem(ADMIN_OAUTH_INTENT);
  } catch {
    // OAuth still works even if sessionStorage is unavailable.
  }
}

export default function Auth() {
  const adminRoute = window.location.pathname.replace(/\/+$/, "") === ADMIN_LOGIN_PATH;
  const adminDenied = adminRoute && new URLSearchParams(window.location.search).get("denied") === "1";

  const [mode, setMode] = useState<AuthMode>("identify");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(adminDenied ? "Esta conta não possui permissão administrativa." : null);
  const [info, setInfo] = useState<string | null>(null);
  const [introDone, setIntroDone] = useState(false);
  const requestInFlightRef = useRef(false);
  const lastRequestAtRef = useRef(0);

  useEffect(() => {
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      setIntroDone(true);
      return;
    }
    const timer = window.setTimeout(() => setIntroDone(true), 1350);
    return () => window.clearTimeout(timer);
  }, []);

  async function routeEmail(targetEmail = email) {
    const normalizedEmail = normalizeEmail(targetEmail);
    if (!isValidEmail(normalizedEmail)) {
      setError("Informe um e-mail válido.");
      return;
    }

    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const state = await resolveAccessEntryState(normalizedEmail);
      setEmail(normalizedEmail);
      setPassword("");

      if (state === "existing") {
        setMode("login");
        return;
      }
      if (state === "pending") {
        setMode("pending");
        return;
      }
      if (state === "approved") {
        setMode("activate");
        setInfo("Seu acesso foi aprovado. Defina sua senha para concluir o primeiro acesso.");
        return;
      }
      if (state === "denied") {
        setMode("request");
        setInfo("A solicitação anterior foi negada. Você pode enviar uma nova solicitação.");
        return;
      }

      setMode("request");
    } catch (err: any) {
      setError(String(err?.message || "Não foi possível verificar este e-mail."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (mode !== "pending") return;
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) return;

    let active = true;
    const check = async () => {
      try {
        const state = await resolveAccessEntryState(normalizedEmail);
        if (!active) return;
        if (state === "approved") {
          setMode("activate");
          setInfo("Seu acesso foi aprovado. Defina sua senha para concluir o primeiro acesso.");
        } else if (state === "existing") {
          setMode("login");
          setInfo("Sua conta já está ativa. Entre com seu e-mail e senha.");
        } else if (state === "denied") {
          setMode("request");
          setInfo("A solicitação foi negada. Você pode enviar uma nova solicitação.");
        }
      } catch {
        // Polling is intentionally silent; the user remains on the pending screen.
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
  }, [email, mode]);

  async function handleRequestAccess() {
    if (requestInFlightRef.current) return;
    if (Date.now() - lastRequestAtRef.current < 5000) {
      setInfo("Aguarde alguns segundos antes de enviar novamente.");
      return;
    }

    const normalizedName = name.trim();
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedName) {
      setError("Informe seu nome para solicitar acesso.");
      return;
    }
    if (!isValidEmail(normalizedEmail)) {
      setError("Informe um e-mail válido.");
      return;
    }

    setLoading(true);
    requestInFlightRef.current = true;
    setError(null);
    setInfo(null);
    try {
      const result = await requestAccess(normalizedName, normalizedEmail);
      if (result.status === "approved") {
        setMode("activate");
        setInfo("Seu acesso já está aprovado. Crie sua senha para ativar a conta.");
      } else if (result.status === "pending") {
        setMode("pending");
        setInfo(getAccessStatusMessage("pending"));
      } else if (result.status === "denied") {
        setInfo(getAccessStatusMessage("denied"));
      }
    } catch (err: any) {
      const message = String(err?.message || "Falha ao enviar a solicitação de acesso.");
      if (message.includes("já possui uma conta")) {
        setMode("login");
        setInfo("Esta conta já existe. Digite sua senha para entrar.");
      } else {
        setError(message);
      }
    } finally {
      lastRequestAtRef.current = Date.now();
      requestInFlightRef.current = false;
      setLoading(false);
    }
  }

  async function handleLogin() {
    const normalizedEmail = normalizeEmail(email);
    if (!isValidEmail(normalizedEmail)) {
      setError("Informe um e-mail válido.");
      return;
    }
    if (password.length < 8) {
      setError("Informe sua senha.");
      return;
    }

    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      if (!signInError) return;

      const state = await resolveAccessEntryState(normalizedEmail).catch(() => "existing" as const);
      if (state === "approved") {
        setMode("activate");
        setPassword("");
        setInfo("Seu acesso está aprovado, mas a conta ainda precisa ser ativada. Crie sua senha abaixo.");
        return;
      }
      throw signInError;
    } catch (err: any) {
      setError(mapSignupErrorMessage(String(err?.message || "Falha na autenticação.")));
    } finally {
      setLoading(false);
    }
  }

  async function handleActivation() {
    const normalizedEmail = normalizeEmail(email);
    if (!name.trim()) {
      setError("Informe seu nome para concluir o primeiro acesso.");
      return;
    }
    if (password.length < 8) {
      setError("Crie uma senha com pelo menos 8 caracteres.");
      return;
    }

    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const state = await resolveAccessEntryState(normalizedEmail);
      if (state === "existing") {
        setMode("login");
        setPassword("");
        setInfo("Sua conta já está ativa. Entre com sua senha.");
        return;
      }
      if (state !== "approved") {
        setMode(state === "pending" ? "pending" : "identify");
        setError("Seu acesso ainda não está liberado para ativação.");
        return;
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: { data: { name: name.trim() } },
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

      if (!data.session) {
        setMode("login");
        setPassword("");
        setInfo("Conta criada. Confirme seu e-mail e depois entre com sua senha.");
      }
    } catch (err: any) {
      setError(mapSignupErrorMessage(String(err?.message || "Não foi possível ativar a conta.")));
    } finally {
      setLoading(false);
    }
  }

  async function handleAdminGitHub() {
    setLoading(true);
    setError(null);
    setInfo(null);
    setAdminOAuthIntent(true);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: window.location.origin },
    });
    if (oauthError) {
      setAdminOAuthIntent(false);
      setError(String(oauthError.message || "Falha ao iniciar o acesso administrativo."));
      setLoading(false);
    }
  }

  function resetIdentity() {
    setMode("identify");
    setName("");
    setPassword("");
    setError(null);
    setInfo(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (mode === "identify") await routeEmail();
    else if (mode === "request") await handleRequestAccess();
    else if (mode === "activate") await handleActivation();
    else if (mode === "login") await handleLogin();
  }

  const heading = mode === "identify"
    ? "Vamos encontrar sua conta"
    : mode === "request"
      ? "Solicite seu acesso"
      : mode === "pending"
        ? "Solicitação em análise"
        : mode === "activate"
          ? "Primeiro acesso"
          : "Acesse sua conta";

  const description = mode === "identify"
    ? "Informe seu e-mail. O MFinanceiro identifica automaticamente o próximo passo."
    : mode === "request"
      ? "Este e-mail ainda não possui uma conta. Envie seus dados para aprovação."
      : mode === "pending"
        ? "Não é necessário verificar manualmente. Assim que houver aprovação, esta tela muda sozinha."
        : mode === "activate"
          ? "Seu acesso foi aprovado. Crie sua senha uma única vez para ativar a conta."
          : "Sua conta já existe. Entre com seu e-mail e senha.";

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
        .mf-auth-intro { animation: mf-auth-logo-intro 1.35s cubic-bezier(.22,.8,.2,1) forwards; }
        .mf-auth-card { animation: mf-auth-card-in .48s cubic-bezier(.22,.8,.2,1) both; }
        @media (prefers-reduced-motion: reduce) {
          .mf-auth-intro,.mf-auth-card { animation: none !important; }
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

          <div className="flex flex-col items-center mb-7">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-brand-primary to-brand-secondary flex items-center justify-center mb-4 shadow-[0_0_28px_rgba(0,242,255,0.24)]">
              {adminRoute ? <ShieldCheck className="text-white" size={28} /> : <Wallet className="text-white" size={28} />}
            </div>
            <h1 className="text-3xl font-black tracking-tighter">MFinanceiro</h1>
            <p className="text-white/40 mt-2 text-xs uppercase font-bold tracking-widest">Controle Financeiro Inteligente</p>
          </div>

          {adminRoute ? (
            <div>
              <div className="mb-5 text-center">
                <h2 className="text-sm font-bold text-white/85">Acesso administrativo</h2>
                <p className="mt-1 text-[11px] text-white/35">Autentique com o GitHub. O sistema libera a entrada somente se a conta tiver papel de administrador no Supabase.</p>
              </div>
              {error && <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg">{error}</div>}
              <button type="button" onClick={handleAdminGitHub} disabled={loading} className="w-full bg-white/8 border border-white/10 text-white font-bold py-3 rounded-xl hover:bg-white/12 transition-all flex items-center justify-center gap-2 disabled:opacity-50">
                {loading ? <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <><Github size={19}/><span>Entrar com GitHub</span></>}
              </button>
              <button type="button" onClick={() => window.location.assign("/")} className="mt-6 w-full text-[10px] uppercase font-bold tracking-widest text-white/25 hover:text-white/55 transition-colors">Voltar ao acesso normal</button>
            </div>
          ) : (
            <>
              <div className="mb-5 text-center">
                <h2 className="text-sm font-bold text-white/85">{heading}</h2>
                <p className="mt-1 text-[11px] text-white/35">{description}</p>
              </div>

              {mode === "pending" ? (
                <div>
                  <div className="rounded-xl border border-brand-primary/15 bg-brand-primary/5 p-4 text-center">
                    <Mail size={20} className="mx-auto text-brand-primary mb-2"/>
                    <strong className="block text-sm text-white/80">{email}</strong>
                    <p className="mt-2 text-[11px] text-white/40">Aguardando aprovação. O status é atualizado automaticamente a cada poucos segundos e quando você volta para esta página.</p>
                  </div>
                  {info && <div className="mt-4 p-3 bg-brand-primary/10 border border-brand-primary/20 text-brand-primary text-sm rounded-lg">{info}</div>}
                  <button type="button" onClick={resetIdentity} className="mt-6 w-full text-[10px] uppercase font-bold tracking-widest text-white/25 hover:text-white/55 transition-colors">Usar outro e-mail</button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  {(mode === "request" || mode === "activate") && (
                    <div>
                      <label className="block text-sm text-white/60 mb-1">Nome</label>
                      <input type="text" required value={name} onChange={(event) => setName(event.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none" placeholder="Seu nome" />
                    </div>
                  )}

                  <div>
                    <label className="block text-sm text-white/60 mb-1">E-mail</label>
                    <input type="email" required value={email} onChange={(event) => { setEmail(event.target.value); setError(null); }} readOnly={mode !== "identify"} className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none read-only:opacity-65" placeholder="seu@email.com" />
                  </div>

                  {(mode === "login" || mode === "activate") && (
                    <div>
                      <label className="block text-sm text-white/60 mb-1">Senha</label>
                      <input type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none" placeholder={mode === "activate" ? "Crie uma senha com no mínimo 8 caracteres" : "Sua senha"} />
                    </div>
                  )}

                  {error && <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg">{error}</div>}
                  {info && <div className="p-3 bg-brand-primary/10 border border-brand-primary/20 text-brand-primary text-sm rounded-lg">{info}</div>}

                  <button type="submit" disabled={loading} className="w-full bg-brand-primary text-black font-bold py-3 rounded-xl hover:opacity-90 transition-opacity flex items-center justify-center gap-2 disabled:opacity-50 shadow-[0_4px_20px_rgba(0,242,255,0.2)]">
                    {loading ? (
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-black border-t-transparent" />
                    ) : (
                      <>
                        {mode === "identify" ? <Mail size={19}/> : mode === "login" ? <LogIn size={19}/> : mode === "activate" ? <KeyRound size={19}/> : <UserPlus size={19}/>} 
                        <span>{mode === "identify" ? "Continuar" : mode === "login" ? "Entrar" : mode === "activate" ? "Criar senha e ativar" : "Solicitar acesso"}</span>
                      </>
                    )}
                  </button>

                  {mode !== "identify" && <button type="button" onClick={resetIdentity} className="w-full text-[10px] uppercase font-bold tracking-widest text-white/25 hover:text-white/55 transition-colors">Usar outro e-mail</button>}
                </form>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
