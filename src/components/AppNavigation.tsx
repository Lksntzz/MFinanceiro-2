import React from 'react';
import {
  BarChart3,
  Bot,
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
import { NavLink, useLocation } from 'react-router';

type NavigationItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  end?: boolean;
};

const primaryItems: NavigationItem[] = [
  { to: '/app', label: 'Início', icon: LayoutDashboard, end: true },
  { to: '/app/movimentacoes', label: 'Movimentações', icon: Receipt },
  { to: '/app/planejamento/contas', label: 'Planejamento', icon: Wallet },
  { to: '/app/analises/resumo', label: 'Análises', icon: BarChart3 },
];

const planningItems: NavigationItem[] = [
  { to: '/app/planejamento/contas', label: 'Contas', icon: CircleDollarSign },
  { to: '/app/planejamento/cartoes', label: 'Cartões e parcelas', icon: CreditCard },
  { to: '/app/planejamento/renda', label: 'Renda', icon: FileText },
  { to: '/app/planejamento/contas-fixas', label: 'Contas fixas', icon: ListChecks },
  { to: '/app/planejamento/calendario', label: 'Calendário', icon: CalendarDays },
  { to: '/app/planejamento/assinaturas', label: 'Assinaturas', icon: ListChecks },
  { to: '/app/planejamento/investimentos', label: 'Investimentos', icon: Landmark },
  { to: '/app/planejamento/automacoes', label: 'Automação e Open Finance', icon: Bot },
];

const analysisItems: NavigationItem[] = [
  { to: '/app/analises/resumo', label: 'Visão geral', icon: BarChart3 },
  { to: '/app/analises/insights', label: 'Insights', icon: Lightbulb },
  { to: '/app/analises/saude', label: 'Saúde financeira', icon: HeartPulse },
  { to: '/app/analises/metas', label: 'Metas', icon: Target },
];

function NavigationLink({ item, compact = false }: { item: NavigationItem; compact?: boolean }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) => `mf-side-item ${compact ? 'compact' : ''} ${isActive ? 'active' : ''}`}
      title={item.label}
    >
      <Icon size={compact ? 14 : 16} /><span>{item.label}</span>
    </NavLink>
  );
}

export default function AppNavigation({ onLaunch }: { onLaunch: () => void }) {
  const location = useLocation();
  const inPlanning = location.pathname.startsWith('/app/planejamento');
  const inAnalysis = location.pathname.startsWith('/app/analises');

  return (
    <aside className="mf-side-panel" aria-label="Navegação financeira">
      <div className="mf-side-brand">
        <div className="mf-side-brand-mark">M</div>
        <div className="mf-side-brand-copy"><strong>MFinanceiro</strong><small>Central financeira</small></div>
      </div>

      <nav className="mf-side-primary">
        {primaryItems.map((item) => <NavigationLink key={item.to} item={item} />)}
      </nav>

      <button type="button" className="mf-side-launch" onClick={onLaunch}><Plus size={15} />Lançar</button>

      <div className="mf-side-context">
        {inPlanning && (
          <section className="mf-side-group">
            <span className="mf-side-group-label">Planejamento</span>
            <div className="mf-side-group-items">{planningItems.map((item) => <NavigationLink key={item.to} item={item} compact />)}</div>
          </section>
        )}
        {inAnalysis && (
          <section className="mf-side-group">
            <span className="mf-side-group-label">Entender seus dados</span>
            <div className="mf-side-group-items">{analysisItems.map((item) => <NavigationLink key={item.to} item={item} compact />)}</div>
          </section>
        )}
        {!inPlanning && !inAnalysis && <p className="mf-side-context-copy">Visão rápida, histórico e próximos passos.</p>}
      </div>

      <div className="mf-side-shortcuts" aria-label="Atalhos rápidos">
        <NavLink to="/app/movimentacoes/importar" className="mf-side-shortcut" title="Importar extrato"><Upload size={14} /></NavLink>
        <NavLink to="/app/planejamento/automacoes" className="mf-side-shortcut" title="Automações"><Bot size={14} /></NavLink>
        <NavLink to="/app/planejamento/calendario" className="mf-side-shortcut" title="Calendário"><CalendarDays size={14} /></NavLink>
      </div>
      <NavLink to="/app/preferencias" className="mf-side-settings"><Settings size={13} />Preferências</NavLink>
    </aside>
  );
}
