import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BarChart3,
  CircleDollarSign,
  CreditCard,
  FileText,
  HeartPulse,
  Landmark,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  PiggyBank,
  Receipt,
  Repeat2,
  Target,
} from 'lucide-react';

type Primary = 'home' | 'movements' | 'accounts' | 'cards' | 'income' | 'analysis';
type Subroute = 'fixed' | 'subscriptions' | 'budgets' | 'summary' | 'insights' | 'health' | 'goals' | 'investments';
type RouteState = { primary: Primary; sub?: Subroute };

const normalize = (value?: string | null) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();

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

function go(route: RouteState) {
  sessionStorage.setItem('mf-simple-route', JSON.stringify(route));

  if (route.primary === 'home') clickLegacy(['Dashboard']);
  if (route.primary === 'movements') clickLegacy(['Histórico']);
  if (route.primary === 'cards') clickLegacy(['Cartões']);
  if (route.primary === 'income') clickLegacy(['Renda e Folha', 'Preferências']);

  if (route.primary === 'accounts') {
    clickLegacy(['Contas']);
    if (route.sub === 'subscriptions') delayed(['Assinaturas'], 90);
    else {
      delayed(['Gestão de contas'], 90);
      delayed(route.sub === 'budgets' ? ['Orçamentos'] : ['Contas fixas'], 190);
    }
  }

  if (route.primary === 'analysis') {
    if (route.sub === 'investments') {
      clickLegacy(['Contas']);
      delayed(['Investimentos'], 90);
      return;
    }
    clickLegacy(['Análises']);
    if (route.sub === 'insights') delayed(['Insights AI'], 90);
    else if (route.sub === 'health') delayed(['Saúde financeira'], 90);
    else if (route.sub === 'goals') delayed(['Metas'], 90);
    else delayed(['Estatísticas'], 90);
  }
}

function inferRoute(): RouteState {
  const stored = sessionStorage.getItem('mf-simple-route');
  let saved: RouteState | null = null;
  try { saved = stored ? JSON.parse(stored) as RouteState : null; } catch { saved = null; }

  const activeTop = legacyButtons().find((button) => button.classList.contains('active'));
  const top = normalize(activeTop?.textContent);
  const activeSubs = Array.from(document.querySelectorAll<HTMLButtonElement>('.mf-content button.active')).map((button) => normalize(button.textContent));

  if (top.includes('historico')) return { primary: 'movements' };
  if (top.includes('cartoes')) return { primary: 'cards' };
  if (top.includes('renda e folha') || top.includes('preferencias')) return { primary: 'income' };
  if (top.includes('analises')) {
    if (activeSubs.some((item) => item.includes('insights'))) return { primary: 'analysis', sub: 'insights' };
    if (activeSubs.some((item) => item.includes('saude'))) return { primary: 'analysis', sub: 'health' };
    if (activeSubs.some((item) => item.includes('metas'))) return { primary: 'analysis', sub: 'goals' };
    return { primary: 'analysis', sub: 'summary' };
  }
  if (top.includes('contas')) {
    if (activeSubs.some((item) => item.includes('investimentos'))) return saved?.primary === 'analysis' ? saved : { primary: 'analysis', sub: 'investments' };
    if (activeSubs.some((item) => item.includes('assinaturas'))) return { primary: 'accounts', sub: 'subscriptions' };
    if (activeSubs.some((item) => item.includes('orcamentos'))) return { primary: 'accounts', sub: 'budgets' };
    return { primary: 'accounts', sub: 'fixed' };
  }
  return { primary: 'home' };
}

function SimpleNavigation() {
  const [route, setRoute] = useState<RouteState>({ primary: 'home' });

  useEffect(() => {
    const sync = () => {
      suppressLegacyNavigation();
      setRoute(inferRoute());
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    const timer = window.setInterval(sync, 500);

    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  const primaryItems = useMemo(() => [
    { id: 'home' as const, label: 'Início', icon: LayoutDashboard },
    { id: 'movements' as const, label: 'Movimentações', icon: Receipt },
    { id: 'accounts' as const, label: 'Contas', icon: CircleDollarSign },
    { id: 'cards' as const, label: 'Cartões', icon: CreditCard },
    { id: 'income' as const, label: 'Renda', icon: FileText },
    { id: 'analysis' as const, label: 'Análises', icon: BarChart3 },
  ], []);

  const subItems = route.primary === 'accounts'
    ? [
        { id: 'fixed' as const, label: 'Fixas', icon: Repeat2 },
        { id: 'subscriptions' as const, label: 'Assinaturas', icon: ListChecks },
        { id: 'budgets' as const, label: 'Orçamentos', icon: PiggyBank },
      ]
    : route.primary === 'analysis'
      ? [
          { id: 'summary' as const, label: 'Resumo', icon: BarChart3 },
          { id: 'insights' as const, label: 'Insights', icon: Lightbulb },
          { id: 'health' as const, label: 'Saúde', icon: HeartPulse },
          { id: 'goals' as const, label: 'Metas', icon: Target },
          { id: 'investments' as const, label: 'Investimentos', icon: Landmark },
        ]
      : [];

  return (
    <div id="mf-simple-navigation-root">
      <style>{`
        #mf-simple-navigation-app { width:100%; min-width:0; }
        #mf-simple-navigation-root { width:100%; min-width:0; }
        .mf-simple-main,.mf-simple-sub { display:flex; align-items:center; gap:6px; overflow-x:auto; scrollbar-width:none; }
        .mf-simple-main::-webkit-scrollbar,.mf-simple-sub::-webkit-scrollbar { display:none; }
        .mf-simple-nav { width:100%; display:flex; flex-direction:column; gap:7px; }
        .mf-simple-button { flex:0 0 auto; display:inline-flex; align-items:center; gap:7px; border-radius:12px; padding:8px 11px; color:rgba(255,255,255,.52); font-size:11px; font-weight:850; border:1px solid transparent; transition:.18s ease; }
        .mf-simple-button:hover { color:#fff; background:rgba(255,255,255,.055); }
        .mf-simple-button.active { color:#050505; background:var(--brand-primary,#00f2ff); box-shadow:0 0 20px rgba(0,242,255,.13); }
        .mf-simple-sub .mf-simple-button { padding:6px 10px; font-size:10px; background:rgba(255,255,255,.035); border-color:rgba(255,255,255,.06); }
        .mf-simple-sub .mf-simple-button.active { color:var(--brand-primary,#00f2ff); background:rgba(0,242,255,.08); border-color:rgba(0,242,255,.2); }
        @media(max-width:980px){ .mf-simple-main .mf-simple-button span{display:none}.mf-simple-main .mf-simple-button{padding:9px} }
      `}</style>
      <nav className="mf-simple-nav" aria-label="Ferramentas financeiras">
        <div className="mf-simple-main">
          {primaryItems.map((item) => (
            <button data-mf-simple-nav="true" key={item.id} type="button" className={`mf-simple-button ${route.primary === item.id ? 'active' : ''}`} onClick={() => go({ primary: item.id, sub: item.id === 'accounts' ? 'fixed' : item.id === 'analysis' ? 'summary' : undefined })}>
              <item.icon size={15}/><span>{item.label}</span>
            </button>
          ))}
        </div>
        {subItems.length > 0 && (
          <div className="mf-simple-sub">
            {subItems.map((item) => (
              <button data-mf-simple-nav="true" key={item.id} type="button" className={`mf-simple-button ${route.sub === item.id ? 'active' : ''}`} onClick={() => go({ primary: route.primary, sub: item.id })}>
                <item.icon size={13}/><span>{item.label}</span>
              </button>
            ))}
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
