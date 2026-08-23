import {
  ArrowRight,
  CalendarDays,
  Check,
  CircleDollarSign,
  Lightbulb,
  ListChecks,
  Target,
  TrendingUp,
} from 'lucide-react';
import type React from 'react';

type PlanningJourneyProps = {
  hasAccount: boolean;
  hasIncome: boolean;
  hasCommitments: boolean;
  hasBudget: boolean;
  onNavigate: (path: string) => void;
};

type PlanningBase = {
  id: string;
  label: string;
  detail: string;
  done: boolean;
  path: string;
  icon: React.ComponentType<{ size?: number }>;
};

export default function PlanningJourney({
  hasAccount,
  hasIncome,
  hasCommitments,
  hasBudget,
  onNavigate,
}: PlanningJourneyProps) {
  const bases: PlanningBase[] = [
    {
      id: 'account',
      label: 'Conta',
      detail: 'Onde seu dinheiro está',
      done: hasAccount,
      path: '/app/planejamento/contas',
      icon: CircleDollarSign,
    },
    {
      id: 'income',
      label: 'Receita',
      detail: 'O que deve entrar',
      done: hasIncome,
      path: '/app/agenda/receitas',
      icon: TrendingUp,
    },
    {
      id: 'commitments',
      label: 'Compromissos',
      detail: 'O que tem data para sair',
      done: hasCommitments,
      path: '/app/agenda/recorrencias',
      icon: CalendarDays,
    },
    {
      id: 'budget',
      label: 'Orçamento',
      detail: 'Quanto pretende gastar',
      done: hasBudget,
      path: '/app/planejamento/orcamento',
      icon: Target,
    },
  ];

  const completed = bases.filter((item) => item.done).length;
  const next = bases.find((item) => !item.done) || null;
  const progress = Math.round((completed / bases.length) * 100);

  return (
    <section
      className="mf-card border-brand-primary/15 bg-brand-primary/[0.025]"
      aria-label="Progresso do planejamento"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-brand-primary/15 bg-brand-primary/[0.07] text-brand-primary">
              <ListChecks size={18} />
            </span>
            <div className="min-w-0">
              <p className="text-[8px] font-black uppercase tracking-[0.18em] text-brand-primary/70">
                Planejamento do mês
              </p>
              <h3 className="mt-1 text-sm font-black text-white/90">
                {next
                  ? `${completed} de ${bases.length} bases configuradas`
                  : 'Base do planejamento configurada'}
              </h3>
              <p className="mt-1 max-w-3xl text-[10px] leading-5 text-white/40">
                {next
                  ? 'Complete a próxima base para o MF conectar saldo, datas, orçamento e projeções sem criar ferramentas separadas.'
                  : 'Sua estrutura essencial está pronta. Use o Simulador para testar decisões futuras sem alterar seus lançamentos reais.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() =>
              onNavigate(next?.path || '/app/planejamento/projecoes')
            }
            className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-xl border border-brand-primary/35 bg-brand-primary px-3 py-2 text-[10px] font-black text-black transition hover:opacity-90"
          >
            {next ? `Configurar ${next.label}` : 'Abrir Simulador'}
            <ArrowRight size={14} />
          </button>
        </div>

        <div
          className="h-1.5 overflow-hidden rounded-full bg-white/[0.055]"
          aria-label={`${progress}% do planejamento configurado`}
        >
          <div
            className="h-full rounded-full bg-brand-primary transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {bases.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.path)}
                className={`flex min-h-14 items-center gap-3 rounded-xl border px-3 py-2 text-left transition ${item.done ? 'border-emerald-400/15 bg-emerald-400/[0.045] text-white/75' : 'border-white/10 bg-black/15 text-white/55 hover:border-brand-primary/20 hover:bg-brand-primary/[0.035]'}`}
              >
                <span
                  className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${item.done ? 'border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300' : 'border-white/10 bg-white/[0.025] text-white/35'}`}
                >
                  {item.done ? <Check size={15} /> : <Icon size={15} />}
                </span>
                <span className="min-w-0">
                  <strong className="block text-[10px] font-black">
                    {item.label}
                  </strong>
                  <small className="mt-0.5 block truncate text-[8px] text-white/30">
                    {item.done ? 'Configurado' : item.detail}
                  </small>
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/[0.07] pt-3 text-[9px] text-white/35">
          <span className="font-bold text-white/45">
            Conexões do planejamento
          </span>
          <button
            type="button"
            onClick={() => onNavigate('/app/agenda')}
            className="inline-flex items-center gap-1.5 hover:text-brand-primary"
          >
            <CalendarDays size={12} />
            Agenda organiza as datas
          </button>
          <button
            type="button"
            onClick={() => onNavigate('/app/analises/insights')}
            className="inline-flex items-center gap-1.5 hover:text-brand-primary"
          >
            <Lightbulb size={12} />
            Insights interpreta os resultados
          </button>
        </div>
      </div>
    </section>
  );
}
