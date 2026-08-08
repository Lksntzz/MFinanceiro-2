import React, { useEffect, useState } from 'react';
import {
  Bot,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  CreditCard,
  FileText,
  Landmark,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  PieChart,
  Plus,
  Receipt,
  Sparkles,
  Tags,
  Target,
  TrendingUp,
  Upload,
  Wallet,
} from 'lucide-react';
import { NavLink, useLocation, useNavigate } from 'react-router';

type NavigationItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  end?: boolean;
};

type InvestmentSection = 'portfolio' | 'planning';
type ToolGroup = 'movements' | 'investments' | 'planning' | 'agenda';

const movementItems: NavigationItem[] = [
  { to: '/app/movimentacoes', label: 'Movimentações', icon: Receipt, end: true },
  { to: '/app/movimentacoes/importar', label: 'Importar extrato', icon: Upload },
  { to: '/app/movimentacoes/lotes', label: 'Histórico de importações', icon: ListChecks },
];

const planningItems: NavigationItem[] = [
  { to: '/app/planejamento', label: 'Visão do mês', icon: CalendarDays, end: true },
  { to: '/app/planejamento/contas', label: 'Contas financeiras', icon: CircleDollarSign },
  { to: '/app/planejamento/categorias', label: 'Categorias', icon: Tags },
  { to: '/app/planejamento/cartoes', label: 'Cartões e parcelas', icon: CreditCard },
  { to: '/app/planejamento/orcamento', label: 'Orçamento', icon: Target },
  { to: '/app/planejamento/metas', label: 'Metas financeiras', icon: Target },
  { to: '/app/planejamento/projecoes', label: 'Simulador', icon: TrendingUp },
];

const agendaItems: NavigationItem[] = [
  { to: '/app/agenda', label: 'Calendário', icon: CalendarDays, end: true },
  { to: '/app/agenda/recorrencias', label: 'Recorrências', icon: ListChecks },
  { to: '/app/agenda/receitas', label: 'Receitas previstas', icon: FileText },
];

const investmentItems: Array<{
  section: InvestmentSection;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
}> = [
  { section: 'portfolio', label: 'Carteira', icon: PieChart },
  { section: 'planning', label: 'Planejamento de aportes', icon: Sparkles },
];

function NavigationLink({ item, compact = false }: { item: NavigationItem; compact?: boolean }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) => `mf-side-item ${compact ? 'compact' : ''} ${isActive ? 'active' : ''}`}
      title={item.label}
      aria-label={item.label}
    >
      <Icon size={compact ? 14 : 16} aria-hidden="true" /><span>{item.label}</span>
    </NavLink>
  );
}

function InvestmentSectionLink({
  section,
  label,
  icon: Icon,
  activeSection,
}: {
  section: InvestmentSection;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  activeSection: InvestmentSection;
}) {
  const search = section === 'portfolio' ? '' : `?section=${section}`;
  const active = activeSection === section;

  return (
    <NavLink
      to={{ pathname: '/app/investimentos', search }}
      className={`mf-side-item compact ${active ? 'active' : ''}`}
      title={label}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
    >
      <Icon size={14} aria-hidden="true" /><span>{label}</span>
    </NavLink>
  );
}

function ToolHeader({
  to,
  label,
  icon: Icon,
  active,
  expanded,
  onToggle,
}: {
  to: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  active: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="mf-side-tool-row">
      <NavLink
        to={to}
        className={`mf-side-item ${active ? 'active' : ''}`}
        title={label}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
      >
        <Icon size={16} aria-hidden="true" />
        <span>{label}</span>
      </NavLink>
      <button
        type="button"
        className={`mf-side-chevron ${expanded ? 'expanded' : ''}`}
        onClick={onToggle}
        aria-label={`${expanded ? 'Recolher' : 'Expandir'} ${label}`}
        aria-expanded={expanded}
      >
        <ChevronDown size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

function groupForPath(pathname: string): ToolGroup | null {
  if (pathname.startsWith('/app/movimentacoes')) return 'movements';
  if (pathname.startsWith('/app/investimentos') || pathname.startsWith('/app/planejamento/investimentos')) return 'investments';
  if (pathname.startsWith('/app/agenda')) return 'agenda';
  if (pathname.startsWith('/app/planejamento')) return 'planning';
  return null;
}

export default function AppNavigation({ onLaunch }: { onLaunch: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const activeGroup = groupForPath(location.pathname);
  const [expandedGroup, setExpandedGroup] = useState<ToolGroup | null>(activeGroup);
  const requestedInvestmentSection = new URLSearchParams(location.search).get('section');
  const investmentSection: InvestmentSection = requestedInvestmentSection === 'planning' ? 'planning' : 'portfolio';
  const isAnalysisRoute = location.pathname.startsWith('/app/analises');
  const isMovementsRoute = location.pathname.startsWith('/app/movimentacoes');
  const isHomeRoute = location.pathname === '/app';

  useEffect(() => {
    if (activeGroup) setExpandedGroup(activeGroup);
  }, [activeGroup]);

  function toggleGroup(group: ToolGroup) {
    setExpandedGroup((current) => current === group ? null : group);
  }

  function launch() {
    if (isHomeRoute) onLaunch();
    else navigate('/app/lancar');
  }

  return (
    <aside className="mf-side-panel" aria-label="Navegação financeira">
      <style>{`
        .history-shell > div:first-child button[class*="border-red-500"] { display: none !important; }
        ${!isHomeRoute ? '.mf-top-actions > button.primary { display: none !important; }' : ''}
        ${isAnalysisRoute ? '.mf-content .mf-tab-shell > .mf-subnav { display: none !important; }' : ''}
        ${isMovementsRoute ? `
          .mf-content .history-shell > .mf-subnav button:nth-child(3) { font-size: 0 !important; }
          .mf-content .history-shell > .mf-subnav button:nth-child(3)::after { content: 'Histórico de importações'; font-size: 12px; }
        ` : ''}
      `}</style>
      <div className="mf-side-brand" aria-label="MF Financeiro">
        <div className="mf-side-brand-mark" aria-hidden="true">M</div>
        <div className="mf-side-brand-copy"><strong>MF Financeiro</strong><small>Controle financeiro inteligente</small></div>
      </div>

      <nav className="mf-side-primary" aria-label="Seções principais">
        <NavigationLink item={{ to: '/app', label: 'Início', icon: LayoutDashboard, end: true }} />

        <section className="mf-side-tool" aria-label="Movimentações">
          <ToolHeader to="/app/movimentacoes" label="Movimentações" icon={Receipt} active={activeGroup === 'movements'} expanded={expandedGroup === 'movements'} onToggle={() => toggleGroup('movements')} />
          {expandedGroup === 'movements' && <div className="mf-side-primary-children">{movementItems.map((item) => <NavigationLink key={item.to} item={item} compact />)}</div>}
        </section>

        <section className="mf-side-tool" aria-label="Investimentos">
          <ToolHeader to="/app/investimentos" label="Investimentos" icon={Landmark} active={activeGroup === 'investments'} expanded={expandedGroup === 'investments'} onToggle={() => toggleGroup('investments')} />
          {expandedGroup === 'investments' && (
            <div className="mf-side-primary-children">
              {investmentItems.map((item) => <InvestmentSectionLink key={item.section} section={item.section} label={item.label} icon={item.icon} activeSection={investmentSection} />)}
            </div>
          )}
        </section>

        <section className="mf-side-tool" aria-label="Planejamento">
          <ToolHeader to="/app/planejamento" label="Planejamento" icon={Wallet} active={activeGroup === 'planning'} expanded={expandedGroup === 'planning'} onToggle={() => toggleGroup('planning')} />
          {expandedGroup === 'planning' && <div className="mf-side-primary-children">{planningItems.map((item) => <NavigationLink key={item.to} item={item} compact />)}</div>}
        </section>

        <NavigationLink item={{ to: '/app/analises/insights', label: 'Insights', icon: Lightbulb }} />

        <section className="mf-side-tool" aria-label="Agenda Financeira">
          <ToolHeader to="/app/agenda" label="Agenda Financeira" icon={CalendarDays} active={activeGroup === 'agenda'} expanded={expandedGroup === 'agenda'} onToggle={() => toggleGroup('agenda')} />
          {expandedGroup === 'agenda' && <div className="mf-side-primary-children">{agendaItems.map((item) => <NavigationLink key={item.to} item={item} compact />)}</div>}
        </section>

        <NavigationLink item={{ to: '/app/integracoes', label: 'Conexões', icon: Bot }} />
      </nav>

      <button type="button" className="mf-side-launch" onClick={launch} aria-label="Criar novo lançamento"><Plus size={15} aria-hidden="true" />Lançar</button>

      <nav className="mf-side-shortcuts" aria-label="Atalhos rápidos">
        <NavLink to="/app/movimentacoes/importar" className="mf-side-shortcut" title="Importar extrato" aria-label="Importar extrato"><Upload size={14} aria-hidden="true" /></NavLink>
        <NavLink to="/app/agenda" className="mf-side-shortcut" title="Agenda Financeira" aria-label="Agenda Financeira"><CalendarDays size={14} aria-hidden="true" /></NavLink>
      </nav>
    </aside>
  );
}
