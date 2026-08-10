import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, CalendarDays, CheckCircle2, Clock3, CreditCard as CreditCardIcon, Repeat2 } from 'lucide-react';

import { useApp } from '../context/AppContext';
import { formatCurrency } from '../lib/formatters';
import { supabase } from '../lib/supabase';
import type { CardInstallment, CreditCard, FixedBill, Subscription, UserSettings } from '../types';

type TimelineItem = { id: string; day: number; title: string; subtitle: string; amount: number; direction: 'income' | 'expense'; status: 'realized' | 'planned' | 'informational'; icon: React.ComponentType<{ size?: number }> };
function currentMonthKey() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`; }
function safeDay(value: unknown) { const day = Number(value || 1); return Math.min(31, Math.max(1, Number.isFinite(day) ? Math.trunc(day) : 1)); }

export default function FinancialTimeline({ userId, settings, fixedBills, subscriptions, cards, installments }: { userId: string; settings: UserSettings | null; fixedBills: FixedBill[]; subscriptions: Subscription[]; cards: CreditCard[]; installments: CardInstallment[] }) {
  const { isPrivate } = useApp();
  const [realized, setRealized] = useState<TimelineItem[]>([]);

  useEffect(() => {
    let active = true;
    const month = currentMonthKey();
    const loadRealized = async () => {
      try {
        const { data, error } = await supabase.rpc('mf_get_ledger_page', { p_page_size: 250, p_cursor_date: null, p_cursor_created_at: null, p_cursor_id: null });
        if (!active || error) return;
        const items = Array.isArray((data as any)?.items) ? (data as any).items : [];
        setRealized(items.filter((item: any) => String(item.date || '').startsWith(month)).map((item: any) => ({ id: `ledger:${item.id}`, day: safeDay(String(item.date || '').slice(8, 10)), title: item.description || item.category || 'Movimentação', subtitle: item.category || 'Realizado', amount: Math.abs(Number(item.amount || 0)), direction: item.type === 'income' || Number(item.amount || 0) > 0 ? 'income' : 'expense', status: 'realized', icon: item.type === 'income' || Number(item.amount || 0) > 0 ? ArrowUpRight : ArrowDownRight })));
      } catch {
        if (active) setRealized([]);
      }
    };
    void loadRealized();
    return () => { active = false; };
  }, [userId]);

  const planned = useMemo<TimelineItem[]>(() => {
    const rows: TimelineItem[] = [];
    fixedBills.filter((bill: any) => bill.status !== 'paid').forEach((bill) => rows.push({ id: `fixed:${bill.id}`, day: safeDay((bill as any).due_day), title: bill.name, subtitle: 'Recorrência', amount: Math.abs(Number(bill.amount || 0)), direction: 'expense', status: 'planned', icon: Repeat2 }));
    subscriptions.forEach((subscription: any) => rows.push({ id: `subscription:${subscription.id}`, day: safeDay(subscription.due_day), title: subscription.name || 'Assinatura', subtitle: 'Assinatura', amount: Math.abs(Number(subscription.amount || 0)), direction: 'expense', status: 'planned', icon: Repeat2 }));
    cards.forEach((card: any) => rows.push({ id: `card:${card.id}`, day: safeDay(card.due_day), title: card.name || 'Fatura do cartão', subtitle: 'Fatura prevista', amount: Math.abs(Number(card.used || 0)), direction: 'expense', status: 'planned', icon: CreditCardIcon }));
    installments.forEach((installment: any) => {
      const linkedToCard = Boolean(installment.card_id || installment.credit_card_id);
      rows.push({ id: `installment:${installment.id}`, day: safeDay(installment.due_day), title: installment.description || 'Parcela', subtitle: `Parcela ${Number(installment.current_installment || 1)}/${Number(installment.total_installments || 1)}`, amount: Math.abs(Number(installment.monthly_amount || 0)), direction: 'expense', status: linkedToCard ? 'informational' : 'planned', icon: Clock3 });
    });
    const income = Math.max(0, Number((settings as any)?.net_salary_estimated || 0));
    if (income > 0) {
      const split = (settings as any)?.payday_cycle === 'biweekly';
      const firstShare = split ? Number((settings as any)?.payday_1_percentage ?? 60) / 100 : 1;
      rows.push({ id: 'income:1', day: safeDay((settings as any)?.payday_1 || 5), title: 'Receita prevista', subtitle: 'Renda recorrente', amount: income * firstShare, direction: 'income', status: 'planned', icon: ArrowUpRight });
      if (split) rows.push({ id: 'income:2', day: safeDay((settings as any)?.payday_2 || 20), title: 'Receita prevista · 2ª parte', subtitle: 'Renda recorrente', amount: income * (Number((settings as any)?.payday_2_percentage ?? 40) / 100), direction: 'income', status: 'planned', icon: ArrowUpRight });
    }
    return rows;
  }, [cards, fixedBills, installments, settings, subscriptions]);

  const items = useMemo(() => [...realized, ...planned].sort((a, b) => a.day - b.day || (a.status === 'realized' ? -1 : 1)), [planned, realized]);
  return <section className="mf-card mf-financial-timeline"><div className="mf-timeline-heading"><span><CalendarDays size={17} /><strong>Linha do tempo do mês</strong></span><small>Realizado + previsto no mesmo contexto</small></div><div className="mf-timeline-list">{items.length ? items.map((item) => { const Icon = item.icon; return <article key={item.id} className={`status-${item.status} direction-${item.direction}`}><time>Dia {item.day}</time><span className="mf-timeline-icon"><Icon size={14} /></span><span className="mf-timeline-copy"><strong>{item.title}</strong><small>{item.subtitle}{item.status === 'informational' ? ' · já refletida na fatura vinculada' : ''}</small></span><span className="mf-timeline-amount">{item.direction === 'income' ? '+' : '-'} {formatCurrency(item.amount, isPrivate)}<small>{item.status === 'realized' ? <><CheckCircle2 size={11} />Realizado</> : item.status === 'planned' ? 'Previsto' : 'Referência'}</small></span></article>; }) : <p className="mf-empty">Nenhum compromisso ou lançamento encontrado neste mês.</p>}</div></section>;
}
