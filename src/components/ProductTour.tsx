import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadUserPreferences } from '../lib/user-preferences';
import './ProductTour.css';

type TourStep = {
  id: string;
  title: string;
  description: string;
  selectors?: string[];
  padding?: number;
};
type TourDefinition = { id: string; label: string; steps: TourStep[] };
type RectState = { top: number; left: number; width: number; height: number };

const CONTENT = [
  '.mf-content .mf-card',
  '.mf-content main',
  '.mf-content > div',
  '.mf-content',
];
const ACTIONS = [
  '.mf-content button',
  '.mf-top-actions .primary',
  '.mf-side-launch',
];
const NAV = ['.mf-side-primary', '.mf-side-panel'];
const navItem = (href: string) => [
  `.mf-side-item[href="${href}"]`,
  `.mf-side-tool-row a[href="${href}"]`,
  ...NAV,
];
const s = (
  id: string,
  title: string,
  description: string,
  selectors = CONTENT,
  padding = 8,
): TourStep => ({ id, title, description, selectors, padding });
const t = (id: string, label: string, steps: TourStep[]): TourDefinition => ({
  id,
  label,
  steps,
});

function resolveTour(pathname: string): TourDefinition | null {
  const path = pathname.replace(/\/+$/, '') || '/app';
  if (path === '/app')
    return t('home-v3', 'Início', [
      {
        id: 'welcome',
        title: 'Bem-vindo ao MF Financeiro',
        description:
          'Vamos passar pelos principais blocos da sua visão financeira, cada um com uma função diferente.',
      },
      s(
        'balance',
        'Saldo atual',
        'Aqui você acompanha o saldo consolidado das suas contas. Este é o ponto de partida para entender sua posição financeira hoje.',
        ['.mf-kpi-grid .mf-kpi:nth-child(1)'],
      ),
      s(
        'limit',
        'Seu limite financeiro',
        'Este valor mostra quanto você pode gastar dentro do seu planejamento sem comprometer o equilíbrio do período.',
        ['.mf-kpi-grid .mf-kpi:nth-child(2)'],
      ),
      s(
        'cycle',
        'Ciclo atual',
        'Veja em qual período financeiro você está e quantos dias ainda faltam para o fechamento do ciclo.',
        ['.mf-kpi-grid .mf-kpi:nth-child(3)'],
      ),
      s(
        'today',
        'Gasto de hoje',
        'Acompanhe quanto já saiu hoje e compare rapidamente com o limite disponível.',
        ['.mf-kpi-grid .mf-kpi:nth-child(4)'],
      ),
      s(
        'status',
        'Status do ciclo',
        'Este alerta resume como o seu ciclo está se comportando e chama atenção para situações que merecem acompanhamento.',
        ['.mf-alert-grid .mf-alert:nth-child(1)'],
      ),
      s(
        'insight',
        'Insight financeiro',
        'Aqui o MF Financeiro transforma seus dados em uma leitura rápida para ajudar você a perceber tendências e tomar decisões.',
        ['.mf-alert-grid .mf-alert:nth-child(2)'],
      ),
      s(
        'evolution',
        'Evolução do saldo',
        'Este gráfico mostra como seu saldo mudou ao longo do tempo, para você enxergar a direção da sua vida financeira.',
        [
          '.mf-dashboard-grid > .mf-chart-card:nth-of-type(1)',
          '.mf-dashboard-grid .mf-chart-card:nth-child(3)',
        ],
      ),
      s(
        'rhythm',
        'Ritmo de gastos',
        'Compare entradas e saídas por dia, semana ou mês e entenda a velocidade com que o dinheiro está entrando e saindo.',
        [
          '.mf-dashboard-grid > .mf-chart-card:nth-of-type(2)',
          '.mf-dashboard-grid .mf-chart-card:nth-child(4)',
        ],
      ),
      s(
        'launch',
        'Registre entradas e saídas',
        'Use Lançar sempre que quiser registrar uma nova movimentação manualmente.',
        ['.mf-side-launch', '.mf-top-actions .primary'],
      ),
      s(
        'navigation',
        'Explore suas ferramentas',
        'Movimentações, Investimentos, Planejamento, Insights e Agenda ficam organizados na navegação principal.',
        NAV,
      ),
    ]);
  if (path === '/app/movimentacoes')
    return t('movements-v1', 'Movimentações', [
      s(
        'intro',
        'Suas movimentações',
        'Aqui fica o histórico central de entradas e saídas do MF Financeiro.',
      ),
      s(
        'nav',
        'Histórico, importação e conciliação',
        'O grupo Movimentações reúne histórico, importação de extrato e lotes.',
        navItem('/app/movimentacoes'),
      ),
      s(
        'actions',
        'Ações do histórico',
        'Filtros e ações ajudam a revisar o histórico sem perder contexto.',
        ACTIONS,
      ),
    ]);
  if (path === '/app/movimentacoes/importar')
    return t('import-v1', 'Importar extrato', [
      s(
        'intro',
        'Importe seu extrato',
        'Traga lançamentos do banco sem cadastrar um por um.',
      ),
      s(
        'review',
        'Revise antes de confirmar',
        'Confira os lançamentos antes de gravá-los no seu financeiro.',
        ['.mf-content form', '.mf-content .mf-card', '.mf-content'],
      ),
      s(
        'batches',
        'Concilie depois',
        'Histórico de importações ajuda a revisar o que entrou.',
        navItem('/app/movimentacoes/lotes'),
      ),
    ]);
  if (path === '/app/movimentacoes/lotes')
    return t('batches-v1', 'Histórico de importações', [
      s(
        'intro',
        'Histórico de importações',
        'Revise importações em grupo e identifique itens que precisam de atenção.',
      ),
      s(
        'actions',
        'Resolva pendências',
        'As ações da tela fecham o ciclo de revisão das importações.',
        ACTIONS,
      ),
    ]);
  if (path.startsWith('/app/investimentos'))
    return t('investments-v1', 'Investimentos', [
      s(
        'intro',
        'Sua área de investimentos',
        'Carteira e planejamento de aportes ficam concentrados aqui.',
      ),
      s(
        'nav',
        'Duas visões complementares',
        'Alterne entre Carteira e Planejamento de aportes.',
        navItem('/app/investimentos'),
      ),
      s(
        'content',
        'Acompanhe evolução e composição',
        'Os blocos mostram posição, evolução e próximos passos da carteira.',
        ['.mf-content .glass-card', '.mf-content .mf-card', '.mf-content'],
      ),
    ]);
  if (path === '/app/planejamento')
    return t('planning-v1', 'Planejamento', [
      s(
        'intro',
        'Planeje o mês',
        'Organize conta, receita, compromissos e orçamento a partir de uma visão única.',
      ),
      s(
        'journey',
        'Quatro bases do planejamento',
        'Conta, Receita, Compromissos e Orçamento mostram o que já está configurado e qual é o próximo passo.',
        [
          '[aria-label="Progresso do planejamento"]',
          '.mf-content .mf-card',
          '.mf-content',
        ],
      ),
      s(
        'content',
        'Transforme dados em plano',
        'Quando as quatro bases estiverem prontas, use o Simulador para testar decisões futuras.',
        CONTENT,
      ),
    ]);
  if (path === '/app/planejamento/contas')
    return t('accounts-v1', 'Contas financeiras', [
      s(
        'intro',
        'Contas financeiras',
        'Cadastre e organize onde seu dinheiro realmente está.',
      ),
      s(
        'actions',
        'Mantenha os saldos coerentes',
        'Crie, edite e revise suas contas por aqui.',
        ACTIONS,
      ),
    ]);
  if (path === '/app/planejamento/cartoes')
    return t('cards-v1', 'Cartões e parcelas', [
      s(
        'intro',
        'Cartões e parcelas',
        'Acompanhe limite, uso, faturas e parcelamentos sem perder o contexto do mês.',
      ),
      s(
        'actions',
        'Cadastre e atualize',
        'Inclua cartões, parcelas e registre pagamentos pelas ações da tela.',
        ACTIONS,
      ),
    ]);
  if (path === '/app/planejamento/orcamento')
    return t('budget-v1', 'Orçamento', [
      s(
        'intro',
        'Seu orçamento',
        'Defina limites por categoria e compare o planejado com o realizado.',
      ),
      s(
        'progress',
        'Acompanhe o consumo',
        'Barras e indicadores mostram onde o orçamento está saudável ou pressionado.',
        ['.mf-content .mf-progress', '.mf-content .mf-card', '.mf-content'],
      ),
    ]);
  if (path === '/app/planejamento/metas')
    return t('goals-v1', 'Metas financeiras', [
      s(
        'intro',
        'Metas financeiras',
        'Transforme objetivos em valores, prazos e progresso acompanhável.',
      ),
      s(
        'progress',
        'Veja o avanço',
        'O progresso visual mostra quanto falta para chegar ao objetivo.',
        ['.mf-content .mf-progress', '.mf-content .mf-card', '.mf-content'],
      ),
      s(
        'actions',
        'Atualize conforme avança',
        'Registre evolução para manter o plano atual.',
        ACTIONS,
      ),
    ]);
  if (path === '/app/planejamento/projecoes')
    return t('projections-v1', 'Simulador', [
      s(
        'intro',
        'Simulador',
        'Teste possibilidades futuras antes de transformar uma hipótese em decisão.',
      ),
      s(
        'controls',
        'Ajuste o cenário',
        'Use os controles da tela para comparar resultados em diferentes hipóteses.',
        ['.mf-content input', '.mf-content button', '.mf-content .mf-card'],
      ),
    ]);
  if (path === '/app/analises' || path === '/app/analises/resumo')
    return t('analysis-v1', 'Análises', [
      s(
        'intro',
        'Visão geral das análises',
        'Indicadores e gráficos transformam seu histórico em leitura financeira.',
      ),
      s(
        'nav',
        'Aprofunde a leitura',
        'Insights concentra a interpretação dos seus números.',
        navItem('/app/analises/insights'),
      ),
      s(
        'charts',
        'Leia tendências, não só números',
        'Use os gráficos para observar comportamento ao longo do tempo.',
        ['.mf-content canvas', '.mf-content .mf-card', '.mf-content'],
      ),
    ]);
  if (path === '/app/analises/insights')
    return t('insights-v1', 'Insights', [
      s(
        'intro',
        'Insights financeiros',
        'O MF Financeiro destaca padrões e sinais que merecem sua atenção.',
      ),
      s(
        'cards',
        'Priorize o que importa',
        'Os cards ajudam a transformar informação em decisão sem excesso de ruído.',
        CONTENT,
      ),
    ]);
  if (path === '/app/analises/saude')
    return t('health-v1', 'Insights', [
      s(
        'intro',
        'Leitura financeira',
        'Os diagnósticos úteis agora vivem em Insights, sem score artificial de saúde financeira.',
      ),
      s(
        'indicators',
        'Entenda os indicadores',
        'Os indicadores visuais ajudam a localizar rapidamente pontos de atenção.',
        ['.mf-content .mf-card', '.mf-content'],
      ),
    ]);
  if (path === '/app/agenda')
    return t('agenda-v1', 'Agenda Financeira', [
      s(
        'intro',
        'Sua Agenda Financeira',
        'Visualize vencimentos, entradas e compromissos organizados por data.',
      ),
      s(
        'nav',
        'Compromissos em um só lugar',
        'Recorrências e receitas previstas vivem dentro da Agenda.',
        navItem('/app/agenda'),
      ),
      s(
        'calendar',
        'Antecipe o que vem pela frente',
        'Use a visão temporal para se preparar antes dos compromissos chegarem.',
        [
          '.mf-content [class*="calendar"]',
          '.mf-content .mf-card',
          '.mf-content',
        ],
      ),
    ]);
  if (path === '/app/agenda/contas-fixas')
    return t('fixed-v1', 'Recorrências', [
      s(
        'intro',
        'Recorrências',
        'Cadastre compromissos recorrentes para incluí-los no planejamento.',
      ),
      s(
        'actions',
        'Acompanhe pagamentos',
        'Mantenha cada compromisso atualizado pelas ações da tela.',
        ACTIONS,
      ),
    ]);
  if (path === '/app/agenda/assinaturas')
    return t('subscriptions-v1', 'Recorrências', [
      s(
        'intro',
        'Assinaturas',
        'Veja serviços recorrentes e o impacto deles no seu mês.',
      ),
      s(
        'actions',
        'Mantenha só o que faz sentido',
        'Cadastre, revise e ajuste assinaturas conforme sua rotina muda.',
        ACTIONS,
      ),
    ]);
  if (path === '/app/agenda/receitas')
    return t('income-v1', 'Receitas previstas', [
      s(
        'intro',
        'Receitas previstas',
        'Organize entradas futuras para enxergar melhor o caixa antes do dinheiro chegar.',
      ),
      s(
        'actions',
        'Atualize quando a renda mudar',
        'Mantenha previsões e recorrências coerentes pelas ações da tela.',
        ACTIONS,
      ),
    ]);
  if (path === '/app/integracoes')
    return t('integrations-v1', 'Conexões', [
      s(
        'intro',
        'Conexões e automações',
        'Integre fontes e automatize tarefas para reduzir trabalho manual.',
      ),
      s(
        'actions',
        'Configure com controle',
        'Cada conexão pode ser revisada e ajustada dentro desta central.',
        ACTIONS,
      ),
      s(
        'nav',
        'Continue no fluxo principal',
        'A navegação permanece disponível para voltar às demais ferramentas.',
        NAV,
      ),
    ]);
  return null;
}

function findVisibleTarget(selectors?: string[]) {
  if (!selectors?.length) return null;
  for (const selector of selectors) {
    const visible = Array.from(
      document.querySelectorAll<HTMLElement>(selector),
    ).find((element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0
      );
    });
    if (visible) return visible;
  }
  return null;
}

function getTourScopeId(tourId: string) {
  return tourId.replace(/-v\d+$/i, '');
}

function isResolvedPreference(value: string | null) {
  return value === 'done' || value === 'skipped';
}

function migrateLegacyTourPreference(
  tourId: string,
  userId: string,
  stableStorageKey: string,
) {
  try {
    const scopeId = getTourScopeId(tourId);
    const legacyPrefix = `mf-tour:${scopeId}-v`;
    const userSuffix = `:${userId}`;

    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(legacyPrefix) || !key.endsWith(userSuffix)) continue;
      const legacyValue = window.localStorage.getItem(key);
      if (!isResolvedPreference(legacyValue)) continue;
      window.localStorage.setItem(
        stableStorageKey,
        legacyValue as 'done' | 'skipped',
      );
      return true;
    }
  } catch {
    // Tour preferences are optional and should never block the product.
  }
  return false;
}

export default function ProductTour({
  userId,
  pathname,
}: {
  userId: string;
  pathname: string;
}) {
  const tour = useMemo(() => resolveTour(pathname), [pathname]);
  const tourScopeId = useMemo(
    () => (tour ? getTourScopeId(tour.id) : ''),
    [tour?.id, tour],
  );
  const storageKey = useMemo(
    () => (tourScopeId ? `mf-tour:${tourScopeId}:${userId}` : ''),
    [tourScopeId, userId],
  );
  const globalSkipKey = useMemo(
    () => `mf-tour:all-skipped:${userId}`,
    [userId],
  );
  const [open, setOpen] = useState(false);
  const [skipPromptOpen, setSkipPromptOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<RectState | null>(null);
  const steps = tour?.steps || [];
  const step = steps[stepIndex];

  useEffect(() => {
    setOpen(false);
    setSkipPromptOpen(false);
    setStepIndex(0);
    if (!tour || !storageKey) return;

    let shouldAutoStart = false;
    try {
      const preferences = loadUserPreferences(userId);
      const globalSkipped =
        window.localStorage.getItem(globalSkipKey) === 'skipped';
      const storedPreference = window.localStorage.getItem(storageKey);
      const resolved =
        isResolvedPreference(storedPreference) ||
        migrateLegacyTourPreference(tour.id, userId, storageKey);
      const isHomeTour = tourScopeId === 'home';
      shouldAutoStart =
        isHomeTour && preferences.toursAutoStart && !globalSkipped && !resolved;
    } catch {
      shouldAutoStart = false;
    }

    // Manual starts always remain available from the ? button, even after "Pular tudo".
    const start = () => {
      setStepIndex(0);
      setSkipPromptOpen(false);
      setOpen(true);
    };
    const timer = shouldAutoStart ? window.setTimeout(start, 650) : null;
    window.addEventListener('mf:start-product-tour', start);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener('mf:start-product-tour', start);
    };
  }, [tour?.id, tourScopeId, storageKey, globalSkipKey, userId, tour]);

  useEffect(() => {
    if (!open || !step || skipPromptOpen) return;
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
    const observer =
      target && 'ResizeObserver' in window
        ? new ResizeObserver(updateRect)
        : null;
    if (target && observer) observer.observe(target);
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [open, step, skipPromptOpen]);

  function finish() {
    try {
      if (storageKey) window.localStorage.setItem(storageKey, 'done');
    } catch {
      /* optional */
    }
    setSkipPromptOpen(false);
    setOpen(false);
  }

  function skipCurrentTour() {
    try {
      if (storageKey) window.localStorage.setItem(storageKey, 'skipped');
    } catch {
      /* optional */
    }
    setSkipPromptOpen(false);
    setOpen(false);
  }

  function skipAllTours() {
    try {
      window.localStorage.setItem(globalSkipKey, 'skipped');
    } catch {
      /* optional */
    }
    setSkipPromptOpen(false);
    setOpen(false);
  }

  function next() {
    if (skipPromptOpen) return;
    if (stepIndex >= steps.length - 1) finish();
    else setStepIndex((current) => current + 1);
  }
  function previous() {
    if (skipPromptOpen) return;
    setStepIndex((current) => Math.max(0, current - 1));
  }

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (skipPromptOpen) setSkipPromptOpen(false);
        else setSkipPromptOpen(true);
      } else if (!skipPromptOpen && event.key === 'ArrowRight') next();
      else if (!skipPromptOpen && event.key === 'ArrowLeft') previous();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });

  if (!open || !tour || !step) return null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const tooltipWidth = Math.min(360, vw - 24);
  const gap = 14;
  let tooltipTop = Math.max(16, (vh - 220) / 2);
  let tooltipLeft = Math.max(12, (vw - tooltipWidth) / 2);
  if (targetRect && !skipPromptOpen) {
    const below = targetRect.top + targetRect.height + gap;
    const above = targetRect.top - 220 - gap;
    tooltipTop = below + 210 < vh ? below : Math.max(12, above);
    tooltipLeft = Math.min(
      vw - tooltipWidth - 12,
      Math.max(12, targetRect.left + targetRect.width / 2 - tooltipWidth / 2),
    );
  }

  return createPortal(
    <div
      className="mf-tour-root"
      role="dialog"
      aria-modal="true"
      aria-label={`Tutorial: ${tour.label}`}
    >
      {targetRect && !skipPromptOpen ? (
        <>
          <div
            className="mf-tour-shade"
            style={{ top: 0, left: 0, right: 0, height: targetRect.top }}
          />
          <div
            className="mf-tour-shade"
            style={{
              top: targetRect.top,
              left: 0,
              width: targetRect.left,
              height: targetRect.height,
            }}
          />
          <div
            className="mf-tour-shade"
            style={{
              top: targetRect.top,
              left: targetRect.left + targetRect.width,
              right: 0,
              height: targetRect.height,
            }}
          />
          <div
            className="mf-tour-shade"
            style={{
              top: targetRect.top + targetRect.height,
              left: 0,
              right: 0,
              bottom: 0,
            }}
          />
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
        {skipPromptOpen ? (
          <div
            className="mf-tour-skip-confirm"
            role="alertdialog"
            aria-labelledby="mf-tour-skip-title"
            aria-describedby="mf-tour-skip-copy"
          >
            <p className="mf-tour-kicker">Preferência do tutorial</p>
            <h2 id="mf-tour-skip-title">Deseja pular o tutorial?</h2>
            <p id="mf-tour-skip-copy" className="mf-tour-copy">
              Escolha se quer pular apenas o tutorial de {tour.label} ou
              desativar a abertura automática do tutorial. O botão ? continuará
              disponível quando você quiser rever qualquer ferramenta.
            </p>
            <div className="mf-tour-skip-options">
              <button
                type="button"
                className="mf-tour-skip-tool"
                onClick={skipCurrentTour}
              >
                Pular nesta ferramenta
              </button>
              <button
                type="button"
                className="mf-tour-skip-all"
                onClick={skipAllTours}
              >
                Pular tudo
              </button>
              <button
                type="button"
                className="mf-tour-continue"
                onClick={() => setSkipPromptOpen(false)}
              >
                Continuar tutorial
              </button>
            </div>
          </div>
        ) : (
          <>
            <div
              className="mf-tour-progress"
              style={{ gridTemplateColumns: `repeat(${steps.length}, 1fr)` }}
              aria-label={`Passo ${stepIndex + 1} de ${steps.length}`}
            >
              {steps.map((item, index) => (
                <span
                  key={item.id}
                  className={index <= stepIndex ? 'active' : ''}
                />
              ))}
            </div>
            <p className="mf-tour-kicker">
              {tour.label} · Passo {stepIndex + 1} de {steps.length}
            </p>
            <h2>{step.title}</h2>
            <p className="mf-tour-copy">{step.description}</p>
            <div className="mf-tour-actions">
              <button
                type="button"
                className="mf-tour-skip"
                onClick={() => setSkipPromptOpen(true)}
              >
                Pular tour
              </button>
              <div>
                {stepIndex > 0 ? (
                  <button
                    type="button"
                    className="mf-tour-back"
                    onClick={previous}
                  >
                    Voltar
                  </button>
                ) : null}
                <button type="button" className="mf-tour-next" onClick={next}>
                  {stepIndex === steps.length - 1 ? 'Concluir' : 'Próximo'}
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>,
    document.body,
  );
}
