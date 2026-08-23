import {
  ArrowLeft,
  Gauge,
  ShieldAlert,
  ShieldCheck,
  WalletCards,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import { formatCurrency } from '../../lib/formatters';
import type { FinanceSummary } from '../../types';
import { MOBILE_ROUTES } from '../routes';
import './mobile-can-i-spend.css';

function parseMoneyInput(value: string) {
  const clean = value.trim().replace(/\s/g, '');
  if (!clean) return Number.NaN;
  if (clean.includes(','))
    return Number(clean.replace(/\./g, '').replace(',', '.'));
  return Number(clean);
}

type ImpactTone = 'success' | 'warning' | 'danger';

type Impact = {
  tone: ImpactTone;
  title: string;
  message: string;
  amount: number;
  after: number;
  newDailyLimit: number;
};

function calculateImpact(
  summary: FinanceSummary,
  amount: number,
): Impact | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const available = summary.projectedBalance;
  const after = available - amount;
  const remainingDays = Math.max(1, summary.daysRemaining);
  const newDailyLimit = Math.max(0, after) / remainingDays;

  if (after < 0) {
    return {
      tone: 'danger',
      title: 'Ultrapassa seu valor livre',
      message:
        'Esse valor é maior que o saldo livre depois dos compromissos cadastrados neste ciclo.',
      amount,
      after,
      newDailyLimit,
    };
  }

  if (amount <= summary.dailyLimit) {
    return {
      tone: 'success',
      title: 'Impacto baixo no ciclo',
      message:
        'Pelos dados cadastrados hoje, essa compra cabe dentro da sua margem diária atual.',
      amount,
      after,
      newDailyLimit,
    };
  }

  const remainingRatio = available > 0 ? after / available : 0;
  if (remainingRatio >= 0.6) {
    return {
      tone: 'warning',
      title: 'Cabe, mas consome sua margem de hoje',
      message:
        'A compra ainda deixa uma boa parte do valor livre, mas fica acima do limite diário calculado.',
      amount,
      after,
      newDailyLimit,
    };
  }

  return {
    tone: 'warning',
    title: 'Vai apertar o restante do ciclo',
    message:
      'A compra cabe no valor livre, mas reduz bastante a margem disponível até o próximo recebimento.',
    amount,
    after,
    newDailyLimit,
  };
}

export default function MobileCanISpend({
  summary,
}: {
  summary: FinanceSummary;
}) {
  const navigate = useNavigate();
  const [amount, setAmount] = useState('');
  const parsedAmount = parseMoneyInput(amount);
  const impact = useMemo(
    () => calculateImpact(summary, parsedAmount),
    [parsedAmount, summary],
  );

  return (
    <div className="mf-mobile-focus-page">
      <header className="mf-mobile-focus-header">
        <button
          type="button"
          className="mf-mobile-icon-button"
          onClick={() => navigate(MOBILE_ROUTES.home)}
          aria-label="Voltar para a Home"
        >
          <ArrowLeft size={21} />
        </button>
        <div>
          <span className="mf-mobile-eyebrow">MF Decisão</span>
          <h1>Posso gastar?</h1>
        </div>
        <span
          className="mf-mobile-icon-button mf-mobile-can-spend__header-icon"
          aria-hidden="true"
        >
          <WalletCards size={20} />
        </span>
      </header>

      <main className="mf-mobile-can-spend">
        <section className="mf-mobile-can-spend__intro">
          <span>Disponível de verdade agora</span>
          <strong>{formatCurrency(summary.projectedBalance)}</strong>
          <small>Já descontando os compromissos cadastrados do ciclo.</small>
        </section>

        <label className="mf-mobile-amount-field mf-mobile-can-spend__amount">
          <span>Quanto você está pensando em gastar?</span>
          <div>
            <small>R$</small>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(event) =>
                setAmount(event.target.value.replace(/[^0-9,.]/g, ''))
              }
              placeholder="0,00"
            />
          </div>
        </label>

        {impact ? (
          <section
            className="mf-mobile-can-spend__result"
            data-tone={impact.tone}
          >
            <div className="mf-mobile-can-spend__result-head">
              <span className="mf-mobile-can-spend__result-icon">
                {impact.tone === 'success' ? (
                  <ShieldCheck size={23} />
                ) : (
                  <ShieldAlert size={23} />
                )}
              </span>
              <div>
                <strong>{impact.title}</strong>
                <p>{impact.message}</p>
              </div>
            </div>

            <div className="mf-mobile-can-spend__numbers">
              <div>
                <small>Depois da compra</small>
                <b>{formatCurrency(impact.after)}</b>
              </div>
              <div>
                <small>Nova margem por dia</small>
                <b>{formatCurrency(impact.newDailyLimit)}</b>
              </div>
            </div>

            <div className="mf-mobile-can-spend__comparison">
              <Gauge size={17} />
              <span>
                Margem diária atual: <b>{formatCurrency(summary.dailyLimit)}</b>
              </span>
            </div>
          </section>
        ) : (
          <section className="mf-mobile-can-spend__placeholder">
            <Gauge size={25} />
            <strong>Digite um valor para simular</strong>
            <p>
              O MF não bloqueia nem recomenda uma compra. Ele mostra o impacto
              usando os dados que você já cadastrou.
            </p>
          </section>
        )}

        <div className="mf-mobile-can-spend__disclaimer">
          Essa simulação depende da qualidade das contas, cartões, parcelas e
          recebimentos cadastrados no MF. Ela é uma visão de planejamento, não
          uma garantia de saldo futuro.
        </div>
      </main>
    </div>
  );
}
