import React, { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { CheckCircle2, KeyRound, Wallet } from 'lucide-react';

import { supabase } from '../lib/supabase';

export default function InviteActivation({ session }: { session: Session | null }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function activate(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Use uma senha com pelo menos 8 caracteres.');
      return;
    }
    if (password !== confirmation) {
      setError('As senhas não coincidem.');
      return;
    }

    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setPassword('');
      setConfirmation('');
      setComplete(true);
    } catch {
      setError('Não foi possível concluir a ativação. O convite pode ter expirado; solicite um novo acesso.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#050505]">
      <div className="glass-card w-full max-w-md p-8 relative overflow-hidden animate-fade-in">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-brand-primary via-brand-secondary to-brand-primary" />
        <div className="flex flex-col items-center text-center mb-6">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-brand-primary to-brand-secondary flex items-center justify-center mb-4">
            {complete ? <CheckCircle2 size={28} className="text-white" /> : <Wallet size={28} className="text-white" />}
          </div>
          <h1 className="text-2xl font-black tracking-tight">{complete ? 'Conta pronta' : 'Ativar acesso ao MF'}</h1>
          <p className="mt-2 text-xs leading-relaxed text-white/40">
            {complete
              ? 'Sua senha foi definida e o acesso está pronto para uso.'
              : session
                ? `Convite validado${session.user.email ? ` para ${session.user.email}` : ''}. Defina sua senha para concluir.`
                : 'Este convite não está mais válido nesta sessão. Solicite um novo acesso para receber outro link.'}
          </p>
        </div>

        {complete ? (
          <button type="button" onClick={() => window.location.replace('/app')} className="w-full bg-brand-primary text-black font-bold py-3 rounded-xl">
            Entrar no MF
          </button>
        ) : session ? (
          <form onSubmit={activate} className="space-y-4">
            <div>
              <label className="block text-sm text-white/60 mb-1">Nova senha</label>
              <div className="relative">
                <KeyRound size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
                <input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-3 outline-none focus:border-brand-primary" placeholder="Mínimo de 8 caracteres" />
              </div>
            </div>
            <div>
              <label className="block text-sm text-white/60 mb-1">Confirmar senha</label>
              <input type="password" required minLength={8} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl p-3 outline-none focus:border-brand-primary" placeholder="Repita a senha" />
            </div>
            {error && <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg">{error}</div>}
            <button type="submit" disabled={loading} className="w-full bg-brand-primary text-black font-bold py-3 rounded-xl disabled:opacity-50">
              {loading ? 'Ativando...' : 'Definir senha e continuar'}
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => window.location.replace('/')} className="w-full bg-brand-primary text-black font-bold py-3 rounded-xl">
            Voltar ao acesso
          </button>
        )}
      </div>
    </div>
  );
}
