import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, CheckCircle2, CircleDollarSign, Eye, EyeOff, Loader2, LogOut, Plus, Wallet } from 'lucide-react';
import { User } from '@supabase/supabase-js';

import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { FinancialAccount, FinancialAccountType, UserSettings } from '../types';
import AppNavigation from './AppNavigation';
import ProfileCenter from './ProfileCenter';

const ACCOUNT_TYPE_LABELS: Record<FinancialAccountType, string> = {
  checking: 'Conta corrente',
  savings: 'Poupança',
  cash: 'Carteira / dinheiro',
  investment: 'Conta de investimento',
  credit: 'Conta de crédito',
  other: 'Outra',
};

function normalizeAccounts(rows: unknown[]): FinancialAccount[] {
  return rows.map((row) => {
    const item = row as Record<string, unknown>;
    return {
      ...item,
      opening_balance: Number(item.opening_balance || 0),
      current_balance: Number(item.current_balance || 0),
      transaction_count: Number(item.transaction_count || 0),
    } as FinancialAccount;
  });
}

export default function FinancialAccountsTool({ user }: { user: User }) {
  const { isPrivate, setIsPrivate } = useApp();
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [accountName, setAccountName] = useState('');
  const [accountType, setAccountType] = useState<FinancialAccountType>('checking');
  const [openingBalance, setOpeningBalance] = useState('0');
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const ensured = await supabase.rpc('mf_ensure_financial_structure');
      if (ensured.error) throw ensured.error;
      const [settingsResult, accountsResult] = await Promise.all([
        supabase.from('mf_user_settings').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('mf_account_balances').select('*').eq('user_id', user.id).order('is_default', { ascending: false }).order('created_at'),
      ]);
      const firstError = settingsResult.error || accountsResult.error;
      if (firstError) throw firstError;
      const nextAccounts = normalizeAccounts(accountsResult.data || []);
      const currentBalance = nextAccounts.reduce((sum, account) => sum + Number(account.current_balance || 0), 0);
      setAccounts(nextAccounts);
      setSettings(settingsResult.data ? ({ ...settingsResult.data, current_balance: currentBalance } as UserSettings) : null);
    } catch (refreshError: any) {
      setError(refreshError?.message || 'Não foi possível carregar suas contas financeiras.');
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  const activeAccounts = useMemo(() => accounts.filter((account) => account.is_active), [accounts]);

  async function createAccount(event: React.FormEvent) {
    event.preventDefault();
    const balance = Number(openingBalance);
    if (!accountName.trim() || !Number.isFinite(balance)) return;
    setBusyKey('new-account');
    setError(null);
    const { error: insertError } = await supabase.from('mf_financial_accounts').insert({
      user_id: user.id,
      name: accountName.trim(),
      account_type: accountType,
      currency: 'BRL',
      opening_balance: balance,
      is_default: false,
      is_active: true,
    });
    if (insertError) setError(insertError.message);
    else {
      setAccountName('');
      setOpeningBalance('0');
      await refresh();
    }
    setBusyKey(null);
  }

  async function archiveAccount(account: FinancialAccount) {
    if (account.is_default) {
      setError('A conta principal não pode ser arquivada.');
      return;
    }
    setBusyKey(`account-${account.id}`);
    setError(null);
    const { error: updateError } = await supabase
      .from('mf_financial_accounts')
      .update({ is_active: !account.is_active })
      .eq('id', account.id)
      .eq('user_id', user.id);
    if (updateError) setError(updateError.message);
    else await refresh();
    setBusyKey(null);
  }

  return (
    <div className="mf-app-shell mf-routed-app">
      <AppNavigation onLaunch={() => undefined} />
      <header className="mf-topbar">
        <div className="mf-brand">
          <div className="mf-brand-icon"><CircleDollarSign size={20} /></div>
          <div><h1>{settings?.workspace_name || 'MF Financeiro'}</h1><span>Contas financeiras</span></div>
        </div>
        <div className="mf-top-actions">
          <ProfileCenter user={user} settings={settings} accounts={accounts} open={showProfile} onOpenChange={setShowProfile} onSaved={refresh} />
          <button type="button" onClick={() => setIsPrivate(!isPrivate)} title="Privacidade">{isPrivate ? <EyeOff size={16} /> : <Eye size={16} />}</button>
          <button type="button" onClick={async () => { await supabase.auth.signOut(); window.location.replace('/'); }} title="Sair"><LogOut size={17} /></button>
        </div>
      </header>

      <section className="mf-content">
        <div className="space-y-4 animate-fade-in">
          <div>
            <h2 className="text-xl font-black">Onde seu dinheiro está</h2>
            <p className="text-sm text-white/40">Cadastre somente lugares que representam saldo real: conta corrente, poupança ou dinheiro em espécie. Cartões e investimentos têm áreas próprias.</p>
          </div>

          {error && <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-xs text-red-200">{error}</div>}

          {loading ? <div className="mf-loading">Carregando contas...</div> : (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,.8fr)]">
              <section className="glass-card mf-tool-surface space-y-3">
                <div className="flex items-center gap-3"><Wallet size={18} className="text-brand-primary" /><div><h3 className="text-sm font-bold">Suas contas</h3><p className="text-[10px] text-white/40">O saldo total do MF é a soma das contas ativas.</p></div></div>
                {accounts.map((account) => (
                  <article key={account.id} className={`flex items-center justify-between gap-3 rounded-xl border p-3 ${account.is_active ? 'border-white/10 bg-white/[0.03]' : 'border-white/5 bg-black/20 opacity-55'}`}>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2"><strong className="truncate text-xs">{account.name}</strong>{account.is_default && <span className="rounded bg-brand-primary/15 px-1.5 py-0.5 text-[8px] font-bold uppercase text-brand-primary">Principal</span>}</div>
                      <div className="mt-1 text-[10px] text-white/40">{ACCOUNT_TYPE_LABELS[account.account_type]} · {account.transaction_count} lançamento(s)</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <strong className="text-xs text-brand-primary">{isPrivate ? '••••' : Number(account.current_balance || 0).toLocaleString('pt-BR', { style: 'currency', currency: account.currency || 'BRL' })}</strong>
                      {!account.is_default && <button type="button" onClick={() => void archiveAccount(account)} disabled={busyKey === `account-${account.id}`} className="text-white/35 hover:text-white disabled:opacity-40" aria-label={account.is_active ? 'Arquivar conta' : 'Reativar conta'}>{busyKey === `account-${account.id}` ? <Loader2 size={15} className="animate-spin" /> : account.is_active ? <Archive size={15} /> : <CheckCircle2 size={15} />}</button>}
                    </div>
                  </article>
                ))}
                {accounts.length === 0 && <div className="py-8 text-center text-xs text-white/35">A conta principal será criada automaticamente.</div>}
                <p className="text-[10px] text-white/35">{activeAccounts.length} conta(s) ativa(s). Evite cadastrar cartão de crédito ou ativo de investimento como conta para não duplicar patrimônio.</p>
              </section>

              <form onSubmit={createAccount} className="glass-card mf-tool-surface space-y-3">
                <div><h3 className="text-sm font-bold">Adicionar conta</h3><p className="mt-1 text-[10px] text-white/40">Use o saldo real no momento do cadastro.</p></div>
                <label className="block text-[10px] text-white/50">Nome<input required value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder="Ex.: Nubank" className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-brand-primary" /></label>
                <label className="block text-[10px] text-white/50">Tipo<select value={accountType} onChange={(event) => setAccountType(event.target.value as FinancialAccountType)} className="mt-1 w-full rounded-lg border border-white/10 bg-[#121212] px-3 py-2 text-xs"><option value="checking">Conta corrente</option><option value="savings">Poupança</option><option value="cash">Carteira / dinheiro</option><option value="other">Outra</option></select></label>
                <label className="block text-[10px] text-white/50">Saldo inicial<input type="number" step="0.01" value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-brand-primary" /></label>
                <button disabled={busyKey === 'new-account'} className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-primary px-3 py-2 text-xs font-bold text-black disabled:opacity-50">{busyKey === 'new-account' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Adicionar conta</button>
              </form>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
