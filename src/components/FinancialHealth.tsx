import React, { useMemo } from 'react';
import { Trophy, Star, Shield, Award, Zap, TrendingUp, Heart, CheckCircle2, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { useApp } from '../context/AppContext';

export default function FinancialHealth({ transactions, summary, totals }: { transactions: any[], summary: any, totals: any }) {
  const { isPrivate } = useApp();

  const health = useMemo(() => {
    // Cálculo simplificado de saúde financeira 0-1000
    let score = 500;
    
    // Fator 1: Reserva de Emergência (simulado vs total investido)
    const investmentScore = Math.min(200, (totals.totalInvestments / 10000) * 200);
    score += investmentScore;

    // Fator 2: Controle de Gastos (se gastou menos do que ganha)
    if (summary.projectedBalance > 0) score += 150;
    
    // Fator 3: Diversificação
    if (totals.categoryCount > 3) score += 100;
    
    // Fator 4: Consistência (número de transações)
    const consistency = Math.min(50, transactions.length);
    score += consistency;

    const levels = [
      { min: 0, name: 'Iniciante', color: 'text-gray-400', bg: 'bg-gray-400/10', icon: Seedling },
      { min: 300, name: 'Aprendiz', color: 'text-blue-400', bg: 'bg-blue-400/10', icon: Star },
      { min: 500, name: 'Gestor', color: 'text-brand-primary', bg: 'bg-brand-primary/10', icon: Shield },
      { min: 700, name: 'Estrategista', color: 'text-purple-400', bg: 'bg-purple-400/10', icon: Trophy },
      { min: 900, name: 'Wealth Master', color: 'text-yellow-400', bg: 'bg-yellow-400/10', icon: Award }
    ];

    const currentLevel = levels.reverse().find(l => score >= l.min) || levels[levels.length - 1];
    
    return {
      score: Math.round(score),
      level: currentLevel,
      progress: (score % 200) / 2, // Progresso dentro do nível (simplificado)
    };
  }, [transactions, totals, summary]);

  const badges = [
    { id: 1, name: 'Poupador', icon: Heart, unlocked: summary.projectedBalance > 0, desc: 'Fim do mês no azul' },
    { id: 2, name: 'Investidor', icon: TrendingUp, unlocked: totals.totalInvestments > 100, desc: 'Primeiro aporte' },
    { id: 3, name: 'Organizado', icon: CheckCircle2, unlocked: transactions.length > 10, desc: '10+ transações' },
    { id: 4, name: 'Analista', icon: Zap, unlocked: true, desc: 'IA ativada' }
  ];

  return (
    <div className="flex-1 flex flex-col gap-6 animate-fade-in">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Score Card */}
        <div className="md:col-span-4 glass-card !p-8 flex flex-col items-center justify-center relative overflow-hidden">
          <div className="absolute -top-20 -left-20 w-40 h-40 bg-brand-primary/10 rounded-full blur-3xl animate-pulse" />
          
          <div className="relative h-48 w-48 flex items-center justify-center">
            <svg className="w-full h-full -rotate-90">
              <circle
                cx="96" cy="96" r="88"
                fill="none"
                stroke="currentColor"
                strokeWidth="12"
                className="text-white/5"
              />
              <motion.circle
                cx="96" cy="96" r="88"
                fill="none"
                stroke="currentColor"
                strokeWidth="12"
                strokeDasharray={552.92}
                initial={{ strokeDashoffset: 552.92 }}
                animate={{ strokeDashoffset: 552.92 - (552.92 * health.score) / 1000 }}
                transition={{ duration: 1.5, ease: "easeOut" }}
                className="text-brand-primary"
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute flex flex-col items-center">
              <span className="text-4xl font-black">{health.score}</span>
              <span className="text-[10px] uppercase font-black tracking-widest text-white/30">Health Score</span>
            </div>
          </div>

          <div className={`mt-8 px-6 py-2 rounded-full font-black text-xs uppercase tracking-[0.2em] ${health.level.color} ${health.level.bg}`}>
            {health.level.name}
          </div>
        </div>

        {/* Info & Badges */}
        <div className="md:col-span-8 space-y-6">
          <div className="glass-card !p-6 border-white/5">
            <h3 className="text-xs font-black uppercase tracking-widest text-white/40 mb-6">Próximos Passos</h3>
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="h-10 w-10 rounded-xl bg-orange-500/10 flex items-center justify-center text-orange-400 shrink-0">
                  <AlertCircle size={20} />
                </div>
                <div>
                  <h4 className="text-sm font-bold">Aumente sua reserva</h4>
                  <p className="text-xs text-white/30 mt-1">Você tem 2.4x seus gastos fixos em reserva. O ideal para o nível "Estrategista" é 6x.</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="h-10 w-10 rounded-xl bg-green-500/10 flex items-center justify-center text-green-400 shrink-0">
                  <TrendingUp size={20} />
                </div>
                <div>
                  <h4 className="text-sm font-bold">Consistência de Aportes</h4>
                  <p className="text-xs text-white/30 mt-1">Mantenha os aportes mensais por mais 3 meses para desbloquear o badge "Resiliente".</p>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-black uppercase tracking-widest text-white/40 mb-4 ml-2">Suas Conquistas</h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {badges.map(badge => (
                <div 
                  key={badge.id}
                  className={`glass-card !p-4 flex flex-col items-center text-center group transition-all ${badge.unlocked ? 'border-brand-primary/20 brightness-110' : 'opacity-40 grayscale'}`}
                >
                  <div className={`h-12 w-12 rounded-2xl flex items-center justify-center mb-3 transition-transform group-hover:scale-110 ${badge.unlocked ? 'bg-brand-primary/20 text-brand-primary' : 'bg-white/5 text-white/20'}`}>
                    <badge.icon size={24} />
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-widest mb-1">{badge.name}</span>
                  <p className="text-[8px] text-white/40 leading-none">{badge.desc}</p>
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
