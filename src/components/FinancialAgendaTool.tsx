import React, { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { AlertCircle, CalendarDays, Eye, EyeOff, LogOut, Plus, Wallet, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';

import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { FinancialAccount, FixedBill, UserSettings } from '../types';
import AppNavigation from './AppNavigation';
import FinancialCalendar from './FinancialCalendar';
import MonthlyFixedBills from './MonthlyFixedBills';
import ProfileCenter from './ProfileCenter';
import SubscriptionManager from './SubscriptionManager';

const IncomePayrollCenter = lazy(() => import('./IncomePayrollCenter'));

type AgendaSection = 'fixed' | 'subscriptions' | 'income' | 'calendar';

function normalizeAccounts(rows: unknown[]): FinancialAccount[] {
  return rows.map((row) => {
    const item = row as Record<string, unknown>;
    return {
      ...item,
      opening_balance: Number(item.opening_balance || 0),
      current_balance: Number(item.current_balance || 0),
      transaction_count: Number(item.transaction_count || 0),
    } as FinancialAccount;
  });
}

function sectionFromPath(pathname: string): AgendaSection {
  if (pathname.endsWith('/contas-fixas')) return 'fixed';
  if (pathname.endsWith('/assinaturas')) return 'subscriptions';
  if (pathname.endsWith('/receitas')) return 'income';
  return 'calendar';
}

export default function FinancialAgendaTool({ user }: { user: User }) {
  const { isPrivate, setIsPrivate } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const section = sectionFromPath(location.pathname);

  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [fixedBills, setFixedBills] = useState<FixedBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [settingsResult, accountsResult, fixedResult] = await Promise.all([
        supabase.from('mf_user_settings').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('mf_account_balances').select('*').eq('user_id', user.id).order('is_default', { ascending: false }).order('created_at'),
        supabase.from('mf_fixed_bills').select('*').eq('user_id', user.id).order('due_day'),
      ]);

      const firstError = settingsResult.error || accountsResult.error || fixedResult.error;
      if (firstError) throw firstError;

      const nextAccounts = normalizeAccounts(accountsResult.data || []);
      const currentBalance = nextAccounts.reduce((sum, account) => sum + Number(account.current_balance || 0), 0);
      setAccounts(nextAccounts);
      setSettings(settingsResult.data ? ({ ...settingsResult.data, current_balance: currentBalance } as UserSettings) : null);
      setFixedBills((fixedResult.data || []).map((item: any) => ({ ...item, amount: Number(item.amount || 0) })) as FixedBill[]);
    } catch (refreshError: any) {
      console.error('Falha ao carregar agenda financeira:', refreshError);
      setError(refreshError?.message || 'Não foi possível carregar a agenda financeira.');
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="mf-app-shell mf-routed-app">
      <AppNavigation onLaunch={() => undefined} />

      <header className="mf-topbar">
        <div className="mf-brand">
          <div className="mf-brand-icon"><CalendarDays size={20} /></div>
          <div>
            <h1>{settings?.workspace_name || 'MFinanceiro'}</h1>
            <span>{settings?.display_name ? `Olá, ${settings.display_name.split(/\s+/)[0]}` : 'Agenda Financeira'}</span>
          </div>
        </div>
        <div className="mf-top-actions">
          <ProfileCenter user={user} settings={settings} accounts={accounts} open={showProfile} onOpenChange={setShowProfile} onSaved={refresh} />
          <button type="button" onClick={() => setIsPrivate(!isPrivate)} title="Privacidade">{isPrivate ? <EyeOff size={16} /> : <Eye size={16} />}</button>
          <button type="button" className="primary"><Plus size={16} />Lançar</button>
          <button type="button" onClick={async () => { await supabase.auth.signOut(); window.location.replace('/'); }} title="Sair"><LogOut size={17} /></button>
        </div>
      </header>

      {error && <div className="mf-error"><AlertCircle size={16} />{error}<button type="button" onClick={() => setError(null)}><X size={14} /></button></div>}

      <section className="mf-content">
        {loading ? <div className="mf-loading">Carregando agenda financeira...</div> : (
          <div className="mf-tab-shell">
            <div className="mf-subnav" aria-label="Agenda financeira">
              <button className={section === 'calendar' ? 'active' : ''} onClick={() => navigate('/app/agenda')}>Calendário</button>
              <button className={section === 'fixed' ? 'active' : ''} onClick={() => navigate('/app/agenda/contas-fixas')}>Contas fixas</button>
              <button className={section === 'subscriptions' ? 'active' : ''} onClick={() => navigate('/app/agenda/assinaturas')}>Assinaturas</button>
              <button className={section === 'income' ? 'active' : ''} onClick={() => navigate('/app/agenda/receitas')}>Receitas previstas</button>
            </div>

            {section === 'calendar' && (
              <div className="space-y-4 animate-fade-in">
                <div><h2 className="text-xl font-black">Agenda Financeira</h2><p className="text-sm text-white/40">Entradas, vencimentos e compromissos organizados por data.</p></div>
                <FinancialCalendar fixedBills={fixedBills} settings={settings} />
              </div>
            )}

            {section === 'fixed' && <MonthlyFixedBills userId={user.id} onDataChanged={refresh} />}
            {section === 'subscriptions' && <SubscriptionManager />}
            {section === 'income' && (
              <Suspense fallback={<div className="mf-loading">Carregando receitas previstas...</div>}>
                <IncomePayrollCenter userId={user.id} />
              </Suspense>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
