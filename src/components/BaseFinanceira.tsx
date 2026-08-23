import {
  Banknote,
  Calendar,
  LayoutGrid,
  Plus,
  Save,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';

import { CATEGORIES } from '../lib/constants';
import { formatCurrency } from '../lib/formatters';
import { calculatePayrollFromGross } from '../lib/payroll-tax';
import { supabase } from '../lib/supabase';
import type { FinanceSummary, FixedBill, UserSettings } from '../types';

interface BaseFinanceiraProps {
  settings: UserSettings;
  onSave: (settings: UserSettings) => Promise<void>;
  fixedBills: FixedBill[];
  summary: FinanceSummary | null;
  onToggleBillStatus: (id: string) => void;
  onRefresh: () => void;
  initialTab?: 'income' | 'adjustments' | 'bills' | 'budget';
}

type Tab = 'income' | 'adjustments' | 'bills' | 'budget';
type Modal = 'fixed' | 'budget' | null;

const money = (value: number) =>
  Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });

export default function BaseFinanceira({
  settings,
  onSave,
  fixedBills,
  summary,
  onToggleBillStatus,
  onRefresh,
  initialTab,
}: BaseFinanceiraProps) {
  const [activeTab, setActiveTab] = useState<Tab>(initialTab || 'income');
  const [form, setForm] = useState<UserSettings>(settings);
  const [extraDeductions, setExtraDeductions] = useState(0);
  const [budgets, setBudgets] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [page, setPage] = useState(1);
  const [fixedForm, setFixedForm] = useState({
    name: '',
    amount: '',
    due_day: '5',
    category: CATEGORIES[0] || 'Moradia',
  });
  const [budgetForm, setBudgetForm] = useState({
    category: CATEGORIES[1] || 'Alimentação',
    limit_amount: '',
  });

  useEffect(() => {
    setForm(settings);
    const payroll = calculatePayrollFromGross(
      Number(settings.gross_salary || 0),
      new Date(),
    );
    setExtraDeductions(
      Math.max(0, Number(settings.deductions || 0) - payroll.totalDeductions),
    );
  }, [settings]);

  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  async function fetchBudgets() {
    if (!settings.user_id) return;
    const { data, error: queryError } = await supabase
      .from('mf_budgets')
      .select('*')
      .eq('user_id', settings.user_id)
      .order('category');
    if (queryError) {
      setError(queryError.message);
      return;
    }
    setBudgets(data || []);
  }

  useEffect(() => {
    void fetchBudgets();
  }, [fetchBudgets]);

  const payroll = useMemo(
    () => calculatePayrollFromGross(Number(form.gross_salary || 0), new Date()),
    [form.gross_salary],
  );
  const totalDeductions =
    payroll.totalDeductions + Math.max(0, extraDeductions);
  const estimatedNet = Math.max(
    0,
    payroll.netSalary - Math.max(0, extraDeductions),
  );
  const realBase = estimatedNet + Math.max(0, Number(form.benefits || 0));
  const totalFixed = fixedBills.reduce(
    (sum, item) => sum + Number(item.amount || 0),
    0,
  );
  const pendingFixed = fixedBills
    .filter((item) => item.status !== 'paid')
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const totalBudget = budgets.reduce(
    (sum, item) => sum + Number(item.limit_amount || 0),
    0,
  );

  const availableTabs =
    initialTab === 'bills'
      ? ([
          ['bills', 'Contas fixas', Calendar],
          ['budget', 'Orçamentos', LayoutGrid],
        ] as const)
      : ([
          ['income', 'Renda e ciclo', Banknote],
          ['adjustments', 'Ajustes', Wallet],
        ] as const);

  const activeItems =
    activeTab === 'bills' ? fixedBills : activeTab === 'budget' ? budgets : [];
  const pageSize = activeTab === 'bills' ? 5 : 6;
  const pages = Math.max(1, Math.ceil(activeItems.length / pageSize));
  const visibleItems = activeItems.slice(
    (page - 1) * pageSize,
    page * pageSize,
  );

  useEffect(() => {
    setPage(1);
  }, []);
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);

  function change(field: keyof UserSettings, value: any) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function changeFirstPercentage(value: number) {
    const first = Math.max(0, Math.min(100, Math.round(value || 0)));
    setForm((current) => ({
      ...current,
      payday_1_percentage: first,
      payday_2_percentage: 100 - first,
    }));
  }

  function changeSecondPercentage(value: number) {
    const second = Math.max(0, Math.min(100, Math.round(value || 0)));
    setForm((current) => ({
      ...current,
      payday_1_percentage: 100 - second,
      payday_2_percentage: second,
    }));
  }

  async function saveSettings() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const payday1 = Number(form.payday_1 || 0);
      const payday2 = Number(form.payday_2 || 0);
      if (payday1 < 1 || payday1 > 31)
        throw new Error(
          'O dia principal de pagamento deve ficar entre 1 e 31.',
        );
      if (form.payday_cycle === 'biweekly' && (payday2 < 1 || payday2 > 31))
        throw new Error('O segundo dia de pagamento deve ficar entre 1 e 31.');

      await onSave({
        ...form,
        net_salary_estimated: estimatedNet,
        deductions: totalDeductions,
        payday_2: form.payday_cycle === 'biweekly' ? payday2 : undefined,
        payday_1_percentage:
          form.payday_cycle === 'biweekly'
            ? Number(form.payday_1_percentage ?? 50)
            : 100,
        payday_2_percentage:
          form.payday_cycle === 'biweekly'
            ? Number(form.payday_2_percentage ?? 50)
            : 0,
      });
      setMessage('Preferências atualizadas.');
    } catch (saveError: any) {
      setError(
        saveError?.message || 'Não foi possível salvar as preferências.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function addFixed(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const amount = Number(fixedForm.amount);
      const dueDay = Number(fixedForm.due_day);
      if (!fixedForm.name.trim()) throw new Error('Informe o nome da conta.');
      if (!Number.isFinite(amount) || amount <= 0)
        throw new Error('Informe um valor válido.');
      if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31)
        throw new Error('O vencimento deve ficar entre 1 e 31.');

      const { error: insertError } = await supabase
        .from('mf_fixed_bills')
        .insert({
          user_id: settings.user_id,
          name: fixedForm.name.trim(),
          amount,
          due_day: dueDay,
          category: fixedForm.category,
          status: 'pending',
        });
      if (insertError) throw insertError;
      setFixedForm({
        name: '',
        amount: '',
        due_day: '5',
        category: CATEGORIES[0] || 'Moradia',
      });
      setModal(null);
      setMessage('Conta fixa adicionada.');
      onRefresh();
    } catch (saveError: any) {
      setError(
        saveError?.message || 'Não foi possível adicionar a conta fixa.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function addBudget(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const limit = Number(budgetForm.limit_amount);
      if (!Number.isFinite(limit) || limit <= 0)
        throw new Error('Informe um limite válido.');
      const { error: upsertError } = await supabase.from('mf_budgets').upsert(
        {
          user_id: settings.user_id,
          category: budgetForm.category,
          limit_amount: limit,
        },
        { onConflict: 'user_id,category' },
      );
      if (upsertError) throw upsertError;
      setBudgetForm({ ...budgetForm, limit_amount: '' });
      setModal(null);
      setMessage('Orçamento atualizado.');
      await fetchBudgets();
    } catch (saveError: any) {
      setError(saveError?.message || 'Não foi possível salvar o orçamento.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(table: 'mf_fixed_bills' | 'mf_budgets', id: string) {
    setError(null);
    const { error: deleteError } = await supabase
      .from(table)
      .delete()
      .eq('id', id)
      .eq('user_id', settings.user_id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    if (table === 'mf_budgets') await fetchBudgets();
    else onRefresh();
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4 overflow-hidden animate-fade-in text-white">
      <nav className="flex shrink-0 items-center gap-2">
        {availableTabs.map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold ${activeTab === id ? 'bg-brand-primary text-black' : 'bg-white/5 text-white/50'}`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </nav>

      {error && (
        <div className="shrink-0 flex items-center rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-xs text-red-400">
          {error}
          <button onClick={() => setError(null)} className="ml-auto">
            <X size={14} />
          </button>
        </div>
      )}
      {message && (
        <div className="shrink-0 rounded-xl border border-green-500/20 bg-green-500/10 px-4 py-2 text-xs text-green-400">
          {message}
        </div>
      )}

      {activeTab === 'income' && (
        <section className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-12 gap-4 overflow-hidden">
          <div className="xl:col-span-7 glass-card !p-5 grid content-start grid-cols-2 gap-4">
            <Field label="Salário bruto">
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.gross_salary || 0}
                onChange={(e) =>
                  change('gross_salary', Number(e.target.value || 0))
                }
              />
            </Field>
            <ReadOnly label="Líquido estimado" value={money(estimatedNet)} />
            <Field label="Ciclo">
              <select
                value={form.payday_cycle || 'monthly'}
                onChange={(e) => change('payday_cycle', e.target.value)}
              >
                <option value="monthly">Mensal</option>
                <option value="biweekly">Quinzenal</option>
              </select>
            </Field>
            <Field label="Primeiro pagamento">
              <input
                type="number"
                min="1"
                max="31"
                value={form.payday_1 || ''}
                onChange={(e) => change('payday_1', Number(e.target.value))}
              />
            </Field>
            {form.payday_cycle === 'biweekly' && (
              <>
                <Field label="Percentual 1">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={form.payday_1_percentage ?? 50}
                    onChange={(e) =>
                      changeFirstPercentage(Number(e.target.value))
                    }
                  />
                </Field>
                <Field label="Segundo pagamento">
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={form.payday_2 || ''}
                    onChange={(e) => change('payday_2', Number(e.target.value))}
                  />
                </Field>
                <Field label="Percentual 2">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={form.payday_2_percentage ?? 50}
                    onChange={(e) =>
                      changeSecondPercentage(Number(e.target.value))
                    }
                  />
                </Field>
              </>
            )}
          </div>
          <aside className="xl:col-span-5 glass-card !p-5 flex flex-col gap-3">
            <h3 className="text-sm font-bold">Resumo salarial estimado</h3>
            <Row
              label="INSS e IRRF estimados"
              value={money(payroll.totalDeductions)}
            />
            <Row label="Descontos adicionais" value={money(extraDeductions)} />
            <Row label="Benefícios" value={money(Number(form.benefits || 0))} />
            <Row label="Base real estimada" value={money(realBase)} highlight />
            <button
              onClick={saveSettings}
              disabled={saving}
              className="mt-auto flex items-center justify-center gap-2 rounded-xl bg-brand-primary py-3 text-sm font-bold text-black disabled:opacity-50"
            >
              <Save size={16} /> {saving ? 'Salvando...' : 'Aplicar mudanças'}
            </button>
          </aside>
        </section>
      )}

      {activeTab === 'adjustments' && (
        <section className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-4 overflow-hidden">
          <div className="glass-card !p-5 grid content-start grid-cols-1 gap-4">
            <h3 className="text-sm font-bold">Ajustes de renda</h3>
            <Field label="Benefícios mensais">
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.benefits || 0}
                onChange={(e) =>
                  change('benefits', Number(e.target.value || 0))
                }
              />
            </Field>
            <Field label="Descontos adicionais">
              <input
                type="number"
                min="0"
                step="0.01"
                value={extraDeductions}
                onChange={(e) =>
                  setExtraDeductions(Number(e.target.value || 0))
                }
              />
            </Field>
            <button
              onClick={saveSettings}
              disabled={saving}
              className="flex items-center justify-center gap-2 rounded-xl bg-brand-primary py-3 text-sm font-bold text-black disabled:opacity-50"
            >
              <Save size={16} /> Salvar ajustes
            </button>
          </div>
          <div className="glass-card !p-5 flex flex-col gap-3">
            <h3 className="text-sm font-bold">Impacto estimado</h3>
            <Row label="Líquido após descontos" value={money(estimatedNet)} />
            <Row
              label="Benefícios adicionados"
              value={money(Number(form.benefits || 0))}
            />
            <Row label="Base real" value={money(realBase)} highlight />
            <p className="mt-auto text-[10px] text-white/35">
              Os cálculos tributários são estimativas e podem diferir da folha
              oficial.
            </p>
          </div>
        </section>
      )}

      {(activeTab === 'bills' || activeTab === 'budget') && (
        <section className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
          <div className="grid shrink-0 grid-cols-1 sm:grid-cols-3 gap-3">
            <Metric label="Contas fixas" value={money(totalFixed)} />
            <Metric
              label="Pendentes"
              value={money(pendingFixed)}
              danger={pendingFixed > Number(form.current_balance || 0)}
            />
            <Metric label="Orçamentos" value={money(totalBudget)} />
          </div>
          <div className="glass-card !p-4 flex flex-1 min-h-0 flex-col overflow-hidden">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold">
                  {activeTab === 'bills'
                    ? 'Contas fixas'
                    : 'Limites por categoria'}
                </h3>
                <p className="text-[9px] uppercase text-white/30">
                  {activeItems.length} registro(s)
                </p>
              </div>
              <button
                onClick={() =>
                  setModal(activeTab === 'bills' ? 'fixed' : 'budget')
                }
                className="flex items-center gap-2 rounded-xl bg-brand-primary px-3 py-2 text-xs font-bold text-black"
              >
                <Plus size={14} /> Adicionar
              </button>
            </div>
            {visibleItems.length === 0 ? (
              <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-white/10 text-xs text-white/30">
                Nenhum registro cadastrado.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 content-start">
                {visibleItems.map((item: any) =>
                  activeTab === 'bills' ? (
                    <BillCard
                      key={item.id}
                      item={item}
                      onToggle={onToggleBillStatus}
                      onDelete={() => remove('mf_fixed_bills', item.id)}
                    />
                  ) : (
                    <BudgetCard
                      key={item.id}
                      item={item}
                      onDelete={() => remove('mf_budgets', item.id)}
                    />
                  ),
                )}
              </div>
            )}
            {pages > 1 && (
              <Pager page={page} pages={pages} onChange={setPage} />
            )}
          </div>
          {summary && (
            <div className="shrink-0 text-[10px] text-white/30">
              Limite diário atual:{' '}
              {formatCurrency(Number(summary.dailyLimit || 0), false)} • Saldo:{' '}
              {formatCurrency(Number(form.current_balance || 0), false)}
            </div>
          )}
        </section>
      )}

      {modal === 'fixed' && (
        <Modal title="Nova conta fixa" onClose={() => setModal(null)}>
          <form onSubmit={addFixed} className="grid grid-cols-2 gap-4">
            <Field label="Nome">
              <input
                required
                value={fixedForm.name}
                onChange={(e) =>
                  setFixedForm({ ...fixedForm, name: e.target.value })
                }
              />
            </Field>
            <Field label="Valor">
              <input
                required
                type="number"
                min="0.01"
                step="0.01"
                value={fixedForm.amount}
                onChange={(e) =>
                  setFixedForm({ ...fixedForm, amount: e.target.value })
                }
              />
            </Field>
            <Field label="Vencimento">
              <input
                required
                type="number"
                min="1"
                max="31"
                value={fixedForm.due_day}
                onChange={(e) =>
                  setFixedForm({ ...fixedForm, due_day: e.target.value })
                }
              />
            </Field>
            <Field label="Categoria">
              <select
                value={fixedForm.category}
                onChange={(e) =>
                  setFixedForm({ ...fixedForm, category: e.target.value })
                }
              >
                {CATEGORIES.map((category) => (
                  <option key={category}>{category}</option>
                ))}
              </select>
            </Field>
            <Submit saving={saving} />
          </form>
        </Modal>
      )}
      {modal === 'budget' && (
        <Modal title="Limite por categoria" onClose={() => setModal(null)}>
          <form onSubmit={addBudget} className="grid grid-cols-2 gap-4">
            <Field label="Categoria">
              <select
                value={budgetForm.category}
                onChange={(e) =>
                  setBudgetForm({ ...budgetForm, category: e.target.value })
                }
              >
                {CATEGORIES.map((category) => (
                  <option key={category}>{category}</option>
                ))}
              </select>
            </Field>
            <Field label="Limite">
              <input
                required
                type="number"
                min="0.01"
                step="0.01"
                value={budgetForm.limit_amount}
                onChange={(e) =>
                  setBudgetForm({ ...budgetForm, limit_amount: e.target.value })
                }
              />
            </Field>
            <Submit saving={saving} />
          </form>
        </Modal>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactElement<any>;
}) {
  return (
    <label className="text-[10px] font-bold uppercase tracking-widest text-white/40">
      {label}
      {React.cloneElement(children, {
        className:
          'mt-1 w-full rounded-xl border border-white/10 bg-[#121212] px-3 py-2.5 text-sm text-white outline-none focus:border-brand-primary',
      })}
    </label>
  );
}
function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-widest text-white/40">
        {label}
      </div>
      <div className="mt-1 rounded-xl border border-brand-primary/20 bg-brand-primary/5 px-3 py-2.5 font-bold text-brand-primary">
        {value}
      </div>
    </div>
  );
}
function Row({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b border-white/5 pb-2 text-xs">
      <span className="text-white/40">{label}</span>
      <strong className={highlight ? 'text-brand-primary' : ''}>{value}</strong>
    </div>
  );
}
function Metric({
  label,
  value,
  danger,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="glass-card !p-3">
      <div className="text-[9px] font-bold uppercase text-white/35">
        {label}
      </div>
      <div
        className={`mt-1 truncate text-sm font-black ${danger ? 'text-red-400' : ''}`}
      >
        {value}
      </div>
    </div>
  );
}
function BillCard({
  item,
  onToggle,
  onDelete,
}: {
  item: any;
  onToggle: (id: string) => void;
  onDelete: () => void;
}) {
  const paid = item.status === 'paid';
  return (
    <article className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex justify-between gap-2">
        <div className="min-w-0">
          <h4
            className={`truncate text-xs font-bold ${paid ? 'line-through text-white/30' : ''}`}
          >
            {item.name}
          </h4>
          <p className="text-[9px] text-white/30">
            {item.category || 'Conta'} • dia {item.due_day}
          </p>
        </div>
        <button onClick={onDelete} className="text-white/20 hover:text-red-400">
          <Trash2 size={13} />
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <strong>{money(item.amount)}</strong>
        <button
          onClick={() => onToggle(item.id)}
          className={`rounded-lg px-2 py-1 text-[9px] font-bold ${paid ? 'bg-green-500/10 text-green-400' : 'bg-yellow-500/10 text-yellow-400'}`}
        >
          {paid ? 'Pago' : 'Marcar pago'}
        </button>
      </div>
    </article>
  );
}
function BudgetCard({ item, onDelete }: { item: any; onDelete: () => void }) {
  return (
    <article className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex justify-between">
        <div>
          <h4 className="text-xs font-bold">{item.category}</h4>
          <p className="text-[9px] text-white/30">Limite mensal</p>
        </div>
        <button onClick={onDelete} className="text-white/20 hover:text-red-400">
          <Trash2 size={13} />
        </button>
      </div>
      <strong className="mt-2 block text-brand-primary">
        {money(item.limit_amount)}
      </strong>
    </article>
  );
}
function Pager({
  page,
  pages,
  onChange,
}: {
  page: number;
  pages: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className="mt-auto flex items-center justify-center gap-3 pt-3 text-[10px]">
      <button
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page === 1}
        className="rounded-lg bg-white/5 px-3 py-1.5 disabled:opacity-30"
      >
        Anterior
      </button>
      <span className="text-white/40">
        {page} de {pages}
      </span>
      <button
        onClick={() => onChange(Math.min(pages, page + 1))}
        disabled={page === pages}
        className="rounded-lg bg-white/5 px-3 py-1.5 disabled:opacity-30"
      >
        Próxima
      </button>
    </div>
  );
}
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="glass-card w-full max-w-lg !p-6">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-lg font-bold">{title}</h3>
          <button onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Submit({ saving }: { saving: boolean }) {
  return (
    <button
      disabled={saving}
      className="col-span-2 rounded-xl bg-brand-primary py-3 text-sm font-bold text-black disabled:opacity-50"
    >
      {saving ? 'Salvando...' : 'Salvar'}
    </button>
  );
}
