import React, { useState } from "react";
import { supabase } from "../lib/supabase";
import { Wallet, LogIn, UserPlus, Github, Mail } from "lucide-react";
import {
  fetchAccessStatus,
  getAccessStatusMessage,
  mapSignupErrorMessage,
  requestAccess,
  AccessRequestStatus,
} from "../lib/access-control";

type AuthMode = "login" | "request" | "signup";

export default function Auth() {
  const [mode, setMode] = useState<AuthMode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [signupStatus, setSignupStatus] = useState<AccessRequestStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const isSignUp = mode === "signup";
  const isRequest = mode === "request";
  const isLogin = mode === "login";
  const canFinishSignup = signupStatus === "approved";

  async function checkSignupAccessStatus() {
    if (!email.trim()) {
      setError("Informe o e-mail para verificar aprovacao.");
      return;
    }

    setCheckingStatus(true);
    setError(null);
    setInfo(null);
    try {
      const status = await fetchAccessStatus(email);
      setSignupStatus(status);
      setInfo(getAccessStatusMessage(status));
    } catch (err: any) {
      setError(String(err?.message || "Falha ao consultar status de acesso."));
    } finally {
      setCheckingStatus(false);
    }
  }

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) {
      setError("Servico indisponivel no momento.");
      return;
    }

    if (isRequest) {
      await handleRequestAccess();
      return;
    }

    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const normalizedEmail = email.trim().toLowerCase();

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
          options: {
            data: {
              name: name.trim(),
            },
          },
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
      const rawMessage = String(err?.message || "Falha na autenticacao.");
      setError(mapSignupErrorMessage(rawMessage));
    } finally {
      setLoading(false);
    }
  }

  async function handleRequestAccess() {
    if (!supabase) {
      setError("Servico indisponivel no momento.");
      return;
    }
    if (!name.trim()) {
      setError("Informe seu nome para solicitar acesso.");
      return;
    }
    if (!email.trim()) {
      setError("Informe seu e-mail para solicitar acesso.");
      return;
    }

    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const result = await requestAccess(name, email);
      setInfo(result.message || getAccessStatusMessage(result.status));
    } catch (err: any) {
      setError(String(err?.message || "Falha ao enviar solicitacao de acesso."));
    } finally {
      setLoading(false);
    }
  }

  async function handleSocialLogin(provider: "google" | "github") {
    if (!supabase) return;
    try {
      setLoading(true);
      setError(null);
      setInfo(null);
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: window.location.origin,
        },
      });
      if (oauthError) throw oauthError;
    } catch (err: any) {
      setError(String(err?.message || "Falha no login social."));
    } finally {
      setLoading(false);
    }
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
          <p className="text-white/40 mt-2 text-xs uppercase font-bold tracking-widest">
            Controle Financeiro Inteligente
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-8">
          <button
            onClick={() => handleSocialLogin("google")}
            disabled={loading}
            className="flex items-center justify-center gap-2 p-3 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all disabled:opacity-50"
          >
            <Mail size={18} className="text-red-400" />
            <span className="text-xs font-bold">Google</span>
          </button>
          <button
            onClick={() => handleSocialLogin("github")}
            disabled={loading}
            className="flex items-center justify-center gap-2 p-3 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all disabled:opacity-50"
          >
            <Github size={18} />
            <span className="text-xs font-bold">GitHub</span>
          </button>
        </div>

        <div className="relative mb-8">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-white/5"></div>
          </div>
          <div className="relative flex justify-center text-[10px] uppercase font-bold tracking-widest">
            <span className="bg-[#0c0c0c] px-4 text-white/20">Ou com e-mail</span>
          </div>
        </div>

        <form onSubmit={handleAuth} className="space-y-4">
          {(isSignUp || isRequest) && (
            <div>
              <label className="block text-sm text-white/60 mb-1">Nome</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none"
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
              onChange={(e) => {
                setEmail(e.target.value);
                if (isSignUp) {
                  setSignupStatus(null);
                }
              }}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none"
              placeholder="seu@email.com"
            />
          </div>

          {isSignUp && (
            <button
              type="button"
              onClick={checkSignupAccessStatus}
              disabled={checkingStatus || loading}
              className="w-full bg-white/5 border border-white/10 text-white font-bold py-2.5 rounded-xl hover:bg-white/10 transition-colors disabled:opacity-50"
            >
              {checkingStatus ? "Verificando..." : "Verificar aprovacao do e-mail"}
            </button>
          )}

          {(isLogin || (isSignUp && canFinishSignup)) && (
            <div>
              <label className="block text-sm text-white/60 mb-1">Senha</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none"
                placeholder="********"
              />
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg">
              {error}
            </div>
          )}

          {info && (
            <div className="p-3 bg-brand-primary/10 border border-brand-primary/20 text-brand-primary text-sm rounded-lg">
              {info}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || (isSignUp && !canFinishSignup)}
            className="w-full bg-brand-primary text-black font-bold py-3 rounded-xl hover:opacity-90 transition-opacity flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-black border-t-transparent"></div>
            ) : (
              <>
                {isSignUp ? <UserPlus size={20} /> : <LogIn size={20} />}
                <span>
                  {mode === "login" && "Entrar"}
                  {mode === "request" && "Solicitar acesso"}
                  {mode === "signup" && "Finalizar cadastro"}
                </span>
              </>
            )}
          </button>
        </form>

        <div className="mt-6 grid grid-cols-1 gap-2 text-center">
          <button
            onClick={() => {
              setMode("login");
              setError(null);
              setInfo(null);
            }}
            className={`text-sm transition-colors ${mode === "login" ? "text-brand-primary" : "text-white/40 hover:text-brand-primary"}`}
          >
            Ja tenho conta
          </button>
          <button
            onClick={() => {
              setMode("request");
              setError(null);
              setInfo(null);
            }}
            className={`text-sm transition-colors ${mode === "request" ? "text-brand-primary" : "text-white/40 hover:text-brand-primary"}`}
          >
            Solicitar acesso
          </button>
          <button
            onClick={() => {
              setMode("signup");
              setError(null);
              setInfo(null);
              setSignupStatus(null);
            }}
            className={`text-sm transition-colors ${mode === "signup" ? "text-brand-primary" : "text-white/40 hover:text-brand-primary"}`}
          >
            Finalizar cadastro (aprovados)
          </button>
        </div>
      </div>
    </div>
  );
}

