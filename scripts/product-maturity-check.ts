import { readFileSync } from 'node:fs';

function read(path: string) {
  return readFileSync(path, 'utf8');
}

function expectContains(path: string, fragments: string[]) {
  const content = read(path);
  fragments.forEach((fragment) => {
    if (!content.includes(fragment)) throw new Error(`${path} must contain: ${fragment}`);
  });
}

function expectNotContains(path: string, fragments: string[]) {
  const content = read(path);
  fragments.forEach((fragment) => {
    if (content.includes(fragment)) throw new Error(`${path} must not contain: ${fragment}`);
  });
}

expectContains('src/components/ProductTour.tsx', ['getTourScopeId', 'mf-tour:all-skipped:', 'Pular nesta ferramenta', 'Pular tudo', "tourScopeId === 'home'", 'loadUserPreferences', 'shouldAutoStart = false']);
expectNotContains('src/components/ProductTour.tsx', ['shouldAutoStart = !globalSkipped && !resolved']);
expectContains('src/components/PlanningJourney.tsx', ['Progresso do planejamento', 'Conta', 'Receita', 'Compromissos', 'Orçamento', 'Abrir Simulador', '/app/analises/insights']);
expectContains('src/components/PlanningTool.tsx', ['<PlanningJourney', 'hasPlanningAccount', 'hasPlanningIncome', 'hasPlanningCommitments', 'hasPlanningBudget', "onClick={() => navigate('/app/lancar')}"]);
expectContains('src/components/PreferencesCenter.tsx', ['Abrir tutorial automaticamente na Início', 'As outras ferramentas só abrem o tutorial quando você usar o botão ?']);
expectContains('src/lib/user-preferences.ts', ['version: 2', 'MAX_HOME_WIDGETS = 8', "'balance_chart'", "'rhythm_chart'", "'categories'", "'recent'", "'cards'", 'notifications', 'toursAutoStart']);
expectContains('src/components/DashboardBootstrap.tsx', ["lazy(() => import('./Dashboard'))", '<CommandPalette userId={user.id}', '<PreferencesCenter userId={user.id}', '<UndoToast />']);
expectContains('src/components/Dashboard.tsx', ['assessDataQuality', 'deleteWithUndo', 'offerUndo', 'importWithAudit', 'showReleaseUpdate={preferences.notifications.release}', 'dismissedAlertsKey', 'persistDismissedAlerts', '<History userId={user.id}', 'onDataChanged={workspace.refresh}']);
expectContains('src/hooks/useDashboardWorkspace.ts', ["window.addEventListener('mf:finance-data-changed', scheduleRefresh)", "window.removeEventListener('mf:finance-data-changed', scheduleRefresh)"]);
expectContains('src/lib/unified-transaction-launcher-mount.tsx', ["window.dispatchEvent(new CustomEvent('mf:finance-data-changed'))"]);
expectContains('src/components/History.tsx', ['mf_preview_categorization_rules', 'Organizar lançamentos genéricos', 'Aplicar regras', "window.dispatchEvent(new CustomEvent('mf:finance-data-changed'))"]);
expectContains('src/lib/financial-quality.ts', ['Organizar genéricos', '/app/movimentacoes?assist=categorias']);
expectContains('src/components/FinancialCategoriesTool.tsx', ['glass-card mf-tool-surface']);
expectContains('src/components/ExpectedIncomeCenter.tsx', ['glass-card mf-tool-surface']);
expectContains('src/components/FinancialAgendaTool.tsx', ['<FinancialTimeline']);
expectContains('src/components/IntegrationTool.tsx', ['Regras e automações', '<details', 'mf-open-finance-coming-soon', 'Open Finance', 'Em breve']);
expectContains('src/components/AppNavigation.tsx', ['mf:open-command-palette']);
expectContains('src/components/CommandPalette.tsx', ["event.key === 'ArrowDown'", "event.key === 'ArrowUp'", "event.key === 'Enter'", 'aria-activedescendant']);
expectContains('src/context/AppContext.tsx', ['data-mf-private', "event.altKey && event.key.toLowerCase() === 'p'"]);
expectContains('src/components/DashboardHome.tsx', ["lazy(() => import('./DashboardCharts'))", 'visibleWidgets', 'DataQualityPanel']);
expectContains('src/lib/mega-update-announcement-mount.tsx', ['LATEST_WEB_UPDATE', 'releaseReadKey', 'notifications.release']);
expectContains('src/components/NotificationCenter.tsx', ['LATEST_WEB_UPDATE', 'showReleaseUpdate', 'releaseDismissed', 'Apagar atualização', "type: 'fixed' | 'installment' | 'card' | 'daily' | 'quality'"]);
expectNotContains('src/components/NotificationCenter.tsx', ['2026-08-07-mega-update']);
expectContains('src/lib/release-updates.ts', ['2026-08-10-home-alerts-and-connections', 'Início completo e alertas que ajudam']);
expectContains('supabase/migrations/20260810144500_user_activity_history.sql', ['alter table public.mf_user_activity_events enable row level security', 'grant select, insert on table public.mf_user_activity_events to authenticated', 'using ((select auth.uid()) = user_id)', 'with check ((select auth.uid()) = user_id)']);
expectNotContains('supabase/migrations/20260810144500_user_activity_history.sql', ['grant update on table public.mf_user_activity_events to authenticated', 'grant delete on table public.mf_user_activity_events to authenticated']);
expectContains('src/product-maturity.css', ['mf-command-palette', 'mf-preferences-panel', 'data-mf-private', 'mf-undo-toast']);
expectContains('src/product-maturity-additions.css', ['mf-onboarding-checklist', 'mf-automation-disclosure', 'mf-command-results button.active', 'mf-tool-surface', 'mf-open-finance-coming-soon', 'display:none']);
expectContains('src/main.tsx', ["import './product-maturity.css'", "import './product-maturity-additions.css'"]);
expectContains('.github/workflows/critical-e2e.yml', ['workflow_dispatch', '@playwright/test@1.55.0', 'MF_E2E_EMAIL', 'MF_E2E_PASSWORD']);
expectContains('tests/e2e/product-maturity.spec.mjs', ['Busca rápida do MF', 'Alt+P', 'Tutoriais e onboarding']);

console.log('Product maturity contract checks passed.');
