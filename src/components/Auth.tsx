import React, { useEffect, useRef, useState } from "react";
import { LogIn, UserPlus, Wallet } from "lucide-react";
import { supabase } from "../lib/supabase";
import {
  AccessRequestStatus,
  fetchAccessStatus,
  getAccessStatusMessage,
  mapSignupErrorMessage,
  requestAccess,
} from "../lib/access-control";

type AuthMode = "login" | "request" | "activate";

const STORAGE_EMAIL = "mf-auth-email";
const STORAGE_NAME = "mf-auth-name";
const STORAGE_PENDING = "mf-access-pending";
const STORAGE_ACCOUNT_READY = "mf-auth-account-ready";

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
    // Storage may be disabled; the auth flow still works for the current session.
  }
}

export default function Auth() {
  const rememberedEmail = readStored(STORAGE_EMAIL);
  const rememberedName = readStored(STORAGE_NAME);
  const accountReady = readStored(STORAGE_ACCOUNT_READY) === "true";

  const [mode, setMode] = useState<AuthMode>(accountReady ? "login" : "request");
  const [name, setName] = useState(rememberedName);
  const [email, setEmail] = useState(rememberedEmail);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [signupStatus, setSignupStatus] = useState<AccessRequestStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [introDone, setIntroDone] = useState(false);
  const requestInFlightRef = useRef(false);
  const lastRequestAtRef = useRef(0);

  const isLogin = mode === "login";
  const isRequest = mode === "request";
  const isActivation = mode === "activate";

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

  function markAccountReady(normalizedEmail: string) {
    rememberIdentity(normalizedEmail);
    writeStored(STORAGE_ACCOUNT_READY, "true");
    writeStored(STORAGE_PENDING, "");
  }

  function moveToActivation(normalizedEmail: string) {
    rememberIdentity(normalizedEmail);
    setSignupStatus("approved");
    setMode("activate");
    setPassword("");
    setError(null);
    setInfo("Seu acesso foi aprovado. Crie sua senha para ativar a conta.");
  }

  async function refreshAccessStatus(normalizedEmail: string, automatic = false) {
    if (!normalizedEmail) return;
    try {
      const status = await fetchAccessStatus(normalizedEmail);
      setSignupStatus(status);

      if (status === "approved") {
        const requestedHere = readStored(STORAGE_PENDING) === normalizedEmail;
        if (requestedHere && readStored(STORAGE_ACCOUNT_READY) !== "true") {
          moveToActivation(normalizedEmail);
        } else {
          rememberIdentity(normalizedEmail);
          setMode("login");
          setError(null);
          if (!automatic) setInfo("Acesso aprovado. Entre com seu e-mail e senha.");
        }
        return;
      }

      if (!automatic && status !== "none") setInfo(getAccessStatusMessage(status));
    } catch {
      // Background status checks are intentionally silent.
    }
  }

  useEffect(() => {
    if (!isRequest) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes("@")) return;

    const timer = window.setTimeout(() => {
      void refreshAccessStatus(normalizedEmail, true);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [email, isRequest]);

  useEffect(() => {
    if (!isRequest) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || readStored(STORAGE_PENDING) !== normalizedEmail) return;

    const check = () => void refreshAccessStatus(normalizedEmail, true);
    check();
    const interval = window.setInterval(check, 20000);
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [email, isRequest]);

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
    setError(null);
    setInfo(null);
    try {
      const result = await requestAccess(normalizedName, normalizedEmail);
      rememberIdentity(normalizedEmail, normalizedName);
      setSignupStatus(result.status);

      if (result.status === "approved") {
        writeStored(STORAGE_PENDING, normalizedEmail);
        moveToActivation(normalizedEmail);
        return;
      }

      if (result.status === "pending") {
        writeStored(STORAGE_PENDING, normalizedEmail);
        setInfo("Solicitação enviada. Esta tela mudará automaticamente quando seu acesso for aprovado.");
        return;
      }

      setInfo(getAccessStatusMessage(result.status));
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
    setError(null);
    setInfo(null);

    try {
      if (isActivation) {
        const status = signupStatus ?? (await fetchAccessStatus(normalizedEmail));
        setSignupStatus(status);
        if (status !== "approved") {
          setError(getAccessStatusMessage(status));
          setMode("request");
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
            markAccountReady(normalizedEmail);
            setMode("login");
            setPassword("");
            setInfo("Sua conta já está ativa. Digite sua senha para entrar.");
            return;
          }
          throw signUpError;
        }

        markAccountReady(normalizedEmail);
        if (!data.session) {
          setMode("login");
          setPassword("");
          setInfo("Conta criada. Confirme seu e-mail e depois entre com sua senha.");
        }
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      if (signInError) {
        const status = await fetchAccessStatus(normalizedEmail);
        if (status === "approved" && readStored(STORAGE_ACCOUNT_READY) !== "true") {
          writeStored(STORAGE_PENDING, normalizedEmail);
          moveToActivation(normalizedEmail);
          return;
        }
        throw signInError;
      }

      markAccountReady(normalizedEmail);
    } catch (err: any) {
      setError(mapSignupErrorMessage(String(err?.message || "Falha na autenticação.")));
    } finally {
      setLoading(false);
    }
  }

  function resetForAnotherUser() {
    writeStored(STORAGE_ACCOUNT_READY, "");
    writeStored(STORAGE_PENDING, "");
    writeStored(STORAGE_EMAIL, "");
    writeStored(STORAGE_NAME, "");
    setMode("request");
    setName("");
    setEmail("");
    setPassword("");
    setSignupStatus(null);
    setError(null);
    setInfo(null);
  }

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
              <Wallet className="text-white" size={28} />
            </div>
            <h1 className="text-3xl font-black tracking-tighter">MFinanceiro</h1>
            <p className="text-white/40 mt-2 text-xs uppercase font-bold tracking-widest">Controle Financeiro Inteligente</p>
          </div>

          <div className="mb-5 text-center">
            <h2 className="text-sm font-bold text-white/85">
              {isRequest ? "Solicite seu acesso" : isActivation ? "Ative sua conta" : "Acesse sua conta"}
            </h2>
            <p className="mt-1 text-[11px] text-white/35">
              {isRequest
                ? "Envie seus dados uma única vez. A aprovação é acompanhada automaticamente."
                : isActivation
                  ? "Seu acesso foi aprovado. Defina sua senha para concluir o primeiro acesso."
                  : "Entre com seu e-mail e senha."}
            </p>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            {(isRequest || isActivation) && (
              <div>
                <label className="block text-sm text-white/60 mb-1">Nome</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isActivation}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none disabled:opacity-60"
                  placeholder="Seu nome"
                />
              </div>
            )}

            <div>
              <label className="block text-sm text-white/60 mb-1">E-mail</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => { setEmail(e.target.value); setSignupStatus(null); setError(null); }}
                disabled={isActivation}
                className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none disabled:opacity-60"
                placeholder="seu@email.com"
              />
            </div>

            {(isLogin || isActivation) && (
              <div>
                <label className="block text-sm text-white/60 mb-1">Senha</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
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
                  {isLogin ? <LogIn size={20} /> : <UserPlus size={20} />}
                  <span>{isRequest ? "Solicitar acesso" : isActivation ? "Criar senha e ativar" : "Entrar"}</span>
                </>
              )}
            </button>
          </form>

          {isLogin && rememberedEmail && (
            <button
              type="button"
              onClick={resetForAnotherUser}
              className="mt-6 w-full text-[10px] uppercase font-bold tracking-widest text-white/25 hover:text-white/55 transition-colors"
            >
              Trocar usuário
            </button>
          )}
        </div>
      )}
    </div>
  );
}
