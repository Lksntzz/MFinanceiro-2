import React, { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  Pencil,
  Plus,
  ReceiptText,
  Trash2,
  X,
} from 'lucide-react';
import {
  addMonths,
  endOfMonth,
  format,
  isAfter,
  isBefore,
  isSameMonth,
  lastDayOfMonth,
  parseISO,
  startOfMonth,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { supabase } from './supabase';

type CardRow = {
  id: string;
  user_id: string;
  name: string;
  brand?: string | null;
  limit: number;
  used: number;
  closing_day: number;
  due_day: number;
};

type InstallmentRow = {
  id: string;
  user_id: string;
  card_id?: string | null;
  description: string;
  total_amount: number;
  monthly_amount: number;
  current_installment: number;
  total_installments: number;
  due_day: number;
  last_paid_month?: string | null;
  purchase_date: string;
  first_due_date: string;
};

type ScheduleStatus = 'paid' | 'overdue' | 'current' | 'upcoming';

type ScheduleItem = {
  number: number;
  dueDate: Date;
  dueMonth: string;
  status: ScheduleStatus;
};

type CardForm = {
  name: string;
  brand: string;
  limit: string;
  used: string;
  closing_day: string;
  due_day: string;
};

type InstallmentForm = {
  card_id: string;
  description: string;
  purchase_date: string;
  first_due_date: string;
  total_amount: string;
  total_installments: string;
  include_in_card_used: boolean;
};

const money = (value: number) =>
  Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const todayKey = () => format(new Date(), 'yyyy-MM-dd');

function safeDate(value: string | null | undefined): Date {
  if (!value) return new Date();
  const parsed = parseISO(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function dateWithDay(base: Date, day: number): Date {
  const last = lastDayOfMonth(base).getDate();
  return new Date(base.getFullYear(), base.getMonth(), Math.min(Math.max(1, day), last), 12, 0, 0);
}

function defaultFirstDueDate(purchaseDate: string, dueDay = 10): string {
  const purchase = safeDate(purchaseDate);
  const base = purchase.getDate() <= dueDay ? purchase : addMonths(purchase, 1);
  return format(dateWithDay(base, dueDay), 'yyyy-MM-dd');
}

function buildSchedule(installment: InstallmentRow, reference = new Date()): ScheduleItem[] {
  const firstDue = safeDate(installment.first_due_date);
  const referenceMonth = startOfMonth(reference);
  const currentNumber = Math.max(1, Number(installment.current_installment || 1));
  const total = Math.max(1, Number(installment.total_installments || 1));

  return Array.from({ length: total }, (_, index) => {
    const number = index + 1;
    const dueDate = addMonths(firstDue, index);
    const dueMonth = format(dueDate, 'yyyy-MM');
    let status: ScheduleStatus = 'upcoming';

    if (number < currentNumber) status = 'paid';
    else if (number === currentNumber) {
      const dueMonthStart = startOfMonth(dueDate);
      if (isBefore(dueMonthStart, referenceMonth)) status = 'overdue';
      else if (isSameMonth(dueDate, reference)) status = 'current';
      else status = 'upcoming';
    }

    return { number, dueDate, dueMonth, status };
  });
}

function activeScheduleItem(installment: InstallmentRow): ScheduleItem | null {
  if (installment.current_installment > installment.total_installments) return null;
  return buildSchedule(installment).find((item) => item.number === installment.current_installment) || null;
}

const inputClass =
  'w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none transition focus:border-brand-primary/60';

function InstallmentManager() {
  const [visible, setVisible] = useState(false);
  const [top, setTop] = useState(72);
  const [userId, setUserId] = useState<string | null>(null);
  const [cards, setCards] = useState<CardRow[]>([]);
  const [installments, setInstallments] = useState<InstallmentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [dismissedPrompts, setDismissedPrompts] = useState<string[]>([]);
  const [cardModal, setCardModal] = useState(false);
  const [installmentModal, setInstallmentModal] = useState(false);
  const [editingCard, setEditingCard] = useState<CardRow | null>(null);
  const [editingInstallment, setEditingInstallment] = useState<InstallmentRow | null>(null);
  const [cardForm, setCardForm] = useState<CardForm>({
    name: '',
    brand: 'Visa',
    limit: '',
    used: '0',
    closing_day: '1',
    due_day: '10',
  });
  const [installmentForm, setInstallmentForm] = useState<InstallmentForm>(() => {
    const purchase = todayKey();
    return {
      card_id: '',
      description: '',
      purchase_date: purchase,
      first_due_date: defaultFirstDueDate(purchase),
      total_amount: '',
      total_installments: '1',
      include_in_card_used: true,
    };
  });

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (mounted) setUserId(data.user?.id || null);
    });
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id || null);
    });
    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const detect = () => {
      const activeButton = Array.from(document.querySelectorAll<HTMLButtonElement>('.mf-nav button')).find((button) =>
        button.classList.contains('active'),
      );
      setVisible(Boolean(activeButton?.textContent?.toLowerCase().includes('cartões')));
      const header = document.querySelector<HTMLElement>('.mf-topbar');
      setTop(Math.ceil(header?.getBoundingClientRect().bottom || 64) + 8);
    };

    detect();
    const observer = new MutationObserver(detect);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', detect);
    const interval = window.setInterval(detect, 600);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', detect);
      window.clearInterval(interval);
    };
  }, []);

  const loadData = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);

    const [cardsResult, installmentsResult] = await Promise.all([
      supabase.from('mf_credit_cards').select('*').eq('user_id', userId).order('created_at', { ascending: true }),
      supabase.from('mf_card_installments').select('*').eq('user_id', userId).order('first_due_date', { ascending: true }),
    ]);

    if (cardsResult.error) setError(cardsResult.error.message);
    if (installmentsResult.error) setError(installmentsResult.error.message);

    setCards(
      (cardsResult.data || []).map((card: any) => ({
        ...card,
        limit: Number(card.limit || 0),
        used: Number(card.used || 0),
        closing_day: Number(card.closing_day || 1),
        due_day: Number(card.due_day || 10),
      })),
    );
    setInstallments(
      (installmentsResult.data || []).map((item: any) => ({
        ...item,
        total_amount: Number(item.total_amount || 0),
        monthly_amount: Number(item.monthly_amount || 0),
        current_installment: Number(item.current_installment || 1),
        total_installments: Number(item.total_installments || 1),
        due_day: Number(item.due_day || 1),
        purchase_date: item.purchase_date || format(safeDate(item.created_at), 'yyyy-MM-dd'),
        first_due_date: item.first_due_date || format(safeDate(item.created_at), 'yyyy-MM-dd'),
      })),
    );
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    loadData();

    const channel = supabase
      .channel(`installment-manager-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_credit_cards', filter: `user_id=eq.${userId}` }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_card_installments', filter: `user_id=eq.${userId}` }, loadData)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, loadData]);

  const totalLimit = cards.reduce((sum, card) => sum + card.limit, 0);
  const totalUsed = cards.reduce((sum, card) => sum + card.used, 0);
  const available = totalLimit - totalUsed;
  const activeInstallments = installments.filter((item) => item.current_installment <= item.total_installments);
  const monthlyCommitment = activeInstallments.reduce((sum, item) => sum + item.monthly_amount, 0);

  const currentPrompt = useMemo(() => {
    return activeInstallments
      .map((installment) => ({ installment, schedule: activeScheduleItem(installment) }))
      .filter(({ schedule }) => schedule && (schedule.status === 'current' || schedule.status === 'overdue'))
      .filter(({ installment }) => !dismissedPrompts.includes(`${installment.id}-${installment.current_installment}`))
      .sort((a, b) => (a.schedule?.dueDate.getTime() || 0) - (b.schedule?.dueDate.getTime() || 0))[0] || null;
  }, [activeInstallments, dismissedPrompts]);

  function resetMessages() {
    setError(null);
    setSuccess(null);
  }

  function openNewCard() {
    resetMessages();
    setEditingCard(null);
    setCardForm({ name: '', brand: 'Visa', limit: '', used: '0', closing_day: '1', due_day: '10' });
    setCardModal(true);
  }

  function openCardEdit(card: CardRow) {
    resetMessages();
    setEditingCard(card);
    setCardForm({
      name: card.name,
      brand: card.brand || 'Visa',
      limit: String(card.limit),
      used: String(card.used),
      closing_day: String(card.closing_day),
      due_day: String(card.due_day),
    });
    setCardModal(true);
  }

  function openNewInstallment() {
    resetMessages();
    const purchase = todayKey();
    const selectedCard = cards[0];
    setEditingInstallment(null);
    setInstallmentForm({
      card_id: selectedCard?.id || '',
      description: '',
      purchase_date: purchase,
      first_due_date: defaultFirstDueDate(purchase, selectedCard?.due_day || 10),
      total_amount: '',
      total_installments: '1',
      include_in_card_used: true,
    });
    setInstallmentModal(true);
  }

  function openInstallmentEdit(item: InstallmentRow) {
    resetMessages();
    setEditingInstallment(item);
    setInstallmentForm({
      card_id: item.card_id || '',
      description: item.description,
      purchase_date: item.purchase_date,
      first_due_date: item.first_due_date,
      total_amount: String(item.total_amount),
      total_installments: String(item.total_installments),
      include_in_card_used: false,
    });
    setInstallmentModal(true);
  }

  async function saveCard(event: FormEvent) {
    event.preventDefault();
    if (!userId) return;
    resetMessages();

    const limit = Number(cardForm.limit);
    const used = Number(cardForm.used);
    const dueDay = Number(cardForm.due_day);
    const closingDay = Number(cardForm.closing_day);
    if (!cardForm.name.trim() || !Number.isFinite(limit) || limit < 0 || !Number.isFinite(used) || used < 0) {
      setError('Preencha os dados do cartão com valores válidos.');
      return;
    }
    if (dueDay < 1 || dueDay > 31 || closingDay < 1 || closingDay > 31) {
      setError('Os dias de fechamento e vencimento precisam estar entre 1 e 31.');
      return;
    }

    const payload = {
      user_id: userId,
      name: cardForm.name.trim(),
      brand: cardForm.brand.trim() || 'Cartão',
      limit,
      used,
      closing_day: closingDay,
      due_day: dueDay,
    };

    const result = editingCard
      ? await supabase.from('mf_credit_cards').update(payload).eq('id', editingCard.id).eq('user_id', userId)
      : await supabase.from('mf_credit_cards').insert(payload);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    setCardModal(false);
    setSuccess(editingCard ? 'Cartão atualizado.' : 'Cartão cadastrado.');
    await loadData();
  }

  async function saveInstallment(event: FormEvent) {
    event.preventDefault();
    if (!userId) return;
    resetMessages();

    const totalAmount = Number(installmentForm.total_amount);
    const totalInstallments = Number(installmentForm.total_installments);
    const purchaseDate = safeDate(installmentForm.purchase_date);
    const firstDueDate = safeDate(installmentForm.first_due_date);

    if (!installmentForm.description.trim() || !Number.isFinite(totalAmount) || totalAmount <= 0) {
      setError('Informe a descrição e um valor total maior que zero.');
      return;
    }
    if (!Number.isInteger(totalInstallments) || totalInstallments < 1 || totalInstallments > 240) {
      setError('A quantidade de parcelas deve estar entre 1 e 240.');
      return;
    }
    if (isBefore(firstDueDate, startOfMonth(purchaseDate)) && isBefore(firstDueDate, purchaseDate)) {
      setError('O primeiro vencimento não pode ser anterior à data da compra.');
      return;
    }

    const monthlyAmount = Number((totalAmount / totalInstallments).toFixed(2));
    const payload: any = {
      user_id: userId,
      card_id: installmentForm.card_id || null,
      description: installmentForm.description.trim(),
      total_amount: totalAmount,
      monthly_amount: monthlyAmount,
      total_installments: totalInstallments,
      due_day: firstDueDate.getDate(),
      purchase_date: format(purchaseDate, 'yyyy-MM-dd'),
      first_due_date: format(firstDueDate, 'yyyy-MM-dd'),
    };

    if (!editingInstallment) {
      payload.current_installment = 1;
      payload.last_paid_month = null;
    }

    const result = editingInstallment
      ? await supabase.from('mf_card_installments').update(payload).eq('id', editingInstallment.id).eq('user_id', userId)
      : await supabase.from('mf_card_installments').insert(payload);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    if (!editingInstallment && installmentForm.include_in_card_used && installmentForm.card_id) {
      const card = cards.find((item) => item.id === installmentForm.card_id);
      if (card) {
        const cardUpdate = await supabase
          .from('mf_credit_cards')
          .update({ used: Number((card.used + totalAmount).toFixed(2)) })
          .eq('id', card.id)
          .eq('user_id', userId);
        if (cardUpdate.error) setError(`Parcelamento salvo, mas o cartão não foi atualizado: ${cardUpdate.error.message}`);
      }
    }

    setInstallmentModal(false);
    setSuccess(editingInstallment ? 'Parcelamento atualizado.' : 'Parcelamento criado e meses calculados.');
    await loadData();
  }

  async function payInstallment(item: InstallmentRow) {
    resetMessages();
    const scheduleItem = activeScheduleItem(item);
    if (!scheduleItem) {
      setError('Este parcelamento já foi concluído.');
      return;
    }
    if (isAfter(startOfMonth(scheduleItem.dueDate), endOfMonth(new Date()))) {
      setError('A próxima parcela ainda pertence a um mês futuro.');
      return;
    }

    const { error: paymentError } = await supabase.rpc('mf_pay_card_installment', {
      p_installment_id: item.id,
    });

    if (paymentError) {
      setError(paymentError.message);
      return;
    }

    setSuccess(`Parcela ${item.current_installment}/${item.total_installments} registrada como paga.`);
    setDismissedPrompts((current) => current.filter((key) => !key.startsWith(`${item.id}-`)));
    await loadData();
  }

  async function deleteCard(card: CardRow) {
    if (!userId || !window.confirm(`Excluir o cartão ${card.name}?`)) return;
    resetMessages();
    const result = await supabase.from('mf_credit_cards').delete().eq('id', card.id).eq('user_id', userId);
    if (result.error) setError(result.error.message);
    else {
      setSuccess('Cartão excluído.');
      await loadData();
    }
  }

  async function deleteInstallment(item: InstallmentRow) {
    if (!userId || !window.confirm(`Excluir o parcelamento ${item.description}?`)) return;
    resetMessages();
    const result = await supabase.from('mf_card_installments').delete().eq('id', item.id).eq('user_id', userId);
    if (result.error) setError(result.error.message);
    else {
      setSuccess('Parcelamento excluído.');
      await loadData();
    }
  }

  if (!visible || !userId) return null;

  return (
    <div
      className="fixed z-[45] overflow-hidden rounded-2xl border border-white/10 bg-[#050505] shadow-2xl"
      style={{ top, left: 12, right: 12, bottom: 12 }}
    >
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden p-4">
        <div className="flex shrink-0 items-center justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-black"><CreditCard size={19} className="text-brand-primary" /> Cartões e parcelamentos</h2>
            <p className="text-[10px] uppercase tracking-widest text-white/35">Calendário mensal conectado ao Dashboard</p>
          </div>
          <div className="flex gap-2">
            <button onClick={openNewCard} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold hover:bg-white/10"><Plus size={14} /> Cartão</button>
            <button onClick={openNewInstallment} className="flex items-center gap-2 rounded-xl bg-brand-primary px-3 py-2 text-xs font-bold text-black"><Plus size={14} /> Parcelamento</button>
          </div>
        </div>

        {(error || success) && (
          <div className={`flex shrink-0 items-center justify-between rounded-xl border px-3 py-2 text-xs ${error ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-green-500/30 bg-green-500/10 text-green-300'}`}>
            <span className="flex items-center gap-2">{error ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}{error || success}</span>
            <button onClick={resetMessages}><X size={14} /></button>
          </div>
        )}

        <section className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-5">
          <Metric label="Limite total" value={money(totalLimit)} />
          <Metric label="Utilizado" value={money(totalUsed)} danger={totalUsed > totalLimit && totalLimit > 0} />
          <Metric label="Disponível" value={money(available)} danger={available < 0} />
          <Metric label="Parcelamentos ativos" value={String(activeInstallments.length)} />
          <Metric label="Parcelas por mês" value={money(monthlyCommitment)} />
        </section>

        {currentPrompt && currentPrompt.schedule && (
          <section className={`shrink-0 rounded-2xl border p-4 ${currentPrompt.schedule.status === 'overdue' ? 'border-red-500/30 bg-red-500/10' : 'border-brand-primary/30 bg-brand-primary/10'}`}>
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-white/45">Confirmação do mês</div>
                <h3 className="mt-1 text-sm font-bold">
                  A parcela {currentPrompt.installment.current_installment}/{currentPrompt.installment.total_installments} de “{currentPrompt.installment.description}” foi paga?
                </h3>
                <p className="mt-1 text-xs text-white/50">
                  Vencimento {format(currentPrompt.schedule.dueDate, "dd 'de' MMMM 'de' yyyy", { locale: ptBR })} • {money(currentPrompt.installment.monthly_amount)}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setDismissedPrompts((current) => [...current, `${currentPrompt.installment.id}-${currentPrompt.installment.current_installment}`])}
                  className="rounded-xl border border-white/10 px-4 py-2 text-xs font-bold text-white/60"
                >
                  Não, ainda não
                </button>
                <button onClick={() => payInstallment(currentPrompt.installment)} className="rounded-xl bg-green-500 px-4 py-2 text-xs font-bold text-black">
                  Sim, registrar
                </button>
              </div>
            </div>
          </section>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden xl:grid-cols-12">
          <section className="min-h-0 overflow-auto rounded-2xl border border-white/10 bg-white/[0.025] p-3 xl:col-span-4">
            <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-bold">Meus cartões</h3><span className="text-[10px] text-white/30">{cards.length} cadastrado(s)</span></div>
            <div className="space-y-2">
              {cards.length === 0 && <Empty text="Nenhum cartão cadastrado." />}
              {cards.map((card) => {
                const usage = card.limit > 0 ? Math.min(100, (card.used / card.limit) * 100) : 0;
                return (
                  <article key={card.id} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div><h4 className="text-sm font-bold">{card.name}</h4><p className="text-[9px] uppercase text-white/30">{card.brand || 'Cartão'}</p></div>
                      <div className="flex gap-2"><button onClick={() => openCardEdit(card)} className="text-white/35 hover:text-white"><Pencil size={14} /></button><button onClick={() => deleteCard(card)} className="text-white/35 hover:text-red-400"><Trash2 size={14} /></button></div>
                    </div>
                    <div className="mt-3 flex justify-between text-xs"><span>Usado <strong>{money(card.used)}</strong></span><span>Restante <strong>{money(card.limit - card.used)}</strong></span></div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/5"><div className={`h-full ${usage >= 80 ? 'bg-red-500' : 'bg-brand-secondary'}`} style={{ width: `${usage}%` }} /></div>
                    <div className="mt-2 flex justify-between text-[9px] text-white/35"><span>Fecha dia {card.closing_day}</span><span>Vence dia {card.due_day}</span></div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="min-h-0 overflow-auto rounded-2xl border border-white/10 bg-white/[0.025] p-3 xl:col-span-8">
            <div className="mb-3 flex items-center justify-between"><h3 className="flex items-center gap-2 text-sm font-bold"><ReceiptText size={15} /> Calendário de parcelamentos</h3><span className="text-[10px] text-white/30">{loading ? 'Atualizando...' : `${installments.length} cadastrado(s)`}</span></div>
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {installments.length === 0 && <div className="lg:col-span-2"><Empty text="Nenhum parcelamento cadastrado." /></div>}
              {installments.map((item) => {
                const schedule = buildSchedule(item);
                const current = activeScheduleItem(item);
                const completed = item.current_installment > item.total_installments;
                const card = cards.find((candidate) => candidate.id === item.card_id);
                const visibleSchedule = schedule.filter((entry) => entry.number >= Math.max(1, item.current_installment - 1)).slice(0, 4);
                return (
                  <article key={item.id} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0"><h4 className="truncate text-sm font-bold">{item.description}</h4><p className="text-[9px] uppercase text-white/30">{card?.name || 'Sem cartão'} • compra {format(safeDate(item.purchase_date), 'dd/MM/yyyy')}</p></div>
                      <div className="flex gap-2"><button onClick={() => openInstallmentEdit(item)} className="text-white/35 hover:text-white"><Pencil size={14} /></button><button onClick={() => deleteInstallment(item)} className="text-white/35 hover:text-red-400"><Trash2 size={14} /></button></div>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <Mini label="Total" value={money(item.total_amount)} />
                      <Mini label="Parcela" value={money(item.monthly_amount)} />
                      <Mini label="Andamento" value={completed ? 'Concluído' : `${item.current_installment}/${item.total_installments}`} />
                    </div>
                    <div className="mt-3 space-y-1.5">
                      {visibleSchedule.map((entry) => (
                        <div key={entry.number} className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.025] px-2.5 py-1.5 text-[10px]">
                          <span>Parcela {entry.number}/{item.total_installments}</span>
                          <span>{format(entry.dueDate, 'dd/MM/yyyy')}</span>
                          <Status status={entry.status} />
                        </div>
                      ))}
                    </div>
                    {!completed && current && (current.status === 'current' || current.status === 'overdue') && (
                      <button onClick={() => payInstallment(item)} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-green-500/15 py-2 text-[10px] font-bold text-green-400"><CheckCircle2 size={13} /> Registrar parcela deste mês</button>
                    )}
                    {!completed && current && current.status === 'upcoming' && <p className="mt-3 text-center text-[10px] text-white/35">Próxima confirmação em {format(current.dueDate, 'MMMM/yyyy', { locale: ptBR })}</p>}
                    {completed && <p className="mt-3 text-center text-[10px] font-bold text-green-400">Parcelamento concluído</p>}
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      </div>

      {cardModal && (
        <Modal title={editingCard ? 'Editar cartão' : 'Novo cartão'} onClose={() => setCardModal(false)}>
          <form onSubmit={saveCard} className="space-y-3">
            <Field label="Nome"><input className={inputClass} required value={cardForm.name} onChange={(event) => setCardForm({ ...cardForm, name: event.target.value })} /></Field>
            <Field label="Bandeira"><input className={inputClass} value={cardForm.brand} onChange={(event) => setCardForm({ ...cardForm, brand: event.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3"><Field label="Limite"><input className={inputClass} type="number" min="0" step="0.01" required value={cardForm.limit} onChange={(event) => setCardForm({ ...cardForm, limit: event.target.value })} /></Field><Field label="Utilizado"><input className={inputClass} type="number" min="0" step="0.01" required value={cardForm.used} onChange={(event) => setCardForm({ ...cardForm, used: event.target.value })} /></Field></div>
            <div className="grid grid-cols-2 gap-3"><Field label="Fecha dia"><input className={inputClass} type="number" min="1" max="31" value={cardForm.closing_day} onChange={(event) => setCardForm({ ...cardForm, closing_day: event.target.value })} /></Field><Field label="Vence dia"><input className={inputClass} type="number" min="1" max="31" value={cardForm.due_day} onChange={(event) => setCardForm({ ...cardForm, due_day: event.target.value })} /></Field></div>
            <Actions onCancel={() => setCardModal(false)} />
          </form>
        </Modal>
      )}

      {installmentModal && (
        <Modal title={editingInstallment ? 'Editar parcelamento' : 'Novo parcelamento'} onClose={() => setInstallmentModal(false)} wide>
          <form onSubmit={saveInstallment} className="space-y-3">
            <Field label="Cartão"><select className={inputClass} value={installmentForm.card_id} onChange={(event) => { const card = cards.find((item) => item.id === event.target.value); setInstallmentForm({ ...installmentForm, card_id: event.target.value, first_due_date: editingInstallment ? installmentForm.first_due_date : defaultFirstDueDate(installmentForm.purchase_date, card?.due_day || 10) }); }}><option value="">Sem cartão vinculado</option>{cards.map((card) => <option key={card.id} value={card.id}>{card.name}</option>)}</select></Field>
            <Field label="Descrição da compra"><input className={inputClass} required value={installmentForm.description} onChange={(event) => setInstallmentForm({ ...installmentForm, description: event.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3"><Field label="Data da compra"><input className={inputClass} type="date" required value={installmentForm.purchase_date} onChange={(event) => { const card = cards.find((item) => item.id === installmentForm.card_id); const purchase = event.target.value; setInstallmentForm({ ...installmentForm, purchase_date: purchase, first_due_date: defaultFirstDueDate(purchase, card?.due_day || 10) }); }} /></Field><Field label="Primeiro vencimento"><input className={inputClass} type="date" required value={installmentForm.first_due_date} onChange={(event) => setInstallmentForm({ ...installmentForm, first_due_date: event.target.value })} /></Field></div>
            <div className="grid grid-cols-2 gap-3"><Field label="Valor total"><input className={inputClass} type="number" min="0.01" step="0.01" required value={installmentForm.total_amount} onChange={(event) => setInstallmentForm({ ...installmentForm, total_amount: event.target.value })} /></Field><Field label="Quantidade de parcelas"><input className={inputClass} type="number" min="1" max="240" required value={installmentForm.total_installments} onChange={(event) => setInstallmentForm({ ...installmentForm, total_installments: event.target.value })} /></Field></div>
            <div className="rounded-xl border border-brand-primary/20 bg-brand-primary/5 p-3 text-xs text-white/60"><div className="flex justify-between"><span>Valor calculado por mês</span><strong className="text-brand-primary">{money(Number(installmentForm.total_amount || 0) / Math.max(1, Number(installmentForm.total_installments || 1)))}</strong></div><p className="mt-1 text-[10px] text-white/35">O aplicativo gera automaticamente os vencimentos dos próximos meses a partir do primeiro vencimento.</p></div>
            {!editingInstallment && installmentForm.card_id && <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/60"><input type="checkbox" checked={installmentForm.include_in_card_used} onChange={(event) => setInstallmentForm({ ...installmentForm, include_in_card_used: event.target.checked })} /> Somar o valor total ao utilizado do cartão</label>}
            <Actions onCancel={() => setInstallmentModal(false)} />
          </form>
        </Modal>
      )}
    </div>
  );
}

function Metric({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3"><div className="truncate text-[9px] font-bold uppercase text-white/35">{label}</div><div className={`mt-1 truncate text-sm font-black ${danger ? 'text-red-400' : ''}`}>{value}</div></div>;
}

function Mini({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-white/[0.035] p-2"><div className="text-[8px] uppercase text-white/30">{label}</div><div className="mt-0.5 truncate text-[10px] font-bold">{value}</div></div>;
}

function Status({ status }: { status: ScheduleStatus }) {
  const labels: Record<ScheduleStatus, string> = { paid: 'Pago', overdue: 'Atrasado', current: 'Mês atual', upcoming: 'Futuro' };
  const styles: Record<ScheduleStatus, string> = { paid: 'text-green-400', overdue: 'text-red-400', current: 'text-brand-primary', upcoming: 'text-white/35' };
  return <span className={`font-bold ${styles[status]}`}>{labels[status]}</span>;
}

function Empty({ text }: { text: string }) {
  return <div className="flex min-h-24 items-center justify-center rounded-xl border border-dashed border-white/10 text-xs text-white/30">{text}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-[10px] font-bold uppercase tracking-widest text-white/45">{label}<div className="mt-1.5">{children}</div></label>;
}

function Actions({ onCancel }: { onCancel: () => void }) {
  return <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={onCancel} className="rounded-xl border border-white/10 px-4 py-2 text-xs font-bold text-white/60">Cancelar</button><button type="submit" className="rounded-xl bg-brand-primary px-4 py-2 text-xs font-bold text-black">Salvar</button></div>;
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"><div className={`max-h-[92vh] w-full overflow-auto rounded-2xl border border-white/10 bg-[#0b0b0b] p-5 shadow-2xl ${wide ? 'max-w-xl' : 'max-w-md'}`}><div className="mb-4 flex items-center justify-between"><h3 className="flex items-center gap-2 text-base font-black"><CalendarDays size={17} className="text-brand-primary" />{title}</h3><button onClick={onClose} className="rounded-lg p-1.5 text-white/40 hover:bg-white/10 hover:text-white"><X size={17} /></button></div>{children}</div></div>;
}

function mountInstallmentManager() {
  if (document.getElementById('mf-installment-manager-root')) return;
  const host = document.createElement('div');
  host.id = 'mf-installment-manager-root';
  document.body.appendChild(host);
  createRoot(host).render(<InstallmentManager />);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountInstallmentManager, { once: true });
  else mountInstallmentManager();
}

export {};
