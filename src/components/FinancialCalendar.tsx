import React, { useMemo } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, getDay, isToday } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, DollarSign, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import { motion } from 'framer-motion';

export default function FinancialCalendar({ fixedBills, settings }: { fixedBills: any[], settings: any }) {
  const [currentDate, setCurrentDate] = React.useState(new Date());

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const events = useMemo(() => {
    const list: any[] = [];
    
    // Contas Fixas
    fixedBills.forEach(bill => {
      list.push({
        day: bill.due_day,
        name: bill.name,
        amount: bill.amount,
        type: 'expense',
        status: bill.status
      });
    });

    // Paydays
    if (settings.payday_1) {
      list.push({
        day: settings.payday_1,
        name: 'Salário (Lote 1)',
        amount: settings.net_salary_estimated * (settings.payday_1_percentage || 50) / 100,
        type: 'income',
        status: 'ready'
      });
    }
    if (settings.payday_2) {
      list.push({
        day: settings.payday_2,
        name: 'Salário (Lote 2)',
        amount: settings.net_salary_estimated * (settings.payday_2_percentage || 50) / 100,
        type: 'income',
        status: 'ready'
      });
    }

    return list;
  }, [fixedBills, settings]);

  const daysOfWeek = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  return (
    <div className="flex-1 flex flex-col gap-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-brand-primary/10 flex items-center justify-center text-brand-primary">
            <CalendarIcon size={20} />
          </div>
          <div>
            <h2 className="text-xl font-black tracking-tight">{format(currentDate, 'MMMM yyyy', { locale: ptBR })}</h2>
            <p className="text-[10px] uppercase font-black tracking-widest text-white/40 mt-0.5">Calendário de Obrigações</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setCurrentDate(new Date(currentDate.setMonth(currentDate.getMonth() - 1)))} className="p-2 hover:bg-white/5 rounded-lg transition-all text-white/40 hover:text-white"><ChevronLeft size={20} /></button>
          <button onClick={() => setCurrentDate(new Date(currentDate.setMonth(currentDate.getMonth() + 1)))} className="p-2 hover:bg-white/5 rounded-lg transition-all text-white/40 hover:text-white"><ChevronRight size={20} /></button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-2">
        {daysOfWeek.map(day => (
          <div key={day} className="text-center text-[10px] font-black uppercase text-white/20 tracking-widest py-2">
            {day}
          </div>
        ))}

        {/* Empty cells for padding */}
        {Array.from({ length: getDay(monthStart) }).map((_, i) => (
          <div key={`empty-${i}`} className="h-32 rounded-[24px] bg-white/[0.01] border border-white/5" />
        ))}

        {days.map(date => {
          const dayEvents = events.filter(e => e.day === date.getDate());
          const isTodayDate = isToday(date);
          
          return (
            <div 
              key={date.toString()} 
              className={`h-32 rounded-[24px] border p-2 flex flex-col gap-1 transition-all ${
                isTodayDate ? 'bg-brand-primary/5 border-brand-primary/30' : 'bg-white/5 border-white/5 hover:bg-white/10'
              }`}
            >
              <span className={`text-xs font-black ml-1 ${isTodayDate ? 'text-brand-primary' : 'text-white/40'}`}>
                {date.getDate()}
              </span>
              
              <div className="flex-1 overflow-y-auto no-scrollbar space-y-1">
                {dayEvents.map((e, idx) => (
                  <div 
                    key={idx} 
                    className={`p-1.5 rounded-lg flex flex-col gap-0.5 ${
                      e.type === 'income' ? 'bg-green-500/10 text-green-400' : 
                      e.status === 'paid' ? 'bg-white/10 text-white/40' : 'bg-red-500/10 text-red-400'
                    }`}
                  >
                    <div className="text-[8px] font-black uppercase truncate leading-none">{e.name}</div>
                    <div className="text-[10px] font-bold leading-none">
                      {e.type === 'income' ? '+' : '-'} R$ {e.amount.toLocaleString('pt-BR')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="glass-card !p-4 flex items-center gap-4">
          <div className="h-10 w-10 rounded-xl bg-green-500/10 flex items-center justify-center text-green-400">
            <ArrowUpCircle size={20} />
          </div>
          <div>
            <span className="text-[10px] font-black uppercase tracking-widest text-white/40 block">Próxima Entrada</span>
            <span className="text-sm font-bold">Reserva confirmada</span>
          </div>
        </div>
        <div className="glass-card !p-4 flex items-center gap-4">
          <div className="h-10 w-10 rounded-xl bg-red-500/10 flex items-center justify-center text-red-400">
            <ArrowDownCircle size={20} />
          </div>
          <div>
            <span className="text-[10px] font-black uppercase tracking-widest text-white/40 block">Saída Pendente</span>
            <span className="text-sm font-bold">Vencimento em 3 dias</span>
          </div>
        </div>
        <div className="glass-card !p-4 flex items-center gap-4 border-brand-primary/20">
          <div className="h-10 w-10 rounded-xl bg-brand-primary/10 flex items-center justify-center text-brand-primary">
            <DollarSign size={20} />
          </div>
          <div>
            <span className="text-[10px] font-black uppercase tracking-widest text-white/40 block">Total do Mês</span>
            <span className="text-sm font-bold">Sob controle</span>
          </div>
        </div>
      </div>
    </div>
  );
}
