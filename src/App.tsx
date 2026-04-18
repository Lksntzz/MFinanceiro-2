import React, { useEffect, useRef, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from './lib/supabase';
import Auth from './components/Auth';
import Dashboard from './components/Dashboard';
import ConfigRequired from './components/ConfigRequired';
import MaintenanceScreen from './components/MaintenanceScreen';
import {
  fetchMaintenanceConfig,
  isMaintenanceAdmin,
  MaintenanceConfig,
} from './lib/maintenance';

const MAINTENANCE_POLL_MS = 5000;

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [maintenance, setMaintenance] = useState<MaintenanceConfig | null>(null);
  const maintenanceModeRef = useRef(false);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }

    let active = true;

    const initialize = async () => {
      try {
        const [maintenanceResult, sessionResult] = await Promise.all([
          fetchMaintenanceConfig(supabase),
          supabase.auth.getSession(),
        ]);

        if (!active) return;

        setMaintenance(maintenanceResult);
        maintenanceModeRef.current = Boolean(maintenanceResult.maintenance_mode);

        const {
          data: { session: currentSession },
          error,
        } = sessionResult;

        if (error) {
          console.error('Error getting session:', error);
          await supabase.auth.signOut();
          setSession(null);
          return;
        }

        if (
          maintenanceResult.maintenance_mode &&
          currentSession &&
          !isMaintenanceAdmin(currentSession)
        ) {
          await supabase.auth.signOut();
          setSession(null);
          return;
        }

        setSession(currentSession);
      } catch (e) {
        console.error('Initialization error:', e);
      } finally {
        if (active) setLoading(false);
      }
    };

    initialize();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      if (
        maintenanceModeRef.current &&
        nextSession &&
        !isMaintenanceAdmin(nextSession)
      ) {
        await supabase.auth.signOut();
        setSession(null);
        return;
      }

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
        const config = await fetchMaintenanceConfig(supabase);
        if (!active) return;

        setMaintenance(config);
        maintenanceModeRef.current = Boolean(config.maintenance_mode);

        if (config.maintenance_mode) {
          const {
            data: { session: currentSession },
          } = await supabase.auth.getSession();

          if (
            active &&
            currentSession &&
            !isMaintenanceAdmin(currentSession)
          ) {
            await supabase.auth.signOut();
            setSession(null);
          }
        }
      } catch (e) {
        console.warn('Maintenance refresh failed:', e);
      }
    };

    const channel = supabase
      .channel('maintenance-live-watch')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mf_global_settings' },
        () => {
          refreshMaintenance();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mf_app_config' },
        () => {
          refreshMaintenance();
        }
      )
      .subscribe();

    const pollTimer = window.setInterval(refreshMaintenance, MAINTENANCE_POLL_MS);

    return () => {
      active = false;
      clearInterval(pollTimer);
      supabase.removeChannel(channel);
    };
  }, []);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#050505]">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-[#00f2ff] border-t-transparent"></div>
      </div>
    );
  }

  if (!isSupabaseConfigured()) {
    return <ConfigRequired />;
  }

  const isAdmin = isMaintenanceAdmin(session);
  const isMaintenanceActive = Boolean(maintenance?.maintenance_mode) && !isAdmin;

  if (isMaintenanceActive) {
    return <MaintenanceScreen message={maintenance?.maintenance_message} />;
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
