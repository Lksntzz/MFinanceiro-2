import React, { useState } from 'react';
import { CheckCircle2, Github, LogIn, Mail, ShieldCheck, UserPlus, Wallet } from 'lucide-react';

import { mapLoginErrorMessage, requestAccess } from '../lib/access-control';
import { supabase } from '../lib/supabase';

type AuthMode = 'login' | 'request';

const STORAGE_EMAIL = 'mf-auth-email';
const STORAGE_NAME = 'mf-auth-name';
const ADMIN_LOGIN_PATH = '/admin-login';
const ADMIN_OAUTH_INTENT = 'mf-admin-oauth-intent';

function readLocal(key: string) {
  try { return window.localStorage.getItem(key) || ''; } catch { return ''; }
}

function writeLocal(key: string, value: string) {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Persistent identity is optional.
  }
}

function isAdminRoute() {
  return window.location.pathname.replace(/\/+$/, '') === ADMIN_LOGIN_PATH;
}

export default function Auth() {
  const adminRoute = isAdminRoute();
  const [mode, setMode] = useState<AuthMode>('login');
  const [name, setName] = useState(readLocal(STORAGE_NAME));
  const [email, setEmail] = useState(readLocal(STORAGE_EMAIL));
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const adminDenied = adminRoute && new URLSearchParams(window.location.search).get('denied') === '1';

  function clearMessages() {
    setError(null);
    setInfo(null);
  }

  async function handleAdminGithub() {
    setLoading(true);
    clearMessages();
    try {
      window.sessionStorage.setItem(ADMIN_OAUTH_INTENT, '1');
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'github',
        options: { redirectTo: `${window.location.origin}${ADMIN_LOGIN_PATH}` },
      });
      if (oauthError) throw oauthError;
    } catch (authError) {
      try { window.sessionStorage.removeItem(ADMIN_OAUTH_INTENT); } catch { /* noop */ }
      setError('Não foi possível iniciar o acesso administrativo.');
      setLoading(false);
    }
  }

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) return;

    setLoading(true);
    clearMessages();
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      if (signInError) throw signInError;
      writeLocal(STORAGE_EMAIL, normalizedEmail);
    } catch (loginError) {
      setError(mapLoginErrorMessage(loginError instanceof Error ? loginError.message : 'Falha na autenticação.'));
    } finally {
      setLoading(false);
    }
  }

  async function handleRequest(event: React.FormEvent) {
    event.preventDefault();
    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();

    setLoading(true);
    clearMessages();
    try {
      const result = await requestAccess(normalizedName, normalizedEmail);
      writeLocal(STORAGE_NAME, normalizedName);
      writeLocal(STORAGE_EMAIL, normalizedEmail);
      setRequestSent(true);
      setInfo(result.message);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível enviar sua solicitação.');
    } finally {
      setLoading(false);
    }
  }

  function switchMode(next: AuthMode) {
    setMode(next);
    setPassword('');
    setRequestSent(false);
    clearMessages();
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#050505] overflow-hidden">
      <div className="glass-card w-full max-w-md p-8 relative overflow-hidden animate-fade-in">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-brand-primary via-brand-secondary to-brand-primary" />

        <div className="flex flex-col items-center mb-8">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-brand-primary to-brand-secondary flex items-center justify-center mb-4 shadow-[0_0_28px_rgba(0,242,255,0.24)]">
            {adminRoute ? <ShieldCheck className="text-white" size={28} /> : <Wallet className="text-white" size={28} />}
          </div>
          <h1 className="text-3xl font-black tracking-tighter">MFinanceiro</h1>
          <p className="text-white/40 mt-2 text-xs uppercase font-bold tracking-widest">Controle Financeiro Inteligente</p>
        </div>

        {adminRoute ? (
          <div className="space-y-4">
            <div className="text-center mb-5">
              <h2 className="text-sm font-bold text-white/85">Acesso administrativo</h2>
              <p className="mt-1 text-[11px] text-white/35">Entrada exclusiva para administradores autorizados.</p>
            </div>
            {adminDenied && <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg">Esta conta não possui autorização administrativa.</div>}
            {error && <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg">{error}</div>}
            <button type="button" onClick={() => void handleAdminGithub()} disabled={loading} className="w-full bg-white/8 border border-white/10 text-white font-bold py-3 rounded-xl hover:bg-white/12 transition-all flex items-center justify-center gap-2 disabled:opacity-50">
              {loading ? <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <><Github size={20} /><span>Entrar com GitHub</span></>}
            </button>
            <button type="button" onClick={() => window.location.assign('/')} className="w-full text-[10px] uppercase font-bold tracking-widest text-white/25 hover:text-white/55 transition-colors">Voltar ao acesso normal</button>
          </div>
        ) : requestSent ? (
          <div className="space-y-4 text-center">
            <CheckCircle2 size={34} className="mx-auto text-brand-primary" />
            <div>
              <h2 className="text-sm font-bold text-white/85">Solicitação recebida</h2>
              <p className="mt-2 text-sm leading-relaxed text-white/50">{info}</p>
              <p className="mt-2 text-[10px] leading-relaxed text-white/30">Por segurança, o MF não informa nesta tela se um e-mail já possui conta ou o estado interno da solicitação.</p>
            </div>
            <button type="button" onClick={() => switchMode('login')} className="w-full bg-brand-primary text-black font-bold py-3 rounded-xl">Voltar para entrar</button>
          </div>
        ) : (
          <>
            <div className="mb-5 text-center">
              <h2 className="text-sm font-bold text-white/85">{mode === 'login' ? 'Acesse sua conta' : 'Solicite seu acesso'}</h2>
              <p className="mt-1 text-[11px] text-white/35">{mode === 'login' ? 'Entre com seu e-mail e senha.' : 'Informe seus dados. Se houver uma próxima etapa, ela chegará por e-mail.'}</p>
            </div>

            <form onSubmit={mode === 'login' ? handleLogin : handleRequest} className="space-y-4">
              {mode === 'request' && (
                <div>
                  <label htmlFor="mf-auth-name" className="block text-sm text-white/60 mb-1">Nome</label>
                  <input id="mf-auth-name" type="text" required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none" placeholder="Seu nome" />
                </div>
              )}

              <div>
                <label htmlFor="mf-auth-email" className="block text-sm text-white/60 mb-1">E-mail</label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
                  <input id="mf-auth-email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-3 focus:border-brand-primary outline-none" placeholder="seu@email.com" />
                </div>
              </div>

              {mode === 'login' && (
                <div>
                  <label htmlFor="mf-auth-password" className="block text-sm text-white/60 mb-1">Senha</label>
                  <input id="mf-auth-password" type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none" placeholder="Sua senha" />
                </div>
              )}

              {error && <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg">{error}</div>}
              {info && <div className="p-3 bg-brand-primary/10 border border-brand-primary/20 text-brand-primary text-sm rounded-lg">{info}</div>}

              <button type="submit" disabled={loading} className="w-full bg-brand-primary text-black font-bold py-3 rounded-xl hover:opacity-90 transition-opacity flex items-center justify-center gap-2 disabled:opacity-50 shadow-[0_4px_20px_rgba(0,242,255,0.2)]">
                {loading ? <div className="h-5 w-5 animate-spin rounded-full border-2 border-black border-t-transparent" /> : mode === 'login' ? <><LogIn size={20} />Entrar</> : <><UserPlus size={20} />Solicitar acesso</>}
              </button>
            </form>

            <button type="button" onClick={() => switchMode(mode === 'login' ? 'request' : 'login')} className="mt-5 w-full text-[10px] uppercase font-bold tracking-widest text-white/30 hover:text-white/60 transition-colors">
              {mode === 'login' ? 'Ainda não tenho acesso' : 'Já tenho uma conta'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
