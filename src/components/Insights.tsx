
import React from 'react';
import { FinanceSummary } from '../types';
import { 
  Lightbulb, 
  AlertTriangle, 
  TrendingDown, 
  Zap, 
  CheckCircle2,
  ArrowRight
} from 'lucide-react';

interface InsightsProps {
  summary: FinanceSummary | null;
}

export default function Insights({ summary }: InsightsProps) {
  return (
    <div className="flex-1 flex flex-col gap-4 overflow-y-auto animate-fade-in pb-4">
      {/* Hero Insight */}
      <div className={`glass-card !p-6 border-l-4 ${summary?.smartAlert?.type === 'danger' ? 'border-l-red-500 bg-red-500/5' : 'border-l-brand-primary bg-brand-primary/5'}`}>
        <div className="flex flex-col sm:flex-row items-start gap-4">
          <div className={`p-3 rounded-2xl ${summary?.smartAlert?.type === 'danger' ? 'bg-red-500/20 text-red-400' : 'bg-brand-primary/20 text-brand-primary'}`}>
            <Zap size={24} />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold mb-2">Insight Prioritário</h2>
            <p className="text-white/70 text-lg leading-relaxed">
              {summary?.smartAlert?.message || "Seu comportamento financeiro está exemplar neste ciclo. Continue assim!"}
            </p>
            <button className="mt-4 flex items-center gap-2 text-brand-primary font-bold hover:underline">
              <span>Tomar ação agora</span>
              <ArrowRight size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 overflow-visible">
        <div className="lg:col-span-7 flex flex-col gap-4">
          <section className="space-y-3">
            <h3 className="text-sm font-bold uppercase tracking-widest text-white/40 flex items-center gap-2">
              <AlertTriangle size={16} /> Riscos e Alertas
            </h3>
            {summary?.priorities?.map(p => (
              <div key={p.id} className="glass-card !p-4 flex items-center gap-4 border-white/5">
                <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${p.type === 'urgent' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                  <AlertTriangle size={20} />
                </div>
                <div>
                  <h4 className="font-bold text-sm">{p.title}</h4>
                  <p className="text-xs text-white/60">{p.message}</p>
                </div>
              </div>
            ))}
            {(summary?.priorities?.length ?? 0) === 0 && <div className="text-xs text-white/40 text-center py-4">Nenhum alerta crítico no momento.</div>}
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-bold uppercase tracking-widest text-white/40 flex items-center gap-2">
              <TrendingDown size={16} /> Previsões
            </h3>
            <div className="glass-card !p-4 bg-brand-secondary/5 border-brand-secondary/20">
              <h4 className="font-bold text-sm mb-1">Cenário de Fechamento</h4>
              <p className="text-xs text-white/70">
                Mantendo a média de **R$ {(summary?.averageDailySpent ?? 0).toFixed(2)}/dia**, você deve chegar ao dia do pagamento com um saldo de aproximadamente **R$ {(summary?.currentBalance ?? 0).toFixed(2)}**.
              </p>
            </div>
          </section>
        </div>

        <div className="lg:col-span-5 flex flex-col gap-4">
          <section className="space-y-3">
            <h3 className="text-sm font-bold uppercase tracking-widest text-white/40 flex items-center gap-2">
              <Lightbulb size={16} /> Comportamento
            </h3>
            <div className="glass-card !p-4">
              <h4 className="font-bold text-sm mb-1">Concentração</h4>
              <p className="text-xs text-white/60">
                Sua categoria **{summary?.dominantCategory ?? '...'}** representa **{(summary?.topCategories?.[0]?.percentage ?? 0).toFixed(0)}%** de tudo o que você gastou até agora.
              </p>
            </div>
            <div className="glass-card !p-4 border-green-500/20">
              <h4 className="font-bold text-sm mb-1 text-green-400">Progresso</h4>
              <p className="text-xs text-white/60">
                Você ficou abaixo do limite diário em 4 dos últimos 7 dias. Excelente progresso!
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
