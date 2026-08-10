import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';

import { supabase } from '../lib/supabase';
import { calculateFinanceSummary } from '../lib/finance-calculations';
import { DEFAULT_USER_SETTINGS } from '../lib/constants';
import {
  LEDGER_PAGE_SIZE,
  mergeLedgerRows,
  readLedgerCache,
  writeLedgerCache,
} from '../lib/ledger-cache';
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

type StatementBalanceMode = 'keep' | 'apply_new' | 'statement';

export type StatementImportRpcResult = {
  batch_id: string;
  inserted_count: number;
  duplicate_count: number;
  rejected_count: number;
  ignored_count: number;
  net_new: number;
  balance_before: number;
  balance_after: number;
  balance_mode: StatementBalanceMode;
};

function normalizeTransaction(row: any): Transaction | null {
  const rawDate = row?.date || row?.data || row?.created_at;
  if (!rawDate) return null;
  const amount = Number(row.amount ?? row.valor ?? 0);
  const rawType = String(row.type || row.tipo || '').toLowerCase();
  const type: 'income' | 'expense' = rawType === 'income' || rawType === 'entrada' || rawType === 'receita' || amount > 0 ? 'income' : 'expense';
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

function normalizeLedgerPage(raw: unknown): LedgerPage {
  const page = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const items = Array.isArray(page.items)
    ? page.items.map(normalizeTransaction).filter((item): item is Transaction => Boolean(item))
    : [];
  return {
    items,
    has_more: page.has_more === true,
    total_count: Number(page.total_count || items.length),
    next_cursor: page.next_cursor && typeof page.next_cursor === 'object' ? page.next_cursor as LedgerCursor : null,
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

function normalizeInstallments(rows: unknown[]): CardInstallment[] {
  return rows.map((row: any) => ({
    ...row,
    description: row.description || row.descricao || 'Parcelamento',
    total_amount: Number(row.total_amount ?? row.valor_total ?? 0),
    monthly_amount: Number(row.monthly_amount ?? row.valor_mensal ?? 0),
    current_installment: Number(row.current_installment ?? row.parcela_atual ?? 1),
    total_installments: Number(row.total_installments ?? row.total_parcelas ?? 1),
    due_day: Number(row.due_day ?? 1),
  })) as CardInstallment[];
}

export function useDashboardWorkspace(userId: string) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [analyticsTransactions, setAnalyticsTransactions] = useState<Transaction[]>([]);
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
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsComplete, setAnalyticsComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const analyticsRequestRef = useRef(0);
  const refreshTimerRef = useRef<number | null>(null);

  const hydrateAnalyticsLedger = useCallback(async (seed: LedgerPage) => {
    const requestId = ++analyticsRequestRef.current;
    let rows = seed.items;
    let hasMore = seed.has_more;
    let cursor = seed.next_cursor;
    setAnalyticsLoading(hasMore);
    setAnalyticsComplete(!hasMore);

    try {
      while (hasMore) {
        if (!cursor) throw new Error('O histórico informou mais páginas sem fornecer cursor.');
        const { data, error: pageError } = await supabase.rpc('mf_get_ledger_page', {
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
    } catch {
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

    const cached = readLedgerCache(userId);
    if (cached) {
      setTransactions(cached.rows);
      setTransactionCount(cached.totalCount);
      setHasMoreTransactions(cached.hasMore);
      setLedgerCursor(cached.nextCursor);
    }

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

      const nextAccounts = normalizeAccounts(accountsResult.data || []);
      const derivedBalance = nextAccounts.reduce((sum, account) => sum + Number(account.current_balance || 0), 0);
      const page = normalizeLedgerPage(ledgerResult.data);
      nextSettings = { ...nextSettings, current_balance: derivedBalance };

      setSettings(nextSettings);
      setAccounts(nextAccounts);
      setCategories((categoriesResult.data || []) as TransactionCategory[]);
      setTransactions(page.items);
      setTransactionCount(page.total_count);
      setHasMoreTransactions(page.has_more);
      setLedgerCursor(page.next_cursor);
      setCards((cardsResult.data || []) as CreditCard[]);
      setInstallments(normalizeInstallments(installmentsResult.data || []));
      setFixedBills((fixedResult.data || []) as FixedBill[]);
      void hydrateAnalyticsLedger(page);
    } catch (refreshError: any) {
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
      refreshTimerRef.current = window.setTimeout(() => void refresh(), 220);
    };

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
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
      void supabase.removeChannel(channel);
    };
  }, [refresh, userId]);

  useEffect(() => {
    writeLedgerCache(userId, transactions, transactionCount, hasMoreTransactions, ledgerCursor);
  }, [userId, transactions, transactionCount, hasMoreTransactions, ledgerCursor]);

  const financeTransactions = analyticsComplete ? analyticsTransactions : transactions;
  const analyticsIncomplete = !analyticsLoading && !analyticsComplete && transactionCount > transactions.length;

  useEffect(() => {
    if (!settings) { setSummary(null); return; }
    try {
      setSummary(calculateFinanceSummary(financeTransactions, settings, fixedBills, cards, installments));
    } catch {
      setSummary(null);
    }
  }, [financeTransactions, settings, fixedBills, cards, installments]);

  const balance = useMemo(
    () => accounts.length ? accounts.reduce((sum, account) => sum + Number(account.current_balance || 0), 0) : Number(settings?.current_balance || 0),
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
  }, [hasMoreTransactions, ledgerCursor, loadingMoreTransactions]);

  const deleteTransaction = useCallback(async (id: string) => {
    const { error: deleteError } = await supabase.rpc('mf_delete_finance_entry', { p_entry_id: id });
    if (deleteError) { setError(deleteError.message); return; }
    await refresh();
  }, [refresh]);

  const payFixedBill = useCallback(async (bill: FixedBill) => {
    const { error: entryError } = await supabase.rpc('mf_create_finance_entry_v3', {
      p_type: 'expense',
      p_amount: Math.abs(Number(bill.amount || 0)),
      p_date: format(new Date(), 'yyyy-MM-dd'),
      p_description: `Pagamento: ${bill.name}`,
      p_account_id: null,
      p_category_id: null,
      p_category: bill.category || 'Contas Fixas',
      p_payment_method: 'unspecified',
      p_status: 'paid',
      p_source: 'Agenda',
      p_card_id: null,
      p_due_date: null,
      p_notes: null,
      p_installment_count: 1,
    });
    if (entryError) { setError(entryError.message); return; }
    const { error: billError } = await supabase.from('mf_fixed_bills').update({ status: 'paid', last_paid_month: format(new Date(), 'yyyy-MM') }).eq('id', bill.id).eq('user_id', userId);
    if (billError) { setError(billError.message); return; }
    await refresh();
  }, [refresh, userId]);

  const importTransactions = useCallback(async (
    imported: ImportedTransaction[],
    newBalance: number | undefined,
    options: StatementImportOptions,
  ): Promise<StatementImportRpcResult> => {
    const entries = imported.map((item) => {
      const numericAmount = Number(item.amount);
      return {
        selected: item.status === 'ready' && Number.isFinite(numericAmount) && numericAmount > 0 && item.description !== 'Sem descricao',
        status: item.status,
        date: item.date || '',
        description: item.description || '',
        category: item.category || 'Geral',
        amount: Number.isFinite(numericAmount) ? Math.abs(numericAmount) : 0,
        type: item.type,
        source: item.bank_source || item.source || 'Importado',
        external_id: item.source_id ? `statement:${item.bank_source || item.source || 'unknown'}:${item.source_id}` : null,
        original_description: item.original_description,
        confidence: item.confidence,
        running_balance: item.running_balance,
      };
    });
    if (!entries.some((entry) => entry.selected)) throw new Error('Nenhum lançamento válido foi selecionado para importação.');

    const balanceMode: StatementBalanceMode = options.balanceMode || (typeof newBalance === 'number' && Number.isFinite(newBalance) ? 'statement' : 'keep');
    const { data, error: rpcError } = await supabase.rpc('mf_commit_statement_import_v2', {
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
    if (rpcError) throw new Error(rpcError.message || 'O banco recusou a importação.');
    const result = data as StatementImportRpcResult | null;
    if (!result) throw new Error('O banco não retornou o resumo da importação.');
    await refresh();
    return {
      ...result,
      inserted_count: Number(result.inserted_count || 0),
      duplicate_count: Number(result.duplicate_count || 0),
      rejected_count: Number(result.rejected_count || 0),
      ignored_count: Number(result.ignored_count || 0),
      net_new: Number(result.net_new || 0),
      balance_before: Number(result.balance_before || 0),
      balance_after: Number(result.balance_after || 0),
    };
  }, [refresh]);

  return {
    settings, accounts, categories, fixedBills, cards, installments, transactions,
    financeTransactions, transactionCount, summary, balance, loading, error, setError,
    analyticsLoading, analyticsIncomplete, hasMoreTransactions, loadingMoreTransactions,
    refresh, loadMore, deleteTransaction, payFixedBill, importTransactions,
  };
}
