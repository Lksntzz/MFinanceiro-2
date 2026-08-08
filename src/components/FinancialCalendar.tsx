import React, { useEffect, useMemo, useState } from 'react';
import { addMonths, eachDayOfInterval, endOfMonth, format, getDay, getDaysInMonth, isToday, startOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ArrowDownCircle, ArrowUpCircle, Calendar as CalendarIcon, ChevronLeft, ChevronRight, DollarSign } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface CalendarEvent {
  id: string;
  day: number;
  name: string;
  amount: number;
  type: 'income' | 'expense';
  status: string;
  affectsSummary?: boolean;
  informational?: boolean;
}

type BillOccurrence = {
  id: string;
  due_date: string;
  amount: number;
  status: string;
  fixed_bill?: { name?: string | null } | null;
};

type CalendarProps = {
  fixedBills?: any[];
  settings: any;
  subscriptions?: any[];
  cards?: any[];
  installments?: any[];
};

function monthKey(date: Date) {
  return format(startOfMonth(date), 'yyyy-MM-01');
}

function safeRecurringDay(raw: unknown, reference: Date) {
  const requested = Math.max(1, Math.min(31, Math.round(Number(raw || 1))));
  return Math.min(requested, getDaysInMonth(reference));
}

export default function FinancialCalendar({
  fixedBills = [],
  settings,
  subscriptions = [],
  cards = [],
  installments = [],
}: CalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [occurrences, setOccurrences] = useState<BillOccurrence[]>([]);
  const [occurrencesLoaded, setOccurrencesLoaded] = useState(false);
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const userId = String(settings?.user_id || '');

  useEffect(() => {
    let active = true;
    if (!userId) {
      setOccurrences([]);
      setOccurrencesLoaded(false);
      return () => { active = false; };
    }

    async function loadOccurrences() {
      setOccurrencesLoaded(false);
      const { error: ensureError } = await supabase.rpc('mf_ensure_fixed_bill_occurrences', { p_months_ahead: 12 });
      if (ensureError) {
        console.warn('Não foi possível preparar as ocorrências do calendário:', ensureError);
        if (active) setOccurrencesLoaded(false);
        return;
      }

      const { data, error } = await supabase
        .from('mf_fixed_bill_occurrences')
        .select('id,due_date,amount,status,fixed_bill:mf_fixed_bills(name)')
        .eq('user_id', userId)
        .eq('competence', monthKey(currentDate))
        .order('due_date', { ascending: true });

      if (!active) return;
      if (error) {
        console.warn('Não foi possível carregar as ocorrências do calendário:', error);
        setOccurrencesLoaded(false);
        return;
      }

      setOccurrences((data || []).map((row: any) => ({
        ...row,
        amount: Math.abs(Number(row.amount || 0)),
        fixed_bill: Array.isArray(row.fixed_bill) ? row.fixed_bill[0] : row.fixed_bill,
      })) as BillOccurrence[]);
      setOccurrencesLoaded(true);
    }

    void loadOccurrences();
    const channel = supabase
      .channel(`financial-calendar-${userId}-${format(currentDate, 'yyyy-MM')}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_fixed_bill_occurrences', filter: `user_id=eq.${userId}` }, () => void loadOccurrences())
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [userId, currentDate.getFullYear(), currentDate.getMonth()]);

  const annualSubscriptionsWithoutMonth = subscriptions.filter((item) =>
    !['inactive', 'cancelled', 'canceled'].includes(String(item.status || '').toLowerCase())
    && String(item.billing_cycle || '').toLowerCase().includes('year'),
  ).length;

  const events = useMemo<CalendarEvent[]>(() => {
    const billEvents: CalendarEvent[] = occurrencesLoaded
      ? occurrences
          .filter((row) => row.status !== 'skipped')
          .map((row) => {
            const dueDate = new Date(`${String(row.due_date).slice(0, 10)}T12:00:00`);
            return {
              id: `occurrence-${row.id}`,
              day: Number.isNaN(dueDate.getTime()) ? 1 : dueDate.getDate(),
              name: String(row.fixed_bill?.name || 'Conta fixa'),
              amount: Math.abs(Number(row.amount || 0)),
              type: 'expense' as const,
              status: String(row.status || 'pending'),
            };
          })
      : fixedBills
          .filter((bill) => bill.active !== false)
          .map((bill) => ({
            id: `bill-${bill.id}`,
            day: safeRecurringDay(bill.default_due_day ?? bill.due_day, currentDate),
            name: String(bill.name || 'Conta fixa'),
            amount: Math.abs(Number(bill.default_amount ?? bill.amount ?? 0)),
            type: 'expense' as const,
            status: String(bill.status || 'pending'),
          }));

    const list: CalendarEvent[] = [...billEvents];

    subscriptions
      .filter((item) => !['inactive', 'cancelled', 'canceled'].includes(String(item.status || '').toLowerCase()))
      .filter((item) => !String(item.billing_cycle || '').toLowerCase().includes('year'))
      .forEach((item) => {
        list.push({
          id: `subscription-${item.id}`,
          day: safeRecurringDay(item.due_day, currentDate),
          name: `Assinatura: ${String(item.name || 'Serviço')}`,
          amount: Math.abs(Number(item.amount || 0)),
          type: 'expense',
          status: String(item.status || 'pending'),
        });
      });

    cards
      .filter((card) => Number(card.used || 0) > 0)
      .forEach((card) => {
        list.push({
          id: `card-${card.id}`,
          day: safeRecurringDay(card.due_day, currentDate),
          name: `Fatura: ${String(card.name || 'Cartão')}`,
          amount: Math.abs(Number(card.used || 0)),
          type: 'expense',
          status: 'pending',
        });
      });

    const cardIds = new Set(cards.map((card) => String(card.id)));
    installments
      .filter((item) => Number(item.current_installment || 1) <= Number(item.total_installments || 1))
      .forEach((item) => {
        const includedInCardBill = Boolean(item.card_id) && cardIds.has(String(item.card_id));
        list.push({
          id: `installment-${item.id}`,
          day: safeRecurringDay(item.due_day, currentDate),
          name: `Parcela: ${String(item.description || 'Parcelamento')}`,
          amount: Math.abs(Number(item.monthly_amount || 0)),
          type: 'expense',
          status: 'pending',
          affectsSummary: !includedInCardBill,
          informational: includedInCardBill,
        });
      });

    const netSalary = Math.max(0, Number(settings?.net_salary_estimated || 0));
    const firstPayday = Number(settings?.payday_1 || 0);
    const secondPayday = settings?.payday_cycle === 'biweekly' ? Number(settings?.payday_2 || 0) : 0;
    const firstPercentage = Number(settings?.payday_1_percentage ?? (secondPayday ? 50 : 100));
    const secondPercentage = Number(settings?.payday_2_percentage ?? (secondPayday ? 50 : 0));

    if (firstPayday >= 1 && firstPayday <= 31 && netSalary > 0) {
      list.push({
        id: 'income-1',
        day: safeRecurringDay(firstPayday, currentDate),
        name: secondPayday ? 'Renda prevista (1ª parte)' : 'Renda prevista',
        amount: (netSalary * firstPercentage) / 100,
        type: 'income',
        status: 'ready',
      });
    }
    if (secondPayday >= 1 && secondPayday <= 31 && netSalary > 0) {
      list.push({
        id: 'income-2',
        day: safeRecurringDay(secondPayday, currentDate),
        name: 'Renda prevista (2ª parte)',
        amount: (netSalary * secondPercentage) / 100,
        type: 'income',
        status: 'ready',
      });
    }

    return list.sort((a, b) => a.day - b.day || a.name.localeCompare(b.name));
  }, [fixedBills, settings, occurrences, occurrencesLoaded, currentDate, subscriptions, cards, installments]);

  const summary = useMemo(() => {
    const pendingExpenses = events.filter((event) => event.type === 'expense' && event.status !== 'paid' && event.affectsSummary !== false);
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
          <div><h2 className="text-xl font-black capitalize">{format(currentDate, 'MMMM yyyy', { locale: ptBR })}</h2><p className="text-[9px] font-bold uppercase tracking-widest text-white/35">Agenda de entradas e compromissos</p></div>
        </div>
        <div className="flex gap-2">
          <button aria-label="Mês anterior" onClick={() => setCurrentDate((value) => addMonths(value, -1))} className="rounded-lg p-2 text-white/40 hover:bg-white/5 hover:text-white"><ChevronLeft size={20} /></button>
          <button onClick={() => setCurrentDate(new Date())} className="rounded-lg bg-white/5 px-3 py-2 text-[10px] font-bold text-white/50">Hoje</button>
          <button aria-label="Próximo mês" onClick={() => setCurrentDate((value) => addMonths(value, 1))} className="rounded-lg p-2 text-white/40 hover:bg-white/5 hover:text-white"><ChevronRight size={20} /></button>
        </div>
      </div>

      <section className="flex-1 min-h-0 grid grid-cols-7 grid-rows-[auto_repeat(6,minmax(0,1fr))] gap-1.5 overflow-hidden">
        {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((day) => <div key={day} className="py-1 text-center text-[9px] font-bold uppercase text-white/25">{day}</div>)}
        {Array.from({ length: getDay(monthStart) }).map((_, index) => <div key={`empty-${index}`} className="rounded-xl border border-white/[0.03] bg-white/[0.01]" />)}
        {days.map((date) => {
          const dayEvents = events.filter((event) => event.day === date.getDate());
          const visible = dayEvents.slice(0, 3);
          return (
            <article key={date.toISOString()} className={`min-h-0 rounded-xl border p-1.5 ${isToday(date) ? 'border-brand-primary/30 bg-brand-primary/5' : 'border-white/5 bg-white/[0.03]'}`}>
              <div className={`text-[10px] font-bold ${isToday(date) ? 'text-brand-primary' : 'text-white/35'}`}>{date.getDate()}</div>
              <div className="mt-1 space-y-1">
                {visible.map((event) => (
                  <div key={event.id} title={`${event.name}: ${money(event.amount)}${event.informational ? ' · já incluído na fatura' : ''}`} className={`truncate rounded-md px-1.5 py-1 text-[8px] font-bold ${event.type === 'income' ? 'bg-green-500/10 text-green-400' : event.informational ? 'bg-violet-500/10 text-violet-300' : event.status === 'paid' ? 'bg-white/5 text-white/30 line-through' : 'bg-red-500/10 text-red-400'}`}>
                    {event.type === 'income' ? '+' : event.informational ? '•' : '-'} {event.name}
                  </div>
                ))}
                {dayEvents.length > 3 && <div className="text-[8px] text-white/25">+{dayEvents.length - 3} evento(s)</div>}
              </div>
            </article>
          );
        })}
      </section>

      <section className="grid shrink-0 grid-cols-1 md:grid-cols-3 gap-3">
        <Summary icon={ArrowUpCircle} label="Próxima entrada" value={summary.nextIncome ? `Dia ${summary.nextIncome.day} • ${money(summary.nextIncome.amount)}` : 'Nenhuma entrada prevista'} tone="positive" />
        <Summary icon={ArrowDownCircle} label="Próxima saída pendente" value={summary.nextExpense ? `Dia ${summary.nextExpense.day} • ${money(summary.nextExpense.amount)}` : 'Nenhuma saída pendente'} tone="negative" />
        <Summary icon={DollarSign} label="Fluxo previsto do mês" value={money(summary.balance)} tone={summary.balance >= 0 ? 'brand' : 'negative'} />
      </section>

      {(annualSubscriptionsWithoutMonth > 0 || installments.some((item) => item.card_id)) && (
        <p className="shrink-0 text-[9px] leading-relaxed text-white/30">
          Parcelas vinculadas a cartões aparecem como referência, mas não são somadas novamente à fatura. {annualSubscriptionsWithoutMonth > 0 ? `${annualSubscriptionsWithoutMonth} assinatura(s) anual(is) não entram no calendário porque o mês da renovação ainda não é armazenado.` : ''}
        </p>
      )}
    </div>
  );
}

function money(value: number) { return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function Summary({ icon: Icon, label, value, tone }: { icon: React.ComponentType<{ size?: number }>; label: string; value: string; tone: 'positive' | 'negative' | 'brand' }) { const style = tone === 'positive' ? 'text-green-400 bg-green-500/10' : tone === 'negative' ? 'text-red-400 bg-red-500/10' : 'text-brand-primary bg-brand-primary/10'; return <div className="glass-card !p-3 flex min-w-0 items-center gap-3"><div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${style}`}><Icon size={18} /></div><div className="min-w-0"><span className="block truncate text-[9px] font-bold uppercase tracking-widest text-white/35">{label}</span><strong className="block truncate text-xs">{value}</strong></div></div>; }
