import React, { useMemo } from 'react';
import { CreditCard, CardInstallment } from '../types';
import { format, addMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { 
  CreditCard as CardIcon, 
  AlertTriangle, 
  TrendingUp, 
  Calendar, 
  Plus, 
  MoreVertical,
  ArrowUpRight,
  Clock,
  PieChart as PieChartIcon,
  Info,
  CheckCircle2,
  Trash2,
  Pencil
} from 'lucide-react';

interface CartoesProps {
  cards: CreditCard[];
  installments: CardInstallment[];
  onAddCard?: () => void;
  onEditCard?: (card: CreditCard) => void;
  onDeleteCard?: (card: CreditCard) => void;
  onAddInstallment?: () => void;
  onEditInstallment?: (installment: CardInstallment) => void;
  onDeleteInstallment?: (installment: CardInstallment) => void;
  onPayInstallment?: (installment: CardInstallment) => void;
  onPayCardBill?: (card: CreditCard) => void;
}

export default function Cartoes({
  cards,
  installments,
  onAddCard,
  onEditCard,
  onDeleteCard,
  onAddInstallment,
  onEditInstallment,
  onDeleteInstallment,
  onPayInstallment,
  onPayCardBill
}: CartoesProps) {
  const cardNameById = useMemo(
    () => Object.fromEntries(cards.map(card => [card.id, card.name])),
    [cards]
  );

  const summary = useMemo(() => {
    const totalLimit = cards.reduce((sum, c) => sum + Number(c.limit || 0), 0);
    const totalUsed = cards.reduce((sum, c) => sum + Number(c.used || 0), 0);
    const totalAvailable = totalLimit - totalUsed;
    const usagePercent = totalLimit > 0 ? (totalUsed / totalLimit) * 100 : 0;
    
    // Find highest pressure card
    const pressureCard = [...cards].sort((a, b) => {
      const aUsage = a.limit > 0 ? a.used / a.limit : 0;
      const bUsage = b.limit > 0 ? b.used / b.limit : 0;
      return bUsage - aUsage;
    })[0];
    
    // Next relevant invoice (simplified logic)
    const nextInvoice = [...cards].sort((a, b) => a.due_day - b.due_day)[0];

    return {
      totalLimit,
      totalUsed,
      totalAvailable,
      usagePercent,
      pressureCard,
      nextInvoice,
      count: cards.length
    };
  }, [cards]);

  const monthlyInstallmentsTotal = useMemo(() => 
    installments.reduce((sum, i) => sum + Number(i.monthly_amount || 0), 0), 
  [installments]);

  return (
    <div className="flex-1 flex flex-col gap-4 overflow-y-auto no-scrollbar pb-8 animate-fade-in">
      {/* 1. Resumo dos Cartões */}
      <div className="glass-card !p-4 bg-brand-secondary/5 border-brand-secondary/20 shrink-0">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
            <PieChartIcon size={18} className="text-brand-secondary" /> Resumo de Crédito
          </h2>
          <span className="text-[10px] bg-brand-secondary/20 text-brand-secondary px-2 py-0.5 rounded-full font-bold">VISÃO CONSOLIDADA</span>
        </div>
        <div className="grid grid-cols-6 gap-4">
          <div className="flex flex-col">
            <span className="text-[10px] text-white/40 uppercase">Cartões</span>
            <span className="font-bold text-sm">{summary.count} Ativos</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-white/40 uppercase">Limite Total</span>
            <span className="font-bold text-sm">R$ {summary.totalLimit.toLocaleString('pt-BR')}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-white/40 uppercase">Total Utilizado</span>
            <span className="font-bold text-sm text-brand-secondary">R$ {summary.totalUsed.toLocaleString('pt-BR')}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-white/40 uppercase">Total Disponível</span>
            <span className="font-bold text-sm text-brand-primary">R$ {summary.totalAvailable.toLocaleString('pt-BR')}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-white/40 uppercase">Uso Global</span>
            <span className={`font-bold text-sm ${summary.usagePercent > 80 ? 'text-red-400' : 'text-white'}`}>
              {summary.usagePercent.toFixed(1)}%
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-white/40 uppercase">Próx. Vencimento</span>
            <span className="font-bold text-sm">{summary.nextInvoice ? `Dia ${summary.nextInvoice.due_day}` : '--'}</span>
          </div>
        </div>
      </div>

      {/* 2. Lista / Grade de Cartões */}
      <div className="grid grid-cols-3 gap-4">
        {cards.map(card => {
          const usage = card.limit > 0 ? (card.used / card.limit) * 100 : 0;
          const isHighPressure = usage > 80;
          
          return (
            <div key={card.id} className={`glass-card !p-5 space-y-4 relative overflow-hidden group hover:border-white/20 transition-all ${isHighPressure ? 'border-red-500/30 bg-red-500/5' : ''}`}>
              {isHighPressure && (
                <div className="absolute top-0 right-0 bg-red-500 text-[8px] font-bold px-2 py-0.5 rounded-bl-lg uppercase tracking-tighter">Alta Pressão</div>
              )}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${isHighPressure ? 'bg-red-500/20 text-red-400' : 'bg-white/10 text-white/60'}`}>
                    <CardIcon size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm">{card.name}</h3>
                    <span className="text-[10px] text-white/40 uppercase font-bold tracking-widest">{card.brand}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => onEditCard?.(card)} className="p-1.5 text-white/20 hover:text-white transition-colors">
                    <Pencil size={16} />
                  </button>
                  <button onClick={() => onDeleteCard?.(card)} className="p-1.5 text-white/20 hover:text-red-400 transition-colors">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[10px] uppercase font-bold text-white/40">
                  <span>Uso do Limite</span>
                  <span className={isHighPressure ? 'text-red-400' : 'text-white'}>{usage.toFixed(0)}%</span>
                </div>
                <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-500 ${isHighPressure ? 'bg-red-500' : 'bg-brand-secondary'}`} 
                    style={{ width: `${usage}%` }}
                  ></div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-2">
                <div>
                  <span className="text-[10px] text-white/40 uppercase block">Utilizado</span>
                  <span className="font-bold text-sm">R$ {card.used.toLocaleString('pt-BR')}</span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-white/40 uppercase block">Disponível</span>
                  <span className="font-bold text-sm text-brand-primary">R$ {(card.limit - card.used).toLocaleString('pt-BR')}</span>
                </div>
              </div>

              <div className="pt-3 border-t border-white/5 flex justify-between items-center text-[10px]">
                <div className="flex items-center gap-1.5 text-white/40">
                  <Calendar size={12} />
                  <span>Fecha dia {card.closing_day}</span>
                </div>
                <div className="flex items-center gap-2 text-white/40">
                  <Clock size={12} className="text-brand-primary" />
                  <span className="font-bold">Vence {format(new Date(new Date().getFullYear(), new Date().getMonth(), card.due_day, 12, 0, 0, 0), "dd 'de' MMMM", { locale: ptBR })}</span>
                </div>
              </div>

              {card.used > 0 && (
                <button
                  onClick={() => onPayCardBill?.(card)}
                  className="mt-4 w-full py-2 bg-brand-primary text-black text-[10px] font-bold uppercase rounded-xl hover:opacity-90 transition-all flex items-center justify-center gap-2"
                >
                  <TrendingUp size={12} /> Pagar Fatura Total
                </button>
              )}
            </div>
          );
        })}
        
        {/* Adicionar Cartão Placeholder */}
        <button 
          onClick={onAddCard}
          className="glass-card !p-5 border-dashed border-white/10 bg-transparent flex flex-col items-center justify-center gap-3 text-white/20 hover:text-white/40 hover:border-white/20 transition-all group"
        >
          <div className="h-12 w-12 rounded-full border-2 border-dashed border-current flex items-center justify-center group-hover:scale-110 transition-transform">
            <Plus size={24} />
          </div>
          <span className="text-xs font-bold uppercase tracking-widest">Novo Cartão</span>
        </button>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* 8. Visão Consolidada de Limite & 9. Faturas */}
        <div className="col-span-8 glass-card !p-5 flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm flex items-center gap-2">
              <TrendingUp size={16} className="text-brand-secondary" /> Saúde do Crédito Global
            </h3>
            <div className="text-[10px] text-white/40 uppercase font-bold">Total em Aberto: R$ {summary.totalUsed.toLocaleString('pt-BR')}</div>
          </div>
          
          <div className="grid grid-cols-2 gap-8">
            <div className="space-y-4">
              <div className="flex items-end gap-2">
                <span className="text-3xl font-bold">{summary.usagePercent.toFixed(0)}%</span>
                <span className="text-xs text-white/40 mb-1.5 uppercase font-bold">do limite total em uso</span>
              </div>
              <div className="h-3 w-full bg-white/5 rounded-full overflow-hidden flex">
                <div className="h-full bg-brand-secondary" style={{ width: `${summary.usagePercent}%` }}></div>
                <div className="h-full bg-white/10" style={{ width: `${100 - summary.usagePercent}%` }}></div>
              </div>
              <p className="text-[10px] text-white/40 leading-relaxed">
                Você ainda possui **R$ {summary.totalAvailable.toLocaleString('pt-BR')}** de fôlego financeiro nos seus cartões.
              </p>
            </div>

            <div className="space-y-3">
              <h4 className="text-[10px] uppercase font-bold text-white/40 tracking-widest">Próximas Faturas</h4>
              <div className="space-y-2">
                {cards.slice(0, 3).map(card => (
                  <div key={card.id} className="flex items-center justify-between p-2 bg-white/5 rounded-lg border border-white/5">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-brand-secondary"></div>
                      <span className="text-xs font-bold">{card.name}</span>
                    </div>
                    <div className="text-right flex items-center gap-4">
                      <div>
                        <div className="text-xs font-bold">R$ {card.used.toLocaleString('pt-BR')}</div>
                        <div className="text-[8px] text-white/40 uppercase font-bold">Vence {format(new Date(new Date().getFullYear(), new Date().getMonth(), card.due_day, 12, 0, 0, 0), "dd/MM", { locale: ptBR })}</div>
                      </div>
                      {card.used > 0 && (
                        <button
                          onClick={() => onPayCardBill?.(card)}
                          className="p-1.5 rounded-lg bg-brand-primary/10 text-brand-primary hover:bg-brand-primary hover:text-black transition-all"
                        >
                          <CheckCircle2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 10. Cartão com Maior Pressão */}
        <div className="col-span-4 glass-card !p-5 bg-red-500/5 border-red-500/20 flex flex-col justify-between">
          <div>
            <h3 className="font-bold text-sm flex items-center gap-2 mb-4 text-red-400">
              <AlertTriangle size={16} /> Foco de Atenção
            </h3>
            {summary.pressureCard ? (
              <div className="space-y-4">
                <div className="p-3 bg-red-500/10 rounded-xl border border-red-500/20">
                  <div className="text-[10px] text-red-400/60 uppercase font-bold mb-1">Cartão mais pressionado</div>
                  <div className="text-lg font-bold">{summary.pressureCard.name}</div>
                  <div className="text-xs text-white/60">Uso de {((summary.pressureCard.used / summary.pressureCard.limit) * 100).toFixed(0)}% do limite</div>
                </div>
                <p className="text-[10px] text-white/40 leading-relaxed">
                  Este cartão concentra o maior risco de estouro de limite. Evite novas compras parceladas nele neste ciclo.
                </p>
              </div>
            ) : (
              <div className="text-xs text-white/20 text-center py-8">Nenhum cartão cadastrado.</div>
            )}
          </div>
          <button className="w-full py-2 bg-red-500/20 text-red-400 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-red-500/30 transition-all">
            Analisar Fatura
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* 12. Parcelamentos e Compromissos Futuros */}
        <div className="col-span-7 glass-card !p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm flex items-center gap-2">
              <Clock size={16} className="text-white/60" /> Parcelamentos Ativos
            </h3>
            <div className="flex items-center gap-3">
              <div className="text-[10px] text-white/40 uppercase font-bold">Impacto Mensal: R$ {monthlyInstallmentsTotal.toLocaleString('pt-BR')}</div>
              <button
                type="button"
                onClick={onAddInstallment}
                className="px-2.5 py-1.5 rounded-lg bg-brand-primary/20 text-brand-primary text-[10px] font-bold uppercase tracking-widest hover:bg-brand-primary/30 transition-all"
              >
                Novo Parcelamento
              </button>
            </div>
          </div>
          
          <div className="space-y-2 max-h-[180px] overflow-y-auto no-scrollbar">
            {installments.map(inst => {
              const remainingInstallments = inst.total_installments - inst.current_installment + 1;
              const remainingAmount = inst.monthly_amount * (inst.total_installments - inst.current_installment + 1);
              const isBoleto = !inst.card_id;
              const today = new Date();
              const currentMonth = format(today, 'yyyy-MM');
              const isPaidThisMonth = inst.last_paid_month === currentMonth;
              const isFinished = inst.current_installment > inst.total_installments;
              
              const nextDateBase = new Date(today.getFullYear(), today.getMonth(), inst.due_day || 1, 12, 0, 0, 0);
              const displayNextDate = isPaidThisMonth ? addMonths(nextDateBase, 1) : nextDateBase;

              if (isFinished) return null;

              return (
                <div key={inst.id} className="p-4 bg-white/5 rounded-xl border border-white/5 flex items-center justify-between group hover:border-white/10 transition-all">
                  <div className="flex items-center gap-4 flex-1">
                    <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${isBoleto ? 'bg-yellow-500/10 text-yellow-400' : 'bg-brand-secondary/10 text-brand-secondary'}`}>
                      {isBoleto ? <AlertTriangle size={20} /> : <CardIcon size={20} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold truncate">{inst.description}</span>
                        <span className={`text-[8px] px-1.5 py-0.5 rounded uppercase font-bold ${isBoleto ? 'bg-yellow-500/20 text-yellow-500' : 'bg-brand-secondary/20 text-brand-secondary'}`}>
                          {isBoleto ? 'Boleto' : cardNameById[inst.card_id!] || 'Cartão'}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 size={12} className={isPaidThisMonth ? "text-green-400" : "text-white/20"} />
                          <span className="text-[10px] text-white/40 uppercase font-medium">Parcela: <span className="text-white">{inst.current_installment}/{inst.total_installments}</span></span>
                        </div>
                        <div className="flex items-center gap-1.5 border-l border-white/10 pl-3">
                          <Clock size={12} className="text-brand-primary" />
                          <span className="text-[10px] text-white/40 uppercase font-medium">Faltam: <span className="text-white">R$ {remainingAmount.toLocaleString('pt-BR')}</span></span>
                        </div>
                        <div className="flex items-center gap-1.5 border-l border-white/10 pl-3">
                          <Calendar size={12} className="text-white/40" />
                          <span className="text-[10px] text-white/40 uppercase font-medium">Próximo: <span className="text-brand-primary">{format(displayNextDate, "dd 'de' MMMM", { locale: ptBR })}</span></span>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <div className="text-[10px] text-white/40 uppercase font-bold mb-0.5 text-brand-secondary">Mensal</div>
                      <div className="text-sm font-bold">R$ {inst.monthly_amount.toLocaleString('pt-BR')}</div>
                    </div>

                    <div className="flex items-center gap-2 border-l border-white/10 pl-4">
                      {isPaidThisMonth ? (
                        <button
                          type="button"
                          onClick={() => onPayInstallment?.(inst)}
                          className="px-3 py-1.5 rounded-lg bg-green-500/10 text-green-400 text-[10px] font-bold uppercase hover:bg-green-500/20 transition-all flex items-center gap-1"
                        >
                          <CheckCircle2 size={12} /> Antecipar
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onPayInstallment?.(inst)}
                          className="px-3 py-1.5 rounded-lg bg-brand-primary text-black text-[10px] font-bold uppercase hover:bg-brand-primary/80 transition-all flex items-center gap-1"
                        >
                          <TrendingUp size={12} /> Pagar
                        </button>
                      )}
                      
                      <div className="flex items-center gap-1 ml-2">
                        <button
                          type="button"
                          onClick={() => onEditInstallment?.(inst)}
                          className="p-2 text-white/20 hover:text-white hover:bg-white/5 rounded-lg transition-all"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteInstallment?.(inst)}
                          className="p-2 text-white/20 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {installments.length === 0 && (
              <div className="text-xs text-white/20 text-center py-8">Nenhum parcelamento ativo identificado.</div>
            )}
          </div>
        </div>

        {/* 13. Alertas de Cartão */}
        <div className="col-span-5 glass-card !p-5 flex flex-col gap-4">
          <h3 className="font-bold text-sm flex items-center gap-2">
            <Info size={16} className="text-brand-primary" /> Alertas de Crédito
          </h3>
          <div className="space-y-3">
            {summary.usagePercent > 70 && (
              <div className="flex items-start gap-3 p-3 bg-red-500/10 rounded-xl border border-red-500/20">
                <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
                <div className="text-[10px] leading-relaxed">
                  <span className="font-bold text-red-400 block uppercase mb-1">Limite Global Crítico</span>
                  Você já utilizou mais de 70% do seu crédito total. Isso pode impactar seu score e reduzir sua margem de emergência.
                </div>
              </div>
            )}
            {monthlyInstallmentsTotal > 1000 && (
              <div className="flex items-start gap-3 p-3 bg-yellow-500/10 rounded-xl border border-yellow-500/20">
                <Clock size={16} className="text-yellow-400 shrink-0 mt-0.5" />
                <div className="text-[10px] leading-relaxed">
                  <span className="font-bold text-yellow-400 block uppercase mb-1">Pressão de Parcelamento</span>
                  Suas parcelas de cartão somam R$ {monthlyInstallmentsTotal.toLocaleString('pt-BR')} este mês. Este valor já está comprometido nos próximos ciclos.
                </div>
              </div>
            )}
            {summary.usagePercent <= 50 && (
              <div className="flex items-start gap-3 p-3 bg-green-500/10 rounded-xl border border-green-500/20">
                <CheckCircle2 size={16} className="text-green-400 shrink-0 mt-0.5" />
                <div className="text-[10px] leading-relaxed">
                  <span className="font-bold text-green-400 block uppercase mb-1">Uso Saudável</span>
                  Seu uso de crédito está abaixo de 50%. Esta é uma excelente zona de segurança para sua saúde financeira.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 14. Ações de Gerenciamento */}
      <div className="flex items-center justify-between pt-4 border-t border-white/5 shrink-0">
        <p className="text-[10px] text-white/20 uppercase font-bold tracking-widest">
          O uso inteligente do cartão de crédito é a base da alavancagem financeira.
        </p>
        <div className="flex gap-2">
          <button className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all">
            Exportar Relatório
          </button>
          <button className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all">
            Ajustar Limites
          </button>
        </div>
      </div>
    </div>
  );
}
