import { useEffect, useMemo } from 'react';
import { useLocation } from 'react-router';

const ROUTE_TITLES: Array<[RegExp, string]> = [
  [/^\/app\/?$/, 'Início'],
  [/^\/app\/lancar/, 'Lançar'],
  [/^\/app\/movimentacoes\/importar/, 'Importar extrato'],
  [/^\/app\/movimentacoes\/lotes/, 'Histórico de importações'],
  [/^\/app\/movimentacoes/, 'Movimentações'],
  [/^\/app\/investimentos/, 'Investimentos'],
  [/^\/app\/planejamento\/contas/, 'Contas financeiras'],
  [/^\/app\/planejamento\/categorias/, 'Categorias'],
  [/^\/app\/planejamento\/cartoes/, 'Cartões e parcelas'],
  [/^\/app\/planejamento\/orcamento/, 'Orçamento'],
  [/^\/app\/planejamento\/metas/, 'Metas financeiras'],
  [/^\/app\/planejamento\/projecoes/, 'Simulador'],
  [/^\/app\/planejamento/, 'Planejamento'],
  [/^\/app\/agenda\/recorrencias/, 'Recorrências'],
  [/^\/app\/agenda\/receitas/, 'Receitas previstas'],
  [/^\/app\/agenda/, 'Agenda Financeira'],
  [/^\/app\/analises\/insights/, 'Insights'],
  [/^\/app\/integracoes/, 'Conexões'],
  [/^\/app\/admin/, 'Administração'],
];

function routeTitle(pathname: string) { return ROUTE_TITLES.find(([pattern]) => pattern.test(pathname))?.[1] || 'MF Financeiro'; }

function enhanceAccessibleNames(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('button[title], a[title]').forEach((element) => {
    if (!element.getAttribute('aria-label')) { const title = element.getAttribute('title'); if (title) element.setAttribute('aria-label', title); }
  });
  root.querySelectorAll<HTMLElement>('.mf-error').forEach((element) => { element.setAttribute('role', 'alert'); element.setAttribute('aria-live', 'assertive'); });
  root.querySelectorAll<HTMLElement>('.mf-loading').forEach((element) => { element.setAttribute('role', 'status'); element.setAttribute('aria-live', 'polite'); });
}

export default function AccessibilityLayer() {
  const location = useLocation();
  const title = useMemo(() => routeTitle(location.pathname), [location.pathname]);
  const inApplication = location.pathname.startsWith('/app');

  useEffect(() => {
    document.title = `${title} · MF Financeiro`;
    if (!inApplication) return;
    const focusMain = () => {
      const main = document.querySelector<HTMLElement>('.mf-content');
      if (!main) return false;
      main.id = 'mf-main-content';
      main.setAttribute('role', 'main');
      main.setAttribute('aria-label', title);
      main.tabIndex = -1;
      main.focus({ preventScroll: true });
      return true;
    };
    const frame = window.requestAnimationFrame(() => { if (!focusMain()) window.setTimeout(focusMain, 120); });
    return () => window.cancelAnimationFrame(frame);
  }, [inApplication, location.pathname, title]);

  useEffect(() => {
    enhanceAccessibleNames();
    const observer = new MutationObserver((records) => {
      records.forEach((record) => record.addedNodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        enhanceAccessibleNames(node);
        if (node.matches('button[title], a[title], .mf-error, .mf-loading')) enhanceAccessibleNames(node.parentNode || node);
      }));
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return <>{inApplication && <a className="mf-skip-link" href="#mf-main-content">Pular para o conteúdo principal</a>}<div className="mf-visually-hidden" role="status" aria-live="polite" aria-atomic="true">{inApplication ? `Página carregada: ${title}. Atalho de busca: Control ou Command mais K. Privacidade: Alt mais P.` : ''}</div></>;
}
