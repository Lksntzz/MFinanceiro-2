import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowLeftRight,
  BarChart3,
  CalendarDays,
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
  Settings,
  Target,
  Upload,
  Wallet,
} from 'lucide-react';

type Primary = 'home' | 'movements' | 'organize' | 'analysis';
type Subroute =
  | 'accounts'
  | 'cards'
  | 'income'
  | 'calendar'
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
    if (route.sub === 'calendar') {
      delayed(['Calendário'], 90);
      return;
    }
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
    if (activeSubs.some((item) => item.includes('calendario'))) return { primary: 'organize', sub: 'calendar' };
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
  { id: 'organize' as const, label: 'Planejamento', icon: Wallet },
  { id: 'analysis' as const, label: 'Análises', icon: BarChart3 },
];

const moneyItems = [
  { id: 'accounts' as const, label: 'Contas', icon: CircleDollarSign },
  { id: 'cards' as const, label: 'Cartões e parcelas', icon: CreditCard },
  { id: 'income' as const, label: 'Renda', icon: FileText },
];

const commitmentItems = [
  { id: 'calendar' as const, label: 'Calendário', icon: CalendarDays },
  { id: 'subscriptions' as const, label: 'Assinaturas', icon: ListChecks },
];

const futureItems = [
  { id: 'investments' as const, label: 'Investimentos', icon: Landmark },
];

const analysisItems = [
  { id: 'summary' as const, label: 'Visão geral', icon: BarChart3 },
  { id: 'insights' as const, label: 'Insights', icon: Lightbulb },
  { id: 'health' as const, label: 'Saúde financeira', icon: HeartPulse },
  { id: 'goals' as const, label: 'Metas', icon: Target },
];

function SideItem({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active?: boolean;
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`mf-side-item ${active ? 'active' : ''}`} onClick={onClick} title={label}>
      <Icon size={16}/><span>{label}</span>
    </button>
  );
}

function SideGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mf-side-group">
      <span className="mf-side-group-label">{label}</span>
      <div className="mf-side-group-items">{children}</div>
    </section>
  );
}

function SimpleNavigation() {
  const [route, setRoute] = useState<RouteState>({ primary: 'home' });

  useEffect(() => {
    document.body.classList.add('mf-sidebar-navigation-active');

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
      document.body.classList.remove('mf-sidebar-navigation-active');
      observer.disconnect();
      window.clearInterval(timer);
      window.removeEventListener('resize', sync);
    };
  }, []);

  return (
    <div id="mf-simple-navigation-root">
      <style>{`
        #mf-simple-navigation-app { position:fixed; inset:0 auto 0 0; width:0; height:0; z-index:120; }
        #mf-simple-navigation-root { width:auto; min-width:0; }

        body.mf-sidebar-navigation-active .mf-nav { display:none!important; }
        body.mf-sidebar-navigation-active .mf-brand { display:none!important; }
        body.mf-sidebar-navigation-active .mf-topbar {
          grid-template-columns:minmax(0,1fr) auto!important;
          min-height:36px;
        }
        body.mf-sidebar-navigation-active .mf-top-actions { grid-column:2; justify-self:end; }
        body.mf-sidebar-navigation-active .mf-app-shell {
          padding-left:max(210px, calc(194px + var(--mf-page-pad-x, 12px)))!important;
        }

        .mf-side-panel {
          position:fixed;
          left:max(10px, env(safe-area-inset-left));
          top:max(10px, env(safe-area-inset-top));
          bottom:max(10px, env(safe-area-inset-bottom));
          width:184px;
          display:flex;
          flex-direction:column;
          gap:13px;
          padding:14px 11px 12px;
          border:1px solid rgba(255,255,255,.07);
          border-radius:18px;
          background:linear-gradient(180deg, rgba(16,20,24,.97), rgba(8,11,14,.985));
          box-shadow:0 18px 54px rgba(0,0,0,.28);
          backdrop-filter:blur(18px);
          overflow:hidden;
        }
        .mf-side-brand { display:flex; align-items:center; gap:9px; min-height:36px; padding:2px 5px 9px; border-bottom:1px solid rgba(255,255,255,.065); }
        .mf-side-brand-mark { width:31px; height:31px; flex:0 0 31px; display:grid; place-items:center; border-radius:10px; color:#041114; background:var(--brand-primary,#00f2ff); font-size:15px; font-weight:950; }
        .mf-side-brand-copy { min-width:0; display:flex; flex-direction:column; }
        .mf-side-brand-copy strong { color:#fff; font-size:12px; letter-spacing:-.01em; }
        .mf-side-brand-copy small { color:rgba(255,255,255,.3); font-size:8px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }

        .mf-side-primary { display:flex; flex-direction:column; gap:4px; }
        .mf-side-item {
          width:100%; min-height:35px; display:flex; align-items:center; gap:9px; padding:8px 9px; border:1px solid transparent; border-radius:10px;
          background:transparent; color:rgba(255,255,255,.55); font-size:10.5px; font-weight:820; text-align:left; transition:.16s ease;
        }
        .mf-side-item:hover { color:#fff; background:rgba(255,255,255,.045); }
        .mf-side-item.active { color:#ecfeff; border-color:rgba(0,242,255,.18); background:rgba(0,242,255,.085); box-shadow:inset 2px 0 0 var(--brand-primary,#00f2ff); }
        .mf-side-item svg { flex:0 0 auto; opacity:.82; }
        .mf-side-item.active svg { color:var(--brand-primary,#00f2ff); opacity:1; }

        .mf-side-launch {
          width:100%; min-height:38px; display:flex; align-items:center; justify-content:center; gap:7px; padding:9px; border:0; border-radius:11px;
          color:#041114; background:var(--brand-primary,#00f2ff); font-size:10.5px; font-weight:950; box-shadow:0 8px 24px rgba(0,242,255,.12);
        }
        .mf-side-launch:hover { filter:brightness(1.06); }

        .mf-side-context { min-height:0; overflow-y:auto; overscroll-behavior:contain; scrollbar-width:none; padding-right:1px; }
        .mf-side-context::-webkit-scrollbar { display:none; }
        .mf-side-context-title { display:block; margin:2px 6px 8px; color:rgba(255,255,255,.78); font-size:10px; font-weight:900; }
        .mf-side-group { margin-top:11px; }
        .mf-side-group:first-of-type { margin-top:0; }
        .mf-side-group-label { display:block; margin:0 8px 4px; color:rgba(255,255,255,.25); font-size:7.5px; font-weight:950; letter-spacing:.11em; text-transform:uppercase; }
        .mf-side-group-items { display:flex; flex-direction:column; gap:2px; }
        .mf-side-group .mf-side-item { min-height:30px; padding:6px 8px; font-size:9.5px; border-radius:9px; }
        .mf-side-group .mf-side-item svg { width:14px; height:14px; }

        .mf-side-shortcuts { margin-top:auto; padding-top:10px; border-top:1px solid rgba(255,255,255,.06); display:grid; grid-template-columns:repeat(3,1fr); gap:5px; }
        .mf-side-shortcut { min-width:0; height:31px; display:grid; place-items:center; border:1px solid rgba(255,255,255,.065); border-radius:9px; color:rgba(255,255,255,.48); background:rgba(255,255,255,.025); }
        .mf-side-shortcut:hover { color:var(--brand-primary,#00f2ff); border-color:rgba(0,242,255,.18); background:rgba(0,242,255,.055); }
        .mf-side-settings { width:100%; min-height:30px; display:flex; align-items:center; gap:8px; padding:6px 8px; border:0; border-radius:9px; color:rgba(255,255,255,.38); background:transparent; font-size:9px; font-weight:800; }
        .mf-side-settings:hover { color:#fff; background:rgba(255,255,255,.04); }

        @media (min-width:821px) and (max-width:1180px) {
          body.mf-sidebar-navigation-active .mf-app-shell { padding-left:max(182px, calc(166px + var(--mf-page-pad-x, 10px)))!important; }
          .mf-side-panel { width:156px; padding-inline:9px; }
          .mf-side-brand-copy strong { font-size:11px; }
          .mf-side-item { font-size:9.5px; padding-inline:8px; }
          .mf-side-group .mf-side-item { font-size:9px; }
        }

        @media (max-height:720px) and (min-width:821px) {
          .mf-side-panel { gap:8px; padding-top:10px; padding-bottom:9px; }
          .mf-side-brand { min-height:31px; padding-bottom:6px; }
          .mf-side-primary { gap:2px; }
          .mf-side-item { min-height:29px; padding-block:5px; }
          .mf-side-launch { min-height:32px; padding-block:6px; }
          .mf-side-group { margin-top:6px; }
          .mf-side-group .mf-side-item { min-height:25px; padding-block:4px; }
          .mf-side-shortcuts { padding-top:6px; }
          .mf-side-shortcut { height:27px; }
        }

        @media (max-width:820px) {
          #mf-simple-navigation-app { inset:auto 0 0 0; width:auto; height:auto; z-index:160; }
          body.mf-sidebar-navigation-active .mf-brand { display:flex!important; }
          body.mf-sidebar-navigation-active .mf-nav { display:none!important; }
          body.mf-sidebar-navigation-active .mf-topbar { grid-template-columns:minmax(0,1fr) auto!important; }
          body.mf-sidebar-navigation-active .mf-app-shell { padding-left:max(var(--mf-page-pad-x,8px), env(safe-area-inset-left))!important; padding-bottom:78px!important; }
          .mf-side-panel {
            position:fixed; left:8px; right:8px; bottom:max(8px, env(safe-area-inset-bottom)); top:auto; width:auto; height:auto;
            padding:6px; border-radius:15px; display:block; overflow:visible;
          }
          .mf-side-brand,.mf-side-context,.mf-side-shortcuts,.mf-side-settings,.mf-side-launch { display:none; }
          .mf-side-primary { display:grid; grid-template-columns:repeat(4,1fr); gap:4px; }
          .mf-side-primary .mf-side-item { min-height:48px; flex-direction:column; justify-content:center; gap:3px; padding:5px 2px; font-size:8px; text-align:center; }
          .mf-side-primary .mf-side-item.active { box-shadow:inset 0 -2px 0 var(--brand-primary,#00f2ff); }
        }
      `}</style>

      <aside className="mf-side-panel" aria-label="Navegação financeira">
        <div className="mf-side-brand">
          <div className="mf-side-brand-mark">M</div>
          <div className="mf-side-brand-copy"><strong>MFinanceiro</strong><small>Central financeira</small></div>
        </div>

        <nav className="mf-side-primary">
          {primaryItems.map((item) => (
            <SideItem
              key={item.id}
              active={route.primary === item.id}
              icon={item.icon}
              label={item.label}
              onClick={() => go({ primary: item.id, sub: item.id === 'organize' ? 'accounts' : item.id === 'analysis' ? 'summary' : undefined })}
            />
          ))}
        </nav>

        <button type="button" className="mf-side-launch" onClick={triggerUnifiedLauncher}><Plus size={15}/>Lançar</button>

        <div className="mf-side-context">
          {route.primary === 'organize' && (
            <>
              <span className="mf-side-context-title">Planejamento</span>
              <SideGroup label="Dinheiro">
                {moneyItems.map((item) => <SideItem key={item.id} active={route.sub === item.id} icon={item.icon} label={item.label} onClick={() => go({ primary: 'organize', sub: item.id })}/>)}
              </SideGroup>
              <SideGroup label="Compromissos">
                {commitmentItems.map((item) => <SideItem key={item.id} active={route.sub === item.id} icon={item.icon} label={item.label} onClick={() => go({ primary: 'organize', sub: item.id })}/>)}
              </SideGroup>
              <SideGroup label="Futuro">
                {futureItems.map((item) => <SideItem key={item.id} active={route.sub === item.id} icon={item.icon} label={item.label} onClick={() => go({ primary: 'organize', sub: item.id })}/>)}
              </SideGroup>
            </>
          )}

          {route.primary === 'analysis' && (
            <>
              <span className="mf-side-context-title">Análises</span>
              <SideGroup label="Entender seus dados">
                {analysisItems.map((item) => <SideItem key={item.id} active={route.sub === item.id} icon={item.icon} label={item.label} onClick={() => go({ primary: 'analysis', sub: item.id })}/>)}
              </SideGroup>
            </>
          )}

          {route.primary === 'home' && (
            <div className="mf-side-context-title">Visão rápida e próximos passos.</div>
          )}

          {route.primary === 'movements' && (
            <div className="mf-side-context-title">Histórico, filtros e importação.</div>
          )}
        </div>

        <div className="mf-side-shortcuts" aria-label="Atalhos rápidos">
          <button type="button" className="mf-side-shortcut" onClick={openStatementImport} title="Importar extrato"><Upload size={14}/></button>
          <button type="button" className="mf-side-shortcut" onClick={openTransferLauncher} title="Transferência"><ArrowLeftRight size={14}/></button>
          <button type="button" className="mf-side-shortcut" onClick={() => go({ primary: 'organize', sub: 'calendar' })} title="Calendário"><CalendarDays size={14}/></button>
        </div>
        <button type="button" className="mf-side-settings" onClick={() => clickLegacy(['Preferências'])}><Settings size={13}/>Preferências</button>
      </aside>
    </div>
  );
}

function mount() {
  if (document.getElementById('mf-simple-navigation-app')) return;
  const host = document.createElement('div');
  host.id = 'mf-simple-navigation-app';
  document.body.appendChild(host);
  createRoot(host).render(<SimpleNavigation/>);

  const keep = () => suppressLegacyNavigation();
  keep();
  const observer = new MutationObserver(keep);
  observer.observe(document.body, { subtree:true, childList:true });
  const timer = window.setInterval(keep, 500);
  window.addEventListener('beforeunload', () => {
    observer.disconnect();
    window.clearInterval(timer);
  }, { once:true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once:true });
else mount();

export {};