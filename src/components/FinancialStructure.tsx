import {
  Archive,
  CheckCircle2,
  Loader2,
  Plus,
  Tags,
  Wallet,
} from 'lucide-react';
import type React from 'react';
import { useMemo, useState } from 'react';

import { supabase } from '../lib/supabase';
import type {
  FinancialAccount,
  FinancialAccountType,
  TransactionCategory,
} from '../types';

interface FinancialStructureProps {
  userId: string;
  accounts: FinancialAccount[];
  categories: TransactionCategory[];
  onRefresh: () => Promise<void>;
}

const ACCOUNT_TYPE_LABELS: Record<FinancialAccountType, string> = {
  checking: 'Conta corrente',
  savings: 'Poupança',
  cash: 'Carteira / dinheiro',
  investment: 'Investimentos',
  credit: 'Crédito',
  other: 'Outra',
};

export default function FinancialStructure({
  userId,
  accounts,
  categories,
  onRefresh,
}: FinancialStructureProps) {
  const [accountName, setAccountName] = useState('');
  const [accountType, setAccountType] =
    useState<FinancialAccountType>('checking');
  const [openingBalance, setOpeningBalance] = useState('0');
  const [categoryName, setCategoryName] = useState('');
  const [categoryType, setCategoryType] = useState<
    'income' | 'expense' | 'both'
  >('both');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeAccounts = useMemo(
    () => accounts.filter((account) => account.is_active),
    [accounts],
  );
  const activeCategories = useMemo(
    () => categories.filter((category) => category.is_active),
    [categories],
  );

  async function createAccount(event: React.FormEvent) {
    event.preventDefault();
    const balance = Number(openingBalance);
    if (!accountName.trim() || !Number.isFinite(balance)) return;

    setBusyKey('new-account');
    setError(null);
    const { error: insertError } = await supabase
      .from('mf_financial_accounts')
      .insert({
        user_id: userId,
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
      await onRefresh();
    }
    setBusyKey(null);
  }

  async function archiveAccount(account: FinancialAccount) {
    if (account.is_default) {
      setError('A conta principal não pode ser arquivada nesta etapa.');
      return;
    }

    setBusyKey(`account-${account.id}`);
    setError(null);
    const { error: updateError } = await supabase
      .from('mf_financial_accounts')
      .update({ is_active: !account.is_active })
      .eq('id', account.id)
      .eq('user_id', userId);
    if (updateError) setError(updateError.message);
    else await onRefresh();
    setBusyKey(null);
  }

  async function createCategory(event: React.FormEvent) {
    event.preventDefault();
    if (!categoryName.trim()) return;

    setBusyKey('new-category');
    setError(null);
    const { error: insertError } = await supabase
      .from('mf_transaction_categories')
      .insert({
        user_id: userId,
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
      await onRefresh();
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
      .eq('user_id', userId);
    if (updateError) setError(updateError.message);
    else await onRefresh();
    setBusyKey(null);
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {error && (
        <div
          className="xl:col-span-2 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-xs text-red-200"
          role="alert"
        >
          {error}
        </div>
      )}

      <section className="glass-card space-y-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-brand-primary/15 p-2 text-brand-primary">
            <Wallet size={18} />
          </div>
          <div>
            <h3 className="text-sm font-bold">Contas financeiras</h3>
            <p className="text-[10px] text-white/40">
              Cada lançamento pertence a uma conta.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {accounts.map((account) => (
            <div
              key={account.id}
              className={`flex items-center justify-between gap-3 rounded-xl border p-3 ${account.is_active ? 'border-white/10 bg-white/[0.03]' : 'border-white/5 bg-black/20 opacity-55'}`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <strong className="truncate text-xs">{account.name}</strong>
                  {account.is_default && (
                    <span className="rounded bg-brand-primary/15 px-1.5 py-0.5 text-[8px] font-bold uppercase text-brand-primary">
                      Principal
                    </span>
                  )}
                </div>
                <div className="mt-1 text-[10px] text-white/40">
                  {ACCOUNT_TYPE_LABELS[account.account_type]} ·{' '}
                  {account.transaction_count} lançamentos
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <strong className="text-xs text-brand-primary">
                  {Number(account.current_balance || 0).toLocaleString(
                    'pt-BR',
                    { style: 'currency', currency: account.currency || 'BRL' },
                  )}
                </strong>
                {!account.is_default && (
                  <button
                    type="button"
                    onClick={() => archiveAccount(account)}
                    disabled={busyKey === `account-${account.id}`}
                    className="text-white/35 hover:text-white disabled:opacity-40"
                    aria-label={
                      account.is_active ? 'Arquivar conta' : 'Reativar conta'
                    }
                  >
                    {busyKey === `account-${account.id}` ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : account.is_active ? (
                      <Archive size={15} />
                    ) : (
                      <CheckCircle2 size={15} />
                    )}
                  </button>
                )}
              </div>
            </div>
          ))}
          {accounts.length === 0 && (
            <div className="py-6 text-center text-xs text-white/35">
              A conta principal será criada automaticamente.
            </div>
          )}
        </div>

        <form
          onSubmit={createAccount}
          className="grid gap-2 rounded-xl border border-white/10 bg-black/15 p-3 sm:grid-cols-2"
        >
          <label className="text-[10px] text-white/50 sm:col-span-2">
            Nome
            <input
              required
              value={accountName}
              onChange={(event) => setAccountName(event.target.value)}
              placeholder="Ex.: Nubank"
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-brand-primary"
            />
          </label>
          <label className="text-[10px] text-white/50">
            Tipo
            <select
              value={accountType}
              onChange={(event) =>
                setAccountType(event.target.value as FinancialAccountType)
              }
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#121212] px-3 py-2 text-xs"
            >
              <option value="checking">Conta corrente</option>
              <option value="savings">Poupança</option>
              <option value="cash">Carteira</option>
              <option value="investment">Investimentos</option>
              <option value="credit">Crédito</option>
              <option value="other">Outra</option>
            </select>
          </label>
          <label className="text-[10px] text-white/50">
            Saldo inicial
            <input
              type="number"
              step="0.01"
              value={openingBalance}
              onChange={(event) => setOpeningBalance(event.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-brand-primary"
            />
          </label>
          <button
            disabled={busyKey === 'new-account'}
            className="sm:col-span-2 flex items-center justify-center gap-2 rounded-lg bg-brand-primary px-3 py-2 text-xs font-bold text-black disabled:opacity-50"
          >
            {busyKey === 'new-account' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Plus size={14} />
            )}{' '}
            Adicionar conta
          </button>
        </form>
        <p className="text-[10px] text-white/35">
          {activeAccounts.length} conta(s) ativa(s). O saldo exibido é derivado
          do saldo inicial e dos lançamentos confirmados.
        </p>
      </section>

      <section className="glass-card space-y-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-purple-500/15 p-2 text-purple-300">
            <Tags size={18} />
          </div>
          <div>
            <h3 className="text-sm font-bold">Categorias normalizadas</h3>
            <p className="text-[10px] text-white/40">
              Uma categoria por ID, sem variações duplicadas.
            </p>
          </div>
        </div>

        <div className="flex max-h-[340px] flex-wrap gap-2 overflow-y-auto no-scrollbar">
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => toggleCategory(category)}
              disabled={
                category.is_system || busyKey === `category-${category.id}`
              }
              className={`rounded-lg border px-2.5 py-1.5 text-[10px] transition ${category.is_active ? 'border-white/10 bg-white/5 text-white/75' : 'border-white/5 bg-black/20 text-white/25 line-through'} ${category.is_system ? 'cursor-default' : 'hover:border-brand-primary/40'}`}
              title={
                category.is_system
                  ? 'Categoria padrão protegida'
                  : category.is_active
                    ? 'Desativar categoria'
                    : 'Reativar categoria'
              }
            >
              {category.name} ·{' '}
              {category.category_type === 'income'
                ? 'entrada'
                : category.category_type === 'expense'
                  ? 'saída'
                  : 'ambos'}
            </button>
          ))}
        </div>

        <form
          onSubmit={createCategory}
          className="grid gap-2 rounded-xl border border-white/10 bg-black/15 p-3 sm:grid-cols-[1fr_150px_auto] sm:items-end"
        >
          <label className="text-[10px] text-white/50">
            Nome
            <input
              required
              value={categoryName}
              onChange={(event) => setCategoryName(event.target.value)}
              placeholder="Nova categoria"
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-brand-primary"
            />
          </label>
          <label className="text-[10px] text-white/50">
            Aplicação
            <select
              value={categoryType}
              onChange={(event) =>
                setCategoryType(event.target.value as typeof categoryType)
              }
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#121212] px-3 py-2 text-xs"
            >
              <option value="both">Entradas e saídas</option>
              <option value="expense">Saídas</option>
              <option value="income">Entradas</option>
            </select>
          </label>
          <button
            disabled={busyKey === 'new-category'}
            className="flex items-center justify-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-xs font-bold hover:bg-white/15 disabled:opacity-50"
          >
            {busyKey === 'new-category' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Plus size={14} />
            )}{' '}
            Criar
          </button>
        </form>
        <p className="text-[10px] text-white/35">
          {activeCategories.length} categoria(s) ativa(s). Categorias antigas
          continuam legíveis durante a migração.
        </p>
      </section>
    </div>
  );
}
