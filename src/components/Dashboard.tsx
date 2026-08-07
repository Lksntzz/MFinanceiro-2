import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
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
} from 'lucide-react';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, registerables } from 'chart.js';
import { addDays, format, isAfter, startOfDay, startOfMonth, startOfWeek, subDays } from 'date-fns';

import { supabase } from '../lib/supabase';
import { calculateFinanceSummary } from '../lib/finance-calculations';
import { DEFAULT_USER_SETTINGS } from '../lib/constants';
import { clearLegacyCache } from '../lib/clearCache';
import { formatCurrency } from '../lib/formatters';
import {
  LEDGER_PAGE_SIZE,
  mergeLedgerRows,
  readLedgerCache,
  writeLedgerCache,
} from '../lib/ledger-cache';
import { useApp } from '../context/AppContext';
import {
  CardInstallment,
  CreditCard,
  FinancialAccount,
  FinanceSummary,
  FixedBill,
  ImportedTransaction,
  Investment,
  LedgerCursor,
  LedgerPage,
  StatementImportOptions,
  Transaction,
  TransactionCategory,
  UserSettings,
} from '../types';

import AdminAccessRequests from './AdminAccessRequests';
import AdminMaintenanceControl from './AdminMaintenanceControl';
import AppNavigation from './AppNavigation';
import AutomationCenter from './AutomationCenter';
import BaseFinanceira from './BaseFinanceira';
import Cartoes from './Cartoes';
import Details from './Details';
import FinancialCalendar from './FinancialCalendar';
import FinancialGoals from './FinancialGoals';
import FinancialHealth from './FinancialHealth';
import FinancialStructure from './FinancialStructure';
import History from './History';
import ImportBatches from './ImportBatches';
import Insights from './Insights';
import MonthlyFixedBills from './MonthlyFixedBills';
import NotificationCenter from './NotificationCenter';
import ProfileCenter, { OnboardingChecklist } from './ProfileCenter';
import SubscriptionManager from './SubscriptionManager';

ChartJS.register(...registerables);

const ImportarExtratos = lazy(() => import('./ImportarExtratos'));
const IncomePayrollCenter = lazy(() => import('./IncomePayrollCenter'));
const Investments = lazy(() => import('./Investments'));

type ActiveTab = 'overview' | 'history' | 'cards' | 'analysis' | 'accounts' | 'settings' | 'admin_requests';
type AnalysisTab = 'stats' | 'insights' | 'health' | 'goals';
type AccountsTab = 'financial' | 'bills' | 'calendar' | 'subscriptions' | 'investments' | 'income' | 'automations';
type StatementBalanceMode = 'keep' | 'apply_new' | 'statement';

interface StatementImportRpcResult {
  batch_id: string;
  inserted_count: number;
  duplicate_count: number;
  rejected_count: number;
  ignored_count: number;
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

function normalizeLedgerPage(raw: unknown): LedgerPage {
  const page = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const items = Array.isArray(page.items)
    ? page.items.map(normalizeTransaction).filter((item): item is Transaction => Boolean(item))
    : [];
  const cursor = page.next_cursor && typeof page.next_cursor === 'object'
    ? page.next_cursor as LedgerCursor
    : null;
  return {
    items,
    has_more: page.has_more === true,
    total_count: Number(page.total_count || items.length),
    next_cursor: cursor,
  };
}

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

export default function Dashboard({
  user,
  isMaintenanceBypass: _isMaintenanceBypass,
}: {
  user: User;
  isMaintenanceBypass?: boolean;
}) {
  const { isPrivate, setIsPrivate } = useApp();
  const db = supabase;
  const location = useLocation();
  const navigate = useNavigate();
  const routePath = location.pathname.replace(/\/+$/, '') || '/app';
  const activeTab: ActiveTab = routePath === '/app'
    ? 'overview'
    : routePath.startsWith('/app/movimentacoes')
      ? 'history'
      : routePath.startsWith('/app/analises')
        ? 'analysis'
        : routePath === '/app/planejamento/cartoes'
          ? 'cards'
          : routePath.startsWith('/app/planejamento')
            ? 'accounts'
            : routePath === '/app/preferencias'
              ? 'settings'
              : routePath === '/app/admin'
                ? 'admin_requests'
                : 'overview';
  const historySubTab: 'list' | 'import' | 'batches' = routePath === '/app/movimentacoes/importar'
    ? 'import'
    : routePath === '/app/movimentacoes/lotes'
      ? 'batches'
      : 'list';
  const analysisSubTab: AnalysisTab = routePath.endsWith('/insights')
    ? 'insights'
    : routePath.endsWith('/saude')
      ? 'health'
      : routePath.endsWith('/metas')
        ? 'goals'
        : 'stats';
  const accountsSubTab: AccountsTab = routePath.endsWith('/renda')
    ? 'income'
    : routePath.endsWith('/contas-fixas')
      ? 'bills'
      : routePath.endsWith('/calendario')
        ? 'calendar'
        : routePath.endsWith('/assinaturas')
          ? 'subscriptions'
          : routePath.endsWith('/investimentos')
            ? 'investments'
            : routePath.endsWith('/automacoes')
              ? 'automations'
              : 'financial';

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const transactionIdsRef = useRef<Set<string>>(new Set());
  const [transactionCount, setTransactionCount] = useState(0);
  const [ledgerCursor, setLedgerCursor] = useState<LedgerCursor | null>(null);
  const [hasMoreTransactions, setHasMoreTransactions] = useState(false);
  const [loadingMoreTransactions, setLoadingMoreTransactions] = useState(false);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [categories, setCategories] = useState<TransactionCategory[]>([]);
  const [fixedBills, setFixedBills] = useState<FixedBill[]>([]);
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [installments, setInstallments] = useState<CardInstallment[]>([]);
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [analyticsTransactions, setAnalyticsTransactions] = useState<Transaction[]>([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsComplete, setAnalyticsComplete] = useState(false);
  const analyticsRequestRef = useRef(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNotificationCenter, setShowNotificationCenter] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [dismissedAlerts, setDismissedAlerts] = useState<string[]>([]);
  const [rhythmFilter, setRhythmFilter] = useState<'day' | 'week' | 'month'>('day');

  const [showAddModal, setShowAddModal] = useState(false);
  const [showBalanceModal, setShowBalanceModal] = useState(false);
  const [tempBalance, setTempBalance] = useState('');
  const [balanceAccountId, setBalanceAccountId] = useState('');
  const [newTransaction, setNewTransaction] = useState({
    amount: '',
    category: 'Geral',
    category_id: '',
    account_id: '',
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

  async function refreshFinancialState() {
    const [settingsResult, accountsResult, categoriesResult] = await Promise.all([
      db.from('mf_user_settings').select('*').eq('user_id', user.id).maybeSingle(),
      db.from('mf_account_balances').select('*').eq('user_id', user.id).order('is_default', { ascending: false }).order('created_at'),
      db.from('mf_transaction_categories').select('*').eq('user_id', user.id).order('sort_order').order('name'),
    ]);
    const firstError = settingsResult.error || accountsResult.error || categoriesResult.error;
    if (firstError) throw firstError;

    const nextAccounts = normalizeAccounts(accountsResult.data || []);
    const derivedBalance = nextAccounts.reduce((sum, account) => sum + Number(account.current_balance || 0), 0);
    if (settingsResult.data) {
      setSettings({ ...settingsResult.data, current_balance: derivedBalance } as UserSettings);
    }
    setAccounts(nextAccounts);
    setCategories((categoriesResult.data || []) as TransactionCategory[]);
  }

  async function refreshAuxiliaryData() {
    const [cardsResult, installmentsResult, fixedResult, investmentResult] = await Promise.all([
      db.from('mf_credit_cards').select('*').eq('user_id', user.id),
      db.from('mf_card_installments').select('*').eq('user_id', user.id),
      db.from('mf_fixed_bills').select('*').eq('user_id', user.id),
      db.from('mf_investments').select('*').eq('user_id', user.id),
    ]);
    const firstError = cardsResult.error || installmentsResult.error || fixedResult.error || investmentResult.error;
    if (firstError) throw firstError;

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
  }

  async function hydrateAnalyticsLedger(seed: LedgerPage) {
    const requestId = ++analyticsRequestRef.current;
    let rows = seed.items;
    let hasMore = seed.has_more;
    let cursor = seed.next_cursor;

    setAnalyticsLoading(hasMore);
    setAnalyticsComplete(!hasMore);

    try {
      while (hasMore) {
        if (!cursor) throw new Error('O ledger informou mais páginas sem fornecer cursor.');
        const { data, error: pageError } = await db.rpc('mf_get_ledger_page', {
          p_page_size: 250,
          p_cursor_date: cursor.date,
          p_cursor_created_at: cursor.created_at,
          p_cursor_id: cursor.id,
        });
        if (pageError) throw pageError;

        const page = normalizeLedgerPage(data);
        rows = mergeLedgerRows(rows, page.items);
        hasMore = page.has_more;
        cursor = page.next_cursor;
      }

      if (requestId === analyticsRequestRef.current) {
        setAnalyticsTransactions(rows);
        setAnalyticsComplete(true);
      }
    } catch (analyticsError) {
      console.warn('Falha ao consolidar o histórico completo para análises:', analyticsError);
      if (requestId === analyticsRequestRef.current) {
        setAnalyticsTransactions(rows);
        setAnalyticsComplete(false);
      }
    } finally {
      if (requestId === analyticsRequestRef.current) setAnalyticsLoading(false);
    }
  }

  async function fetchData() {
    setLoading(true);
    setError(null);

    const cached = readLedgerCache(user.id);
    if (cached) {
      transactionIdsRef.current = new Set(cached.rows.map((transaction) => transaction.id));
      setTransactions(cached.rows);
      setTransactionCount(cached.totalCount);
      setHasMoreTransactions(cached.hasMore);
      setLedgerCursor(cached.nextCursor);
    }

    try {
      const ensured = await db.rpc('mf_ensure_financial_structure');
      if (ensured.error) throw ensured.error;

      const [settingsResult, accountsResult, categoriesResult, ledgerResult, cardsResult, installmentsResult, fixedResult, investmentResult] =
        await Promise.all([
          db.from('mf_user_settings').select('*').eq('user_id', user.id).maybeSingle(),
          db.from('mf_account_balances').select('*').eq('user_id', user.id).order('is_default', { ascending: false }).order('created_at'),
          db.from('mf_transaction_categories').select('*').eq('user_id', user.id).order('sort_order').order('name'),
          db.rpc('mf_get_ledger_page', {
            p_page_size: LEDGER_PAGE_SIZE,
            p_cursor_date: null,
            p_cursor_created_at: null,
            p_cursor_id: null,
          }),
          db.from('mf_credit_cards').select('*').eq('user_id', user.id),
          db.from('mf_card_installments').select('*').eq('user_id', user.id),
          db.from('mf_fixed_bills').select('*').eq('user_id', user.id),
          db.from('mf_investments').select('*').eq('user_id', user.id),
        ]);

      const firstError = settingsResult.error || accountsResult.error || categoriesResult.error || ledgerResult.error || cardsResult.error || installmentsResult.error || fixedResult.error || investmentResult.error;
      if (firstError) throw firstError;

      let nextSettings = settingsResult.data as UserSettings | null;
      if (!nextSettings) {
        const defaults = DEFAULT_USER_SETTINGS(user.id);
        const inserted = await db.from('mf_user_settings').insert(defaults).select('*').single();
        if (inserted.error) throw inserted.error;
        nextSettings = inserted.data as UserSettings;
      }

      const nextAccounts = normalizeAccounts(accountsResult.data || []);
      const derivedBalance = nextAccounts.reduce((sum, account) => sum + Number(account.current_balance || 0), 0);
      const ledgerPage = normalizeLedgerPage(ledgerResult.data);
      nextSettings = { ...nextSettings, current_balance: derivedBalance };

      setSettings(nextSettings);
      setAccounts(nextAccounts);
      setCategories((categoriesResult.data || []) as TransactionCategory[]);
      transactionIdsRef.current = new Set(ledgerPage.items.map((transaction) => transaction.id));
      setTransactions(ledgerPage.items);
      setTransactionCount(ledgerPage.total_count);
      setHasMoreTransactions(ledgerPage.has_more);
      setLedgerCursor(ledgerPage.next_cursor);
      void hydrateAnalyticsLedger(ledgerPage);
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_finance_ledger_entries', filter }, (payload: any) => {
        const rowId = String(payload.old?.id || payload.new?.id || '');
        const existed = transactionIdsRef.current.has(rowId);
        if (payload.eventType === 'DELETE') {
          transactionIdsRef.current.delete(rowId);
          if (existed) setTransactionCount((count) => Math.max(0, count - 1));
        } else if (payload.eventType === 'INSERT' && !existed) {
          transactionIdsRef.current.add(rowId);
          setTransactionCount((count) => count + 1);
        }

        setTransactions((current) => {
          if (payload.eventType === 'DELETE') {
            return current.filter((item) => item.id !== rowId);
          }
          const normalized = normalizeTransaction(payload.new);
          if (!normalized) return current;
          return mergeLedgerRows(current, [normalized]);
        });
        setAnalyticsTransactions((current) => {
          if (payload.eventType === 'DELETE') {
            return current.filter((item) => item.id !== rowId);
          }
          const normalized = normalizeTransaction(payload.new);
          if (!normalized) return current;
          return mergeLedgerRows(current, [normalized]);
        });
        void refreshFinancialState().catch((refreshError) => console.warn('Falha ao atualizar saldos:', refreshError));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_user_settings', filter }, () => {
        void refreshFinancialState().catch((refreshError) => console.warn('Falha ao atualizar configurações:', refreshError));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_financial_accounts', filter }, () => {
        void refreshFinancialState().catch((refreshError) => console.warn('Falha ao atualizar contas:', refreshError));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_transaction_categories', filter }, () => {
        void refreshFinancialState().catch((refreshError) => console.warn('Falha ao atualizar categorias:', refreshError));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_credit_cards', filter }, () => {
        void refreshAuxiliaryData().catch((refreshError) => console.warn('Falha ao atualizar cartões:', refreshError));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_card_installments', filter }, () => {
        void refreshAuxiliaryData().catch((refreshError) => console.warn('Falha ao atualizar parcelas:', refreshError));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_fixed_bills', filter }, () => {
        void refreshAuxiliaryData().catch((refreshError) => console.warn('Falha ao atualizar contas fixas:', refreshError));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_investments', filter }, () => {
        void refreshAuxiliaryData().catch((refreshError) => console.warn('Falha ao atualizar investimentos:', refreshError));
      })
      .subscribe();

    return () => {
      void db.removeChannel(channel);
    };
  }, [user.id]);

  useEffect(() => {
    writeLedgerCache(user.id, transactions, transactionCount, hasMoreTransactions, ledgerCursor);
    transactionIdsRef.current = new Set(transactions.map((transaction) => transaction.id));
  }, [user.id, transactions, transactionCount, hasMoreTransactions, ledgerCursor]);

  useEffect(() => {
    const defaultAccount = accounts.find((account) => account.is_default && account.is_active)
      || accounts.find((account) => account.is_active);
    const defaultCategory = categories.find((category) => category.name === 'Geral' && category.is_active)
      || categories.find((category) => category.is_active);

    setNewTransaction((current) => ({
      ...current,
      account_id: accounts.some((account) => account.id === current.account_id && account.is_active)
        ? current.account_id
        : defaultAccount?.id || '',
      category_id: categories.some((category) => category.id === current.category_id && category.is_active)
        ? current.category_id
        : defaultCategory?.id || '',
      category: categories.find((category) => category.id === current.category_id)?.name
        || defaultCategory?.name
        || 'Geral',
    }));
  }, [accounts, categories]);

  async function loadMoreLedgerEntries() {
    if (!hasMoreTransactions || !ledgerCursor || loadingMoreTransactions) return;
    setLoadingMoreTransactions(true);
    setError(null);
    try {
      const { data, error: pageError } = await db.rpc('mf_get_ledger_page', {
        p_page_size: LEDGER_PAGE_SIZE,
        p_cursor_date: ledgerCursor.date,
        p_cursor_created_at: ledgerCursor.created_at,
        p_cursor_id: ledgerCursor.id,
      });
      if (pageError) throw pageError;
      const page = normalizeLedgerPage(data);
      setTransactions((current) => mergeLedgerRows(current, page.items));
      setTransactionCount(page.total_count);
      setHasMoreTransactions(page.has_more);
      setLedgerCursor(page.next_cursor);
    } catch (pageError: any) {
      setError(pageError?.message || 'Não foi possível carregar mais lançamentos.');
    } finally {
      setLoadingMoreTransactions(false);
    }
  }

  const financeTransactions = analyticsComplete ? analyticsTransactions : transactions;
  const analyticsIncomplete = !analyticsLoading
    && !analyticsComplete
    && transactionCount > transactions.length;

  useEffect(() => {
    if (!settings) {
      setSummary(null);
      return;
    }

    try {
      setSummary(calculateFinanceSummary(financeTransactions, settings, fixedBills, cards, installments));
    } catch (err) {
      console.error('Summary calculation failed:', err);
      setSummary(null);
    }
  }, [financeTransactions, settings, fixedBills, cards, installments]);

  const isAdmin = useMemo(() => {
    const role = String(user.app_metadata?.role || '').toLowerCase();
    return role === 'admin' || role === 'owner';
  }, [user]);

  const overviewTopCategories = useMemo(() => {
    const totals: Record<string, number> = {};
    let total = 0;

    financeTransactions
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
  }, [financeTransactions]);

  const latestOverviewTransactions = useMemo(
    () =>
      [...transactions]
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 4),
    [transactions],
  );

  const historicalWindow = useMemo(() => {
    const validDates = financeTransactions
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

    financeTransactions.forEach((transaction) => {
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
  }, [financeTransactions, settings?.current_balance]);

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
    const result = await db.rpc('mf_create_finance_entry_v3', {
      p_type: entry.type || 'expense',
      p_amount: Math.abs(Number(entry.amount || 0)),
      p_date: String(entry.date || new Date().toISOString()).slice(0, 10),
      p_description: entry.description || 'Lançamento',
      p_account_id: entry.account_id || null,
      p_category_id: entry.category_id || null,
      p_category: entry.category || 'Geral',
      p_payment_method: (entry as any).payment_method || 'unspecified',
      p_status: (entry as any).status || 'paid',
      p_source: entry.source || 'Manual',
      p_card_id: (entry as any).card_id || null,
      p_due_date: (entry as any).due_date || null,
      p_notes: (entry as any).notes || null,
    });
    if (result.error) throw result.error;
    return result.data;
  }

  async function handleAddTransaction(event: React.FormEvent) {
    event.preventDefault();
    try {
      const entered = Number(newTransaction.amount);
      if (!Number.isFinite(entered) || entered <= 0) return;
      const amount = newTransaction.type === 'expense' ? -Math.abs(entered) : Math.abs(entered);
      await insertLedger({ ...newTransaction, amount });
      setShowAddModal(false);
      setNewTransaction((current) => ({ ...current, amount: '', description: '', type: 'expense' }));
      await fetchData();
    } catch (err: any) {
      setError(err?.message || 'Não foi possível salvar o lançamento.');
    }
  }

  async function handleUpdateBalance(event: React.FormEvent) {
    event.preventDefault();
    const value = Number(tempBalance);
    if (!Number.isFinite(value) || !balanceAccountId) return;
    const result = await db.rpc('mf_set_account_balance', {
      p_account_id: balanceAccountId,
      p_balance: value,
    });
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setShowBalanceModal(false);
    await fetchData();
  }

  async function handleDeleteTransaction(id: string) {
    const result = await db.rpc('mf_delete_finance_entry', { p_entry_id: id });
    if (result.error) setError(result.error.message);
    else await fetchData();
  }

  async function handleDeleteAllTransactions() {
    if (!window.confirm('Apagar definitivamente todos os lançamentos e zerar o saldo?')) return;
    const deletion = await db.rpc('mf_delete_all_finance_entries', { p_account_id: null });
    if (deletion.error) {
      setError(deletion.error.message);
      return;
    }
    await fetchData();
  }

  async function handleImportTransactions(
    imported: ImportedTransaction[],
    newBalance: number | undefined,
    options: StatementImportOptions,
  ) {
    const entries = imported.map((item) => {
      const numericAmount = Number(item.amount);
      const selected = item.status === 'ready'
        && Number.isFinite(numericAmount)
        && numericAmount > 0
        && item.description !== 'Sem descricao';
      return {
        selected,
        status: item.status,
        date: item.date || '',
        description: item.description || '',
        category: item.category || 'Geral',
        amount: Number.isFinite(numericAmount) ? Math.abs(numericAmount) : 0,
        type: item.type,
        source: item.bank_source || item.source || 'Importado',
        external_id: item.source_id
          ? `statement:${item.bank_source || item.source || 'unknown'}:${item.source_id}`
          : null,
        original_description: item.original_description,
        confidence: item.confidence,
        running_balance: item.running_balance,
      };
    });

    if (!entries.some((entry) => entry.selected)) {
      throw new Error('Nenhum lançamento válido foi selecionado para importação.');
    }

    const balanceMode: StatementBalanceMode = options.balanceMode
      || (typeof newBalance === 'number' && Number.isFinite(newBalance) ? 'statement' : 'keep');

    const { data, error: rpcError } = await db.rpc('mf_commit_statement_import_v2', {
      p_entries: entries,
      p_account_id: options.accountId,
      p_balance_mode: balanceMode,
      p_statement_balance: balanceMode === 'statement' ? newBalance : null,
      p_file_name: options.fileName || null,
      p_file_type: options.fileType || null,
      p_file_size: options.fileSize ?? null,
      p_file_hash: options.fileHash || null,
      p_parser_name: options.parserName || null,
      p_raw_metadata: options.diagnostics || {},
    });

    if (rpcError) {
      console.error('Statement import RPC failed:', rpcError);
      throw new Error(rpcError.message || 'O banco recusou a importação.');
    }

    const result = data as StatementImportRpcResult | null;
    if (!result) throw new Error('O banco não retornou o resumo da importação.');

    const insertedCount = Number(result.inserted_count);
    const duplicateCount = Number(result.duplicate_count);
    const rejectedCount = Number(result.rejected_count);
    const ignoredCount = Number(result.ignored_count);
    const counts = [insertedCount, duplicateCount, rejectedCount, ignoredCount];
    if (counts.some((count) => !Number.isInteger(count) || count < 0)) {
      throw new Error('O banco retornou uma contagem inválida para a importação.');
    }

    const normalizedResult: StatementImportRpcResult = {
      ...result,
      inserted_count: insertedCount,
      duplicate_count: duplicateCount,
      rejected_count: rejectedCount,
      ignored_count: ignoredCount,
      net_new: Number(result.net_new || 0),
      balance_before: Number(result.balance_before || 0),
      balance_after: Number(result.balance_after || 0),
    };

    await fetchData();
    return normalizedResult;
  }

  async function handleUpdateSettings(nextSettings: UserSettings) {
    const { id: _id, ...payload } = nextSettings as any;
    const result = await db.from('mf_user_settings').update(payload).eq('user_id', user.id);
    if (result.error) setError(result.error.message);
    else await fetchData();
  }

  async function handleToggleBillStatus(id: string) {
    const bill = fixedBills.find((item) => item.id === id);
    if (!bill) return;
    const amount = -Math.abs(Number(bill.amount || 0));
    await insertLedger({ amount, type: 'expense', category: bill.category || 'Contas Fixas', description: `Pagamento: ${bill.name}` });
    await db.from('mf_fixed_bills').update({ status: 'paid', last_paid_month: format(new Date(), 'yyyy-MM') }).eq('id', id);
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

  const activeAccounts = accounts.filter((account) => account.is_active);
  const selectableCategories = categories.filter((category) =>
    category.is_active
    && (category.category_type === 'both' || category.category_type === newTransaction.type),
  );
  const balanceValue = accounts.length > 0
    ? accounts.reduce((sum, account) => sum + Number(account.current_balance || 0), 0)
    : Number(settings?.current_balance ?? summary?.currentBalance ?? 0);
  const dailyLimit = Number(summary?.dailyLimit || 0);
  const todaySpent = Number(summary?.todaySpent || 0);

  function openBalanceEditor() {
    const account = activeAccounts.find((item) => item.is_default) || activeAccounts[0];
    if (!account) {
      setError('Crie uma conta financeira antes de ajustar o saldo.');
      return;
    }
    setBalanceAccountId(account.id);
    setTempBalance(String(account.current_balance || 0));
    setShowBalanceModal(true);
  }

  return (
    <div className="mf-app-shell mf-routed-app">
      <AppNavigation onLaunch={() => setShowAddModal(true)} />
      <header className="mf-topbar">
        <div className="mf-brand">
          <div className="mf-brand-icon"><Wallet size={20} /></div>
          <div><h1>{settings?.workspace_name || 'MFinanceiro'}</h1><span>{settings?.display_name ? `Olá, ${settings.display_name.split(/\s+/)[0]}` : 'Dashboard'}</span></div>
        </div>

        <div className="mf-top-actions">
          <ProfileCenter user={user} settings={settings} accounts={accounts} open={showProfile} onOpenChange={setShowProfile} onSaved={fetchData} />
          <button onClick={() => setIsPrivate(!isPrivate)} title="Privacidade">{isPrivate ? <EyeOff size={16} /> : <Eye size={16} />}</button>
          <button className="relative" onClick={() => setShowNotificationCenter(true)} title="Notificações"><Bell size={16} />{notifications.length > 0 && <span className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[8px] font-black text-white">{notifications.length > 99 ? '99+' : notifications.length}</span>}</button>
          <button className="primary" onClick={() => setShowAddModal(true)}><Plus size={16} />Lançar</button>
          <button onClick={async () => { await db.auth.signOut(); window.location.replace('/'); }} title="Sair"><LogOut size={17} /></button>
        </div>
      </header>

      {error && <div className="mf-error"><AlertCircle size={16} />{error}<button onClick={() => setError(null)}><X size={14} /></button></div>}

      <section className={`mf-content ${activeTab === 'history' ? 'history-active' : ''}`}>
        <Suspense fallback={<div className="mf-loading">Carregando módulo...</div>}>
        <Routes>
        <Route path="/app" element={<>
          <OnboardingChecklist settings={settings} transactionCount={transactionCount} hasCommitment={fixedBills.length > 0 || cards.length > 0} onProfile={() => setShowProfile(true)} onNavigate={navigate} />
          <main className="mf-dashboard-grid">
            <section className="mf-kpi-grid">
              <article className={`mf-card mf-kpi ${balanceValue < 0 ? 'danger' : ''}`}>
                <div><span>Saldo derivado</span><button onClick={openBalanceEditor}><Pencil size={12} /></button></div>
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
          {(loading || analyticsLoading) && <div className="mf-loading">{loading ? 'Atualizando dados...' : 'Consolidando histórico completo...'}</div>}
          {analyticsIncomplete && <div className="mf-error" role="status"><AlertCircle size={16} />As análises estão usando apenas os lançamentos recentes porque o histórico completo não pôde ser consolidado. Atualize a página para tentar novamente.</div>}
        </>} />

        <Route path="/app/movimentacoes/*" element={
          <div className="mf-tab-shell history-shell">
            <div className="mf-subnav">
              <button className={historySubTab === 'list' ? 'active' : ''} onClick={() => navigate('/app/movimentacoes')}>Movimentações</button>
              <button className={historySubTab === 'import' ? 'active' : ''} onClick={() => navigate('/app/movimentacoes/importar')}>Importar extrato</button>
              <button className={historySubTab === 'batches' ? 'active' : ''} onClick={() => navigate('/app/movimentacoes/lotes')}>Lotes e conciliação</button>
            </div>
            {historySubTab === 'list' ? (
              <History
                transactions={transactions}
                onDelete={handleDeleteTransaction}
                onDeleteAll={handleDeleteAllTransactions}
                currentBalance={balanceValue}
                balanceConfirmed={settings?.balance_confirmed === true}
                totalCount={transactionCount}
                hasMore={hasMoreTransactions}
                isLoadingMore={loadingMoreTransactions}
                onLoadMore={loadMoreLedgerEntries}
              />
            ) : historySubTab === 'import' ? (
              <ImportarExtratos accounts={accounts} onImport={handleImportTransactions} onCancel={() => navigate('/app/movimentacoes')} accountHolderName={user.user_metadata?.name || user.email || undefined} internalAccountAliases={user.email ? [user.email.split('@')[0]] : []} />
            ) : (
              <ImportBatches userId={user.id} accounts={accounts} />
            )}
          </div>
        } />

        <Route path="/app/analises/*" element={
          <div className="mf-tab-shell">
            <div className="mf-subnav">
              <button className={analysisSubTab === 'stats' ? 'active' : ''} onClick={() => navigate('/app/analises/resumo')}>Estatísticas</button>
              <button className={analysisSubTab === 'insights' ? 'active' : ''} onClick={() => navigate('/app/analises/insights')}>Insights</button>
              <button className={analysisSubTab === 'health' ? 'active' : ''} onClick={() => navigate('/app/analises/saude')}>Saúde financeira</button>
              <button className={analysisSubTab === 'goals' ? 'active' : ''} onClick={() => navigate('/app/analises/metas')}>Metas</button>
            </div>
            {analyticsLoading && <div className="mf-loading">Consolidando histórico completo...</div>}
            {analyticsIncomplete && <div className="mf-error" role="status"><AlertCircle size={16} />Não foi possível consolidar todo o histórico. Os indicadores abaixo estão temporariamente limitados aos lançamentos recentes.</div>}
            {analysisSubTab === 'stats' && <Details transactions={financeTransactions} summary={summary} />}
            {analysisSubTab === 'insights' && <Insights summary={summary} transactions={financeTransactions} fixedBills={fixedBills} />}
            {analysisSubTab === 'health' && <FinancialHealth transactions={financeTransactions} summary={summary} totals={{ totalInvestments: investments.reduce((sum, item) => sum + Number(item.amount || 0), 0), categoryCount: new Set(financeTransactions.map((item) => item.category)).size }} />}
            {analysisSubTab === 'goals' && <FinancialGoals />}
          </div>
        } />

        <Route path="/app/planejamento/*" element={activeTab === 'cards' ?
          <Cartoes cards={cards} installments={installments} onAddCard={openAddCardModal} onEditCard={openEditCardModal} onDeleteCard={handleDeleteCard} onAddInstallment={openAddInstallmentModal} onEditInstallment={openEditInstallmentModal} onDeleteInstallment={handleDeleteInstallment} onPayInstallment={handlePayInstallment} onPayCardBill={handlePayCardBill} />
          :
          <div className="mf-tab-shell">
            <div className="mf-subnav">
              <button className={accountsSubTab === 'financial' ? 'active' : ''} onClick={() => navigate('/app/planejamento/contas')}>Contas financeiras</button>
              <button className={accountsSubTab === 'bills' ? 'active' : ''} onClick={() => navigate('/app/planejamento/contas-fixas')}>Contas fixas</button>
              <button className={accountsSubTab === 'calendar' ? 'active' : ''} onClick={() => navigate('/app/planejamento/calendario')}>Calendário</button>
              <button className={accountsSubTab === 'subscriptions' ? 'active' : ''} onClick={() => navigate('/app/planejamento/assinaturas')}>Assinaturas</button>
              <button className={accountsSubTab === 'investments' ? 'active' : ''} onClick={() => navigate('/app/planejamento/investimentos')}>Investimentos</button>
              <button className={accountsSubTab === 'income' ? 'active' : ''} onClick={() => navigate('/app/planejamento/renda')}>Renda</button>
              <button className={accountsSubTab === 'automations' ? 'active' : ''} onClick={() => navigate('/app/planejamento/automacoes')}>Automação</button>
            </div>
            {accountsSubTab === 'financial' && <FinancialStructure userId={user.id} accounts={accounts} categories={categories} onRefresh={fetchData} />}
            {accountsSubTab === 'bills' && <MonthlyFixedBills userId={user.id} onDataChanged={fetchData} />}
            {accountsSubTab === 'calendar' && <FinancialCalendar fixedBills={fixedBills} settings={settings} />}
            {accountsSubTab === 'subscriptions' && <SubscriptionManager />}
            {accountsSubTab === 'investments' && <Investments user={user} settings={settings} onRefresh={fetchData} />}
            {accountsSubTab === 'income' && <IncomePayrollCenter userId={user.id} />}
            {accountsSubTab === 'automations' && <AutomationCenter userId={user.id} accounts={accounts} categories={categories} />}
          </div>
        } />

        <Route path="/app/preferencias" element={settings ? <BaseFinanceira settings={settings} onSave={handleUpdateSettings} fixedBills={fixedBills} summary={summary} onToggleBillStatus={handleToggleBillStatus} onRefresh={fetchData} initialTab="income" /> : null} />
        <Route path="/app/admin" element={isAdmin ? <div className="space-y-4"><AdminMaintenanceControl /><AdminAccessRequests user={user} /></div> : <Navigate to="/app" replace />} />
        <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
        </Suspense>
      </section>

      <NotificationCenter isOpen={showNotificationCenter} onClose={() => setShowNotificationCenter(false)} notifications={notifications as any} onPay={(item: any) => item.type === 'fixed' && handleToggleBillStatus(item.originalData.id)} onDismiss={(id) => setDismissedAlerts((current) => [...current, id])} />

      {showAddModal && (
        <div className="mf-modal-backdrop">
          <form className="mf-modal" onSubmit={handleAddTransaction}>
            <div className="mf-modal-title"><h2>Novo lançamento</h2><button type="button" onClick={() => setShowAddModal(false)}><X size={18} /></button></div>
            <label>Valor<input type="number" step="0.01" required value={newTransaction.amount} onChange={(event) => setNewTransaction({ ...newTransaction, amount: event.target.value })} /></label>
            <div className="mf-type-buttons"><button type="button" className={newTransaction.type === 'expense' ? 'expense active' : 'expense'} onClick={() => setNewTransaction({ ...newTransaction, type: 'expense' })}>Saída</button><button type="button" className={newTransaction.type === 'income' ? 'income active' : 'income'} onClick={() => setNewTransaction({ ...newTransaction, type: 'income' })}>Entrada</button></div>
            <label>Conta<select required value={newTransaction.account_id} onChange={(event) => setNewTransaction({ ...newTransaction, account_id: event.target.value })}><option value="">Selecione uma conta</option>{activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
            <label>Categoria<select required value={newTransaction.category_id} onChange={(event) => { const category = categories.find((item) => item.id === event.target.value); setNewTransaction({ ...newTransaction, category_id: event.target.value, category: category?.name || 'Geral' }); }}><option value="">Selecione uma categoria</option>{selectableCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            <label>Descrição<input value={newTransaction.description} onChange={(event) => setNewTransaction({ ...newTransaction, description: event.target.value })} /></label>
            <div className="mf-modal-actions"><button type="button" onClick={() => setShowAddModal(false)}>Cancelar</button><button className="primary">Salvar</button></div>
          </form>
        </div>
      )}

      {showBalanceModal && (
        <div className="mf-modal-backdrop">
          <form className="mf-modal compact" onSubmit={handleUpdateBalance}>
            <div className="mf-modal-title"><h2>Calibrar saldo da conta</h2><button type="button" onClick={() => setShowBalanceModal(false)}><X size={18} /></button></div>
            <label>Conta<select value={balanceAccountId} onChange={(event) => { const account = accounts.find((item) => item.id === event.target.value); setBalanceAccountId(event.target.value); setTempBalance(String(account?.current_balance || 0)); }}>{activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
            <label>Saldo confirmado<input autoFocus type="number" step="0.01" value={tempBalance} onChange={(event) => setTempBalance(event.target.value)} /></label>
            <p className="text-[10px] text-white/40">A calibração ajusta o saldo inicial da conta. Os lançamentos continuam sendo a fonte de verdade.</p>
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
