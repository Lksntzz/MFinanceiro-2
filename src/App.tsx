import React, { lazy, Suspense, useEffect, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import {
  fetchMaintenanceConfig,
  isMaintenanceAdmin,
  type MaintenanceConfig,
} from './lib/maintenance';
import Dashboard from './components/Dashboard';

const Auth = lazy(() => import('./components/Auth'));
const AuthCallback = lazy(() => import('./components/AuthCallback'));
const ConfigRequired = lazy(() => import('./components/ConfigRequired'));
const MaintenanceScreen = lazy(() => import('./components/MaintenanceScreen'));

const DEFAULT_MAINTENANCE: MaintenanceConfig = {
  maintenance_mode: false,
  maintenance_message:
    'Estamos em manutencao para melhorias. Tente novamente em alguns minutos.',
};

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [maintenanceConfig, setMaintenanceConfig] =
    useState<MaintenanceConfig>(DEFAULT_MAINTENANCE);

  const currentPath =
    typeof window !== 'undefined' ? window.location.pathname : '/';
  const isAdminLoginPath = currentPath === '/auth/admin';
  const isDev = import.meta.env.DEV;

  useEffect(() => {
    if (!isSupabaseConfigured() || !supabase) {
      setLoading(false);
      return;
    }

    let active = true;

    const refreshMaintenance = async () => {
      if (!supabase) return;
      try {
        const config = await fetchMaintenanceConfig(supabase);
        if (active) setMaintenanceConfig(config);
      } catch (error) {
        console.error('[maintenance] Falha ao ler configuracao:', error);
      }
    };

    const bootstrap = async () => {
      if (!supabase) return;
      try {
        const [{ data }, config] = await Promise.all([
          supabase.auth.getSession(),
          fetchMaintenanceConfig(supabase),
        ]);

        if (!active) return;

        setSession(data.session);
        setMaintenanceConfig(config);
      } catch (error) {
        console.error('[app] Erro na inicializacao de sessao/manutencao:', error);
      } finally {
        if (active) setLoading(false);
      }
    };

    void bootstrap();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      void refreshMaintenance();
    });

    const polling = window.setInterval(() => {
      void refreshMaintenance();
    }, 30000);

    return () => {
      active = false;
      subscription.unsubscribe();
      window.clearInterval(polling);
    };
  }, []);

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center overflow-hidden bg-[#050505] text-white">
        <div className="space-y-4 text-center">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-[#00f2ff] border-t-transparent" />
          <p className="text-sm text-white/60">Carregando MFinanceiro...</p>
        </div>
      </div>
    );
  }

  if (!isSupabaseConfigured() || !supabase) {
    return (
      <Suspense
        fallback={
          <div className="flex h-dvh items-center justify-center overflow-hidden bg-[#050505] text-white">
            Carregando configuracao...
          </div>
        }
      >
        <ConfigRequired />
      </Suspense>
    );
  }

  // Nao bloquear callback para nao quebrar login/confirmacao de conta.
  if (currentPath === '/auth/callback') {
    return (
      <Suspense
        fallback={
          <div className="flex h-dvh items-center justify-center overflow-hidden bg-[#050505] text-white">
            Finalizando confirmacao...
          </div>
        }
      >
        <AuthCallback />
      </Suspense>
    );
  }

  const adminBypass = isMaintenanceAdmin(session);
  if (isDev) {
    console.debug('[maintenance] state', {
      path: currentPath,
      email: session?.user?.email || null,
      maintenance_mode: maintenanceConfig.maintenance_mode,
      adminBypass,
    });
  }

  // Modo manutencao:
  // - Usuario comum bloqueado antes do login.
  // - Login permitido apenas na rota administrativa /auth/admin.
  if (maintenanceConfig.maintenance_mode) {
    if (!session && !isAdminLoginPath) {
      return (
        <Suspense
          fallback={
            <div className="flex h-dvh items-center justify-center overflow-hidden bg-[#050505] text-white">
              Carregando manutencao...
            </div>
          }
        >
          <MaintenanceScreen
            message={maintenanceConfig.maintenance_message}
            isAdminBypass={false}
            showAdminLoginButton={true}
            adminLoginHref="/auth/admin"
          />
        </Suspense>
      );
    }

    if (session && !adminBypass) {
      return (
        <Suspense
          fallback={
            <div className="flex h-dvh items-center justify-center overflow-hidden bg-[#050505] text-white">
              Carregando manutencao...
            </div>
          }
        >
          <MaintenanceScreen
            message={maintenanceConfig.maintenance_message}
            isAdminBypass={false}
          />
        </Suspense>
      );
    }
  }

  if (!session) {
    return (
      <Suspense
        fallback={
          <div className="flex h-dvh items-center justify-center overflow-hidden bg-[#050505] text-white">
            Carregando autenticacao...
          </div>
        }
      >
        <Auth />
      </Suspense>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="flex h-dvh items-center justify-center overflow-hidden bg-[#050505] text-white">
          Carregando dashboard...
        </div>
      }
    >
      <Dashboard
        key={session.user.id}
        user={session.user}
        maintenanceActive={maintenanceConfig.maintenance_mode && adminBypass}
      />
    </Suspense>
  );
}


