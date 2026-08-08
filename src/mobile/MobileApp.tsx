import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { User } from '@supabase/supabase-js';
import {
  ArrowLeft,
  Camera,
  ChevronRight,
  CreditCard as CreditCardIcon,
  ExternalLink,
  Loader2,
  ReceiptText,
  ScanLine,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { format, startOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useLocation, useNavigate } from 'react-router';

import { formatCurrency } from '../lib/formatters';
import { supabase } from '../lib/supabase';
import type { CreditCard, FinancialAccount, Transaction, TransactionCategory, UserSettings } from '../types';
import MobileAppShell from './MobileAppShell';
import { MOBILE_ROUTES } from './routes';
import { openDesktopExperience } from './useMobileExperience';
import MobileQuickAdd from './pages/MobileQuickAdd';
import './mobile.css';

type PendingItem = {
  id: string;
  description: string;
  amount: number;
  due_date?: string | null;
  category?: string | null;
};

type MobileData = {
  settings: UserSettings | null;
  accounts: FinancialAccount[];
  categories: TransactionCategory[];
  cards: CreditCard[];
  recent: Transaction[];
  monthTransactions: Transaction[];
  pending: PendingItem[];
};

const EMPTY_DATA: MobileData = {
  settings: null,
  accounts: [],
  categories: [],
  cards: [],
  recent: [],
  monthTransactions: [],
  pending: [],
};

function normalizeAccount(row: any): FinancialAccount {
  return {
    ...row,
    opening_balance: Number(row.opening_balance || 0),
    current_balance: Number(row.current_balance || 0),
    transaction_count: Number(row.transaction_count || 0),
  } as FinancialAccount;
}

function normalizeTransaction(row: any): Transaction {
  return { ...row, amount: Number(row.amount || 0) } as Transaction;
}

function MobileHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mf-mobile-page-header">
      <div>
        <span className="mf-mobile-eyebrow">MF Financeiro</span>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      <div className="mf-mobile-brand-mark"><Wallet size={20} /></div>
    </header>
  );
}

function HomePage({ data }: { data: MobileData }) {
  const navigate = useNavigate();
  const balance = data.accounts.reduce((sum, account) => sum + account.current_balance, 0);
  const monthExpense = data.monthTransactions
    .filter((item) => item.type === 'expense' && !['pending', 'duplicate', 'error'].includes(String(item.status || 'paid')))
    .reduce((sum, item) => sum + Math.abs(item.amount), 0);
  const monthIncome = data.monthTransactions
    .filter((item) => item.type === 'income' && !['pending', 'duplicate', 'error'].includes(String(item.status || 'paid')))
    .reduce((sum, item) => sum + Math.abs(item.amount), 0);
  const firstName = data.settings?.display_name?.trim().split(/\s+/)[0];

  return (
    <div className="mf-mobile-page">
      <MobileHeader title={firstName ? `Olá, ${firstName}` : 'Seu dinheiro hoje'} subtitle={format(new Date(), "EEEE, d 'de' MMMM", { locale: ptBR })} />

      <section className="mf-mobile-balance-card">
        <span>Saldo disponível</span>
        <strong>{formatCurrency(balance)}</strong>
        <div className="mf-mobile-balance-meta">
          <div><small>Entradas no mês</small><b>{formatCurrency(monthIncome)}</b></div>
          <div><small>Saídas no mês</small><b>{formatCurrency(monthExpense)}</b></div>
        </div>
      </section>

      <section className="mf-mobile-quick-actions" aria-label="Ações rápidas">
        <button type="button" onClick={() => navigate(MOBILE_ROUTES.quick)}><ReceiptText size={20} /><span>Lançar</span></button>
        <button type="button" onClick={() => navigate(MOBILE_ROUTES.scan)}><ScanLine size={20} /><span>Escanear</span></button>
        <button type="button" onClick={() => navigate(MOBILE_ROUTES.cards)}><CreditCardIcon size={20} /><span>Cartões</span></button>
      </section>

      <section className="mf-mobile-section">
        <div className="mf-mobile-section-title"><div><span>Próximos compromissos</span><small>O que merece atenção</small></div></div>
        <div className="mf-mobile-list-card">
          {data.pending.length ? data.pending.slice(0, 3).map((item) => (
            <div className="mf-mobile-row" key={item.id}>
              <div className="mf-mobile-row-icon"><ReceiptText size={17} /></div>
              <div className="mf-mobile-row-main"><strong>{item.description || item.category || 'Compromisso'}</strong><small>{item.due_date ? `Vence ${new Date(`${item.due_date}T12:00:00`).toLocaleDateString('pt-BR')}` : 'Data a confirmar'}</small></div>
              <b>{formatCurrency(Math.abs(item.amount))}</b>
            </div>
          )) : <div className="mf-mobile-empty">Nenhum compromisso pendente próximo.</div>}
        </div>
      </section>

      <section className="mf-mobile-section">
        <div className="mf-mobile-section-title"><div><span>Últimas movimentações</span><small>Seu dia a dia</small></div><button type="button" onClick={() => navigate(MOBILE_ROUTES.transactions)}>Ver todas <ChevronRight size={14} /></button></div>
        <TransactionList transactions={data.recent.slice(0, 5)} />
      </section>
    </div>
  );
}

function TransactionList({ transactions }: { transactions: Transaction[] }) {
  if (!transactions.length) return <div className="mf-mobile-list-card"><div className="mf-mobile-empty">Ainda não há movimentações para mostrar.</div></div>;
  return (
    <div className="mf-mobile-list-card">
      {transactions.map((item) => {
        const income = item.type === 'income';
        return (
          <div className="mf-mobile-row" key={item.id}>
            <div className="mf-mobile-row-icon" data-kind={income ? 'income' : 'expense'}>{income ? '+' : '−'}</div>
            <div className="mf-mobile-row-main"><strong>{item.description || item.category || 'Movimentação'}</strong><small>{item.category || 'Geral'} • {new Date(`${item.date.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR')}</small></div>
            <b className={income ? 'mf-mobile-positive' : ''}>{income ? '+' : '−'} {formatCurrency(Math.abs(item.amount))}</b>
          </div>
        );
      })}
    </div>
  );
}

function TransactionsPage({ data }: { data: MobileData }) {
  return <div className="mf-mobile-page"><MobileHeader title="Movimentações" subtitle="Entradas e saídas recentes" /><TransactionList transactions={data.recent} /></div>;
}

function CardsPage({ cards }: { cards: CreditCard[] }) {
  return (
    <div className="mf-mobile-page">
      <MobileHeader title="Cartões" subtitle="Faturas e limites sem excesso de informação" />
      <div className="mf-mobile-card-stack">
        {cards.length ? cards.map((card) => {
          const used = Number(card.used || 0);
          const limit = Number(card.limit || 0);
          const usage = limit > 0 ? Math.min(100, Math.max(0, (used / limit) * 100)) : 0;
          return (
            <article className="mf-mobile-credit-card" key={card.id}>
              <div className="mf-mobile-credit-card__top"><div><small>{card.brand || 'Cartão'}</small><strong>{card.name}</strong></div><CreditCardIcon size={24} /></div>
              <div className="mf-mobile-credit-card__amount"><span>Utilizado</span><strong>{formatCurrency(used)}</strong></div>
              <div className="mf-mobile-progress"><i style={{ width: `${usage}%` }} /></div>
              <div className="mf-mobile-credit-card__meta"><div><small>Disponível</small><b>{formatCurrency(limit - used)}</b></div><div><small>Vencimento</small><b>Dia {card.due_day}</b></div></div>
            </article>
          );
        }) : <div className="mf-mobile-list-card"><div className="mf-mobile-empty">Nenhum cartão cadastrado.</div></div>}
      </div>
    </div>
  );
}

function MorePage() {
  const navigate = useNavigate();
  return (
    <div className="mf-mobile-page">
      <MobileHeader title="Mais" subtitle="Poucas ferramentas, só as que ajudam no celular" />
      <div className="mf-mobile-menu-list">
        <button type="button" onClick={() => navigate(MOBILE_ROUTES.scan)}><span className="mf-mobile-menu-icon"><Camera size={19} /></span><div><strong>MF Scan</strong><small>Capturar boleto, conta, QR ou documento</small></div><ChevronRight size={18} /></button>
        <button type="button" onClick={() => navigate(MOBILE_ROUTES.quick)}><span className="mf-mobile-menu-icon"><Sparkles size={19} /></span><div><strong>MF Quick</strong><small>Lançamento rápido em poucos toques</small></div><ChevronRight size={18} /></button>
        <button type="button" onClick={openDesktopExperience}><span className="mf-mobile-menu-icon"><ExternalLink size={19} /></span><div><strong>Abrir versão completa</strong><small>Planejamento, análises, importações e ferramentas avançadas</small></div><ChevronRight size={18} /></button>
      </div>
    </div>
  );
}

function ScanPreviewPage() {
  const navigate = useNavigate();
  return (
    <div className="mf-mobile-focus-page">
      <header className="mf-mobile-focus-header"><button type="button" className="mf-mobile-icon-button" onClick={() => navigate(-1)} aria-label="Voltar"><ArrowLeft size={21} /></button><div><span className="mf-mobile-eyebrow">MF Scan</span><h1>Captura inteligente</h1></div><span /></header>
      <section className="mf-mobile-scan-preview"><div className="mf-mobile-scan-orb"><ScanLine size={34} /></div><h2>Estrutura pronta para o scanner</h2><p>A próxima fase liga câmera, galeria, PDF, boleto e QR Pix a uma tela de revisão antes de salvar qualquer dado.</p><div className="mf-mobile-feedback success">Nada será registrado automaticamente sem sua confirmação.</div></section>
    </div>
  );
}

export default function MobileApp({ user }: { user: User }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [data, setData] = useState<MobileData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const ensured = await supabase.rpc('mf_ensure_financial_structure');
      if (ensured.error) throw ensured.error;
      const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd');
      const [settingsResult, accountsResult, categoriesResult, cardsResult, recentResult, monthResult, pendingResult] = await Promise.all([
        supabase.from('mf_user_settings').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('mf_account_balances').select('*').eq('user_id', user.id).eq('is_active', true).order('is_default', { ascending: false }).order('created_at'),
        supabase.from('mf_transaction_categories').select('*').eq('user_id', user.id).eq('is_active', true).order('sort_order').order('name'),
        supabase.from('mf_credit_cards').select('*').eq('user_id', user.id).order('name'),
        supabase.from('mf_finance_ledger_entries').select('id,user_id,account_id,category_id,amount,category,description,date,type,status,source,affects_balance').eq('user_id', user.id).order('date', { ascending: false }).order('created_at', { ascending: false }).limit(24),
        supabase.from('mf_finance_ledger_entries').select('id,user_id,amount,category,description,date,type,status,affects_balance').eq('user_id', user.id).gte('date', monthStart),
        supabase.from('mf_finance_ledger_entries').select('id,description,amount,due_date,category').eq('user_id', user.id).eq('status', 'pending').order('due_date', { ascending: true, nullsFirst: false }).limit(6),
      ]);

      const firstError = settingsResult.error || accountsResult.error || categoriesResult.error || cardsResult.error || recentResult.error || monthResult.error || pendingResult.error;
      if (firstError) throw firstError;

      setData({
        settings: settingsResult.data as UserSettings | null,
        accounts: (accountsResult.data || []).map(normalizeAccount),
        categories: (categoriesResult.data || []) as TransactionCategory[],
        cards: (cardsResult.data || []).map((row: any) => ({ ...row, limit: Number(row.limit || 0), used: Number(row.used || 0), due_day: Number(row.due_day || 1), closing_day: Number(row.closing_day || 1) })) as CreditCard[],
        recent: (recentResult.data || []).map(normalizeTransaction),
        monthTransactions: (monthResult.data || []).map(normalizeTransaction),
        pending: (pendingResult.data || []).map((row: any) => ({ ...row, amount: Number(row.amount || 0) })) as PendingItem[],
      });
    } catch (loadError: any) {
      setError(loadError?.message || 'Não foi possível carregar o MF Mobile.');
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  const page = useMemo(() => {
    const path = location.pathname.replace(/\/+$/, '') || '/app';
    if (path === MOBILE_ROUTES.quick) return 'quick';
    if (path === MOBILE_ROUTES.scan) return 'scan';
    if (path.startsWith(MOBILE_ROUTES.cards)) return 'cards';
    if (path.startsWith(MOBILE_ROUTES.transactions)) return 'transactions';
    if (path.startsWith(MOBILE_ROUTES.more)) return 'more';
    return 'home';
  }, [location.pathname]);

  if (loading) return <div className="mf-mobile-loading"><Loader2 className="animate-spin" size={30} /><span>Carregando seu MF</span></div>;
  if (error) return <div className="mf-mobile-loading"><strong>Não foi possível carregar</strong><span>{error}</span><button type="button" className="mf-mobile-primary-button" onClick={() => void refresh()}>Tentar novamente</button></div>;

  if (page === 'quick') return <MobileQuickAdd userId={user.id} accounts={data.accounts} categories={data.categories} onSaved={refresh} />;
  if (page === 'scan') return <ScanPreviewPage />;

  let content: React.ReactNode;
  if (page === 'transactions') content = <TransactionsPage data={data} />;
  else if (page === 'cards') content = <CardsPage cards={data.cards} />;
  else if (page === 'more') content = <MorePage />;
  else content = <HomePage data={data} />;

  return <MobileAppShell onQuickAction={() => navigate(MOBILE_ROUTES.quick)}>{content}</MobileAppShell>;
}
