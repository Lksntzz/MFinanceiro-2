import React, { lazy, Suspense, useMemo, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { AlertCircle, Bell, Eye, EyeOff, LogOut, Plus, Search, Settings as SettingsIcon, Wallet, X } from 'lucide-react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';

import { useApp } from '../context/AppContext';
import {
  appendDismissedAlert,
  buildDashboardNotifications,
  loadDismissedAlerts,
  persistDismissedAlerts,
  sortTransactionsByDateDesc,
} from '../features/dashboard/dashboard-notifications';
import { useDashboardWorkspace } from '../hooks/useDashboardWorkspace';
import { useUserPreferences } from '../hooks/useUserPreferences';
import { recordUserActivity } from '../lib/activity-log';
import { assessDataQuality } from '../lib/financial-quality';
import { supabase } from '../lib/supabase';
import { offerUndo } from '../lib/undo-actions';
import type { ImportedTransaction, StatementImportOptions } from '../types';
import AdminMfaSecurity from './AdminMfaSecurity';
import AppNavigation from './AppNavigation';
import DashboardHome from './DashboardHome';
import History from './History';
import ImportBatches from './ImportBatches';
import Insights from './Insights';
import NotificationCenter from './NotificationCenter';
import OnboardingChecklist from './OnboardingChecklist';
import ProfileCenter from './ProfileCenter';

const ImportarExtratos = lazy(() => import('./ImportarExtratos'));

export default function Dashboard({ user }: { user: User; isMaintenanceBypass?: boolean }) {
  const { isPrivate, setIsPrivate } = useApp();
  const { preferences } = useUserPreferences(user.id);
  const location = useLocation();
  const navigate = useNavigate();
  const workspace = useDashboardWorkspace(user.id);
  const [showNotificationCenter, setShowNotificationCenter] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [dismissedAlerts, setDismissedAlerts] = useState<string[]>(() => loadDismissedAlerts(user.id, window.localStorage));

  const path = location.pathname.replace(/\/+$/, '') || '/app';
  const historySubTab: 'list' | 'import' | 'batches' = path === '/app/movimentacoes/importar' ? 'import' : path === '/app/movimentacoes/lotes' ? 'batches' : 'list';
  const isAdmin = ['admin', 'owner'].includes(String(user.app_metadata?.role || '').toLowerCase());
  const monthKey = new Date().toISOString().slice(0, 7);

  const qualityIssues = useMemo(() => assessDataQuality({ accounts: workspace.accounts, categories: workspace.categories, cards: workspace.cards, fixedBills: workspace.fixedBills, transactions: workspace.financeTransactions }), [workspace.accounts, workspace.cards, workspace.categories, workspace.financeTransactions, workspace.fixedBills]);

  const notifications = useMemo(() => {
    return buildDashboardNotifications({
      fixedBills: workspace.fixedBills,
      cards: workspace.cards,
      qualityIssues,
      dismissedIds: dismissedAlerts,
      monthKey,
      preferences: preferences.notifications,
    });
  }, [dismissedAlerts, monthKey, preferences.notifications.cards, preferences.notifications.commitments, preferences.notifications.quality, qualityIssues, workspace.cards, workspace.fixedBills]);

  const recent = useMemo(() => sortTransactionsByDateDesc(workspace.transactions), [workspace.transactions]);

  function dismissAlert(id: string) {
    setDismissedAlerts((current) => {
      const next = appendDismissedAlert(current, id);
      if (next === current) return current;
      persistDismissedAlerts(user.id, next, window.localStorage);
      return next;
    });
  }

  async function deleteWithUndo(id: string) {
    const snapshot = workspace.transactions.find((transaction) => transaction.id === id) as any;
    const { error } = await supabase.rpc('mf_delete_finance_entry', { p_entry_id: id });
    if (error) { workspace.setError(error.message); return; }
    await workspace.refresh();
    void recordUserActivity({ user_id: user.id, action: 'ledger.delete', entity_type: 'movimentacao', entity_id: id, summary: 'Lançamento excluído' });
    if (!snapshot) return;
    offerUndo('Lançamento excluído.', async () => {
      const { error: restoreError } = await supabase.rpc('mf_create_finance_entry_v3', {
        p_type: snapshot.type === 'income' ? 'income' : 'expense',
        p_amount: Math.abs(Number(snapshot.amount || 0)),
        p_date: String(snapshot.date || new Date().toISOString()).slice(0, 10),
        p_description: snapshot.description || snapshot.category || 'Lançamento restaurado',
        p_account_id: snapshot.account_id || null,
        p_category_id: snapshot.category_id || null,
        p_category: snapshot.category || 'Geral',
        p_payment_method: snapshot.payment_method || 'unspecified',
        p_status: snapshot.status || 'paid',
        p_source: snapshot.source || 'Manual',
        p_card_id: snapshot.card_id || null,
        p_due_date: snapshot.due_date || null,
        p_notes: snapshot.notes || null,
        p_installment_count: 1,
      });
      if (restoreError) { workspace.setError(restoreError.message); return; }
      await workspace.refresh();
      void recordUserActivity({ user_id: user.id, action: 'ledger.restore', entity_type: 'movimentacao', summary: 'Lançamento restaurado após exclusão' });
    });
  }

  async function importWithAudit(imported: ImportedTransaction[], newBalance: number | undefined, options: StatementImportOptions) {
    const result = await workspace.importTransactions(imported, newBalance, options);
    void recordUserActivity({ user_id: user.id, action: 'statement.import', entity_type: 'importacao', entity_id: result.batch_id, summary: `Importação concluída com ${result.inserted_count} lançamento${result.inserted_count === 1 ? '' : 's'} novo${result.inserted_count === 1 ? '' : 's'}`, metadata: { inserted_count: result.inserted_count, duplicate_count: result.duplicate_count, rejected_count: result.rejected_count } });
    return result;
  }

  return <div className="mf-app-shell mf-routed-app">
    <AppNavigation onLaunch={() => navigate('/app/lancar')} />
    <header className="mf-topbar"><div className="mf-brand"><div className="mf-brand-icon"><Wallet size={20} /></div><div><h1>{workspace.settings?.workspace_name || 'MFinanceiro'}</h1><span>{workspace.settings?.display_name ? `Olá, ${workspace.settings.display_name.split(/\s+/)[0]}` : 'Dashboard'}</span></div></div><div className="mf-top-actions"><ProfileCenter user={user} settings={workspace.settings} accounts={workspace.accounts} open={showProfile} onOpenChange={setShowProfile} onSaved={workspace.refresh} /><button type="button" onClick={() => window.dispatchEvent(new Event('mf:open-command-palette'))} title="Buscar no MF (Ctrl/⌘ K)"><Search size={16} /></button><button type="button" onClick={() => window.dispatchEvent(new Event('mf:open-preferences'))} title="Preferências"><SettingsIcon size={16} /></button><button type="button" onClick={() => setIsPrivate(!isPrivate)} title="Privacidade (Alt+P)">{isPrivate ? <EyeOff size={16} /> : <Eye size={16} />}</button><button className="relative" onClick={() => setShowNotificationCenter(true)} title="Notificações"><Bell size={16} />{notifications.length > 0 && <span className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[8px] font-black text-white">{notifications.length > 99 ? '99+' : notifications.length}</span>}</button><button className="primary" onClick={() => navigate('/app/lancar')}><Plus size={16} />Lançar</button><button onClick={async () => { await supabase.auth.signOut(); window.location.replace('/'); }} title="Sair"><LogOut size={17} /></button></div></header>
    {workspace.error && <div className="mf-error"><AlertCircle size={16} />{workspace.error}<button onClick={() => workspace.setError(null)} aria-label="Fechar erro"><X size={14} /></button></div>}
    <section className={`mf-content ${path.startsWith('/app/movimentacoes') ? 'history-active' : ''}`}>
      <Suspense fallback={<div className="mf-loading">Carregando módulo...</div>}>
        <Routes>
          <Route path="/app" element={<><OnboardingChecklist userId={user.id} settings={workspace.settings} transactionCount={workspace.transactionCount} hasCommitment={workspace.fixedBills.length > 0 || workspace.cards.length > 0} hasAccount={workspace.accounts.some((account) => account.is_active !== false)} onProfile={() => setShowProfile(true)} onNavigate={navigate} /><DashboardHome transactions={workspace.financeTransactions} recentTransactions={recent} summary={workspace.summary} settings={workspace.settings} cards={workspace.cards} balance={workspace.balance} isPrivate={isPrivate} visibleWidgets={preferences.homeWidgets} qualityIssues={qualityIssues} />{(workspace.loading || workspace.analyticsLoading) && <div className="mf-loading">{workspace.loading ? 'Atualizando dados...' : 'Consolidando histórico completo...'}</div>}{workspace.analyticsIncomplete && <div className="mf-error" role="status"><AlertCircle size={16} />As análises estão usando apenas os lançamentos recentes porque o histórico completo não pôde ser consolidado.</div>}</>} />
          <Route path="/app/movimentacoes/*" element={<div className="mf-tab-shell history-shell"><div className="mf-subnav"><button className={historySubTab === 'list' ? 'active' : ''} onClick={() => navigate('/app/movimentacoes')}>Movimentações</button><button className={historySubTab === 'import' ? 'active' : ''} onClick={() => navigate('/app/movimentacoes/importar')}>Importar extrato</button><button className={historySubTab === 'batches' ? 'active' : ''} onClick={() => navigate('/app/movimentacoes/lotes')}>Histórico de importações</button></div>{historySubTab === 'list' ? <History userId={user.id} transactions={workspace.transactions} onDelete={(id) => void deleteWithUndo(id)} onDataChanged={workspace.refresh} currentBalance={workspace.balance} balanceConfirmed={workspace.settings?.balance_confirmed === true} totalCount={workspace.transactionCount} hasMore={workspace.hasMoreTransactions} isLoadingMore={workspace.loadingMoreTransactions} onLoadMore={workspace.loadMore} /> : historySubTab === 'import' ? <ImportarExtratos accounts={workspace.accounts} onImport={importWithAudit} onCancel={() => navigate('/app/movimentacoes')} accountHolderName={workspace.settings?.display_name || String(user.user_metadata?.name || '').trim() || undefined} internalAccountAliases={user.email ? [user.email.split('@')[0]] : []} /> : <ImportBatches userId={user.id} accounts={workspace.accounts} />}</div>} />
          <Route path="/app/analises/insights" element={<div className="mf-tab-shell">{workspace.analyticsLoading && <div className="mf-loading">Consolidando histórico completo...</div>}{workspace.analyticsIncomplete && <div className="mf-error" role="status"><AlertCircle size={16} />O histórico completo ainda não está disponível; os Insights podem estar temporariamente limitados.</div>}<Insights summary={workspace.summary} transactions={workspace.financeTransactions} fixedBills={workspace.fixedBills} /></div>} />
          <Route path="/app/admin" element={isAdmin ? <div className="space-y-4"><AdminMfaSecurity /></div> : <Navigate to="/app" replace />} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </Suspense>
    </section>
    <NotificationCenter isOpen={showNotificationCenter} onClose={() => setShowNotificationCenter(false)} notifications={notifications as any} showReleaseUpdate={preferences.notifications.release} onPay={(item: any) => item.type === 'fixed' ? workspace.payFixedBill(item.originalData) : undefined} onNavigate={(nextPath) => { setShowNotificationCenter(false); navigate(nextPath); }} onDismiss={dismissAlert} />
  </div>;
}
