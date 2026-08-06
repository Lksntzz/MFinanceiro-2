import React, { useEffect, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from './lib/supabase';
import Auth from './components/Auth';
import Dashboard from './components/Dashboard';
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

    const loadFreshSession = async (incoming?: Session | null) => {
      try {
        if (!incoming) {
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          incoming = data.session;
        }

        if (!incoming) {
          if (active) setSession(null);
          return;
        }

        // Force a new JWT so recently changed app_metadata roles are reflected.
        const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError) throw refreshError;

        const currentSession = refreshed.session ?? incoming;
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;

        if (active) {
          setSession({
            ...currentSession,
            user: userData.user ?? currentSession.user,
          });
        }
      } catch (err) {
        console.error('Falha ao atualizar sessão:', err);
        if (active) setSession(incoming ?? null);
      }
    };

    fetchMaintenanceConfig(supabase)
      .then((config) => active && setMaintenance(config))
      .catch((err) => console.warn('Falha na verificação de manutenção:', err));

    loadFreshSession()
      .finally(() => active && setLoading(false));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'SIGNED_OUT' || !nextSession) {
        setSession(null);
        return;
      }

      // Avoid doing network work synchronously inside the auth callback.
      window.setTimeout(() => {
        loadFreshSession(nextSession);
      }, 0);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#050505]">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-[#00f2ff] border-t-transparent" />
      </div>
    );
  }

  if (!isSupabaseConfigured()) {
    return <ConfigRequired />;
  }

  const isAdmin = isMaintenanceAdmin(session);
  const isMaintenanceActive = maintenance?.maintenance_mode && !isAdmin;

  if (isMaintenanceActive && !forceAdminAuth) {
    return (
      <MaintenanceScreen
        message={maintenance?.maintenance_message}
        onAdminLogin={() => setForceAdminAuth(true)}
      />
    );
  }

  if (!session) {
    return <Auth />;
  }

  return (
    <Dashboard
      user={session.user}
      isMaintenanceBypass={isAdmin && Boolean(maintenance?.maintenance_mode)}
    />
  );
}
