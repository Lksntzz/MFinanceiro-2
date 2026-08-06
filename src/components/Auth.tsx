import React, { useEffect, useRef, useState } from "react";
import { Github, LogIn, Mail, UserPlus, Wallet } from "lucide-react";
import { supabase } from "../lib/supabase";
import {
  AccessRequestStatus,
  fetchAccessStatus,
  getAccessStatusMessage,
  mapSignupErrorMessage,
  requestAccess,
} from "../lib/access-control";

type AuthMode = "login" | "request" | "signup";

export default function Auth() {
  const [mode, setMode] = useState<AuthMode>("request");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [signupStatus, setSignupStatus] = useState<AccessRequestStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const requestInFlightRef = useRef(false);
  const lastRequestAtRef = useRef(0);

  const isLogin = mode === "login";
  const isRequest = mode === "request";
  const isSignUp = mode === "signup";
  const canFinishSignup = signupStatus === "approved";

  async function checkSignupAccessStatus() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Informe o e-mail para verificar a aprovação.");
      return;
    }

    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const status = await fetchAccessStatus(normalizedEmail);
      setSignupStatus(status);
      setInfo(getAccessStatusMessage(status));
      if (status === "approved") setMode("signup");
    } catch (err: any) {
      setError(String(err?.message || "Falha ao consultar o status de acesso."));
    } finally {
      setLoading(false);
    }
  }

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
      setSignupStatus(result.status);
      setInfo(getAccessStatusMessage(result.status));
      if (result.status === "approved") setMode("signup");
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
      if (isSignUp) {
        const status = signupStatus ?? (await fetchAccessStatus(normalizedEmail));
        setSignupStatus(status);
        if (status !== "approved") {
          setError(getAccessStatusMessage(status));
          return;
        }

        const { error: signUpError } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: { data: { name: name.trim() } },
        });
        if (signUpError) throw signUpError;
        setInfo("Cadastro iniciado. Verifique seu e-mail para confirmar a conta.");
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      if (signInError) throw signInError;
    } catch (err: any) {
      setError(mapSignupErrorMessage(String(err?.message || "Falha na autenticação.")));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isRequest || !email.trim()) return;
    const interval = window.setInterval(async () => {
      const status = await fetchAccessStatus(email);
      setSignupStatus(status);
      if (status === "approved") {
        setMode("signup");
        setInfo("Seu acesso foi aprovado. Crie sua senha para concluir o cadastro.");
      }
    }, 60000);
    return () => window.clearInterval(interval);
  }, [email, isRequest]);

  async function handleSocialLogin(provider: "google" | "github") {
    setLoading(true);
    setError(null);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    if (oauthError) setError(String(oauthError.message || "Falha no login social."));
    setLoading(false);
  }

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError(null);
    setInfo(null);
    if (nextMode === "request") setPassword("");
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#050505]">
      <div className="glass-card w-full max-w-md p-8 animate-fade-in relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-brand-primary via-brand-secondary to-brand-primary animate-pulse" />

        <div className="flex flex-col items-center mb-8">
          <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-brand-primary to-brand-secondary flex items-center justify-center mb-4 shadow-[0_0_30px_rgba(0,242,255,0.3)]">
            <Wallet className="text-white" size={32} />
          </div>
          <h1 className="text-3xl font-black tracking-tighter">MFinanceiro</h1>
          <p className="text-white/40 mt-2 text-xs uppercase font-bold tracking-widest">Controle Financeiro Inteligente</p>
        </div>

        {isLogin && (
          <>
            <div className="grid grid-cols-2 gap-4 mb-8">
              <button type="button" onClick={() => handleSocialLogin("google")} disabled={loading} className="flex items-center justify-center gap-2 p-3 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all disabled:opacity-50">
                <Mail size={18} className="text-red-400" /><span className="text-xs font-bold">Google</span>
              </button>
              <button type="button" onClick={() => handleSocialLogin("github")} disabled={loading} className="flex items-center justify-center gap-2 p-3 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all disabled:opacity-50">
                <Github size={18} /><span className="text-xs font-bold">GitHub</span>
              </button>
            </div>
          </>
        )}

        <form onSubmit={handleAuth} className="space-y-4">
          {(isRequest || isSignUp) && (
            <div>
              <label className="block text-sm text-white/60 mb-1">Nome</label>
              <input type="text" required value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none" placeholder="Seu nome" />
            </div>
          )}

          <div>
            <label className="block text-sm text-white/60 mb-1">E-mail</label>
            <input type="email" required value={email} onChange={(e) => { setEmail(e.target.value); setSignupStatus(null); }} className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none" placeholder="seu@email.com" />
          </div>

          {(isLogin || isSignUp) && (
            <div>
              <label className="block text-sm text-white/60 mb-1">Senha</label>
              <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none" placeholder="Mínimo de 8 caracteres" />
            </div>
          )}

          {error && <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg">{error}</div>}
          {info && <div className="p-3 bg-brand-primary/10 border border-brand-primary/20 text-brand-primary text-sm rounded-lg">{info}</div>}

          <button type="submit" disabled={loading || (isSignUp && !canFinishSignup)} className="w-full bg-brand-primary text-black font-bold py-3 rounded-xl hover:opacity-90 transition-opacity flex items-center justify-center gap-2 disabled:opacity-50 shadow-[0_4px_20px_rgba(0,242,255,0.2)]">
            {loading ? <div className="h-5 w-5 animate-spin rounded-full border-2 border-black border-t-transparent" /> : <>{isLogin ? <LogIn size={20} /> : <UserPlus size={20} />}<span>{isLogin ? "Entrar" : isRequest ? "Solicitar acesso" : "Finalizar cadastro"}</span></>}
          </button>
        </form>

        {isRequest && (
          <button type="button" onClick={checkSignupAccessStatus} disabled={loading} className="mt-4 w-full text-xs font-bold text-brand-primary hover:underline disabled:opacity-50">Verificar aprovação</button>
        )}

        <div className="mt-8 flex flex-col gap-3 text-center">
          {!isLogin && <button type="button" onClick={() => changeMode("login")} className="text-xs uppercase font-bold tracking-widest text-white/40 hover:text-brand-primary">Já tenho uma conta</button>}
          {isLogin && <button type="button" onClick={() => changeMode("request")} className="text-xs uppercase font-bold tracking-widest text-white/40 hover:text-brand-primary">Solicitar acesso para novo usuário</button>}
        </div>
      </div>
    </div>
  );
}
