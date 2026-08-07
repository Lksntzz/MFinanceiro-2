import React, { useEffect, useLayoutEffect, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from './lib/supabase';
import Auth from './components/Auth';
import DashboardBootstrap from './components/DashboardBootstrap';
import ConfigRequired from './components/ConfigRequired';
import MaintenanceScreen from './components/MaintenanceScreen';
import { fetchMaintenanceConfig, isMaintenanceAdmin, MaintenanceConfig } from './lib/maintenance';

const ADMIN_LOGIN_PATH = '/admin-login';
const ADMIN_OAUTH_INTENT = 'mf-admin-oauth-intent';
const STORAGE_EMAIL = 'mf-auth-email';
const AWAITING_CONFIRMATION_EMAIL = 'mf-awaiting-email-confirmation';
const CONFIRMED_EMAIL_STORAGE = 'mf-confirmed-email';

function normalizeMaintenanceRow(row: any): MaintenanceConfig {
  return {
    maintenance_mode: row?.maintenance_mode === true,
    maintenance_message:
      String(row?.maintenance_message || '').trim() ||
      'Estamos realizando melhorias importantes. O MFinanceiro estará disponível novamente em breve.',
  };
}

function hasAdminOAuthIntent() {
  try {
    return window.sessionStorage.getItem(ADMIN_OAUTH_INTENT) === '1';
  } catch {
    return false;
  }
}

function clearAdminOAuthIntent() {
  try {
    window.sessionStorage.removeItem(ADMIN_OAUTH_INTENT);
  } catch {
    // Ignore storage failures.
  }
}

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function isEmailConfirmationReturn() {
  return new URLSearchParams(window.location.search).get('email_confirmed') === '1';
}

function getAwaitingConfirmationEmail() {
  try {
    return normalizeEmail(window.localStorage.getItem(AWAITING_CONFIRMATION_EMAIL));
  } catch {
    return '';
  }
}

function shouldHandleEmailConfirmation(session: Session | null) {
  if (isEmailConfirmationReturn()) return true;
  const awaiting = getAwaitingConfirmationEmail();
  return Boolean(awaiting && session?.user?.email && awaiting === normalizeEmail(session.user.email));
}

function rememberConfirmedEmail(email: string | null | undefined) {
  const normalized = normalizeEmail(email);
  if (!normalized) return;

  try {
    window.localStorage.setItem(STORAGE_EMAIL, normalized);
    window.localStorage.removeItem(AWAITING_CONFIRMATION_EMAIL);
  } catch {
    // The confirmation screen still works without persistent storage.
  }

  try {
    window.sessionStorage.setItem(CONFIRMED_EMAIL_STORAGE, normalized);
  } catch {
    // The e-mail can still be typed manually if session storage is unavailable.
  }

  window.dispatchEvent(new CustomEvent('mf:confirmed-email', { detail: normalized }));
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [maintenance, setMaintenance] = useState<MaintenanceConfig | null>(null);
  const [validatingAdminEntry, setValidatingAdminEntry] = useState(false);

  useLayoutEffect(() => {
    const styleId = 'mf-auth-navigation-gate';
    let style = document.getElementById(styleId) as HTMLStyleElement | null;
    let ownsStyle = false;

    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        body:not([data-mf-authenticated="true"]) #mf-simple-navigation-app {
          display: none !important;
        }
      `;
      document.head.appendChild(style);
      ownsStyle = true;
    }

    return () => {
      delete document.body.dataset.mfAuthenticated;
      document.body.classList.remove('mf-sidebar-navigation-active');
      if (ownsStyle) style?.remove();
    };
  }, []);

  useLayoutEffect(() => {
    if (session) {
      document.body.dataset.mfAuthenticated = 'true';
      document.body.classList.add('mf-sidebar-navigation-active');
      return;
    }

    delete document.body.dataset.mfAuthenticated;
    document.body.classList.remove('mf-sidebar-navigation-active');
  }, [session]);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }

    let active = true;

    const finishEmailConfirmation = async (candidateSession: Session | null) => {
      rememberConfirmedEmail(candidateSession?.user?.email);

      if (candidateSession) {
        const { error } = await supabase.auth.signOut({ scope: 'local' });
        if (error) console.warn('Falha ao encerrar sessão temporária de confirmação:', error);
      }

      if (active) setSession(null);
    };

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
          const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
          if (!refreshError && refreshed.session) currentSession = refreshed.session;
        }

        if (shouldHandleEmailConfirmation(currentSession)) {
          await finishEmailConfirmation(currentSession);
          return;
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

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;

      if (nextSession && shouldHandleEmailConfirmation(nextSession)) {
        rememberConfirmedEmail(nextSession.user.email);
        setSession(null);
        window.setTimeout(() => {
          void supabase.auth.signOut({ scope: 'local' }).catch((err) => {
            console.warn('Falha ao encerrar sessão temporária de confirmação:', err);
          });
        }, 0);
        return;
      }

      if (event === 'SIGNED_OUT' || !nextSession) {
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
    if (!session) return;

    const adminRoute = window.location.pathname.replace(/\/+$/, '') === ADMIN_LOGIN_PATH;
    const oauthIntent = hasAdminOAuthIntent();
    if (!adminRoute && !oauthIntent) return;

    if (isMaintenanceAdmin(session)) {
      clearAdminOAuthIntent();
      if (adminRoute) window.history.replaceState({}, '', '/');
      setValidatingAdminEntry(false);
      return;
    }

    setValidatingAdminEntry(true);
    clearAdminOAuthIntent();
    void supabase.auth.signOut({ scope: 'local' }).finally(() => {
      window.history.replaceState({}, '', `${ADMIN_LOGIN_PATH}?denied=1`);
      setSession(null);
      setValidatingAdminEntry(false);
    });
  }, [session]);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    let active = true;

    const applyMaintenance = (next: MaintenanceConfig) => {
      if (!active) return;
      setMaintenance(next);
    };

    const refreshMaintenance = async () => {
      try {
        applyMaintenance(await fetchMaintenanceConfig(supabase));
      } catch (err) {
        console.warn('Falha ao atualizar o modo de manutenção:', err);
      }
    };

    const realtimeChannel = supabase
      .channel('mf-global-maintenance')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'mf_global_settings',
          filter: 'key=eq.global',
        },
        (payload) => {
          const row = payload.new as any;
          if (row && Object.keys(row).length) applyMaintenance(normalizeMaintenanceRow(row));
          else void refreshMaintenance();
        },
      )
      .on('broadcast', { event: 'maintenance-changed' }, ({ payload }) => {
        if (payload) applyMaintenance(normalizeMaintenanceRow(payload));
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') void refreshMaintenance();
      });

    const onFocus = () => void refreshMaintenance();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refreshMaintenance();
    };
    const onMaintenanceChanged = (event: Event) => {
      const next = (event as CustomEvent<MaintenanceConfig>).detail;
      if (next) applyMaintenance(next);
    };

    const fallbackInterval = window.setInterval(() => void refreshMaintenance(), 30000);
    window.addEventListener('focus', onFocus);
    window.addEventListener('mf:maintenance-changed', onMaintenanceChanged as EventListener);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      active = false;
      window.clearInterval(fallbackInterval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('mf:maintenance-changed', onMaintenanceChanged as EventListener);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      void supabase.removeChannel(realtimeChannel);
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
  const adminRoute = window.location.pathname.replace(/\/+$/, '') === ADMIN_LOGIN_PATH;
  const adminIntent = hasAdminOAuthIntent();
  const maintenanceEnabled = Boolean(maintenance?.maintenance_mode);
  const hiddenAdminLogin = new URLSearchParams(window.location.search).get('maintenance_admin') === '1';

  if (validatingAdminEntry || (session && (adminRoute || adminIntent) && !isAdmin)) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#050505]">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-[#00f2ff] border-t-transparent" />
          <p className="mt-4 text-xs font-bold uppercase tracking-widest text-white/35">Validando acesso administrativo</p>
        </div>
      </div>
    );
  }

  if (maintenanceEnabled && !isAdmin) {
    if (!session && (hiddenAdminLogin || adminRoute)) return <Auth />;
    return <MaintenanceScreen message={maintenance?.maintenance_message} />;
  }

  if (!session) return <Auth />;

  return (
    <DashboardBootstrap
      user={session.user}
      isMaintenanceBypass={isAdmin && maintenanceEnabled}
    />
  );
}
