import React, { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { AlertCircle, Eye, EyeOff, LogOut, Plus, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router';

import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { FinancialAccount, UserSettings } from '../types';
import AppNavigation from './AppNavigation';
import ProfileCenter from './ProfileCenter';

const Investments = lazy(() => import('./Investments'));

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

export default function InvestmentTool({ user }: { user: User }) {
  const { isPrivate, setIsPrivate } = useApp();
  const navigate = useNavigate();
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);

  const refreshFinancialContext = useCallback(async () => {
    setError(null);
    try {
      const [settingsResult, accountsResult] = await Promise.all([
        supabase.from('mf_user_settings').select('*').eq('user_id', user.id).maybeSingle(),
        supabase
          .from('mf_account_balances')
          .select('*')
          .eq('user_id', user.id)
          .order('is_default', { ascending: false })
          .order('created_at'),
      ]);

      const firstError = settingsResult.error || accountsResult.error;
      if (firstError) throw firstError;

      const nextAccounts = normalizeAccounts(accountsResult.data || []);
      const currentBalance = nextAccounts.reduce(
        (sum, account) => sum + Number(account.current_balance || 0),
        0,
      );

      setAccounts(nextAccounts);
      setSettings(
        settingsResult.data
          ? ({ ...settingsResult.data, current_balance: currentBalance } as UserSettings)
          : null,
      );
    } catch (refreshError: any) {
      console.error('Falha ao carregar contexto de investimentos:', refreshError);
      setError(refreshError?.message || 'Não foi possível carregar seus dados de investimentos.');
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => {
    void refreshFinancialContext();
  }, [refreshFinancialContext]);

  return (
    <div className="mf-app-shell mf-routed-app mf-investment-product-cleanup">
      <style>{`
        .mf-investment-product-cleanup button[title="Análise local"],
        .mf-investment-product-cleanup details { display: none !important; }
      `}</style>
      <AppNavigation onLaunch={() => navigate('/app')} />

      <header className="mf-topbar">
        <div className="mf-brand">
          <div className="mf-brand-icon"><Wallet size={20} /></div>
          <div>
            <h1>{settings?.workspace_name || 'MF Financeiro'}</h1>
            <span>{settings?.display_name ? `Olá, ${settings.display_name.split(/\s+/)[0]}` : 'Investimentos'}</span>
          </div>
        </div>

        <div className="mf-top-actions">
          <ProfileCenter
            user={user}
            settings={settings}
            accounts={accounts}
            open={showProfile}
            onOpenChange={setShowProfile}
            onSaved={refreshFinancialContext}
          />
          <button type="button" onClick={() => setIsPrivate(!isPrivate)} title="Privacidade">
            {isPrivate ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
          <button type="button" className="primary" onClick={() => navigate('/app')}><Plus size={16} />Lançar</button>
          <button
            type="button"
            onClick={async () => {
              await supabase.auth.signOut();
              window.location.replace('/');
            }}
            title="Sair"
          >
            <LogOut size={17} />
          </button>
        </div>
      </header>

      {error && <div className="mf-error"><AlertCircle size={16} />{error}</div>}

      <section className="mf-content">
        {loading ? (
          <div className="mf-loading">Carregando investimentos...</div>
        ) : (
          <Suspense fallback={<div className="mf-loading">Carregando módulo de investimentos...</div>}>
            <Investments user={user} settings={settings} onRefresh={refreshFinancialContext} />
          </Suspense>
        )}
      </section>
    </div>
  );
}
