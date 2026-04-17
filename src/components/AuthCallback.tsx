import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { clearLegacyCache } from '../lib/clearCache';

export default function AuthCallback() {
  const [statusMessage, setStatusMessage] = useState('Validando confirmação de e-mail...');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function finalizeAuthCallback() {
      if (!supabase) {
        if (!isMounted) return;
        setError('Supabase não está configurado.');
        return;
      }

      const currentUrl = new URL(window.location.href);
      const code = currentUrl.searchParams.get('code');
      const errorDescription =
        currentUrl.searchParams.get('error_description') ||
        currentUrl.searchParams.get('error');

      if (errorDescription) {
        if (!isMounted) return;
        setError(decodeURIComponent(errorDescription));
        return;
      }

      try {
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        }

        const { data } = await supabase.auth.getSession();
        if (data.session) {
          if (!isMounted) return;
          setStatusMessage('E-mail confirmado com sucesso. Redirecionando...');
          window.setTimeout(() => {
            clearLegacyCache();
            window.location.replace('/');
          }, 900);
          return;
        }

        if (!isMounted) return;
        setStatusMessage('Confirmação concluída. Faça login para continuar.');
        window.setTimeout(() => {
          window.location.replace('/');
        }, 1200);
      } catch (err: any) {
        if (!isMounted) return;
        setError(err?.message || 'Não foi possível concluir a confirmação de e-mail.');
      }
    }

    finalizeAuthCallback();
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div className="flex h-dvh items-center justify-center overflow-hidden bg-[#050505] text-white p-6">
      <div className="glass-card w-full max-w-md p-8 text-center space-y-3">
        {!error ? (
          <>
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-[#00f2ff] border-t-transparent" />
            <h1 className="text-xl font-bold">Confirmação de e-mail</h1>
            <p className="text-sm text-white/70">{statusMessage}</p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold text-red-400">Falha na confirmação</h1>
            <p className="text-sm text-white/70">{error}</p>
            <button
              onClick={() => window.location.replace('/')}
              className="mt-2 w-full rounded-xl bg-brand-primary py-2.5 font-bold text-black hover:opacity-90 transition-opacity"
            >
              Voltar para login
            </button>
          </>
        )}
      </div>
    </div>
  );
}


