import React from 'react';
import { ArrowLeft, CalendarClock, Gauge, Home, Plus, ScanLine, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router';

import { formatCurrency } from '../../lib/formatters';
import type { FinanceSummary } from '../../types';
import { MOBILE_ROUTES } from '../routes';
import './mobile-pulse.css';

type PulseCommitment = {
  id: string;
  description: string;
  amount: number;
  due_date?: string | null;
  type?: string | null;
};

type MobilePulseProps = {
  summary: FinanceSummary | null;
  commitments: PulseCommitment[];
};

export default function MobilePulse({ summary, commitments }: MobilePulseProps) {
  const navigate = useNavigate();
  const nextCommitment = commitments.find((item) => !item.type || item.type === 'expense') || commitments[0] || null;
  const dailyLimit = Math.max(0, Number(summary?.dailyLimit || 0));
  const available = Number(summary?.projectedBalance || 0);
  const tone = available < 0 ? 'danger' : dailyLimit <= 0 ? 'warning' : 'success';

  return (
    <div className="mf-mobile-focus-page mf-pulse">
      <header className="mf-mobile-focus-header">
        <button type="button" className="mf-mobile-icon-button" onClick={() => navigate(MOBILE_ROUTES.home)} aria-label="Voltar para o início"><ArrowLeft size={21} /></button>
        <div><span className="mf-mobile-eyebrow">MF Pulse</span><h1>Seu dinheiro agora</h1></div>
        <div className="mf-mobile-brand-mark"><Gauge size={20} /></div>
      </header>

      <main className="mf-pulse__body">
        <section className="mf-pulse__hero" data-tone={tone}>
          <div className="mf-pulse__hero-label"><ShieldCheck size={17} /><span>Livre para hoje</span></div>
          <strong>{summary ? formatCurrency(dailyLimit) : '—'}</strong>
          <p>{summary ? `≈ sua margem diária pelos próximos ${summary.daysRemaining} ${summary.daysRemaining === 1 ? 'dia' : 'dias'}.` : 'Complete suas configurações financeiras para calcular a margem diária.'}</p>
        </section>

        <section className="mf-pulse__grid">
          <div><small>Disponível de verdade</small><strong>{summary ? formatCurrency(available) : '—'}</strong></div>
          <div><small>Próximo recebimento</small><strong>{summary?.nextPaydayLabel || '—'}</strong></div>
        </section>

        <section className="mf-pulse__commitment">
          <div className="mf-pulse__commitment-icon"><CalendarClock size={20} /></div>
          <div>
            <small>Próximo compromisso</small>
            {nextCommitment ? <><strong>{nextCommitment.description || 'Compromisso financeiro'}</strong><span>{nextCommitment.due_date ? `Vence ${new Date(`${nextCommitment.due_date}T12:00:00`).toLocaleDateString('pt-BR')}` : 'Data a confirmar'} · {formatCurrency(Math.abs(nextCommitment.amount))}</span></> : <strong>Nenhum compromisso pendente</strong>}
          </div>
        </section>

        <div className="mf-pulse__actions">
          <button type="button" onClick={() => navigate(MOBILE_ROUTES.quick)}><Plus size={22} /><span>Lançar</span></button>
          <button type="button" onClick={() => navigate(MOBILE_ROUTES.scan)}><ScanLine size={21} /><span>Escanear</span></button>
          <button type="button" onClick={() => navigate(MOBILE_ROUTES.home)}><Home size={21} /><span>Início</span></button>
        </div>

        <p className="mf-pulse__note">O Pulse é uma leitura rápida do mesmo núcleo financeiro do MF. Nenhum valor é alterado por esta tela.</p>
      </main>
    </div>
  );
}
