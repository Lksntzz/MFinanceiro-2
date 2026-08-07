// Bootstrap contains only active consolidated runtime integrations.
import './lib/admin-maintenance-mount';
import './lib/bank-excel-parser-guard';
import './lib/bank-csv-parser-guard';
import './lib/historical-import-review-guard';
import './lib/installment-manager-mount';
import './lib/income-payroll-center-mount';
import './lib/payroll-advance-correction-guard';
import './lib/simple-navigation-mount';
import './lib/profile-onboarding-mount';
import './lib/guided-tutorial-mount';
import './lib/monthly-fixed-bills-mount';
import './lib/standalone-insights-mount';
import './lib/unified-transaction-launcher-mount';
import './lib/release-update-notification-mount';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { AppProvider } from './context/AppContext';
import './index.css';
import './layout-tuning.css';

function installSidebarAccountMenu() {
  const styleId = 'mf-sidebar-account-menu-style';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .mf-side-shortcuts,.mf-side-settings{display:none!important}
      body.mf-sidebar-navigation-active .mf-top-actions > button.primary,
      body.mf-sidebar-navigation-active .mf-top-actions > button[title="Sair"],
      body.mf-sidebar-navigation-active #mf-profile-action-host{display:none!important}
      .mf-side-account-wrap{position:relative;flex:0 0 auto;padding-top:8px;border-top:1px solid rgba(255,255,255,.06)}
      .mf-side-account{width:100%;min-height:42px;display:flex;align-items:center;gap:9px;padding:7px 8px;border:1px solid rgba(255,255,255,.065);border-radius:11px;color:rgba(255,255,255,.62);background:rgba(255,255,255,.025);text-align:left;transition:.16s ease}
      .mf-side-account:hover,.mf-side-account.open{color:#fff;border-color:rgba(0,242,255,.16);background:rgba(0,242,255,.045)}
      .mf-side-account-avatar{width:27px;height:27px;flex:0 0 27px;display:grid;place-items:center;border-radius:9px;color:#071315;background:rgba(0,242,255,.88);font-size:9px;font-weight:950}
      .mf-side-account-copy{min-width:0;flex:1;display:flex;flex-direction:column;gap:1px}
      .mf-side-account-copy strong{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:inherit;font-size:9.5px}
      .mf-side-account-copy small{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:rgba(255,255,255,.28);font-size:7.5px;font-weight:750}
      .mf-side-account-arrow{flex:0 0 auto;color:rgba(255,255,255,.27);font-size:14px;transform:rotate(-90deg);transition:.18s ease}
      .mf-side-account.open .mf-side-account-arrow{color:var(--brand-primary,#00f2ff);transform:rotate(90deg)}
      .mf-side-account-menu{position:absolute;left:0;right:0;bottom:calc(100% + 7px);z-index:5;display:flex;flex-direction:column;gap:2px;padding:5px;border:1px solid rgba(255,255,255,.085);border-radius:11px;background:rgba(10,13,16,.985);box-shadow:0 14px 38px rgba(0,0,0,.38);opacity:0;transform:translateY(5px) scale(.985);pointer-events:none;transition:.16s ease}
      .mf-side-account-menu.open{opacity:1;transform:translateY(0) scale(1);pointer-events:auto}
      .mf-side-account-menu button{width:100%;min-height:29px;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px;border:0;border-radius:8px;color:rgba(255,255,255,.55);background:transparent;font-size:8.8px;font-weight:800;text-align:left}
      .mf-side-account-menu button:hover{color:#fff;background:rgba(255,255,255,.05)}
      .mf-side-account-menu button::after{content:'›';color:rgba(255,255,255,.2);font-size:13px}
      .mf-side-account-menu .mf-account-signout{color:rgba(255,125,125,.72)}
      .mf-side-account-menu .mf-account-signout:hover{color:#ff9b9b;background:rgba(255,90,90,.06)}
      .mf-side-account-menu .mf-account-admin[hidden]{display:none!important}
      @media (min-width:821px) and (max-width:1180px){.mf-side-account-copy strong{font-size:8.8px}.mf-side-account-menu button{font-size:8.2px}}
      @media (max-height:720px) and (min-width:821px){.mf-side-account-wrap{padding-top:6px}.mf-side-account{min-height:35px;padding-block:4px}.mf-side-account-avatar{width:24px;height:24px;flex-basis:24px}.mf-side-account-menu button{min-height:25px;padding-block:4px}}
      @media (max-width:820px){.mf-side-account-wrap{display:none!important}}
    `;
    document.head.appendChild(style);
  }

  const normalize = (value?: string | null) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();

  const legacyNavButton = (label: string) => {
    const wanted = normalize(label);
    return Array.from(document.querySelectorAll<HTMLButtonElement>('.mf-nav > button'))
      .find((button) => normalize(button.textContent) === wanted || normalize(button.textContent).includes(wanted)) || null;
  };

  const topActionButton = (title: string) => {
    const wanted = normalize(title);
    return Array.from(document.querySelectorAll<HTMLButtonElement>('.mf-top-actions button'))
      .find((button) => normalize(button.getAttribute('title')) === wanted) || null;
  };

  const profileButton = () =>
    document.querySelector<HTMLButtonElement>('#mf-profile-action-host .mf-profile-trigger');

  const ensureMenu = () => {
    const panel = document.querySelector<HTMLElement>('.mf-side-panel');
    if (!panel || panel.querySelector('#mf-sidebar-account-tools')) return;

    const root = document.createElement('div');
    root.id = 'mf-sidebar-account-tools';
    root.className = 'mf-side-account-wrap';

    const menu = document.createElement('div');
    menu.className = 'mf-side-account-menu';
    menu.setAttribute('aria-hidden', 'true');

    const accountButton = document.createElement('button');
    accountButton.type = 'button';
    accountButton.className = 'mf-side-account';
    accountButton.setAttribute('aria-expanded', 'false');
    accountButton.innerHTML = '<span class="mf-side-account-avatar" aria-hidden="true">EU</span><span class="mf-side-account-copy"><strong>Minha conta</strong><small>Perfil e configurações</small></span><span class="mf-side-account-arrow" aria-hidden="true">›</span>';

    const closeMenu = () => {
      accountButton.classList.remove('open');
      menu.classList.remove('open');
      accountButton.setAttribute('aria-expanded', 'false');
      menu.setAttribute('aria-hidden', 'true');
    };

    const addAction = (label: string, action: () => void, className = '') => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.className = className;
      button.addEventListener('click', () => {
        closeMenu();
        action();
      });
      menu.appendChild(button);
      return button;
    };

    addAction('Perfil', () => profileButton()?.click());
    addAction('Preferências', () => legacyNavButton('Preferências')?.click());
    const adminAction = addAction('Administração', () => legacyNavButton('Admin')?.click(), 'mf-account-admin');
    addAction('Sair', () => topActionButton('Sair')?.click(), 'mf-account-signout');

    const syncAdmin = () => { adminAction.hidden = !legacyNavButton('Admin'); };
    syncAdmin();

    accountButton.addEventListener('click', () => {
      const open = !menu.classList.contains('open');
      accountButton.classList.toggle('open', open);
      menu.classList.toggle('open', open);
      accountButton.setAttribute('aria-expanded', String(open));
      menu.setAttribute('aria-hidden', String(!open));
      syncAdmin();
    });

    document.addEventListener('pointerdown', (event) => {
      if (!root.contains(event.target as Node)) closeMenu();
    });

    root.appendChild(menu);
    root.appendChild(accountButton);
    panel.appendChild(root);
  };

  ensureMenu();
  const observer = new MutationObserver(ensureMenu);
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installSidebarAccountMenu, { once: true });
else installSidebarAccountMenu();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    if (import.meta.env.PROD) {
      navigator.serviceWorker.register('/sw.js').then((registration) => {
        registration.update().catch(() => {});
      }).catch((registrationError) => {
        console.log('SW registration failed: ', registrationError);
      });
    } else {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => registration.unregister());
      });
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
);
