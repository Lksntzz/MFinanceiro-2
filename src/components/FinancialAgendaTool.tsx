import type { User } from '@supabase/supabase-js';
import {
  AlertCircle,
  CalendarDays,
  Eye,
  EyeOff,
  LogOut,
  Plus,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import type {
  CardInstallment,
  CreditCard,
  FinancialAccount,
  FixedBill,
  Subscription,
  UserSettings,
} from '../types';
import AppNavigation from './AppNavigation';
import ExpectedIncomeCenter from './ExpectedIncomeCenter';
import FinancialCalendar from './FinancialCalendar';
import FinancialTimeline from './FinancialTimeline';
import MonthlyFixedBills from './MonthlyFixedBills';
import ProfileCenter from './ProfileCenter';
import SubscriptionManager from './SubscriptionManager';

type AgendaSection = 'recurrences' | 'income' | 'calendar';
type RecurrenceKind = 'fixed' | 'subscriptions';

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
  if (
    pathname.endsWith('/recorrencias') ||
    pathname.endsWith('/contas-fixas') ||
    pathname.endsWith('/assinaturas')
  )
    return 'recurrences';
  if (pathname.endsWith('/receitas')) return 'income';
  return 'calendar';
}

export default function FinancialAgendaTool({ user }: { user: User }) {
  const { isPrivate, setIsPrivate } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const section = sectionFromPath(location.pathname);
  const requestedKind = new URLSearchParams(location.search).get('tipo');
  const recurrenceKind: RecurrenceKind =
    location.pathname.endsWith('/assinaturas') ||
    requestedKind === 'assinaturas'
      ? 'subscriptions'
      : 'fixed';
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [fixedBills, setFixedBills] = useState<FixedBill[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [installments, setInstallments] = useState<CardInstallment[]>([]);
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
        installmentsResult,
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
          .select('*')
          .eq('user_id', user.id)
          .order('due_day'),
        supabase
          .from('mf_subscriptions')
          .select('*')
          .eq('user_id', user.id)
          .order('due_day'),
        supabase
          .from('mf_credit_cards')
          .select('*')
          .eq('user_id', user.id)
          .order('due_day'),
        supabase
          .from('mf_card_installments')
          .select('*')
          .eq('user_id', user.id)
          .order('due_day'),
      ]);
      const firstError =
        settingsResult.error ||
        accountsResult.error ||
        fixedResult.error ||
        subscriptionsResult.error ||
        cardsResult.error ||
        installmentsResult.error;
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
        (fixedResult.data || []).map((item: any) => ({
          ...item,
          amount: Number(item.amount || 0),
        })) as FixedBill[],
      );
      setSubscriptions(
        (subscriptionsResult.data || []).map((item: any) => ({
          ...item,
          amount: Number(item.amount || 0),
          due_day: Number(item.due_day || 1),
        })) as Subscription[],
      );
      setCards(
        (cardsResult.data || []).map((item: any) => ({
          ...item,
          limit: Number(item.limit || 0),
          used: Number(item.used || 0),
          due_day: Number(item.due_day || 1),
          closing_day: Number(item.closing_day || 1),
        })) as CreditCard[],
      );
      setInstallments(
        (installmentsResult.data || []).map((item: any) => ({
          ...item,
          description: item.description || item.descricao || 'Parcelamento',
          total_amount: Number(item.total_amount ?? item.valor_total ?? 0),
          monthly_amount: Number(item.monthly_amount ?? item.valor_mensal ?? 0),
          current_installment: Number(
            item.current_installment ?? item.parcela_atual ?? 1,
          ),
          total_installments: Number(
            item.total_installments ?? item.total_parcelas ?? 1,
          ),
          due_day: Number(item.due_day || 1),
        })) as CardInstallment[],
      );
    } catch (refreshError: any) {
      console.error('Falha ao carregar agenda financeira:', refreshError);
      setError(
        refreshError?.message ||
          'Não foi possível carregar a agenda financeira.',
      );
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="mf-app-shell mf-routed-app">
      <AppNavigation onLaunch={() => navigate('/app/lancar')} />
      <header className="mf-topbar">
        <div className="mf-brand">
          <div className="mf-brand-icon">
            <CalendarDays size={20} />
          </div>
          <div>
            <h1>{settings?.workspace_name || 'MF Financeiro'}</h1>
            <span>
              {settings?.display_name
                ? `Olá, ${settings.display_name.split(/\s+/)[0]}`
                : 'Agenda Financeira'}
            </span>
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
            onClick={() => navigate('/app/lancar')}
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
          <div className="mf-loading">Carregando agenda financeira...</div>
        ) : (
          <div className="mf-tab-shell">
            {section === 'calendar' && (
              <div className="space-y-4 animate-fade-in">
                <div>
                  <h2 className="text-xl font-black">Agenda Financeira</h2>
                  <p className="text-sm text-white/40">
                    Tudo que tem data e pode mexer com seu dinheiro: receitas,
                    recorrências, faturas e parcelas.
                  </p>
                </div>
                <FinancialCalendar
                  fixedBills={fixedBills}
                  settings={settings}
                  subscriptions={subscriptions}
                  cards={cards}
                  installments={installments}
                />
                <FinancialTimeline
                  userId={user.id}
                  settings={settings}
                  fixedBills={fixedBills}
                  subscriptions={subscriptions}
                  cards={cards}
                  installments={installments}
                />
              </div>
            )}
            {section === 'recurrences' && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-xl font-black">Recorrências</h2>
                  <p className="text-sm text-white/40">
                    Compromissos que voltam com frequência. Contas fixas e
                    assinaturas ficam juntas, sem perder suas diferenças.
                  </p>
                </div>
                <div className="mf-subnav">
                  <button
                    className={recurrenceKind === 'fixed' ? 'active' : ''}
                    onClick={() =>
                      navigate('/app/agenda/recorrencias?tipo=fixas')
                    }
                  >
                    Contas fixas
                  </button>
                  <button
                    className={
                      recurrenceKind === 'subscriptions' ? 'active' : ''
                    }
                    onClick={() =>
                      navigate('/app/agenda/recorrencias?tipo=assinaturas')
                    }
                  >
                    Assinaturas
                  </button>
                </div>
                {recurrenceKind === 'fixed' ? (
                  <MonthlyFixedBills userId={user.id} onDataChanged={refresh} />
                ) : (
                  <SubscriptionManager />
                )}
              </div>
            )}
            {section === 'income' && <ExpectedIncomeCenter userId={user.id} />}
          </div>
        )}
      </section>
    </div>
  );
}
