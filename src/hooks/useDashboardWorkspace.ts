import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';

import {
  buildStatementImportCommand,
  calculateDashboardBalance,
  normalizeDashboardAccounts,
  normalizeDashboardInstallments,
  normalizeDashboardLedgerPage,
  normalizeStatementImportResult,
  type StatementImportRpcResult,
} from '../features/dashboard/dashboard-domain';
import { DEFAULT_USER_SETTINGS } from '../lib/constants';
import {
  readDashboardWorkspaceCache,
  writeDashboardWorkspaceCache,
} from '../lib/dashboard-workspace-cache';
import { calculateFinanceSummary } from '../lib/finance-calculations';
import {
  LEDGER_PAGE_SIZE,
  mergeLedgerRows,
  readLedgerCache,
  writeLedgerCache,
} from '../lib/ledger-cache';
import { supabase } from '../lib/supabase';
import { createOperationalCorrelationId, reportOperationalEvent } from '../lib/operational-observability';
import type {
  CardInstallment,
  CreditCard,
  FinancialAccount,
  FinanceSummary,
  FixedBill,
  ImportedTransaction,
  LedgerCursor,
  LedgerPage,
  StatementImportOptions,
  Transaction,
  TransactionCategory,
  UserSettings,
} from '../types';

export function useDashboardWorkspace(userId: string) {
  const initialCache = useMemo(() => ({
    ledger: readLedgerCache(userId),
    workspace: readDashboardWorkspaceCache(userId),
  }), [userId]);

  const [transactions, setTransactions] = useState<Transaction[]>(() => initialCache.ledger?.rows || []);
  const [analyticsTransactions, setAnalyticsTransactions] = useState<Transaction[]>(() => initialCache.ledger?.rows || []);
  const [transactionCount, setTransactionCount] = useState(() => initialCache.ledger?.totalCount || 0);
  const [ledgerCursor, setLedgerCursor] = useState<LedgerCursor | null>(() => initialCache.ledger?.nextCursor || null);
  const [hasMoreTransactions, setHasMoreTransactions] = useState(() => initialCache.ledger?.hasMore || false);
  const [loadingMoreTransactions, setLoadingMoreTransactions] = useState(false);
  const [settings, setSettings] = useState<UserSettings | null>(() => initialCache.workspace?.settings || null);
  const [accounts, setAccounts] = useState<FinancialAccount[]>(() => initialCache.workspace?.accounts || []);
  const [categories, setCategories] = useState<TransactionCategory[]>(() => initialCache.workspace?.categories || []);
  const [fixedBills, setFixedBills] = useState<FixedBill[]>(() => initialCache.workspace?.fixedBills || []);
  const [cards, setCards] = useState<CreditCard[]>(() => initialCache.workspace?.cards || []);
  const [installments, setInstallments] = useState<CardInstallment[]>(() => initialCache.workspace?.installments || []);
  const [loading, setLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsComplete, setAnalyticsComplete] = useState(() => Boolean(initialCache.ledger && !initialCache.ledger.hasMore));
  const [error, setError] = useState<string | null>(null);
  const analyticsRequestRef = useRef(0);
  const refreshTimerRef = useRef<number | null>(null);

  const hydrateAnalyticsLedger = useCallback(async (seed: LedgerPage) => {
    const requestId = ++analyticsRequestRef.current;
    const correlationId = createOperationalCorrelationId();
    const startedAt = performance.now();
    let rows = seed.items;
    let hasMore = seed.has_more;
    let cursor = seed.next_cursor;
    setAnalyticsLoading(hasMore);
    setAnalyticsComplete(!hasMore);

    try {
      while (hasMore) {
        if (!cursor) {
          reportOperationalEvent('dashboard.analytics_cursor_missing', 'dashboard-analytics', 'error', { loaded_count: rows.length }, { correlationId, durationMs: performance.now() - startedAt });
          throw new Error('O histórico informou mais páginas sem fornecer cursor.');
        }
        const { data, error: pageError } = await supabase.rpc('mf_get_ledger_page', {
          p_page_size: 250,
          p_cursor_date: cursor.date,
          p_cursor_created_at: cursor.created_at,
          p_cursor_id: cursor.id,
        });
        if (pageError) throw pageError;
        const page = normalizeDashboardLedgerPage(data);
        rows = mergeLedgerRows(rows, page.items);
        hasMore = page.has_more;
        cursor = page.next_cursor;
      }
      if (requestId === analyticsRequestRef.current) {
        setAnalyticsTransactions(rows);
        setAnalyticsComplete(true);
      }
    } catch {
      reportOperationalEvent('dashboard.analytics_page_failed', 'dashboard-analytics', 'warning', {
        loaded_count: rows.length, request_current: requestId === analyticsRequestRef.current,
      }, { correlationId, durationMs: performance.now() - startedAt });
      if (requestId === analyticsRequestRef.current) {
        setAnalyticsTransactions(rows);
        setAnalyticsComplete(false);
      }
    } finally {
      if (requestId === analyticsRequestRef.current) setAnalyticsLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const correlationId = createOperationalCorrelationId();
    const startedAt = performance.now();

    try {
      const ensured = await supabase.rpc('mf_ensure_financial_structure');
      if (ensured.error) throw ensured.error;

      const [settingsResult, accountsResult, categoriesResult, ledgerResult, cardsResult, installmentsResult, fixedResult] = await Promise.all([
        supabase.from('mf_user_settings').select('*').eq('user_id', userId).maybeSingle(),
        supabase.from('mf_account_balances').select('*').eq('user_id', userId).order('is_default', { ascending: false }).order('created_at'),
        supabase.from('mf_transaction_categories').select('*').eq('user_id', userId).order('sort_order').order('name'),
        supabase.rpc('mf_get_ledger_page', { p_page_size: LEDGER_PAGE_SIZE, p_cursor_date: null, p_cursor_created_at: null, p_cursor_id: null }),
        supabase.from('mf_credit_cards').select('*').eq('user_id', userId),
        supabase.from('mf_card_installments').select('*').eq('user_id', userId),
        supabase.from('mf_fixed_bills').select('*').eq('user_id', userId),
      ]);

      const firstError = settingsResult.error || accountsResult.error || categoriesResult.error || ledgerResult.error || cardsResult.error || installmentsResult.error || fixedResult.error;
      if (firstError) throw firstError;

      let nextSettings = settingsResult.data as UserSettings | null;
      if (!nextSettings) {
        const inserted = await supabase.from('mf_user_settings').insert(DEFAULT_USER_SETTINGS(userId)).select('*').single();
        if (inserted.error) throw inserted.error;
        nextSettings = inserted.data as UserSettings;
      }

      const nextAccounts = normalizeDashboardAccounts(accountsResult.data || []);
      const nextCategories = (categoriesResult.data || []) as TransactionCategory[];
      const nextCards = (cardsResult.data || []) as CreditCard[];
      const nextInstallments = normalizeDashboardInstallments(installmentsResult.data || []);
      const nextFixedBills = (fixedResult.data || []) as FixedBill[];
      const derivedBalance = nextAccounts.reduce((sum, account) => sum + Number(account.current_balance || 0), 0);
      const page = normalizeDashboardLedgerPage(ledgerResult.data);
      nextSettings = { ...nextSettings, current_balance: derivedBalance };

      setSettings(nextSettings);
      setAccounts(nextAccounts);
      setCategories(nextCategories);
      setTransactions(page.items);
      setTransactionCount(page.total_count);
      setHasMoreTransactions(page.has_more);
      setLedgerCursor(page.next_cursor);
      setCards(nextCards);
      setInstallments(nextInstallments);
      setFixedBills(nextFixedBills);
      writeDashboardWorkspaceCache(userId, {
        settings: nextSettings,
        accounts: nextAccounts,
        categories: nextCategories,
        fixedBills: nextFixedBills,
        cards: nextCards,
        installments: nextInstallments,
      });
      void hydrateAnalyticsLedger(page);
    } catch (refreshError: any) {
      reportOperationalEvent('dashboard.refresh_failed', 'dashboard-workspace', 'error', { phase: 'workspace_refresh' }, {
        correlationId, durationMs: performance.now() - startedAt,
      });
      setError(refreshError?.message || 'Não foi possível carregar seus dados financeiros.');
    } finally {
      setLoading(false);
    }
  }, [hydrateAnalyticsLedger, userId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const filter = `user_id=eq.${userId}`;
    const scheduleRefresh = () => {
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = window.setTimeout(() => void refresh(), 120);
    };

    window.addEventListener('mf:finance-data-changed', scheduleRefresh);

    const channel = supabase
      .channel(`dashboard-workspace-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_finance_ledger_entries', filter }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_user_settings', filter }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_financial_accounts', filter }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_transaction_categories', filter }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_credit_cards', filter }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_card_installments', filter }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_fixed_bills', filter }, scheduleRefresh)
      .subscribe();

    return () => {
      window.removeEventListener('mf:finance-data-changed', scheduleRefresh);
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
      void supabase.removeChannel(channel);
    };
  }, [refresh, userId]);

  useEffect(() => {
    writeLedgerCache(userId, transactions, transactionCount, hasMoreTransactions, ledgerCursor);
  }, [userId, transactions, transactionCount, hasMoreTransactions, ledgerCursor]);

  const financeTransactions = analyticsComplete ? analyticsTransactions : transactions;
  const analyticsIncomplete = !analyticsLoading && !analyticsComplete && transactionCount > transactions.length;
  const summary = useMemo<FinanceSummary | null>(() => {
    if (!settings) return null;
    try {
      return calculateFinanceSummary(financeTransactions, settings, fixedBills, cards, installments);
    } catch {
      return null;
    }
  }, [financeTransactions, settings, fixedBills, cards, installments]);

  const balance = useMemo(
    () => calculateDashboardBalance(accounts, settings?.current_balance),
    [accounts, settings?.current_balance],
  );

  const loadMore = useCallback(async () => {
    if (!hasMoreTransactions || !ledgerCursor || loadingMoreTransactions) return;
    setLoadingMoreTransactions(true);
    try {
      const { data, error: pageError } = await supabase.rpc('mf_get_ledger_page', {
        p_page_size: LEDGER_PAGE_SIZE,
        p_cursor_date: ledgerCursor.date,
        p_cursor_created_at: ledgerCursor.created_at,
        p_cursor_id: ledgerCursor.id,
      });
      if (pageError) throw pageError;
      const page = normalizeDashboardLedgerPage(data);
      setTransactions((current) => mergeLedgerRows(current, page.items));
      setTransactionCount(page.total_count);
      setHasMoreTransactions(page.has_more);
      setLedgerCursor(page.next_cursor);
    } catch (pageError: any) {
      reportOperationalEvent('dashboard.analytics_page_failed', 'dashboard-ledger', 'warning', { phase: 'load_more' });
      setError(pageError?.message || 'Não foi possível carregar mais lançamentos.');
    } finally {
      setLoadingMoreTransactions(false);
    }
  }, [hasMoreTransactions, ledgerCursor, loadingMoreTransactions]);

  const deleteTransaction = useCallback(async (id: string) => {
    const { error: deleteError } = await supabase.rpc('mf_delete_finance_entry', { p_entry_id: id });
    if (deleteError) {
      reportOperationalEvent('transaction.delete_failed', 'transaction-manual', 'error', { phase: 'rpc' });
      setError(deleteError.message);
      return;
    }
    await refresh();
  }, [refresh]);

  const payFixedBill = useCallback(async (bill: FixedBill) => {
    const correlationId = createOperationalCorrelationId();
    const startedAt = performance.now();
    const { error: paymentError } = await supabase.rpc('mf_pay_fixed_bill_current', {
      p_fixed_bill_id: bill.id,
      p_payment_method: 'unspecified',
    });
    if (paymentError) {
      reportOperationalEvent('fixed_bill.pay_failed', 'fixed-bill', 'error', { phase: 'atomic_payment' }, {
        correlationId,
        durationMs: performance.now() - startedAt,
        impact: 'financial_risk',
      });
      setError(paymentError.message);
      return;
    }
    await refresh();
  }, [refresh]);

  const importTransactions = useCallback(async (
    imported: ImportedTransaction[],
    newBalance: number | undefined,
    options: StatementImportOptions,
  ): Promise<StatementImportRpcResult> => {
    const command = buildStatementImportCommand(imported, newBalance, options);
    const correlationId = options.correlationId || createOperationalCorrelationId();
    const startedAt = performance.now();
    const { data, error: rpcError } = await supabase.rpc('mf_commit_statement_import_v2', command.params);
    if (rpcError) {
      reportOperationalEvent('statement.import_failed', 'statement-persistence', 'error', { phase: 'rpc', requested_count: imported.length }, { correlationId, durationMs: performance.now() - startedAt, severity: 'high', impact: 'financial_risk' });
      throw new Error(rpcError.message || 'O banco recusou a importação.');
    }
    let result: StatementImportRpcResult;
    try {
      result = normalizeStatementImportResult(data);
    } catch (error) {
      reportOperationalEvent('statement.import_failed', 'statement-persistence', 'error', { phase: 'normalize_result', requested_count: imported.length }, { correlationId, errorCode: 'STATEMENT_IMPORT_RESULT_INVALID', category: 'data_anomaly', severity: 'high', impact: 'financial_risk' });
      throw error;
    }
    const accountedCount = result.inserted_count + result.duplicate_count + result.rejected_count + result.ignored_count;
    if (accountedCount !== imported.length) {
      reportOperationalEvent('statement.import_failed', 'statement-persistence', 'error', { phase: 'count_invariant', requested_count: imported.length, accounted_count: accountedCount, count_delta: accountedCount - imported.length }, { correlationId, errorCode: 'STATEMENT_IMPORT_COUNT_MISMATCH', category: 'business_rule', severity: 'critical', impact: 'financial_risk' });
    }
    const tolerance = 0.02;
    const expectedBalance = result.balance_mode === 'keep' ? result.balance_before : result.balance_mode === 'statement' && typeof newBalance === 'number' ? newBalance : result.balance_before + result.net_new;
    if (Number.isFinite(expectedBalance) && Math.abs(result.balance_after - expectedBalance) > tolerance) {
      reportOperationalEvent('statement.import_failed', 'statement-persistence', 'error', { phase: 'balance_invariant', mode: result.balance_mode, within_tolerance: false }, { correlationId, errorCode: 'STATEMENT_IMPORT_BALANCE_INVARIANT_FAILED', category: 'business_rule', severity: 'critical', impact: 'financial_risk' });
    }
    await refresh();
    return result;
  }, [refresh]);

  return {
    settings, accounts, categories, fixedBills, cards, installments, transactions,
    financeTransactions, transactionCount, summary, balance, loading, error, setError,
    analyticsLoading, analyticsIncomplete, hasMoreTransactions, loadingMoreTransactions,
    refresh, loadMore, deleteTransaction, payFixedBill, importTransactions,
  };
}
