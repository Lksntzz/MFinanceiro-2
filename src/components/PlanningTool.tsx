import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { User } from '@supabase/supabase-js';
import {
  AlertCircle,
  CalendarDays,
  CreditCard as CreditCardIcon,
  Eye,
  EyeOff,
  LogOut,
  Pencil,
  Plus,
  ReceiptText,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';
import { endOfMonth, format, startOfMonth } from 'date-fns';
import { useApp } from '../context/AppContext';
import { formatCurrency } from '../lib/formatters';
import { supabase } from '../lib/supabase';
import {
  CardInstallment,
  CreditCard,
  FinancialAccount,
  FixedBill,
  Transaction,
  TransactionCategory,
  UserSettings,
} from '../types';
import AppNavigation from './AppNavigation';
import Cartoes from './Cartoes';
import FinancialCalendar from './FinancialCalendar';
import FinancialStructure from './FinancialStructure';
import MonthlyFixedBills from './MonthlyFixedBills';
import ProfileCenter from './ProfileCenter';
import SubscriptionManager from './SubscriptionManager';

const IncomePayrollCenter = lazy(() => import('./IncomePayrollCenter'));

type PlanningSection = 'overview' | 'accounts' | 'cards' | 'commitments' | 'income' | 'budget';
type CommitmentKind = 'fixed' | 'subscriptions';

type SubscriptionRow = {
  id: string;
  user_id: string;
  name: string;
  amount: number;
  due_day: number;
  category?: string | null;
  billing_cycle?: string | null;
  status?: string | null;
};

type BudgetRow = {
  id: string;
  user_id: string;
  category: string;
  limit_amount: number;
};

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

function normalizeCards(rows: unknown[]): CreditCard[] {
  return rows.map((row) => {
    const item = row as Record<string, unknown>;
    return {
      ...item,
      limit: Number(item.limit || 0),
      used: Number(item.used || 0),
      closing_day: Number(item.closing_day || 1),
      due_day: Number(item.due_day || 1),
    } as CreditCard;
  });
}

function normalizeInstallments(rows: unknown[]): CardInstallment[] {
  return rows.map((row) => {
    const item = row as Record<string, unknown>;
    return {
      ...item,
      description: String(item.description || item.descricao || 'Parcelamento'),
      total_amount: Number(item.total_amount ?? item.valor_total ?? 0),
      monthly_amount: Number(item.monthly_amount ?? item.valor_mensal ?? 0),
      current_installment: Number(item.current_installment ?? item.parcela_atual ?? 1),
      total_installments: Number(item.total_installments ?? item.total_parcelas ?? 1),
      due_day: Number(item.due_day || 1),
    } as CardInstallment;
  });
}

function getSection(pathname: string): PlanningSection {
  const path = pathname.replace(/\/+$/, '');
  if (path.endsWith('/contas')) return 'accounts';
  if (path.endsWith('/cartoes')) return 'cards';
  if (path.endsWith('/compromissos') || path.endsWith('/contas-fixas') || path.endsWith('/assinaturas')) return 'commitments';
  if (path.endsWith('/receitas') || path.endsWith('/renda')) return 'income';
  if (path.endsWith('/orcamento')) return 'budget';
  return 'overview';
}

function Metric({ label, value, detail, icon }: { label: string; value: string; detail?: string; icon: React.ReactNode }) {
  return (
    <article className="mf-card mf-kpi">
      <div className="flex items-center justify-between gap-2"><span>{label}</span>{icon}</div>
      <strong>{value}</strong>
      {detail && <small className="text-white/35">{detail}</small>}
    </article>
  );
}

export default function PlanningTool({ user }: { user: User }) {
  const { isPrivate, setIsPrivate } = useApp();
  const pathname = window.location.pathname;
  const section = getSection(pathname);
  const search = new URLSearchParams(window.location.search);
  const commitmentKind: CommitmentKind = pathname.endsWith('/assinaturas') || search.get('tipo') === 'assinaturas' ? 'subscriptions' : 'fixed';

  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [categories, setCategories] = useState<TransactionCategory[]>([]);
  const [fixedBills, setFixedBills] = useState<FixedBill[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([]);
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [installments, setInstallments] = useState<CardInstallment[]>([]);
  const [budgets, setBudgets] = useState<BudgetRow[]>([]);
  const [monthTransactions, setMonthTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);

  const [editingCard, setEditingCard] = useState<CreditCard | null>(null);
  const [showCardModal, setShowCardModal] = useState(false);
  const [cardForm, setCardForm] = useState({ name: '', limit: '', used: '0', due_day: '10', closing_day: '1' });
  const [editingInstallment, setEditingInstallment] = useState<CardInstallment | null>(null);
  const [showInstallmentModal, setShowInstallmentModal] = useState(false);
  const [installmentForm, setInstallmentForm] = useState({
    card_id: '',
    description: '',
    total_amount: '',
    monthly_amount: '',
    current_installment: '1',
    total_installments: '1',
    due_day: '1',
  });
  const [budgetCategory, setBudgetCategory] = useState('');
  const [budgetLimit, setBudgetLimit] = useState('');
  const [savingBudget, setSavingBudget] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const ensured = await supabase.rpc('mf_ensure_financial_structure');
      if (ensured.error) throw ensured.error;

      const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd');
      const monthEnd = format(endOfMonth(new Date()), 'yyyy-MM-dd');
      const [settingsResult, accountsResult, categoriesResult, fixedResult, subscriptionsResult, cardsResult, installmentsResult, budgetsResult, transactionsResult] = await Promise.all([
        supabase.from('mf_user_settings').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('mf_account_balances').select('*').eq('user_id', user.id).order('is_default', { ascending: false }).order('created_at'),
        supabase.from('mf_transaction_categories').select('*').eq('user_id', user.id).eq('is_active', true).order('sort_order').order('name'),
        supabase.from('mf_fixed_bills').select('*').eq('user_id', user.id).order('due_day'),
        supabase.from('mf_subscriptions').select('*').eq('user_id', user.id).order('due_day'),
        supabase.from('mf_credit_cards').select('*').eq('user_id', user.id).order('name'),
        supabase.from('mf_card_installments').select('*').eq('user_id', user.id).order('due_day'),
        supabase.from('mf_budgets').select('*').eq('user_id', user.id).order('category'),
        supabase.from('mf_finance_ledger_entries').select('id,user_id,amount,category,description,date,type,status').eq('user_id', user.id).gte('date', monthStart).lte('date', monthEnd),
      ]);

      const firstError = settingsResult.error || accountsResult.error || categoriesResult.error || fixedResult.error || subscriptionsResult.error || cardsResult.error || installmentsResult.error || budgetsResult.error || transactionsResult.error;
      if (firstError) throw firstError;

      const nextAccounts = normalizeAccounts(accountsResult.data || []);
      const balance = nextAccounts.reduce((sum, account) => sum + Number(account.current_balance || 0), 0);
      setAccounts(nextAccounts);
      setSettings(settingsResult.data ? ({ ...settingsResult.data, current_balance: balance } as UserSettings) : null);
      setCategories((categoriesResult.data || []) as TransactionCategory[]);
      setFixedBills((fixedResult.data || []).map((item: any) => ({ ...item, amount: Number(item.amount || 0) })) as FixedBill[]);
      setSubscriptions((subscriptionsResult.data || []).map((item: any) => ({ ...item, amount: Number(item.amount || 0), due_day: Number(item.due_day || 1) })) as SubscriptionRow[]);
      setCards(normalizeCards(cardsResult.data || []));
      setInstallments(normalizeInstallments(installmentsResult.data || []));
      setBudgets((budgetsResult.data || []).map((item: any) => ({ ...item, limit_amount: Number(item.limit_amount || 0) })) as BudgetRow[]);
      setMonthTransactions((transactionsResult.data || []).map((item: any) => ({ ...item, amount: Number(item.amount || 0) })) as Transaction[]);
    } catch (refreshError: any) {
      console.error('Falha ao carregar planejamento:', refreshError);
      setError(refreshError?.message || 'Não foi possível carregar o planejamento.');
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (pathname.endsWith('/calendario')) window.history.replaceState({}, '', '/app/planejamento');
    if (pathname.endsWith('/renda')) window.history.replaceState({}, '', '/app/planejamento/receitas');
    if (pathname.endsWith('/contas-fixas')) window.history.replaceState({}, '', '/app/planejamento/compromissos?tipo=fixas');
    if (pathname.endsWith('/assinaturas')) window.history.replaceState({}, '', '/app/planejamento/compromissos?tipo=assinaturas');
  }, [pathname]);

  const balance = accounts.reduce((sum, account) => sum + Number(account.current_balance || 0), 0);
  const pendingFixed = fixedBills
    .filter((bill: any) => bill.active !== false && String(bill.status || 'pending') !== 'paid')
    .reduce((sum, bill) => sum + Math.abs(Number(bill.amount || 0)), 0);
  const activeSubscriptions = subscriptions.filter((item) => !['inactive', 'cancelled', 'canceled'].includes(String(item.status || '').toLowerCase()));
  const subscriptionMonthly = activeSubscriptions.reduce((sum, item) => {
    const amount = Math.abs(Number(item.amount || 0));
    return sum + (String(item.billing_cycle || '').toLowerCase().includes('annual') ? amount / 12 : amount);
  }, 0);
  const cardsUsed = cards.reduce((sum, card) => sum + Number(card.used || 0), 0);
  const expectedIncome = Number(settings?.net_salary_estimated || settings?.gross_salary || 0);
  const projectedBalance = balance + expectedIncome - pendingFixed - subscriptionMonthly - cardsUsed;

  const spentByCategory = useMemo(() => {
    const map = new Map<string, number>();
    monthTransactions
      .filter((item) => item.type === 'expense')
      .forEach((item) => map.set(item.category || 'Geral', (map.get(item.category || 'Geral') || 0) + Math.abs(Number(item.amount || 0))));
    return map;
  }, [monthTransactions]);

  const expenseCategories = categories.filter((item) => item.category_type === 'expense' || item.category_type === 'both');

  function navigate(path: string) {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  function openAddCard() {
    setEditingCard(null);
    setCardForm({ name: '', limit: '', used: '0', due_day: '10', closing_day: '1' });
    setShowCardModal(true);
  }

  function openEditCard(card: CreditCard) {
    setEditingCard(card);
    setCardForm({ name: card.name, limit: String(card.limit || 0), used: String(card.used || 0), due_day: String(card.due_day || 10), closing_day: String(card.closing_day || 1) });
    setShowCardModal(true);
  }

  async function saveCard(event: React.FormEvent) {
    event.preventDefault();
    const payload = {
      user_id: user.id,
      name: cardForm.name.trim(),
      brand: editingCard?.brand || 'Visa',
      limit: Number(cardForm.limit || 0),
      used: Number(cardForm.used || 0),
      due_day: Number(cardForm.due_day || 10),
      closing_day: Number(cardForm.closing_day || 1),
    };
    const result = editingCard
      ? await supabase.from('mf_credit_cards').update(payload).eq('id', editingCard.id).eq('user_id', user.id)
      : await supabase.from('mf_credit_cards').insert(payload);
    if (result.error) setError(result.error.message);
    else { setShowCardModal(false); await refresh(); }
  }

  async function deleteCard(card: CreditCard) {
    if (!window.confirm(`Excluir o cartão ${card.name}?`)) return;
    const result = await supabase.from('mf_credit_cards').delete().eq('id', card.id).eq('user_id', user.id);
    if (result.error) setError(result.error.message); else await refresh();
  }

  function openAddInstallment() {
    setEditingInstallment(null);
    setInstallmentForm({ card_id: cards[0]?.id || '', description: '', total_amount: '', monthly_amount: '', current_installment: '1', total_installments: '1', due_day: '1' });
    setShowInstallmentModal(true);
  }

  function openEditInstallment(item: CardInstallment) {
    setEditingInstallment(item);
    setInstallmentForm({ card_id: item.card_id || '', description: item.description, total_amount: String(item.total_amount || 0), monthly_amount: String(item.monthly_amount || 0), current_installment: String(item.current_installment || 1), total_installments: String(item.total_installments || 1), due_day: String(item.due_day || 1) });
    setShowInstallmentModal(true);
  }

  async function saveInstallment(event: React.FormEvent) {
    event.preventDefault();
    const payload = {
      user_id: user.id,
      card_id: installmentForm.card_id || null,
      description: installmentForm.description.trim(),
      total_amount: Number(installmentForm.total_amount || 0),
      monthly_amount: Number(installmentForm.monthly_amount || 0),
      current_installment: Number(installmentForm.current_installment || 1),
      total_installments: Number(installmentForm.total_installments || 1),
      due_day: Number(installmentForm.due_day || 1),
    };
    const result = editingInstallment
      ? await supabase.from('mf_card_installments').update(payload).eq('id', editingInstallment.id).eq('user_id', user.id)
      : await supabase.from('mf_card_installments').insert(payload);
    if (result.error) setError(result.error.message);
    else { setShowInstallmentModal(false); await refresh(); }
  }

  async function deleteInstallment(item: CardInstallment) {
    const result = await supabase.from('mf_card_installments').delete().eq('id', item.id).eq('user_id', user.id);
    if (result.error) setError(result.error.message); else await refresh();
  }

  async function payInstallment(item: CardInstallment) {
    const result = await supabase.rpc('mf_pay_card_installment', { p_installment_id: item.id });
    if (result.error) setError(result.error.message); else await refresh();
  }

  async function payCardBill(card: CreditCard) {
    const result = await supabase.rpc('mf_pay_credit_card_bill_v2', { p_card_id: card.id });
    if (result.error) setError(result.error.message); else await refresh();
  }

  async function saveBudget(event: React.FormEvent) {
    event.preventDefault();
    const limit = Number(budgetLimit || 0);
    if (!budgetCategory) { setError('Selecione uma categoria.'); return; }
    if (!Number.isFinite(limit) || limit <= 0) { setError('Informe um limite maior que zero.'); return; }
    setSavingBudget(true);
    const result = await supabase.from('mf_budgets').upsert(
      { user_id: user.id, category: budgetCategory, limit_amount: limit },
      { onConflict: 'user_id,category' },
    );
    setSavingBudget(false);
    if (result.error) setError(result.error.message);
    else { setBudgetLimit(''); await refresh(); }
  }

  async function deleteBudget(item: BudgetRow) {
    const result = await supabase.from('mf_budgets').delete().eq('id', item.id).eq('user_id', user.id);
    if (result.error) setError(result.error.message); else await refresh();
  }

  return (
    <div className="mf-app-shell mf-routed-app">
      <AppNavigation onLaunch={() => undefined} />
      <header className="mf-topbar">
        <div className="mf-brand">
          <div className="mf-brand-icon"><Wallet size={20} /></div>
          <div><h1>{settings?.workspace_name || 'MFinanceiro'}</h1><span>{settings?.display_name ? `Olá, ${settings.display_name.split(/\s+/)[0]}` : 'Planejamento'}</span></div>
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
        {loading ? <div className="mf-loading">Carregando planejamento...</div> : (
          <div className="mf-tab-shell">
            {section === 'overview' && (
              <div className="space-y-4 animate-fade-in">
                <div>
                  <h2 className="text-xl font-black">Visão do mês</h2>
                  <p className="text-sm text-white/40">O que está previsto para acontecer com seu dinheiro neste mês.</p>
                </div>
                <section className="grid grid-cols-2 gap-3 xl:grid-cols-5">
                  <Metric label="Saldo atual" value={formatCurrency(balance, isPrivate)} icon={<Wallet size={16} />} />
                  <Metric label="Receitas previstas" value={formatCurrency(expectedIncome, isPrivate)} detail="Baseadas na renda cadastrada" icon={<TrendingUp size={16} />} />
                  <Metric label="Contas recorrentes" value={formatCurrency(pendingFixed + subscriptionMonthly, isPrivate)} icon={<ReceiptText size={16} />} />
                  <Metric label="Cartões em aberto" value={formatCurrency(cardsUsed, isPrivate)} icon={<CreditCardIcon size={16} />} />
                  <Metric label="Projeção do mês" value={formatCurrency(projectedBalance, isPrivate)} detail="Saldo + receitas - compromissos" icon={<TrendingDown size={16} />} />
                </section>
                <div className="grid gap-4 xl:grid-cols-3">
                  <article className="mf-card xl:col-span-1">
                    <h3 className="mb-3 flex items-center gap-2 font-bold"><Target size={16} />Resumo planejado</h3>
                    <div className="space-y-3 text-sm">
                      <div className="flex justify-between"><span className="text-white/45">Contas fixas pendentes</span><strong>{formatCurrency(pendingFixed, isPrivate)}</strong></div>
                      <div className="flex justify-between"><span className="text-white/45">Assinaturas/mês</span><strong>{formatCurrency(subscriptionMonthly, isPrivate)}</strong></div>
                      <div className="flex justify-between"><span className="text-white/45">Cartões utilizados</span><strong>{formatCurrency(cardsUsed, isPrivate)}</strong></div>
                      <div className="border-t border-white/10 pt-3 flex justify-between"><span className="text-white/45">Orçamentos definidos</span><strong>{budgets.length}</strong></div>
                    </div>
                  </article>
                  <article className="mf-card xl:col-span-2">
                    <h3 className="mb-3 flex items-center gap-2 font-bold"><CalendarDays size={16} />Agenda financeira</h3>
                    <p className="mb-3 text-xs text-white/35">Calendário integrado ao planejamento: vencimentos e entradas previstas.</p>
                    <FinancialCalendar fixedBills={fixedBills} settings={settings} />
                  </article>
                </div>
              </div>
            )}

            {section === 'accounts' && <FinancialStructure userId={user.id} accounts={accounts} categories={categories} onRefresh={refresh} />}

            {section === 'cards' && (
              <Cartoes
                cards={cards}
                installments={installments}
                onAddCard={openAddCard}
                onEditCard={openEditCard}
                onDeleteCard={deleteCard}
                onAddInstallment={openAddInstallment}
                onEditInstallment={openEditInstallment}
                onDeleteInstallment={deleteInstallment}
                onPayInstallment={payInstallment}
                onPayCardBill={payCardBill}
              />
            )}

            {section === 'commitments' && (
              <div className="space-y-4">
                <div className="mf-subnav">
                  <button className={commitmentKind === 'fixed' ? 'active' : ''} onClick={() => navigate('/app/planejamento/compromissos?tipo=fixas')}>Contas fixas</button>
                  <button className={commitmentKind === 'subscriptions' ? 'active' : ''} onClick={() => navigate('/app/planejamento/compromissos?tipo=assinaturas')}>Assinaturas</button>
                </div>
                {commitmentKind === 'fixed'
                  ? <MonthlyFixedBills userId={user.id} onDataChanged={refresh} />
                  : <SubscriptionManager />}
              </div>
            )}

            {section === 'income' && (
              <Suspense fallback={<div className="mf-loading">Carregando receitas previstas...</div>}>
                <IncomePayrollCenter userId={user.id} />
              </Suspense>
            )}

            {section === 'budget' && (
              <div className="space-y-4 animate-fade-in">
                <div>
                  <h2 className="text-xl font-black">Orçamento mensal</h2>
                  <p className="text-sm text-white/40">Defina quanto pretende gastar por categoria e acompanhe o consumo do mês.</p>
                </div>
                <form onSubmit={saveBudget} className="mf-card grid gap-3 md:grid-cols-[1fr_180px_auto] md:items-end">
                  <label className="text-xs text-white/45">Categoria
                    <select className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-3 text-sm text-white" value={budgetCategory} onChange={(event) => { setBudgetCategory(event.target.value); const existing = budgets.find((item) => item.category === event.target.value); setBudgetLimit(existing ? String(existing.limit_amount) : ''); }}>
                      <option value="">Selecione</option>
                      {expenseCategories.map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}
                    </select>
                  </label>
                  <label className="text-xs text-white/45">Limite mensal
                    <input className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-3 text-sm text-white" type="number" min="0" step="0.01" value={budgetLimit} onChange={(event) => setBudgetLimit(event.target.value)} placeholder="0,00" />
                  </label>
                  <button className="primary rounded-xl px-4 py-3 text-sm font-bold" disabled={savingBudget}>{savingBudget ? 'Salvando...' : 'Salvar orçamento'}</button>
                </form>
                <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {budgets.length === 0 ? <div className="mf-card text-sm text-white/40">Nenhum orçamento definido ainda.</div> : budgets.map((item) => {
                    const spent = spentByCategory.get(item.category) || 0;
                    const percentage = item.limit_amount > 0 ? Math.min(100, (spent / item.limit_amount) * 100) : 0;
                    const remaining = item.limit_amount - spent;
                    return (
                      <article key={item.id} className="mf-card">
                        <div className="flex items-start justify-between gap-3">
                          <div><h3 className="font-bold">{item.category}</h3><p className="text-xs text-white/35">{percentage.toFixed(0)}% utilizado</p></div>
                          <button type="button" onClick={() => void deleteBudget(item)} className="text-white/30 hover:text-red-400"><Trash2 size={15} /></button>
                        </div>
                        <div className="mt-4 flex justify-between text-sm"><span>Gasto</span><strong>{formatCurrency(spent, isPrivate)}</strong></div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/5"><div className="h-full bg-brand-primary" style={{ width: `${percentage}%` }} /></div>
                        <div className="mt-3 flex justify-between text-xs text-white/45"><span>Limite {formatCurrency(item.limit_amount, isPrivate)}</span><span className={remaining < 0 ? 'text-red-400' : 'text-brand-primary'}>{remaining >= 0 ? 'Restam ' : 'Excedeu '}{formatCurrency(Math.abs(remaining), isPrivate)}</span></div>
                        <button type="button" onClick={() => { setBudgetCategory(item.category); setBudgetLimit(String(item.limit_amount)); }} className="mt-3 flex items-center gap-1 text-xs text-white/45 hover:text-white"><Pencil size={12} />Editar limite</button>
                      </article>
                    );
                  })}
                </section>
              </div>
            )}
          </div>
        )}
      </section>

      {showCardModal && (
        <div className="mf-modal-backdrop">
          <form className="mf-modal compact" onSubmit={saveCard}>
            <div className="mf-modal-title"><h2>{editingCard ? 'Editar cartão' : 'Novo cartão'}</h2><button type="button" onClick={() => setShowCardModal(false)}><X size={18} /></button></div>
            <label>Nome<input required value={cardForm.name} onChange={(event) => setCardForm({ ...cardForm, name: event.target.value })} /></label>
            <label>Limite<input type="number" min="0" step="0.01" required value={cardForm.limit} onChange={(event) => setCardForm({ ...cardForm, limit: event.target.value })} /></label>
            <label>Valor usado<input type="number" min="0" step="0.01" value={cardForm.used} onChange={(event) => setCardForm({ ...cardForm, used: event.target.value })} /></label>
            <div className="grid grid-cols-2 gap-3"><label>Fechamento<input type="number" min="1" max="31" value={cardForm.closing_day} onChange={(event) => setCardForm({ ...cardForm, closing_day: event.target.value })} /></label><label>Vencimento<input type="number" min="1" max="31" value={cardForm.due_day} onChange={(event) => setCardForm({ ...cardForm, due_day: event.target.value })} /></label></div>
            <div className="mf-modal-actions"><button type="button" onClick={() => setShowCardModal(false)}>Cancelar</button><button className="primary">Salvar</button></div>
          </form>
        </div>
      )}

      {showInstallmentModal && (
        <div className="mf-modal-backdrop">
          <form className="mf-modal" onSubmit={saveInstallment}>
            <div className="mf-modal-title"><h2>{editingInstallment ? 'Editar parcelamento' : 'Novo parcelamento'}</h2><button type="button" onClick={() => setShowInstallmentModal(false)}><X size={18} /></button></div>
            <label>Cartão<select required value={installmentForm.card_id} onChange={(event) => setInstallmentForm({ ...installmentForm, card_id: event.target.value })}><option value="">Selecione</option>{cards.map((card) => <option key={card.id} value={card.id}>{card.name}</option>)}</select></label>
            <label>Descrição<input required value={installmentForm.description} onChange={(event) => setInstallmentForm({ ...installmentForm, description: event.target.value })} /></label>
            <div className="grid grid-cols-2 gap-3"><label>Valor total<input type="number" min="0" step="0.01" required value={installmentForm.total_amount} onChange={(event) => setInstallmentForm({ ...installmentForm, total_amount: event.target.value })} /></label><label>Valor da parcela<input type="number" min="0" step="0.01" required value={installmentForm.monthly_amount} onChange={(event) => setInstallmentForm({ ...installmentForm, monthly_amount: event.target.value })} /></label></div>
            <div className="grid grid-cols-3 gap-3"><label>Parcela atual<input type="number" min="1" value={installmentForm.current_installment} onChange={(event) => setInstallmentForm({ ...installmentForm, current_installment: event.target.value })} /></label><label>Total<input type="number" min="1" value={installmentForm.total_installments} onChange={(event) => setInstallmentForm({ ...installmentForm, total_installments: event.target.value })} /></label><label>Vencimento<input type="number" min="1" max="31" value={installmentForm.due_day} onChange={(event) => setInstallmentForm({ ...installmentForm, due_day: event.target.value })} /></label></div>
            <div className="mf-modal-actions"><button type="button" onClick={() => setShowInstallmentModal(false)}>Cancelar</button><button className="primary">Salvar</button></div>
          </form>
        </div>
      )}
    </div>
  );
}
