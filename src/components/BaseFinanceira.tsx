import React, { useState, useEffect, useMemo } from 'react';
import { UserSettings, FixedBill, DailyBill, FinanceSummary } from '../types';
import { supabase } from '../lib/supabase';
import { calculatePayrollFromGross } from '../lib/payroll-tax';
import { CATEGORIES } from '../lib/constants';
import { format, addMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
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
  X,
  Check,
  Circle,
  LayoutGrid
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
  const [activeTab, setActiveTab] = useState<'income' | 'adjustments' | 'bills' | 'operating' | 'budget'>('income');
  const [budgets, setBudgets] = useState<any[]>([]);
  const [newBudget, setNewBudget] = useState({ category: CATEGORIES[1], amount: '' });
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
    amount: '',
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

  useEffect(() => {
    fetchBudgets();
  }, [settings.user_id]);

  async function fetchBudgets() {
    if (!settings.user_id) return;
    try {
      const { data, error } = await supabase.from('mf_budgets').select('*').eq('user_id', settings.user_id);
      if (!error) setBudgets(data || []);
    } catch (err) {
      console.error('Error fetching budgets:', err);
    }
  }

  const handleAddBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    try {
      const { error } = await supabase.from('mf_budgets').upsert({
        user_id: settings.user_id,
        category: newBudget.category,
        limit_amount: parseFloat(newBudget.amount)
      }, { onConflict: 'user_id,category' });

      if (error) throw error;
      setNewBudget({ ...newBudget, amount: '' });
      fetchBudgets();
    } catch (err) {
      console.error('Error adding budget:', err);
    }
  };

  const handleDeleteBudget = async (id: string) => {
    try {
      await supabase.from('mf_budgets').delete().eq('id', id);
      fetchBudgets();
    } catch (err) {
      console.error('Error deleting budget:', err);
    }
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

      setNewDaily({ name: '', amount: '', average_amount: '', category: 'Alimentação', frequency: 'weekly' });
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
    <div className="flex-1 flex flex-col md:flex-row gap-6 min-h-[500px] animate-fade-in text-white overflow-hidden">
      {/* Sidebar de Navegação Interna */}
      <div className="w-full md:w-64 shrink-0 flex flex-col gap-2">
        <button 
          onClick={() => setActiveTab('income')}
          className={`flex items-center gap-3 p-4 rounded-2xl transition-all text-left border ${activeTab === 'income' ? 'bg-brand-primary/10 border-brand-primary/30 text-brand-primary' : 'bg-white/5 border-transparent text-white/40 hover:bg-white/10 hover:text-white'}`}
        >
          <Banknote size={18} />
          <div className="flex-1">
            <div className="text-sm font-bold">Renda & Ciclo</div>
            <div className="text-[10px] opacity-60">Salário e Pagamento</div>
          </div>
        </button>

        <button 
          onClick={() => setActiveTab('adjustments')}
          className={`flex items-center gap-3 p-4 rounded-2xl transition-all text-left border ${activeTab === 'adjustments' ? 'bg-brand-primary/10 border-brand-primary/30 text-brand-primary' : 'bg-white/5 border-transparent text-white/40 hover:bg-white/10 hover:text-white'}`}
        >
          <PlusCircle size={18} />
          <div className="flex-1">
            <div className="text-sm font-bold">Ajustes & Benefícios</div>
            <div className="text-[10px] opacity-60">Descontos e Extras</div>
          </div>
        </button>

        <button 
          onClick={() => setActiveTab('bills')}
          className={`flex items-center gap-3 p-4 rounded-2xl transition-all text-left border ${activeTab === 'bills' ? 'bg-brand-primary/10 border-brand-primary/30 text-brand-primary' : 'bg-white/5 border-transparent text-white/40 hover:bg-white/10 hover:text-white'}`}
        >
          <Calendar size={18} />
          <div className="flex-1">
            <div className="text-sm font-bold">Contas Fixas</div>
            <div className="text-[10px] opacity-60">Compromissos Mensais</div>
          </div>
        </button>

        <button 
          onClick={() => setActiveTab('operating')}
          className={`flex items-center gap-3 p-4 rounded-2xl transition-all text-left border ${activeTab === 'operating' ? 'bg-brand-primary/10 border-brand-primary/30 text-brand-primary' : 'bg-white/5 border-transparent text-white/40 hover:bg-white/10 hover:text-white'}`}
        >
          <Activity size={18} />
          <div className="flex-1">
            <div className="text-sm font-bold">Gastos Estimados</div>
            <div className="text-[10px] opacity-60">Rasteio Operacional</div>
          </div>
        </button>

        <button 
          onClick={() => setActiveTab('budget')}
          className={`flex items-center gap-3 p-4 rounded-2xl transition-all text-left border ${activeTab === 'budget' ? 'bg-brand-primary/10 border-brand-primary/30 text-brand-primary' : 'bg-white/5 border-transparent text-white/40 hover:bg-white/10 hover:text-white'}`}
        >
          <LayoutGrid size={18} />
          <div className="flex-1">
            <div className="text-sm font-bold">Orçamentos</div>
            <div className="text-[10px] opacity-60">Limites por Categoria</div>
          </div>
        </button>

        <div className="mt-auto pt-4 space-y-3">
          <div className="glass-card !p-4 bg-brand-primary/5 border-brand-primary/20">
            <div className="text-[10px] text-brand-primary uppercase font-bold mb-1">Base Real Estimada</div>
            <div className="text-xl font-bold tracking-tight">R$ {(netRealBase || 0).toLocaleString('pt-BR')}</div>
          </div>
          
          <button 
            onClick={handleSave}
            disabled={isSaving}
            className="w-full bg-brand-primary text-black py-4 rounded-2xl font-bold flex items-center justify-center gap-3 hover:brightness-110 transition-all disabled:opacity-50 shadow-[0_4px_20px_rgba(0,242,255,0.2)]"
          >
            {isSaving ? <Clock className="animate-spin" size={18} /> : (showSuccess ? <CheckCircle2 size={18} /> : <Save size={18} />)}
            {isSaving ? "Salvando..." : (showSuccess ? "Configuração Salva" : "Aplicar Mudanças")}
          </button>
        </div>
      </div>

      {/* Conteúdo Principal */}
      <div className="flex-1 overflow-y-auto no-scrollbar pr-1">
        {activeTab === 'income' && (
          <div className="space-y-6">
            <section className="glass-card !p-6 space-y-6 border-white/5">
              <div>
                <h3 className="text-lg font-bold mb-1 flex items-center gap-2">
                  <Banknote className="text-brand-primary" size={20} /> Estrutura Salarial
                </h3>
                <p className="text-xs text-white/40">Defina sua renda bruta e veja o cálculo estimado do seu líquido.</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] text-white/60 uppercase font-bold">Salário Bruto Mensal</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-white/20">R$</span>
                    <input 
                      type="number" 
                      value={formData.gross_salary}
                      onChange={(e) => handleChange('gross_salary', parseFloat(e.target.value) || 0)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-12 pr-4 outline-none focus:border-brand-primary transition-all font-bold text-lg"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] text-brand-primary uppercase font-bold">Salário Líquido (Estimado)</label>
                  <div className="w-full bg-brand-primary/5 border border-brand-primary/20 rounded-xl py-3 px-4 font-bold text-lg text-brand-primary">
                    R$ {estimatedNetSalary.toLocaleString('pt-BR')}
                  </div>
                </div>
              </div>
            </section>

            <section className="glass-card !p-6 space-y-6 border-white/5">
              <div>
                <h3 className="text-lg font-bold mb-1 flex items-center gap-2">
                  <Calendar className="text-brand-primary" size={20} /> Ciclo de Recebimento
                </h3>
                <p className="text-xs text-white/40">Como você recebe seu salário ao longo do mês?</p>
              </div>

              <div className="flex bg-white/5 p-1 rounded-xl border border-white/10 max-w-sm">
                <button 
                  onClick={() => handleChange('payday_cycle', 'monthly')}
                  className={`flex-1 py-3 rounded-lg text-xs font-bold transition-all ${formData.payday_cycle === 'monthly' ? 'bg-brand-primary text-black shadow-lg' : 'text-white/40 hover:text-white'}`}
                >
                  Mensal (1x)
                </button>
                <button 
                  onClick={() => handleChange('payday_cycle', 'biweekly')}
                  className={`flex-1 py-3 rounded-lg text-xs font-bold transition-all ${formData.payday_cycle === 'biweekly' ? 'bg-brand-primary text-black shadow-lg' : 'text-white/40 hover:text-white'}`}
                >
                  Quinzenal (2x)
                </button>
              </div>

              <div className="grid grid-cols-2 gap-6 p-4 bg-white/5 rounded-2xl border border-white/5">
                <div className="space-y-3">
                  <label className="text-[10px] text-white/40 uppercase font-bold block">{formData.payday_cycle === 'biweekly' ? 'Primeiro Pagamento' : 'Dia do Pagamento'}</label>
                  <div className="flex items-center gap-4">
                    <div className="flex-1 relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-white/20">DIA</span>
                      <input 
                        type="number" 
                        min="1" max="31"
                        value={formData.payday_1 || ''}
                        onChange={(e) => handleChange('payday_1', e.target.value === '' ? '' : parseInt(e.target.value))}
                        className="w-full bg-black/20 border border-white/10 rounded-xl py-3 pl-10 pr-4 outline-none focus:border-brand-primary transition-all font-bold"
                      />
                    </div>
                    {formData.payday_cycle === 'biweekly' && (
                      <div className="relative shrink-0">
                        <input
                          type="number"
                          min="0" max="100"
                          value={paydaySplit.payday1Percent}
                          onChange={(e) => handlePayday1PercentChange(e.target.value)}
                          className="w-20 bg-black/20 border border-white/10 rounded-xl py-3 px-3 outline-none focus:border-brand-primary text-center font-bold"
                        />
                        <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[8px] bg-brand-primary text-black px-1 rounded font-bold">%</span>
                      </div>
                    )}
                  </div>
                </div>

                {formData.payday_cycle === 'biweekly' && (
                  <div className="space-y-3">
                    <label className="text-[10px] text-white/40 uppercase font-bold block">Segundo Pagamento</label>
                    <div className="flex items-center gap-4">
                      <div className="flex-1 relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-white/20">DIA</span>
                        <input 
                          type="number" 
                          min="1" max="31"
                          value={formData.payday_2 || ''}
                          onChange={(e) => handleChange('payday_2', e.target.value === '' ? '' : parseInt(e.target.value))}
                          className="w-full bg-black/20 border border-white/10 rounded-xl py-3 pl-10 pr-4 outline-none focus:border-brand-primary transition-all font-bold"
                        />
                      </div>
                      <div className="relative shrink-0">
                        <input
                          type="number"
                          min="0" max="100"
                          value={paydaySplit.payday2Percent}
                          onChange={(e) => handlePayday2PercentChange(e.target.value)}
                          className="w-20 bg-black/20 border border-white/10 rounded-xl py-3 px-3 outline-none focus:border-brand-primary text-center font-bold"
                        />
                        <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[8px] bg-brand-primary text-black px-1 rounded font-bold">%</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}

        {activeTab === 'adjustments' && (
          <div className="space-y-6">
            <section className="glass-card !p-6 space-y-6 border-white/5">
              <div>
                <h3 className="text-lg font-bold mb-1 flex items-center gap-2">
                  <MinusCircle className="text-red-400" size={20} /> Descontos Automáticos
                </h3>
                <p className="text-xs text-white/40">Cálculos baseados nas tabelas oficiais de INSS e IRRF 2024.</p>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                  <div className="text-[10px] text-white/40 uppercase font-bold mb-1">INSS</div>
                  <div className="text-lg font-bold text-red-400">- R$ {payroll.inss.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                  <div className="text-[10px] text-white/40 uppercase font-bold mb-1">IRRF</div>
                  <div className="text-lg font-bold text-red-400">- R$ {payroll.irrf.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                </div>
                <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-4">
                  <div className="text-[10px] text-red-400 uppercase font-bold mb-1">Total Taxas</div>
                  <div className="text-lg font-bold">- R$ {payroll.totalDeductions.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                </div>
              </div>
            </section>

            <section className="glass-card !p-6 space-y-6 border-white/5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold mb-1 flex items-center gap-2">
                    <PlusCircle className="text-green-400" size={20} /> Benefícios & Extras
                  </h3>
                  <p className="text-xs text-white/40">VR, VA, Combustível ou qualquer entrada fixa extra.</p>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-green-400 uppercase font-bold tracking-widest">Saldo de Benefícios</div>
                  <div className="text-xl font-bold">R$ {totalBenefitsOffered.toLocaleString('pt-BR')}</div>
                </div>
              </div>

              <form onSubmit={handleAddBenefit} className="bg-black/20 p-4 rounded-2xl border border-white/5 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] text-white/40 uppercase font-bold">Nome do Benefício</label>
                    <input
                      type="text"
                      value={newBenefit.name}
                      onChange={(e) => setNewBenefit(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="Ex: Vale Refeição"
                      className="w-full bg-white/5 border border-white/10 rounded-xl py-2 px-3 outline-none focus:border-brand-primary text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-white/40 uppercase font-bold">Valor Mensal</label>
                    <input
                      type="number"
                      step="0.01"
                      value={newBenefit.amount}
                      onChange={(e) => setNewBenefit(prev => ({ ...prev, amount: e.target.value }))}
                      placeholder="0,00"
                      className="w-full bg-white/5 border border-white/10 rounded-xl py-2 px-3 outline-none focus:border-brand-primary text-sm"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <div className={`h-5 w-5 rounded-md border flex items-center justify-center transition-all ${newBenefit.payrollDeducted ? 'bg-red-500 border-red-500' : 'bg-white/5 border-white/10 group-hover:border-white/30'}`}>
                      {newBenefit.payrollDeducted && <Check size={14} className="text-white" />}
                    </div>
                    <input
                      type="checkbox"
                      className="hidden"
                      checked={newBenefit.payrollDeducted}
                      onChange={(e) => setNewBenefit(prev => ({ ...prev, payrollDeducted: e.target.checked }))}
                    />
                    <span className="text-xs text-white/60">Este benefício é descontado do salário?</span>
                  </label>
                  <button type="submit" className="bg-brand-primary text-black px-6 py-2 rounded-xl font-bold text-xs hover:brightness-110 shadow-lg">
                    Adicionar
                  </button>
                </div>
              </form>

              <div className="grid grid-cols-1 gap-2 max-h-60 overflow-y-auto no-scrollbar pr-1">
                {benefitEntries.length === 0 && <div className="text-center py-8 text-white/20 italic text-sm">Nenhum benefício cadastrado.</div>}
                {benefitEntries.map(item => (
                  <div key={item.id} className="group p-3 rounded-xl bg-white/5 border border-white/5 flex items-center justify-between hover:bg-white/10 transition-all">
                    <div className="flex items-center gap-3">
                      <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${item.payrollDeducted ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'}`}>
                        {item.payrollDeducted ? <TrendingDown size={18} /> : <Plus size={18} />}
                      </div>
                      <div>
                        <div className="text-sm font-bold">{item.name}</div>
                        <div className={`text-[10px] ${item.payrollDeducted ? 'text-red-400' : 'text-green-400'}`}>
                          {item.payrollDeducted ? 'Desconto em Folha' : 'Entrada Extra'}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-sm font-bold">R$ {item.amount.toLocaleString('pt-BR')}</div>
                      <button onClick={() => handleDeleteBenefit(item.id)} className="p-2 text-white/20 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all">
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {activeTab === 'bills' && (
          <div className="space-y-6">
            <section className="glass-card !p-6 space-y-6 border-white/5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold mb-1 flex items-center gap-2">
                    <Calendar className="text-brand-primary" size={20} /> Contas Fixas
                  </h3>
                  <p className="text-xs text-white/40">Contas que ocorrem todo mês com dia certo de vencimento.</p>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-white/40 uppercase font-bold tracking-widest">Total Mensal</div>
                  <div className="text-xl font-bold">R$ {totalFixed.toLocaleString('pt-BR')}</div>
                </div>
              </div>

              <form onSubmit={handleAddFixed} className="bg-black/20 p-4 rounded-2xl border border-white/5 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] text-white/40 uppercase font-bold">Nome da Conta</label>
                    <input type="text" placeholder="Ex: Aluguel" required value={newFixed.name} onChange={e => setNewFixed({...newFixed, name: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl py-2 px-3 outline-none focus:border-brand-primary text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-white/40 uppercase font-bold">Valor</label>
                    <input type="number" placeholder="0,00" required value={newFixed.amount} onChange={e => setNewFixed({...newFixed, amount: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl py-2 px-3 outline-none focus:border-brand-primary text-sm" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] text-white/40 uppercase font-bold">Dia do Vencimento</label>
                    <input type="number" min="1" max="31" required value={newFixed.due_day} onChange={e => setNewFixed({...newFixed, due_day: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl py-2 px-3 outline-none focus:border-brand-primary text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-white/40 uppercase font-bold">Categoria</label>
                    <select value={newFixed.category} onChange={e => setNewFixed({...newFixed, category: e.target.value})} className="w-full bg-[#121212] border border-white/10 rounded-xl py-2 px-3 outline-none focus:border-brand-primary text-sm [&>option]:bg-[#121212] [&>option]:text-white">
                      {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                  </div>
                </div>
                <button type="submit" className="w-full bg-brand-primary text-black py-3 rounded-xl font-bold text-sm tracking-wide hover:brightness-110 shadow-lg mt-2">
                  Adicionar Conta Fixa
                </button>
              </form>

              <div className="grid grid-cols-1 gap-2 max-h-80 overflow-y-auto no-scrollbar pr-1">
                {fixedBills.length === 0 && <div className="text-center py-10 text-white/20 italic text-sm">Nenhuma conta fixa cadastrada.</div>}
                {fixedBills.map(bill => {
                  const today = new Date();
                  const currentMonth = format(today, 'yyyy-MM');
                  const isPaid = bill.last_paid_month === currentMonth;
                  const nextDate = new Date(today.getFullYear(), today.getMonth(), bill.due_day, 12, 0, 0, 0);
                  const displayDate = isPaid ? addMonths(nextDate, 1) : nextDate;

                  return (
                    <div key={bill.id} className="group p-4 rounded-xl bg-white/5 border border-white/5 flex items-center justify-between hover:bg-white/10 transition-all">
                      <div className="flex items-center gap-4">
                        <div onClick={() => onToggleBillStatus(bill.id)} className={`h-10 w-10 rounded-xl flex items-center justify-center cursor-pointer transition-all ${isPaid ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-white/40 hover:bg-brand-primary/20 hover:text-brand-primary'}`}>
                          {isPaid ? <CheckCircle2 size={20} /> : <Circle size={20} />}
                        </div>
                        <div>
                          <div className="text-sm font-bold">{bill.name}</div>
                          <div className="text-[10px] text-white/40 flex items-center gap-1">
                            <Clock size={10} /> Vence dia {bill.due_day} • Próximo: {format(displayDate, "dd 'de' MMM", { locale: ptBR })}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-sm font-bold">R$ {bill.amount.toLocaleString('pt-BR')}</div>
                        <button onClick={() => handleDeleteFixed(bill.id)} className="p-2 text-white/20 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all">
                          <X size={16} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        )}

        {activeTab === 'operating' && (
          <div className="space-y-6">
            <section className="glass-card !p-6 space-y-6 border-white/5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold mb-1 flex items-center gap-2">
                    <Activity className="text-brand-secondary" size={20} /> Gastos Estimados
                  </h3>
                  <p className="text-xs text-white/40">Despesas variáveis mas recorrentes (Mercado, Lazer, etc).</p>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-brand-secondary uppercase font-bold tracking-widest">Reserva Diária</div>
                  <div className="text-xl font-bold">R$ {totalDaily.toLocaleString('pt-BR')}</div>
                </div>
              </div>

              <form onSubmit={handleAddDaily} className="bg-black/20 p-4 rounded-2xl border border-white/5 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] text-white/40 uppercase font-bold">Título do Gasto</label>
                    <input type="text" placeholder="Ex: Mercado Mensal" required value={newDaily.name} onChange={e => setNewDaily({...newDaily, name: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl py-2 px-3 outline-none focus:border-brand-secondary text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-white/40 uppercase font-bold">Previsão de Valor</label>
                    <input type="number" placeholder="0,00" required value={newDaily.average_amount} onChange={e => setNewDaily({...newDaily, average_amount: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl py-2 px-3 outline-none focus:border-brand-secondary text-sm" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] text-white/40 uppercase font-bold">Frequência</label>
                    <select value={newDaily.frequency} onChange={e => setNewDaily({...newDaily, frequency: e.target.value as 'weekly' | 'monthly'})} className="w-full bg-[#121212] border border-white/10 rounded-xl py-2 px-3 outline-none focus:border-brand-secondary text-sm [&>option]:bg-[#121212] [&>option]:text-white">
                      <option value="weekly">Semanal</option>
                      <option value="monthly">Mensal</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-white/40 uppercase font-bold">Categoria</label>
                    <select value={newDaily.category} onChange={e => setNewDaily({...newDaily, category: e.target.value})} className="w-full bg-[#121212] border border-white/10 rounded-xl py-2 px-3 outline-none focus:border-brand-secondary text-sm [&>option]:bg-[#121212] [&>option]:text-white">
                      {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                  </div>
                </div>
                <button type="submit" className="w-full bg-brand-secondary text-black py-3 rounded-xl font-bold text-sm tracking-wide hover:brightness-110 shadow-lg mt-2">
                  Adicionar Previsão
                </button>
              </form>

              <div className="grid grid-cols-1 gap-2 max-h-80 overflow-y-auto no-scrollbar pr-1">
                {dailyBills.length === 0 && <div className="text-center py-10 text-white/20 italic text-sm">Nenhum gasto estimado cadastrado.</div>}
                {dailyBills.map(bill => (
                  <div key={bill.id} className="group p-4 rounded-xl bg-white/5 border border-white/5 flex items-center justify-between hover:bg-white/10 transition-all">
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-xl bg-brand-secondary/10 flex items-center justify-center text-brand-secondary">
                        <TrendingDown size={20} />
                      </div>
                      <div>
                        <div className="text-sm font-bold">{bill.name}</div>
                        <div className="text-[10px] text-white/40">Frequência: {bill.frequency === 'weekly' ? 'Semanal' : 'Mensal'} • {bill.category}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-sm font-bold">R$ {bill.average_amount.toLocaleString('pt-BR')}</div>
                      <button onClick={() => handleDeleteDaily(bill.id)} className="p-2 text-white/20 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all">
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {activeTab === 'budget' && (
          <div className="space-y-6">
            <section className="glass-card !p-6 space-y-6 border-white/5">
              <div>
                <h3 className="text-lg font-bold mb-1 flex items-center gap-2">
                  <LayoutGrid className="text-brand-primary" size={20} /> Orçamentos por Categoria
                </h3>
                <p className="text-xs text-white/40">Defina limites mensais para cada categoria de gasto.</p>
              </div>

              <form onSubmit={handleAddBudget} className="bg-black/20 p-4 rounded-2xl border border-white/5 flex flex-col md:flex-row gap-4 items-end">
                <div className="flex-1 space-y-1 w-full">
                  <label className="text-[10px] text-white/40 uppercase font-bold">Categoria</label>
                  <select 
                    value={newBudget.category} 
                    onChange={e => setNewBudget({...newBudget, category: e.target.value})} 
                    className="w-full bg-[#121212] border border-white/10 rounded-xl py-2 px-3 outline-none focus:border-brand-primary text-sm [&>option]:bg-[#121212]"
                  >
                    {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </div>
                <div className="flex-1 space-y-1 w-full">
                  <label className="text-[10px] text-white/40 uppercase font-bold">Limite Mensal (R$)</label>
                  <input 
                    type="number" 
                    placeholder="0,00" 
                    required 
                    value={newBudget.amount} 
                    onChange={e => setNewBudget({...newBudget, amount: e.target.value})} 
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-2 px-3 outline-none focus:border-brand-primary text-sm" 
                  />
                </div>
                <button type="submit" className="w-full md:w-auto bg-brand-primary text-black px-6 py-2 rounded-xl font-bold text-xs hover:brightness-110 shadow-lg h-[42px]">
                  Configurar Limite
                </button>
              </form>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-96 overflow-y-auto no-scrollbar pr-1">
                {budgets.length === 0 && <div className="col-span-2 text-center py-10 text-white/20 italic text-sm">Nenhum orçamento configurado.</div>}
                {budgets.map(b => (
                  <div key={b.id} className="group p-4 rounded-xl bg-white/5 border border-white/5 flex items-center justify-between hover:bg-white/10 transition-all">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-lg bg-brand-primary/10 flex items-center justify-center text-brand-primary">
                        <Calculator size={16} />
                      </div>
                      <div>
                        <div className="text-sm font-bold">{b.category}</div>
                        <div className="text-[10px] text-white/40">Limite de gastos planejado</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-sm font-bold">R$ {b.limit_amount?.toLocaleString('pt-BR')}</div>
                      <button onClick={() => handleDeleteBudget(b.id)} className="p-2 text-white/20 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all">
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
