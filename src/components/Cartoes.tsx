import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Calendar, CheckCircle2, CreditCard as CardIcon, Pencil, Plus, Trash2 } from 'lucide-react';
import { CardInstallment, CreditCard } from '../types';

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

const money = (value: number) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const percent = (used: number, limit: number) => limit > 0 ? Math.min(100, Math.max(0, (used / limit) * 100)) : 0;

export default function Cartoes(props: CartoesProps) {
  const {
    cards, installments, onAddCard, onEditCard, onDeleteCard,
    onAddInstallment, onEditInstallment, onDeleteInstallment,
    onPayInstallment, onPayCardBill,
  } = props;
  const [cardPage, setCardPage] = useState(1);
  const [installmentPage, setInstallmentPage] = useState(1);

  const normalizedCards = useMemo(() => cards.map((card) => ({
    ...card,
    limit: Number(card.limit || 0), used: Number(card.used || 0),
    due_day: Number(card.due_day || 1), closing_day: Number(card.closing_day || 1),
  })), [cards]);
  const normalizedInstallments = useMemo(() => installments.map((item) => ({
    ...item,
    total_amount: Number(item.total_amount || 0), monthly_amount: Number(item.monthly_amount || 0),
    current_installment: Number(item.current_installment || 1), total_installments: Number(item.total_installments || 1),
    due_day: Number(item.due_day || 1),
  })), [installments]);

  const totalLimit = normalizedCards.reduce((sum, card) => sum + card.limit, 0);
  const totalUsed = normalizedCards.reduce((sum, card) => sum + card.used, 0);
  const available = totalLimit - totalUsed;
  const globalUsage = percent(totalUsed, totalLimit);
  const pressureCard = [...normalizedCards].sort((a, b) => percent(b.used, b.limit) - percent(a.used, a.limit))[0];
  const monthlyInstallments = normalizedInstallments
    .filter((item) => item.current_installment <= item.total_installments)
    .reduce((sum, item) => sum + item.monthly_amount, 0);

  const cardsPerPage = 3;
  const installmentsPerPage = 4;
  const cardPages = Math.max(1, Math.ceil(normalizedCards.length / cardsPerPage));
  const installmentPages = Math.max(1, Math.ceil(normalizedInstallments.length / installmentsPerPage));
  const visibleCards = normalizedCards.slice((cardPage - 1) * cardsPerPage, cardPage * cardsPerPage);
  const visibleInstallments = normalizedInstallments.slice((installmentPage - 1) * installmentsPerPage, installmentPage * installmentsPerPage);

  useEffect(() => { if (cardPage > cardPages) setCardPage(cardPages); }, [cardPage, cardPages]);
  useEffect(() => { if (installmentPage > installmentPages) setInstallmentPage(installmentPages); }, [installmentPage, installmentPages]);

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4 overflow-hidden animate-fade-in">
      <section className="grid shrink-0 grid-cols-2 lg:grid-cols-6 gap-3">
        <Metric label="Cartões" value={String(normalizedCards.length)} />
        <Metric label="Limite total" value={money(totalLimit)} />
        <Metric label="Utilizado" value={money(totalUsed)} danger={globalUsage >= 80} />
        <Metric label="Disponível" value={money(available)} danger={available < 0} />
        <Metric label="Uso global" value={`${globalUsage.toFixed(1)}%`} danger={globalUsage >= 80} />
        <Metric label="Parcelas mensais" value={money(monthlyInstallments)} />
      </section>

      <section className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-12 gap-4 overflow-hidden">
        <div className="xl:col-span-8 glass-card !p-4 flex flex-col min-h-0 overflow-hidden">
          <Header title="Meus cartões" subtitle="Valores cadastrados manualmente" action={onAddCard} actionLabel="Novo cartão" />
          {visibleCards.length === 0 ? <Empty icon={<CardIcon size={30} />} text="Nenhum cartão cadastrado." /> : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 content-start">
              {visibleCards.map((card) => {
                const usage = percent(card.used, card.limit);
                const remaining = card.limit - card.used;
                return (
                  <article key={card.id} className={`rounded-2xl border p-4 ${usage >= 80 ? 'border-red-500/30 bg-red-500/5' : 'border-white/10 bg-white/[0.03]'}`}>
                    <div className="flex justify-between gap-3">
                      <div className="min-w-0"><h3 className="truncate text-sm font-bold">{card.name}</h3><p className="text-[9px] uppercase text-white/30">{card.brand || 'Cartão'}</p></div>
                      <div className="flex gap-1">
                        {onEditCard && <button onClick={() => onEditCard(card)} className="p-1 text-white/30 hover:text-white"><Pencil size={14} /></button>}
                        {onDeleteCard && <button onClick={() => onDeleteCard(card)} className="p-1 text-white/30 hover:text-red-400"><Trash2 size={14} /></button>}
                      </div>
                    </div>
                    <div className="mt-4 flex justify-between text-xs"><span>Usado <strong>{money(card.used)}</strong></span><span>Disponível <strong className={remaining >= 0 ? 'text-brand-primary' : 'text-red-400'}>{money(remaining)}</strong></span></div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/5"><div className={usage >= 80 ? 'h-full bg-red-500' : 'h-full bg-brand-secondary'} style={{ width: `${usage}%` }} /></div>
                    <div className="mt-1 flex justify-between text-[9px] text-white/30"><span>{usage.toFixed(0)}%</span><span>Limite {money(card.limit)}</span></div>
                    <div className="mt-3 flex justify-between border-t border-white/5 pt-3 text-[9px] text-white/40"><span className="flex gap-1"><Calendar size={11} /> Fecha {card.closing_day}</span><span>Vence {card.due_day}</span></div>
                    {onPayCardBill && card.used > 0 && <button onClick={() => onPayCardBill(card)} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-primary/15 py-2 text-[10px] font-bold text-brand-primary"><CheckCircle2 size={13} /> Registrar pagamento da fatura</button>}
                  </article>
                );
              })}
            </div>
          )}
          {cardPages > 1 && <Pager page={cardPage} pages={cardPages} onChange={setCardPage} />}
        </div>

        <aside className="xl:col-span-4 glass-card !p-4 flex flex-col gap-4">
          <h2 className="flex items-center gap-2 text-sm font-bold"><AlertTriangle size={16} /> Saúde do crédito</h2>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><div className="text-[9px] uppercase text-white/30">Comprometimento</div><div className={`mt-1 text-3xl font-black ${globalUsage >= 80 ? 'text-red-400' : 'text-brand-secondary'}`}>{globalUsage.toFixed(0)}%</div><p className="mt-2 text-xs text-white/40">{totalLimit <= 0 ? 'Cadastre limites para acompanhar o uso.' : globalUsage >= 80 ? 'Uso elevado. Evite novas compras.' : globalUsage >= 50 ? 'Uso moderado. Acompanhe as faturas.' : 'Uso em faixa controlada.'}</p></div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><div className="text-sm font-bold">Maior pressão</div>{pressureCard ? <p className="mt-2 text-xs text-white/50"><strong>{pressureCard.name}</strong>: {percent(pressureCard.used, pressureCard.limit).toFixed(0)}% do limite.</p> : <p className="mt-2 text-xs text-white/30">Nenhum cartão cadastrado.</p>}</div>
          <div className="mt-auto rounded-2xl border border-brand-primary/20 bg-brand-primary/5 p-4"><div className="text-[9px] uppercase text-white/30">Restante consolidado</div><div className={`mt-1 text-xl font-black ${available >= 0 ? 'text-brand-primary' : 'text-red-400'}`}>{money(available)}</div></div>
        </aside>
      </section>

      <section className="glass-card !p-4 shrink-0">
        <Header title="Parcelamentos" subtitle="Compromissos ativos" action={onAddInstallment} actionLabel="Novo parcelamento" />
        {visibleInstallments.length === 0 ? <div className="flex h-12 items-center justify-center rounded-xl border border-dashed border-white/10 text-xs text-white/30">Nenhum parcelamento cadastrado.</div> : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
            {visibleInstallments.map((item) => {
              const completed = item.current_installment > item.total_installments;
              return <article key={item.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3"><div className="flex justify-between gap-2"><div className="min-w-0"><h3 className="truncate text-xs font-bold">{item.description}</h3><p className="text-[9px] text-white/30">{Math.min(item.current_installment, item.total_installments)}/{item.total_installments} • dia {item.due_day}</p></div><div className="flex gap-1">{onEditInstallment && <button onClick={() => onEditInstallment(item)} className="text-white/30"><Pencil size={13} /></button>}{onDeleteInstallment && <button onClick={() => onDeleteInstallment(item)} className="text-white/30 hover:text-red-400"><Trash2 size={13} /></button>}</div></div><div className="mt-2 text-sm font-bold">{money(item.monthly_amount)}</div>{onPayInstallment && !completed && <button onClick={() => onPayInstallment(item)} className="mt-2 w-full rounded-lg bg-green-500/10 py-1.5 text-[9px] font-bold text-green-400">Registrar parcela paga</button>}{completed && <div className="mt-2 text-[9px] text-green-400">Concluído</div>}</article>;
            })}
          </div>
        )}
        {installmentPages > 1 && <Pager page={installmentPage} pages={installmentPages} onChange={setInstallmentPage} compact />}
      </section>
    </div>
  );
}

function Metric({ label, value, danger }: { label: string; value: string; danger?: boolean }) { return <div className="glass-card !p-3 min-w-0"><div className="truncate text-[9px] font-bold uppercase text-white/35">{label}</div><div className={`mt-1 truncate text-sm font-black ${danger ? 'text-red-400' : ''}`}>{value}</div></div>; }
function Header({ title, subtitle, action, actionLabel }: { title: string; subtitle: string; action?: () => void; actionLabel: string }) { return <div className="mb-3 flex items-center justify-between gap-3"><div><h2 className="text-sm font-bold">{title}</h2><p className="text-[9px] uppercase text-white/30">{subtitle}</p></div>{action && <button onClick={action} className="flex items-center gap-2 rounded-xl bg-brand-primary px-3 py-2 text-xs font-bold text-black"><Plus size={14} /> {actionLabel}</button>}</div>; }
function Empty({ icon, text }: { icon: React.ReactNode; text: string }) { return <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/10 text-white/30">{icon}<p className="text-xs">{text}</p></div>; }
function Pager({ page, pages, onChange, compact }: { page: number; pages: number; onChange: (page: number) => void; compact?: boolean }) { return <div className={`${compact ? 'mt-2' : 'mt-auto pt-3'} flex items-center justify-center gap-3 text-[10px]`}><button onClick={() => onChange(Math.max(1, page - 1))} disabled={page === 1} className="rounded-lg bg-white/5 px-3 py-1.5 disabled:opacity-30">Anterior</button><span className="text-white/40">{page} de {pages}</span><button onClick={() => onChange(Math.min(pages, page + 1))} disabled={page === pages} className="rounded-lg bg-white/5 px-3 py-1.5 disabled:opacity-30">Próxima</button></div>; }
