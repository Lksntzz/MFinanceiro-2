import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { PlayCircle, Plus, Trash2, Calendar, CreditCard, RefreshCw, X, TrendingUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Subscription } from '../types';
import { formatCurrency } from '../lib/formatters';
import { useApp } from '../context/AppContext';

export default function SubscriptionManager() {
  const { isPrivate } = useApp();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState({
    name: '',
    amount: '',
    due_day: '5',
    category: 'Entretenimento',
    billing_cycle: 'monthly' as 'monthly' | 'yearly'
  });

  useEffect(() => {
    fetchSubscriptions();
  }, []);

  async function fetchSubscriptions() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('mf_subscriptions')
        .select('*')
        .order('due_day', { ascending: true });
      
      if (!error) setSubscriptions(data || []);
    } catch (err) {
      console.error('Error fetching subscriptions:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase.from('mf_subscriptions').insert({
        user_id: user.id,
        name: form.name,
        amount: Number(form.amount),
        due_day: Number(form.due_day),
        category: form.category,
        billing_cycle: form.billing_cycle,
        status: 'active'
      });

      if (error) throw error;
      setShowAddModal(false);
      setForm({ name: '', amount: '', due_day: '5', category: 'Entretenimento', billing_cycle: 'monthly' });
      fetchSubscriptions();
    } catch (err) {
      console.error('Error adding subscription:', err);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Deseja remover esta assinatura?')) return;
    try {
      await supabase.from('mf_subscriptions').delete().eq('id', id);
      fetchSubscriptions();
    } catch (err) {
      console.error('Error deleting subscription:', err);
    }
  }

  const totalMonthly = subscriptions.reduce((sum, s) => {
    return sum + (s.billing_cycle === 'yearly' ? s.amount / 12 : s.amount);
  }, 0);

  return (
    <div className="flex-1 flex flex-col gap-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black tracking-tight flex items-center gap-2">
            <PlayCircle className="text-brand-secondary" size={24} /> 
            Gestão de Assinaturas
          </h2>
          <p className="text-xs text-white/40 mt-1">Controle seus serviços recorrentes e evite gastos desnecessários.</p>
        </div>
        <button 
          onClick={() => setShowAddModal(true)}
          className="bg-brand-secondary text-black px-4 py-2 rounded-xl text-xs font-bold hover:brightness-110 flex items-center gap-2 shadow-lg transition-all"
        >
          <Plus size={16} /> Nova Assinatura
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="col-span-2 space-y-4">
          {loading ? (
            <div className="h-40 flex items-center justify-center text-white/20 uppercase font-black tracking-widest animate-pulse">Carregando serviços...</div>
          ) : subscriptions.length === 0 ? (
            <div className="h-60 border-2 border-dashed border-white/5 rounded-[32px] flex flex-col items-center justify-center gap-4 text-center p-8">
              <div className="h-12 w-12 rounded-full bg-white/5 flex items-center justify-center text-white/20">
                <RefreshCw size={24} />
              </div>
              <div>
                <p className="text-sm font-bold opacity-60">Nenhuma assinatura detectada</p>
                <p className="text-xs text-white/20 mt-1">Adicione serviços como Netflix, Spotify ou Academias.</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {subscriptions.map(sub => (
                <motion.div 
                  layout
                  key={sub.id} 
                  className="glass-card !p-5 group hover:border-brand-secondary/30 transition-all border border-white/5"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex gap-4">
                      <div className="h-12 w-12 rounded-2xl bg-white/5 flex items-center justify-center text-brand-secondary group-hover:scale-110 transition-transform">
                        <CreditCard size={24} />
                      </div>
                      <div>
                        <h3 className="font-bold text-sm tracking-tight">{sub.name}</h3>
                        <p className="text-[10px] uppercase font-black tracking-widest text-white/20 mt-1">{sub.category}</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => handleDelete(sub.id)}
                      className="p-2 text-white/10 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>

                  <div className="mt-6 flex items-end justify-between">
                    <div>
                      <span className="text-[10px] font-bold text-white/20 block">Valor</span>
                      <span className="text-lg font-black">{formatCurrency(sub.amount, isPrivate)} <span className="text-[10px] text-white/20 font-normal">/{sub.billing_cycle === 'monthly' ? 'mês' : 'ano'}</span></span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] font-bold text-white/20 block">Vence dia</span>
                      <span className="text-sm font-bold flex items-center gap-1 justify-end">
                        <Calendar size={12} className="text-brand-secondary" /> {sub.due_day}
                      </span>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="glass-card !p-6 border-brand-secondary/20 bg-brand-secondary/5">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-10 w-10 rounded-xl bg-brand-secondary/10 flex items-center justify-center text-brand-secondary">
                <TrendingUp size={20} />
              </div>
              <h3 className="text-xs font-black uppercase tracking-widest">Resumo Mensal</h3>
            </div>
            <div className="space-y-4">
              <div>
                <span className="text-[10px] text-white/40 uppercase font-bold tracking-widest">Comprometimento</span>
                <div className="text-3xl font-black text-brand-secondary mt-1">{formatCurrency(totalMonthly, isPrivate)}</div>
                <p className="text-[10px] text-white/20 mt-1">Representa {( (totalMonthly / 5000) * 100 ).toFixed(1)}% da sua renda básica (simulação)</p>
              </div>
              <div className="pt-4 border-t border-white/5">
                <span className="text-[10px] text-white/40 uppercase font-bold tracking-widest">Projeção Anual</span>
                <div className="text-xl font-bold mt-1 text-white/60">{formatCurrency(totalMonthly * 12, isPrivate)}</div>
              </div>
            </div>
          </div>

          <div className="glass-card !p-5 bg-white/5 border-white/10 italic text-[10px] text-white/40 leading-relaxed">
            "A economia de pequenas assinaturas não utilizadas pode representar até 15% do seu potencial de investimento anual. Revise sempre!"
          </div>
        </div>
      </div>

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
              className="relative w-full max-w-md glass-card !p-8 border-brand-secondary/20 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-8">
                <h3 className="font-bold text-xl">Assinar Serviço</h3>
                <button onClick={() => setShowAddModal(false)} className="h-8 w-8 flex items-center justify-center hover:bg-white/5 rounded-full transition-all">
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleAdd} className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold uppercase text-white/40 tracking-widest ml-1 mb-1 block">Nome do Serviço</label>
                  <input 
                    type="text" 
                    required
                    value={form.name}
                    onChange={e => setForm({...form, name: e.target.value})}
                    placeholder="Ex: Netflix, Spotify, AWS"
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 outline-none focus:border-brand-secondary transition-all font-bold"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-bold uppercase text-white/40 tracking-widest ml-1 mb-1 block">Valor Recorrente</label>
                    <input 
                      type="number" 
                      step="0.01"
                      required
                      value={form.amount}
                      onChange={e => setForm({...form, amount: e.target.value})}
                      className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 outline-none focus:border-brand-secondary transition-all font-bold"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase text-white/40 tracking-widest ml-1 mb-1 block">Dia de Cobrança</label>
                    <input 
                      type="number" 
                      min="1" max="31"
                      required
                      value={form.due_day}
                      onChange={e => setForm({...form, due_day: e.target.value})}
                      className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 outline-none focus:border-brand-secondary transition-all font-bold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-bold uppercase text-white/40 tracking-widest ml-1 mb-1 block">Ciclo</label>
                    <select
                      value={form.billing_cycle}
                      onChange={e => setForm({...form, billing_cycle: e.target.value as any})}
                      className="w-full bg-[#121212] border border-white/10 rounded-xl py-3.5 px-4 outline-none focus:border-brand-secondary transition-all font-bold text-xs [&>option]:bg-[#121212]"
                    >
                      <option value="monthly">Mensal</option>
                      <option value="yearly">Anual</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase text-white/40 tracking-widest ml-1 mb-1 block">Categoria</label>
                    <select
                      value={form.category}
                      onChange={e => setForm({...form, category: e.target.value})}
                      className="w-full bg-[#121212] border border-white/10 rounded-xl py-3.5 px-4 outline-none focus:border-brand-secondary transition-all font-bold text-xs [&>option]:bg-[#121212]"
                    >
                      <option value="Entretenimento">Entretenimento</option>
                      <option value="Educação">Educação</option>
                      <option value="Produtividade">Produtividade</option>
                      <option value="Infraestrutura">Infraestrutura</option>
                      <option value="Saúde">Saúde</option>
                      <option value="Lazer">Lazer</option>
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
                    className="flex-1 py-4 bg-brand-secondary text-black rounded-2xl font-black transition-all hover:brightness-110 active:scale-95 text-sm shadow-[0_0_20px_rgba(255,255,0,0.1)]"
                  >
                    Confirmar
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
