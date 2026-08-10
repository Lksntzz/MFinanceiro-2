import React, { useMemo, useState } from 'react';
import { ArrowLeft, Check, Loader2, Mic, ScanLine } from 'lucide-react';
import { format } from 'date-fns';
import { useNavigate } from 'react-router';

import { supabase } from '../../lib/supabase';
import type { FinancialAccount, TransactionCategory } from '../../types';
import { MOBILE_ROUTES } from '../routes';
import './mobile-voice.css';

type EntryType = 'expense' | 'income';

type MobileQuickAddProps = {
  userId: string;
  accounts: FinancialAccount[];
  categories: TransactionCategory[];
  onSaved: () => Promise<void> | void;
};

function parseMoneyInput(value: string) {
  const clean = value.trim().replace(/\s/g, '');
  if (!clean) return Number.NaN;
  if (clean.includes(',')) return Number(clean.replace(/\./g, '').replace(',', '.'));
  return Number(clean);
}

export default function MobileQuickAdd({ userId, accounts, categories, onSaved }: MobileQuickAddProps) {
  const navigate = useNavigate();
  const [type, setType] = useState<EntryType>('expense');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [accountId, setAccountId] = useState(() => accounts.find((item) => item.is_default)?.id || accounts[0]?.id || '');
  const [categoryId, setCategoryId] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const compatibleCategories = useMemo(
    () => categories.filter((item) => item.is_active && (item.category_type === 'both' || item.category_type === type)),
    [categories, type],
  );

  const selectedCategory = compatibleCategories.find((item) => item.id === categoryId) || compatibleCategories[0];
  const effectiveCategoryId = selectedCategory?.id || '';
  const parsedAmount = parseMoneyInput(amount);

  async function saveEntry(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError(null);
    setMessage(null);

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('Informe um valor maior que zero.');
      return;
    }
    if (!accountId) {
      setError('Selecione uma conta.');
      return;
    }
    if (!effectiveCategoryId || !selectedCategory) {
      setError('Selecione uma categoria.');
      return;
    }

    setSaving(true);
    try {
      const { error: rpcError } = await supabase.rpc('mf_create_finance_entry_v3', {
        p_type: type,
        p_amount: parsedAmount,
        p_date: format(new Date(), 'yyyy-MM-dd'),
        p_description: description.trim() || selectedCategory.name,
        p_account_id: accountId,
        p_category_id: effectiveCategoryId,
        p_category: selectedCategory.name,
        p_payment_method: 'unspecified',
        p_status: 'paid',
        p_card_id: null,
        p_installment_count: 1,
        p_due_date: null,
        p_notes: null,
        p_source: 'MF Quick Mobile',
      });
      if (rpcError) throw rpcError;

      setAmount('');
      setDescription('');
      setMessage(`${type === 'expense' ? 'Despesa' : 'Receita'} salva no MF.`);
      await onSaved();
    } catch (saveError: any) {
      setError(saveError?.message || 'Não foi possível salvar o lançamento.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mf-mobile-focus-page">
      <header className="mf-mobile-focus-header">
        <button type="button" className="mf-mobile-icon-button" onClick={() => navigate(MOBILE_ROUTES.home)} aria-label="Voltar para a Home">
          <ArrowLeft size={21} />
        </button>
        <div>
          <span className="mf-mobile-eyebrow">MF Quick</span>
          <h1>Novo lançamento</h1>
        </div>
        <button type="button" className="mf-mobile-icon-button" onClick={() => navigate(MOBILE_ROUTES.scan)} aria-label="Abrir MF Scan">
          <ScanLine size={20} />
        </button>
      </header>

      <form className="mf-mobile-quick-form" onSubmit={saveEntry}>
        <button type="button" className="mf-mobile-voice-quick-entry" onClick={() => navigate(MOBILE_ROUTES.voice)}>
          <span><Mic size={21} /></span>
          <div><strong>Falar lançamento</strong><small>Ex.: “Gastei 48 reais de gasolina”</small></div>
        </button>

        <div className="mf-mobile-segmented" role="group" aria-label="Tipo do lançamento">
          <button type="button" data-active={type === 'expense'} onClick={() => { setType('expense'); setCategoryId(''); }}>Despesa</button>
          <button type="button" data-active={type === 'income'} onClick={() => { setType('income'); setCategoryId(''); }}>Receita</button>
        </div>

        <label className="mf-mobile-amount-field">
          <span>Valor</span>
          <div><small>R$</small><input inputMode="decimal" autoFocus value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^0-9,.]/g, ''))} placeholder="0,00" /></div>
        </label>

        <label className="mf-mobile-field">
          <span>Categoria</span>
          <select value={effectiveCategoryId} onChange={(event) => setCategoryId(event.target.value)}>
            {compatibleCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>

        {accounts.length > 1 ? (
          <label className="mf-mobile-field">
            <span>Conta</span>
            <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select>
          </label>
        ) : null}

        <label className="mf-mobile-field">
          <span>Descrição <em>opcional</em></span>
          <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder={selectedCategory?.name || 'Ex.: almoço'} />
        </label>

        {error ? <div className="mf-mobile-feedback error">{error}</div> : null}
        {message ? <div className="mf-mobile-feedback success"><Check size={16} />{message}</div> : null}

        <button className="mf-mobile-primary-button" type="submit" disabled={saving || !userId}>
          {saving ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} />}
          Salvar lançamento
        </button>
      </form>
    </div>
  );
}
