import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowLeftRight,
  BarChart3,
  CircleDollarSign,
  CreditCard,
  FileText,
  HeartPulse,
  Landmark,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  Plus,
  Receipt,
  Target,
  Upload,
  Zap,
} from 'lucide-react';

type Primary = 'home' | 'movements' | 'organize' | 'analysis';
type Subroute =
  | 'accounts'
  | 'cards'
  | 'income'
  | 'subscriptions'
  | 'investments'
  | 'summary'
  | 'insights'
  | 'health'
  | 'goals';
type RouteState = { primary: Primary; sub?: Subroute };

const normalize = (value?: string | null) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();

function isVisible(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
}

function legacyButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.mf-nav > button'))
    .filter((button) => !button.closest('#mf-simple-navigation-app'));
}

function suppressLegacyNavigation() {
  legacyButtons().forEach((button) => {
    button.dataset.mfLegacyNav = 'true';
    button.style.setProperty('display', 'none', 'important');
    button.setAttribute('aria-hidden', 'true');
    button.tabIndex = -1;
  });
}

function findLegacyButton(labels: string[], scope: ParentNode = document): HTMLButtonElement | null {
  const wanted = labels.map(normalize);
  return Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find((button) => {
    if (button.closest('#mf-simple-navigation-root')) return false;
    const label = normalize(button.textContent);
    return wanted.some((item) => label === item || label.includes(item));
  }) || null;
}

function clickLegacy(labels: string[]) {
  const button = findLegacyButton(labels);
  if (!button) return false;
  button.click();
  return true;
}

function delayed(labels: string[], delay: number) {
  window.setTimeout(() => clickLegacy(labels), delay);
}

function findLegacyIncomePanel(): HTMLElement | null {
  const legacyTab = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
    .find((button) => normalize(button.textContent) === 'renda e ciclo');
  if (!legacyTab) return null;

  let current: HTMLElement | null = legacyTab.parentElement;
  while (current && current !== document.body) {
    const text = normalize(current.textContent);
    if (text.includes('renda e ciclo') && text.includes('ajustes') && text.includes('resumo salarial estimado')) return current;
    current = current.parentElement;
  }
  return null;
}

function syncIncomePayrollLayer(active: boolean) {
  const legacyPanel = findLegacyIncomePanel();
  if (legacyPanel) {
    if (active) {
      if (legacyPanel.dataset.mfOriginalDisplay === undefined) legacyPanel.dataset.mfOriginalDisplay = legacyPanel.style.display || '';
      legacyPanel.style.display = 'none';
      legacyPanel.setAttribute('aria-hidden', 'true');
    } else if (legacyPanel.dataset.mfOriginalDisplay !== undefined) {
      legacyPanel.style.display = legacyPanel.dataset.mfOriginalDisplay;
      legacyPanel.removeAttribute('aria-hidden');
      delete legacyPanel.dataset.mfOriginalDisplay;
    }
  }

  const page = document.querySelector<HTMLElement>('#mf-income-payroll-center-root > div');
  if (!page) return;
  if (!active) {
    page.style.removeProperty('left');
    page.style.removeProperty('right');
    page.style.removeProperty('top');
    page.style.removeProperty('bottom');
    page.style.removeProperty('border-radius');
    return;
  }

  const content = document.querySelector<HTMLElement>('.mf-content');
  if (!content) return;
  const rect = content.getBoundingClientRect();
  page.style.left = `${Math.max(0, Math.round(rect.left))}px`;
  page.style.right = `${Math.max(0, Math.round(window.innerWidth - rect.right))}px`;
  page.style.top = `${Math.max(0, Math.round(rect.top))}px`;
  page.style.bottom = '0px';
  page.style.borderRadius = '0';
}

function go(route: RouteState) {
  sessionStorage.setItem('mf-simple-route', JSON.stringify(route));

  if (route.primary === 'home') {
    clickLegacy(['Dashboard']);
    return;
  }

  if (route.primary === 'movements') {
    clickLegacy(['Histórico']);
    delayed(['Movimentações'], 90);
    return;
  }

  if (route.primary === 'organize') {
    if (route.sub === 'cards') {
      clickLegacy(['Cartões']);
      return;
    }

    if (route.sub === 'income') {
      clickLegacy(['Renda e Folha', 'Preferências']);
      return;
    }

    clickLegacy(['Contas']);
    if (route.sub === 'subscriptions') {
      delayed(['Assinaturas'], 90);
      return;
    }
    if (route.sub === 'investments') {
      delayed(['Investimentos'], 90);
      return;
    }

    delayed(['Gestão de contas'], 90);
    delayed(['Contas fixas'], 180);
    return;
  }

  if (route.primary === 'analysis') {
    clickLegacy(['Análises']);
    if (route.sub === 'insights') delayed(['Insights AI', 'Insights'], 90);
    else if (route.sub === 'health') delayed(['Saúde financeira'], 90);
    else if (route.sub === 'goals') delayed(['Metas'], 90);
    else delayed(['Estatísticas'], 90);
  }
}

function triggerUnifiedLauncher() {
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.textContent = 'Lançar';
  trigger.style.display = 'none';
  document.body.appendChild(trigger);
  trigger.click();
  trigger.remove();
}

function waitForLauncher(callback: (root: HTMLElement) => void, attempt = 0) {
  const root = document.getElementById('mf-unified-transaction-root');
  if (root) {
    callback(root);
    return;
  }
  if (attempt < 24) window.setTimeout(() => waitForLauncher(callback, attempt + 1), 50);
}

function openIncomeLauncher(category: 'Renda extra' | 'Benefícios', benefitMethod: boolean) {
  triggerUnifiedLauncher();

  waitForLauncher((root) => {
    const incomeButton = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      isVisible(button) && normalize(button.textContent) === 'entrada',
    );
    incomeButton?.click();

    window.setTimeout(() => {
      const select = Array.from(root.querySelectorAll<HTMLSelectElement>('select')).find((candidate) =>
        Array.from(candidate.options).some((option) => option.value === category || option.textContent?.trim() === category),
      );
      if (select) {
        const option = Array.from(select.options).find((item) => item.value === category || item.textContent?.trim() === category);
        if (option) {
          const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
          setter?.call(select, option.value);
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }

      if (benefitMethod) {
        const benefitButton = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
          isVisible(button) && normalize(button.textContent) === 'beneficio',
        );
        benefitButton?.click();
      }
    }, 60);
  });
}

function openTransferLauncher() {
  triggerUnifiedLauncher();
  waitForLauncher((root) => {
    const selectTransfer = (attempt = 0) => {
      const transferButton = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
        isVisible(button) && normalize(button.textContent).includes('transferencia'),
      );
      if (transferButton) {
        transferButton.click();
        return;
      }
      if (attempt < 10) window.setTimeout(() => selectTransfer(attempt + 1), 60);
    };
    selectTransfer();
  });
}

function openStatementImport() {
  sessionStorage.setItem('mf-simple-route', JSON.stringify({ primary: 'movements' } satisfies RouteState));
  clickLegacy(['Histórico']);
  delayed(['Importar extrato'], 120);
}

function inferRoute(): RouteState {
  const stored = sessionStorage.getItem('mf-simple-route');
  let saved: RouteState | null = null;
  try { saved = stored ? JSON.parse(stored) as RouteState : null; } catch { saved = null; }

  const activeTop = legacyButtons().find((button) => button.classList.contains('active'));
  const top = normalize(activeTop?.textContent);
  const activeSubs = Array.from(document.querySelectorAll<HTMLButtonElement>('.mf-content button.active')).map((button) => normalize(button.textContent));

  if (top.includes('historico')) return { primary: 'movements' };
  if (top.includes('cartoes')) return { primary: 'organize', sub: 'cards' };
  if (top.includes('renda e folha') || top.includes('preferencias')) return { primary: 'organize', sub: 'income' };

  if (top.includes('analises')) {
    if (activeSubs.some((item) => item.includes('insights'))) return { primary: 'analysis', sub: 'insights' };
    if (activeSubs.some((item) => item.includes('saude'))) return { primary: 'analysis', sub: 'health' };
    if (activeSubs.some((item) => item.includes('metas'))) return { primary: 'analysis', sub: 'goals' };
    return { primary: 'analysis', sub: 'summary' };
  }

  if (top.includes('contas')) {
    if (activeSubs.some((item) => item.includes('investimentos'))) return { primary: 'organize', sub: 'investments' };
    if (activeSubs.some((item) => item.includes('assinaturas'))) return { primary: 'organize', sub: 'subscriptions' };
    return { primary: 'organize', sub: 'accounts' };
  }

  if (saved?.primary === 'organize' && saved.sub === 'income' && document.querySelector('#mf-income-payroll-center-root')) {
    return saved;
  }

  return { primary: 'home' };
}

const primaryItems = [
  { id: 'home' as const, label: 'Início', icon: LayoutDashboard },
  { id: 'movements' as const, label: 'Movimentações', icon: Receipt },
  { id: 'organize' as const, label: 'Organizar', icon: CircleDollarSign },
  { id: 'analysis' as const, label: 'Análises', icon: BarChart3 },
];

const organizeItems = [
  { id: 'accounts' as const, label: 'Contas', icon: CircleDollarSign },
  { id: 'cards' as const, label: 'Cartões', icon: CreditCard },
  { id: 'income' as const, label: 'Renda', icon: FileText },
  { id: 'subscriptions' as const, label: 'Assinaturas', icon: ListChecks },
  { id: 'investments' as const, label: 'Investimentos', icon: Landmark },
];

const analysisItems = [
  { id: 'summary' as const, label: 'Resumo', icon: BarChart3 },
  { id: 'insights' as const, label: 'Insights', icon: Lightbulb },
  { id: 'health' as const, label: 'Saúde', icon: HeartPulse },
  { id: 'goals' as const, label: 'Metas', icon: Target },
];

function SimpleNavigation() {
  const [route, setRoute] = useState<RouteState>({ primary: 'home' });

  useEffect(() => {
    const sync = () => {
      suppressLegacyNavigation();
      const next = inferRoute();
      syncIncomePayrollLayer(next.primary === 'organize' && next.sub === 'income');
      setRoute(next);
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    const timer = window.setInterval(sync, 500);
    window.addEventListener('resize', sync);

    return () => {
      observer.disconnect();
      window.clearInterval(timer);
      window.removeEventListener('resize', sync);
    };
  }, []);

  const subItems = route.primary === 'organize'
    ? organizeItems
    : route.primary === 'analysis'
      ? analysisItems
      : [];

  return (
    <div id="mf-simple-navigation-root">
      <style>{`
        #mf-simple-navigation-app { width:100%; min-width:0; }
        #mf-simple-navigation-root { width:100%; min-width:0; }
        .mf-simple-nav { width:100%; display:flex; flex-direction:column; gap:6px; }
        .mf-simple-main,.mf-simple-sub,.mf-simple-quick { display:flex; align-items:center; gap:6px; overflow-x:auto; scrollbar-width:none; }
        .mf-simple-main::-webkit-scrollbar,.mf-simple-sub::-webkit-scrollbar,.mf-simple-quick::-webkit-scrollbar { display:none; }
        .mf-simple-main { justify-content:center; }
        .mf-simple-button { flex:0 0 auto; display:inline-flex; align-items:center; justify-content:center; gap:7px; border-radius:11px; padding:8px 13px; color:rgba(255,255,255,.58); font-size:11px; font-weight:850; border:1px solid transparent; background:transparent; transition:.18s ease; white-space:nowrap; }
        .mf-simple-button:hover { color:#fff; background:rgba(255,255,255,.055); }
        .mf-simple-main .mf-simple-button.active { color:#041114; background:var(--brand-primary,#00f2ff); box-shadow:0 0 20px rgba(0,242,255,.13); }
        .mf-simple-sub { justify-content:center; }
        .mf-simple-sub .mf-simple-button { padding:5px 9px; font-size:10px; color:rgba(255,255,255,.5); background:rgba(255,255,255,.025); border-color:rgba(255,255,255,.055); }
        .mf-simple-sub .mf-simple-button.active { color:var(--brand-primary,#00f2ff); background:rgba(0,242,255,.075); border-color:rgba(0,242,255,.2); }
        .mf-simple-context-label { flex:0 0 auto; display:inline-flex; align-items:center; padding-right:3px; color:rgba(255,255,255,.28); font-size:9px; font-weight:900; letter-spacing:.08em; text-transform:uppercase; }
        .mf-simple-quick { justify-content:center; }
        .mf-simple-quick-label { flex:0 0 auto; display:inline-flex; align-items:center; gap:4px; color:rgba(255,255,255,.34); font-size:9px; font-weight:900; letter-spacing:.06em; text-transform:uppercase; white-space:nowrap; }
        .mf-simple-quick-button { flex:0 0 auto; display:inline-flex; align-items:center; justify-content:center; gap:6px; min-height:25px; padding:4px 9px; border-radius:9px; border:1px solid rgba(0,242,255,.11); background:rgba(0,242,255,.035); color:rgba(255,255,255,.68); font-size:9px; font-weight:800; white-space:nowrap; transition:.16s ease; }
        .mf-simple-quick-button:hover { color:var(--brand-primary,#00f2ff); border-color:rgba(0,242,255,.28); background:rgba(0,242,255,.075); }
        @media(max-width:1100px){
          .mf-simple-quick-label{display:none}
          .mf-simple-quick-button{padding-inline:7px}
        }
        @media(max-width:820px){
          .mf-simple-main{justify-content:flex-start}
          .mf-simple-sub,.mf-simple-quick{justify-content:flex-start}
          .mf-simple-main .mf-simple-button span{display:inline}
          .mf-simple-button{padding:7px 10px}
        }
        @media(max-width:560px){
          .mf-simple-context-label{display:none}
          .mf-simple-quick-button span{display:none}
          .mf-simple-quick-button{width:31px;padding:5px}
        }
      `}</style>

      <nav className="mf-simple-nav" aria-label="Navegação financeira">
        <div className="mf-simple-main">
          {primaryItems.map((item) => (
            <button
              data-mf-simple-nav="true"
              key={item.id}
              type="button"
              className={`mf-simple-button ${route.primary === item.id ? 'active' : ''}`}
              onClick={() => go({
                primary: item.id,
                sub: item.id === 'organize' ? 'accounts' : item.id === 'analysis' ? 'summary' : undefined,
              })}
            >
              <item.icon size={15}/><span>{item.label}</span>
            </button>
          ))}
        </div>

        {route.primary === 'home' && (
          <div className="mf-simple-quick" aria-label="Ações rápidas">
            <span className="mf-simple-quick-label"><Zap size={11}/>Ações rápidas</span>
            <button type="button" className="mf-simple-quick-button" onClick={triggerUnifiedLauncher}>
              <Plus size={12}/><span>Lançar</span>
            </button>
            <button type="button" className="mf-simple-quick-button" onClick={openStatementImport}>
              <Upload size={12}/><span>Importar extrato</span>
            </button>
            <button type="button" className="mf-simple-quick-button" onClick={() => go({ primary: 'organize', sub: 'accounts' })}>
              <CircleDollarSign size={12}/><span>Contas a pagar</span>
            </button>
            <button type="button" className="mf-simple-quick-button" onClick={openTransferLauncher}>
              <ArrowLeftRight size={12}/><span>Transferência</span>
            </button>
          </div>
        )}

        {subItems.length > 0 && (
          <div className="mf-simple-sub">
            <span className="mf-simple-context-label">{route.primary === 'organize' ? 'Organizar' : 'Análises'}</span>
            {subItems.map((item) => (
              <button
                data-mf-simple-nav="true"
                key={item.id}
                type="button"
                className={`mf-simple-button ${route.sub === item.id ? 'active' : ''}`}
                onClick={() => go({ primary: route.primary, sub: item.id })}
              >
                <item.icon size={13}/><span>{item.label}</span>
              </button>
            ))}
          </div>
        )}

        {route.primary === 'organize' && route.sub === 'income' && (
          <div className="mf-simple-sub" aria-label="Atalhos de renda">
            <span className="mf-simple-context-label">Atalhos</span>
            <button data-mf-simple-nav="true" type="button" className="mf-simple-button" onClick={() => openIncomeLauncher('Renda extra', false)}>
              <span>+ Renda extra</span>
            </button>
            <button data-mf-simple-nav="true" type="button" className="mf-simple-button" onClick={() => openIncomeLauncher('Benefícios', true)}>
              <span>+ Benefício</span>
            </button>
          </div>
        )}
      </nav>
    </div>
  );
}

function mount() {
  if (document.getElementById('mf-simple-navigation-app')) return;
  const host = document.createElement('div');
  host.id = 'mf-simple-navigation-app';
  document.body.appendChild(host);
  createRoot(host).render(<SimpleNavigation/>);

  const place = () => {
    suppressLegacyNavigation();
    const nav = document.querySelector<HTMLElement>('.mf-nav');
    if (nav && host.parentElement !== nav) nav.appendChild(host);
  };

  place();
  const observer = new MutationObserver(place);
  observer.observe(document.body, { subtree:true, childList:true });
  const timer = window.setInterval(place, 500);
  window.addEventListener('beforeunload', () => {
    observer.disconnect();
    window.clearInterval(timer);
  }, { once:true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once:true });
else mount();

export {};