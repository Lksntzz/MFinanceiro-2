import { CheckCircle2, ChevronRight, Circle, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { UserSettings } from '../types';

export default function OnboardingChecklist({
  userId,
  settings,
  transactionCount,
  hasCommitment,
  hasAccount,
  onProfile,
  onNavigate,
}: {
  userId: string;
  settings: UserSettings | null;
  transactionCount: number;
  hasCommitment: boolean;
  hasAccount: boolean;
  onProfile: () => void;
  onNavigate: (path: string) => void;
}) {
  const storageKey = `mf-onboarding:v1:${userId}`;
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(storageKey) === 'dismissed';
    } catch {
      return false;
    }
  });

  const steps = useMemo(
    () => [
      {
        id: 'profile',
        label: 'Confirmar seu perfil',
        done: Boolean(settings?.display_name?.trim()),
        action: onProfile,
      },
      {
        id: 'account',
        label: 'Configurar uma conta financeira',
        done: hasAccount,
        action: () => onNavigate('/app/planejamento/contas'),
      },
      {
        id: 'movement',
        label: 'Registrar ou importar a primeira movimentação',
        done: transactionCount > 0,
        action: () => onNavigate('/app/lancar'),
      },
      {
        id: 'commitment',
        label: 'Adicionar um compromisso futuro',
        done: hasCommitment,
        action: () => onNavigate('/app/agenda/recorrencias'),
      },
    ],
    [
      hasAccount,
      hasCommitment,
      onNavigate,
      onProfile,
      settings?.display_name,
      transactionCount,
    ],
  );

  const completed = steps.filter((step) => step.done).length;
  if (dismissed || completed === steps.length) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(storageKey, 'dismissed');
    } catch {
      /* optional */
    }
    setDismissed(true);
  }

  return (
    <section
      className="mf-card mf-onboarding-checklist"
      aria-label="Primeiros passos no MF Financeiro"
    >
      <div className="mf-onboarding-heading">
        <div>
          <p>Primeiros passos</p>
          <h2>Prepare sua base financeira</h2>
          <span>
            {completed} de {steps.length} concluídos · isto é onboarding, não
            uma atualização do sistema.
          </span>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Ocultar primeiros passos"
        >
          <X size={15} />
        </button>
      </div>
      <div className="mf-onboarding-steps">
        {steps.map((step) => (
          <button
            key={step.id}
            type="button"
            onClick={step.action}
            className={step.done ? 'done' : ''}
            disabled={step.done}
          >
            {step.done ? <CheckCircle2 size={15} /> : <Circle size={15} />}
            <span>{step.label}</span>
            {!step.done && <ChevronRight size={14} />}
          </button>
        ))}
      </div>
    </section>
  );
}
