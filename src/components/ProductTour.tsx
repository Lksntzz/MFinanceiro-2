import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import './ProductTour.css';

type TourStep = { id: string; title: string; description: string; selectors?: string[]; padding?: number };
type TourDefinition = { id: string; label: string; steps: TourStep[] };
type RectState = { top: number; left: number; width: number; height: number };

const CONTENT = ['.mf-content .mf-card', '.mf-content main', '.mf-content > div', '.mf-content'];
const ACTIONS = ['.mf-content button', '.mf-top-actions .primary', '.mf-side-launch'];
const NAV = ['.mf-side-primary', '.mf-side-panel'];
const navItem = (href: string) => [`.mf-side-item[href="${href}"]`, `.mf-side-tool-row a[href="${href}"]`, ...NAV];
const s = (id: string, title: string, description: string, selectors = CONTENT, padding = 8): TourStep => ({ id, title, description, selectors, padding });
const t = (id: string, label: string, steps: TourStep[]): TourDefinition => ({ id, label, steps });

function resolveTour(pathname: string): TourDefinition | null {
  const path = pathname.replace(/\/+$/, '') || '/app';
  if (path === '/app') return t('home-v2', 'Início', [
    { id: 'welcome', title: 'Bem-vindo ao MF Financeiro', description: 'Em poucos passos, conheça os pontos essenciais do seu painel financeiro.' },
    s('balance', 'Seu saldo em destaque', 'Acompanhe o saldo consolidado das suas contas e calibre quando necessário.', ['.mf-kpi-grid .mf-kpi:first-child']),
    s('launch', 'Registre entradas e saídas', 'Use Lançar para registrar movimentações rapidamente.', ['.mf-side-launch', '.mf-top-actions .primary']),
    s('indicators', 'Acompanhe seu ritmo financeiro', 'Limite, ciclo atual e gasto de hoje ajudam a entender seu ritmo no período.', ['.mf-kpi-grid']),
    s('navigation', 'Explore suas ferramentas', 'Movimentações, Investimentos, Planejamento, Análises e Agenda ficam na navegação principal.', NAV),
  ]);
  if (path === '/app/movimentacoes') return t('movements-v1', 'Movimentações', [
    s('intro', 'Suas movimentações', 'Aqui fica o histórico central de entradas e saídas do MF Financeiro.'),
    s('nav', 'Histórico, importação e conciliação', 'O grupo Movimentações reúne histórico, importação de extrato e lotes.', navItem('/app/movimentacoes')),
    s('actions', 'Ações do histórico', 'Filtros e ações ajudam a revisar o histórico sem perder contexto.', ACTIONS),
  ]);
  if (path === '/app/movimentacoes/importar') return t('import-v1', 'Importar extrato', [
    s('intro', 'Importe seu extrato', 'Traga lançamentos do banco sem cadastrar um por um.'),
    s('review', 'Revise antes de confirmar', 'Confira os lançamentos antes de gravá-los no seu financeiro.', ['.mf-content form', '.mf-content .mf-card', '.mf-content']),
    s('batches', 'Concilie depois', 'Lotes e conciliação ajuda a revisar o que entrou.', navItem('/app/movimentacoes/lotes')),
  ]);
  if (path === '/app/movimentacoes/lotes') return t('batches-v1', 'Lotes e conciliação', [
    s('intro', 'Lotes e conciliação', 'Revise importações em grupo e identifique itens que precisam de atenção.'),
    s('actions', 'Resolva pendências', 'As ações da tela fecham o ciclo de revisão das importações.', ACTIONS),
  ]);
  if (path.startsWith('/app/investimentos')) return t('investments-v1', 'Investimentos', [
    s('intro', 'Sua área de investimentos', 'Carteira, proventos e planejamento de aportes ficam concentrados aqui.'),
    s('nav', 'Três visões complementares', 'Alterne entre Carteira, Proventos e Planejamento de aportes.', navItem('/app/investimentos')),
    s('content', 'Acompanhe evolução e composição', 'Os blocos mostram posição, evolução e próximos passos da carteira.', ['.mf-content .glass-card', '.mf-content .mf-card', '.mf-content']),
  ]);
  if (path === '/app/planejamento') return t('planning-v1', 'Planejamento', [
    s('intro', 'Planeje o mês', 'Organize contas, orçamento e decisões futuras a partir de uma visão única.'),
    s('nav', 'Ferramentas de planejamento', 'Contas, cartões, orçamento, metas e projeções ficam no mesmo grupo.', navItem('/app/planejamento')),
    s('content', 'Transforme dados em plano', 'Compare o planejado com a sua realidade financeira.', CONTENT),
  ]);
  if (path === '/app/planejamento/contas') return t('accounts-v1', 'Contas financeiras', [
    s('intro', 'Contas financeiras', 'Cadastre e organize onde seu dinheiro realmente está.'),
    s('actions', 'Mantenha os saldos coerentes', 'Crie, edite e revise suas contas por aqui.', ACTIONS),
  ]);
  if (path === '/app/planejamento/cartoes') return t('cards-v1', 'Cartões e parcelas', [
    s('intro', 'Cartões e parcelas', 'Acompanhe limite, uso, faturas e parcelamentos sem perder o contexto do mês.'),
    s('actions', 'Cadastre e atualize', 'Inclua cartões, parcelas e registre pagamentos pelas ações da tela.', ACTIONS),
  ]);
  if (path === '/app/planejamento/orcamento') return t('budget-v1', 'Orçamento', [
    s('intro', 'Seu orçamento', 'Defina limites por categoria e compare o planejado com o realizado.'),
    s('progress', 'Acompanhe o consumo', 'Barras e indicadores mostram onde o orçamento está saudável ou pressionado.', ['.mf-content .mf-progress', '.mf-content .mf-card', '.mf-content']),
  ]);
  if (path === '/app/planejamento/metas') return t('goals-v1', 'Metas financeiras', [
    s('intro', 'Metas financeiras', 'Transforme objetivos em valores, prazos e progresso acompanhável.'),
    s('progress', 'Veja o avanço', 'O progresso visual mostra quanto falta para chegar ao objetivo.', ['.mf-content .mf-progress', '.mf-content .mf-card', '.mf-content']),
    s('actions', 'Atualize conforme avança', 'Registre evolução para manter o plano atual.', ACTIONS),
  ]);
  if (path === '/app/planejamento/projecoes') return t('projections-v1', 'Projeções e cenários', [
    s('intro', 'Projeções e cenários', 'Teste possibilidades futuras antes de transformar uma hipótese em decisão.'),
    s('controls', 'Ajuste o cenário', 'Use os controles da tela para comparar resultados em diferentes hipóteses.', ['.mf-content input', '.mf-content button', '.mf-content .mf-card']),
  ]);
  if (path === '/app/analises' || path === '/app/analises/resumo') return t('analysis-v1', 'Análises', [
    s('intro', 'Visão geral das análises', 'Indicadores e gráficos transformam seu histórico em leitura financeira.'),
    s('nav', 'Aprofunde a leitura', 'Insights e Saúde financeira complementam a visão geral.', navItem('/app/analises/resumo')),
    s('charts', 'Leia tendências, não só números', 'Use os gráficos para observar comportamento ao longo do tempo.', ['.mf-content canvas', '.mf-content .mf-card', '.mf-content']),
  ]);
  if (path === '/app/analises/insights') return t('insights-v1', 'Insights', [
    s('intro', 'Insights financeiros', 'O MF Financeiro destaca padrões e sinais que merecem sua atenção.'),
    s('cards', 'Priorize o que importa', 'Os cards ajudam a transformar informação em decisão sem excesso de ruído.', CONTENT),
  ]);
  if (path === '/app/analises/saude') return t('health-v1', 'Saúde financeira', [
    s('intro', 'Saúde financeira', 'Veja uma leitura consolidada do equilíbrio entre renda, gastos, reserva e compromissos.'),
    s('indicators', 'Entenda os indicadores', 'Os indicadores visuais ajudam a localizar rapidamente pontos fortes e de atenção.', ['.mf-content .mf-progress', '.mf-content .mf-card', '.mf-content']),
  ]);
  if (path === '/app/agenda') return t('agenda-v1', 'Agenda Financeira', [
    s('intro', 'Sua Agenda Financeira', 'Visualize vencimentos, entradas e compromissos organizados por data.'),
    s('nav', 'Compromissos em um só lugar', 'Contas fixas, assinaturas e receitas previstas vivem dentro da Agenda.', navItem('/app/agenda')),
    s('calendar', 'Antecipe o que vem pela frente', 'Use a visão temporal para se preparar antes dos compromissos chegarem.', ['.mf-content [class*="calendar"]', '.mf-content .mf-card', '.mf-content']),
  ]);
  if (path === '/app/agenda/contas-fixas') return t('fixed-v1', 'Contas fixas', [
    s('intro', 'Contas fixas', 'Cadastre compromissos recorrentes para incluí-los no planejamento.'),
    s('actions', 'Acompanhe pagamentos', 'Mantenha cada compromisso atualizado pelas ações da tela.', ACTIONS),
  ]);
  if (path === '/app/agenda/assinaturas') return t('subscriptions-v1', 'Assinaturas', [
    s('intro', 'Assinaturas', 'Veja serviços recorrentes e o impacto deles no seu mês.'),
    s('actions', 'Mantenha só o que faz sentido', 'Cadastre, revise e ajuste assinaturas conforme sua rotina muda.', ACTIONS),
  ]);
  if (path === '/app/agenda/receitas') return t('income-v1', 'Receitas previstas', [
    s('intro', 'Receitas previstas', 'Organize entradas futuras para enxergar melhor o caixa antes do dinheiro chegar.'),
    s('actions', 'Atualize quando a renda mudar', 'Mantenha previsões e recorrências coerentes pelas ações da tela.', ACTIONS),
  ]);
  if (path === '/app/integracoes') return t('integrations-v1', 'Integrações', [
    s('intro', 'Conexões e automações', 'Integre fontes e automatize tarefas para reduzir trabalho manual.'),
    s('actions', 'Configure com controle', 'Cada conexão pode ser revisada e ajustada dentro desta central.', ACTIONS),
    s('nav', 'Continue no fluxo principal', 'A navegação permanece disponível para voltar às demais ferramentas.', NAV),
  ]);
  return null;
}

function findVisibleTarget(selectors?: string[]) {
  if (!selectors?.length) return null;
  for (const selector of selectors) {
    const visible = Array.from(document.querySelectorAll<HTMLElement>(selector)).find((element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    });
    if (visible) return visible;
  }
  return null;
}

export default function ProductTour({ userId, pathname }: { userId: string; pathname: string }) {
  const tour = useMemo(() => resolveTour(pathname), [pathname]);
  const storageKey = useMemo(() => tour ? `mf-tour:${tour.id}:${userId}` : '', [tour?.id, userId]);
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<RectState | null>(null);
  const steps = tour?.steps || [];
  const step = steps[stepIndex];

  useEffect(() => {
    setOpen(false);
    setStepIndex(0);
    if (!tour || !storageKey) return;
    let seen = false;
    try { seen = window.localStorage.getItem(storageKey) === 'done'; } catch { seen = false; }
    const start = () => { setStepIndex(0); setOpen(true); };
    const timer = seen ? null : window.setTimeout(start, 650);
    window.addEventListener('mf:start-product-tour', start);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener('mf:start-product-tour', start);
    };
  }, [tour?.id, storageKey]);

  useEffect(() => {
    if (!open || !step) return;
    const updateRect = () => {
      const target = findVisibleTarget(step.selectors);
      if (!target) { setTargetRect(null); return; }
      const rect = target.getBoundingClientRect();
      const padding = step.padding ?? 10;
      setTargetRect({
        top: Math.max(8, rect.top - padding), left: Math.max(8, rect.left - padding),
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
    return () => { observer?.disconnect(); window.removeEventListener('resize', updateRect); window.removeEventListener('scroll', updateRect, true); };
  }, [open, step]);

  function finish() {
    try { if (storageKey) window.localStorage.setItem(storageKey, 'done'); } catch { /* optional */ }
    setOpen(false);
  }
  function next() { if (stepIndex >= steps.length - 1) finish(); else setStepIndex((current) => current + 1); }
  function previous() { setStepIndex((current) => Math.max(0, current - 1)); }

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish();
      else if (event.key === 'ArrowRight') next();
      else if (event.key === 'ArrowLeft') previous();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });

  if (!open || !tour || !step) return null;
  const vw = window.innerWidth; const vh = window.innerHeight; const tooltipWidth = Math.min(360, vw - 24); const gap = 14;
  let tooltipTop = Math.max(16, (vh - 220) / 2); let tooltipLeft = Math.max(12, (vw - tooltipWidth) / 2);
  if (targetRect) {
    const below = targetRect.top + targetRect.height + gap; const above = targetRect.top - 220 - gap;
    tooltipTop = below + 210 < vh ? below : Math.max(12, above);
    tooltipLeft = Math.min(vw - tooltipWidth - 12, Math.max(12, targetRect.left + targetRect.width / 2 - tooltipWidth / 2));
  }

  return createPortal(<div className="mf-tour-root" role="dialog" aria-modal="true" aria-label={`Tutorial: ${tour.label}`}>
    {targetRect ? <>
      <div className="mf-tour-shade" style={{ top: 0, left: 0, right: 0, height: targetRect.top }} />
      <div className="mf-tour-shade" style={{ top: targetRect.top, left: 0, width: targetRect.left, height: targetRect.height }} />
      <div className="mf-tour-shade" style={{ top: targetRect.top, left: targetRect.left + targetRect.width, right: 0, height: targetRect.height }} />
      <div className="mf-tour-shade" style={{ top: targetRect.top + targetRect.height, left: 0, right: 0, bottom: 0 }} />
      <div className="mf-tour-spotlight" style={{ top: targetRect.top, left: targetRect.left, width: targetRect.width, height: targetRect.height }} />
    </> : <div className="mf-tour-shade mf-tour-shade-full" />}
    <section className="mf-tour-card" style={{ top: tooltipTop, left: tooltipLeft, width: tooltipWidth }}>
      <div className="mf-tour-progress" style={{ gridTemplateColumns: `repeat(${steps.length}, 1fr)` }} aria-label={`Passo ${stepIndex + 1} de ${steps.length}`}>
        {steps.map((item, index) => <span key={item.id} className={index <= stepIndex ? 'active' : ''} />)}
      </div>
      <p className="mf-tour-kicker">{tour.label} · Passo {stepIndex + 1} de {steps.length}</p>
      <h2>{step.title}</h2><p className="mf-tour-copy">{step.description}</p>
      <div className="mf-tour-actions"><button type="button" className="mf-tour-skip" onClick={finish}>Pular tour</button><div>
        {stepIndex > 0 ? <button type="button" className="mf-tour-back" onClick={previous}>Voltar</button> : null}
        <button type="button" className="mf-tour-next" onClick={next} autoFocus>{stepIndex === steps.length - 1 ? 'Concluir' : 'Próximo'}</button>
      </div></div>
    </section>
  </div>, document.body);
}
