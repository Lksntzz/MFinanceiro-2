import React, { useMemo, useState } from 'react';
import { ArrowLeft, CalendarDays, CreditCard as CreditCardIcon, Gauge, Layers3 } from 'lucide-react';
import { addMonths, format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useNavigate } from 'react-router';

import { formatCurrency } from '../../lib/formatters';
import type { CreditCard, FinanceSummary } from '../../types';
import { MOBILE_ROUTES } from '../routes';
import './mobile-purchase-impact.css';

type MobilePurchaseImpactProps = {
  cards: CreditCard[];
  summary: FinanceSummary | null;
};

type InvoiceProjection = {
  closeDate: Date;
  dueDate: Date;
};

function parseMoneyInput(value: string) {
  const clean = value.trim().replace(/\s/g, '');
  if (!clean) return Number.NaN;
  if (clean.includes(',')) return Number(clean.replace(/\./g, '').replace(',', '.'));
  return Number(clean);
}

function safeDate(year: number, monthIndex: number, day: number) {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return new Date(year, monthIndex, Math.min(Math.max(1, day), lastDay), 12, 0, 0, 0);
}

export function projectInvoiceForPurchase(purchaseDate: Date, closingDay: number, dueDay: number): InvoiceProjection {
  const purchaseDay = purchaseDate.getDate();
  const closeMonthOffset = purchaseDay <= closingDay ? 0 : 1;
  const closeMonth = purchaseDate.getMonth() + closeMonthOffset;
  const closeDate = safeDate(purchaseDate.getFullYear(), closeMonth, closingDay);
  const dueMonthOffset = dueDay > closingDay ? 0 : 1;
  const dueDate = safeDate(closeDate.getFullYear(), closeDate.getMonth() + dueMonthOffset, dueDay);
  return { closeDate, dueDate };
}

function impactTone(availableAfter: number, cycleFreeAfter: number | null) {
  if (availableAfter < 0 || (cycleFreeAfter !== null && cycleFreeAfter < 0)) return 'danger';
  if (cycleFreeAfter !== null && cycleFreeAfter < 300) return 'warning';
  return 'success';
}

export default function MobilePurchaseImpact({ cards, summary }: MobilePurchaseImpactProps) {
  const navigate = useNavigate();
  const [cardId, setCardId] = useState(() => cards[0]?.id || '');
  const [amount, setAmount] = useState('');
  const [installments, setInstallments] = useState('1');
  const [purchaseDate, setPurchaseDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));

  const card = cards.find((item) => item.id === cardId) || cards[0] || null;
  const parsedAmount = parseMoneyInput(amount);
  const installmentCount = Math.min(24, Math.max(1, Math.trunc(Number(installments) || 1)));

  const projection = useMemo(() => {
    if (!card || !Number.isFinite(parsedAmount) || parsedAmount <= 0 || !purchaseDate) return null;
    const purchase = parseISO(purchaseDate);
    const firstInvoice = projectInvoiceForPurchase(purchase, Number(card.closing_day || 1), Number(card.due_day || 1));
    const monthlyAmount = parsedAmount / installmentCount;
    const availableBefore = Number(card.limit || 0) - Number(card.used || 0);
    const availableAfter = availableBefore - parsedAmount;
    const usedAfter = Number(card.used || 0) + parsedAmount;
    const usageAfter = Number(card.limit || 0) > 0 ? (usedAfter / Number(card.limit || 0)) * 100 : 0;

    let impactsCurrentCycle = false;
    let cycleFreeAfter: number | null = null;
    let dailyAfter: number | null = null;
    if (summary?.nextPaydayDate) {
      const nextPayday = parseISO(summary.nextPaydayDate);
      impactsCurrentCycle = firstInvoice.dueDate.getTime() <= nextPayday.getTime();
      if (impactsCurrentCycle) {
        cycleFreeAfter = summary.projectedBalance - monthlyAmount;
        dailyAfter = cycleFreeAfter / Math.max(1, summary.daysRemaining);
      }
    }

    const invoices = Array.from({ length: Math.min(installmentCount, 6) }, (_, index) => {
      const closeDate = addMonths(firstInvoice.closeDate, index);
      const dueMonthOffset = Number(card.due_day || 1) > Number(card.closing_day || 1) ? 0 : 1;
      const dueDate = safeDate(closeDate.getFullYear(), closeDate.getMonth() + dueMonthOffset, Number(card.due_day || 1));
      return { index: index + 1, dueDate, amount: monthlyAmount };
    });

    return {
      monthlyAmount,
      availableBefore,
      availableAfter,
      usedAfter,
      usageAfter,
      firstInvoice,
      impactsCurrentCycle,
      cycleFreeAfter,
      dailyAfter,
      invoices,
      tone: impactTone(availableAfter, cycleFreeAfter),
    };
  }, [card, parsedAmount, installmentCount, purchaseDate, summary]);

  return (
    <div className="mf-mobile-focus-page mf-purchase-impact">
      <header className="mf-mobile-focus-header">
        <button type="button" className="mf-mobile-icon-button" onClick={() => navigate(MOBILE_ROUTES.cards)} aria-label="Voltar para cartões">
          <ArrowLeft size={21} />
        </button>
        <div>
          <span className="mf-mobile-eyebrow">Impacto da compra</span>
          <h1>Antes de passar o cartão</h1>
        </div>
        <div className="mf-mobile-brand-mark"><CreditCardIcon size={20} /></div>
      </header>

      {!cards.length ? (
        <div className="mf-mobile-list-card"><div className="mf-mobile-empty">Cadastre um cartão para simular o impacto de uma compra.</div></div>
      ) : (
        <div className="mf-purchase-impact__form">
          <label className="mf-mobile-field">
            <span>Cartão</span>
            <select value={card?.id || ''} onChange={(event) => setCardId(event.target.value)}>
              {cards.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>

          <label className="mf-mobile-amount-field">
            <span>Valor da compra</span>
            <div><small>R$</small><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^0-9,.]/g, ''))} placeholder="0,00" /></div>
          </label>

          <div className="mf-purchase-impact__split">
            <label className="mf-mobile-field">
              <span>Parcelas</span>
              <select value={installmentCount} onChange={(event) => setInstallments(event.target.value)}>
                {Array.from({ length: 24 }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count}x</option>)}
              </select>
            </label>
            <label className="mf-mobile-field">
              <span>Data da compra</span>
              <input type="date" value={purchaseDate} onChange={(event) => setPurchaseDate(event.target.value)} />
            </label>
          </div>

          {projection ? (
            <section className="mf-purchase-impact__result" data-tone={projection.tone}>
              <div className="mf-purchase-impact__headline">
                <div><small>Primeira fatura</small><strong>{format(projection.firstInvoice.dueDate, "MMMM 'de' yyyy", { locale: ptBR })}</strong></div>
                <CalendarDays size={22} />
              </div>

              <div className="mf-purchase-impact__metrics">
                <div><small>Parcela</small><b>{formatCurrency(projection.monthlyAmount)}</b></div>
                <div><small>Limite depois</small><b>{formatCurrency(projection.availableAfter)}</b></div>
                <div><small>Uso do limite</small><b>{projection.usageAfter.toFixed(0)}%</b></div>
                <div><small>Total comprometido</small><b>{formatCurrency(parsedAmount)}</b></div>
              </div>

              {summary ? (
                <div className="mf-purchase-impact__cycle">
                  <Gauge size={18} />
                  {projection.impactsCurrentCycle ? (
                    <div>
                      <strong>Essa parcela entra antes do próximo recebimento.</strong>
                      <span>Valor livre: {formatCurrency(summary.projectedBalance)} → {formatCurrency(projection.cycleFreeAfter || 0)}</span>
                      <span>Margem diária: {formatCurrency(summary.dailyLimit)} → {formatCurrency(projection.dailyAfter || 0)}</span>
                    </div>
                  ) : (
                    <div>
                      <strong>Essa compra não aperta o ciclo atual.</strong>
                      <span>A primeira cobrança vence em {format(projection.firstInvoice.dueDate, 'dd/MM/yyyy')}.</span>
                    </div>
                  )}
                </div>
              ) : null}

              <div className="mf-purchase-impact__timeline">
                <div className="mf-purchase-impact__timeline-title"><Layers3 size={17} /><span>Próximas parcelas</span></div>
                {projection.invoices.map((invoice) => (
                  <div className="mf-purchase-impact__invoice" key={invoice.index}>
                    <span>{invoice.index}/{installmentCount} • {format(invoice.dueDate, 'dd/MM/yyyy')}</span>
                    <b>{formatCurrency(invoice.amount)}</b>
                  </div>
                ))}
                {installmentCount > 6 ? <small>+ {installmentCount - 6} parcelas futuras no mesmo valor estimado.</small> : null}
              </div>

              <p className="mf-purchase-impact__note">Simulação informativa. O fechamento real pode variar por emissor, horário de processamento, feriados e ajustes da operadora.</p>
            </section>
          ) : (
            <div className="mf-mobile-scan-safety"><Gauge size={18} /><span>Informe o valor para ver em qual fatura a compra cai e como ela afeta seu limite e ciclo.</span></div>
          )}
        </div>
      )}
    </div>
  );
}
