import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock, Pencil, Plus, Target, Trash2, TrendingUp, Trophy, X } from 'lucide-react';

import { useApp } from '../context/AppContext';
import { formatCurrency } from '../lib/formatters';
import { supabase } from '../lib/supabase';

interface Goal {
  id: string;
  user_id: string;
  name: string;
  target_amount: number;
  current_amount: number;
  deadline: string | null;
  category: string;
  status: 'active' | 'completed';
  created_at: string;
}

export default function FinancialGoals() {
  const { isPrivate } = useApp();
  const [userId, setUserId] = useState<string | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [page, setPage] = useState(1);
  const [form, setForm] = useState({
    name: '', target_amount: '', current_amount: '0', deadline: '', category: 'Longo Prazo',
  });

  const pageSize = 4;

  async function fetchGoals() {
    setLoading(true);
    setError(null);
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!authData.user) throw new Error('Sessão não encontrada.');
      setUserId(authData.user.id);

      const { data, error: queryError } = await supabase
        .from('mf_financial_goals')
        .select('*')
        .eq('user_id', authData.user.id)
        .order('created_at', { ascending: false });
      if (queryError) throw queryError;

      setGoals((data || []).map((goal: any) => ({
        ...goal,
        target_amount: Number(goal.target_amount || 0),
        current_amount: Number(goal.current_amount || 0),
      })) as Goal[]);
    } catch (fetchError: any) {
      console.error('Falha ao carregar metas:', fetchError);
      setError(fetchError?.message || 'Não foi possível carregar as metas.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void fetchGoals(); }, []);

  const totals = useMemo(() => {
    const target = goals.reduce((sum, goal) => sum + goal.target_amount, 0);
    const current = goals.reduce((sum, goal) => sum + goal.current_amount, 0);
    return {
      target,
      current,
      completed: goals.filter((goal) => goal.status === 'completed').length,
      active: goals.filter((goal) => goal.status === 'active').length,
      progress: target > 0 ? Math.min(100, (current / target) * 100) : 0,
    };
  }, [goals]);

  const pages = Math.max(1, Math.ceil(goals.length / pageSize));
  const visible = goals.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);

  function openCreate() {
    setEditingGoal(null);
    setForm({ name: '', target_amount: '', current_amount: '0', deadline: '', category: 'Longo Prazo' });
    setShowModal(true);
  }

  function openEdit(goal: Goal) {
    setEditingGoal(goal);
    setForm({
      name: goal.name,
      target_amount: String(goal.target_amount),
      current_amount: String(goal.current_amount),
      deadline: goal.deadline || '',
      category: goal.category,
    });
    setShowModal(true);
  }

  async function saveGoal(event: React.FormEvent) {
    event.preventDefault();
    if (!userId || saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const target = Number(form.target_amount);
      const current = Number(form.current_amount);
      if (!form.name.trim()) throw new Error('Informe o nome da meta.');
      if (!Number.isFinite(target) || target <= 0) throw new Error('O valor da meta deve ser maior que zero.');
      if (!Number.isFinite(current) || current < 0) throw new Error('O valor guardado não pode ser negativo.');

      const payload = {
        user_id: userId,
        name: form.name.trim(),
        target_amount: target,
        current_amount: current,
        deadline: form.deadline || null,
        category: form.category,
        status: current >= target ? 'completed' : 'active',
      };

      const result = editingGoal
        ? await supabase
            .from('mf_financial_goals')
            .update(payload)
            .eq('id', editingGoal.id)
            .eq('user_id', userId)
        : await supabase.from('mf_financial_goals').insert(payload);
      if (result.error) throw result.error;

      setShowModal(false);
      setEditingGoal(null);
      setMessage(editingGoal ? 'Meta atualizada.' : 'Meta criada.');
      await fetchGoals();
    } catch (saveError: any) {
      setError(saveError?.message || 'Não foi possível salvar a meta.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteGoal(goal: Goal) {
    if (!userId || !window.confirm(`Excluir a meta “${goal.name}”?`)) return;
    setError(null);
    const { error: deleteError } = await supabase
      .from('mf_financial_goals')
      .delete()
      .eq('id', goal.id)
      .eq('user_id', userId);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setMessage('Meta excluída.');
    await fetchGoals();
  }

  if (loading) return <div className="flex flex-1 items-center justify-center text-xs text-white/30">Carregando metas...</div>;

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4 overflow-hidden animate-fade-in">
      <section className="grid shrink-0 grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric label="Objetivos" value={formatCurrency(totals.target, isPrivate)} icon={Target} />
        <Metric label="Já guardado" value={formatCurrency(totals.current, isPrivate)} icon={TrendingUp} positive />
        <Metric label="Concluídas" value={`${totals.completed} meta(s)`} icon={Trophy} />
        <div className="glass-card !p-4"><div className="flex items-center justify-between"><span className="text-[9px] font-bold uppercase tracking-widest text-white/35">Progresso geral</span><strong className="text-xs text-brand-primary">{totals.progress.toFixed(1)}%</strong></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-white/5"><div className="h-full bg-brand-primary" style={{ width: `${totals.progress}%` }} /></div></div>
      </section>

      <div className="flex shrink-0 items-center justify-between gap-3"><div><h2 className="text-xl font-black">Metas financeiras</h2><p className="text-xs text-white/40">{totals.active} ativa(s), {totals.completed} concluída(s).</p></div><button onClick={openCreate} className="flex items-center gap-2 rounded-xl bg-brand-primary px-4 py-2 text-xs font-bold text-black"><Plus size={15} /> Nova meta</button></div>

      {error && <div className="shrink-0 flex items-center rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-xs text-red-400">{error}<button onClick={() => setError(null)} className="ml-auto"><X size={14} /></button></div>}
      {message && <div className="shrink-0 rounded-xl border border-green-500/20 bg-green-500/10 px-4 py-2 text-xs text-green-400">{message}</div>}

      <section className="flex-1 min-h-0 glass-card !p-4 flex flex-col overflow-hidden">
        {visible.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/10 text-center text-white/30"><Target size={30} /><p className="text-xs">Nenhuma meta cadastrada.</p></div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 content-start">
            {visible.map((goal) => {
              const progress = goal.target_amount > 0 ? Math.min(100, (goal.current_amount / goal.target_amount) * 100) : 0;
              const complete = goal.status === 'completed';
              return (
                <article key={goal.id} className={`rounded-2xl border p-4 ${complete ? 'border-green-500/20 bg-green-500/5' : 'border-white/10 bg-white/[0.03]'}`}>
                  <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 gap-3"><div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${complete ? 'bg-green-500/15 text-green-400' : 'bg-brand-primary/10 text-brand-primary'}`}>{complete ? <CheckCircle2 size={20} /> : <Target size={20} />}</div><div className="min-w-0"><h3 className="truncate text-sm font-bold">{goal.name}</h3><p className="text-[9px] uppercase tracking-widest text-white/30">{goal.category}</p></div></div><div className="flex gap-1"><button onClick={() => openEdit(goal)} className="p-1 text-white/30 hover:text-white"><Pencil size={14} /></button><button onClick={() => deleteGoal(goal)} className="p-1 text-white/30 hover:text-red-400"><Trash2 size={14} /></button></div></div>
                  <div className="mt-4 flex items-end justify-between gap-3"><div><div className="text-[9px] text-white/30">Guardado</div><strong className={complete ? 'text-green-400' : ''}>{formatCurrency(goal.current_amount, isPrivate)}</strong></div><div className="text-right"><div className="text-[9px] text-white/30">Objetivo</div><strong className="text-xs text-white/60">{formatCurrency(goal.target_amount, isPrivate)}</strong></div></div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/5"><div className={complete ? 'h-full bg-green-500' : 'h-full bg-brand-primary'} style={{ width: `${progress}%` }} /></div>
                  <div className="mt-1 flex justify-between text-[9px] text-white/30"><span>{progress.toFixed(1)}%</span>{goal.deadline && <span className="flex items-center gap-1"><Clock size={10} /> {new Date(`${goal.deadline}T12:00:00`).toLocaleDateString('pt-BR')}</span>}</div>
                </article>
              );
            })}
          </div>
        )}
        {pages > 1 && <Pager page={page} pages={pages} onChange={setPage} />}
      </section>

      {showModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <form onSubmit={saveGoal} className="glass-card w-full max-w-lg !p-6">
            <div className="mb-5 flex items-center justify-between"><div><h3 className="text-xl font-bold">{editingGoal ? 'Editar meta' : 'Nova meta'}</h3><p className="text-xs text-white/40">Defina um objetivo mensurável.</p></div><button type="button" onClick={() => setShowModal(false)}><X size={19} /></button></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4"><Field label="Nome"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><Field label="Valor alvo"><input required type="number" min="0.01" step="0.01" value={form.target_amount} onChange={(e) => setForm({ ...form, target_amount: e.target.value })} /></Field><Field label="Já guardado"><input type="number" min="0" step="0.01" value={form.current_amount} onChange={(e) => setForm({ ...form, current_amount: e.target.value })} /></Field><Field label="Prazo"><input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></Field><Field label="Categoria"><select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}><option>Curto Prazo</option><option>Médio Prazo</option><option>Longo Prazo</option><option>Reserva de Emergência</option><option>Compra</option><option>Viagem</option></select></Field></div>
            <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setShowModal(false)} className="rounded-xl bg-white/5 px-5 py-3 text-sm font-bold">Cancelar</button><button disabled={saving} className="rounded-xl bg-brand-primary px-5 py-3 text-sm font-bold text-black disabled:opacity-50">{saving ? 'Salvando...' : 'Salvar'}</button></div>
          </form>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, icon: Icon, positive }: { label: string; value: string; icon: React.ComponentType<{ size?: number }>; positive?: boolean }) { return <div className="glass-card !p-4"><div className="flex items-center justify-between text-white/35"><span className="text-[9px] font-bold uppercase tracking-widest">{label}</span><Icon size={15} /></div><div className={`mt-2 truncate text-sm font-black ${positive ? 'text-green-400' : ''}`}>{value}</div></div>; }
function Field({ label, children }: { label: string; children: React.ReactElement<any> }) { return <label className="text-[10px] font-bold uppercase tracking-widest text-white/40">{label}{React.cloneElement(children, { className: 'mt-1 w-full rounded-xl border border-white/10 bg-[#121212] px-3 py-2.5 text-sm text-white outline-none focus:border-brand-primary' })}</label>; }
function Pager({ page, pages, onChange }: { page: number; pages: number; onChange: (page: number) => void }) { return <div className="mt-auto flex items-center justify-center gap-3 pt-3 text-[10px]"><button onClick={() => onChange(Math.max(1, page - 1))} disabled={page === 1} className="rounded-lg bg-white/5 px-3 py-1.5 disabled:opacity-30">Anterior</button><span className="text-white/40">{page} de {pages}</span><button onClick={() => onChange(Math.min(pages, page + 1))} disabled={page === pages} className="rounded-lg bg-white/5 px-3 py-1.5 disabled:opacity-30">Próxima</button></div>; }
