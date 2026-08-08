import React from 'react';
import { CreditCard, Home, ListChecks, Menu, Plus } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';

import { MOBILE_ROUTES } from './routes';
import type { MobileNavItem } from './types';
import './mobile.css';

const navItems: readonly MobileNavItem[] = [
  { key: 'home', label: 'Início', path: MOBILE_ROUTES.home },
  { key: 'transactions', label: 'Movimentações', path: MOBILE_ROUTES.transactions },
  { key: 'cards', label: 'Cartões', path: MOBILE_ROUTES.cards },
  { key: 'more', label: 'Mais', path: MOBILE_ROUTES.more },
];

const icons = {
  home: Home,
  transactions: ListChecks,
  cards: CreditCard,
  more: Menu,
} as const;

type MobileAppShellProps = {
  children: React.ReactNode;
  onQuickAction?: () => void;
};

function isActivePath(currentPath: string, item: MobileNavItem) {
  if (item.key === 'home') return currentPath === '/app' || currentPath === '/app/';
  return currentPath.startsWith(item.path);
}

export default function MobileAppShell({ children, onQuickAction }: MobileAppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();

  const leftItems = navItems.slice(0, 2);
  const rightItems = navItems.slice(2);

  const renderNavItem = (item: MobileNavItem) => {
    const Icon = icons[item.key];
    const active = isActivePath(location.pathname, item);

    return (
      <button
        key={item.key}
        type="button"
        className="mf-mobile-nav__item"
        data-active={active ? 'true' : 'false'}
        aria-current={active ? 'page' : undefined}
        onClick={() => navigate(item.path)}
      >
        <Icon size={20} aria-hidden="true" />
        <span>{item.label}</span>
      </button>
    );
  };

  return (
    <div className="mf-mobile-shell">
      <main className="mf-mobile-shell__content">{children}</main>

      <nav className="mf-mobile-nav" aria-label="Navegação principal do MF Financeiro">
        <div className="mf-mobile-nav__side">{leftItems.map(renderNavItem)}</div>

        <button
          type="button"
          className="mf-mobile-nav__quick"
          aria-label="Novo lançamento"
          onClick={() => (onQuickAction ? onQuickAction() : navigate(MOBILE_ROUTES.quick))}
        >
          <Plus size={28} aria-hidden="true" />
        </button>

        <div className="mf-mobile-nav__side">{rightItems.map(renderNavItem)}</div>
      </nav>
    </div>
  );
}
