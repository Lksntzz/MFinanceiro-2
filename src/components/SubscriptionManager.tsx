import { Calendar, CreditCard, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';

import { useApp } from '../context/AppContext';
import { formatCurrency } from '../lib/formatters';
import { supabase } from '../lib/supabase';
import type { Subscription } from '../types';

export default function SubscriptionManager() {
  const { isPrivate } = useApp();
  const [userId, setUserId] = useState<string | null>(null);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [netIncome, setNetIncome] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [page, setPage] = useState(1);
  const [form, setForm] = useState({
    name: '',
    amount: '',
    due_day: '5',
    category: 'Entretenimento',
    billing_cycle: 'monthly' as 'monthly' | 'yearly',
  });

  const pageSize = 6;

  async function fetchSubscriptions() {
    setLoading(true);
    setError(null);
    try {
      const { data: authData, error: authError } =
        await supabase.auth.getUser();
      if (authError) throw authError;
      if (!authData.user) throw new Error('Sessão não encontrada.');
      setUserId(authData.user.id);

      const [subscriptionsResult, settingsResult] = await Promise.all([
        supabase
          .from('mf_subscriptions')
          .select('*')
          .eq('user_id', authData.user.id)
          .order('due_day', { ascending: true }),
        supabase
          .from('mf_user_settings')
          .select('net_salary_estimated')
          .eq('user_id', authData.user.id)
          .maybeSingle(),
      ]);

      if (subscriptionsResult.error) throw subscriptionsResult.error;
      if (settingsResult.error) throw settingsResult.error;

      setSubscriptions(
        (subscriptionsResult.data || []).map((item: any) => ({
          ...item,
          amount: Number(item.amount || 0),
          due_day: Number(item.due_day || 1),
        })) as Subscription[],
      );
      setNetIncome(Number(settingsResult.data?.net_salary_estimated || 0));
    } catch (fetchError: any) {
      console.error('Falha ao carregar assinaturas:', fetchError);
      setError(
        fetchError?.message || 'Não foi possível carregar as assinaturas.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchSubscriptions();
  }, [fetchSubscriptions]);

  const totalMonthly = useMemo(
    () =>
      subscriptions
        .filter((item) => item.status !== 'cancelled')
        .reduce(
          (sum, item) =>
            sum +
            (item.billing_cycle === 'yearly'
              ? Number(item.amount || 0) / 12
              : Number(item.amount || 0)),
          0,
        ),
    [subscriptions],
  );
  const annualProjection = totalMonthly * 12;
  const incomeShare = netIncome > 0 ? (totalMonthly / netIncome) * 100 : null;
  const pages = Math.max(1, Math.ceil(subscriptions.length / pageSize));
  const visible = subscriptions.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    if (!userId || saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const amount = Number(form.amount);
      const dueDay = Number(form.due_day);
      if (!form.name.trim()) throw new Error('Informe o nome da assinatura.');
      if (!Number.isFinite(amount) || amount <= 0)
        throw new Error('Informe um valor válido.');
      if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31)
        throw new Error('O dia de cobrança deve ficar entre 1 e 31.');

      const { error: insertError } = await supabase
        .from('mf_subscriptions')
        .insert({
          user_id: userId,
          name: form.name.trim(),
          amount,
          due_day: dueDay,
          category: form.category,
          billing_cycle: form.billing_cycle,
          status: 'active',
        });
      if (insertError) throw insertError;

      setShowModal(false);
      setForm({
        name: '',
        amount: '',
        due_day: '5',
        category: 'Entretenimento',
        billing_cycle: 'monthly',
      });
      setMessage('Assinatura adicionada.');
      await fetchSubscriptions();
    } catch (saveError: any) {
      setError(
        saveError?.message || 'Não foi possível adicionar a assinatura.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(item: Subscription) {
    if (!userId || !window.confirm(`Remover a assinatura “${item.name}”?`))
      return;
    setError(null);
    const { error: deleteError } = await supabase
      .from('mf_subscriptions')
      .delete()
      .eq('id', item.id)
      .eq('user_id', userId);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setMessage('Assinatura removida.');
    await fetchSubscriptions();
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-white/30">
        <RefreshCw className="mr-2 animate-spin" size={16} /> Carregando
        assinaturas...
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4 overflow-hidden animate-fade-in">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black">Gestão de assinaturas</h2>
          <p className="text-xs text-white/40">
            Controle de serviços recorrentes com valores reais.
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 rounded-xl bg-brand-secondary px-4 py-2 text-xs font-bold text-black"
        >
          <Plus size={15} /> Nova assinatura
        </button>
      </div>

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

      <section className="grid shrink-0 grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric label="Assinaturas" value={String(subscriptions.length)} />
        <Metric
          label="Compromisso mensal"
          value={formatCurrency(totalMonthly, isPrivate)}
        />
        <Metric
          label="Projeção anual"
          value={formatCurrency(annualProjection, isPrivate)}
        />
        <Metric
          label="Percentual da renda"
          value={
            incomeShare == null
              ? 'Renda não informada'
              : `${incomeShare.toFixed(1)}%`
          }
          danger={incomeShare != null && incomeShare > 15}
        />
      </section>

      <section className="flex-1 min-h-0 glass-card !p-4 flex flex-col overflow-hidden">
        {visible.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/10 text-center text-white/30">
            <RefreshCw size={28} />
            <p className="text-xs">Nenhuma assinatura cadastrada.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 content-start">
            {visible.map((item) => (
              <article
                key={item.id}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-secondary/10 text-brand-secondary">
                      <CreditCard size={20} />
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-bold">
                        {item.name}
                      </h3>
                      <p className="text-[9px] uppercase tracking-widest text-white/30">
                        {item.category}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(item)}
                    className="p-1 text-white/20 hover:text-red-400"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <div className="mt-5 flex items-end justify-between gap-3">
                  <div>
                    <div className="text-[9px] text-white/30">Valor</div>
                    <strong>
                      {formatCurrency(Number(item.amount || 0), isPrivate)}{' '}
                      <small className="text-white/30">
                        /{item.billing_cycle === 'monthly' ? 'mês' : 'ano'}
                      </small>
                    </strong>
                  </div>
                  <div className="text-right">
                    <div className="text-[9px] text-white/30">Cobrança</div>
                    <strong className="flex items-center gap-1 text-xs">
                      <Calendar size={12} /> dia {item.due_day}
                    </strong>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
        {pages > 1 && <Pager page={page} pages={pages} onChange={setPage} />}
      </section>

      {showModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleAdd}
            className="glass-card w-full max-w-lg !p-6"
          >
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold">Nova assinatura</h3>
                <p className="text-xs text-white/40">
                  Informe os dados reais da cobrança.
                </p>
              </div>
              <button type="button" onClick={() => setShowModal(false)}>
                <X size={19} />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Nome">
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field>
              <Field label="Valor">
                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </Field>
              <Field label="Dia de cobrança">
                <input
                  required
                  type="number"
                  min="1"
                  max="31"
                  value={form.due_day}
                  onChange={(e) =>
                    setForm({ ...form, due_day: e.target.value })
                  }
                />
              </Field>
              <Field label="Ciclo">
                <select
                  value={form.billing_cycle}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      billing_cycle: e.target.value as 'monthly' | 'yearly',
                    })
                  }
                >
                  <option value="monthly">Mensal</option>
                  <option value="yearly">Anual</option>
                </select>
              </Field>
              <Field label="Categoria">
                <select
                  value={form.category}
                  onChange={(e) =>
                    setForm({ ...form, category: e.target.value })
                  }
                >
                  <option>Entretenimento</option>
                  <option>Educação</option>
                  <option>Produtividade</option>
                  <option>Infraestrutura</option>
                  <option>Saúde</option>
                  <option>Lazer</option>
                </select>
              </Field>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-xl bg-white/5 px-5 py-3 text-sm font-bold"
              >
                Cancelar
              </button>
              <button
                disabled={saving}
                className="rounded-xl bg-brand-secondary px-5 py-3 text-sm font-bold text-black disabled:opacity-50"
              >
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </form>
        </div>
      )}
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
    <div className="glass-card !p-4 min-w-0">
      <div className="truncate text-[9px] font-bold uppercase tracking-widest text-white/35">
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
          'mt-1 w-full rounded-xl border border-white/10 bg-[#121212] px-3 py-2.5 text-sm text-white outline-none focus:border-brand-secondary',
      })}
    </label>
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
