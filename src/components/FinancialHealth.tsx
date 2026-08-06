import React, { useMemo } from 'react';
import {
  AlertCircle,
  Award,
  CheckCircle2,
  Heart,
  Shield,
  Star,
  TrendingUp,
  Trophy,
  Zap,
} from 'lucide-react';
import { motion } from 'motion/react';

import { useApp } from '../context/AppContext';
import { formatCurrency } from '../lib/formatters';

interface FinancialHealthProps {
  transactions: any[];
  summary: any;
  totals: {
    totalInvestments?: number;
    categoryCount?: number;
  };
}

const LEVELS = [
  { min: 0, name: 'Iniciante', color: 'text-gray-400', bg: 'bg-gray-400/10', icon: Seedling },
  { min: 300, name: 'Aprendiz', color: 'text-blue-400', bg: 'bg-blue-400/10', icon: Star },
  { min: 500, name: 'Gestor', color: 'text-brand-primary', bg: 'bg-brand-primary/10', icon: Shield },
  { min: 700, name: 'Estrategista', color: 'text-purple-400', bg: 'bg-purple-400/10', icon: Trophy },
  { min: 900, name: 'Wealth Master', color: 'text-yellow-400', bg: 'bg-yellow-400/10', icon: Award },
] as const;

export default function FinancialHealth({ transactions, summary, totals }: FinancialHealthProps) {
  const { isPrivate } = useApp();

  const health = useMemo(() => {
    const totalInvestments = Math.max(0, Number(totals?.totalInvestments || 0));
    const categoryCount = Math.max(0, Number(totals?.categoryCount || 0));
    const averageDailySpent = Math.max(0, Number(summary?.averageDailySpent || 0));
    const monthlyExpenseEstimate = averageDailySpent * 30;
    const reserveMonths = monthlyExpenseEstimate > 0 ? totalInvestments / monthlyExpenseEstimate : 0;
    const projectedBalance = Number(summary?.projectedBalance || 0);
    const dailyLimit = Math.max(0, Number(summary?.dailyLimit || 0));

    const reserveScore = Math.min(300, (reserveMonths / 6) * 300);
    const cashFlowScore = projectedBalance > 0 ? 250 : projectedBalance === 0 ? 125 : 0;
    const spendingScore = dailyLimit > 0
      ? Math.min(200, (dailyLimit / Math.max(dailyLimit, averageDailySpent || 1)) * 200)
      : averageDailySpent === 0
        ? 100
        : 0;
    const diversificationScore = Math.min(150, (categoryCount / 5) * 150);
    const consistencyScore = Math.min(100, (transactions.length / 30) * 100);

    const score = Math.round(Math.min(1000, reserveScore + cashFlowScore + spendingScore + diversificationScore + consistencyScore));
    const level = [...LEVELS].reverse().find((item) => score >= item.min) || LEVELS[0];
    const nextLevel = LEVELS.find((item) => item.min > score) || null;
    const progress = nextLevel
      ? Math.max(0, Math.min(100, ((score - level.min) / (nextLevel.min - level.min)) * 100))
      : 100;

    return {
      score,
      level,
      nextLevel,
      progress,
      reserveMonths,
      monthlyExpenseEstimate,
      totalInvestments,
      projectedBalance,
      dailyLimit,
      averageDailySpent,
    };
  }, [transactions.length, summary, totals]);

  const badges = [
    {
      id: 1,
      name: 'Fluxo positivo',
      icon: Heart,
      unlocked: health.projectedBalance > 0,
      desc: 'Projeção do ciclo no azul',
    },
    {
      id: 2,
      name: 'Investidor',
      icon: TrendingUp,
      unlocked: health.totalInvestments > 0,
      desc: 'Primeiro investimento cadastrado',
    },
    {
      id: 3,
      name: 'Organizado',
      icon: CheckCircle2,
      unlocked: transactions.length >= 10,
      desc: '10 ou mais lançamentos',
    },
    {
      id: 4,
      name: 'Controlado',
      icon: Zap,
      unlocked: health.dailyLimit > 0 && health.averageDailySpent <= health.dailyLimit,
      desc: 'Média dentro do limite diário',
    },
  ];

  const nextSteps = useMemo(() => {
    const steps: Array<{ title: string; message: string; tone: 'warning' | 'success' }> = [];

    if (health.monthlyExpenseEstimate <= 0) {
      steps.push({
        title: 'Registre seus gastos',
        message: 'Ainda não há dados suficientes para calcular sua reserva de emergência.',
        tone: 'warning',
      });
    } else if (health.reserveMonths < 3) {
      const threeMonthTarget = health.monthlyExpenseEstimate * 3;
      steps.push({
        title: 'Fortaleça sua reserva',
        message: `A reserva cadastrada cobre cerca de ${health.reserveMonths.toFixed(1)} mês(es). Uma primeira meta prudente seria ${formatCurrency(threeMonthTarget, isPrivate)}.`,
        tone: 'warning',
      });
    } else {
      steps.push({
        title: 'Reserva em evolução',
        message: `Sua carteira cadastrada equivale a aproximadamente ${health.reserveMonths.toFixed(1)} mês(es) da média atual de gastos.`,
        tone: 'success',
      });
    }

    if (health.dailyLimit > 0 && health.averageDailySpent > health.dailyLimit) {
      steps.push({
        title: 'Ajuste o ritmo diário',
        message: `A média diária está ${formatCurrency(health.averageDailySpent - health.dailyLimit, isPrivate)} acima do limite calculado.`,
        tone: 'warning',
      });
    } else if (health.dailyLimit > 0) {
      steps.push({
        title: 'Ritmo de gastos controlado',
        message: 'A média diária está dentro do limite calculado para o ciclo.',
        tone: 'success',
      });
    }

    return steps.slice(0, 2);
  }, [health, isPrivate]);

  return (
    <div className="flex-1 flex flex-col gap-5 animate-fade-in overflow-hidden">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5 min-h-0">
        <div className="md:col-span-4 glass-card !p-6 flex flex-col items-center justify-center relative overflow-hidden">
          <div className="absolute -top-20 -left-20 w-40 h-40 bg-brand-primary/10 rounded-full blur-3xl animate-pulse" />

          <div className="relative h-44 w-44 flex items-center justify-center">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 192 192">
              <circle cx="96" cy="96" r="82" fill="none" stroke="currentColor" strokeWidth="12" className="text-white/5" />
              <motion.circle
                cx="96"
                cy="96"
                r="82"
                fill="none"
                stroke="currentColor"
                strokeWidth="12"
                strokeDasharray={515.22}
                initial={{ strokeDashoffset: 515.22 }}
                animate={{ strokeDashoffset: 515.22 - (515.22 * health.score) / 1000 }}
                transition={{ duration: 1.1, ease: 'easeOut' }}
                className="text-brand-primary"
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute flex flex-col items-center">
              <span className="text-4xl font-black">{health.score}</span>
              <span className="text-[9px] uppercase font-black tracking-widest text-white/30">de 1000</span>
            </div>
          </div>

          <div className={`mt-5 px-5 py-2 rounded-full font-black text-xs uppercase tracking-[0.2em] ${health.level.color} ${health.level.bg}`}>
            {health.level.name}
          </div>
          <div className="mt-4 w-full">
            <div className="flex justify-between text-[9px] uppercase font-bold text-white/30 mb-1">
              <span>Progresso do nível</span>
              <span>{health.progress.toFixed(0)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
              <div className="h-full bg-brand-primary" style={{ width: `${health.progress}%` }} />
            </div>
          </div>
        </div>

        <div className="md:col-span-8 flex flex-col gap-5 min-h-0">
          <div className="glass-card !p-5 border-white/5">
            <h3 className="text-xs font-black uppercase tracking-widest text-white/40 mb-4">Próximos passos</h3>
            <div className="grid gap-4">
              {nextSteps.map((step) => (
                <div key={step.title} className="flex items-start gap-4">
                  <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${step.tone === 'warning' ? 'bg-orange-500/10 text-orange-400' : 'bg-green-500/10 text-green-400'}`}>
                    {step.tone === 'warning' ? <AlertCircle size={20} /> : <TrendingUp size={20} />}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold">{step.title}</h4>
                    <p className="text-xs text-white/40 mt-1">{step.message}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="min-h-0">
            <h3 className="text-xs font-black uppercase tracking-widest text-white/40 mb-3 ml-2">Conquistas calculadas</h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {badges.map((badge) => (
                <div
                  key={badge.id}
                  className={`glass-card !p-4 flex flex-col items-center text-center group transition-all ${badge.unlocked ? 'border-brand-primary/20 brightness-110' : 'opacity-40 grayscale'}`}
                >
                  <div className={`h-11 w-11 rounded-2xl flex items-center justify-center mb-3 transition-transform group-hover:scale-110 ${badge.unlocked ? 'bg-brand-primary/20 text-brand-primary' : 'bg-white/5 text-white/20'}`}>
                    <badge.icon size={22} />
                  </div>
                  <span className="text-[9px] font-black uppercase tracking-widest mb-1">{badge.name}</span>
                  <p className="text-[8px] text-white/40 leading-tight">{badge.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Seedling({ size, ...props }: any) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M7 20h10" />
      <path d="M10 20c0-3.3 1-6.4 3-9" />
      <path d="M13 11c1 2.6 1 5.7 1 9" />
      <path d="M12 4c.6 1.4.6 3.2 0 4.6l-1 2.4c-.6 1.4-.6 3.2 0 4.6" />
      <path d="M18 10h-1.9c-1.3 0-2.4 1.1-2.4 2.4V14" />
      <path d="M6 10h1.9c1.3 0 2.4 1.1 2.4 2.4V14" />
    </svg>
  );
}
