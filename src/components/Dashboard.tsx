import React, { lazy, Suspense, useMemo, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { AlertCircle, Bell, Eye, EyeOff, LogOut, Plus, Wallet, X } from 'lucide-react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';

import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { useDashboardWorkspace } from '../hooks/useDashboardWorkspace';
import AdminAccessRequests from './AdminAccessRequests';
import AdminMaintenanceControl from './AdminMaintenanceControl';
import AppNavigation from './AppNavigation';
import DashboardHome from './DashboardHome';
import History from './History';
import ImportBatches from './ImportBatches';
import Insights from './Insights';
import NotificationCenter from './NotificationCenter';
import ProfileCenter, { OnboardingChecklist } from './ProfileCenter';

const ImportarExtratos = lazy(() => import('./ImportarExtratos'));

export default function Dashboard({ user }: { user: User; isMaintenanceBypass?: boolean }) {
  const { isPrivate, setIsPrivate } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const workspace = useDashboardWorkspace(user.id);
  const [showNotificationCenter, setShowNotificationCenter] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [dismissedAlerts, setDismissedAlerts] = useState<string[]>([]);

  const path = location.pathname.replace(/\/+$/, '') || '/app';
  const historySubTab: 'list' | 'import' | 'batches' = path === '/app/movimentacoes/importar'
    ? 'import'
    : path === '/app/movimentacoes/lotes'
      ? 'batches'
      : 'list';
  const isAdmin = ['admin', 'owner'].includes(String(user.app_metadata?.role || '').toLowerCase());

  const notifications = useMemo(() => workspace.fixedBills
    .filter((bill: any) => bill.status !== 'paid')
    .filter((bill) => !dismissedAlerts.includes(`fixed-${bill.id}`))
    .map((bill) => ({
      id: `fixed-${bill.id}`,
      type: 'fixed',
      title: bill.name,
      amount: Number(bill.amount || 0),
      status: 'pending',
      originalData: bill,
    })), [workspace.fixedBills, dismissedAlerts]);

  const recent = useMemo(
    () => [...workspace.transactions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [workspace.transactions],
  );

  return (
    <div className="mf-app-shell mf-routed-app">
      <AppNavigation onLaunch={() => navigate('/app/lancar')} />

      <header className="mf-topbar">
        <div className="mf-brand">
          <div className="mf-brand-icon"><Wallet size={20} /></div>
          <div>
            <h1>{workspace.settings?.workspace_name || 'MFinanceiro'}</h1>
            <span>{workspace.settings?.display_name ? `Olá, ${workspace.settings.display_name.split(/\s+/)[0]}` : 'Dashboard'}</span>
          </div>
        </div>

        <div className="mf-top-actions">
          <ProfileCenter
            user={user}
            settings={workspace.settings}
            accounts={workspace.accounts}
            open={showProfile}
            onOpenChange={setShowProfile}
            onSaved={workspace.refresh}
          />
          <button onClick={() => setIsPrivate(!isPrivate)} title="Privacidade">{isPrivate ? <EyeOff size={16} /> : <Eye size={16} />}</button>
          <button className="relative" onClick={() => setShowNotificationCenter(true)} title="Notificações">
            <Bell size={16} />
            {notifications.length > 0 && <span className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[8px] font-black text-white">{notifications.length > 99 ? '99+' : notifications.length}</span>}
          </button>
          <button className="primary" onClick={() => navigate('/app/lancar')}><Plus size={16} />Lançar</button>
          <button onClick={async () => { await supabase.auth.signOut(); window.location.replace('/'); }} title="Sair"><LogOut size={17} /></button>
        </div>
      </header>

      {workspace.error && <div className="mf-error"><AlertCircle size={16} />{workspace.error}<button onClick={() => workspace.setError(null)} aria-label="Fechar erro"><X size={14} /></button></div>}

      <section className={`mf-content ${path.startsWith('/app/movimentacoes') ? 'history-active' : ''}`}>
        <Suspense fallback={<div className="mf-loading">Carregando módulo...</div>}>
          <Routes>
            <Route path="/app" element={<>
              <OnboardingChecklist
                settings={workspace.settings}
                transactionCount={workspace.transactionCount}
                hasCommitment={workspace.fixedBills.length > 0 || workspace.cards.length > 0}
                onProfile={() => setShowProfile(true)}
                onNavigate={navigate}
              />
              <DashboardHome
                transactions={workspace.financeTransactions}
                recentTransactions={recent}
                summary={workspace.summary}
                settings={workspace.settings}
                cards={workspace.cards}
                balance={workspace.balance}
                isPrivate={isPrivate}
              />
              {(workspace.loading || workspace.analyticsLoading) && <div className="mf-loading">{workspace.loading ? 'Atualizando dados...' : 'Consolidando histórico completo...'}</div>}
              {workspace.analyticsIncomplete && <div className="mf-error" role="status"><AlertCircle size={16} />As análises estão usando apenas os lançamentos recentes porque o histórico completo não pôde ser consolidado.</div>}
            </>} />

            <Route path="/app/movimentacoes/*" element={
              <div className="mf-tab-shell history-shell">
                <div className="mf-subnav">
                  <button className={historySubTab === 'list' ? 'active' : ''} onClick={() => navigate('/app/movimentacoes')}>Movimentações</button>
                  <button className={historySubTab === 'import' ? 'active' : ''} onClick={() => navigate('/app/movimentacoes/importar')}>Importar extrato</button>
                  <button className={historySubTab === 'batches' ? 'active' : ''} onClick={() => navigate('/app/movimentacoes/lotes')}>Histórico de importações</button>
                </div>
                {historySubTab === 'list' ? (
                  <History
                    transactions={workspace.transactions}
                    onDelete={workspace.deleteTransaction}
                    currentBalance={workspace.balance}
                    balanceConfirmed={workspace.settings?.balance_confirmed === true}
                    totalCount={workspace.transactionCount}
                    hasMore={workspace.hasMoreTransactions}
                    isLoadingMore={workspace.loadingMoreTransactions}
                    onLoadMore={workspace.loadMore}
                  />
                ) : historySubTab === 'import' ? (
                  <ImportarExtratos
                    accounts={workspace.accounts}
                    onImport={workspace.importTransactions}
                    onCancel={() => navigate('/app/movimentacoes')}
                    accountHolderName={workspace.settings?.display_name || String(user.user_metadata?.name || '').trim() || undefined}
                    internalAccountAliases={user.email ? [user.email.split('@')[0]] : []}
                  />
                ) : (
                  <ImportBatches userId={user.id} accounts={workspace.accounts} />
                )}
              </div>
            } />

            <Route path="/app/analises/insights" element={<div className="mf-tab-shell">
              {workspace.analyticsLoading && <div className="mf-loading">Consolidando histórico completo...</div>}
              {workspace.analyticsIncomplete && <div className="mf-error" role="status"><AlertCircle size={16} />O histórico completo ainda não está disponível; os Insights podem estar temporariamente limitados.</div>}
              <Insights summary={workspace.summary} transactions={workspace.financeTransactions} fixedBills={workspace.fixedBills} />
            </div>} />

            <Route path="/app/admin" element={isAdmin ? <div className="space-y-4"><AdminMaintenanceControl /><AdminAccessRequests user={user} /></div> : <Navigate to="/app" replace />} />
            <Route path="*" element={<Navigate to="/app" replace />} />
          </Routes>
        </Suspense>
      </section>

      <NotificationCenter
        isOpen={showNotificationCenter}
        onClose={() => setShowNotificationCenter(false)}
        notifications={notifications as any}
        onPay={(item: any) => item.type === 'fixed' && void workspace.payFixedBill(item.originalData)}
        onDismiss={(id) => setDismissedAlerts((current) => [...current, id])}
      />
    </div>
  );
}
