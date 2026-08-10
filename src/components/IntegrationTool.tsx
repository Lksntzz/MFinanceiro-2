import React, { useCallback, useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { AlertCircle, Bot, ChevronDown, Eye, EyeOff, LogOut, Plus, Wallet } from 'lucide-react';

import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { FinancialAccount, TransactionCategory, UserSettings } from '../types';
import AppNavigation from './AppNavigation';
import AutomationCenter from './AutomationCenter';
import ProfileCenter from './ProfileCenter';

function normalizeAccounts(rows: unknown[]): FinancialAccount[] {
  return rows.map((row) => {
    const item = row as Record<string, unknown>;
    return { ...item, opening_balance: Number(item.opening_balance || 0), current_balance: Number(item.current_balance || 0), transaction_count: Number(item.transaction_count || 0) } as FinancialAccount;
  });
}

export default function IntegrationTool({ user }: { user: User }) {
  const { isPrivate, setIsPrivate } = useApp();
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [categories, setCategories] = useState<TransactionCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const ensured = await supabase.rpc('mf_ensure_financial_structure');
      if (ensured.error) throw ensured.error;
      const [settingsResult, accountsResult, categoriesResult] = await Promise.all([
        supabase.from('mf_user_settings').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('mf_account_balances').select('*').eq('user_id', user.id).order('is_default', { ascending: false }).order('created_at'),
        supabase.from('mf_transaction_categories').select('*').eq('user_id', user.id).eq('is_active', true).order('sort_order').order('name'),
      ]);
      const firstError = settingsResult.error || accountsResult.error || categoriesResult.error;
      if (firstError) throw firstError;
      const nextAccounts = normalizeAccounts(accountsResult.data || []);
      const balance = nextAccounts.reduce((sum, account) => sum + Number(account.current_balance || 0), 0);
      setAccounts(nextAccounts);
      setCategories((categoriesResult.data || []) as TransactionCategory[]);
      setSettings(settingsResult.data ? ({ ...settingsResult.data, current_balance: balance } as UserSettings) : null);
    } catch (refreshError: any) {
      console.error('Falha ao carregar conexões:', refreshError);
      setError(refreshError?.message || 'Não foi possível carregar suas conexões.');
    } finally { setLoading(false); }
  }, [user.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  return <div className="mf-app-shell mf-routed-app">
    <AppNavigation onLaunch={() => window.location.assign('/app/lancar')} />
    <header className="mf-topbar"><div className="mf-brand"><div className="mf-brand-icon"><Wallet size={20} /></div><div><h1>{settings?.workspace_name || 'MFinanceiro'}</h1><span>{settings?.display_name ? `Olá, ${settings.display_name.split(/\s+/)[0]}` : 'Conexões'}</span></div></div><div className="mf-top-actions"><ProfileCenter user={user} settings={settings} accounts={accounts} open={showProfile} onOpenChange={setShowProfile} onSaved={refresh} /><button type="button" onClick={() => setIsPrivate(!isPrivate)} title="Privacidade">{isPrivate ? <EyeOff size={16} /> : <Eye size={16} />}</button><button type="button" className="primary" onClick={() => window.location.assign('/app/lancar')}><Plus size={16} />Lançar</button><button type="button" onClick={async () => { await supabase.auth.signOut(); window.location.replace('/'); }} title="Sair"><LogOut size={17} /></button></div></header>
    {error && <div className="mf-error"><AlertCircle size={16} />{error}</div>}
    <section className="mf-content">
      {loading ? <div className="mf-loading">Carregando conexões...</div> : <div className="space-y-4 animate-fade-in">
        <div><h2 className="flex items-center gap-2 text-xl font-black"><Bot size={20} />Conexões</h2><p className="text-sm text-white/40">Conecte fontes e mantenha o fluxo financeiro organizado. Regras automáticas aparecem como configuração da conexão, não como uma ferramenta separada.</p></div>
        <details className="mf-automation-disclosure"><summary><span><strong>Regras e automações</strong><small>Use somente quando quiser reduzir trabalho repetitivo dentro das suas conexões.</small></span><ChevronDown size={16} /></summary><div className="mf-automation-content"><AutomationCenter userId={user.id} accounts={accounts} categories={categories} /></div></details>
      </div>}
    </section>
  </div>;
}
