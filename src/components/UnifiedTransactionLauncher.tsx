import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  Banknote,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock3,
  CreditCard,
  Landmark,
  ListPlus,
  Plus,
  QrCode,
  ReceiptText,
  RotateCcw,
  Save,
  Wallet,
  X,
} from 'lucide-react';
import { format } from 'date-fns';
import { CATEGORIES } from '../lib/constants';
import { supabase } from '../lib/supabase';
import { createOperationalCorrelationId, reportOperationalEvent } from '../lib/operational-observability';
import { FinancialAccount, TransactionCategory } from '../types';

type EntryType = 'expense' | 'income';
type EntryStatus = 'paid' | 'pending';
type PaymentMethod =
  | 'pix'
  | 'debit_card'
  | 'credit_card'
  | 'cash'
  | 'boleto'
  | 'bank_transfer'
  | 'benefit'
  | 'other';

type CardRow = {
  id: string;
  name: string;
  brand?: string | null;
  used: number;
  limit: number;
};

type PendingRow = {
  id: string;
  description: string;
  category: string;
  amount: number;
  type: EntryType;
  date: string;
  due_date?: string | null;
  payment_method?: PaymentMethod | 'unspecified';
};

type FormState = {
  type: EntryType;
  amount: string;
  description: string;
  accountId: string;
  categoryId: string;
  category: string;
  date: string;
  status: EntryStatus;
  paymentMethod: PaymentMethod;
  cardId: string;
  installmentCount: string;
  dueDate: string;
  notes: string;
};

const PAYMENT_OPTIONS: Record<EntryType, Array<{ id: PaymentMethod; label: string; icon: React.ComponentType<{ size?: number }> }>> = {
  expense: [
    { id: 'pix', label: 'Pix', icon: QrCode },
    { id: 'debit_card', label: 'Débito', icon: CreditCard },
    { id: 'credit_card', label: 'Crédito', icon: CreditCard },
    { id: 'cash', label: 'Dinheiro', icon: Banknote },
    { id: 'boleto', label: 'Boleto', icon: ReceiptText },
    { id: 'bank_transfer', label: 'Transferência', icon: ArrowLeftRight },
    { id: 'other', label: 'Outro', icon: Wallet },
  ],
  income: [
    { id: 'pix', label: 'Pix', icon: QrCode },
    { id: 'bank_transfer', label: 'Transferência', icon: ArrowLeftRight },
    { id: 'cash', label: 'Dinheiro', icon: Banknote },
    { id: 'benefit', label: 'Benefício', icon: Landmark },
    { id: 'other', label: 'Outro', icon: Wallet },
  ],
};

const INCOME_CATEGORIES = ['Salário', 'Renda extra', 'Reembolso', 'Benefícios', 'Investimentos', 'Outros'];
const money = (value: number) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const todayKey = () => format(new Date(), 'yyyy-MM-dd');

function defaultForm(): FormState {
  return {
    type: 'expense',
    amount: '',
    description: '',
    accountId: '',
    categoryId: '',
    category: CATEGORIES[0] || 'Geral',
    date: todayKey(),
    status: 'paid',
    paymentMethod: 'pix',
    cardId: '',
    installmentCount: '1',
    dueDate: '',
    notes: '',
  };
}

type UnifiedTransactionLauncherProps = {
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDataChanged?: () => void | Promise<void>;
};

export default function UnifiedTransactionLauncher({
  userId,
  open,
  onOpenChange,
  onDataChanged,
}: UnifiedTransactionLauncherProps) {
  const [advanced, setAdvanced] = useState(false);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [form, setForm] = useState<FormState>(defaultForm);
  const [cards, setCards] = useState<CardRow[]>([]);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [normalizedCategories, setNormalizedCategories] = useState<TransactionCategory[]>([]);
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadSupportingData() {
    const ensured = await supabase.rpc('mf_ensure_financial_structure');
    if (ensured.error) {
      reportOperationalEvent('transaction.supporting_data_failed', 'transaction-launcher', 'error', { phase: 'ensure_structure' });
      setError(ensured.error.message);
      return;
    }

    const [cardResult, pendingResult, accountResult, categoryResult] = await Promise.all([
      supabase.from('mf_credit_cards').select('id,name,brand,used,limit').eq('user_id', userId).order('name'),
      supabase
        .from('mf_finance_ledger_entries')
        .select('id,description,category,amount,type,date,due_date,payment_method')
        .eq('user_id', userId)
        .eq('status', 'pending')
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(12),
      supabase.from('mf_account_balances').select('*').eq('user_id', userId).eq('is_active', true).order('is_default', { ascending: false }).order('created_at'),
      supabase.from('mf_transaction_categories').select('*').eq('user_id', userId).eq('is_active', true).order('sort_order').order('name'),
    ]);

    if (cardResult.error) setError(cardResult.error.message);
    if (pendingResult.error) setError(pendingResult.error.message);
    if (accountResult.error) setError(accountResult.error.message);
    if (categoryResult.error) setError(categoryResult.error.message);
    if (cardResult.error || pendingResult.error || accountResult.error || categoryResult.error) {
      reportOperationalEvent('transaction.supporting_data_failed', 'transaction-launcher', 'warning', {
        cards_failed: Boolean(cardResult.error), pending_failed: Boolean(pendingResult.error), accounts_failed: Boolean(accountResult.error), categories_failed: Boolean(categoryResult.error),
      });
    }

    const nextCards = (cardResult.data || []).map((card: any) => ({
      ...card,
      used: Number(card.used || 0),
      limit: Number(card.limit || 0),
    })) as CardRow[];
    const nextAccounts = (accountResult.data || []).map((account: any) => ({
      ...account,
      opening_balance: Number(account.opening_balance || 0),
      current_balance: Number(account.current_balance || 0),
      transaction_count: Number(account.transaction_count || 0),
    })) as FinancialAccount[];
    const nextCategories = (categoryResult.data || []) as TransactionCategory[];
    setCards(nextCards);
    setAccounts(nextAccounts);
    setNormalizedCategories(nextCategories);
    setPending((pendingResult.data || []).map((item: any) => ({
      ...item,
      amount: Number(item.amount || 0),
      description: item.description || 'Lançamento pendente',
      category: item.category || 'Geral',
      type: item.type === 'income' ? 'income' : 'expense',
    })) as PendingRow[]);

    setForm((current) => {
      const account = nextAccounts.find((item) => item.id === current.accountId)
        || nextAccounts.find((item) => item.is_default)
        || nextAccounts[0];
      const compatibleCategories = nextCategories.filter((item) =>
        item.category_type === 'both' || item.category_type === current.type,
      );
      const category = compatibleCategories.find((item) => item.id === current.categoryId)
        || compatibleCategories.find((item) => item.name === current.category)
        || compatibleCategories[0];
      return {
        ...current,
        accountId: account?.id || '',
        categoryId: category?.id || '',
        category: category?.name || current.category,
        cardId: current.cardId || nextCards[0]?.id || '',
      };
    });
  }

  useEffect(() => {
    if (!open) return;
    setMessage(null);
    setError(null);
    void loadSupportingData();
    // The launcher reloads its supporting data only when it is explicitly opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, userId]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onOpenChange(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onOpenChange, open, saving]);

  const amount = Number(form.amount || 0);
  const categoryOptions = normalizedCategories.filter((category) =>
    category.category_type === 'both' || category.category_type === form.type,
  );
  const selectedCard = cards.find((card) => card.id === form.cardId);
  const affectsBalance = form.status === 'paid' && !(form.type === 'expense' && form.paymentMethod === 'credit_card');
  const balanceEffect = affectsBalance ? (form.type === 'expense' ? -Math.abs(amount) : Math.abs(amount)) : 0;

  const preview = useMemo(() => {
    if (!Number.isFinite(amount) || amount <= 0) return 'Informe o valor para visualizar o efeito.';
    if (form.status === 'pending') return `Será salvo como pendente, sem alterar o saldo agora.`;
    if (form.type === 'expense' && form.paymentMethod === 'credit_card') {
      return `${money(amount)} será adicionado ao cartão ${selectedCard?.name || 'selecionado'}, sem reduzir o saldo agora.`;
    }
    return `${form.type === 'expense' ? 'O saldo será reduzido em' : 'O saldo aumentará em'} ${money(Math.abs(balanceEffect))}.`;
  }, [amount, balanceEffect, form.paymentMethod, form.status, form.type, selectedCard?.name]);

  function changeType(type: EntryType) {
    const nextCategory = normalizedCategories.find((category) =>
      category.is_active && (category.category_type === 'both' || category.category_type === type),
    );
    setForm((current) => ({
      ...current,
      type,
      categoryId: nextCategory?.id || '',
      category: nextCategory?.name || (type === 'income' ? INCOME_CATEGORIES[0] : CATEGORIES[0] || 'Geral'),
      paymentMethod: type === 'income' ? 'pix' : current.paymentMethod === 'benefit' ? 'pix' : current.paymentMethod,
      cardId: type === 'income' ? '' : current.cardId,
      installmentCount: type === 'income' ? '1' : current.installmentCount,
    }));
    setMessage(null);
  }

  function selectMethod(method: PaymentMethod) {
    setForm((current) => ({
      ...current,
      paymentMethod: method,
      cardId: method === 'credit_card' ? current.cardId || cards[0]?.id || '' : '',
      installmentCount: method === 'credit_card' ? current.installmentCount : '1',
    }));
    setAdvanced(true);
  }

  function resetForAnother() {
    setForm((current) => ({
      ...defaultForm(),
      type: current.type,
      accountId: current.accountId,
      categoryId: current.categoryId,
      category: current.category,
      date: current.date,
      paymentMethod: current.paymentMethod,
      cardId: current.paymentMethod === 'credit_card' ? current.cardId : '',
    }));
    setMessage(null);
    setError(null);
  }

  async function refreshDashboard() {
    try {
      await onDataChanged?.();
    } catch (refreshError) {
      reportOperationalEvent('transaction.refresh_after_save_failed', 'transaction-launcher', 'warning', { phase: 'refresh_dashboard' });
      console.warn('Lançamento confirmado, mas o painel não pôde ser atualizado imediatamente:', refreshError);
    }
  }

  async function save(keepOpen: boolean) {
    if (!userId || saving) return;
    const correlationId = createOperationalCorrelationId();
    const startedAt = performance.now();
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Informe um valor maior que zero.');
      if (!form.description.trim()) throw new Error('Informe uma descrição.');
      if (!form.accountId) throw new Error('Selecione a conta financeira do lançamento.');
      if (!form.categoryId) throw new Error('Selecione uma categoria.');
      if (form.paymentMethod === 'credit_card' && form.type === 'expense' && !form.cardId) {
        throw new Error('Selecione o cartão utilizado.');
      }
      const installmentCount = Math.max(1, Math.min(48, Number(form.installmentCount || 1)));

      const { error: rpcError } = await supabase.rpc('mf_create_finance_entry_v3', {
        p_type: form.type,
        p_amount: amount,
        p_date: form.date,
        p_description: form.description.trim(),
        p_account_id: form.accountId,
        p_category_id: form.categoryId,
        p_category: form.category,
        p_payment_method: form.paymentMethod,
        p_status: form.status,
        p_card_id: form.paymentMethod === 'credit_card' && form.type === 'expense' ? form.cardId : null,
        p_installment_count: installmentCount,
        p_due_date: form.status === 'pending' && form.dueDate ? form.dueDate : null,
        p_notes: form.notes.trim() || null,
        p_source: 'Manual detalhado',
      });
      if (rpcError) throw rpcError;

      setMessage(form.status === 'pending' ? 'Lançamento pendente registrado.' : 'Lançamento registrado e valores atualizados.');
      await loadSupportingData();
      await refreshDashboard();

      if (keepOpen) {
        resetForAnother();
      } else {
        window.setTimeout(() => {
          onOpenChange(false);
          setForm(defaultForm());
          setAdvanced(false);
        }, 550);
      }
    } catch (saveError: any) {
      reportOperationalEvent('transaction.create_failed', 'transaction-launcher', 'error', { phase: 'save', keep_open: keepOpen }, { correlationId, durationMs: performance.now() - startedAt });
      setError(saveError?.message || 'Não foi possível registrar o lançamento.');
    } finally {
      setSaving(false);
    }
  }

  async function markPaid(item: PendingRow) {
    const pendingCorrelationId = createOperationalCorrelationId();
    const pendingStartedAt = performance.now();
    setPayingId(item.id);
    setError(null);
    try {
      const { error: rpcError } = await supabase.rpc('mf_set_finance_entry_paid', { p_entry_id: item.id });
      if (rpcError) throw rpcError;
      setMessage(item.type === 'income' ? 'Entrada recebida e saldo atualizado.' : 'Saída paga e saldo atualizado.');
      await loadSupportingData();
      await refreshDashboard();
    } catch (payError: any) {
      reportOperationalEvent('transaction.mark_paid_failed', 'transaction-pending', 'error', { phase: 'mark_paid' }, { correlationId: pendingCorrelationId, durationMs: performance.now() - pendingStartedAt, impact: 'financial_risk' });
      setError(payError?.message || 'Não foi possível concluir a pendência.');
    } finally {
      setPayingId(null);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onOpenChange(false); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="mf-transaction-launcher-title" className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#090909] shadow-2xl">
        <header className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3 md:px-5">
          <div>
            <h2 id="mf-transaction-launcher-title" className="flex items-center gap-2 text-base font-black"><ListPlus size={19} className="text-brand-primary" /> Central de lançamentos</h2>
            <p className="mt-1 text-[9px] uppercase tracking-[0.17em] text-white/35">Entrada, saída, forma de pagamento e pendências no mesmo lugar</p>
          </div>
          <button type="button" aria-label="Fechar central de lançamentos" disabled={saving} onClick={() => onOpenChange(false)} className="rounded-xl bg-white/5 p-2 text-white/45 hover:text-white disabled:opacity-40"><X size={18} /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
          {(error || message) && (
            <div className={`mb-4 flex items-center justify-between rounded-xl border px-3 py-2 text-xs ${error ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-green-500/30 bg-green-500/10 text-green-300'}`}>
              <span className="flex items-center gap-2">{error ? <X size={14} /> : <CheckCircle2 size={14} />}{error || message}</span>
              <button type="button" onClick={() => { setError(null); setMessage(null); }}>×</button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 rounded-2xl bg-white/[0.03] p-1.5">
            <button type="button" onClick={() => changeType('expense')} className={`rounded-xl py-3 text-sm font-black transition ${form.type === 'expense' ? 'bg-red-500/15 text-red-300' : 'text-white/35'}`}>Saída</button>
            <button type="button" onClick={() => changeType('income')} className={`rounded-xl py-3 text-sm font-black transition ${form.type === 'income' ? 'bg-green-500/15 text-green-300' : 'text-white/35'}`}>Entrada</button>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Field label="Valor"><input autoFocus type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="0,00" /></Field>
            <Field label="Data"><input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></Field>
            <Field label="Descrição" wide><input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder={form.type === 'expense' ? 'Ex.: Mercado, combustível, aluguel' : 'Ex.: Salário, reembolso, venda'} /></Field>
            <Field label="Conta financeira"><select value={form.accountId} onChange={(event) => setForm({ ...form, accountId: event.target.value })}><option value="">Selecione</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {money(account.current_balance)}</option>)}</select></Field>
            <Field label="Categoria"><select value={form.categoryId} onChange={(event) => { const category = normalizedCategories.find((item) => item.id === event.target.value); setForm({ ...form, categoryId: event.target.value, category: category?.name || 'Geral' }); }}><option value="">Selecione</option>{categoryOptions.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field>
          </div>

          <section className="mt-5">
            <div className="mb-2 text-[9px] font-bold uppercase tracking-wider text-white/35">{form.type === 'expense' ? 'Como foi pago?' : 'Como foi recebido?'}</div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-7">
              {PAYMENT_OPTIONS[form.type].map((option) => {
                const Icon = option.icon;
                return <button key={option.id} type="button" onClick={() => selectMethod(option.id)} className={`flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-xl border px-2 text-[10px] font-bold transition ${form.paymentMethod === option.id ? 'border-brand-primary/45 bg-brand-primary/10 text-brand-primary' : 'border-white/10 bg-white/[0.025] text-white/45 hover:text-white'}`}><Icon size={16} />{option.label}</button>;
              })}
            </div>
          </section>

          <button type="button" onClick={() => setAdvanced((value) => !value)} className="mt-4 flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2.5 text-xs font-bold text-white/55">
            <span>Mais detalhes</span><ChevronDown size={15} className={`transition ${advanced ? 'rotate-180' : ''}`} />
          </button>

          {advanced && (
            <section className="mt-3 grid gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4 md:grid-cols-2">
              <Field label="Situação"><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as EntryStatus })}><option value="paid">{form.type === 'expense' ? 'Pago agora' : 'Recebido agora'}</option><option value="pending">Pendente</option></select></Field>
              {form.status === 'pending' && <Field label="Vencimento"><input type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} /></Field>}
              {form.type === 'expense' && form.paymentMethod === 'credit_card' && (
                <>
                  <Field label="Cartão"><select value={form.cardId} onChange={(event) => setForm({ ...form, cardId: event.target.value })}><option value="">Selecione</option>{cards.map((card) => <option key={card.id} value={card.id}>{card.name} · disponível {money(card.limit - card.used)}</option>)}</select></Field>
                  <Field label="Quantidade de parcelas"><input type="number" min="1" max="48" value={form.installmentCount} onChange={(event) => setForm({ ...form, installmentCount: event.target.value })} /></Field>
                </>
              )}
              <Field label="Observações" wide><textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Informações opcionais sobre o lançamento" /></Field>
            </section>
          )}

          {form.type === 'expense' && form.paymentMethod === 'credit_card' && cards.length === 0 && (
            <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-200">Cadastre um cartão em Compromissos → Cartões antes de lançar uma compra no crédito.</div>
          )}

          <div className="mt-4 rounded-2xl border border-brand-primary/15 bg-brand-primary/5 p-3 text-xs text-white/55">
            <strong className="text-brand-primary">Efeito do lançamento:</strong> {preview}
          </div>

          <section className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
            <button type="button" onClick={() => setPendingOpen((value) => !value)} className="flex w-full items-center justify-between px-4 py-3 text-left">
              <span><strong className="flex items-center gap-2 text-sm"><Clock3 size={15} /> Pendências</strong><small className="mt-1 block text-[9px] uppercase text-white/30">{pending.length} lançamento(s) aguardando conclusão</small></span>
              <ChevronDown size={15} className={`transition ${pendingOpen ? 'rotate-180' : ''}`} />
            </button>
            {pendingOpen && (
              <div className="border-t border-white/10 p-3">
                {pending.length === 0 ? <div className="py-5 text-center text-xs text-white/30">Nenhuma pendência registrada.</div> : <div className="grid gap-2">{pending.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 p-3"><div className="min-w-0"><div className="truncate text-xs font-bold">{item.description}</div><div className="mt-1 text-[9px] text-white/35">{item.category} · {item.due_date ? `vence ${new Date(`${item.due_date}T12:00:00`).toLocaleDateString('pt-BR')}` : 'sem vencimento'}</div></div><div className="flex items-center gap-3"><strong className={item.type === 'income' ? 'text-green-400' : 'text-red-400'}>{money(Math.abs(item.amount))}</strong><button type="button" disabled={payingId === item.id} onClick={() => markPaid(item)} className="rounded-lg bg-brand-primary/15 px-3 py-2 text-[10px] font-bold text-brand-primary disabled:opacity-50">{payingId === item.id ? 'Atualizando...' : item.type === 'income' ? 'Receber' : 'Pagar'}</button></div></div>)}</div>}
              </div>
            )}
          </section>
        </div>

        <footer className="grid shrink-0 gap-2 border-t border-white/10 p-4 sm:grid-cols-[auto_1fr_1fr]">
          <button type="button" onClick={resetForAnother} className="flex items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-xs font-bold text-white/45"><RotateCcw size={14} /> Limpar</button>
          <button type="button" disabled={saving} onClick={() => save(true)} className="flex items-center justify-center gap-2 rounded-xl border border-brand-primary/30 bg-brand-primary/10 px-4 py-3 text-xs font-black text-brand-primary disabled:opacity-50"><Plus size={14} /> Salvar e lançar outro</button>
          <button type="button" disabled={saving} onClick={() => save(false)} className="flex items-center justify-center gap-2 rounded-xl bg-brand-primary px-4 py-3 text-xs font-black text-black disabled:opacity-50"><Save size={14} /> {saving ? 'Salvando...' : 'Salvar lançamento'}</button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, children, wide }: { label: string; children: React.ReactElement<any>; wide?: boolean }) {
  return <label className={wide ? 'block md:col-span-2' : 'block'}><span className="mb-1.5 block text-[9px] font-bold uppercase tracking-wider text-white/35">{label}</span>{React.cloneElement(children, { className: 'w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none transition focus:border-brand-primary/55' })}</label>;
}
