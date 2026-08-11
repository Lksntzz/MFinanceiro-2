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
expectContains('src/components/PlanningTool.tsx', ['<PlanningJourney', 'hasPlanningAccount', 'hasPlanningIncome', 'hasPlanningCommitments', 'hasPlanningBudget', "onClick={() => navigate('/app/lancar')}", "mf_pay_credit_card_bill_v2"]);
expectContains('src/components/PreferencesCenter.tsx', ['Abrir tutorial automaticamente na Início', 'As outras ferramentas só abrem o tutorial quando você usar o botão ?']);
expectContains('src/lib/user-preferences.ts', ['version: 2', 'MAX_HOME_WIDGETS = 8', "'balance_chart'", "'rhythm_chart'", "'categories'", "'recent'", "'cards'", 'notifications', 'toursAutoStart']);
expectContains('src/components/DashboardBootstrap.tsx', ["lazy(() => import('./Dashboard'))", '<CommandPalette userId={user.id}', '<PreferencesCenter userId={user.id}', '<UndoToast />', "location.pathname === '/app/lancar'", '<TransactionLaunchTool user={user} />']);
expectContains('src/components/Dashboard.tsx', ['assessDataQuality', 'deleteWithUndo', 'offerUndo', 'importWithAudit', 'showReleaseUpdate={preferences.notifications.release}', 'dismissedAlertsKey', 'persistDismissedAlerts', '<History userId={user.id}', 'onDataChanged={workspace.refresh}']);
expectContains('src/hooks/useDashboardWorkspace.ts', ["window.addEventListener('mf:finance-data-changed', scheduleRefresh)", "window.removeEventListener('mf:finance-data-changed', scheduleRefresh)"]);
expectContains('src/components/TransactionLaunchTool.tsx', ["mf_create_finance_entry_v3", "window.dispatchEvent(new CustomEvent('mf:finance-data-changed'))", 'Lançar movimentação']);
expectNotContains('src/main.tsx', ['unified-transaction-launcher-mount', 'mega-update-announcement-mount']);
expectNotContains('src/components/History.tsx', ['mf_preview_categorization_rules', 'Organizar lançamentos genéricos', 'Criar regras', 'Aplicar regras', 'assist=categorias']);
expectNotContains('src/lib/financial-quality.ts', ['Muitos lançamentos genéricos', 'Organizar genéricos', '/app/movimentacoes?assist=categorias']);
expectContains('src/components/FinancialCategoriesTool.tsx', ['glass-card mf-tool-surface']);
expectContains('src/components/ExpectedIncomeCenter.tsx', ['glass-card mf-tool-surface']);
expectContains('src/components/FinancialAgendaTool.tsx', ['<FinancialTimeline']);
expectContains('src/components/IntegrationTool.tsx', ['mf-open-finance-coming-soon', 'Open Finance', 'Em breve', 'uso contínuo e automático']);
expectNotContains('src/components/IntegrationTool.tsx', ['AutomationCenter', 'Regras e automações', 'Regras automáticas', 'Nova regra']);
expectContains('src/components/AppNavigation.tsx', ['mf:open-command-palette', "navigate('/app/lancar')"]);
expectContains('src/components/CommandPalette.tsx', ["event.key === 'ArrowDown'", "event.key === 'ArrowUp'", "event.key === 'Enter'", 'aria-activedescendant']);
expectContains('src/context/AppContext.tsx', ['data-mf-private', "event.altKey && event.key.toLowerCase() === 'p'"]);
expectContains('src/components/DashboardHome.tsx', ["lazy(() => import('./DashboardCharts'))", 'visibleWidgets', 'DataQualityPanel']);
expectContains('src/components/NotificationCenter.tsx', ['LATEST_WEB_UPDATE', 'showReleaseUpdate', 'releaseDismissed', 'Apagar atualização', "type: 'fixed' | 'installment' | 'card' | 'daily' | 'quality'"]);
expectNotContains('src/components/NotificationCenter.tsx', ['2026-08-07-mega-update']);
expectContains('src/lib/release-updates.ts', ['2026-08-10-home-alerts-and-connections', 'Início completo e alertas que ajudam']);
expectContains('supabase/migrations/20260810144500_user_activity_history.sql', ['alter table public.mf_user_activity_events enable row level security', 'grant select, insert on table public.mf_user_activity_events to authenticated', 'using ((select auth.uid()) = user_id)', 'with check ((select auth.uid()) = user_id)']);
expectNotContains('supabase/migrations/20260810144500_user_activity_history.sql', ['grant update on table public.mf_user_activity_events to authenticated', 'grant delete on table public.mf_user_activity_events to authenticated']);
expectContains('src/product-maturity.css', ['mf-command-palette', 'mf-preferences-panel', 'data-mf-private', 'mf-undo-toast']);
expectContains('src/product-maturity-additions.css', ['mf-onboarding-checklist', 'mf-automation-disclosure', 'mf-command-results button.active', 'mf-tool-surface', 'mf-open-finance-coming-soon', 'display:none']);
expectContains('src/main.tsx', ["import './product-maturity.css'", "import './product-maturity-additions.css'"]);
expectContains('package.json', ['"test:e2e": "playwright test"', '"@playwright/test": "1.62.1"']);
expectContains('playwright.config.ts', ["testDir: './e2e'", 'e2e-mfinanceiro.supabase.co', "name: 'chromium'"]);
expectContains('.github/workflows/e2e-ci.yml', ['pull_request:', 'Install Chromium', 'npm run test:e2e', 'contents: read']);
expectContains('.github/workflows/critical-e2e.yml', ['workflow_dispatch', 'npm ci', 'MF_E2E_EMAIL', 'MF_E2E_PASSWORD', 'playwright.preview.config.ts']);
expectContains('tests/e2e/product-maturity.spec.mjs', ['Busca rápida do MF', 'Alt+P', 'Tutoriais e onboarding', 'Pular tudo']);
expectContains('e2e/financial-critical-flows.spec.ts', ['mf_create_finance_entry_v3', 'mf_commit_statement_import_v2', 'Desfazer lote', 'Exclusivo Alice', 'Exclusivo Bruno']);
expectContains('e2e/support/supabase-mock.ts', ['e2e-mfinanceiro.supabase.co', 'mf_get_ledger_page', 'mf_commit_statement_import_v2', 'mf_revert_statement_import']);

console.log('Product maturity contract checks passed.');
