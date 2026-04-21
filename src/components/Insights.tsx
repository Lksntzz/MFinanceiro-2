
import React, { useState, useEffect } from 'react';
import { FinanceSummary, Transaction, FixedBill } from '../types';
import { 
  Lightbulb, 
  AlertTriangle, 
  TrendingDown, 
  Zap, 
  CheckCircle2,
  ArrowRight,
  BrainCircuit
} from 'lucide-react';
import { getPredictiveAnalysis } from '../services/investmentIntelligence';
import ReactMarkdown from 'react-markdown';

interface InsightsProps {
  summary: FinanceSummary | null;
  transactions: Transaction[];
  fixedBills: FixedBill[];
}

export default function Insights({ summary, transactions, fixedBills }: InsightsProps) {
  const [prediction, setPrediction] = useState<string>('');
  const [loadingPrediction, setLoadingPrediction] = useState(false);

  useEffect(() => {
    async function fetchPrediction() {
      if (!summary || transactions.length === 0) return;
      setLoadingPrediction(true);
      try {
        const text = await getPredictiveAnalysis(transactions, summary.currentBalance, fixedBills);
        setPrediction(text);
      } catch (err) {
        console.error('Error fetching prediction:', err);
      } finally {
        setLoadingPrediction(false);
      }
    }
    fetchPrediction();
  }, [summary, transactions.length, fixedBills.length]);

  return (
    <div className="flex-1 flex flex-col gap-4 overflow-hidden animate-fade-in">
      {/* Predictive AI Banner */}
      <div className="glass-card !p-6 border-brand-primary/20 bg-brand-primary/5 relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
          <BrainCircuit size={80} />
        </div>
        <div className="flex items-start gap-4 relative z-10">
          <div className="p-3 rounded-2xl bg-brand-primary/20 text-brand-primary">
            <BrainCircuit size={24} />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-black mb-2 flex items-center gap-2">
              Previsão Inteligente 
              <span className="text-[8px] bg-brand-primary text-black px-1.5 py-0.5 rounded uppercase font-black">AI Powered</span>
            </h2>
            <div className="text-white/80 prose prose-invert prose-sm max-w-none">
              {loadingPrediction ? (
                <div className="flex items-center gap-2 text-white/40">
                  <div className="h-4 w-4 border-2 border-brand-primary border-t-transparent rounded-full animate-spin" />
                  <span>Analisando padrões e calculando fluxos futuros...</span>
                </div>
              ) : (
                <div className="text-sm leading-relaxed">
                  <ReactMarkdown>{prediction || "Processando seus dados financeiros para gerar insights preditivos..."}</ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-12 gap-4 overflow-hidden">
        <div className="col-span-7 flex flex-col gap-4 overflow-y-auto no-scrollbar">
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

        <div className="col-span-5 flex flex-col gap-4 overflow-y-auto no-scrollbar">
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
