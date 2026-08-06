import React, { useEffect, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from './lib/supabase';
import Auth from './components/Auth';
import DashboardBootstrap from './components/DashboardBootstrap';
import ConfigRequired from './components/ConfigRequired';
import MaintenanceScreen from './components/MaintenanceScreen';
import { fetchMaintenanceConfig, isMaintenanceAdmin, MaintenanceConfig } from './lib/maintenance';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [maintenance, setMaintenance] = useState<MaintenanceConfig | null>(null);
  const [forceAdminAuth, setForceAdminAuth] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }

    let active = true;

    const initialize = async () => {
      try {
        const [{ data: sessionData, error: sessionError }, maintenanceConfig] = await Promise.all([
          supabase.auth.getSession(),
          fetchMaintenanceConfig(supabase).catch((err) => {
            console.warn('Falha na verificação de manutenção:', err);
            return null;
          }),
        ]);

        if (sessionError) throw sessionError;
        if (!active) return;

        setMaintenance(maintenanceConfig);

        let currentSession = sessionData.session;
        if (currentSession) {
          // Refresh only once at application startup. Never refresh again from
          // TOKEN_REFRESHED, otherwise the auth listener creates an infinite loop.
          const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
          if (!refreshError && refreshed.session) currentSession = refreshed.session;
        }

        if (active) setSession(currentSession);
      } catch (err) {
        console.error('Falha ao carregar a sessão:', err);
        if (active) setSession(null);
      } finally {
        if (active) setLoading(false);
      }
    };

    void initialize();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;

      if (event === 'SIGNED_OUT' || !nextSession) {
        setSession(null);
        return;
      }

      // The session delivered by Supabase is already current. Setting it directly
      // avoids refresh storms and lets the Dashboard load financial records.
      setSession(nextSession);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    let active = true;

    const refreshMaintenance = async () => {
      try {
        const next = await fetchMaintenanceConfig(supabase);
        if (!active) return;
        setMaintenance(next);
        if (!next.maintenance_mode) setForceAdminAuth(false);
      } catch (err) {
        console.warn('Falha ao atualizar o modo de manutenção:', err);
      }
    };

    const onFocus = () => void refreshMaintenance();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refreshMaintenance();
    };
    const onMaintenanceChanged = (event: Event) => {
      const next = (event as CustomEvent<MaintenanceConfig>).detail;
      if (!next) return;
      setMaintenance(next);
      if (!next.maintenance_mode) setForceAdminAuth(false);
    };

    const intervalId = window.setInterval(() => void refreshMaintenance(), 10000);
    window.addEventListener('focus', onFocus);
    window.addEventListener('mf:maintenance-changed', onMaintenanceChanged as EventListener);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('mf:maintenance-changed', onMaintenanceChanged as EventListener);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#050505]">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-[#00f2ff] border-t-transparent" />
      </div>
    );
  }

  if (!isSupabaseConfigured()) return <ConfigRequired />;

  const isAdmin = isMaintenanceAdmin(session);
  const maintenanceEnabled = Boolean(maintenance?.maintenance_mode);

  if (maintenanceEnabled && !isAdmin) {
    if (!session && forceAdminAuth) return <Auth />;

    return (
      <MaintenanceScreen
        message={maintenance?.maintenance_message}
        onAdminLogin={async () => {
          if (session) {
            await supabase.auth.signOut();
            setSession(null);
          }
          setForceAdminAuth(true);
        }}
      />
    );
  }

  if (!session) return <Auth />;

  return (
    <DashboardBootstrap
      user={session.user}
      isMaintenanceBypass={isAdmin && maintenanceEnabled}
    />
  );
}
