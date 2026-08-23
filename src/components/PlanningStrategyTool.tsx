import type { User } from '@supabase/supabase-js';
import {
  AlertCircle,
  Eye,
  EyeOff,
  LogOut,
  Plus,
  Target,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { useApp } from '../context/AppContext';
import { formatCurrency } from '../lib/formatters';
import { supabase } from '../lib/supabase';
import type { FinancialAccount, UserSettings } from '../types';
import AppNavigation from './AppNavigation';
import FinancialGoals from './FinancialGoals';
import ProfileCenter from './ProfileCenter';

type SubscriptionRow = {
  amount: number;
  billing_cycle?: string | null;
  status?: string | null;
};
type FixedRow = {
  amount: number;
  status?: string | null;
  active?: boolean | null;
};
type CardRow = { used: number };

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

export default function PlanningStrategyTool({ user }: { user: User }) {
  const { isPrivate, setIsPrivate } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const showGoals = location.pathname.endsWith('/metas');

  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [fixedBills, setFixedBills] = useState<FixedRow[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([]);
  const [cards, setCards] = useState<CardRow[]>([]);
  const [extraIncome, setExtraIncome] = useState('0');
  const [extraExpense, setExtraExpense] = useState('0');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [
        settingsResult,
        accountsResult,
        fixedResult,
        subscriptionsResult,
        cardsResult,
      ] = await Promise.all([
        supabase
          .from('mf_user_settings')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase
          .from('mf_account_balances')
          .select('*')
          .eq('user_id', user.id)
          .order('is_default', { ascending: false })
          .order('created_at'),
        supabase
          .from('mf_fixed_bills')
          .select('amount,status,active')
          .eq('user_id', user.id),
        supabase
          .from('mf_subscriptions')
          .select('amount,billing_cycle,status')
          .eq('user_id', user.id),
        supabase.from('mf_credit_cards').select('used').eq('user_id', user.id),
      ]);

      const firstError =
        settingsResult.error ||
        accountsResult.error ||
        fixedResult.error ||
        subscriptionsResult.error ||
        cardsResult.error;
      if (firstError) throw firstError;

      const nextAccounts = normalizeAccounts(accountsResult.data || []);
      const currentBalance = nextAccounts.reduce(
        (sum, account) => sum + Number(account.current_balance || 0),
        0,
      );
      setAccounts(nextAccounts);
      setSettings(
        settingsResult.data
          ? ({
              ...settingsResult.data,
              current_balance: currentBalance,
            } as UserSettings)
          : null,
      );
      setFixedBills(
        (fixedResult.data || []).map((row: any) => ({
          ...row,
          amount: Number(row.amount || 0),
        })) as FixedRow[],
      );
      setSubscriptions(
        (subscriptionsResult.data || []).map((row: any) => ({
          ...row,
          amount: Number(row.amount || 0),
        })) as SubscriptionRow[],
      );
      setCards(
        (cardsResult.data || []).map((row: any) => ({
          used: Number(row.used || 0),
        })) as CardRow[],
      );
    } catch (refreshError: any) {
      console.error(
        'Falha ao carregar estratégia de planejamento:',
        refreshError,
      );
      setError(
        refreshError?.message ||
          'Não foi possível carregar os dados de planejamento.',
      );
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const projection = useMemo(() => {
    const balance = accounts.reduce(
      (sum, account) => sum + Number(account.current_balance || 0),
      0,
    );
    const expectedIncome = Number(
      settings?.net_salary_estimated || settings?.gross_salary || 0,
    );
    const fixed = fixedBills
      .filter(
        (bill) =>
          bill.active !== false && String(bill.status || 'pending') !== 'paid',
      )
      .reduce((sum, bill) => sum + Math.abs(Number(bill.amount || 0)), 0);
    const subscriptionsMonthly = subscriptions
      .filter(
        (item) =>
          !['inactive', 'cancelled', 'canceled'].includes(
            String(item.status || '').toLowerCase(),
          ),
      )
      .reduce((sum, item) => {
        const amount = Math.abs(Number(item.amount || 0));
        return (
          sum +
          (String(item.billing_cycle || '')
            .toLowerCase()
            .includes('annual')
            ? amount / 12
            : amount)
        );
      }, 0);
    const cardsUsed = cards.reduce(
      (sum, card) => sum + Number(card.used || 0),
      0,
    );
    const base =
      balance + expectedIncome - fixed - subscriptionsMonthly - cardsUsed;
    const adjusted =
      base + Number(extraIncome || 0) - Number(extraExpense || 0);
    return {
      balance,
      expectedIncome,
      fixed,
      subscriptionsMonthly,
      cardsUsed,
      base,
      adjusted,
    };
  }, [
    accounts,
    cards,
    extraExpense,
    extraIncome,
    fixedBills,
    settings,
    subscriptions,
  ]);

  return (
    <div className="mf-app-shell mf-routed-app">
      <AppNavigation onLaunch={() => navigate('/app')} />
      <header className="mf-topbar">
        <div className="mf-brand">
          <div className="mf-brand-icon">
            <Target size={20} />
          </div>
          <div>
            <h1>{settings?.workspace_name || 'MF Financeiro'}</h1>
            <span>{showGoals ? 'Metas financeiras' : 'Simulador'}</span>
          </div>
        </div>
        <div className="mf-top-actions">
          <ProfileCenter
            user={user}
            settings={settings}
            accounts={accounts}
            open={showProfile}
            onOpenChange={setShowProfile}
            onSaved={refresh}
          />
          <button
            type="button"
            onClick={() => setIsPrivate(!isPrivate)}
            title="Privacidade"
          >
            {isPrivate ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => navigate('/app')}
          >
            <Plus size={16} />
            Lançar
          </button>
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

      {error && (
        <div className="mf-error">
          <AlertCircle size={16} />
          {error}
          <button type="button" onClick={() => setError(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      <section className="mf-content">
        {loading ? (
          <div className="mf-loading">Carregando planejamento...</div>
        ) : showGoals ? (
          <FinancialGoals />
        ) : (
          <div className="space-y-4 animate-fade-in">
            <div>
              <h2 className="text-xl font-black">Simulador</h2>
              <p className="text-sm text-white/40">
                Teste “e se?” sem alterar nenhum lançamento real: uma renda
                extra, uma compra maior ou um gasto inesperado.
              </p>
            </div>

            <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <article className="mf-card mf-kpi">
                <span>Saldo atual</span>
                <strong>{formatCurrency(projection.balance, isPrivate)}</strong>
              </article>
              <article className="mf-card mf-kpi">
                <span>Receita prevista</span>
                <strong>
                  {formatCurrency(projection.expectedIncome, isPrivate)}
                </strong>
              </article>
              <article className="mf-card mf-kpi">
                <span>Compromissos previstos</span>
                <strong>
                  {formatCurrency(
                    projection.fixed +
                      projection.subscriptionsMonthly +
                      projection.cardsUsed,
                    isPrivate,
                  )}
                </strong>
              </article>
              <article className="mf-card mf-kpi accent">
                <span>Base antes do cenário</span>
                <strong>{formatCurrency(projection.base, isPrivate)}</strong>
              </article>
            </section>

            <section className="grid gap-4 xl:grid-cols-[360px_1fr]">
              <article className="mf-card space-y-4">
                <div>
                  <h3 className="font-bold">Montar cenário</h3>
                  <p className="text-xs text-white/35">
                    Nada informado aqui será salvo no histórico.
                  </p>
                </div>
                <label className="block text-xs text-white/45">
                  Entrada extra
                  <div className="mt-1 flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3">
                    <TrendingUp size={15} className="text-emerald-400" />
                    <input
                      className="w-full bg-transparent py-3 text-sm text-white outline-none"
                      type="number"
                      step="0.01"
                      value={extraIncome}
                      onChange={(event) => setExtraIncome(event.target.value)}
                    />
                  </div>
                </label>
                <label className="block text-xs text-white/45">
                  Gasto extra
                  <div className="mt-1 flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3">
                    <TrendingDown size={15} className="text-red-400" />
                    <input
                      className="w-full bg-transparent py-3 text-sm text-white outline-none"
                      type="number"
                      step="0.01"
                      value={extraExpense}
                      onChange={(event) => setExtraExpense(event.target.value)}
                    />
                  </div>
                </label>
              </article>

              <article className="mf-card flex flex-col justify-between gap-5">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-white/35">
                    Resultado estimado
                  </p>
                  <strong className="mt-2 block text-3xl">
                    {formatCurrency(projection.adjusted, isPrivate)}
                  </strong>
                </div>
                <div className="grid gap-3 md:grid-cols-3 text-sm">
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <span className="text-white/40">Base</span>
                    <strong className="mt-1 block">
                      {formatCurrency(projection.base, isPrivate)}
                    </strong>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <span className="text-white/40">Entrada testada</span>
                    <strong className="mt-1 block text-emerald-400">
                      + {formatCurrency(Number(extraIncome || 0), isPrivate)}
                    </strong>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <span className="text-white/40">Gasto testado</span>
                    <strong className="mt-1 block text-red-400">
                      - {formatCurrency(Number(extraExpense || 0), isPrivate)}
                    </strong>
                  </div>
                </div>
                <p className="text-xs text-white/30">
                  O simulador usa saldo, receita prevista, contas fixas,
                  assinaturas e cartões cadastrados. O resultado é apenas uma
                  simulação do fluxo financeiro.
                </p>
              </article>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}
