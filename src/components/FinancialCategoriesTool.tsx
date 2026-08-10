import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, Loader2, LogOut, Plus, Tags } from 'lucide-react';
import { User } from '@supabase/supabase-js';

import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { FinancialAccount, TransactionCategory, UserSettings } from '../types';
import AppNavigation from './AppNavigation';
import ProfileCenter from './ProfileCenter';

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

export default function FinancialCategoriesTool({ user }: { user: User }) {
  const { isPrivate, setIsPrivate } = useApp();
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [categories, setCategories] = useState<TransactionCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [categoryName, setCategoryName] = useState('');
  const [categoryType, setCategoryType] = useState<'income' | 'expense' | 'both'>('both');
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const ensured = await supabase.rpc('mf_ensure_financial_structure');
      if (ensured.error) throw ensured.error;
      const [settingsResult, accountsResult, categoriesResult] = await Promise.all([
        supabase.from('mf_user_settings').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('mf_account_balances').select('*').eq('user_id', user.id).order('is_default', { ascending: false }).order('created_at'),
        supabase.from('mf_transaction_categories').select('*').eq('user_id', user.id).order('sort_order').order('name'),
      ]);
      const firstError = settingsResult.error || accountsResult.error || categoriesResult.error;
      if (firstError) throw firstError;
      const nextAccounts = normalizeAccounts(accountsResult.data || []);
      const currentBalance = nextAccounts.reduce((sum, account) => sum + Number(account.current_balance || 0), 0);
      setAccounts(nextAccounts);
      setSettings(settingsResult.data ? ({ ...settingsResult.data, current_balance: currentBalance } as UserSettings) : null);
      setCategories((categoriesResult.data || []) as TransactionCategory[]);
    } catch (refreshError: any) {
      setError(refreshError?.message || 'Não foi possível carregar suas categorias.');
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  const activeCategories = useMemo(() => categories.filter((category) => category.is_active), [categories]);

  async function createCategory(event: React.FormEvent) {
    event.preventDefault();
    if (!categoryName.trim()) return;
    setBusyKey('new-category');
    setError(null);
    const { error: insertError } = await supabase.from('mf_transaction_categories').insert({
      user_id: user.id,
      name: categoryName.trim(),
      name_key: categoryName.trim().toLocaleLowerCase('pt-BR'),
      category_type: categoryType,
      is_system: false,
      is_active: true,
      sort_order: 500,
    });
    if (insertError) setError(insertError.message);
    else {
      setCategoryName('');
      await refresh();
    }
    setBusyKey(null);
  }

  async function toggleCategory(category: TransactionCategory) {
    if (category.is_system) return;
    setBusyKey(`category-${category.id}`);
    setError(null);
    const { error: updateError } = await supabase
      .from('mf_transaction_categories')
      .update({ is_active: !category.is_active })
      .eq('id', category.id)
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
          <div className="mf-brand-icon"><Tags size={20} /></div>
          <div><h1>{settings?.workspace_name || 'MF Financeiro'}</h1><span>Categorias</span></div>
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
            <h2 className="text-xl font-black">Como seu dinheiro é organizado</h2>
            <p className="text-sm text-white/40">Categorias descrevem a finalidade de uma entrada ou saída. Elas não representam contas nem saldos.</p>
          </div>

          {error && <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-xs text-red-200">{error}</div>}

          {loading ? <div className="mf-loading">Carregando categorias...</div> : (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,.8fr)]">
              <section className="glass-card space-y-4">
                <div className="flex items-center gap-3"><Tags size={18} className="text-brand-primary" /><div><h3 className="text-sm font-bold">Categorias ativas</h3><p className="text-[10px] text-white/40">Use poucas categorias claras; detalhes podem ficar na descrição do lançamento.</p></div></div>
                <div className="flex max-h-[430px] flex-wrap content-start gap-2 overflow-y-auto no-scrollbar">
                  {categories.map((category) => (
                    <button key={category.id} type="button" onClick={() => void toggleCategory(category)} disabled={category.is_system || busyKey === `category-${category.id}`} className={`rounded-lg border px-3 py-2 text-[10px] transition ${category.is_active ? 'border-white/10 bg-white/5 text-white/75' : 'border-white/5 bg-black/20 text-white/25 line-through'} ${category.is_system ? 'cursor-default' : 'hover:border-brand-primary/40'}`} title={category.is_system ? 'Categoria padrão protegida' : category.is_active ? 'Desativar categoria' : 'Reativar categoria'}>
                      {busyKey === `category-${category.id}` ? <Loader2 size={12} className="mr-1 inline animate-spin" /> : category.is_active && <CheckCircle2 size={12} className="mr-1 inline text-brand-primary" />}
                      {category.name} · {category.category_type === 'income' ? 'entrada' : category.category_type === 'expense' ? 'saída' : 'ambos'}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-white/35">{activeCategories.length} categoria(s) ativa(s). Categorias do sistema ficam protegidas para manter relatórios consistentes.</p>
              </section>

              <form onSubmit={createCategory} className="glass-card space-y-3">
                <div><h3 className="text-sm font-bold">Nova categoria</h3><p className="mt-1 text-[10px] text-white/40">Crie apenas quando nenhuma categoria existente representar bem o lançamento.</p></div>
                <label className="block text-[10px] text-white/50">Nome<input required value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="Ex.: Pets" className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-brand-primary" /></label>
                <label className="block text-[10px] text-white/50">Aplicação<select value={categoryType} onChange={(event) => setCategoryType(event.target.value as typeof categoryType)} className="mt-1 w-full rounded-lg border border-white/10 bg-[#121212] px-3 py-2 text-xs"><option value="both">Entradas e saídas</option><option value="expense">Somente saídas</option><option value="income">Somente entradas</option></select></label>
                <button disabled={busyKey === 'new-category'} className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-primary px-3 py-2 text-xs font-bold text-black disabled:opacity-50">{busyKey === 'new-category' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Criar categoria</button>
              </form>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
