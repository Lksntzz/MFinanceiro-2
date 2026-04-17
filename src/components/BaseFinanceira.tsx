import React, { useState, useEffect, useMemo } from 'react';
import { UserSettings, FixedBill, DailyBill, FinanceSummary } from '../types';
import { supabase } from '../lib/supabase';
import { calculatePayrollFromGross } from '../lib/payroll-tax';
import { CATEGORIES } from '../lib/constants';
import { 
  ShieldCheck, 
  Wallet, 
  Banknote, 
  Calendar, 
  MinusCircle, 
  PlusCircle, 
  Calculator, 
  Save,
  Info,
  CheckCircle2,
  Clock,
  Plus,
  Activity,
  TrendingDown,
  X
} from 'lucide-react';

interface BaseFinanceiraProps {
  settings: UserSettings;
  onSave: (settings: UserSettings) => Promise<void>;
  fixedBills: FixedBill[];
  dailyBills: DailyBill[];
  summary: FinanceSummary | null;
  onToggleBillStatus: (id: string) => void;
  onRefresh: () => void;
}

type BenefitEntry = {
  id: string;
  name: string;
  amount: number;
  payrollDeducted: boolean;
};

const BENEFITS_STORAGE_KEY_PREFIX = 'mfinanceiro-benefits';
const PAYDAY_SPLIT_STORAGE_KEY_PREFIX = 'mfinanceiro-payday-split';

function getBenefitsStorageKey(userId: string): string {
  return `${BENEFITS_STORAGE_KEY_PREFIX}:${userId}`;
}

function getPaydaySplitStorageKey(userId: string): string {
  return `${PAYDAY_SPLIT_STORAGE_KEY_PREFIX}:${userId}`;
}

function sanitizeBenefitEntries(raw: unknown): BenefitEntry[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item: any) => ({
      id: String(item?.id || ''),
      name: String(item?.name || '').trim(),
      amount: Math.max(0, Number(item?.amount) || 0),
      payrollDeducted: Boolean(item?.payrollDeducted),
    }))
    .filter(item => item.id && item.name && item.amount > 0);
}

export default function BaseFinanceira({ 
  settings, 
  onSave, 
  fixedBills, 
  dailyBills, 
  summary, 
  onToggleBillStatus,
  onRefresh
}: BaseFinanceiraProps) {
  const [formData, setFormData] = useState<UserSettings>(settings);
  const [isSaving, setIsSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  
  // Modals state
  const [showAddFixed, setShowAddFixed] = useState(false);
  const [showAddDaily, setShowAddDaily] = useState(false);
  const [benefitEntries, setBenefitEntries] = useState<BenefitEntry[]>([]);
  const [paydaySplit, setPaydaySplit] = useState({ payday1Percent: 50, payday2Percent: 50 });
  const [newBenefit, setNewBenefit] = useState({
    name: '',
    amount: '',
    payrollDeducted: false,
  });
  
  const [newFixed, setNewFixed] = useState({
    name: '',
    amount: '',
    category: CATEGORIES[6] || 'Contas Fixas',
    due_day: '5'
  });
  
  const [newDaily, setNewDaily] = useState({
    name: '',
    average_amount: '',
    category: CATEGORIES[1] || 'Alimentação',
    frequency: 'weekly' as 'weekly' | 'monthly'
  });

  useEffect(() => {
    setFormData(settings);
  }, [settings]);

  useEffect(() => {
    if (!settings?.user_id || typeof window === 'undefined') return;

    const storageKey = getBenefitsStorageKey(settings.user_id);
    const raw = window.localStorage.getItem(storageKey);
    if (raw) {
      try {
        const parsed = sanitizeBenefitEntries(JSON.parse(raw));
        setBenefitEntries(parsed);
        return;
      } catch {
        // fallback abaixo
      }
    }

    if ((settings.benefits || 0) > 0) {
      setBenefitEntries([
        {
          id: `legacy-${settings.user_id}`,
          name: 'Benefícios gerais',
          amount: settings.benefits || 0,
          payrollDeducted: false,
        },
      ]);
    } else {
      setBenefitEntries([]);
    }
  }, [settings.user_id, settings.benefits]);

  useEffect(() => {
    if (!settings?.user_id || typeof window === 'undefined') return;
    const storageKey = getBenefitsStorageKey(settings.user_id);
    window.localStorage.setItem(storageKey, JSON.stringify(benefitEntries));
  }, [benefitEntries, settings.user_id]);

  useEffect(() => {
    if (!settings?.user_id || typeof window === 'undefined') return;
    const storageKey = getPaydaySplitStorageKey(settings.user_id);
    const raw = window.localStorage.getItem(storageKey);

    if (!raw) {
      setPaydaySplit({ payday1Percent: 50, payday2Percent: 50 });
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      const payday1Percent = Math.min(100, Math.max(0, Number(parsed?.payday1Percent) || 50));
      const payday2PercentRaw = Number(parsed?.payday2Percent);
      const payday2Percent = Number.isFinite(payday2PercentRaw)
        ? Math.min(100, Math.max(0, payday2PercentRaw))
        : Math.max(0, 100 - payday1Percent);
      const total = payday1Percent + payday2Percent;

      if (total > 0) {
        const normalizedPayday1 = Math.round((payday1Percent / total) * 100);
        setPaydaySplit({
          payday1Percent: normalizedPayday1,
          payday2Percent: 100 - normalizedPayday1,
        });
      } else {
        setPaydaySplit({ payday1Percent: 50, payday2Percent: 50 });
      }
    } catch {
      setPaydaySplit({ payday1Percent: 50, payday2Percent: 50 });
    }
  }, [settings.user_id]);

  const handleChange = (field: keyof UserSettings, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const payroll = useMemo(
    () => calculatePayrollFromGross(formData.gross_salary || 0, new Date()),
    [formData.gross_salary]
  );
  const totalBenefitsOffered = useMemo(
    () => benefitEntries.reduce((sum, item) => sum + item.amount, 0),
    [benefitEntries]
  );
  const totalBenefitsPayrollDiscount = useMemo(
    () => benefitEntries.filter(item => item.payrollDeducted).reduce((sum, item) => sum + item.amount, 0),
    [benefitEntries]
  );
  const calculatedDeductions = payroll.totalDeductions + totalBenefitsPayrollDiscount;
  const estimatedNetSalary = Math.max(0, payroll.netSalary - totalBenefitsPayrollDiscount);
  const benefitsNetAddition = Math.max(0, totalBenefitsOffered - totalBenefitsPayrollDiscount);
  const handleSave = async () => {
    setIsSaving(true);
    try {
      if (typeof window !== 'undefined' && settings?.user_id) {
        const storageKey = getPaydaySplitStorageKey(settings.user_id);
        window.localStorage.setItem(
          storageKey,
          JSON.stringify({
            payday1Percent: paydaySplit.payday1Percent,
            payday2Percent: paydaySplit.payday2Percent,
          })
        );
      }

      await onSave({
        ...formData,
        deductions: calculatedDeductions,
        net_salary_estimated: estimatedNetSalary,
        benefits: totalBenefitsOffered
      });
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (error) {
      console.error('Error saving settings:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const netRealBase = estimatedNetSalary + totalBenefitsOffered;

  const totalFixed = useMemo(() => fixedBills.reduce((sum, b) => sum + Number(b.amount || 0), 0), [fixedBills]);
  const totalDaily = useMemo(() => dailyBills.reduce((sum, b) => sum + Number(b.average_amount || 0), 0), [dailyBills]);
  const totalCommitted = totalFixed + totalDaily;

  const handleAddFixed = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) {
      alert('Supabase não configurado. Não foi possível salvar a conta fixa.');
      return;
    }
    try {
      const { error } = await supabase.from('mf_fixed_bills').insert({
        user_id: settings.user_id,
        name: newFixed.name,
        amount: parseFloat(newFixed.amount),
        category: newFixed.category,
        due_day: parseInt(newFixed.due_day),
        status: 'pending'
      });

      if (error) {
        if (error.code === 'PGRST205') {
          alert('Tabela mf_fixed_bills não encontrada. Crie-a no Supabase para salvar permanentemente.');
          return;
        }
        throw error;
      }
      
      setShowAddFixed(false);
      setNewFixed({ name: '', amount: '', category: 'Moradia', due_day: '5' });
      onRefresh();
    } catch (err: any) {
      console.error('Error adding fixed bill:', err);
      alert(`Erro: ${err.message || 'Falha ao salvar'}`);
    }
  };

  const handleAddDaily = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) {
      alert('Supabase não configurado. Não foi possível salvar a conta diária.');
      return;
    }
    try {
      const { error } = await supabase.from('mf_daily_bills').insert({
        user_id: settings.user_id,
        name: newDaily.name,
        average_amount: parseFloat(newDaily.average_amount),
        category: newDaily.category,
        frequency: newDaily.frequency
      });

      if (error) {
        if (error.code === 'PGRST205') {
          alert('Tabela mf_daily_bills não encontrada. Crie-a no Supabase para salvar permanentemente.');
          return;
        }
        throw error;
      }

      setShowAddDaily(false);
      setNewDaily({ name: '', average_amount: '', category: 'Alimentação', frequency: 'weekly' });
      onRefresh();
    } catch (err: any) {
      console.error('Error adding daily bill:', err);
      alert(`Erro: ${err.message || 'Falha ao salvar'}`);
    }
  };

  const handleAddBenefit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newBenefit.name.trim();
    const amount = Math.max(0, Number(newBenefit.amount) || 0);
    if (!name || amount <= 0) return;

    setBenefitEntries(prev => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name,
        amount,
        payrollDeducted: newBenefit.payrollDeducted,
      },
    ]);
    setNewBenefit({ name: '', amount: '', payrollDeducted: false });
  };

  const handleToggleBenefitPayrollDeducted = (id: string) => {
    setBenefitEntries(prev =>
      prev.map(item =>
        item.id === id ? { ...item, payrollDeducted: !item.payrollDeducted } : item
      )
    );
  };

  const handleDeleteBenefit = (id: string) => {
    setBenefitEntries(prev => prev.filter(item => item.id !== id));
  };

  const handleDeleteFixed = async (id: string) => {
    if (!supabase) {
      alert('Supabase não configurado. Não foi possível apagar a conta fixa.');
      return;
    }
    try {
      const { error } = await supabase.from('mf_fixed_bills').delete().eq('id', id);
      if (error) throw error;
      onRefresh();
    } catch (err) {
      console.error('Error deleting fixed bill:', err);
    }
  };

  const handleDeleteDaily = async (id: string) => {
    if (!supabase) {
      alert('Supabase não configurado. Não foi possível apagar a conta diária.');
      return;
    }
    try {
      const { error } = await supabase.from('mf_daily_bills').delete().eq('id', id);
      if (error) throw error;
      onRefresh();
    } catch (err) {
      console.error('Error deleting daily bill:', err);
    }
  };

  const handlePayday1PercentChange = (value: string) => {
    const parsed = Math.min(100, Math.max(0, Number(value) || 0));
    const normalized = Math.round(parsed);
    setPaydaySplit({
      payday1Percent: normalized,
      payday2Percent: 100 - normalized,
    });
  };

  const handlePayday2PercentChange = (value: string) => {
    const parsed = Math.min(100, Math.max(0, Number(value) || 0));
    const normalized = Math.round(parsed);
    setPaydaySplit({
      payday1Percent: 100 - normalized,
      payday2Percent: normalized,
    });
  };

  const totalPendingFixed = useMemo(() => fixedBills.filter(b => b.status === 'pending').reduce((sum, b) => sum + Number(b.amount || 0), 0), [fixedBills]);
  const isBalanceCritical = (formData.current_balance || 0) < totalPendingFixed;

  return (
    <div className="flex-1 flex flex-col gap-4 overflow-y-auto no-scrollbar pb-8 animate-fade-in text-white">
      {/* 1. Resumo da Base Financeira */}
      <div className={`glass-card !p-4 border-brand-primary/20 shrink-0 ${isBalanceCritical ? 'bg-red-500/5 border-red-500/20' : 'bg-brand-primary/5'}`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
            <ShieldCheck size={18} className={isBalanceCritical ? 'text-red-400' : 'text-brand-primary'} /> Resumo da Base Financeira
          </h2>
          {isBalanceCritical ? (
            <span className="text-[10px] bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full font-bold animate-pulse">SALDO INSUFICIENTE PARA CONTAS</span>
          ) : (
            <span className="text-[10px] bg-brand-primary/20 text-brand-primary px-2 py-0.5 rounded-full font-bold">CONFIGURAÇÃO ATIVA</span>
          )}
        </div>
        <div className="grid grid-cols-6 gap-4">
          <div className="flex flex-col">
            <span className="text-[10px] text-white/40 uppercase">Saldo Atual</span>
            <span className={`font-bold text-sm ${isBalanceCritical ? 'text-red-400' : ''}`}>R$ {(formData.current_balance || 0).toLocaleString('pt-BR')}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-white/40 uppercase">Contas Pend.</span>
            <span className="font-bold text-sm text-red-400/80">R$ {totalPendingFixed.toLocaleString('pt-BR')}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-white/40 uppercase">Líquido Est.</span>
            <span className="font-bold text-sm">R$ {estimatedNetSalary.toLocaleString('pt-BR')}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-white/40 uppercase">Ciclo</span>
            <span className="font-bold text-sm uppercase">{formData.payday_cycle === 'monthly' ? 'Mensal' : 'Quinzenal'}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-white/40 uppercase">Próx. Pgto</span>
            <span className="font-bold text-sm">Dia {formData.payday_1 || 1}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-brand-primary uppercase">Base Real</span>
            <span className="font-bold text-sm text-brand-primary">R$ {(netRealBase || 0).toLocaleString('pt-BR')}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* 2. Saldo Atual */}
        <div className="glass-card !p-5 space-y-4">
          <h3 className="font-bold text-sm flex items-center gap-2">
            <Wallet size={16} className="text-white/60" /> Saldo Atual em Conta
          </h3>
          <p className="text-xs text-white/40">Este valor é o ponto de partida do seu ciclo atual.</p>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 font-bold">R$</span>
            <input 
              type="number" 
              value={formData.current_balance}
              onChange={(e) => handleChange('current_balance', parseFloat(e.target.value) || 0)}
              className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-12 pr-4 outline-none focus:border-brand-primary transition-all font-bold text-lg"
            />
          </div>
        </div>

        {/* 3. Estrutura Salarial */}
        <div className="glass-card !p-5 space-y-4">
          <h3 className="font-bold text-sm flex items-center gap-2">
            <Banknote size={16} className="text-white/60" /> Estrutura Salarial
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] text-white/40 uppercase font-bold">Salário Bruto</label>
              <input 
                type="number" 
                value={formData.gross_salary}
                onChange={(e) => handleChange('gross_salary', parseFloat(e.target.value) || 0)}
                className="w-full bg-white/5 border border-white/10 rounded-xl py-2 px-4 outline-none focus:border-brand-primary transition-all font-bold"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] text-brand-primary uppercase font-bold">Líquido Estimado</label>
              <input 
                type="number" 
                value={estimatedNetSalary}
                readOnly
                aria-readonly="true"
                disabled
                className="w-full bg-brand-primary/5 border border-brand-primary/20 rounded-xl py-2 px-4 outline-none font-bold text-brand-primary cursor-not-allowed"
              />
              <p className="text-[10px] text-white/40">Calculado automaticamente: Salário Bruto - Descontos.</p>
            </div>
          </div>
        </div>

        {/* 4. Ciclo de Pagamento */}
        <div className="glass-card !p-5 space-y-4">
          <h3 className="font-bold text-sm flex items-center gap-2">
            <Calendar size={16} className="text-white/60" /> Ciclo de Pagamento
          </h3>
          <div className="flex bg-white/5 p-1 rounded-xl border border-white/10">
            <button 
              onClick={() => handleChange('payday_cycle', 'monthly')}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${formData.payday_cycle === 'monthly' ? 'bg-brand-primary text-black' : 'text-white/40 hover:text-white'}`}
            >
              Mensal (1x)
            </button>
            <button 
              onClick={() => handleChange('payday_cycle', 'biweekly')}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${formData.payday_cycle === 'biweekly' ? 'bg-brand-primary text-black' : 'text-white/40 hover:text-white'}`}
            >
              Quinzenal (2x)
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] text-white/40 uppercase font-bold">Dia do Pagamento</label>
              <input 
                type="number" 
                min="1" max="31"
                value={formData.payday_1}
                onChange={(e) => handleChange('payday_1', parseInt(e.target.value) || 1)}
                className="w-full bg-white/5 border border-white/10 rounded-xl py-2 px-4 outline-none focus:border-brand-primary transition-all font-bold"
              />
              {formData.payday_cycle === 'biweekly' && (
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={paydaySplit.payday1Percent}
                    onChange={(e) => handlePayday1PercentChange(e.target.value)}
                    className="w-16 bg-black/20 border border-white/10 rounded-lg py-1.5 px-2 outline-none focus:border-brand-primary transition-all font-bold text-sm"
                  />
                  <span className="text-[11px] text-white/50">% do salário</span>
                </div>
              )}
            </div>
            {formData.payday_cycle === 'biweekly' && (
              <div className="space-y-2">
                <label className="text-[10px] text-white/40 uppercase font-bold">Segundo Pagamento</label>
                <input 
                  type="number" 
                  min="1" max="31"
                  value={formData.payday_2 || 20}
                  onChange={(e) => handleChange('payday_2', parseInt(e.target.value) || 20)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-2 px-4 outline-none focus:border-brand-primary transition-all font-bold"
                />
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={paydaySplit.payday2Percent}
                    onChange={(e) => handlePayday2PercentChange(e.target.value)}
                    className="w-16 bg-black/20 border border-white/10 rounded-lg py-1.5 px-2 outline-none focus:border-brand-primary transition-all font-bold text-sm"
                  />
                  <span className="text-[11px] text-white/50">% do salário</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 5. Descontos em Folha */}
        <div className="glass-card !p-5 space-y-4">
          <h3 className="font-bold text-sm flex items-center gap-2">
            <MinusCircle size={16} className="text-red-400/60" /> Descontos em Folha
          </h3>
          <p className="text-xs text-white/40">Cálculo automático com base no salário bruto e benefícios marcados como desconto em folha.</p>
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm">
              <span className="text-white/60">INSS</span>
              <span className="font-bold text-red-400">- R$ {payroll.inss.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm">
              <span className="text-white/60">IRRF</span>
              <span className="font-bold text-red-400">- R$ {payroll.irrf.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm">
              <span className="text-white/60">Desconto de benefícios</span>
              <span className="font-bold text-red-400">- R$ {totalBenefitsPayrollDiscount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-red-400/30 bg-red-500/5 px-3 py-2 text-sm">
              <span className="text-white/80 font-bold">Total descontos</span>
              <span className="font-bold text-red-400">- R$ {calculatedDeductions.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
            </div>
          </div>
        </div>

        {/* 6. Benefícios */}
        <div className="glass-card !p-5 space-y-4">
          <h3 className="font-bold text-sm flex items-center gap-2">
            <PlusCircle size={16} className="text-green-400/60" /> Benefícios (VR, VA, Auxílios)
          </h3>
          <p className="text-xs text-white/40">Lance os benefícios da empresa e marque os que são descontados na folha.</p>

          <form onSubmit={handleAddBenefit} className="space-y-2">
            <div className="grid grid-cols-12 gap-2">
              <input
                type="text"
                value={newBenefit.name}
                onChange={(e) => setNewBenefit(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Ex: VR, VA"
                className="col-span-6 bg-white/5 border border-white/10 rounded-xl py-2 px-3 outline-none focus:border-green-400 text-sm"
              />
              <input
                type="number"
                step="0.01"
                min="0"
                value={newBenefit.amount}
                onChange={(e) => setNewBenefit(prev => ({ ...prev, amount: e.target.value }))}
                placeholder="Valor"
                className="col-span-3 bg-white/5 border border-white/10 rounded-xl py-2 px-3 outline-none focus:border-green-400 text-sm"
              />
              <button
                type="submit"
                className="col-span-3 bg-green-500/20 border border-green-500/30 text-green-300 rounded-xl py-2 px-3 font-bold text-xs hover:bg-green-500/30 transition-all"
              >
                Add
              </button>
            </div>
            <label className="flex items-center gap-2 text-xs text-white/60">
              <input
                type="checkbox"
                checked={newBenefit.payrollDeducted}
                onChange={(e) => setNewBenefit(prev => ({ ...prev, payrollDeducted: e.target.checked }))}
                className="h-3.5 w-3.5 accent-red-400"
              />
              Descontado na folha
            </label>
          </form>

          <div className="space-y-2 max-h-40 overflow-y-auto no-scrollbar pr-1">
            {benefitEntries.map(item => (
              <div key={item.id} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-bold truncate">{item.name}</div>
                  <div className={`text-[10px] ${item.payrollDeducted ? 'text-red-300' : 'text-green-300'}`}>
                    {item.payrollDeducted ? 'Desconta na folha' : 'Não desconta'}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-bold">R$ {item.amount.toLocaleString('pt-BR')}</span>
                  <button type="button" onClick={() => handleDeleteBenefit(item.id)} className="p-1 text-white/20 hover:text-red-400 transition-all"><X size={12} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 7. Previsão Líquida / Base Real */}
        <div className="glass-card !p-5 bg-brand-secondary/5 border-brand-secondary/20 flex flex-col justify-between">
          <h3 className="font-bold text-sm flex items-center gap-2 mb-4">
            <Calculator size={16} className="text-brand-secondary" /> Base Real Estimada
          </h3>
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-white/40">Salário Bruto</span>
              <span className="font-bold">R$ {(formData.gross_salary || 0).toLocaleString('pt-BR')}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-red-400/60">(-) Descontos Est.</span>
              <span className="font-bold text-red-400">- R$ {calculatedDeductions.toLocaleString('pt-BR')}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-green-400/60">(+) Benefícios</span>
              <span className="font-bold text-green-400">+ R$ {totalBenefitsOffered.toLocaleString('pt-BR')}</span>
            </div>
            <div className="pt-2 border-t border-white/10 flex justify-between items-center">
              <span className="text-sm font-bold">Total Base Real</span>
              <span className="text-xl font-bold text-brand-secondary">R$ {(netRealBase || 0).toLocaleString('pt-BR')}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 8 & 9. Impacto e Ações */}
      <div className="grid grid-cols-12 gap-4 items-stretch">
        <div className="col-span-8 glass-card !p-4 flex items-center gap-4 bg-white/5">
          <Info size={20} className="text-white/40 shrink-0" />
          <p className="text-xs text-white/60">A Base Financeira impacta seu Limite Diário e todos os Insights. Mantenha os dados atualizados.</p>
        </div>
        <div className="col-span-4 flex flex-col gap-2">
          <button 
            onClick={handleSave}
            disabled={isSaving}
            className="flex-1 bg-brand-primary text-black rounded-2xl font-bold flex items-center justify-center gap-3 hover:opacity-90 transition-all disabled:opacity-50"
          >
            {isSaving ? "Salvando..." : (showSuccess ? "Salvo!" : "Salvar Configuração")}
          </button>
        </div>
      </div>

      {/* 10. Gestão de Contas (Fixed & Daily) */}
      <div className="grid grid-cols-2 gap-4">
        <div className="glass-card flex flex-col gap-4">
          <div className="flex items-center justify-between"><h3 className="font-bold text-sm flex items-center gap-2"><Calendar size={16} className="text-brand-primary" /> Contas Fixas</h3><button onClick={() => setShowAddFixed(true)} className="p-1.5 bg-brand-primary/10 text-brand-primary rounded-lg shadow-sm hover:bg-brand-primary/20"><Plus size={16} /></button></div>
          <div className="space-y-2 max-h-[300px] overflow-y-auto no-scrollbar">
            {fixedBills.map(bill => (
              <div key={bill.id} className="p-3 bg-white/5 rounded-xl border border-white/5 flex items-center justify-between group">
                <div className="flex items-center gap-3">
                  <button onClick={() => onToggleBillStatus(bill.id)} className={`h-8 w-8 rounded-lg flex items-center justify-center ${bill.status === 'paid' ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-white/40'}`}>
                    {bill.status === 'paid' ? <CheckCircle2 size={16} /> : <Clock size={16} />}
                  </button>
                  <div><div className="text-sm font-bold">{bill.name}</div><div className="text-[10px] text-white/40">Dia {bill.due_day}</div></div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold">R$ {bill.amount.toLocaleString('pt-BR')}</span>
                  <button onClick={() => handleDeleteFixed(bill.id)} className="p-1 text-white/10 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"><X size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-card flex flex-col gap-4">
          <div className="flex items-center justify-between"><h3 className="font-bold text-sm flex items-center gap-2"><Activity size={16} className="text-brand-secondary" /> Gastos Operacionais</h3><button onClick={() => setShowAddDaily(true)} className="p-1.5 bg-brand-secondary/10 text-brand-secondary rounded-lg hover:bg-brand-secondary/20"><Plus size={16} /></button></div>
          <div className="space-y-2 max-h-[300px] overflow-y-auto no-scrollbar">
            {dailyBills.map(bill => (
              <div key={bill.id} className="p-3 bg-white/5 rounded-xl border border-white/5 flex items-center justify-between group">
                <div className="flex items-center gap-3"><TrendingDown size={16} className="text-brand-secondary" /><div><div className="text-sm font-bold">{bill.name}</div><div className="text-[10px] text-white/40">{bill.frequency === 'weekly' ? 'Semanal' : 'Mensal'}</div></div></div>
                <div className="flex items-center gap-3"><span className="text-sm font-bold">R$ {bill.average_amount.toLocaleString('pt-BR')}</span><button onClick={() => handleDeleteDaily(bill.id)} className="p-1 text-white/10 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"><X size={14} /></button></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showAddFixed && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="glass-card w-full max-w-md animate-fade-in p-6">
            <h2 className="text-xl font-bold mb-6">Nova Conta Fixa</h2>
            <form onSubmit={handleAddFixed} className="space-y-4">
              <input type="text" placeholder="Nome" required value={newFixed.name} onChange={e => setNewFixed({...newFixed, name: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl p-3" />
              <div className="grid grid-cols-2 gap-4">
                <input type="number" placeholder="Valor" required value={newFixed.amount} onChange={e => setNewFixed({...newFixed, amount: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl p-3" />
                <select value={newFixed.category} onChange={e => setNewFixed({...newFixed, category: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl p-3 outline-none">
                  {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </div>
              <input type="number" placeholder="Dia Vencimento" required value={newFixed.due_day} onChange={e => setNewFixed({...newFixed, due_day: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl p-3" />
              <div className="flex gap-3"><button type="button" onClick={() => setShowAddFixed(false)} className="flex-1 p-3 rounded-xl bg-white/5">Cancelar</button><button type="submit" className="flex-1 p-3 rounded-xl bg-brand-primary text-black font-bold">Adicionar</button></div>
            </form>
          </div>
        </div>
      )}

      {showAddDaily && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="glass-card w-full max-w-md animate-fade-in p-6">
            <h2 className="text-xl font-bold mb-6">Novo Gasto</h2>
            <form onSubmit={handleAddDaily} className="space-y-4">
              <input type="text" placeholder="Nome" required value={newDaily.name} onChange={e => setNewDaily({...newDaily, name: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl p-3" />
              <div className="grid grid-cols-2 gap-4">
                <input type="number" placeholder="Valor" required value={newDaily.average_amount} onChange={e => setNewDaily({...newDaily, average_amount: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl p-3" />
                <select value={newDaily.category} onChange={e => setNewDaily({...newDaily, category: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl p-3 outline-none">
                  {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </div>
              <div className="flex gap-3"><button type="button" onClick={() => setShowAddDaily(false)} className="flex-1 p-3 rounded-xl bg-white/5">Cancelar</button><button type="submit" className="flex-1 p-3 rounded-xl bg-brand-secondary text-white font-bold">Adicionar</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
