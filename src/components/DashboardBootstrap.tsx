import React, { useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Navigate, useLocation } from 'react-router';

import { supabase } from '../lib/supabase';
import { DEFAULT_USER_SETTINGS } from '../lib/constants';
import Dashboard from './Dashboard';
import FinancialAgendaTool from './FinancialAgendaTool';
import IntegrationTool from './IntegrationTool';
import InvestmentTool from './InvestmentTool';
import PlanningStrategyTool from './PlanningStrategyTool';
import PlanningTool from './PlanningTool';

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

export default function DashboardBootstrap({
  user,
  isMaintenanceBypass,
}: {
  user: User;
  isMaintenanceBypass?: boolean;
}) {
  const location = useLocation();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const legacyInvestmentRoute = location.pathname.startsWith('/app/planejamento/investimentos');
  const legacyAutomationRoute = location.pathname.startsWith('/app/planejamento/automacoes');
  const legacyGoalsRoute = location.pathname.startsWith('/app/analises/metas');
  const legacyFixedRoute = location.pathname.startsWith('/app/planejamento/contas-fixas');
  const legacySubscriptionsRoute = location.pathname.startsWith('/app/planejamento/assinaturas');
  const legacyCommitmentsRoute = location.pathname.startsWith('/app/planejamento/compromissos');
  const legacyIncomeRoute = location.pathname.startsWith('/app/planejamento/receitas')
    || location.pathname.startsWith('/app/planejamento/renda');
  const legacyCalendarRoute = location.pathname.startsWith('/app/planejamento/calendario');

  const investmentRoute = location.pathname.startsWith('/app/investimentos');
  const integrationRoute = location.pathname.startsWith('/app/integracoes');
  const agendaRoute = location.pathname.startsWith('/app/agenda');
  const planningStrategyRoute = location.pathname.startsWith('/app/planejamento/metas')
    || location.pathname.startsWith('/app/planejamento/projecoes');
  const planningRoute = location.pathname.startsWith('/app/planejamento')
    && !legacyInvestmentRoute
    && !legacyAutomationRoute
    && !legacyFixedRoute
    && !legacySubscriptionsRoute
    && !legacyCommitmentsRoute
    && !legacyIncomeRoute
    && !legacyCalendarRoute
    && !planningStrategyRoute;

  useEffect(() => {
    let active = true;

    const prepareDashboard = async () => {
      setReady(false);
      setError(null);

      try {
        // During an OAuth/token transition, auth.uid() can be unavailable for a
        // very short period. Wait until Supabase confirms the same authenticated
        // user before allowing the app to query RLS-protected tables.
        for (let attempt = 0; attempt < 6; attempt += 1) {
          const { data: authData, error: authError } = await supabase.auth.getUser();
          if (authError) throw authError;

          if (authData.user?.id !== user.id) {
            await wait(250);
            continue;
          }

          const { data: existing, error: selectError } = await supabase
            .from('mf_user_settings')
            .select('id,user_id')
            .eq('user_id', user.id)
            .maybeSingle();

          if (selectError) throw selectError;

          if (existing) {
            if (active) setReady(true);
            return;
          }

          // Idempotent bootstrap: if another request already created the row,
          // ON CONFLICT does nothing instead of exposing a duplicate-key error.
          const defaults = DEFAULT_USER_SETTINGS(user.id);
          const { error: upsertError } = await supabase
            .from('mf_user_settings')
            .upsert(defaults, { onConflict: 'user_id', ignoreDuplicates: true });

          if (upsertError && upsertError.code !== '23505') throw upsertError;
          await wait(250);
        }

        throw new Error('A sessão ainda não conseguiu acessar suas configurações.');
      } catch (err: any) {
        console.error('Dashboard bootstrap error:', err);
        if (active) {
          setError(err?.message || 'Não foi possível preparar seus dados financeiros.');
        }
      }
    };

    void prepareDashboard();

    return () => {
      active = false;
    };
  }, [user.id, retryKey]);

  if (legacyInvestmentRoute) {
    return <Navigate to={{ pathname: '/app/investimentos', search: location.search }} replace />;
  }

  if (legacyAutomationRoute) {
    return <Navigate to="/app/integracoes" replace />;
  }

  if (legacyGoalsRoute) {
    return <Navigate to="/app/planejamento/metas" replace />;
  }

  if (legacyFixedRoute) {
    return <Navigate to="/app/agenda/contas-fixas" replace />;
  }

  if (legacySubscriptionsRoute) {
    return <Navigate to="/app/agenda/assinaturas" replace />;
  }

  if (legacyCommitmentsRoute) {
    const requestedKind = new URLSearchParams(location.search).get('tipo');
    return <Navigate to={requestedKind === 'assinaturas' ? '/app/agenda/assinaturas' : '/app/agenda/contas-fixas'} replace />;
  }

  if (legacyIncomeRoute) {
    return <Navigate to="/app/agenda/receitas" replace />;
  }

  if (legacyCalendarRoute) {
    return <Navigate to="/app/agenda" replace />;
  }

  if (ready) {
    if (investmentRoute) return <InvestmentTool user={user} />;
    if (integrationRoute) return <IntegrationTool user={user} />;
    if (agendaRoute) return <FinancialAgendaTool user={user} />;
    if (planningStrategyRoute) return <PlanningStrategyTool user={user} />;
    if (planningRoute) return <PlanningTool user={user} />;
    return <Dashboard user={user} isMaintenanceBypass={isMaintenanceBypass} />;
  }

  return (
    <div className="flex h-screen w-full items-center justify-center bg-[#050505] p-6 text-white">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
        {error ? (
          <>
            <AlertCircle className="mx-auto mb-3 text-red-400" size={30} />
            <h1 className="mb-2 text-lg font-bold">Não foi possível carregar sua conta</h1>
            <p className="mb-5 text-sm text-white/50">{error}</p>
            <button
              type="button"
              onClick={() => setRetryKey((value) => value + 1)}
              className="mx-auto flex items-center gap-2 rounded-xl bg-[#00f2ff] px-4 py-2 text-sm font-bold text-black"
            >
              <RefreshCw size={16} />
              Tentar novamente
            </button>
          </>
        ) : (
          <>
            <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-[#00f2ff] border-t-transparent" />
            <p className="text-sm text-white/60">Carregando seus dados financeiros...</p>
          </>
        )}
      </div>
    </div>
  );
}
