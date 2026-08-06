import React, { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Lightbulb,
  TrendingDown,
} from 'lucide-react';

import { FinanceSummary, FixedBill, Transaction } from '../types';
import { supabase } from '../lib/supabase';
import { getPredictiveAnalysis } from '../services/investmentIntelligence';

interface InsightsProps {
  summary: FinanceSummary | null;
  transactions: Transaction[];
  fixedBills: FixedBill[];
}

function dateKey(raw: string): string {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function Insights({ summary, transactions, fixedBills }: InsightsProps) {
  const [prediction, setPrediction] = useState('');
  const [loadingPrediction, setLoadingPrediction] = useState(false);
  const [actualBalance, setActualBalance] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function loadActualBalance() {
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData.user?.id;
      if (!userId || !active) return;

      const refreshBalance = async () => {
        const { data, error } = await supabase
          .from('mf_user_settings')
          .select('current_balance')
          .eq('user_id', userId)
          .maybeSingle();

        if (!error && active) {
          const value = Number(data?.current_balance ?? 0);
          setActualBalance(Number.isFinite(value) ? value : 0);
        }
      };

      await refreshBalance();

      channel = supabase
        .channel(`financial-insights-balance-${userId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'mf_user_settings',
            filter: `user_id=eq.${userId}`,
          },
          refreshBalance,
        )
        .subscribe();
    }

    void loadActualBalance();

    return () => {
      active = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  const balanceForAnalysis = actualBalance ?? Number(summary?.currentBalance || 0);

  useEffect(() => {
    let active = true;

    async function calculatePrediction() {
      if (!summary || transactions.length === 0) {
        setPrediction('Cadastre ou importe lançamentos para gerar uma projeção financeira local.');
        return;
      }

      setLoadingPrediction(true);
      try {
        const text = await getPredictiveAnalysis(
          transactions,
          balanceForAnalysis,
          fixedBills,
        );
        if (active) setPrediction(text);
      } catch (error) {
        console.error('Falha na projeção local:', error);
        if (active) setPrediction('Não foi possível calcular a projeção com os dados disponíveis.');
      } finally {
        if (active) setLoadingPrediction(false);
      }
    }

    void calculatePrediction();
    return () => {
      active = false;
    };
  }, [summary, transactions, fixedBills, balanceForAnalysis]);

  const recentControl = useMemo(() => {
    const dailyLimit = Number(summary?.dailyLimit || 0);
    const validDates = transactions
      .map((transaction) => new Date(transaction.date))
      .filter((date) => !Number.isNaN(date.getTime()))
      .sort((a, b) => b.getTime() - a.getTime());

    const anchor = validDates[0] || new Date();
    const expensesByDay = new Map<string, number>();

    transactions
      .filter((transaction) => transaction.type === 'expense')
      .forEach((transaction) => {
        const key = dateKey(transaction.date);
        if (!key) return;
        expensesByDay.set(key, (expensesByDay.get(key) || 0) + Math.abs(Number(transaction.amount) || 0));
      });

    let controlledDays = 0;
    let observedDays = 0;
    for (let offset = 0; offset < 7; offset += 1) {
      const date = new Date(anchor);
      date.setDate(anchor.getDate() - offset);
      const key = dateKey(date.toISOString());
      const spent = expensesByDay.get(key) || 0;

      if (spent > 0) {
        observedDays += 1;
        if (dailyLimit > 0 && spent <= dailyLimit) controlledDays += 1;
      }
    }

    if (dailyLimit <= 0) {
      return 'O saldo livre está zerado ou negativo; não há limite diário seguro disponível.';
    }
    if (observedDays === 0) {
      return 'Não há gastos recentes suficientes para avaliar os últimos sete dias.';
    }
    return `${controlledDays} dos ${observedDays} dias com gastos ficaram dentro do limite diário calculado.`;
  }, [transactions, summary?.dailyLimit]);

  const scenarioBalance = useMemo(() => {
    if (!summary) return 0;

    const pendingFixed = fixedBills
      .filter((bill) => String(bill.status || 'pending').toLowerCase() !== 'paid')
      .reduce((sum, bill) => sum + Math.abs(Number(bill.amount) || 0), 0);
    const projectedVariableSpending = Number(summary.averageDailySpent || 0) * Number(summary.daysRemaining || 0);

    return balanceForAnalysis - pendingFixed - projectedVariableSpending;
  }, [summary, fixedBills, balanceForAnalysis]);

  return (
    <div className="flex-1 flex flex-col gap-4 overflow-hidden animate-fade-in">
      <div className="glass-card !p-5 border-brand-primary/20 bg-brand-primary/5 relative overflow-hidden group shrink-0">
        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
          <BrainCircuit size={72} />
        </div>
        <div className="flex items-start gap-4 relative z-10">
          <div className="p-3 rounded-2xl bg-brand-primary/20 text-brand-primary">
            <BrainCircuit size={22} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-black mb-2 flex flex-wrap items-center gap-2">
              Projeção financeira
              <span className="text-[8px] bg-brand-primary/15 text-brand-primary border border-brand-primary/20 px-1.5 py-0.5 rounded uppercase font-black">
                cálculo local
              </span>
            </h2>
            <div className="text-white/80 prose prose-invert prose-sm max-w-none">
              {loadingPrediction ? (
                <div className="flex items-center gap-2 text-white/40">
                  <div className="h-4 w-4 border-2 border-brand-primary border-t-transparent rounded-full animate-spin" />
                  <span>Calculando fluxo, compromissos e concentração de gastos...</span>
                </div>
              ) : (
                <div className="text-xs leading-relaxed">
                  <ReactMarkdown>{prediction}</ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-0">
        <div className="lg:col-span-7 flex flex-col gap-4 min-h-0">
          <section className="space-y-3 min-h-0">
            <h3 className="text-sm font-bold uppercase tracking-widest text-white/40 flex items-center gap-2">
              <AlertTriangle size={16} /> Riscos e alertas
            </h3>
            <div className="grid gap-3">
              {summary?.priorities?.slice(0, 3).map((priority) => (
                <div key={priority.id} className="glass-card !p-4 flex items-center gap-4 border-white/5">
                  <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${priority.type === 'urgent' ? 'bg-red-500/20 text-red-400' : priority.type === 'warning' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-brand-primary/15 text-brand-primary'}`}>
                    <AlertTriangle size={18} />
                  </div>
                  <div className="min-w-0">
                    <h4 className="font-bold text-sm">{priority.title}</h4>
                    <p className="text-xs text-white/60 line-clamp-2">{priority.message}</p>
                  </div>
                </div>
              ))}
              {(summary?.priorities?.length ?? 0) === 0 && (
                <div className="glass-card !p-4 flex items-center gap-3 text-xs text-white/50">
                  <CheckCircle2 className="text-green-400" size={18} /> Nenhum alerta crítico no momento.
                </div>
              )}
            </div>
          </section>

          <section className="glass-card !p-4 bg-brand-secondary/5 border-brand-secondary/20">
            <h3 className="font-bold text-sm mb-1 flex items-center gap-2">
              <TrendingDown size={16} /> Cenário até o próximo pagamento
            </h3>
            <p className="text-xs text-white/70">
              Mantendo a média diária registrada, sem novas entradas e considerando contas fixas pendentes, o saldo estimado é de{' '}
              <strong className={scenarioBalance >= 0 ? 'text-green-400' : 'text-red-400'}>
                R$ {scenarioBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </strong>.
            </p>
          </section>
        </div>

        <div className="lg:col-span-5 flex flex-col gap-4 min-h-0">
          <section className="space-y-3">
            <h3 className="text-sm font-bold uppercase tracking-widest text-white/40 flex items-center gap-2">
              <Lightbulb size={16} /> Comportamento
            </h3>
            <div className="glass-card !p-4">
              <h4 className="font-bold text-sm mb-1">Concentração</h4>
              <p className="text-xs text-white/60">
                {summary?.dominantCategory && summary.dominantCategory !== 'Nenhuma'
                  ? `A categoria ${summary.dominantCategory} representa ${(summary.topCategories?.[0]?.percentage ?? 0).toFixed(0)}% dos gastos do ciclo.`
                  : 'Ainda não há gastos suficientes para identificar uma categoria dominante.'}
              </p>
            </div>
            <div className="glass-card !p-4 border-green-500/20">
              <h4 className="font-bold text-sm mb-1 text-green-400">Controle recente</h4>
              <p className="text-xs text-white/60">{recentControl}</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
