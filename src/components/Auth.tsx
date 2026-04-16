
import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Wallet, LogIn, UserPlus, Mail, RefreshCw } from 'lucide-react';

export default function Auth() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [awaitingEmailConfirmation, setAwaitingEmailConfirmation] = useState(false);
  const [pendingEmail, setPendingEmail] = useState('');
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  function getEmailRedirectTo() {
    return `${window.location.origin}/auth/callback`;
  }

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResendMessage(null);

    if (!supabase) {
      setError('Supabase não está configurado corretamente.');
      setLoading(false);
      return;
    }

    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: getEmailRedirectTo(),
          },
        });
        if (error) throw error;
        if (data.session) {
          window.location.reload();
        } else {
          setPendingEmail(email);
          setAwaitingEmailConfirmation(true);
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (data.session) {
          window.location.reload();
        } else {
          setError('Login enviado, mas a sessão não foi criada. Verifique a configuração do Supabase Auth.');
        }
      }
    } catch (err: any) {
      console.error('Auth error:', err);
      setError(err?.message || 'Não foi possível autenticar.');
    } finally {
      setLoading(false);
    }
  }

  async function handleResendConfirmation() {
    setError(null);
    setResendMessage(null);

    if (!supabase) {
      setError('Supabase não está configurado corretamente.');
      return;
    }

    if (!pendingEmail) {
      setError('Não há e-mail pendente para reenvio.');
      return;
    }

    setResendLoading(true);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: pendingEmail,
        options: {
          emailRedirectTo: getEmailRedirectTo(),
        },
      });
      if (error) throw error;
      setResendMessage('E-mail de confirmação reenviado. Verifique sua caixa de entrada.');
    } catch (err: any) {
      console.error('Resend confirmation error:', err);
      setError(err?.message || 'Não foi possível reenviar o e-mail de confirmação.');
    } finally {
      setResendLoading(false);
    }
  }

  if (awaitingEmailConfirmation) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="glass-card w-full max-w-md p-8 animate-fade-in">
          <div className="flex flex-col items-center mb-6 text-center">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-brand-primary to-brand-secondary flex items-center justify-center mb-4">
              <Mail className="text-white" size={30} />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Confirme seu e-mail</h1>
            <p className="text-white/60 mt-2 text-sm">
              Enviamos um link de confirmação para <span className="font-semibold text-white">{pendingEmail}</span>.
            </p>
          </div>

          <div className="space-y-3">
            <button
              onClick={handleResendConfirmation}
              disabled={resendLoading}
              className="w-full bg-white/10 text-white font-bold py-3 rounded-xl hover:bg-white/20 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {resendLoading ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
              ) : (
                <>
                  <RefreshCw size={18} />
                  <span>Reenviar e-mail de confirmação</span>
                </>
              )}
            </button>

            <button
              onClick={() => {
                setAwaitingEmailConfirmation(false);
                setIsSignUp(false);
                setPassword('');
              }}
              className="w-full bg-brand-primary text-black font-bold py-3 rounded-xl hover:opacity-90 transition-opacity"
            >
              Voltar para login
            </button>
          </div>

          {resendMessage && (
            <div className="mt-4 p-3 bg-green-500/10 border border-green-500/20 text-green-400 text-sm rounded-lg">
              {resendMessage}
            </div>
          )}

          {error && (
            <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg">
              {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="glass-card w-full max-w-md p-8 animate-fade-in">
        <div className="flex flex-col items-center mb-8">
          <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-brand-primary to-brand-secondary flex items-center justify-center mb-4">
            <Wallet className="text-white" size={32} />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">MFinanceiro</h1>
          <p className="text-white/60 mt-2">Seu controle financeiro inteligente</p>
        </div>

        <form onSubmit={handleAuth} className="space-y-4">
          <div>
            <label className="block text-sm text-white/60 mb-1">E-mail</label>
            <input 
              type="email" 
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none"
              placeholder="seu@email.com"
            />
          </div>
          <div>
            <label className="block text-sm text-white/60 mb-1">Senha</label>
            <input 
              type="password" 
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg">
              {error}
            </div>
          )}

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-brand-primary text-black font-bold py-3 rounded-xl hover:opacity-90 transition-opacity flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-black border-t-transparent"></div>
            ) : (
              <>
                {isSignUp ? <UserPlus size={20} /> : <LogIn size={20} />}
                <span>{isSignUp ? 'Criar Conta' : 'Entrar'}</span>
              </>
            )}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button 
            onClick={() => setIsSignUp(!isSignUp)}
            className="text-sm text-white/40 hover:text-brand-primary transition-colors"
          >
            {isSignUp ? 'Já tem uma conta? Entre aqui' : 'Não tem uma conta? Cadastre-se'}
          </button>
        </div>
      </div>
    </div>
  );
}
