import type { Session } from '@supabase/supabase-js';
import { lazy, Suspense, useEffect, useLayoutEffect, useState } from 'react';
import Auth from './components/Auth';
import ConfigRequired from './components/ConfigRequired';
import { nextBackoffDelay, withTimeout } from './lib/async-guards';
import {
  fetchMaintenanceConfig,
  fetchMaintenanceConfigWithStatus,
  isMaintenanceAdmin,
  MAINTENANCE_BROADCAST_EVENT,
  MAINTENANCE_CHANNEL,
  type MaintenanceConfig,
} from './lib/maintenance';
import { isSupabaseConfigured, supabase } from './lib/supabase';

const DashboardBootstrap = lazy(
  () => import('./components/DashboardBootstrap'),
);
const MaintenanceScreen = lazy(() => import('./components/MaintenanceScreen'));

const ADMIN_LOGIN_PATH = '/admin-login';
const ADMIN_OAUTH_INTENT = 'mf-admin-oauth-intent';
const STORAGE_EMAIL = 'mf-auth-email';
const AWAITING_CONFIRMATION_EMAIL = 'mf-awaiting-email-confirmation';
const CONFIRMED_EMAIL_STORAGE = 'mf-confirmed-email';
const MAINTENANCE_FALLBACK_POLL_MS = 30_000;
// Com falhas seguidas o intervalo dobra até este teto, aliviando um banco lento.
const MAINTENANCE_MAX_POLL_MS = 240_000;
// Foco/visibilidade/online não consultam de novo dentro desta janela.
const MAINTENANCE_NOISY_MIN_GAP_MS = 10_000;
// Se a renovação de sessão demorar mais que isso, o app segue com a sessão
// local; o resultado tardio chega por onAuthStateChange.
const SESSION_REFRESH_TIMEOUT_MS = 8_000;

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
  return String(value || '')
    .trim()
    .toLowerCase();
}

function isEmailConfirmationReturn() {
  return (
    new URLSearchParams(window.location.search).get('email_confirmed') === '1'
  );
}

function getAwaitingConfirmationEmail() {
  try {
    return normalizeEmail(
      window.localStorage.getItem(AWAITING_CONFIRMATION_EMAIL),
    );
  } catch {
    return '';
  }
}

function shouldHandleEmailConfirmation(session: Session | null) {
  if (isEmailConfirmationReturn()) return true;
  const awaiting = getAwaitingConfirmationEmail();
  return Boolean(
    awaiting &&
      session?.user?.email &&
      awaiting === normalizeEmail(session.user.email),
  );
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

  window.dispatchEvent(
    new CustomEvent('mf:confirmed-email', { detail: normalized }),
  );
}

function LoadingScreen({
  label = 'Carregando MF Financeiro',
}: {
  label?: string;
}) {
  return (
    <div
      className="flex h-screen items-center justify-center bg-[#050505]"
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className="text-center">
        <div
          className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-[#00f2ff] border-t-transparent"
          aria-hidden="true"
        />
        <span className="sr-only">{label}</span>
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [maintenance, setMaintenance] = useState<MaintenanceConfig | null>(
    null,
  );
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

    const finishEmailConfirmation = async (
      candidateSession: Session | null,
    ) => {
      rememberConfirmedEmail(candidateSession?.user?.email);

      if (candidateSession) {
        const { error } = await supabase.auth.signOut({ scope: 'local' });
        if (error)
          console.warn(
            'Falha ao encerrar sessão temporária de confirmação:',
            error,
          );
      }

      if (active) setSession(null);
    };

    const initialize = async () => {
      try {
        const [{ data: sessionData, error: sessionError }, maintenanceConfig] =
          await Promise.all([
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
          const refreshResult = await withTimeout(
            supabase.auth.refreshSession(),
            SESSION_REFRESH_TIMEOUT_MS,
            'Renovação de sessão',
          ).catch((err) => {
            console.warn(
              'Renovação de sessão lenta; seguindo com a local:',
              err,
            );
            return null;
          });
          if (
            refreshResult &&
            !refreshResult.error &&
            refreshResult.data.session
          )
            currentSession = refreshResult.data.session;
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
            console.warn(
              'Falha ao encerrar sessão temporária de confirmação:',
              err,
            );
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

    const adminRoute =
      window.location.pathname.replace(/\/+$/, '') === ADMIN_LOGIN_PATH;
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
    let refreshInFlight = false;
    let lastRefreshAt = 0;
    let consecutiveFailures = 0;
    let pollTimer: number | undefined;

    const applyMaintenance = (next: MaintenanceConfig) => {
      if (!active) return;
      setMaintenance(next);
    };

    // `force` é usado quando o próprio estado de manutenção mudou (Realtime,
    // broadcast, polling). Foco/visibilidade/online são "ruído" e respeitam
    // um intervalo mínimo para não martelar um banco lento.
    const refreshMaintenance = async ({ force = false } = {}) => {
      if (!active || refreshInFlight) return;
      if (!force && Date.now() - lastRefreshAt < MAINTENANCE_NOISY_MIN_GAP_MS)
        return;
      refreshInFlight = true;
      lastRefreshAt = Date.now();

      try {
        const { config, degraded } =
          await fetchMaintenanceConfigWithStatus(supabase);
        if (degraded) {
          // Rede/banco indisponível: não sobrescreve um estado já conhecido
          // com o padrão "manutenção desligada".
          consecutiveFailures += 1;
          return;
        }
        consecutiveFailures = 0;
        applyMaintenance(config);
      } catch (err) {
        consecutiveFailures += 1;
        console.warn('Falha ao atualizar o modo de manutenção:', err);
      } finally {
        refreshInFlight = false;
      }
    };

    const realtimeChannel = supabase
      .channel(MAINTENANCE_CHANNEL)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'mf_global_settings',
        },
        () => {
          void refreshMaintenance({ force: true });
        },
      )
      .on('broadcast', { event: MAINTENANCE_BROADCAST_EVENT }, () => {
        void refreshMaintenance({ force: true });
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void refreshMaintenance({ force: true });
        // CHANNEL_ERROR/TIMED_OUT não consultam o banco na hora: o Realtime
        // reconecta sozinho e o polling com backoff cobre a indisponibilidade.
        // Consultar a cada erro criava um ciclo que sobrecarregava o banco.
      });

    const onFocus = () => void refreshMaintenance();
    const onOnline = () => void refreshMaintenance();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refreshMaintenance();
    };
    const onMaintenanceChanged = (event: Event) => {
      const next = (event as CustomEvent<MaintenanceConfig>).detail;
      if (next) applyMaintenance(next);
    };

    const schedulePoll = () => {
      pollTimer = window.setTimeout(
        async () => {
          if (!active) return;
          if (document.visibilityState === 'visible')
            await refreshMaintenance({ force: true });
          if (active) schedulePoll();
        },
        nextBackoffDelay(
          MAINTENANCE_FALLBACK_POLL_MS,
          consecutiveFailures,
          MAINTENANCE_MAX_POLL_MS,
        ),
      );
    };
    schedulePoll();

    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    window.addEventListener(
      'mf:maintenance-changed',
      onMaintenanceChanged as EventListener,
    );
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      active = false;
      if (pollTimer !== undefined) window.clearTimeout(pollTimer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener(
        'mf:maintenance-changed',
        onMaintenanceChanged as EventListener,
      );
      document.removeEventListener('visibilitychange', onVisibilityChange);
      void supabase.removeChannel(realtimeChannel);
    };
  }, []);

  if (loading) return <LoadingScreen />;

  if (!isSupabaseConfigured()) return <ConfigRequired />;

  const isAdmin = isMaintenanceAdmin(session);
  const adminRoute =
    window.location.pathname.replace(/\/+$/, '') === ADMIN_LOGIN_PATH;
  const adminIntent = hasAdminOAuthIntent();
  const maintenanceEnabled = Boolean(maintenance?.maintenance_mode);

  if (
    validatingAdminEntry ||
    (session && (adminRoute || adminIntent) && !isAdmin)
  ) {
    return (
      <div
        className="flex h-screen items-center justify-center bg-[#050505]"
        role="status"
        aria-live="polite"
      >
        <div className="text-center">
          <div
            className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-[#00f2ff] border-t-transparent"
            aria-hidden="true"
          />
          <p className="mt-4 text-xs font-bold uppercase tracking-widest text-white/35">
            Validando acesso administrativo
          </p>
        </div>
      </div>
    );
  }

  // O MF Financeiro apenas aplica o estado de manutenção. Não existe bypass
  // operacional no produto financeiro: a administração é feita exclusivamente
  // pelo MF Administração.
  if (maintenanceEnabled) {
    return (
      <Suspense fallback={<LoadingScreen label="Carregando manutenção" />}>
        <MaintenanceScreen message={maintenance?.maintenance_message} />
      </Suspense>
    );
  }

  if (!session) return <Auth />;

  return (
    <Suspense
      fallback={<LoadingScreen label="Carregando sua área financeira" />}
    >
      <DashboardBootstrap user={session.user} />
    </Suspense>
  );
}
