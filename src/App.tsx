import React, { useState, useEffect } from 'react';
import { supabase, isSupabaseConfigured } from './lib/supabase';
import Auth from './components/Auth';
import Dashboard from './components/Dashboard';
import ConfigRequired from './components/ConfigRequired';
import MaintenanceScreen from './components/MaintenanceScreen';
import { fetchMaintenanceConfig, isMaintenanceAdmin, MaintenanceConfig } from './lib/maintenance';
import { Session } from '@supabase/supabase-js';

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

    // Check for maintenance mode
    fetchMaintenanceConfig(supabase).then(config => {
      setMaintenance(config);
    });

    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        console.error('Error getting session:', error);
        supabase.auth.signOut();
        setSession(null);
      } else {
        setSession(session);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
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
  const isMaintenanceActive = maintenance?.maintenance_mode && !isAdmin;

  // Se estiver em manutenção e NÃO for admin, mostra tela de manutenção
  // Caso o usuário clique em "Entrar como adm", liberamos o Auth mesmo em manutenção
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

  return <Dashboard user={session.user} isMaintenanceBypass={isAdmin && (maintenance?.maintenance_mode || false)} />;
}
