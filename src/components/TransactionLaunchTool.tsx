import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, CalendarDays, CheckCircle2, Eye, EyeOff, LogOut, Receipt, Save, X } from 'lucide-react';
import { User } from '@supabase/supabase-js';
import { useNavigate } from 'react-router';

import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { CreditCard, FinancialAccount, TransactionCategory, UserSettings } from '../types';
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

export default function TransactionLaunchTool({ user }: { user: User }) {
  const { isPrivate, setIsPrivate } = useApp();
  const navigate = useNavigate();
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [categories, setCategories] = useState<TransactionCategory[]>([]);
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [showProfile, setShowProfile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [form, setForm] = useState({
    type: 'expense' as 'expense' | 'income',
    amount: '',
    date: new Date().toISOString().slice(0, 10),
    accountId: '',
    categoryId: '',
    description: '',
    paymentMethod: 'pix',
    status: 'paid' as 'paid' | 'pending',
    cardId: '',
    notes: '',
  });

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const ensured = await supabase.rpc('mf_ensure_financial_structure');
      if (ensured.error) throw ensured.error;
      const [settingsResult, accountsResult, categoriesResult, cardsResult] = await Promise.all([
        supabase.from('mf_user_settings').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('mf_account_balances').select('*').eq('user_id', user.id).order('is_default', { ascending: false }).order('created_at'),
        supabase.from('mf_transaction_categories').select('*').eq('user_id', user.id).eq('is_active', true).order('sort_order').order('name'),
        supabase.from('mf_credit_cards').select('*').eq('user_id', user.id).order('name'),
      ]);
      const firstError = settingsResult.error || accountsResult.error || categoriesResult.error || cardsResult.error;
      if (firstError) throw firstError;
      const nextAccounts = normalizeAccounts(accountsResult.data || []);
      const currentBalance = nextAccounts.reduce((sum, account) => sum + Number(account.current_balance || 0), 0);
      setAccounts(nextAccounts);
      setCategories((categoriesResult.data || []) as TransactionCategory[]);
      setCards((cardsResult.data || []).map((card: any) => ({ ...card, limit: Number(card.limit || 0), used: Number(card.used || 0) })) as CreditCard[]);
      setSettings(settingsResult.data ? ({ ...settingsResult.data, current_balance: currentBalance } as UserSettings) : null);
      setForm((current) => ({
        ...current,
        accountId: current.accountId || nextAccounts.find((account) => account.is_default && account.is_active)?.id || nextAccounts.find((account) => account.is_active)?.id || '',
      }));
    } catch (refreshError: any) {
      setError(refreshError?.message || 'Não foi possível preparar o lançamento.');
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  const selectableCategories = useMemo(() => categories.filter((category) =>
    category.category_type === 'both' || category.category_type === form.type,
  ), [categories, form.type]);

  useEffect(() => {
    if (selectableCategories.some((category) => category.id === form.categoryId)) return;
    setForm((current) => ({ ...current, categoryId: '' }));
  }, [form.type, selectableCategories]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) { setError('Informe um valor maior que zero.'); return; }
    if (!form.accountId) { setError('Selecione a conta relacionada ao lançamento.'); return; }
    const category = categories.find((item) => item.id === form.categoryId);
    if (!category) { setError('Selecione uma categoria.'); return; }
    if (!form.description.trim()) { setError('Informe uma descrição curta.'); return; }

    setSaving(true);
    setError(null);
    setSuccess(false);
    const { error: rpcError } = await supabase.rpc('mf_create_finance_entry_v3', {
      p_type: form.type,
      p_amount: Math.abs(amount),
      p_date: form.date,
      p_description: form.description.trim(),
      p_account_id: form.accountId,
      p_category_id: category.id,
      p_category: category.name,
      p_payment_method: form.paymentMethod,
      p_status: form.status,
      p_source: 'Manual',
      p_card_id: form.paymentMethod === 'credit_card' && form.cardId ? form.cardId : null,
      p_due_date: form.status === 'pending' ? form.date : null,
      p_notes: form.notes.trim() || null,
    });
    setSaving(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setSuccess(true);
    window.setTimeout(() => navigate('/app/movimentacoes'), 450);
  }

  return (
    <div className="mf-app-shell mf-routed-app">
      <AppNavigation onLaunch={() => undefined} />
      <header className="mf-topbar">
        <div className="mf-brand">
          <div className="mf-brand-icon"><Receipt size={20} /></div>
          <div><h1>{settings?.workspace_name || 'MF Financeiro'}</h1><span>Novo lançamento</span></div>
        </div>
        <div className="mf-top-actions">
          <ProfileCenter user={user} settings={settings} accounts={accounts} open={showProfile} onOpenChange={setShowProfile} onSaved={refresh} />
          <button type="button" onClick={() => setIsPrivate(!isPrivate)} title="Privacidade">{isPrivate ? <EyeOff size={16} /> : <Eye size={16} />}</button>
          <button type="button" onClick={() => navigate('/app')} title="Fechar"><X size={17} /></button>
          <button type="button" onClick={async () => { await supabase.auth.signOut(); window.location.replace('/'); }} title="Sair"><LogOut size={17} /></button>
        </div>
      </header>

      <section className="mf-content">
        <div className="mx-auto w-full max-w-3xl space-y-4 animate-fade-in">
          <div>
            <h2 className="text-xl font-black">Lançar movimentação</h2>
            <p className="text-sm text-white/40">Uma única entrada para registrar dinheiro que entrou, saiu ou ainda está previsto.</p>
          </div>

          {error && <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-xs text-red-200">{error}</div>}
          {success && <div className="flex items-center gap-2 rounded-xl border border-green-500/25 bg-green-500/10 px-4 py-3 text-xs text-green-200"><CheckCircle2 size={15} />Lançamento salvo.</div>}

          {loading ? <div className="mf-loading">Preparando lançamento...</div> : (
            <form onSubmit={save} className="glass-card space-y-4 !p-5">
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setForm((current) => ({ ...current, type: 'expense' }))} className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold ${form.type === 'expense' ? 'border-red-400/30 bg-red-500/10 text-red-300' : 'border-white/10 bg-white/[0.03] text-white/45'}`}><ArrowDownCircle size={17} />Saída</button>
                <button type="button" onClick={() => setForm((current) => ({ ...current, type: 'income' }))} className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold ${form.type === 'income' ? 'border-green-400/30 bg-green-500/10 text-green-300' : 'border-white/10 bg-white/[0.03] text-white/45'}`}><ArrowUpCircle size={17} />Entrada</button>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Valor"><input autoFocus required type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></Field>
                <Field label="Data"><input required type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></Field>
                <Field label="Conta"><select required value={form.accountId} onChange={(event) => setForm({ ...form, accountId: event.target.value })}><option value="">Selecione</option>{accounts.filter((account) => account.is_active).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></Field>
                <Field label="Categoria"><select required value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}><option value="">Selecione</option>{selectableCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field>
                <Field label="Descrição"><input required value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Ex.: Mercado, salário, aluguel" /></Field>
                <Field label="Forma de pagamento"><select value={form.paymentMethod} onChange={(event) => setForm({ ...form, paymentMethod: event.target.value, cardId: event.target.value === 'credit_card' ? form.cardId : '' })}><option value="pix">Pix</option><option value="debit_card">Cartão de débito</option><option value="credit_card">Cartão de crédito</option><option value="cash">Dinheiro</option><option value="bank_transfer">Transferência</option><option value="boleto">Boleto</option><option value="other">Outra</option></select></Field>
                {form.paymentMethod === 'credit_card' && <Field label="Cartão"><select value={form.cardId} onChange={(event) => setForm({ ...form, cardId: event.target.value })}><option value="">Sem vínculo</option>{cards.map((card) => <option key={card.id} value={card.id}>{card.name}</option>)}</select></Field>}
                <Field label="Situação"><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as 'paid' | 'pending' })}><option value="paid">Realizado</option><option value="pending">Previsto / pendente</option></select></Field>
              </div>

              <Field label="Observação"><textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Opcional" /></Field>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
                <p className="flex items-center gap-2 text-[10px] text-white/35"><CalendarDays size={13} />Lançamentos pendentes ficam previstos; realizados passam a compor o saldo.</p>
                <div className="flex gap-2"><button type="button" onClick={() => navigate(-1)} className="rounded-xl border border-white/10 px-4 py-2.5 text-xs">Cancelar</button><button disabled={saving} className="flex items-center gap-2 rounded-xl bg-brand-primary px-5 py-2.5 text-xs font-black text-black disabled:opacity-50"><Save size={14} />{saving ? 'Salvando...' : 'Salvar lançamento'}</button></div>
              </div>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactElement<any> }) {
  return <label className="block text-[10px] font-bold uppercase tracking-wider text-white/40">{label}{React.cloneElement(children, { className: 'mt-1 w-full rounded-xl border border-white/10 bg-[#121212] px-3 py-3 text-sm text-white outline-none focus:border-brand-primary' })}</label>;
}
