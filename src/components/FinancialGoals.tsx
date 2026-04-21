import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Target, Plus, TrendingUp, CheckCircle2, Trophy, Clock, X, Trash2, Pencil } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatCurrency } from '../lib/formatters';
import { useApp } from '../context/AppContext';

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
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [form, setForm] = useState({
    name: '',
    target_amount: '',
    current_amount: '0',
    deadline: '',
    category: 'Longo Prazo'
  });

  useEffect(() => {
    fetchGoals();
  }, []);

  async function fetchGoals() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('mf_financial_goals')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) {
        if (error.code === 'PGRST204') {
          // Table doesn't exist yet, we'll handle gracefully
          setGoals([]);
        } else {
          throw error;
        }
      } else {
        setGoals(data || []);
      }
    } catch (err) {
      console.error('Error fetching goals:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveGoal(e: React.FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        name: form.name,
        target_amount: Number(form.target_amount),
        current_amount: Number(form.current_amount),
        deadline: form.deadline || null,
        category: form.category,
        status: Number(form.current_amount) >= Number(form.target_amount) ? 'completed' : 'active'
      };

      if (editingGoal) {
        await supabase.from('mf_financial_goals').update(payload).eq('id', editingGoal.id);
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from('mf_financial_goals').insert({ ...payload, user_id: user.id });
        }
      }

      setShowAddModal(false);
      setEditingGoal(null);
      setForm({ name: '', target_amount: '', current_amount: '0', deadline: '', category: 'Longo Prazo' });
      fetchGoals();
    } catch (err) {
      console.error('Error saving goal:', err);
    }
  }

  async function handleDeleteGoal(id: string) {
    if (!confirm('Deseja realmente excluir esta meta?')) return;
    try {
      await supabase.from('mf_financial_goals').delete().eq('id', id);
      fetchGoals();
    } catch (err) {
      console.error('Error deleting goal:', err);
    }
  }

  const totals = {
    totalTarget: goals.reduce((sum, g) => sum + g.target_amount, 0),
    totalCurrent: goals.reduce((sum, g) => sum + g.current_amount, 0),
    completed: goals.filter(g => g.status === 'completed').length,
    active: goals.filter(g => g.status === 'active').length
  };

  const overallProgress = totals.totalTarget > 0 ? (totals.totalCurrent / totals.totalTarget) * 100 : 0;

  return (
    <div className="flex-1 overflow-hidden flex flex-col gap-6 animate-fade-in">
      {/* Header Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 shrink-0">
        <div className="glass-card !p-4 border-brand-primary/20 bg-brand-primary/5">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-8 w-8 rounded-lg bg-brand-primary/10 flex items-center justify-center text-brand-primary">
              <Target size={18} />
            </div>
            <span className="text-[10px] uppercase font-bold text-white/40 tracking-widest">Total Objetivos</span>
          </div>
          <div className="text-xl font-bold">{formatCurrency(totals.totalTarget, isPrivate)}</div>
        </div>

        <div className="glass-card !p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-8 w-8 rounded-lg bg-green-500/10 flex items-center justify-center text-green-500">
              <TrendingUp size={18} />
            </div>
            <span className="text-[10px] uppercase font-bold text-white/40 tracking-widest">Já Poupado</span>
          </div>
          <div className="text-xl font-bold text-green-400">{formatCurrency(totals.totalCurrent, isPrivate)}</div>
        </div>

        <div className="glass-card !p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-8 w-8 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-500">
              <Trophy size={18} />
            </div>
            <span className="text-[10px] uppercase font-bold text-white/40 tracking-widest">Concluídas</span>
          </div>
          <div className="text-xl font-bold">{totals.completed} <span className="text-xs text-white/20">metas</span></div>
        </div>

        <div className="glass-card !p-4 flex flex-col justify-center">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase font-bold text-white/40 tracking-widest">Progresso Geral</span>
            <span className="text-xs font-bold text-brand-primary">{overallProgress.toFixed(1)}%</span>
          </div>
          <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${overallProgress}%` }}
              className="h-full bg-gradient-to-r from-brand-primary to-brand-secondary"
            />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-black tracking-tight flex items-center gap-2">
            Minhas Metas de Realização
            <span className="text-xs font-normal text-white/20 uppercase tracking-widest ml-2">({goals.length})</span>
          </h2>
          <button 
            onClick={() => { setEditingGoal(null); setShowAddModal(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-brand-primary text-black rounded-xl font-bold text-xs hover:opacity-90 transition-all active:scale-95"
          >
            <Plus size={16} /> Nova Meta
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pr-2 space-y-4 no-scrollbar">
          {loading ? (
            <div className="h-40 flex items-center justify-center text-white/20 uppercase font-bold tracking-widest animate-pulse">Carregando metas...</div>
          ) : goals.length === 0 ? (
            <div className="h-60 flex flex-col items-center justify-center border-2 border-dashed border-white/5 rounded-[32px] gap-4">
              <div className="h-16 w-16 rounded-full bg-white/5 flex items-center justify-center text-white/20">
                <Target size={32} />
              </div>
              <div className="text-center">
                <p className="text-white/40 font-bold uppercase text-[10px] tracking-widest">Você ainda não definiu metas</p>
                <p className="text-xs text-white/20 mt-1">Transforme seus sonhos em planos concretos.</p>
              </div>
              <button 
                onClick={() => setShowAddModal(true)}
                className="mt-2 text-brand-primary font-bold text-xs uppercase tracking-widest hover:underline"
              >
                Criar minha primeira meta
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {goals.map(goal => {
                const progress = (goal.current_amount / goal.target_amount) * 100;
                const isCompleted = goal.status === 'completed';
                
                return (
                  <motion.div 
                    layout
                    key={goal.id} 
                    className={`glass-card !p-6 border-white/5 relative group ${isCompleted ? 'border-green-500/20' : ''}`}
                  >
                    <div className="flex items-start justify-between mb-6">
                      <div className="flex gap-4">
                        <div className={`h-12 w-12 rounded-2xl flex items-center justify-center transition-all ${isCompleted ? 'bg-green-500/20 text-green-400' : 'bg-white/5 text-brand-primary group-hover:scale-110'}`}>
                          {isCompleted ? <CheckCircle2 size={24} /> : <Target size={24} />}
                        </div>
                        <div>
                          <h3 className="font-bold text-lg leading-none mb-1">{goal.name}</h3>
                          <span className="text-[10px] font-bold text-white/30 uppercase tracking-widest">{goal.category}</span>
                        </div>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => {
                            setEditingGoal(goal);
                            setForm({
                              name: goal.name,
                              target_amount: goal.target_amount.toString(),
                              current_amount: goal.current_amount.toString(),
                              deadline: goal.deadline || '',
                              category: goal.category
                            });
                            setShowAddModal(true);
                          }}
                          className="p-2 hover:bg-white/5 rounded-lg text-white/40 hover:text-white transition-all"
                        >
                          <Pencil size={14} />
                        </button>
                        <button 
                          onClick={() => handleDeleteGoal(goal.id)}
                          className="p-2 hover:bg-red-500/10 rounded-lg text-white/40 hover:text-red-400 transition-all"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex justify-between items-end">
                        <div className="flex flex-col">
                          <span className="text-[9px] uppercase font-bold text-white/30 tracking-widest leading-none mb-1">Acumulado</span>
                          <span className={`text-xl font-black ${isCompleted ? 'text-green-400' : 'text-white'}`}>{formatCurrency(goal.current_amount, isPrivate)}</span>
                        </div>
                        <div className="text-right flex flex-col">
                          <span className="text-[9px] uppercase font-bold text-white/30 tracking-widest leading-none mb-1">Objetivo</span>
                          <span className="text-xs font-bold text-white/60">{formatCurrency(goal.target_amount, isPrivate)}</span>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.min(100, progress)}%` }}
                            className={`h-full ${isCompleted ? 'bg-green-500' : 'bg-brand-primary'}`}
                          />
                        </div>
                        <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest">
                          <span className={isCompleted ? 'text-green-400' : 'text-brand-primary'}>{progress.toFixed(1)}% Completo</span>
                          {goal.deadline && (
                            <span className="text-white/20 flex items-center gap-1">
                              <Clock size={10} /> {new Date(goal.deadline).toLocaleDateString('pt-BR')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddModal(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md glass-card !p-8 border-brand-primary/20 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-brand-primary/10 flex items-center justify-center text-brand-primary">
                    <Target size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold text-xl">{editingGoal ? 'Editar Meta' : 'Nova Meta de Realização'}</h3>
                    <p className="text-[10px] text-white/40 uppercase font-black tracking-widest mt-0.5">Defina seu próximo objetivo</p>
                  </div>
                </div>
                <button onClick={() => setShowAddModal(false)} className="h-8 w-8 flex items-center justify-center hover:bg-white/5 rounded-full transition-all">
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveGoal} className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold uppercase text-white/40 tracking-widest ml-1 mb-1 block">Nome do Objetivo</label>
                  <input 
                    type="text" 
                    required
                    value={form.name}
                    onChange={e => setForm({...form, name: e.target.value})}
                    placeholder="Ex: Reserva de Emergência"
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 outline-none focus:border-brand-primary transition-all font-bold"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-bold uppercase text-white/40 tracking-widest ml-1 mb-1 block">Valor Alvo (R$)</label>
                    <input 
                      type="number" 
                      step="0.01"
                      required
                      value={form.target_amount}
                      onChange={e => setForm({...form, target_amount: e.target.value})}
                      className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 outline-none focus:border-brand-primary transition-all font-bold"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase text-white/40 tracking-widest ml-1 mb-1 block">Já Guardado (R$)</label>
                    <input 
                      type="number" 
                      step="0.01"
                      value={form.current_amount}
                      onChange={e => setForm({...form, current_amount: e.target.value})}
                      className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 outline-none focus:border-brand-primary transition-all font-bold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-bold uppercase text-white/40 tracking-widest ml-1 mb-1 block">Prazo (Opcional)</label>
                    <input 
                      type="date" 
                      value={form.deadline}
                      onChange={e => setForm({...form, deadline: e.target.value})}
                      className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 outline-none focus:border-brand-primary transition-all font-bold text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase text-white/40 tracking-widest ml-1 mb-1 block">Categoria</label>
                    <select
                      value={form.category}
                      onChange={e => setForm({...form, category: e.target.value})}
                      className="w-full bg-[#121212] border border-white/10 rounded-xl py-3.5 px-4 outline-none focus:border-brand-primary transition-all font-bold text-xs [&>option]:bg-[#121212]"
                    >
                      <option value="Curto Prazo">Curto Prazo</option>
                      <option value="Médio Prazo">Médio Prazo</option>
                      <option value="Longo Prazo">Longo Prazo</option>
                      <option value="Educação">Educação</option>
                      <option value="Lazer">Lazer</option>
                      <option value="Bens">Bens</option>
                    </select>
                  </div>
                </div>

                <div className="pt-6 border-t border-white/5 flex gap-3">
                  <button 
                    type="button" 
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 py-4 bg-white/5 hover:bg-white/10 rounded-2xl font-bold transition-all text-sm"
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit" 
                    className="flex-1 py-4 bg-brand-primary text-black rounded-2xl font-black transition-all hover:brightness-110 active:scale-95 text-sm shadow-[0_0_20px_rgba(0,242,255,0.2)]"
                  >
                    {editingGoal ? 'Salvar Alterações' : 'Criar Meta'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
