
import React from 'react';
import { Transaction, FinanceSummary } from '../types';
import { Doughnut, Bar } from 'react-chartjs-2';
import { 
  PieChart as PieChartIcon, 
  TrendingUp, 
  Activity, 
  Target,
  ArrowUpRight,
  ArrowDownRight
} from 'lucide-react';

interface DetailsProps {
  transactions: Transaction[];
  summary: FinanceSummary | null;
}

export default function Details({ transactions, summary }: DetailsProps) {
  const doughnutData = {
    labels: (summary?.topCategories ?? []).map(c => c.name),
    datasets: [
      {
        data: (summary?.topCategories ?? []).map(c => c.amount),
        backgroundColor: ['#00f2ff', '#7000ff', '#ff00c8', '#ff8a00', '#00ff85'],
        borderWidth: 0,
        hoverOffset: 10
      },
    ],
  };

  return (
    <div className="flex-1 grid grid-cols-12 grid-rows-[auto_1fr_1fr] gap-4 overflow-hidden animate-fade-in">
      {/* Row 1: Summary Cards */}
      <div className="col-span-3 glass-card !p-4">
        <span className="text-[10px] text-white/40 uppercase font-bold">Total Gasto no Ciclo</span>
        <div className="text-2xl font-bold mt-1">R$ {(summary?.totalSpentInCycle ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
      </div>
      <div className="col-span-3 glass-card !p-4">
        <span className="text-[10px] text-white/40 uppercase font-bold">Média Diária Real</span>
        <div className="text-2xl font-bold mt-1">R$ {(summary?.averageDailySpent ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
      </div>
      <div className="col-span-3 glass-card !p-4">
        <span className="text-[10px] text-white/40 uppercase font-bold">Categoria Dominante</span>
        <div className="text-2xl font-bold mt-1 text-brand-primary">{summary?.dominantCategory ?? 'Nenhuma'}</div>
      </div>
      <div className="col-span-3 glass-card !p-4">
        <span className="text-[10px] text-white/40 uppercase font-bold">Saúde do Ciclo</span>
        <div className={`text-2xl font-bold mt-1 ${summary?.spendingTrend === 'up' ? 'text-red-400' : 'text-green-400'}`}>
          {summary?.spendingTrend === 'up' ? 'Em Risco' : 'Saudável'}
        </div>
      </div>

      {/* Row 2: Distribution & Top Categories */}
      <div className="col-span-5 glass-card flex flex-col items-center justify-center relative">
        <h3 className="absolute top-4 left-4 font-bold text-sm flex items-center gap-2">
          <PieChartIcon size={16} /> Distribuição de Gastos
        </h3>
        <div className="w-full h-[80%] flex items-center justify-center">
          <Doughnut data={doughnutData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }} />
        </div>
        <div className="absolute flex flex-col items-center">
          <span className="text-[10px] text-white/40 uppercase">Total</span>
          <span className="font-bold text-lg">100%</span>
        </div>
      </div>

      <div className="col-span-7 glass-card flex flex-col">
        <h3 className="font-bold text-sm mb-4 flex items-center gap-2">
          <Activity size={16} /> Análise por Categoria
        </h3>
        <div className="flex-1 space-y-4 overflow-y-auto no-scrollbar pr-2">
          {summary?.topCategories?.map(cat => (
            <div key={cat.name} className="space-y-1">
              <div className="flex justify-between items-center text-sm">
                <span className="font-medium">{cat.name}</span>
                <div className="flex items-center gap-4">
                  <span className="text-white/40 text-xs">{(cat.percentage ?? 0).toFixed(1)}%</span>
                  <span className="font-bold">R$ {cat.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
              <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-brand-primary" style={{ width: `${cat.percentage}%` }}></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Row 3: Temporal Analysis & Insights */}
      <div className="col-span-8 glass-card flex flex-col">
        <h3 className="font-bold text-sm mb-4 flex items-center gap-2">
          <TrendingUp size={16} /> Ritmo de Gasto (Semanal)
        </h3>
        <div className="flex-1 min-h-0">
          <Bar 
            data={{
              labels: summary?.rhythm?.week?.labels ?? [],
              datasets: [{
                label: 'Gastos',
                data: summary?.rhythm?.week?.data ?? [],
                backgroundColor: 'rgba(0, 242, 255, 0.2)',
                borderColor: '#00f2ff',
                borderWidth: 1,
                borderRadius: 4
              }]
            }}
            options={{ responsive: true, maintainAspectRatio: false, scales: { y: { grid: { color: 'rgba(255,255,255,0.05)' } }, x: { grid: { display: false } } }, plugins: { legend: { display: false } } }}
          />
        </div>
      </div>

      <div className="col-span-4 glass-card flex flex-col">
        <h3 className="font-bold text-sm mb-4 flex items-center gap-2">
          <Target size={16} /> Maiores Impactos
        </h3>
        <div className="flex-1 space-y-3">
          {transactions
            .filter(t => t.type === 'expense')
            .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
            .slice(0, 4)
            .map(t => (
              <div key={t.id} className="p-3 bg-white/5 rounded-xl border border-white/5 flex items-center justify-between">
                <div className="min-w-0">
                  <div className="font-bold text-xs truncate">{t.description || t.category}</div>
                  <div className="text-[10px] text-white/40">{t.category}</div>
                </div>
                <div className="font-bold text-xs text-red-400 shrink-0">
                  - R$ {Math.abs(t.amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
