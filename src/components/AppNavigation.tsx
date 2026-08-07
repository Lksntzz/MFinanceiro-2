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
      aria-label={item.label}
    >
      <Icon size={compact ? 14 : 16} aria-hidden="true" /><span>{item.label}</span>
    </NavLink>
  );
}

export default function AppNavigation({ onLaunch }: { onLaunch: () => void }) {
  const location = useLocation();
  const inPlanning = location.pathname.startsWith('/app/planejamento');
  const inAnalysis = location.pathname.startsWith('/app/analises');

  return (
    <aside className="mf-side-panel" aria-label="Navegação financeira">
      <div className="mf-side-brand" aria-label="MF Financeiro">
        <div className="mf-side-brand-mark" aria-hidden="true">M</div>
        <div className="mf-side-brand-copy"><strong>MF Financeiro</strong><small>Controle financeiro inteligente</small></div>
      </div>

      <nav className="mf-side-primary" aria-label="Seções principais">
        {primaryItems.map((item) => <NavigationLink key={item.to} item={item} />)}
      </nav>

      <button type="button" className="mf-side-launch" onClick={onLaunch} aria-label="Criar novo lançamento"><Plus size={15} aria-hidden="true" />Lançar</button>

      <div className="mf-side-context">
        {inPlanning && (
          <section className="mf-side-group" aria-labelledby="mf-planning-navigation-label">
            <span id="mf-planning-navigation-label" className="mf-side-group-label">Planejamento</span>
            <nav className="mf-side-group-items" aria-label="Navegação de planejamento">{planningItems.map((item) => <NavigationLink key={item.to} item={item} compact />)}</nav>
          </section>
        )}
        {inAnalysis && (
          <section className="mf-side-group" aria-labelledby="mf-analysis-navigation-label">
            <span id="mf-analysis-navigation-label" className="mf-side-group-label">Entender seus dados</span>
            <nav className="mf-side-group-items" aria-label="Navegação de análises">{analysisItems.map((item) => <NavigationLink key={item.to} item={item} compact />)}</nav>
          </section>
        )}
        {!inPlanning && !inAnalysis && <p className="mf-side-context-copy">Visão rápida, histórico e próximos passos.</p>}
      </div>

      <nav className="mf-side-shortcuts" aria-label="Atalhos rápidos">
        <NavLink to="/app/movimentacoes/importar" className="mf-side-shortcut" title="Importar extrato" aria-label="Importar extrato"><Upload size={14} aria-hidden="true" /></NavLink>
        <NavLink to="/app/planejamento/automacoes" className="mf-side-shortcut" title="Automações" aria-label="Automações e Open Finance"><Bot size={14} aria-hidden="true" /></NavLink>
        <NavLink to="/app/planejamento/calendario" className="mf-side-shortcut" title="Calendário" aria-label="Calendário financeiro"><CalendarDays size={14} aria-hidden="true" /></NavLink>
      </nav>
      <NavLink to="/app/preferencias" className="mf-side-settings"><Settings size={13} aria-hidden="true" />Preferências</NavLink>
    </aside>
  );
}
