import React, { lazy, Suspense, useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from './lib/supabase';
import { Session } from '@supabase/supabase-js';

const Auth = lazy(() => import('./components/Auth'));
const AuthCallback = lazy(() => import('./components/AuthCallback'));
const Dashboard = lazy(() => import('./components/Dashboard'));
const ConfigRequired = lazy(() => import('./components/ConfigRequired'));

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const currentPath = typeof window !== 'undefined' ? window.location.pathname : '/';

  useEffect(() => {
    if (!isSupabaseConfigured() || !supabase) {
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050505] text-white">
        <div className="space-y-4 text-center">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-[#00f2ff] border-t-transparent" />
          <p className="text-sm text-white/60">Carregando MFinanceiro...</p>
        </div>
      </div>
    );
  }

  if (!isSupabaseConfigured() || !supabase) {
    return (
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-[#050505] text-white">Carregando configuração...</div>}>
        <ConfigRequired />
      </Suspense>
    );
  }

  if (currentPath === '/auth/callback') {
    return (
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-[#050505] text-white">Finalizando confirmação...</div>}>
        <AuthCallback />
      </Suspense>
    );
  }

  if (!session) {
    return (
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-[#050505] text-white">Carregando autenticação...</div>}>
        <Auth />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-[#050505] text-white">Carregando dashboard...</div>}>
      <Dashboard key={session.user.id} user={session.user} />
    </Suspense>
  );
}
