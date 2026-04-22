
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
    <div className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-4 animate-fade-in">
      {/* Row 1: Summary Cards */}
      <div className="lg:col-span-3 glass-card !p-5">
        <span className="text-white/40 text-xs font-bold uppercase tracking-widest block mb-2">Total Ciclo</span>
        <div className="text-2xl font-bold tracking-tight">R$ {(summary?.totalSpentInCycle ?? 0).toLocaleString('pt-BR')}</div>
      </div>
      <div className="lg:col-span-3 glass-card !p-5">
        <span className="text-white/40 text-xs font-bold uppercase tracking-widest block mb-2">Média Diária</span>
        <div className="text-2xl font-bold tracking-tight">R$ {(summary?.averageDailySpent ?? 0).toLocaleString('pt-BR')}</div>
      </div>
      <div className="lg:col-span-3 glass-card !p-5">
        <span className="text-white/40 text-xs font-bold uppercase tracking-widest block mb-2">Maior Gasto</span>
        <div className="text-2xl font-bold tracking-tight text-brand-primary truncate">{summary?.dominantCategory || 'Nenhum'}</div>
      </div>
      <div className="lg:col-span-3 glass-card !p-5">
        <span className="text-white/40 text-xs font-bold uppercase tracking-widest block mb-2">Tendência</span>
        <div className={`text-2xl font-bold tracking-tight ${summary?.spendingTrend === 'up' ? 'text-red-400' : 'text-green-400'}`}>
          {summary?.spendingTrend === 'up' ? 'Aumentando' : 'Diminuindo'}
        </div>
      </div>

      {/* Row 2: Distribution & Top Categories */}
      <div className="md:col-span-1 lg:col-span-5 glass-card !p-6 flex flex-col items-center justify-center relative min-h-[350px]">
        <h3 className="absolute top-6 left-6 font-bold text-sm uppercase tracking-widest text-white/20 flex items-center gap-2">
          <PieChartIcon size={18} /> Por Categoria
        </h3>
        <div className="w-full h-[65%] flex items-center justify-center mt-6">
          <Doughnut data={doughnutData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }} />
        </div>
      </div>

      <div className="md:col-span-1 lg:col-span-7 glass-card !p-6 flex flex-col min-h-[350px]">
        <h3 className="font-bold text-sm uppercase tracking-widest text-white/20 mb-6 flex items-center gap-2">
          <Activity size={18} /> Top Categorias
        </h3>
        <div className="flex-1 space-y-5 overflow-y-auto no-scrollbar">
          {summary?.topCategories?.map(cat => (
            <div key={cat.name} className="space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="font-bold text-white/80">{cat.name}</span>
                <div className="flex items-center gap-3">
                  <span className="text-white/30 text-xs">{(cat.percentage ?? 0).toFixed(0)}%</span>
                  <span className="font-bold">R$ {cat.amount.toFixed(2)}</span>
                </div>
              </div>
              <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-brand-primary" style={{ width: `${cat.percentage}%` }}></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Row 3: Insights */}
      <div className="lg:col-span-8 glass-card !p-6 flex flex-col h-[350px]">
        <h3 className="font-bold text-sm uppercase tracking-widest text-white/20 mb-6 flex items-center gap-2">
          <TrendingUp size={18} /> Evolução Ciclo
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
            options={{ 
              responsive: true, 
              maintainAspectRatio: false, 
              scales: { 
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { font: { size: 10 }, color: 'rgba(255,255,255,0.3)' } }, 
                x: { grid: { display: false }, ticks: { font: { size: 10 }, color: 'rgba(255,255,255,0.3)' } } 
              }, 
              plugins: { legend: { display: false } } 
            }}
          />
        </div>
      </div>

      <div className="lg:col-span-4 glass-card !p-6 flex flex-col justify-center items-center gap-6">
        <div className="h-20 w-20 rounded-full bg-brand-primary/10 flex items-center justify-center border border-brand-primary/20">
          <Target className="text-brand-primary" size={40} />
        </div>
        <div className="text-center">
          <h4 className="font-bold text-xl">Dica de Saúde</h4>
          <p className="text-sm text-white/40 mt-2 leading-relaxed italic">
            "{summary?.dailyInsight || "Acompanhe seus gastos diariamente para manter a saúde financeira."}"
          </p>
        </div>
      </div>
    </div>
  );
}
