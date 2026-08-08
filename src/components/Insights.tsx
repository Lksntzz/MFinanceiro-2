import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BrainCircuit,
  CalendarClock,
  CheckCircle2,
  Gauge,
  Lightbulb,
  ShieldCheck,
  Target,
  TrendingDown,
  TrendingUp,
  WalletCards,
} from 'lucide-react';

import {
  CardInstallment,
  CreditCard,
  FinanceSummary,
  FixedBill,
  Subscription,
  Transaction,
  UserSettings,
} from '../types';
import { supabase } from '../lib/supabase';
import { formatCurrency } from '../lib/formatters';
import { useApp } from '../context/AppContext';
import {
  buildFinancialIntelligence,
  FinancialGoalLike,
  FinancialIntelligenceResult,
  IntelligenceAlert,
} from '../lib/financial-intelligence';

interface InsightsProps {
  summary: FinanceSummary | null;
  transactions: Transaction[];
  fixedBills: FixedBill[];
}

type SupportData = {
  settings: UserSettings | null;
  cards: CreditCard[];
  installments: CardInstallment[];
  subscriptions: Subscription[];
  goals: FinancialGoalLike[];
};

const emptySupportData: SupportData = {
  settings: null,
  cards: [],
  installments: [],
  subscriptions: [],
  goals: [],
};

function alertClass(alert: IntelligenceAlert) {
  if (alert.severity === 'critical') return 'border-red-500/25 bg-red-500/[0.07] text-red-200';
  if (alert.severity === 'warning') return 'border-yellow-500/25 bg-yellow-500/[0.07] text-yellow-100';
  if (alert.severity === 'positive') return 'border-green-500/25 bg-green-500/[0.07] text-green-200';
  return 'border-cyan-500/20 bg-cyan-500/[0.05] text-cyan-100';
}

function ScenarioValue({ value, privateMode }: { value: number; privateMode: boolean }) {
  return (
    <strong className={value >= 0 ? 'text-green-400' : 'text-red-400'}>
      {formatCurrency(value, privateMode)}
    </strong>
  );
}

export default function Insights({ summary, transactions, fixedBills }: InsightsProps) {
  const { isPrivate } = useApp();
  const [support, setSupport] = useState<SupportData>(emptySupportData);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function loadSupportData() {
      try {
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;
        if (!authData.user) throw new Error('Sessão não encontrada.');
        const userId = authData.user.id;

        const [settingsResult, cardsResult, installmentsResult, subscriptionsResult, goalsResult] = await Promise.all([
          supabase.from('mf_user_settings').select('*').eq('user_id', userId).maybeSingle(),
          supabase.from('mf_credit_cards').select('*').eq('user_id', userId),
          supabase.from('mf_card_installments').select('*').eq('user_id', userId),
          supabase.from('mf_subscriptions').select('*').eq('user_id', userId),
          supabase.from('mf_financial_goals').select('id,name,target_amount,current_amount,deadline,status').eq('user_id', userId),
        ]);

        const firstError = settingsResult.error || cardsResult.error || installmentsResult.error || subscriptionsResult.error || goalsResult.error;
        if (firstError) throw firstError;
        if (!active) return;

        setSupport({
          settings: settingsResult.data as UserSettings | null,
          cards: (cardsResult.data || []).map((card: any) => ({
            ...card,
            limit: Number(card.limit || 0),
            used: Number(card.used || 0),
            closing_day: Number(card.closing_day || 1),
            due_day: Number(card.due_day || 1),
          })) as CreditCard[],
          installments: (installmentsResult.data || []).map((item: any) => ({
            ...item,
            total_amount: Number(item.total_amount ?? item.valor_total ?? 0),
            monthly_amount: Number(item.monthly_amount ?? item.valor_mensal ?? 0),
            current_installment: Number(item.current_installment ?? item.parcela_atual ?? 1),
            total_installments: Number(item.total_installments ?? item.total_parcelas ?? 1),
            due_day: Number(item.due_day || 1),
          })) as CardInstallment[],
          subscriptions: (subscriptionsResult.data || []).map((item: any) => ({
            ...item,
            amount: Number(item.amount || 0),
            due_day: Number(item.due_day || 1),
          })) as Subscription[],
          goals: (goalsResult.data || []).map((goal: any) => ({
            ...goal,
            target_amount: Number(goal.target_amount || 0),
            current_amount: Number(goal.current_amount || 0),
          })) as FinancialGoalLike[],
        });
        setLoadError(null);

        if (!channel) {
          const refresh = () => void loadSupportData();
          channel = supabase
            .channel(`financial-intelligence-${userId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_user_settings', filter: `user_id=eq.${userId}` }, refresh)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_credit_cards', filter: `user_id=eq.${userId}` }, refresh)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_card_installments', filter: `user_id=eq.${userId}` }, refresh)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_subscriptions', filter: `user_id=eq.${userId}` }, refresh)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_financial_goals', filter: `user_id=eq.${userId}` }, refresh)
            .subscribe();
        }
      } catch (error) {
        if (active) setLoadError(error instanceof Error ? error.message : 'Não foi possível carregar os dados da inteligência financeira.');
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadSupportData();
    return () => {
      active = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, []);

  const intelligence = useMemo<FinancialIntelligenceResult | null>(() => {
    if (!summary) return null;
    try {
      return buildFinancialIntelligence({
        currentBalance: Number(summary.currentBalance || 0),
        transactions,
        settings: support.settings,
        fixedBills,
        cards: support.cards,
        installments: support.installments,
        subscriptions: support.subscriptions,
        goals: support.goals,
      });
    } catch (error) {
      console.error('Falha ao calcular inteligência financeira:', error);
      return null;
    }
  }, [summary, transactions, fixedBills, support]);

  if (!summary) {
    return <div className="flex flex-1 items-center justify-center text-xs text-white/35">Carregando resumo financeiro...</div>;
  }

  if (loading && !intelligence) {
    return <div className="flex flex-1 items-center justify-center text-xs text-white/35">Calculando cenários financeiros...</div>;
  }

  if (!intelligence) {
    return (
      <div className="glass-card m-4 !p-5 text-sm text-white/60">
        Não foi possível gerar os cenários financeiros agora. {loadError || 'Atualize a página e tente novamente.'}
      </div>
    );
  }

  const criticalCount = intelligence.alerts.filter((alert) => alert.severity === 'critical').length;
  const warningCount = intelligence.alerts.filter((alert) => alert.severity === 'warning').length;
  const highestProjection = intelligence.projections[2];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1 animate-fade-in [&>*]:shrink-0">
      <section className="glass-card relative overflow-hidden !p-5 border-brand-primary/20 bg-brand-primary/[0.05]">
        <BrainCircuit className="absolute -right-3 -top-3 text-brand-primary/10" size={110} aria-hidden="true" />
        <div className="relative z-10 flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="rounded-2xl bg-brand-primary/15 p-3 text-brand-primary"><BrainCircuit size={22} /></div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-black">Inteligência financeira</h2>
                <span className="rounded-full border border-brand-primary/20 bg-brand-primary/10 px-2 py-1 text-[8px] font-black uppercase tracking-wider text-brand-primary">projeção v2</span>
              </div>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-white/50">
                Cenários determinísticos usando saldo consolidado, histórico real, renda, compromissos, cartões, parcelas, assinaturas e metas cadastradas.
              </p>
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-right">
            <div className="text-[8px] font-black uppercase tracking-[0.18em] text-white/30">Confiança</div>
            <strong className="mt-1 block text-lg text-brand-primary">{Math.round(intelligence.confidence * 100)}%</strong>
            <span className="text-[9px] uppercase text-white/35">{intelligence.confidenceLabel} · {intelligence.historyDays} dias</span>
          </div>
        </div>

        <div className="relative z-10 mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric icon={WalletCards} label="Folga mensal" value={formatCurrency(intelligence.monthlyFreeCash, isPrivate)} state={intelligence.monthlyFreeCash >= 0 ? 'positive' : 'danger'} />
          <Metric icon={Gauge} label="Gasto diário seguro" value={formatCurrency(intelligence.safeDailySpend, isPrivate)} />
          <Metric icon={ShieldCheck} label="Reserva alvo (3 meses)" value={formatCurrency(intelligence.emergencyReserveTarget, isPrivate)} />
          <Metric icon={Target} label="Metas pedem / mês" value={formatCurrency(intelligence.goalMonthlyNeed, isPrivate)} />
        </div>
      </section>

      {loadError && (
        <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/[0.06] px-4 py-3 text-xs text-yellow-100">
          Alguns dados auxiliares não puderam ser atualizados: {loadError}. A projeção usa o que já está disponível.
        </div>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-white/45"><CalendarClock size={15} /> Cenários 30 / 60 / 90 dias</h3>
          <span className="text-[9px] text-white/30">Conservador: +20% em gasto variável e -5% em renda prevista</span>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          {intelligence.projections.map((projection) => (
            <article key={projection.horizonDays} className="glass-card !p-4">
              <div className="flex items-center justify-between gap-3">
                <div><div className="text-[9px] font-black uppercase tracking-widest text-white/35">Horizonte</div><h4 className="mt-1 text-lg font-black">{projection.horizonDays} dias</h4></div>
                <div className={`rounded-xl px-2.5 py-1 text-[9px] font-black ${projection.base >= 0 ? 'bg-green-500/10 text-green-300' : 'bg-red-500/10 text-red-300'}`}>{projection.base >= 0 ? 'POSITIVO' : 'RISCO'}</div>
              </div>
              <div className="mt-4 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-3"><span className="text-white/40">Conservador</span><ScenarioValue value={projection.conservative} privateMode={isPrivate} /></div>
                <div className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.04] px-2 py-2"><span className="font-bold text-white/65">Base</span><ScenarioValue value={projection.base} privateMode={isPrivate} /></div>
                <div className="flex items-center justify-between gap-3"><span className="text-white/40">Otimista</span><ScenarioValue value={projection.optimistic} privateMode={isPrivate} /></div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,.8fr)]">
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-white/45"><AlertTriangle size={15} /> Alertas inteligentes</h3>
            <span className={`rounded-full px-2 py-1 text-[9px] font-bold ${criticalCount ? 'bg-red-500/10 text-red-300' : warningCount ? 'bg-yellow-500/10 text-yellow-200' : 'bg-green-500/10 text-green-300'}`}>
              {criticalCount ? `${criticalCount} crítico(s)` : warningCount ? `${warningCount} atenção` : 'sem risco relevante'}
            </span>
          </div>
          <div className="grid gap-2.5">
            {intelligence.alerts.map((alert) => (
              <article key={alert.id} className={`rounded-2xl border p-4 ${alertClass(alert)}`}>
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 shrink-0">{alert.severity === 'positive' ? <CheckCircle2 size={17} /> : alert.severity === 'critical' ? <AlertTriangle size={17} /> : <Lightbulb size={17} />}</div>
                  <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-bold">{alert.title}</h4>
                    <p className="mt-1 text-xs leading-relaxed text-white/60">{alert.message}</p>
                    {alert.action && <p className="mt-2 text-[9px] font-bold uppercase tracking-wider text-white/40">Próxima ação: {alert.action}</p>}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-white/45"><Lightbulb size={15} /> Leitura do fluxo</h3>
          <div className="glass-card !p-4 space-y-3">
            {intelligence.narrative.map((line) => <p key={line} className="text-xs leading-relaxed text-white/60">{line}</p>)}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <MiniMetric label="Compromissos / renda" value={intelligence.commitmentIncomeShare == null ? 'Renda não informada' : `${(intelligence.commitmentIncomeShare * 100).toFixed(1)}%`} danger={(intelligence.commitmentIncomeShare || 0) >= 0.7} />
            <MiniMetric label="Assinaturas / renda" value={intelligence.subscriptionIncomeShare == null ? 'Renda não informada' : `${(intelligence.subscriptionIncomeShare * 100).toFixed(1)}%`} danger={(intelligence.subscriptionIncomeShare || 0) >= 0.15} />
            <MiniMetric label="Tendência de gastos" value={intelligence.expenseTrendPercent == null ? 'Base insuficiente' : `${intelligence.expenseTrendPercent >= 0 ? '+' : ''}${intelligence.expenseTrendPercent.toFixed(1)}%`} danger={(intelligence.expenseTrendPercent || 0) >= 15} />
            <MiniMetric label="Fôlego pelo ritmo variável" value={intelligence.cashRunwayDays == null ? 'Sem base suficiente' : `${intelligence.cashRunwayDays} dias`} danger={intelligence.cashRunwayDays != null && intelligence.cashRunwayDays < 15} />
          </div>
        </section>
      </div>

      <section className="glass-card !p-4 border-white/5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold"><TrendingUp size={16} /> Visão de 90 dias</h3>
            <p className="mt-1 text-[10px] text-white/40">A projeção é uma estimativa baseada nos dados cadastrados e no comportamento observado; não é garantia de saldo futuro.</p>
          </div>
          <div className="text-right">
            <div className="text-[9px] uppercase tracking-widest text-white/30">Cenário base</div>
            <ScenarioValue value={highestProjection.base} privateMode={isPrivate} />
          </div>
        </div>
        {intelligence.earliestRiskDate && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/[0.05] px-3 py-2 text-xs text-red-200">
            <TrendingDown size={14} /> Primeiro ponto de saldo negativo no cenário base: {new Date(`${intelligence.earliestRiskDate}T12:00:00`).toLocaleDateString('pt-BR')}.
          </div>
        )}
      </section>

      <section className="space-y-2 pb-2">
        <h3 className="text-[10px] font-black uppercase tracking-[0.16em] text-white/30">Prioridades do ciclo atual</h3>
        <div className="grid gap-2 md:grid-cols-2">
          {(summary.priorities || []).slice(0, 6).map((priority) => (
            <div key={priority.id} className="rounded-xl border border-white/8 bg-white/[0.025] p-3">
              <div className="text-xs font-bold">{priority.title}</div>
              <div className="mt-1 text-[10px] text-white/45">{priority.message}</div>
            </div>
          ))}
          {(summary.priorities || []).length === 0 && <div className="text-xs text-white/35">Nenhuma prioridade pendente no ciclo atual.</div>}
        </div>
      </section>
    </div>
  );
}

function Metric({ icon: Icon, label, value, state }: { icon: React.ComponentType<{ size?: number }>; label: string; value: string; state?: 'positive' | 'danger' }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-black/15 p-3">
      <div className="flex items-center justify-between gap-2 text-white/35"><span className="text-[8px] font-black uppercase tracking-widest">{label}</span><Icon size={14} /></div>
      <strong className={`mt-2 block truncate text-sm ${state === 'positive' ? 'text-green-400' : state === 'danger' ? 'text-red-400' : 'text-white'}`}>{value}</strong>
    </div>
  );
}

function MiniMetric({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="glass-card !p-3">
      <div className="text-[8px] font-black uppercase tracking-widest text-white/30">{label}</div>
      <strong className={`mt-1 block text-sm ${danger ? 'text-red-300' : 'text-white/75'}`}>{value}</strong>
    </div>
  );
}
