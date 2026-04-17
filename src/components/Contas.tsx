
import React, { useState, useMemo } from 'react';
import { FixedBill, DailyBill, FinanceSummary } from '../types';
import { 
  CreditCard, 
  Calendar, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  Plus, 
  MoreVertical,
  TrendingDown,
  Activity,
  PieChart as PieChartIcon,
  ArrowRight
} from 'lucide-react';

interface ContasProps {
  fixedBills: FixedBill[];
  dailyBills: DailyBill[];
  summary: FinanceSummary;
  onAddFixed?: () => void;
  onAddDaily?: () => void;
  onToggleStatus?: (id: string) => void;
}

export default function Contas({ fixedBills, dailyBills, summary, onAddFixed, onAddDaily, onToggleStatus }: ContasProps) {
  const totalFixed = useMemo(() => fixedBills.reduce((sum, b) => sum + b.amount, 0), [fixedBills]);
  const totalDaily = useMemo(() => dailyBills.reduce((sum, b) => sum + b.average_amount, 0), [dailyBills]);
  const totalCommitted = totalFixed + totalDaily;

  // Sort fixed bills: pending first, then by due day
  const sortedFixed = useMemo(() => {
    return [...fixedBills].sort((a, b) => {
      if (a.status !== b.status) return a.status === 'pending' ? -1 : 1;
      return a.due_day - b.due_day;
    });
  }, [fixedBills]);

  return (
    <div className="flex-1 flex flex-col gap-4 overflow-y-auto no-scrollbar pb-8 animate-fade-in">
      {/* 1. Topo da Tela & 2. Resumo das Contas */}
      <div className="glass-card !p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 shrink-0">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Contas</h2>
          <p className="text-sm sm:text-xs text-white/40">Controle das suas despesas e compromissos recorrentes.</p>
        </div>
        <div className="flex flex-wrap gap-4 sm:gap-6">
          <div className="text-right">
            <span className="text-[11px] sm:text-[10px] text-white/40 uppercase font-bold">Total Comprometido</span>
            <div className="text-lg font-bold text-brand-primary">R$ {totalCommitted.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
          </div>
          <div className="text-right">
            <span className="text-[11px] sm:text-[10px] text-white/40 uppercase font-bold">Contas Fixas</span>
            <div className="text-lg font-bold">R$ {totalFixed.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
          </div>
          <div className="text-right">
            <span className="text-[11px] sm:text-[10px] text-white/40 uppercase font-bold">Dia a Dia (Est.)</span>
            <div className="text-lg font-bold">R$ {totalDaily.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 flex-1 min-h-0">
        {/* 3 & 4. Bloco A — Contas Fixas */}
        <div className="xl:col-span-7 flex flex-col gap-4">
          <div className="glass-card flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between mb-4 p-1">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <Calendar size={16} className="text-brand-primary" /> Contas Fixas (Compromissos)
              </h3>
              <button 
                onClick={onAddFixed}
                className="p-2 min-h-9 min-w-9 bg-brand-primary/10 text-brand-primary rounded-lg hover:bg-brand-primary/20 transition-all"
              >
                <Plus size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar space-y-2">
              {sortedFixed.map(bill => (
                <div key={bill.id} className="p-3 bg-white/5 rounded-xl border border-white/5 flex items-center justify-between group hover:border-white/10 transition-all">
                  <div className="flex items-center gap-3">
                    <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${bill.status === 'paid' ? 'bg-green-500/10 text-green-400' : 'bg-brand-primary/10 text-brand-primary'}`}>
                      {bill.status === 'paid' ? <CheckCircle2 size={20} /> : <Clock size={20} />}
                    </div>
                    <div>
                      <div className="font-bold text-sm">{bill.name}</div>
                      <div className="flex items-center gap-2 text-[11px] sm:text-[10px] text-white/40">
                        <span className="uppercase">{bill.category}</span>
                        <span>•</span>
                        <span>Vence dia {bill.due_day}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="font-bold text-sm">R$ {bill.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                      <div className={`text-[11px] sm:text-[10px] uppercase font-bold ${bill.status === 'paid' ? 'text-green-400' : 'text-brand-primary'}`}>
                        {bill.status === 'paid' ? 'Pago' : 'Pendente'}
                      </div>
                    </div>
                    <button 
                      onClick={() => onToggleStatus?.(bill.id)}
                      className="p-2 min-h-9 min-w-9 text-white/20 hover:text-white transition-colors"
                    >
                      <MoreVertical size={16} />
                    </button>
                  </div>
                </div>
              ))}
              {fixedBills.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-white/20">
                  <Calendar size={48} className="mb-2 opacity-20" />
                  <p className="text-sm">Nenhuma conta fixa cadastrada.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 3 & 7. Bloco B — Contas do Dia a Dia */}
        <div className="xl:col-span-5 flex flex-col gap-4">
          <div className="glass-card flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between mb-4 p-1">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <Activity size={16} className="text-brand-secondary" /> Gastos do Dia a Dia (Operacional)
              </h3>
              <button 
                onClick={onAddDaily}
                className="p-2 min-h-9 min-w-9 bg-brand-secondary/10 text-brand-secondary rounded-lg hover:bg-brand-secondary/20 transition-all"
              >
                <Plus size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar space-y-2">
              {dailyBills.map(bill => (
                <div key={bill.id} className="p-3 bg-white/5 rounded-xl border border-white/5 flex items-center justify-between group hover:border-white/10 transition-all">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-brand-secondary/10 text-brand-secondary flex items-center justify-center">
                      <TrendingDown size={20} />
                    </div>
                    <div>
                      <div className="font-bold text-sm">{bill.name}</div>
                      <div className="text-[11px] sm:text-[10px] text-white/40 uppercase">{bill.category} • {bill.frequency === 'weekly' ? 'Semanal' : 'Mensal'}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="font-bold text-sm">R$ {bill.average_amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                      <div className="text-[11px] sm:text-[10px] text-white/40 uppercase">Média Est.</div>
                    </div>
                    <button className="p-2 min-h-9 min-w-9 text-white/20 hover:text-white transition-colors">
                      <MoreVertical size={16} />
                    </button>
                  </div>
                </div>
              ))}
              {dailyBills.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-white/20">
                  <Activity size={48} className="mb-2 opacity-20" />
                  <p className="text-sm">Nenhum gasto operacional cadastrado.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 9 & 10. Visão de Impacto + Alertas */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 shrink-0">
        <div className="xl:col-span-8 glass-card !p-4 flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-8">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-full border-4 border-brand-primary border-t-brand-secondary flex items-center justify-center text-[11px] sm:text-[10px] font-bold">
              {Math.round((totalCommitted / summary.currentBalance) * 100)}%
            </div>
            <div>
              <h4 className="font-bold text-sm">Impacto no Orçamento</h4>
              <p className="text-sm sm:text-xs text-white/40">Comprometimento do saldo atual com contas.</p>
            </div>
          </div>
          
          <div className="w-full flex flex-col sm:flex-row gap-4">
            <div className="flex-1 p-3 bg-white/5 rounded-xl border border-white/5">
              <span className="text-[11px] sm:text-[10px] text-white/40 uppercase font-bold">Sobra Estimada</span>
              <div className="text-sm font-bold text-green-400">R$ {(summary.currentBalance - totalCommitted).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
            </div>
            <div className="flex-1 p-3 bg-white/5 rounded-xl border border-white/5">
              <span className="text-[11px] sm:text-[10px] text-white/40 uppercase font-bold">Peso Fixo</span>
              <div className="text-sm font-bold text-brand-primary">{Math.round((totalFixed / totalCommitted) * 100)}% do total</div>
            </div>
          </div>
        </div>

        <div className="xl:col-span-4 glass-card !p-4 flex flex-col justify-center gap-3">
          <h4 className="font-bold text-sm sm:text-xs uppercase tracking-widest text-white/40 flex items-center gap-2">
            <AlertCircle size={14} /> Alertas de Contas
          </h4>
          <div className="space-y-2">
            {fixedBills.filter(b => b.status === 'pending' && b.due_day <= new Date().getDate() + 3).map(b => (
              <div key={b.id} className="flex items-center gap-2 text-[11px] sm:text-[10px] text-brand-primary font-bold animate-pulse">
                <Clock size={12} />
                <span>{b.name} vence em breve (Dia {b.due_day})</span>
              </div>
            ))}
            {fixedBills.filter(b => b.status === 'pending' && b.due_day < new Date().getDate()).map(b => (
              <div key={b.id} className="flex items-center gap-2 text-[11px] sm:text-[10px] text-red-400 font-bold">
                <AlertCircle size={12} />
                <span>{b.name} está atrasada!</span>
              </div>
            ))}
            {fixedBills.filter(b => b.status === 'pending').length === 0 && (
              <div className="flex items-center gap-2 text-[11px] sm:text-[10px] text-green-400 font-bold">
                <CheckCircle2 size={12} />
                <span>Todas as contas fixas em dia.</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

