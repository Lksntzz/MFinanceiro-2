import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { AlertTriangle, BrainCircuit, RefreshCcw } from 'lucide-react';

import Insights from '../components/Insights';
import { calculateFinanceSummary } from './finance-calculations';
import { readLedgerCache } from './ledger-cache';
import { supabase } from './supabase';
import {
  CardInstallment,
  CreditCard,
  FinanceSummary,
  FixedBill,
  Transaction,
  UserSettings,
} from '../types';

const normalize = (value?: string | null) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

function normalizeTransaction(row: any): Transaction | null {
  const rawDate = row.date || row.data || row.created_at;
  if (!rawDate) return null;
  const amount = Number(row.amount ?? row.valor ?? 0);
  const rawType = normalize(row.type || row.tipo);
  const type: 'income' | 'expense' =
    rawType === 'income' || rawType === 'entrada' || rawType === 'receita' || amount > 0
      ? 'income'
      : 'expense';

  return {
    ...row,
    amount,
    type,
    date: rawDate,
    description: row.description || row.descricao || 'Lançamento',
    category: row.category || row.categoria || 'Geral',
    status: row.status || 'paid',
  } as Transaction;
}

function storedRouteIsInsights() {
  try {
    const route = JSON.parse(sessionStorage.getItem('mf-simple-route') || 'null');
    return route?.primary === 'analysis' && route?.sub === 'insights';
  } catch {
    return false;
  }
}

function findLegacyAnalysisButton(): HTMLButtonElement | null {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.mf-nav > button')).find((button) => {
    if (button.closest('#mf-simple-navigation-root') || button.closest('#mf-hierarchy-nav-host')) return false;
    return normalize(button.textContent) === 'analises';
  }) || null;
}

function patchSimpleNavigationActiveState() {
  const root = document.getElementById('mf-simple-navigation-root');
  if (!root) return;

  root.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    const label = normalize(button.textContent);
    const isAnalysis = label === 'analises';
    const isInsights = label === 'insights';
    const isPrimary = Boolean(button.closest('.mf-simple-main'));
    const isSub = Boolean(button.closest('.mf-simple-sub'));

    if ((isPrimary && isAnalysis) || (isSub && isInsights)) button.classList.add('active');
    else if ((isPrimary || isSub) && button.classList.contains('active')) button.classList.remove('active');
  });
}

function StandaloneInsights() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [visible, setVisible] = useState(storedRouteIsInsights());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [fixedBills, setFixedBills] = useState<FixedBill[]>([]);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (mounted) setUserId(data.user?.id || null);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id || null);
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const syncHost = () => {
      const content = document.querySelector<HTMLElement>('.mf-content');
      if (!content) return;
      let nextHost = content.querySelector<HTMLElement>('#mf-standalone-insights-host');
      if (!nextHost) {
        nextHost = document.createElement('div');
        nextHost.id = 'mf-standalone-insights-host';
        nextHost.style.width = '100%';
        nextHost.style.minWidth = '0';
        nextHost.style.minHeight = '0';
        nextHost.style.flex = '1';
        content.appendChild(nextHost);
      }
      setHost(nextHost);
    };

    syncHost();
    const observer = new MutationObserver(syncHost);
    observer.observe(document.body, { subtree: true, childList: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const open = () => {
      sessionStorage.setItem('mf-simple-route', JSON.stringify({ primary: 'analysis', sub: 'insights' }));
      const analysisButton = findLegacyAnalysisButton();
      if (analysisButton) analysisButton.click();
      setVisible(true);
      window.setTimeout(patchSimpleNavigationActiveState, 0);
    };

    const close = () => setVisible(false);

    const capture = (event: MouseEvent) => {
      const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('button');
      if (!button) return;

      const simpleRoot = button.closest('#mf-simple-navigation-root');
      if (simpleRoot) {
        if (normalize(button.textContent) === 'insights') {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          open();
        } else {
          close();
        }
        return;
      }

      if (button.matches('.mf-nav > button')) close();
    };

    document.addEventListener('click', capture, true);
    window.addEventListener('mf:open-insights', open as EventListener);
    window.addEventListener('mf:close-insights', close as EventListener);

    return () => {
      document.removeEventListener('click', capture, true);
      window.removeEventListener('mf:open-insights', open as EventListener);
      window.removeEventListener('mf:close-insights', close as EventListener);
    };
  }, []);

  useEffect(() => {
    const content = document.querySelector<HTMLElement>('.mf-content');
    if (!content || !host) return;

    const apply = () => {
      Array.from(content.children).forEach((child) => {
        const element = child as HTMLElement;
        if (element === host) return;
        if (visible) {
          if (element.dataset.mfInsightsPreviousDisplay === undefined) {
            element.dataset.mfInsightsPreviousDisplay = element.style.display || '';
          }
          element.style.display = 'none';
        } else if (element.dataset.mfInsightsPreviousDisplay !== undefined) {
          element.style.display = element.dataset.mfInsightsPreviousDisplay;
          delete element.dataset.mfInsightsPreviousDisplay;
        }
      });
      host.style.display = visible ? 'flex' : 'none';
      if (visible) patchSimpleNavigationActiveState();
    };

    apply();
    const observer = new MutationObserver(apply);
    observer.observe(content, { childList: true, subtree: false });
    return () => {
      observer.disconnect();
      Array.from(content.children).forEach((child) => {
        const element = child as HTMLElement;
        if (element.dataset.mfInsightsPreviousDisplay !== undefined) {
          element.style.display = element.dataset.mfInsightsPreviousDisplay;
          delete element.dataset.mfInsightsPreviousDisplay;
        }
      });
    };
  }, [visible, host]);

  async function load() {
    if (!userId || !visible) return;
    const cached = readLedgerCache(userId);
    if (cached?.rows.length) setTransactions(cached.rows);
    setLoading(true);
    setError(null);

    try {
      const [settingsResult, transactionsResult, fixedResult, cardsResult, installmentsResult] = await Promise.all([
        supabase.from('mf_user_settings').select('*').eq('user_id', userId).maybeSingle(),
        supabase.rpc('mf_get_ledger_page', {
          p_page_size: 250,
          p_cursor_date: null,
          p_cursor_created_at: null,
          p_cursor_id: null,
        }),
        supabase.from('mf_fixed_bills').select('*').eq('user_id', userId).eq('active', true),
        supabase.from('mf_credit_cards').select('*').eq('user_id', userId),
        supabase.from('mf_card_installments').select('*').eq('user_id', userId),
      ]);

      const firstError = settingsResult.error || transactionsResult.error || fixedResult.error || cardsResult.error || installmentsResult.error;
      if (firstError) throw firstError;
      if (!settingsResult.data) throw new Error('As configurações financeiras não foram encontradas.');

      const ledgerRows = Array.isArray((transactionsResult.data as any)?.items)
        ? (transactionsResult.data as any).items
        : [];
      const nextTransactions = ledgerRows
        .map(normalizeTransaction)
        .filter((item): item is Transaction => Boolean(item));
      const nextFixed = (fixedResult.data || []) as FixedBill[];
      const nextCards = (cardsResult.data || []) as CreditCard[];
      const nextInstallments = (installmentsResult.data || []).map((item: any) => ({
        ...item,
        description: item.description || item.descricao || 'Parcelamento',
        total_amount: Number(item.total_amount ?? item.valor_total ?? 0),
        monthly_amount: Number(item.monthly_amount ?? item.valor_mensal ?? 0),
        current_installment: Number(item.current_installment ?? item.parcela_atual ?? 1),
        total_installments: Number(item.total_installments ?? item.total_parcelas ?? 1),
        due_day: Number(item.due_day ?? 1),
      })) as CardInstallment[];
      const nextSettings = settingsResult.data as UserSettings;

      setTransactions(nextTransactions);
      setFixedBills(nextFixed);
      setSummary(calculateFinanceSummary(nextTransactions, nextSettings, nextFixed, nextCards, nextInstallments));
    } catch (loadError: any) {
      setError(loadError?.message || 'Não foi possível carregar os Insights.');
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [userId, visible]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`standalone-insights-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_user_settings', filter: `user_id=eq.${userId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_finance_ledger_entries', filter: `user_id=eq.${userId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_fixed_bills', filter: `user_id=eq.${userId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_credit_cards', filter: `user_id=eq.${userId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_card_installments', filter: `user_id=eq.${userId}` }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, visible]);

  const content = useMemo(() => {
    if (loading && !summary) {
      return (
        <div className="mf-direct-insights-state">
          <RefreshCcw className="animate-spin" size={24} />
          <strong>Calculando seus Insights...</strong>
        </div>
      );
    }
    if (error) {
      return (
        <div className="mf-direct-insights-state error">
          <AlertTriangle size={24} />
          <strong>{error}</strong>
          <button type="button" onClick={() => void load()}>Tentar novamente</button>
        </div>
      );
    }
    return <Insights summary={summary} transactions={transactions} fixedBills={fixedBills} />;
  }, [loading, error, summary, transactions, fixedBills]);

  if (!host || !visible) return null;

  return createPortal(
    <div className="mf-direct-insights-page">
      <style>{`
        #mf-standalone-insights-host { width:100%; min-width:0; min-height:0; }
        .mf-direct-insights-page { width:100%; min-width:0; min-height:0; flex:1; display:flex; flex-direction:column; color:white; overflow:hidden; }
        .mf-direct-insights-state { flex:1; min-height:280px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; border:1px dashed rgba(255,255,255,.12); border-radius:18px; color:rgba(255,255,255,.55); }
        .mf-direct-insights-state.error { color:#fca5a5; border-color:rgba(239,68,68,.25); }
        .mf-direct-insights-state button { border-radius:11px; padding:9px 13px; background:var(--brand-primary,#00f2ff); color:#050505; font-size:11px; font-weight:900; }
      `}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexShrink: 0 }}>
        <BrainCircuit size={18} style={{ color: 'var(--brand-primary,#00f2ff)' }} />
        <div><h2 style={{ fontSize: 18, fontWeight: 900 }}>Insights financeiros</h2><p style={{ fontSize: 10, color: 'rgba(255,255,255,.4)' }}>Análise direta dos lançamentos, saldo e compromissos ativos.</p></div>
      </div>
      {content}
    </div>,
    host,
  );
}

function mount() {
  if (document.getElementById('mf-standalone-insights-app')) return;
  const root = document.createElement('div');
  root.id = 'mf-standalone-insights-app';
  document.body.appendChild(root);
  createRoot(root).render(<StandaloneInsights />);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
else mount();

export {};
