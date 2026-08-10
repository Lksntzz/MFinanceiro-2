import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  CircleDollarSign,
  ListChecks,
  ReceiptText,
  Sparkles,
  Target,
  TrendingUp,
  Wallet,
} from 'lucide-react';

import { supabase } from './supabase';

const WEB_MEDIA_QUERY = '(min-width: 821px)';
const ROOT_ID = 'mf-web-product-orchestrator-root';
const HOST_ID = 'mf-web-product-guide-host';

type FinancialContext = {
  settings: Record<string, any> | null;
  accounts: Record<string, any>[];
  categories: Record<string, any>[];
  fixedBills: Record<string, any>[];
  subscriptions: Record<string, any>[];
  cards: Record<string, any>[];
  installments: Record<string, any>[];
  budgets: Record<string, any>[];
  goals: Record<string, any>[];
  investments: Record<string, any>[];
  transactionCount: number;
};

type GuideAction = {
  label: string;
  path: string;
};

type RouteGuide = {
  eyebrow: string;
  title: string;
  description: string;
  action?: GuideAction;
  links?: GuideAction[];
};

type PlanningCheck = {
  id: string;
  label: string;
  done: boolean;
  path: string;
};

const EMPTY_CONTEXT: FinancialContext = {
  settings: null,
  accounts: [],
  categories: [],
  fixedBills: [],
  subscriptions: [],
  cards: [],
  installments: [],
  budgets: [],
  goals: [],
  investments: [],
  transactionCount: 0,
};

const watchedTables = [
  'mf_financial_accounts',
  'mf_transaction_categories',
  'mf_budgets',
  'mf_fixed_bills',
  'mf_subscriptions',
  'mf_credit_cards',
  'mf_card_installments',
  'mf_financial_goals',
  'mf_finance_ledger_entries',
] as const;

function normalizePathname(pathname: string) {
  const normalized = pathname.replace(/\/+$/, '');
  return normalized || '/';
}

function navigateTo(path: string) {
  if (window.location.pathname === path) return;
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function isActiveSubscription(row: Record<string, any>) {
  const status = String(row.status || '').toLowerCase();
  return !['inactive', 'cancelled', 'canceled'].includes(status);
}

function eventFeedback(table: string, eventType: string) {
  const event = String(eventType || '').toUpperCase();
  if (table === 'mf_finance_ledger_entries') {
    if (event === 'INSERT') return 'Movimentações atualizadas.';
    if (event === 'DELETE') return 'Movimentação removida.';
    return 'Movimentação atualizada.';
  }
  if (table === 'mf_financial_accounts') {
    if (event === 'INSERT') return 'Conta financeira adicionada.';
    if (event === 'DELETE') return 'Conta financeira removida.';
    return 'Conta financeira atualizada.';
  }
  if (table === 'mf_transaction_categories') return 'Categorias atualizadas.';
  if (table === 'mf_budgets') return 'Orçamento atualizado.';
  if (table === 'mf_fixed_bills') return 'Recorrências atualizadas.';
  if (table === 'mf_subscriptions') return 'Assinaturas atualizadas.';
  if (table === 'mf_credit_cards') return 'Cartões atualizados.';
  if (table === 'mf_card_installments') return 'Parcelas atualizadas.';
  if (table === 'mf_financial_goals') return 'Metas atualizadas.';
  return 'Dados financeiros atualizados.';
}

function getPrimaryWorkspace(pathname: string): HTMLElement | null {
  if (pathname === '/app') {
    return document.querySelector('.mf-dashboard-grid .mf-alert-grid') as HTMLElement | null;
  }

  const routed = document.querySelector('.mf-content > .space-y-4') as HTMLElement | null;
  if (routed) return routed;

  const tabbed = document.querySelector('.mf-content .mf-tab-shell > .space-y-4') as HTMLElement | null;
  if (tabbed) return tabbed;

  if (pathname.startsWith('/app/movimentacoes')) {
    return document.querySelector('.mf-content .history-shell') as HTMLElement | null;
  }

  return document.querySelector('.mf-content .mf-tab-shell, .mf-content') as HTMLElement | null;
}

function polishHomeLabels() {
  document.querySelectorAll('.mf-dashboard-grid .mf-kpi span').forEach((element) => {
    const text = element.textContent?.trim();
    if (text === 'Saldo derivado') element.textContent = 'Saldo atual';
    if (text === 'Limite') element.textContent = 'Limite diário';
  });
}

function WebProductOrchestrator() {
  const [enabled, setEnabled] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [pathname, setPathname] = useState(() => normalizePathname(window.location.pathname));
  const [context, setContext] = useState<FinancialContext>(EMPTY_CONTEXT);
  const [contextLoaded, setContextLoaded] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const lastToastAtRef = useRef(0);
  const refreshTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const media = window.matchMedia(WEB_MEDIA_QUERY);
    let active = true;

    const refresh = async () => {
      const web = media.matches;
      setEnabled(web);
      if (!web) {
        setUserId(null);
        return;
      }
      const { data } = await supabase.auth.getUser();
      if (!active) return;
      setUserId(data.user?.id || null);
    };

    void refresh();
    const onMediaChange = () => void refresh();
    media.addEventListener('change', onMediaChange);

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active || !media.matches) return;
      setUserId(session?.user?.id || null);
    });

    return () => {
      active = false;
      media.removeEventListener('change', onMediaChange);
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let current = normalizePathname(window.location.pathname);
    const sync = () => {
      const next = normalizePathname(window.location.pathname);
      if (next !== current) {
        current = next;
        setPathname(next);
      }
    };
    const interval = window.setInterval(sync, 300);
    window.addEventListener('popstate', sync);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('popstate', sync);
    };
  }, []);

  const loadContext = useCallback(async () => {
    if (!enabled || !userId) return;

    const [
      settingsResult,
      accountsResult,
      categoriesResult,
      fixedResult,
      subscriptionsResult,
      cardsResult,
      installmentsResult,
      budgetsResult,
      goalsResult,
      investmentsResult,
      ledgerResult,
    ] = await Promise.all([
      supabase.from('mf_user_settings').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('mf_account_balances').select('*').eq('user_id', userId).order('is_default', { ascending: false }),
      supabase.from('mf_transaction_categories').select('*').eq('user_id', userId).order('sort_order').order('name'),
      supabase.from('mf_fixed_bills').select('*').eq('user_id', userId),
      supabase.from('mf_subscriptions').select('*').eq('user_id', userId),
      supabase.from('mf_credit_cards').select('*').eq('user_id', userId),
      supabase.from('mf_card_installments').select('*').eq('user_id', userId),
      supabase.from('mf_budgets').select('*').eq('user_id', userId),
      supabase.from('mf_financial_goals').select('*').eq('user_id', userId),
      supabase.from('mf_investments').select('id,user_id').eq('user_id', userId),
      supabase.from('mf_finance_ledger_entries').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    ]);

    setContext({
      settings: (settingsResult.data as Record<string, any> | null) || null,
      accounts: (accountsResult.data || []) as Record<string, any>[],
      categories: (categoriesResult.data || []) as Record<string, any>[],
      fixedBills: (fixedResult.data || []) as Record<string, any>[],
      subscriptions: (subscriptionsResult.data || []) as Record<string, any>[],
      cards: (cardsResult.data || []) as Record<string, any>[],
      installments: (installmentsResult.data || []) as Record<string, any>[],
      budgets: (budgetsResult.data || []) as Record<string, any>[],
      goals: (goalsResult.data || []) as Record<string, any>[],
      investments: (investmentsResult.data || []) as Record<string, any>[],
      transactionCount: Number(ledgerResult.count || 0),
    });
    setContextLoaded(true);
  }, [enabled, userId]);

  useEffect(() => {
    if (!enabled || !userId) {
      setContext(EMPTY_CONTEXT);
      setContextLoaded(false);
      return;
    }

    void loadContext();

    const scheduleRefresh = () => {
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = window.setTimeout(() => void loadContext(), 250);
    };

    const showFeedback = (message: string) => {
      const now = Date.now();
      if (now - lastToastAtRef.current < 1100) return;
      lastToastAtRef.current = now;
      setToast(message);
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = window.setTimeout(() => setToast(null), 3200);
    };

    let channel = supabase.channel(`web-product-orchestrator-${userId}`);
    watchedTables.forEach((table) => {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `user_id=eq.${userId}` },
        (payload: any) => {
          scheduleRefresh();
          showFeedback(eventFeedback(table, payload.eventType));
        },
      );
    });
    channel.subscribe();

    return () => {
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      void supabase.removeChannel(channel);
    };
  }, [enabled, userId, loadContext]);

  const activeAccounts = useMemo(
    () => context.accounts.filter((account) => account.is_active !== false),
    [context.accounts],
  );
  const expectedIncome = Number(context.settings?.net_salary_estimated || context.settings?.gross_salary || 0);
  const pendingFixed = context.fixedBills.filter((bill) => bill.active !== false && String(bill.status || 'pending') !== 'paid');
  const activeSubscriptions = context.subscriptions.filter(isActiveSubscription);
  const cardsWithBalance = context.cards.filter((card) => Number(card.used || 0) > 0);
  const activeInstallments = context.installments.filter((item) => Number(item.current_installment || 1) <= Number(item.total_installments || 1));
  const datedCommitmentCount = pendingFixed.length + activeSubscriptions.length + cardsWithBalance.length + activeInstallments.length;

  const planningChecks = useMemo<PlanningCheck[]>(() => [
    { id: 'accounts', label: 'Conta', done: activeAccounts.length > 0, path: '/app/planejamento/contas' },
    { id: 'income', label: 'Receita', done: expectedIncome > 0, path: '/app/agenda/receitas' },
    { id: 'commitments', label: 'Compromissos', done: datedCommitmentCount > 0, path: '/app/agenda/recorrencias' },
    { id: 'budget', label: 'Orçamento', done: context.budgets.length > 0, path: '/app/planejamento/orcamento' },
  ], [activeAccounts.length, context.budgets.length, datedCommitmentCount, expectedIncome]);

  const nextPlanningCheck = planningChecks.find((item) => !item.done) || null;
  const planningDone = planningChecks.filter((item) => item.done).length;
  const planningPercent = Math.round((planningDone / planningChecks.length) * 100);

  const homeAction = useMemo<RouteGuide>(() => {
    if (activeAccounts.length === 0) {
      return {
        eyebrow: 'Próxima ação',
        title: 'Defina onde seu dinheiro está',
        description: 'Cadastre uma conta real para o MF consolidar saldo, planejamento e movimentações no mesmo contexto.',
        action: { label: 'Configurar conta', path: '/app/planejamento/contas' },
      };
    }
    if (context.transactionCount === 0) {
      return {
        eyebrow: 'Próxima ação',
        title: 'Registre o primeiro movimento',
        description: 'Uma entrada ou saída já permite que a Início, o histórico e os Insights comecem a trabalhar com dados reais.',
        action: { label: 'Fazer lançamento', path: '/app/lancar' },
      };
    }
    if (expectedIncome <= 0) {
      return {
        eyebrow: 'Próxima ação',
        title: 'Informe sua receita prevista',
        description: 'Com a renda esperada, o MF consegue comparar compromissos, orçamento e projeção do mês com mais contexto.',
        action: { label: 'Configurar receita', path: '/app/agenda/receitas' },
      };
    }
    if (datedCommitmentCount === 0) {
      return {
        eyebrow: 'Próxima ação',
        title: 'Antecipe o que tem data',
        description: 'Cadastre contas recorrentes ou assinaturas para transformar a Agenda em uma visão real do que vem pela frente.',
        action: { label: 'Adicionar recorrência', path: '/app/agenda/recorrencias' },
      };
    }
    if (context.budgets.length === 0) {
      return {
        eyebrow: 'Próxima ação',
        title: 'Defina um limite por categoria',
        description: 'O orçamento conecta seus gastos reais ao que você pretende gastar durante o mês.',
        action: { label: 'Criar orçamento', path: '/app/planejamento/orcamento' },
      };
    }
    if (pendingFixed.length + cardsWithBalance.length > 0) {
      return {
        eyebrow: 'Próxima ação',
        title: 'Veja os próximos compromissos',
        description: `Há ${pendingFixed.length + cardsWithBalance.length} compromisso(s) financeiro(s) que merecem acompanhamento no calendário.`,
        action: { label: 'Abrir Agenda', path: '/app/agenda' },
      };
    }
    return {
      eyebrow: 'Próxima ação',
      title: 'Leia o que seus números estão dizendo',
      description: 'Sua estrutura essencial está configurada. Use os Insights para interpretar tendências, alertas e cenários.',
      action: { label: 'Ver Insights', path: '/app/analises/insights' },
    };
  }, [activeAccounts.length, cardsWithBalance.length, context.budgets.length, context.transactionCount, datedCommitmentCount, expectedIncome, pendingFixed.length]);

  const routeGuide = useMemo<RouteGuide | null>(() => {
    if (!contextLoaded) return null;
    if (pathname === '/app') return homeAction;

    if (pathname.startsWith('/app/movimentacoes') && context.transactionCount === 0) {
      return {
        eyebrow: 'Comece por aqui',
        title: 'Seu histórico ainda está vazio',
        description: 'Registre uma entrada ou saída, ou importe um extrato. A partir daí, Agenda, Planejamento e Insights ganham contexto real.',
        action: { label: 'Fazer primeiro lançamento', path: '/app/lancar' },
        links: [{ label: 'Importar extrato', path: '/app/movimentacoes/importar' }],
      };
    }

    if (pathname === '/app/agenda' && datedCommitmentCount === 0 && expectedIncome <= 0) {
      return {
        eyebrow: 'Agenda Financeira',
        title: 'Sua agenda ainda não tem datas financeiras',
        description: 'Adicione uma recorrência ou uma receita prevista para o MF mostrar o que pode impactar seu dinheiro ao longo do mês.',
        action: { label: 'Adicionar recorrência', path: '/app/agenda/recorrencias' },
        links: [{ label: 'Configurar receita', path: '/app/agenda/receitas' }],
      };
    }

    if (pathname.startsWith('/app/analises/insights') && context.transactionCount < 3) {
      return {
        eyebrow: 'Insights',
        title: 'Mais histórico, leituras mais úteis',
        description: 'Os Insights já funcionam com os dados disponíveis, mas ficam mais relevantes conforme você registra ou importa seu histórico financeiro.',
        action: { label: 'Registrar movimentação', path: '/app/lancar' },
        links: [{ label: 'Importar extrato', path: '/app/movimentacoes/importar' }],
      };
    }

    if (pathname.startsWith('/app/investimentos') && context.investments.length === 0) {
      return {
        eyebrow: 'Investimentos',
        title: 'Sua carteira começa com o primeiro ativo',
        description: 'Cadastre seu primeiro investimento na carteira abaixo. O patrimônio investido continuará separado do saldo operacional.',
        links: [{ label: 'Ver Planejamento', path: '/app/planejamento' }],
      };
    }

    return null;
  }, [context.investments.length, context.transactionCount, contextLoaded, datedCommitmentCount, expectedIncome, homeAction, pathname]);

  const isPlanningRoute = pathname.startsWith('/app/planejamento');
  const shouldShowGuide = pathname === '/app' || isPlanningRoute || Boolean(routeGuide);
  const guideSignature = `${pathname}:${isPlanningRoute ? `planning-${planningDone}` : routeGuide?.title || 'none'}`;

  useEffect(() => {
    if (!enabled || !userId || !shouldShowGuide) {
      setHost(null);
      return;
    }

    let attempts = 0;
    let previousInsight: HTMLElement | null = null;
    let createdHost: HTMLElement | null = null;

    const mount = () => {
      const target = getPrimaryWorkspace(pathname);
      if (!target) {
        attempts += 1;
        if (attempts < 30) window.setTimeout(mount, 120);
        return;
      }

      document.getElementById(HOST_ID)?.remove();
      createdHost = document.createElement('div');
      createdHost.id = HOST_ID;
      createdHost.className = pathname === '/app' ? 'mf-web-guide-host mf-web-guide-host-home' : 'mf-web-guide-host';

      if (pathname === '/app') {
        previousInsight = target.querySelector('.mf-alert.insight') as HTMLElement | null;
        if (previousInsight) {
          previousInsight.dataset.mfWebSuppressed = 'true';
          previousInsight.style.display = 'none';
          target.insertBefore(createdHost, previousInsight);
        } else {
          target.appendChild(createdHost);
        }
        polishHomeLabels();
      } else if (target.firstElementChild) {
        target.insertBefore(createdHost, target.firstElementChild.nextSibling);
      } else {
        target.appendChild(createdHost);
      }

      setHost(createdHost);
    };

    const timer = window.setTimeout(mount, 80);
    return () => {
      window.clearTimeout(timer);
      if (createdHost?.isConnected) createdHost.remove();
      if (previousInsight?.dataset.mfWebSuppressed === 'true') {
        previousInsight.style.display = '';
        delete previousInsight.dataset.mfWebSuppressed;
      }
      setHost(null);
    };
  }, [enabled, guideSignature, pathname, shouldShowGuide, userId]);

  useEffect(() => {
    if (!enabled || pathname !== '/app') return;
    const timers = [100, 500, 1200].map((delay) => window.setTimeout(polishHomeLabels, delay));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [enabled, pathname, contextLoaded]);

  const portal = host ? createPortal(
    pathname === '/app' ? (
      <HomeNextAction guide={homeAction} />
    ) : isPlanningRoute ? (
      <PlanningJourney
        checks={planningChecks}
        done={planningDone}
        percent={planningPercent}
        next={nextPlanningCheck}
      />
    ) : routeGuide ? (
      <ContextGuide guide={routeGuide} />
    ) : null,
    host,
  ) : null;

  if (!enabled || !userId || !pathname.startsWith('/app')) return null;

  return (
    <>
      {portal}
      {toast && (
        <div className="mf-web-feedback-toast" role="status" aria-live="polite">
          <CheckCircle2 size={16} />
          <span>{toast}</span>
        </div>
      )}
    </>
  );
}

function HomeNextAction({ guide }: { guide: RouteGuide }) {
  return (
    <article className="mf-card mf-alert mf-web-next-action-card">
      <Sparkles size={18} />
      <div className="mf-web-next-action-copy">
        <span className="mf-web-guide-eyebrow">{guide.eyebrow}</span>
        <strong>{guide.title}</strong>
        <p>{guide.description}</p>
      </div>
      {guide.action && (
        <button type="button" className="mf-web-guide-primary compact" onClick={() => navigateTo(guide.action!.path)}>
          {guide.action.label}<ArrowRight size={13} />
        </button>
      )}
    </article>
  );
}

function PlanningJourney({ checks, done, percent, next }: { checks: PlanningCheck[]; done: number; percent: number; next: PlanningCheck | null }) {
  return (
    <section className="mf-web-planning-journey" aria-label="Progresso do planejamento">
      <div className="mf-web-planning-copy">
        <div className="mf-web-guide-icon"><Target size={18} /></div>
        <div>
          <span className="mf-web-guide-eyebrow">Planejamento do mês</span>
          <h3>{next ? `${done} de ${checks.length} bases configuradas` : 'Base do planejamento configurada'}</h3>
          <p>{next ? 'Complete a próxima base para o MF conectar melhor saldo, datas, orçamento e projeções.' : 'Sua estrutura essencial está pronta. Agora use o Simulador para testar decisões sem alterar lançamentos reais.'}</p>
        </div>
      </div>

      <div className="mf-web-planning-progress" aria-label={`${percent}% configurado`}>
        <i style={{ width: `${percent}%` }} />
      </div>

      <div className="mf-web-planning-checks">
        {checks.map((item) => (
          <button key={item.id} type="button" className={item.done ? 'done' : ''} onClick={() => navigateTo(item.path)}>
            <span>{item.done ? <Check size={12} /> : <span className="mf-web-check-dot" />}</span>
            {item.label}
          </button>
        ))}
      </div>

      <div className="mf-web-planning-actions">
        <span>Conecta com <button type="button" onClick={() => navigateTo('/app/agenda')}>Agenda</button> e <button type="button" onClick={() => navigateTo('/app/analises/insights')}>Insights</button></span>
        <button type="button" className="mf-web-guide-primary" onClick={() => navigateTo(next?.path || '/app/planejamento/simulador')}>
          {next ? `Configurar ${next.label.toLowerCase()}` : 'Abrir Simulador'}<ArrowRight size={14} />
        </button>
      </div>
    </section>
  );
}

function ContextGuide({ guide }: { guide: RouteGuide }) {
  const Icon = guide.eyebrow === 'Agenda Financeira'
    ? CalendarDays
    : guide.eyebrow === 'Insights'
      ? TrendingUp
      : guide.eyebrow === 'Investimentos'
        ? CircleDollarSign
        : guide.eyebrow === 'Comece por aqui'
          ? ReceiptText
          : ListChecks;

  return (
    <section className="mf-web-context-guide">
      <div className="mf-web-guide-icon"><Icon size={18} /></div>
      <div className="mf-web-context-copy">
        <span className="mf-web-guide-eyebrow">{guide.eyebrow}</span>
        <h3>{guide.title}</h3>
        <p>{guide.description}</p>
      </div>
      <div className="mf-web-context-actions">
        {guide.links?.map((link) => (
          <button key={link.path} type="button" className="mf-web-guide-secondary" onClick={() => navigateTo(link.path)}>{link.label}</button>
        ))}
        {guide.action && (
          <button type="button" className="mf-web-guide-primary" onClick={() => navigateTo(guide.action!.path)}>
            {guide.action.label}<ArrowRight size={14} />
          </button>
        )}
      </div>
    </section>
  );
}

if (typeof document !== 'undefined' && !document.getElementById(ROOT_ID)) {
  const rootElement = document.createElement('div');
  rootElement.id = ROOT_ID;
  document.body.appendChild(rootElement);
  createRoot(rootElement).render(<WebProductOrchestrator />);
}
