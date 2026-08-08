import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import './ProductTour.css';

type TourStep = {
  id: string;
  title: string;
  description: string;
  selectors?: string[];
  padding?: number;
};

type RectState = {
  top: number;
  left: number;
  width: number;
  height: number;
};

const HOME_TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: 'Bem-vindo ao MF Financeiro',
    description: 'Em poucos passos, você vai conhecer os principais pontos do seu painel financeiro.',
  },
  {
    id: 'balance',
    title: 'Seu saldo em destaque',
    description: 'Aqui você acompanha o saldo consolidado das suas contas e pode calibrá-lo quando necessário.',
    selectors: ['.mf-kpi-grid .mf-kpi:first-child'],
    padding: 8,
  },
  {
    id: 'launch',
    title: 'Registre entradas e saídas',
    description: 'Use Lançar para registrar movimentações rapidamente. No celular, o botão principal no topo assume esse papel.',
    selectors: ['.mf-side-launch', '.mf-top-actions .primary'],
    padding: 8,
  },
  {
    id: 'indicators',
    title: 'Acompanhe seu ritmo financeiro',
    description: 'Limite, ciclo atual e gasto de hoje ajudam você a entender quanto pode gastar e como está avançando no período.',
    selectors: ['.mf-kpi-grid'],
    padding: 8,
  },
  {
    id: 'navigation',
    title: 'Explore suas ferramentas',
    description: 'Movimentações, Investimentos, Planejamento, Análises e Agenda Financeira ficam organizados na navegação principal.',
    selectors: ['.mf-side-primary', '.mf-side-panel'],
    padding: 8,
  },
];

function findVisibleTarget(selectors?: string[]) {
  if (!selectors?.length) return null;

  for (const selector of selectors) {
    const elements = Array.from(document.querySelectorAll<HTMLElement>(selector));
    const visible = elements.find((element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    });
    if (visible) return visible;
  }

  return null;
}

export default function ProductTour({ userId, enabled }: { userId: string; enabled: boolean }) {
  const storageKey = useMemo(() => `mf-tour-home-v1:${userId}`, [userId]);
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<RectState | null>(null);

  const step = HOME_TOUR_STEPS[stepIndex];

  useEffect(() => {
    if (!enabled) {
      setOpen(false);
      return;
    }

    let alreadySeen = false;
    try {
      alreadySeen = window.localStorage.getItem(storageKey) === 'done';
    } catch {
      alreadySeen = false;
    }

    const start = () => {
      setStepIndex(0);
      setOpen(true);
    };

    const timer = alreadySeen ? null : window.setTimeout(start, 800);
    window.addEventListener('mf:start-home-tour', start);

    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener('mf:start-home-tour', start);
    };
  }, [enabled, storageKey]);

  useEffect(() => {
    if (!open) return;

    const updateRect = () => {
      const target = findVisibleTarget(step.selectors);
      if (!target) {
        setTargetRect(null);
        return;
      }

      const rect = target.getBoundingClientRect();
      const padding = step.padding ?? 10;
      setTargetRect({
        top: Math.max(8, rect.top - padding),
        left: Math.max(8, rect.left - padding),
        width: Math.min(window.innerWidth - 16, rect.width + padding * 2),
        height: Math.min(window.innerHeight - 16, rect.height + padding * 2),
      });
    };

    updateRect();
    const target = findVisibleTarget(step.selectors);
    const observer = target && 'ResizeObserver' in window ? new ResizeObserver(updateRect) : null;
    if (target && observer) observer.observe(target);

    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [open, step]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish();
      if (event.key === 'ArrowRight') next();
      if (event.key === 'ArrowLeft') previous();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });

  function rememberDone() {
    try {
      window.localStorage.setItem(storageKey, 'done');
    } catch {
      // The tour still works when local storage is unavailable.
    }
  }

  function finish() {
    rememberDone();
    setOpen(false);
  }

  function next() {
    if (stepIndex >= HOME_TOUR_STEPS.length - 1) {
      finish();
      return;
    }
    setStepIndex((current) => current + 1);
  }

  function previous() {
    setStepIndex((current) => Math.max(0, current - 1));
  }

  if (!open || !enabled) return null;

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const tooltipWidth = Math.min(360, viewportWidth - 24);
  const gap = 14;

  let tooltipTop = Math.max(16, (viewportHeight - 220) / 2);
  let tooltipLeft = Math.max(12, (viewportWidth - tooltipWidth) / 2);

  if (targetRect) {
    const preferredBelow = targetRect.top + targetRect.height + gap;
    const preferredAbove = targetRect.top - 220 - gap;
    tooltipTop = preferredBelow + 210 < viewportHeight ? preferredBelow : Math.max(12, preferredAbove);
    tooltipLeft = Math.min(
      viewportWidth - tooltipWidth - 12,
      Math.max(12, targetRect.left + targetRect.width / 2 - tooltipWidth / 2),
    );
  }

  return createPortal(
    <div className="mf-tour-root" role="dialog" aria-modal="true" aria-label="Tutorial do MF Financeiro">
      {targetRect ? (
        <>
          <div className="mf-tour-shade" style={{ top: 0, left: 0, right: 0, height: targetRect.top }} />
          <div className="mf-tour-shade" style={{ top: targetRect.top, left: 0, width: targetRect.left, height: targetRect.height }} />
          <div className="mf-tour-shade" style={{ top: targetRect.top, left: targetRect.left + targetRect.width, right: 0, height: targetRect.height }} />
          <div className="mf-tour-shade" style={{ top: targetRect.top + targetRect.height, left: 0, right: 0, bottom: 0 }} />
          <div
            className="mf-tour-spotlight"
            style={{
              top: targetRect.top,
              left: targetRect.left,
              width: targetRect.width,
              height: targetRect.height,
            }}
          />
        </>
      ) : (
        <div className="mf-tour-shade mf-tour-shade-full" />
      )}

      <section
        className="mf-tour-card"
        style={{ top: tooltipTop, left: tooltipLeft, width: tooltipWidth }}
      >
        <div className="mf-tour-progress" aria-label={`Passo ${stepIndex + 1} de ${HOME_TOUR_STEPS.length}`}>
          {HOME_TOUR_STEPS.map((item, index) => (
            <span key={item.id} className={index <= stepIndex ? 'active' : ''} />
          ))}
        </div>
        <p className="mf-tour-kicker">Passo {stepIndex + 1} de {HOME_TOUR_STEPS.length}</p>
        <h2>{step.title}</h2>
        <p className="mf-tour-copy">{step.description}</p>
        <div className="mf-tour-actions">
          <button type="button" className="mf-tour-skip" onClick={finish}>Pular tour</button>
          <div>
            {stepIndex > 0 && <button type="button" className="mf-tour-back" onClick={previous}>Voltar</button>}
            <button type="button" className="mf-tour-next" onClick={next} autoFocus>
              {stepIndex === HOME_TOUR_STEPS.length - 1 ? 'Concluir' : 'Próximo'}
            </button>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
