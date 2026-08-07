import React, { useEffect, useMemo, useState } from 'react';
import { User } from '@supabase/supabase-js';
import {
  Activity,
  AlertCircle,
  BarChart2,
  Bell,
  CreditCard as CreditCardIcon,
  Eye,
  EyeOff,
  History as HistoryIcon,
  LayoutDashboard,
  LogOut,
  Pencil,
  PieChart as PieChartIcon,
  Plus,
  Settings,
  ShieldAlert,
  TrendingUp,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, registerables } from 'chart.js';
import { addDays, format, isAfter, startOfDay, startOfMonth, startOfWeek, subDays } from 'date-fns';

import { supabase } from '../lib/supabase';
import { calculateFinanceSummary } from '../lib/finance-calculations';
import { DEFAULT_USER_SETTINGS, CATEGORIES } from '../lib/constants';
import { clearLegacyCache } from '../lib/clearCache';
import { formatCurrency } from '../lib/formatters';
import { useApp } from '../context/AppContext';
import {
  CardInstallment,
  CreditCard,
  FinanceSummary,
  FixedBill,
  ImportedTransaction,
  Investment,
  Transaction,
  UserSettings,
} from '../types';

import AdminAccessRequests from './AdminAccessRequests';
import BaseFinanceira from './BaseFinanceira';
import Cartoes from './Cartoes';
import Details from './Details';
import FinancialCalendar from './FinancialCalendar';
import FinancialGoals from './FinancialGoals';
import FinancialHealth from './FinancialHealth';
import History from './History';
import ImportarExtratos from './ImportarExtratos';
import Insights from './Insights';
import Investments from './Investments';
import NotificationCenter from './NotificationCenter';
import SubscriptionManager from './SubscriptionManager';

ChartJS.register(...registerables);

type ActiveTab = 'overview' | 'history' | 'cards' | 'analysis' | 'accounts' | 'settings' | 'admin_requests';
type AnalysisTab = 'stats' | 'insights' | 'health' | 'goals';
type AccountsTab = 'bills' | 'calendar' | 'subscriptions' | 'investments';
type StatementBalanceMode = 'keep' | 'apply_new' | 'statement';

interface StatementImportRpcResult {
  inserted_count: number;
  duplicate_count: number;
  net_new: number;
  balance_before: number;
  balance_after: number;
  balance_mode: StatementBalanceMode;
}

function normalizeTransaction(row: any): Transaction | null {
  const rawDate = row.date || row.data || row.created_at;
  if (!rawDate) return null;

  const amount = Number(row.amount ?? row.valor ?? 0);
  const rawType = String(row.type || row.tipo || '').toLowerCase();
  const type: 'income' | 'expense' =
    rawType === 'income' || rawType === 'entrada' || rawType === 'receita' || amount > 0
      ? 'income'
      : 'expense';

  return {
    ...row,
    amount,
    type,
    date: rawDate,
    description: row.description || row.descricao || 'Lançamento importado',
    category: row.category || row.categoria || 'Geral',
    status: row.status || 'paid',
  } as Transaction;
}

function parseTransactionDate(rawDate: string): Date | null {
  const value = String(rawDate || '').trim();
  if (!value) return null;

  const dateOnly = value.match(/^(\d{4}-\d{2}-\d{2})/i)?.[1];
  const parsed = dateOnly ? new Date(`${dateOnly}T12:00:00`) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function transactionDay(rawDate: string): string {
  const parsed = parseTransactionDate(rawDate);
  return parsed ? format(parsed, 'yyyy-MM-dd') : '';
}

export default function Dashboard({
  user,
  isMaintenanceBypass: _isMaintenanceBypass,
}: {
  user: User;
  isMaintenanceBypass?: boolean;
}) {
  const { isPrivate, setIsPrivate } = useApp();
  const db = supabase;

  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [historySubTab, setHistorySubTab] = useState<'list' | 'import'>('list');
  const [analysisSubTab, setAnalysisSubTab] = useState<AnalysisTab>('stats');
  const [accountsSubTab, setAccountsSubTab] = useState<AccountsTab>('bills');

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [fixedBills, setFixedBills] = useState<FixedBill[]>([]);
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [installments, setInstallments] = useState<CardInstallment[]>([]);
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNotificationCenter, setShowNotificationCenter] = useState(false);
  const [dismissedAlerts, setDismissedAlerts] = useState<string[]>([]);
  const [rhythmFilter, setRhythmFilter] = useState<'day' | 'week' | 'month'>('day');

  const [showAddModal, setShowAddModal] = useState(false);
  const [showBalanceModal, setShowBalanceModal] = useState(false);
  const [tempBalance, setTempBalance] = useState('');
  const [newTransaction, setNewTransaction] = useState({
    amount: '',
    category: 'Geral',
    description: '',
    type: 'expense' as 'expense' | 'income',
  });

  const [showCardModal, setShowCardModal] = useState(false);
  const [editingCard, setEditingCard] = useState<CreditCard | null>(null);
  const [cardForm, setCardForm] = useState({ name: '', limit: '', used: '0', due_day: '10', closing_day: '1' });

  const [showInstallmentModal, setShowInstallmentModal] = useState(false);
  const [editingInstallment, setEditingInstallment] = useState<CardInstallment | null>(null);
  const [installmentForm, setInstallmentForm] = useState({
    card_id: '',
    description: '',
    total_amount: '',
    monthly_amount: '',
    current_installment: '1',
    total_installments: '1',
    due_day: '1',
  });

  useEffect(() => {
    clearLegacyCache();
  }, []);

  async function fetchData() {
    setLoading(true);
    setError(null);

    try {
      const [settingsResult, transactionsResult, cardsResult, installmentsResult, fixedResult, investmentResult] =
        await Promise.all([
          db.from('mf_user_settings').select('*').eq('user_id', user.id).maybeSingle(),
          db.from('mf_finance_ledger_entries').select('*').eq('user_id', user.id).order('date', { ascending: false }),
          db.from('mf_credit_cards').select('*').eq('user_id', user.id),
          db.from('mf_card_installments').select('*').eq('user_id', user.id),
          db.from('mf_fixed_bills').select('*').eq('user_id', user.id),
          db.from('mf_investments').select('*').eq('user_id', user.id),
        ]);

      const firstError = settingsResult.error || transactionsResult.error || cardsResult.error || installmentsResult.error || fixedResult.error || investmentResult.error;
      if (firstError) throw firstError;

      let nextSettings = settingsResult.data as UserSettings | null;
      if (!nextSettings) {
        const defaults = DEFAULT_USER_SETTINGS(user.id);
        const inserted = await db.from('mf_user_settings').insert(defaults).select('*').single();
        if (inserted.error) throw inserted.error;
        nextSettings = inserted.data as UserSettings;
      }

      const normalizedTransactions = (transactionsResult.data || [])
        .map(normalizeTransaction)
        .filter((item): item is Transaction => Boolean(item));

      setSettings(nextSettings);
      setTransactions(normalizedTransactions);
      setCards((cardsResult.data || []) as CreditCard[]);
      setInstallments(
        (installmentsResult.data || []).map((item: any) => ({
          ...item,
          description: item.description || item.descricao || 'Parcelamento',
          total_amount: Number(item.total_amount ?? item.valor_total ?? 0),
          monthly_amount: Number(item.monthly_amount ?? item.valor_mensal ?? 0),
          current_installment: Number(item.current_installment ?? item.parcela_atual ?? 1),
          total_installments: Number(item.total_installments ?? item.total_parcelas ?? 1),
          due_day: Number(item.due_day ?? 1),
        })) as CardInstallment[],
      );
      setFixedBills((fixedResult.data || []) as FixedBill[]);
      setInvestments(
        (investmentResult.data || []).map((item: any) => ({ ...item, amount: Number(item.amount ?? item.valor ?? 0) })) as Investment[],
      );
    } catch (err: any) {
      console.error('Dashboard fetch error:', err);
      setError(err?.message || 'Não foi possível carregar seus dados financeiros.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchData();
    const filter = `user_id=eq.${user.id}`;
    const channel = db
      .channel(`dashboard-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_finance_ledger_entries', filter }, () => void fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_user_settings', filter }, () => void fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_credit_cards', filter }, () => void fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_card_installments', filter }, () => void fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_fixed_bills', filter }, () => void fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_investments', filter }, () => void fetchData())
      .subscribe();

    return () => {
      void db.removeChannel(channel);
    };
  }, [user.id]);

  useEffect(() => {
    if (!settings) {
      setSummary(null);
      return;
    }

    try {
      setSummary(calculateFinanceSummary(transactions, settings, fixedBills, cards, installments));
    } catch (err) {
      console.error('Summary calculation failed:', err);
      setSummary(null);
    }
  }, [transactions, settings, fixedBills, cards, installments]);

  const isAdmin = useMemo(() => {
    const role = String(user.app_metadata?.role || '').toLowerCase();
    return role === 'admin' || role === 'owner' || user.user_metadata?.is_admin === true;
  }, [user]);

  const overviewTopCategories = useMemo(() => {
    const totals: Record<string, number> = {};
    let total = 0;

    transactions
      .filter((transaction) => transaction.type === 'expense')
      .forEach((transaction) => {
        const amount = Math.abs(Number(transaction.amount) || 0);
        totals[transaction.category || 'Geral'] = (totals[transaction.category || 'Geral'] || 0) + amount;
        total += amount;
      });

    return Object.entries(totals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([name, amount]) => ({ name, amount, percentage: total > 0 ? (amount / total) * 100 : 0 }));
  }, [transactions]);

  const latestOverviewTransactions = useMemo(
    () =>
      [...transactions]
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 4),
    [transactions],
  );

  const historicalWindow = useMemo(() => {
    const validDates = transactions
      .map((transaction) => parseTransactionDate(transaction.date))
      .filter((date): date is Date => Boolean(date))
      .sort((a, b) => a.getTime() - b.getTime());

    const now = startOfDay(new Date());
    const earliestTransaction = validDates[0];
    const latestTransaction = validDates[validDates.length - 1];
    const latestDay = latestTransaction ? startOfDay(latestTransaction) : now;
    const anchor = latestTransaction && now.getTime() - latestDay.getTime() > 7 * 86400000 ? latestDay : now;
    const startCandidate = earliestTransaction ? startOfDay(earliestTransaction) : subDays(anchor, 29);
    const start = isAfter(startCandidate, anchor) ? anchor : startCandidate;

    const keys: string[] = [];
    for (let day = start; !isAfter(day, anchor); day = addDays(day, 1)) {
      keys.push(format(day, 'yyyy-MM-dd'));
    }

    const dailyNet = new Map(keys.map((key) => [key, 0]));
    const dailyIncome = new Map(keys.map((key) => [key, 0]));
    const dailyExpense = new Map(keys.map((key) => [key, 0]));

    transactions.forEach((transaction) => {
      const key = transactionDay(transaction.date);
      if (!dailyNet.has(key)) return;
      const amount = Number(transaction.amount) || 0;
      dailyNet.set(key, (dailyNet.get(key) || 0) + amount);
      if (amount >= 0) dailyIncome.set(key, (dailyIncome.get(key) || 0) + amount);
      else dailyExpense.set(key, (dailyExpense.get(key) || 0) + Math.abs(amount));
    });

    const balances = new Array(keys.length).fill(0);
    let balance = Number(settings?.current_balance) || 0;
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      balances[index] = Number(balance.toFixed(2));
      balance -= dailyNet.get(keys[index]) || 0;
    }

    return {
      keys,
      labels: keys.map((key) => format(new Date(`${key}T12:00:00`), 'dd/MM')),
      balances,
      incomes: keys.map((key) => Number((dailyIncome.get(key) || 0).toFixed(2))),
      expenses: keys.map((key) => Number((dailyExpense.get(key) || 0).toFixed(2))),
    };
  }, [transactions, settings?.current_balance]);

  const lineChartData = {
    labels: historicalWindow.labels,
    datasets: [
      {
        label: 'Saldo',
        data: historicalWindow.balances,
        borderColor: '#00f2ff',
        backgroundColor: 'rgba(0,242,255,.08)',
        fill: true,
        tension: 0.35,
        pointRadius: 2,
        pointHoverRadius: 5,
        borderWidth: 2,
      },
    ],
  };

  const rhythmChartData = useMemo(() => {
    if (rhythmFilter === 'day') {
      return {
        labels: historicalWindow.labels,
        expenses: historicalWindow.expenses,
        incomes: historicalWindow.incomes,
      };
    }

    const buckets = new Map<string, { label: string; expense: number; income: number }>();

    historicalWindow.keys.forEach((key, index) => {
      const date = new Date(`${key}T12:00:00`);
      const bucketStart = rhythmFilter === 'week'
        ? startOfWeek(date, { weekStartsOn: 1 })
        : startOfMonth(date);
      const bucketKey = format(bucketStart, 'yyyy-MM-dd');
      const existing = buckets.get(bucketKey);

      if (existing) {
        existing.expense += historicalWindow.expenses[index] || 0;
        existing.income += historicalWindow.incomes[index] || 0;
        return;
      }

      buckets.set(bucketKey, {
        label: format(date, 'dd/MM'),
        expense: historicalWindow.expenses[index] || 0,
        income: historicalWindow.incomes[index] || 0,
      });
    });

    const grouped = [...buckets.values()];
    return {
      labels: grouped.map((item) => item.label),
      expenses: grouped.map((item) => Number(item.expense.toFixed(2))),
      incomes: grouped.map((item) => Number(item.income.toFixed(2))),
    };
  }, [historicalWindow, rhythmFilter]);

  const rhythmLineData = {
    labels: rhythmChartData.labels,
    datasets: [
      {
        label: 'Saídas',
        data: rhythmChartData.expenses,
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239,68,68,.06)',
        fill: true,
        tension: 0.35,
        pointRadius: 0,
        borderWidth: 2,
      },
      {
        label: 'Entradas',
        data: rhythmChartData.incomes,
        borderColor: '#22c55e',
        backgroundColor: 'rgba(34,197,94,.06)',
        fill: true,
        tension: 0.35,
        pointRadius: 0,
        borderWidth: 2,
      },
    ],
  };

  const chartOptions: any = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 350 },
    plugins: { legend: { display: false } },
    scales: {
      y: {
        grid: { color: 'rgba(255,255,255,.055)' },
        ticks: { color: 'rgba(255,255,255,.35)', font: { size: 9 }, maxTicksLimit: 5 },
      },
      x: {
        grid: { display: false },
        ticks: { color: 'rgba(255,255,255,.35)', font: { size: 9 }, maxTicksLimit: 12 },
      },
    },
  };

  const overviewCardsUsed = cards.reduce((sum, card) => sum + Number(card.used || 0), 0);
  const overviewCardsLimit = cards.reduce((sum, card) => sum + Number(card.limit || 0), 0);
  const overviewCardsAvailable = overviewCardsLimit - overviewCardsUsed;
  const overviewCardsUsagePercent = overviewCardsLimit > 0 ? Math.min(100, (overviewCardsUsed / overviewCardsLimit) * 100) : 0;

  const notifications = useMemo(() => {
    return fixedBills
      .filter((bill: any) => bill.status !== 'paid')
      .filter((bill) => !dismissedAlerts.includes(`fixed-${bill.id}`))
      .map((bill) => ({
        id: `fixed-${bill.id}`,
        type: 'fixed',
        title: bill.name,
        amount: Number(bill.amount || 0),
        status: 'pending',
        originalData: bill,
      }));
  }, [fixedBills, dismissedAlerts]);

  async function insertLedger(entry: Partial<Transaction>) {
    const result = await db.from('mf_finance_ledger_entries').insert({
      user_id: user.id,
      date: entry.date || new Date().toISOString(),
      amount: entry.amount || 0,
      type: entry.type || 'expense',
      description: entry.description || 'Lançamento',
      category: entry.category || 'Geral',
      source: (entry as any).source || 'Manual',
      status: (entry as any).status || 'paid',
    });
    if (result.error) throw result.error;
  }

  async function handleAddTransaction(event: React.FormEvent) {
    event.preventDefault();
    if (!settings) return;

    try {
      const entered = Number(newTransaction.amount);
      if (!Number.isFinite(entered) || entered <= 0) return;
      const amount = newTransaction.type === 'expense' ? -Math.abs(entered) : Math.abs(entered);
      await insertLedger({ ...newTransaction, amount });
      const nextBalance = Number(settings.current_balance || 0) + amount;
      const update = await db.from('mf_user_settings').update({ current_balance: nextBalance }).eq('user_id', user.id);
      if (update.error) throw update.error;
      setShowAddModal(false);
      setNewTransaction({ amount: '', category: 'Geral', description: '', type: 'expense' });
      await fetchData();
    } catch (err: any) {
      setError(err?.message || 'Não foi possível salvar o lançamento.');
    }
  }

  async function handleUpdateBalance(event: React.FormEvent) {
    event.preventDefault();
    const value = Number(tempBalance);
    if (!Number.isFinite(value)) return;
    const result = await db.from('mf_user_settings').update({ current_balance: value }).eq('user_id', user.id);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setShowBalanceModal(false);
    await fetchData();
  }

  async function handleDeleteTransaction(id: string) {
    const result = await db.from('mf_finance_ledger_entries').delete().eq('id', id).eq('user_id', user.id);
    if (result.error) setError(result.error.message);
    else await fetchData();
  }

  async function handleDeleteAllTransactions() {
    if (!window.confirm('Apagar definitivamente todos os lançamentos e zerar o saldo?')) return;
    const deletion = await db.from('mf_finance_ledger_entries').delete().eq('user_id', user.id);
    if (deletion.error) {
      setError(deletion.error.message);
      return;
    }
    await db.from('mf_user_settings').update({ current_balance: 0 }).eq('user_id', user.id);
    await fetchData();
  }

  async function handleImportTransactions(imported: ImportedTransaction[], newBalance?: number) {
    const entries = imported
      .filter((item) => item.description && Number(item.amount) > 0)
      .map((item) => ({
        date: item.date,
        description: item.description,
        category: item.category || 'Geral',
        amount: Math.abs(Number(item.amount)),
        type: item.type,
        source: item.bank_source || item.source || 'Importado',
        external_id: item.source_id
          ? `statement:${item.bank_source || item.source || 'unknown'}:${item.source_id}`
          : null,
        metadata: {
          original_description: item.original_description,
          confidence: item.confidence,
        },
      }));

    if (!entries.length) {
      throw new Error('Nenhum lançamento válido foi selecionado para importação.');
    }

    const rawApproval = (window as any).__mfStatementImportApproval as {
      reviewedAt?: number;
      mode?: StatementBalanceMode;
    } | undefined;
    const approvalIsFresh = Number(rawApproval?.reviewedAt || 0) > Date.now() - 10 * 60_000;
    const approvedMode = approvalIsFresh && ['keep', 'apply_new', 'statement'].includes(String(rawApproval?.mode))
      ? rawApproval?.mode as StatementBalanceMode
      : undefined;
    const balanceMode: StatementBalanceMode = approvedMode
      || (typeof newBalance === 'number' && Number.isFinite(newBalance) ? 'statement' : 'keep');

    const { data, error: rpcError } = await db.rpc('mf_commit_statement_import', {
      p_entries: entries,
      p_balance_mode: balanceMode,
      p_statement_balance: balanceMode === 'statement' ? newBalance : null,
    });

    if (rpcError) {
      console.error('Statement import RPC failed:', rpcError);
      throw new Error(rpcError.message || 'O banco recusou a importação.');
    }

    const result = data as StatementImportRpcResult | null;
    const insertedCount = Number(result?.inserted_count);
    if (!result || !Number.isInteger(insertedCount) || insertedCount < 0) {
      throw new Error('O banco não confirmou quantos lançamentos foram importados.');
    }

    const dates = entries.map((entry) => entry.date).filter(Boolean).sort();
    window.dispatchEvent(new CustomEvent('mf:statement-import-result', {
      detail: {
        insertedCount,
        duplicateCount: Number(result.duplicate_count || 0),
        periodStart: dates[0] || null,
        periodEnd: dates[dates.length - 1] || null,
        netNew: Number(result.net_new || 0),
        mode: result.balance_mode,
        balanceBefore: Number(result.balance_before || 0),
        balanceAfter: Number(result.balance_after || 0),
      },
    }));
    delete (window as any).__mfStatementImportApproval;

    await fetchData();
    return insertedCount;
  }

  async function handleUpdateSettings(nextSettings: UserSettings) {
    const { id: _id, ...payload } = nextSettings as any;
    const result = await db.from('mf_user_settings').update(payload).eq('user_id', user.id);
    if (result.error) setError(result.error.message);
    else await fetchData();
  }

  async function handleToggleBillStatus(id: string) {
    const bill = fixedBills.find((item) => item.id === id);
    if (!bill || !settings) return;
    const amount = -Math.abs(Number(bill.amount || 0));
    await insertLedger({ amount, type: 'expense', category: bill.category || 'Contas Fixas', description: `Pagamento: ${bill.name}` });
    await db.from('mf_fixed_bills').update({ status: 'paid', last_paid_month: format(new Date(), 'yyyy-MM') }).eq('id', id);
    await db.from('mf_user_settings').update({ current_balance: Number(settings.current_balance || 0) + amount }).eq('user_id', user.id);
    await fetchData();
  }

  function openAddCardModal() {
    setEditingCard(null);
    setCardForm({ name: '', limit: '', used: '0', due_day: '10', closing_day: '1' });
    setShowCardModal(true);
  }

  function openEditCardModal(card: CreditCard) {
    setEditingCard(card);
    setCardForm({
      name: card.name,
      limit: String(card.limit || 0),
      used: String(card.used || 0),
      due_day: String(card.due_day || 10),
      closing_day: String(card.closing_day || 1),
    });
    setShowCardModal(true);
  }

  async function handleSaveCard(event: React.FormEvent) {
    event.preventDefault();
    const payload = {
      user_id: user.id,
      name: cardForm.name,
      brand: editingCard?.brand || 'Visa',
      limit: Number(cardForm.limit || 0),
      used: Number(cardForm.used || 0),
      due_day: Number(cardForm.due_day || 10),
      closing_day: Number(cardForm.closing_day || 1),
    };
    const result = editingCard
      ? await db.from('mf_credit_cards').update(payload).eq('id', editingCard.id)
      : await db.from('mf_credit_cards').insert(payload);
    if (result.error) setError(result.error.message);
    else {
      setShowCardModal(false);
      await fetchData();
    }
  }

  async function handleDeleteCard(card: CreditCard) {
    if (!window.confirm(`Excluir o cartão ${card.name}?`)) return;
    const result = await db.from('mf_credit_cards').delete().eq('id', card.id).eq('user_id', user.id);
    if (result.error) setError(result.error.message);
    else await fetchData();
  }

  function openAddInstallmentModal() {
    setEditingInstallment(null);
    setInstallmentForm({
      card_id: cards[0]?.id || '',
      description: '',
      total_amount: '',
      monthly_amount: '',
      current_installment: '1',
      total_installments: '1',
      due_day: '1',
    });
    setShowInstallmentModal(true);
  }

  function openEditInstallmentModal(item: CardInstallment) {
    setEditingInstallment(item);
    setInstallmentForm({
      card_id: item.card_id || '',
      description: item.description,
      total_amount: String(item.total_amount || 0),
      monthly_amount: String(item.monthly_amount || 0),
      current_installment: String(item.current_installment || 1),
      total_installments: String(item.total_installments || 1),
      due_day: String(item.due_day || 1),
    });
    setShowInstallmentModal(true);
  }

  async function handleSaveInstallment(event: React.FormEvent) {
    event.preventDefault();
    const payload = {
      user_id: user.id,
      card_id: installmentForm.card_id || null,
      description: installmentForm.description,
      total_amount: Number(installmentForm.total_amount || 0),
      monthly_amount: Number(installmentForm.monthly_amount || 0),
      current_installment: Number(installmentForm.current_installment || 1),
      total_installments: Number(installmentForm.total_installments || 1),
      due_day: Number(installmentForm.due_day || 1),
    };
    const result = editingInstallment
      ? await db.from('mf_card_installments').update(payload).eq('id', editingInstallment.id)
      : await db.from('mf_card_installments').insert(payload);
    if (result.error) setError(result.error.message);
    else {
      setShowInstallmentModal(false);
      await fetchData();
    }
  }

  async function handleDeleteInstallment(item: CardInstallment) {
    const result = await db.from('mf_card_installments').delete().eq('id', item.id).eq('user_id', user.id);
    if (result.error) setError(result.error.message);
    else await fetchData();
  }

  async function handlePayInstallment(item: CardInstallment) {
    const { error: rpcError } = await db.rpc('mf_pay_card_installment', { p_installment_id: item.id });
    if (rpcError) setError(rpcError.message);
    else await fetchData();
  }

  async function handlePayCardBill(card: CreditCard) {
    const { error: rpcError } = await db.rpc('mf_pay_credit_card_bill_v2', { p_card_id: card.id });
    if (rpcError) setError(rpcError.message);
    else await fetchData();
  }

  const toolGroups: Array<{ id: ActiveTab; label: string; icon: LucideIcon }> = [
    { id: 'overview', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'history', label: 'Histórico', icon: HistoryIcon },
    { id: 'cards', label: 'Cartões', icon: CreditCardIcon },
    { id: 'analysis', label: 'Análises', icon: BarChart2 },
    { id: 'accounts', label: 'Contas', icon: Wallet },
    { id: 'settings', label: 'Preferências', icon: Settings },
  ];

  if (isAdmin) {
    toolGroups.push({ id: 'admin_requests', label: 'Admin', icon: ShieldAlert });
  }

  const balanceValue = Number(settings?.current_balance ?? summary?.currentBalance ?? 0);
  const dailyLimit = Number(summary?.dailyLimit || 0);
  const todaySpent = Number(summary?.todaySpent || 0);

  return (
    <div className="mf-app-shell">
      <header className="mf-topbar">
        <div className="mf-brand">
          <div className="mf-brand-icon"><Wallet size={20} /></div>
          <div><h1>MFinanceiro</h1><span>Dashboard</span></div>
        </div>

        <nav className="mf-nav">
          {toolGroups.map((item) => (
            <button key={item.id} onClick={() => setActiveTab(item.id)} className={activeTab === item.id ? 'active' : ''}>
              <item.icon size={14} /><span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="mf-top-actions">
          <button onClick={() => setIsPrivate(!isPrivate)} title="Privacidade">{isPrivate ? <EyeOff size={16} /> : <Eye size={16} />}</button>
          <button onClick={() => setShowNotificationCenter(true)} title="Notificações"><Bell size={16} /></button>
          <button className="primary" onClick={() => setShowAddModal(true)}><Plus size={16} />Lançar</button>
          <button onClick={async () => { await db.auth.signOut(); window.location.replace('/'); }} title="Sair"><LogOut size={17} /></button>
        </div>
      </header>

      {error && <div className="mf-error"><AlertCircle size={16} />{error}<button onClick={() => setError(null)}><X size={14} /></button></div>}

      <section className={`mf-content ${activeTab === 'history' ? 'history-active' : ''}`}>
        {activeTab === 'overview' && (
          <main className="mf-dashboard-grid">
            <section className="mf-kpi-grid">
              <article className={`mf-card mf-kpi ${balanceValue < 0 ? 'danger' : ''}`}>
                <div><span>Saldo</span><button onClick={() => { setTempBalance(String(balanceValue)); setShowBalanceModal(true); }}><Pencil size={12} /></button></div>
                <strong>{formatCurrency(balanceValue, isPrivate)}</strong>
              </article>
              <article className="mf-card mf-kpi accent"><span>Limite</span><strong>{formatCurrency(dailyLimit, isPrivate)}</strong></article>
              <article className="mf-card mf-kpi"><span>Ciclo atual</span><strong>{summary?.cyclePeriodLabel || '--'} <small>({summary?.daysRemaining || 0}d)</small></strong></article>
              <article className="mf-card mf-kpi"><span>Gasto hoje</span><strong className={todaySpent > dailyLimit && dailyLimit > 0 ? 'negative' : ''}>{formatCurrency(todaySpent, isPrivate)}</strong></article>
            </section>

            <section className="mf-alert-grid">
              <article className={`mf-card mf-alert ${balanceValue < 0 ? 'danger' : ''}`}>
                <AlertCircle size={18} /><div><strong>Status do ciclo</strong><p>{summary?.smartAlert?.message || 'Acompanhe seu saldo e seus compromissos.'}</p></div>
              </article>
              <article className="mf-card mf-alert insight">
                <TrendingUp size={18} /><div><strong>Insight financeiro</strong><p>{summary?.dailyInsight || summary?.insights?.[0] || 'Mantenha seus registros atualizados.'}</p></div>
              </article>
            </section>

            <article className="mf-card mf-chart-card">
              <h3><Activity size={16} />Evolução do saldo</h3>
              <div className="mf-chart"><Line data={lineChartData} options={chartOptions} /></div>
            </article>

            <article className="mf-card mf-chart-card">
              <div className="mf-chart-heading">
                <h3><HistoryIcon size={16} />Ritmo de gastos</h3>
                <div className="mf-segmented">
                  {(['day', 'week', 'month'] as const).map((filter) => (
                    <button key={filter} className={rhythmFilter === filter ? 'active' : ''} onClick={() => setRhythmFilter(filter)}>
                      {filter === 'day' ? 'Dia' : filter === 'week' ? 'Semana' : 'Mês'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mf-chart"><Line data={rhythmLineData} options={chartOptions} /></div>
            </article>

            <section className="mf-bottom-grid">
              <article className="mf-card mf-mini-card">
                <h3><PieChartIcon size={16} />Categorias principais</h3>
                <div className="mf-category-list">
                  {overviewTopCategories.length ? overviewTopCategories.map((category) => (
                    <div key={category.name} className="mf-category-item">
                      <div><span>{category.name}</span><strong>R$ {category.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></div>
                      <div className="mf-progress"><i style={{ width: `${category.percentage}%` }} /></div>
                    </div>
                  )) : <p className="mf-empty">Sem despesas cadastradas.</p>}
                </div>
              </article>

              <article className="mf-card mf-mini-card">
                <h3><HistoryIcon size={16} />Últimos lançamentos</h3>
                <div className="mf-latest-list">
                  {latestOverviewTransactions.length ? latestOverviewTransactions.map((transaction) => (
                    <div key={transaction.id}>
                      <span><strong>{transaction.description || transaction.category}</strong><small>{format(new Date(transaction.date), 'dd/MM/yyyy')}</small></span>
                      <b className={transaction.type === 'income' ? 'positive' : 'negative'}>{transaction.type === 'income' ? '+' : '-'} R$ {Math.abs(transaction.amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</b>
                    </div>
                  )) : <p className="mf-empty">Nenhum lançamento.</p>}
                </div>
              </article>

              <article className="mf-card mf-mini-card mf-card-usage">
                <h3><CreditCardIcon size={16} />Uso de cartões</h3>
                <div className="mf-usage-row"><span>Utilizado</span><strong>R$ {overviewCardsUsed.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></div>
                <div className="mf-progress large"><i style={{ width: `${overviewCardsUsagePercent}%` }} /></div>
                <div className="mf-usage-footer"><span>Restante disponível</span><strong>R$ {overviewCardsAvailable.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></div>
              </article>
            </section>
          </main>
        )}

        {activeTab === 'history' && (
          <div className="mf-tab-shell history-shell">
            <div className="mf-subnav">
              <button className={historySubTab === 'list' ? 'active' : ''} onClick={() => setHistorySubTab('list')}>Movimentações</button>
              <button className={historySubTab === 'import' ? 'active' : ''} onClick={() => setHistorySubTab('import')}>Importar extrato</button>
            </div>
            {historySubTab === 'list' ? (
              <History transactions={transactions} onDelete={handleDeleteTransaction} onDeleteAll={handleDeleteAllTransactions} />
            ) : (
              <ImportarExtratos onImport={handleImportTransactions} onCancel={() => setHistorySubTab('list')} accountHolderName={user.user_metadata?.name || user.email || undefined} internalAccountAliases={user.email ? [user.email.split('@')[0]] : []} />
            )}
          </div>
        )}

        {activeTab === 'analysis' && (
          <div className="mf-tab-shell">
            <div className="mf-subnav">
              <button className={analysisSubTab === 'stats' ? 'active' : ''} onClick={() => setAnalysisSubTab('stats')}>Estatísticas</button>
              <button className={analysisSubTab === 'insights' ? 'active' : ''} onClick={() => setAnalysisSubTab('insights')}>Insights</button>
              <button className={analysisSubTab === 'health' ? 'active' : ''} onClick={() => setAnalysisSubTab('health')}>Saúde financeira</button>
              <button className={analysisSubTab === 'goals' ? 'active' : ''} onClick={() => setAnalysisSubTab('goals')}>Metas</button>
            </div>
            {analysisSubTab === 'stats' && <Details transactions={transactions} summary={summary} />}
            {analysisSubTab === 'insights' && <Insights summary={summary} transactions={transactions} fixedBills={fixedBills} />}
            {analysisSubTab === 'health' && <FinancialHealth transactions={transactions} summary={summary} totals={{ totalInvestments: investments.reduce((sum, item) => sum + Number(item.amount || 0), 0), categoryCount: new Set(transactions.map((item) => item.category)).size }} />}
            {analysisSubTab === 'goals' && <FinancialGoals />}
          </div>
        )}

        {activeTab === 'accounts' && (
          <div className="mf-tab-shell">
            <div className="mf-subnav">
              <button className={accountsSubTab === 'bills' ? 'active' : ''} onClick={() => setAccountsSubTab('bills')}>Gestão de contas</button>
              <button className={accountsSubTab === 'calendar' ? 'active' : ''} onClick={() => setAccountsSubTab('calendar')}>Calendário</button>
              <button className={accountsSubTab === 'subscriptions' ? 'active' : ''} onClick={() => setAccountsSubTab('subscriptions')}>Assinaturas</button>
              <button className={accountsSubTab === 'investments' ? 'active' : ''} onClick={() => setAccountsSubTab('investments')}>Investimentos</button>
            </div>
            {accountsSubTab === 'bills' && settings && <BaseFinanceira settings={settings} onSave={handleUpdateSettings} fixedBills={fixedBills} summary={summary} onToggleBillStatus={handleToggleBillStatus} onRefresh={fetchData} initialTab="bills" />}
            {accountsSubTab === 'calendar' && <FinancialCalendar fixedBills={fixedBills} settings={settings} />}
            {accountsSubTab === 'subscriptions' && <SubscriptionManager />}
            {accountsSubTab === 'investments' && <Investments user={user} settings={settings} onRefresh={fetchData} />}
          </div>
        )}

        {activeTab === 'cards' && <Cartoes cards={cards} installments={installments} onAddCard={openAddCardModal} onEditCard={openEditCardModal} onDeleteCard={handleDeleteCard} onAddInstallment={openAddInstallmentModal} onEditInstallment={openEditInstallmentModal} onDeleteInstallment={handleDeleteInstallment} onPayInstallment={handlePayInstallment} onPayCardBill={handlePayCardBill} />}

        {activeTab === 'settings' && settings && <BaseFinanceira settings={settings} onSave={handleUpdateSettings} fixedBills={fixedBills} summary={summary} onToggleBillStatus={handleToggleBillStatus} onRefresh={fetchData} initialTab="income" />}
        {activeTab === 'admin_requests' && <AdminAccessRequests user={user} />}

        {loading && activeTab === 'overview' && <div className="mf-loading">Atualizando dados...</div>}
      </section>

      <NotificationCenter isOpen={showNotificationCenter} onClose={() => setShowNotificationCenter(false)} notifications={notifications as any} onPay={(item: any) => item.type === 'fixed' && handleToggleBillStatus(item.originalData.id)} onDismiss={(id) => setDismissedAlerts((current) => [...current, id])} />

      {showAddModal && (
        <div className="mf-modal-backdrop">
          <form className="mf-modal" onSubmit={handleAddTransaction}>
            <div className="mf-modal-title"><h2>Novo lançamento</h2><button type="button" onClick={() => setShowAddModal(false)}><X size={18} /></button></div>
            <label>Valor<input type="number" step="0.01" required value={newTransaction.amount} onChange={(event) => setNewTransaction({ ...newTransaction, amount: event.target.value })} /></label>
            <div className="mf-type-buttons"><button type="button" className={newTransaction.type === 'expense' ? 'expense active' : 'expense'} onClick={() => setNewTransaction({ ...newTransaction, type: 'expense' })}>Saída</button><button type="button" className={newTransaction.type === 'income' ? 'income active' : 'income'} onClick={() => setNewTransaction({ ...newTransaction, type: 'income' })}>Entrada</button></div>
            <label>Categoria<select value={newTransaction.category} onChange={(event) => setNewTransaction({ ...newTransaction, category: event.target.value })}>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
            <label>Descrição<input value={newTransaction.description} onChange={(event) => setNewTransaction({ ...newTransaction, description: event.target.value })} /></label>
            <div className="mf-modal-actions"><button type="button" onClick={() => setShowAddModal(false)}>Cancelar</button><button className="primary">Salvar</button></div>
          </form>
        </div>
      )}

      {showBalanceModal && (
        <div className="mf-modal-backdrop">
          <form className="mf-modal compact" onSubmit={handleUpdateBalance}>
            <div className="mf-modal-title"><h2>Saldo atual</h2><button type="button" onClick={() => setShowBalanceModal(false)}><X size={18} /></button></div>
            <label>Valor da conta<input autoFocus type="number" step="0.01" value={tempBalance} onChange={(event) => setTempBalance(event.target.value)} /></label>
            <div className="mf-modal-actions"><button type="button" onClick={() => setShowBalanceModal(false)}>Cancelar</button><button className="primary">Salvar</button></div>
          </form>
        </div>
      )}

      {showCardModal && (
        <div className="mf-modal-backdrop"><form className="mf-modal compact" onSubmit={handleSaveCard}><div className="mf-modal-title"><h2>{editingCard ? 'Editar cartão' : 'Novo cartão'}</h2><button type="button" onClick={() => setShowCardModal(false)}><X size={18} /></button></div><label>Nome<input required value={cardForm.name} onChange={(event) => setCardForm({ ...cardForm, name: event.target.value })} /></label><label>Limite<input type="number" required value={cardForm.limit} onChange={(event) => setCardForm({ ...cardForm, limit: event.target.value })} /></label><div className="mf-modal-actions"><button type="button" onClick={() => setShowCardModal(false)}>Cancelar</button><button className="primary">Salvar</button></div></form></div>
      )}

      {showInstallmentModal && (
        <div className="mf-modal-backdrop"><form className="mf-modal" onSubmit={handleSaveInstallment}><div className="mf-modal-title"><h2>{editingInstallment ? 'Editar parcelamento' : 'Novo parcelamento'}</h2><button type="button" onClick={() => setShowInstallmentModal(false)}><X size={18} /></button></div><label>Descrição<input required value={installmentForm.description} onChange={(event) => setInstallmentForm({ ...installmentForm, description: event.target.value })} /></label><label>Valor total<input type="number" required value={installmentForm.total_amount} onChange={(event) => setInstallmentForm({ ...installmentForm, total_amount: event.target.value })} /></label><label>Valor da parcela<input type="number" required value={installmentForm.monthly_amount} onChange={(event) => setInstallmentForm({ ...installmentForm, monthly_amount: event.target.value })} /></label><div className="mf-modal-actions"><button type="button" onClick={() => setShowInstallmentModal(false)}>Cancelar</button><button className="primary">Salvar</button></div></form></div>
      )}
    </div>
  );
}
