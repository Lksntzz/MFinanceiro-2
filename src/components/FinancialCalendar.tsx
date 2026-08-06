import React, { useMemo, useState } from 'react';
import { addMonths, endOfMonth, eachDayOfInterval, format, getDay, isToday, startOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ArrowDownCircle, ArrowUpCircle, Calendar as CalendarIcon, ChevronLeft, ChevronRight, DollarSign } from 'lucide-react';

interface CalendarEvent {
  id: string;
  day: number;
  name: string;
  amount: number;
  type: 'income' | 'expense';
  status: string;
}

export default function FinancialCalendar({ fixedBills = [], settings }: { fixedBills: any[]; settings: any }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const events = useMemo<CalendarEvent[]>(() => {
    const list: CalendarEvent[] = fixedBills
      .filter((bill) => Number(bill.due_day) >= 1 && Number(bill.due_day) <= 31)
      .map((bill) => ({
        id: `bill-${bill.id}`,
        day: Number(bill.due_day),
        name: String(bill.name || 'Conta fixa'),
        amount: Math.abs(Number(bill.amount || 0)),
        type: 'expense' as const,
        status: String(bill.status || 'pending'),
      }));

    const netSalary = Math.max(0, Number(settings?.net_salary_estimated || 0));
    const firstPayday = Number(settings?.payday_1 || 0);
    const secondPayday = Number(settings?.payday_2 || 0);
    const firstPercentage = Number(settings?.payday_1_percentage ?? (secondPayday ? 50 : 100));
    const secondPercentage = Number(settings?.payday_2_percentage ?? (secondPayday ? 50 : 0));

    if (firstPayday >= 1 && firstPayday <= 31 && netSalary > 0) {
      list.push({
        id: 'income-1', day: firstPayday, name: secondPayday ? 'Salário (1ª parte)' : 'Salário',
        amount: (netSalary * firstPercentage) / 100, type: 'income', status: 'ready',
      });
    }
    if (secondPayday >= 1 && secondPayday <= 31 && netSalary > 0) {
      list.push({
        id: 'income-2', day: secondPayday, name: 'Salário (2ª parte)',
        amount: (netSalary * secondPercentage) / 100, type: 'income', status: 'ready',
      });
    }

    return list.sort((a, b) => a.day - b.day || a.name.localeCompare(b.name));
  }, [fixedBills, settings]);

  const summary = useMemo(() => {
    const pendingExpenses = events.filter((event) => event.type === 'expense' && event.status !== 'paid');
    const incomes = events.filter((event) => event.type === 'income');
    const today = new Date();
    const isCurrentMonth = today.getFullYear() === currentDate.getFullYear() && today.getMonth() === currentDate.getMonth();
    const referenceDay = isCurrentMonth ? today.getDate() : 1;
    const nextIncome = incomes.find((event) => event.day >= referenceDay) || incomes[0] || null;
    const nextExpense = pendingExpenses.find((event) => event.day >= referenceDay) || pendingExpenses[0] || null;
    const incomeTotal = incomes.reduce((sum, event) => sum + event.amount, 0);
    const expenseTotal = pendingExpenses.reduce((sum, event) => sum + event.amount, 0);
    return { nextIncome, nextExpense, incomeTotal, expenseTotal, balance: incomeTotal - expenseTotal };
  }, [events, currentDate]);

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden animate-fade-in">
      <div className="flex shrink-0 items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-primary/10 text-brand-primary"><CalendarIcon size={20} /></div>
          <div><h2 className="text-xl font-black capitalize">{format(currentDate, 'MMMM yyyy', { locale: ptBR })}</h2><p className="text-[9px] font-bold uppercase tracking-widest text-white/35">Calendário de obrigações</p></div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setCurrentDate((value) => addMonths(value, -1))} className="rounded-lg p-2 text-white/40 hover:bg-white/5 hover:text-white"><ChevronLeft size={20} /></button>
          <button onClick={() => setCurrentDate(new Date())} className="rounded-lg bg-white/5 px-3 py-2 text-[10px] font-bold text-white/50">Hoje</button>
          <button onClick={() => setCurrentDate((value) => addMonths(value, 1))} className="rounded-lg p-2 text-white/40 hover:bg-white/5 hover:text-white"><ChevronRight size={20} /></button>
        </div>
      </div>

      <section className="flex-1 min-h-0 grid grid-cols-7 grid-rows-[auto_repeat(6,minmax(0,1fr))] gap-1.5 overflow-hidden">
        {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((day) => <div key={day} className="py-1 text-center text-[9px] font-bold uppercase text-white/25">{day}</div>)}
        {Array.from({ length: getDay(monthStart) }).map((_, index) => <div key={`empty-${index}`} className="rounded-xl border border-white/[0.03] bg-white/[0.01]" />)}
        {days.map((date) => {
          const dayEvents = events.filter((event) => event.day === date.getDate());
          const visible = dayEvents.slice(0, 2);
          return (
            <article key={date.toISOString()} className={`min-h-0 rounded-xl border p-1.5 ${isToday(date) ? 'border-brand-primary/30 bg-brand-primary/5' : 'border-white/5 bg-white/[0.03]'}`}>
              <div className={`text-[10px] font-bold ${isToday(date) ? 'text-brand-primary' : 'text-white/35'}`}>{date.getDate()}</div>
              <div className="mt-1 space-y-1">
                {visible.map((event) => (
                  <div key={event.id} title={`${event.name}: ${money(event.amount)}`} className={`truncate rounded-md px-1.5 py-1 text-[8px] font-bold ${event.type === 'income' ? 'bg-green-500/10 text-green-400' : event.status === 'paid' ? 'bg-white/5 text-white/30 line-through' : 'bg-red-500/10 text-red-400'}`}>
                    {event.type === 'income' ? '+' : '-'} {event.name}
                  </div>
                ))}
                {dayEvents.length > 2 && <div className="text-[8px] text-white/25">+{dayEvents.length - 2} evento(s)</div>}
              </div>
            </article>
          );
        })}
      </section>

      <section className="grid shrink-0 grid-cols-1 md:grid-cols-3 gap-3">
        <Summary icon={ArrowUpCircle} label="Próxima entrada" value={summary.nextIncome ? `Dia ${summary.nextIncome.day} • ${money(summary.nextIncome.amount)}` : 'Nenhuma entrada prevista'} tone="positive" />
        <Summary icon={ArrowDownCircle} label="Próxima saída pendente" value={summary.nextExpense ? `Dia ${summary.nextExpense.day} • ${money(summary.nextExpense.amount)}` : 'Nenhuma saída pendente'} tone="negative" />
        <Summary icon={DollarSign} label="Saldo previsto do mês" value={money(summary.balance)} tone={summary.balance >= 0 ? 'brand' : 'negative'} />
      </section>
    </div>
  );
}

function money(value: number) { return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function Summary({ icon: Icon, label, value, tone }: { icon: React.ComponentType<{ size?: number }>; label: string; value: string; tone: 'positive' | 'negative' | 'brand' }) { const style = tone === 'positive' ? 'text-green-400 bg-green-500/10' : tone === 'negative' ? 'text-red-400 bg-red-500/10' : 'text-brand-primary bg-brand-primary/10'; return <div className="glass-card !p-3 flex min-w-0 items-center gap-3"><div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${style}`}><Icon size={18} /></div><div className="min-w-0"><span className="block truncate text-[9px] font-bold uppercase tracking-widest text-white/35">{label}</span><strong className="block truncate text-xs">{value}</strong></div></div>; }
