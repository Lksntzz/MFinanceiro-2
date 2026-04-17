import React, { useState, useEffect, useRef } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Transaction, UserSettings, FinanceSummary, FixedBill, DailyBill, CreditCard, CardInstallment, ImportedTransaction } from '../types';
import { calculateFinanceSummary } from '../lib/finance-calculations';
import { DEFAULT_USER_SETTINGS, CATEGORIES } from '../lib/constants';
import { User } from '@supabase/supabase-js';
import { 
  Wallet, 
  TrendingUp, 
  Calendar, 
  ArrowUpRight, 
  ArrowDownRight, 
  Plus, 
  Settings, 
  LogOut,
  AlertCircle,
  PieChart as PieChartIcon,
  History as HistoryIcon,
  CreditCard as CreditCardIcon,
  Database,
  X,
  Info,
  Check,
  CheckCircle2,
  Circle
} from 'lucide-react';
import {
  Chart as ChartJS,
  registerables
} from 'chart.js';
import { Line, Doughnut, Bar } from 'react-chartjs-2';
import { format, subDays, isAfter, isBefore, addDays, getDaysInMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { clearLegacyCache } from '../lib/clearCache';

ChartJS.register(...registerables);

import History from './History';
import Details from './Details';
import Insights from './Insights';
import BaseFinanceira from './BaseFinanceira';
import Cartoes from './Cartoes';
import ImportarExtratos from './ImportarExtratos';

export default function Dashboard({ user }: { user: User }) {
  useEffect(() => {
    clearLegacyCache();
  }, []);

  if (!supabase) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050505] text-white">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-white/70">
          Supabase não está configurado.
        </div>
      </div>
    );
  }

  const db = supabase;
  const [activeTab, setActiveTab] = useState<'overview' | 'details' | 'insights' | 'history' | 'base' | 'cards' | 'import'>('overview');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [fixedBills, setFixedBills] = useState<FixedBill[]>([]);
  const [dailyBills, setDailyBills] = useState<DailyBill[]>([]);
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [installments, setInstallments] = useState<CardInstallment[]>([]);
  const [missingTables, setMissingTables] = useState<string[]>([]);
  const [showSetupHelper, setShowSetupHelper] = useState(false);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTransaction, setNewTransaction] = useState({
    amount: '',
    category: 'Geral',
    description: '',
    type: 'expense' as 'expense' | 'income',
    status: 'paid' as 'paid' | 'pending'
  });
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [editSettings, setEditSettings] = useState<Partial<UserSettings>>({});
  const [rhythmFilter, setRhythmFilter] = useState<'day' | 'week' | 'month'>('day');
  const [showSalaryConfirmModal, setShowSalaryConfirmModal] = useState(false);
  const [salaryPromptKey, setSalaryPromptKey] = useState<string | null>(null);
  const [salaryPromptSlot, setSalaryPromptSlot] = useState<'payday_1' | 'payday_2' | null>(null);
  const [salaryPromptAmount, setSalaryPromptAmount] = useState(0);
  const [salaryPromptDayLabel, setSalaryPromptDayLabel] = useState('');
  const [salaryPromptProcessing, setSalaryPromptProcessing] = useState(false);
  const [showCardModal, setShowCardModal] = useState(false);
  const [editingCard, setEditingCard] = useState<CreditCard | null>(null);
  const [cardForm, setCardForm] = useState({
    name: '',
    brand: 'Visa',
    limit: '',
    used: '',
    closing_day: '1',
    due_day: '10',
  });
  const [showInstallmentModal, setShowInstallmentModal] = useState(false);
  const [editingInstallment, setEditingInstallment] = useState<CardInstallment | null>(null);
  const [installmentForm, setInstallmentForm] = useState({
    card_id: '',
    description: '',
    total_amount: '',
    monthly_amount: '',
    current_installment: '1',
    total_installments: '1',
  });
  const currentUserIdRef = useRef(user.id);
  const fetchVersionRef = useRef(0);

  useEffect(() => {
    currentUserIdRef.current = user.id;
  }, [user.id]);

  const parseTransactionDate = (raw: string): Date | null => {
    if (!raw) return null;

    if (raw.includes('T')) {
      const parsed = new Date(raw);
      if (!isNaN(parsed.getTime())) {
        return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 12, 0, 0, 0);
      }
    }

    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) {
      return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 12, 0, 0, 0);
    }

    const br = raw.match(/^(\d{2})[/-](\d{2})[/-](\d{2,4})/);
    if (br) {
      const day = Number(br[1]);
      const month = Number(br[2]);
      const year = Number(br[3].length === 2 ? `20${br[3]}` : br[3]);
      return new Date(year, month - 1, day, 12, 0, 0, 0);
    }

    const parsed = new Date(raw);
    if (isNaN(parsed.getTime())) return null;
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 12, 0, 0, 0);
  };

  const getPaydaySplitStorageKey = (userId: string): string => `mfinanceiro-payday-split:${userId}`;

  const getSalaryAmountForSlot = (slot: 'payday_1' | 'payday_2', currentSettings: UserSettings): number => {
    const netSalary = Math.max(0, Number(currentSettings.net_salary_estimated) || 0);
    if (currentSettings.payday_cycle !== 'biweekly') return netSalary;
    if (typeof window === 'undefined') return netSalary / 2;

    const raw = window.localStorage.getItem(getPaydaySplitStorageKey(user.id));
    let payday1Percent = 50;

    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        payday1Percent = Math.min(100, Math.max(0, Number(parsed?.payday1Percent) || 50));
      } catch {
        payday1Percent = 50;
      }
    }

    const payday2Percent = Math.max(0, 100 - payday1Percent);
    const slotPercent = slot === 'payday_1' ? payday1Percent : payday2Percent;
    return Math.round(((netSalary * slotPercent) / 100) * 100) / 100;
  };

  useEffect(() => {
    if (settings) {
      setEditSettings(settings);
    }
  }, [settings]);

  async function resilientLedgerInsert(entries: any | any[]) {
    const data = Array.isArray(entries) ? entries : [entries];
    const strategies: ((d: any) => any)[] = [
      (d: any) => ({
        user_id: d.user_id,
        date: d.date || new Date().toISOString(),
        description: d.description || 'Lançamento',
        amount: d.amount || 0,
        type: d.type || 'expense',
        category: d.category || 'Geral',
        source: d.source || 'Importado',
        status: d.status || 'paid'
      }),
      (d: any) => ({
        user_id: d.user_id,
        data: d.date || new Date().toISOString(),
        descricao: d.description || 'Lançamento',
        valor: d.amount || 0,
        tipo: d.type || 'expense',
        categoria: d.category || 'Geral',
        status: d.status || 'paid'
      }),
      (d: any) => ({
        user_id: d.user_id,
        date: d.date || new Date().toISOString(),
        data: d.date || new Date().toISOString(),
        description: d.description || 'Lançamento',
        descricao: d.description || 'Lançamento',
        amount: d.amount || 0,
        valor: d.amount || 0,
        type: d.type || 'expense',
        tipo: d.type || 'expense',
        category: d.category || 'Geral',
        categoria: d.category || 'Geral'
      }),
      (d: any) => ({
        user_id: d.user_id,
        amount: d.amount || 0
      })
    ];

    let lastError = null;
    for (let i = 0; i < strategies.length; i++) {
      try {
        const payload = data.map(strategies[i]);
        const { error } = await db.from('mf_finance_ledger_entries').insert(payload);
        if (!error) return { success: true };
        if (error.code === 'PGRST204' || error.code === '23502') {
          lastError = error;
          continue;
        }
        throw error;
      } catch (err: any) {
        lastError = err;
        if (i === strategies.length - 1) break;
      }
    }
    return { success: false, error: lastError?.message };
  }

  async function handleUpdateSettings(newSettings: UserSettings) {
    try {
      const { id, ...settingsToUpdate } = newSettings;
      const { error } = await db.from('mf_user_settings').update(settingsToUpdate).eq('user_id', user.id);
      if (error) {
        if (error.code === 'PGRST205' || error.code === 'PGRST204') {
          setSettings(newSettings);
          setShowSettingsModal(false);
          return;
        }
        throw error;
      }
      setSettings(newSettings);
      setShowSettingsModal(false);
    } catch (err: any) {
      console.error('Error updating settings:', err);
      // Fallback
      setSettings(newSettings);
      setShowSettingsModal(false);
    }
  }

  async function handleImportTransactions(imported: ImportedTransaction[]) {
    try {
      const validImported = imported.filter(item => item.amount > 0 && item.description && item.description !== 'Sem descricao');
      const seenSourceIds = new Set<string>();
      const uniqueImported = validImported.filter(item => {
        if (!item.source_id) return true;
        if (seenSourceIds.has(item.source_id)) return false;
        seenSourceIds.add(item.source_id);
        return true;
      });

      const newEntries = uniqueImported.map(item => ({
        user_id: user.id,
        date: item.date,
        description: item.description,
        amount: item.type === 'expense' ? -Math.abs(item.amount) : Math.abs(item.amount),
        type: item.type,
        category: item.category,
        source: item.bank_source || 'Importado'
      }));

      if (newEntries.length === 0) return;

      const result = await resilientLedgerInsert(newEntries);
      if (!result.success) throw new Error(result.error);

      const latestRunningBalanceItem = [...uniqueImported]
        .reverse()
        .find(item => typeof item.running_balance === 'number' && Number.isFinite(item.running_balance));
      const netImported = newEntries.reduce((sum, entry) => sum + entry.amount, 0);
      const nextBalance = latestRunningBalanceItem?.running_balance ?? (settings ? settings.current_balance + netImported : null);

      if (nextBalance !== null) {
        await db.from('mf_user_settings').update({ current_balance: nextBalance }).eq('user_id', user.id);
        if (settings) setSettings({ ...settings, current_balance: nextBalance });
      }

      fetchData();
    } catch (err) {
      console.error('Error importing transactions:', err);
    }
  }

  useEffect(() => {
    setSummary(null);
    fetchData();
    const channel = db.channel(`ledger_changes_${user.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'mf_finance_ledger_entries' }, () => { fetchData(); }).subscribe();
    return () => { db.removeChannel(channel); };
  }, [user.id]);

  useEffect(() => {
    if (settings) {
      const sum = calculateFinanceSummary(transactions, settings, fixedBills, cards, dailyBills, installments);
      setSummary(sum);
    }
  }, [transactions, settings, fixedBills, cards, dailyBills, installments]);

  useEffect(() => {
    if (!settings || loading) return;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
    const normalizedTodayDay = now.getDate();
    const paydayCandidates = [
      { slot: 'payday_1', day: settings.payday_1 || 1 },
      ...(settings.payday_cycle === 'biweekly' && settings.payday_2 ? [{ slot: 'payday_2', day: settings.payday_2 }] : [])
    ];
    const matchingCandidate = paydayCandidates.find(candidate => {
      const effectiveDay = Math.min(Math.max(1, candidate.day), getDaysInMonth(now));
      return effectiveDay === normalizedTodayDay;
    });
    if (!matchingCandidate) return;
    const promptKey = `salary-confirm:${user.id}:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}:${matchingCandidate.slot}`;
    if (localStorage.getItem(promptKey) === 'confirmed') return;
    const hasSalaryToday = transactions.some(t => {
      const parsed = parseTransactionDate(t.date);
      if (!parsed) return false;
      return parsed.getFullYear() === today.getFullYear() && parsed.getMonth() === today.getMonth() && parsed.getDate() === today.getDate() && (t.type === 'income' || t.amount > 0) && /(sal[aá]rio|pagamento|folha|remunera[cç][aã]o)/i.test(`${t.description || ''} ${t.category || ''}`);
    });
    if (hasSalaryToday) {
      localStorage.setItem(promptKey, 'confirmed');
      return;
    }
    setSalaryPromptKey(promptKey);
    setSalaryPromptSlot(matchingCandidate.slot as 'payday_1' | 'payday_2');
    setSalaryPromptAmount(getSalaryAmountForSlot(matchingCandidate.slot as 'payday_1' | 'payday_2', settings));
    setSalaryPromptDayLabel(format(now, 'dd/MM'));
    setShowSalaryConfirmModal(true);
  }, [settings, transactions, loading, user.id]);

  async function fetchData() {
    if (!user) return;
    const fetchVersion = ++fetchVersionRef.current;
    const isStale = () => fetchVersionRef.current !== fetchVersion;
    setLoading(true);
    let detectedMissing: string[] = [];
    try {
      // 1. Fetch settings
      const { data: settingsData, error: settingsError } = await db.from('mf_user_settings').select('*').eq('user_id', user.id).maybeSingle();
      
      if (settingsError) {
        if (settingsError.code !== 'PGRST116' && settingsError.code !== 'PGRST205' && settingsError.code !== 'PGRST204') {
          throw settingsError;
        }
      }

      let currentSettings = settingsData;
      let isFirstLogin = false;

      if (!settingsData) {
        // Bootstrap new user
        const def = DEFAULT_USER_SETTINGS(user.id);
        const { data: inserted, error: insertError } = await db.from('mf_user_settings').insert(def).select().maybeSingle();
        
        if (insertError) {
          console.error('Error bootstrapping user settings:', insertError);
          // Fallback to local state if DB insert fails (e.g. table not ready)
          currentSettings = { id: 'temp', ...def } as UserSettings;
        } else {
          currentSettings = inserted;
        }
        isFirstLogin = true;
      }

      if (!isStale()) setSettings(currentSettings);

      // 2. Fetch transactions
      const { data: transData, error: transError } = await db.from('mf_finance_ledger_entries').select('*').eq('user_id', user.id).order('date', { ascending: false });
      if (transError && transError.code !== 'PGRST204' && transError.code !== 'PGRST205') throw transError;
      
      const ledgerEntries = (transData || []).map((t: any) => ({ 
        ...t, 
        amount: Number(t.amount) || Number(t.valor) || 0, 
        type: t.type || t.tipo || (t.amount >= 0 ? 'income' : 'expense'), 
        description: t.description || t.descricao || 'Sem descrição', 
        category: t.category || t.categoria || 'Geral', 
        date: t.date || t.data 
      }));

      if (!isStale()) setTransactions(ledgerEntries);

      // Redirect if first login and no transactions
      if (isFirstLogin && ledgerEntries.length === 0 && !isStale()) {
        setActiveTab('base');
      }

      const { data: cardsData } = await db.from('mf_credit_cards').select('*').eq('user_id', user.id);
      if (!isStale()) setCards(cardsData || []);

      const { data: instData } = await db.from('mf_card_installments').select('*').eq('user_id', user.id);
      const normalizedInst = (instData || []).map((inst: any) => ({
        ...inst,
        description: inst.description || inst.descricao || 'Sem descrição',
        total_amount: Number(inst.total_amount) || Number(inst.valor_total) || 0,
        monthly_amount: Number(inst.monthly_amount) || Number(inst.valor_mensal) || 0,
        current_installment: Number(inst.current_installment) || Number(inst.parcela_atual) || 1,
        total_installments: Number(inst.total_installments) || Number(inst.total_parcelas) || 1,
        card_id: inst.card_id
      }));
      if (!isStale()) setInstallments(normalizedInst);

      const { data: daily } = await db.from('mf_daily_bills').select('*').eq('user_id', user.id);
      if (!isStale()) setDailyBills(daily || []);
    } catch (e: any) {
      console.error('Fetch error:', e);
      if (e.code === 'PGRST205' || e.code === 'PGRST204') detectedMissing.push('database structure');
    }
    if (!isStale()) {
      setMissingTables(detectedMissing);
      setLoading(false);
    }
  }

  async function handleToggleBillStatus(id: string) {
    const bill = fixedBills.find(b => b.id === id);
    if (!bill || !settings) return;
    const wasPaid = bill.status === 'paid';
    let paidDateForLedger = new Date();
    if (!wasPaid) {
      const paidDateInput = window.prompt(`Informe a data do pagamento de "${bill.name}" (dd/mm/aaaa):`, format(new Date(), 'dd/MM/yyyy'));
      if (!paidDateInput) return;
      const parts = paidDateInput.split('/');
      if (parts.length === 3) paidDateForLedger = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]), 12, 0, 0, 0);
      if (isNaN(paidDateForLedger.getTime())) { alert('Data inválida'); return; }
    }
    const balanceDelta = wasPaid ? Math.abs(bill.amount) : -Math.abs(bill.amount);
    try {
      await db.from('mf_fixed_bills').update({ status: wasPaid ? 'pending' : 'paid' }).eq('id', id);
      await resilientLedgerInsert({ user_id: user.id, amount: balanceDelta, category: 'Contas Fixas', description: (wasPaid ? 'Estorno: ' : 'Pagam.: ') + bill.name, type: balanceDelta >= 0 ? 'income' : 'expense', date: paidDateForLedger.toISOString() });
      const nextBalance = (Number(settings.current_balance) || 0) + balanceDelta;
      await db.from('mf_user_settings').update({ current_balance: nextBalance }).eq('user_id', user.id);
      fetchData();
    } catch (err) { console.error(err); }
  }

  async function handleAddTransaction(e: React.FormEvent) {
    e.preventDefault();
    try {
      const amt = parseFloat(newTransaction.amount);
      const finalAmt = newTransaction.type === 'expense' ? -Math.abs(amt) : Math.abs(amt);
      const { success } = await resilientLedgerInsert({ user_id: user.id, amount: finalAmt, category: newTransaction.category, description: newTransaction.description, type: newTransaction.type, date: new Date().toISOString() });
      if (success && settings) {
        const next = settings.current_balance + finalAmt;
        await db.from('mf_user_settings').update({ current_balance: next }).eq('user_id', user.id);
        setSettings({ ...settings, current_balance: next });
      }
      setShowAddModal(false);
      setNewTransaction({ amount: '', category: 'Geral', description: '', type: 'expense', status: 'paid' });
      fetchData();
    } catch (err) { console.error(err); }
  }

  async function handleDeleteTransaction(id: string) {
    try {
      await db.from('mf_finance_ledger_entries').delete().eq('id', id);
      fetchData();
    } catch (err) { console.error(err); }
  }

  async function handleDeleteAllTransactions() {
    if (!window.confirm('Apagar tudo?')) return;
    try {
      await db.from('mf_finance_ledger_entries').delete().eq('user_id', user.id);
      fetchData();
    } catch (err) { console.error(err); }
  }

  const openAddCardModal = () => { setEditingCard(null); setCardForm({ name: '', brand: '', limit: '', used: '0', closing_day: '1', due_day: '10' }); setShowCardModal(true); };
  const openEditCardModal = (card: CreditCard) => { setEditingCard(card); setCardForm({ name: card.name, brand: card.brand, limit: card.limit.toString(), used: card.used.toString(), closing_day: card.closing_day.toString(), due_day: card.due_day.toString() }); setShowCardModal(true); };
  const handleDeleteCard = async (card: CreditCard) => { if (window.confirm(`Deseja excluir o cartão ${card.name}?`)) { await db.from('mf_credit_cards').delete().eq('id', card.id); fetchData(); } };
  
  const handleSaveCard = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = { 
      user_id: user.id, 
      name: cardForm.name, 
      brand: cardForm.brand || 'Visa', 
      limit: Number(cardForm.limit), 
      used: Number(cardForm.used), 
      closing_day: Number(cardForm.closing_day), 
      due_day: Number(cardForm.due_day) 
    };
    
    try {
      if (editingCard) {
        const { error } = await db.from('mf_credit_cards').update(payload).eq('id', editingCard.id);
        if (error) throw error;
      } else {
        const { error } = await db.from('mf_credit_cards').insert(payload);
        if (error) throw error;
      }
      setShowCardModal(false); 
      fetchData();
    } catch (err: any) {
      console.error('Error saving card:', err);
      setError('Falha ao salvar cartão. Verifique sua conexão.');
    }
  };

  const openAddInstallmentModal = () => { 
    setEditingInstallment(null); 
    setInstallmentForm({ 
      card_id: cards[0]?.id || '', 
      description: '', 
      total_amount: '', 
      monthly_amount: '', 
      total_installments: '1', 
      current_installment: '1' 
    }); 
    setShowInstallmentModal(true); 
  };
  
  const openEditInstallmentModal = (inst: CardInstallment) => { 
    setEditingInstallment(inst); 
    setInstallmentForm({ 
      card_id: inst.card_id, 
      description: inst.description, 
      total_amount: inst.total_amount.toString(), 
      monthly_amount: inst.monthly_amount.toString(), 
      total_installments: inst.total_installments.toString(), 
      current_installment: inst.current_installment.toString() 
    }); 
    setShowInstallmentModal(true); 
  };
  
  const handleDeleteInstallment = async (inst: CardInstallment) => { 
    if (window.confirm(`Excluir parcelamento ${inst.description}?`)) { 
      try {
        const { error } = await db.from('mf_card_installments').delete().eq('id', inst.id); 
        if (error) throw error;
        fetchData(); 
      } catch (err: any) {
        console.error('Error deleting installment:', err);
        setError('Falha ao excluir parcelamento.');
      }
    } 
  };

  const handleSaveInstallment = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = { 
      user_id: user.id,
      card_id: (installmentForm.card_id === 'boleto' || !installmentForm.card_id) ? null : installmentForm.card_id, 
      description: installmentForm.description, 
      total_amount: Number(installmentForm.total_amount), 
      monthly_amount: Number(installmentForm.monthly_amount), 
      current_installment: Number(installmentForm.current_installment), 
      total_installments: Number(installmentForm.total_installments) 
    };

    try {
      if (editingInstallment) {
        const { error } = await db.from('mf_card_installments').update(payload).eq('id', editingInstallment.id);
        if (error) throw error;
      } else {
        // Try direct insert
        const { error } = await db.from('mf_card_installments').insert(payload);
        
        if (error) {
          console.warn('Direct insert failed, trying resilient strategy for installments:', error);
          
          // Strategy: Try Portuguese column names if English fails
          const ptPayload = {
            user_id: user.id,
            card_id: payload.card_id,
            descricao: payload.description,
            valor_total: payload.total_amount,
            valor_mensal: payload.monthly_amount,
            parcela_atual: payload.current_installment,
            total_parcelas: payload.total_installments
          };
          
          const { error: ptError } = await db.from('mf_card_installments').insert(ptPayload);
          if (ptError) throw ptError;
        }
      }
      
      setShowInstallmentModal(false); 
      fetchData();
    } catch (err: any) {
      console.error('Error saving installment:', err);
      setError('Falha ao salvar parcelamento. Verifique sua conexão ou se a tabela existe.');
      // Don't close modal so user doesn't lose data
    }
  };

  async function handleConfirmSalaryReceived() {
    if (!settings || !salaryPromptSlot) return;
    setSalaryPromptProcessing(true);
    try {
      const amt = getSalaryAmountForSlot(salaryPromptSlot, settings);
      await resilientLedgerInsert({ user_id: user.id, amount: amt, category: 'Salário', description: 'Salário Recebido', type: 'income', date: new Date().toISOString() });
      const next = settings.current_balance + amt;
      await db.from('mf_user_settings').update({ current_balance: next }).eq('user_id', user.id);
      if (salaryPromptKey) localStorage.setItem(salaryPromptKey, 'confirmed');
      setShowSalaryConfirmModal(false); fetchData();
    } catch (err) { console.error(err); } finally { setSalaryPromptProcessing(false); }
  }

  const latestOverviewTransactions = [...transactions].sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 3);
  const overviewCardsUsed = cards.reduce((s, c) => s + Number(c.used), 0);
  const overviewCardsLimit = cards.reduce((s, c) => s + Number(c.limit), 0);
  const overviewCardsAvailable = overviewCardsLimit - overviewCardsUsed;
  const overviewCardsUsagePercent = overviewCardsLimit > 0 ? (overviewCardsUsed / overviewCardsLimit) * 100 : 0;

  const timelineDays = 30;
  const dailyMap = new Map();
  const latestDate = transactions.length > 0 ? new Date(Math.max(...transactions.map(t => new Date(t.date).getTime()))) : new Date();
  const startDate = subDays(latestDate, timelineDays - 1);
  for (let d = startDate; !isAfter(d, latestDate); d = addDays(d, 1)) dailyMap.set(format(d, 'yyyy-MM-dd'), { net: 0, inflow: 0 });
  transactions.forEach(t => {
    const k = t.date.includes('T') ? t.date.split('T')[0] : t.date;
    if (dailyMap.has(k)) {
      dailyMap.get(k).net += t.amount;
      if (t.amount > 0) dailyMap.get(k).inflow += t.amount;
    }
  });
  const balanceSeries = []; let rb = (settings?.current_balance || 0) - Array.from(dailyMap.values()).reduce((s, v) => s + v.net, 0);
  dailyMap.forEach(v => { rb += v.net; balanceSeries.push(Number(rb.toFixed(2))); });

  const lineChartData = {
    labels: Array.from(dailyMap.keys()).map(k => format(new Date(k + 'T12:00:00'), 'dd/MM')),
    datasets: [{ label: 'Saldo', data: balanceSeries, borderColor: '#00f2ff', backgroundColor: 'rgba(0, 242, 255, 0.1)', fill: true, tension: 0.35 }]
  };

  const rhythmChartData = {
    labels: summary?.rhythm?.[rhythmFilter]?.labels || [],
    datasets: [
      { label: 'Saídas', data: summary?.rhythm?.[rhythmFilter]?.data || [], backgroundColor: 'rgba(239, 68, 68, 0.5)', borderColor: '#ef4444', borderWidth: 1, borderRadius: 4 },
      { label: 'Entradas', data: summary?.rhythm?.[rhythmFilter]?.incomeData || [], backgroundColor: 'rgba(34, 197, 94, 0.5)', borderColor: '#22c55e', borderWidth: 1, borderRadius: 4 }
    ]
  };

  const tabs = [
    { id: 'overview', label: 'Visão Geral' },
    { id: 'details', label: 'Detalhes' },
    { id: 'insights', label: 'Insights' },
    { id: 'base', label: 'Base Financeira' },
    { id: 'history', label: 'Histórico' },
    { id: 'cards', label: 'Cartões' },
    { id: 'import', label: 'Importar' },
  ] as const;

  return (
    <div className="min-h-screen w-full p-3 sm:p-4 flex flex-col gap-4 overflow-x-hidden bg-[#050505] text-white no-scrollbar">
      {missingTables.length > 0 && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Database className="text-yellow-500" size={18} />
            <div className="text-sm font-bold text-yellow-500">Configuração Incompleta</div>
          </div>
          <button onClick={() => setShowSetupHelper(true)} className="px-4 py-1.5 bg-yellow-500 text-black rounded-lg text-xs font-bold">Configurar</button>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 flex items-center justify-between animate-fade-in shrink-0">
          <div className="flex items-center gap-3">
            <AlertCircle className="text-red-400" size={18} />
            <div className="text-xs font-bold text-red-400">{error}</div>
          </div>
          <button onClick={() => setError(null)} className="p-1 text-red-400 hover:bg-red-500/10 rounded-lg">
            <X size={14} />
          </button>
        </div>
      )}

      <header className="flex flex-wrap items-center gap-3 shrink-0 mb-1">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-brand-primary to-brand-secondary flex items-center justify-center"><Wallet className="text-white" size={18} /></div>
          <h1 className="text-xl font-bold tracking-tight">MFinanceiro</h1>
        </div>
	        <nav className="order-3 w-full flex bg-white/5 p-1 rounded-xl border border-white/5 overflow-x-auto no-scrollbar">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`px-4 py-2 min-h-10 rounded-lg text-sm sm:text-xs font-bold transition-all whitespace-nowrap ${activeTab === tab.id ? 'bg-brand-primary text-black' : 'text-white/40 hover:text-white'}`}>{tab.label}</button>
          ))}
        </nav>
        <div className="flex items-center gap-3 ml-auto">
          <button onClick={() => setShowAddModal(true)} className="flex items-center gap-2 bg-brand-primary text-black px-3 py-2 min-h-10 rounded-lg font-bold text-sm hover:opacity-90 transition-opacity"><Plus size={16} /><span>Lançar</span></button>
          <button onClick={() => setShowSettingsModal(true)} className="p-2.5 min-h-10 min-w-10 text-white/60 hover:text-white transition-colors"><Settings size={18} /></button>
          <button onClick={async () => { await db.auth.signOut(); clearLegacyCache(); window.location.replace('/'); }} className="p-2.5 min-h-10 min-w-10 text-white/60 hover:text-white transition-colors"><LogOut size={18} /></button>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {activeTab === 'overview' && (
	          <main className="flex-1 min-h-0 grid grid-cols-2 xl:grid-cols-12 xl:grid-rows-[auto_auto_1.2fr_1fr_1.2fr] auto-rows-min gap-3 sm:gap-4 overflow-y-auto xl:overflow-hidden animate-fade-in pb-4">
	            <div className="col-span-1 xl:col-span-3 glass-card !p-3 sm:!p-4 flex flex-col justify-between">
              <span className="text-white/40 text-xs font-medium uppercase tracking-wider">Saldo Disponível</span>
	              <div className="text-xl sm:text-2xl font-bold">R$ {(summary?.currentBalance ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
            </div>
	            <div className="col-span-1 xl:col-span-3 glass-card !p-3 sm:!p-4 flex flex-col justify-between border-brand-primary/30">
              <span className="text-brand-primary text-xs font-medium uppercase tracking-wider">Limite Diário</span>
	              <div className="text-xl sm:text-2xl font-bold text-brand-primary">R$ {(summary?.dailyLimit ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
	            <div className="col-span-1 xl:col-span-3 glass-card !p-3 sm:!p-4 flex flex-col justify-between">
              <span className="text-white/40 text-xs font-medium uppercase tracking-wider">Dias Restantes</span>
	              <div className="text-xl sm:text-2xl font-bold">{summary?.daysRemaining ?? 0} dias</div>
            </div>
	            <div className="col-span-1 xl:col-span-3 glass-card !p-3 sm:!p-4 flex flex-col justify-between">
              <span className="text-white/40 text-xs font-medium uppercase tracking-wider">Gasto Hoje</span>
	              <div className={`text-xl sm:text-2xl font-bold ${summary && summary.todaySpent > summary.dailyLimit ? 'text-red-400' : 'text-white'}`}>R$ {(summary?.todaySpent ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
            </div>

	            <div className={`col-span-2 xl:col-span-6 glass-card !p-3 flex items-center gap-4 ${summary?.smartAlert?.type === 'danger' ? 'bg-red-500/10 border-red-500/30' : 'bg-brand-primary/5 border-brand-primary/20'}`}>
              <AlertCircle className={summary?.smartAlert?.type === 'danger' ? 'text-red-400' : 'text-brand-primary'} size={20} />
              <div className="flex-1 min-w-0"><h3 className="font-bold text-sm">Alerta Inteligente</h3><p className="text-xs text-white/70 truncate">{summary?.smartAlert?.message || "Ciclo estável."}</p></div>
            </div>
	            <div className="col-span-2 xl:col-span-6 glass-card !p-3 flex items-center gap-4 bg-brand-secondary/5 border-brand-secondary/20">
              <TrendingUp className="text-brand-secondary" size={20} />
              <div className="flex-1 min-w-0"><h3 className="font-bold text-sm">Insight do Dia</h3><p className="text-xs text-white/70 truncate">{summary?.dailyInsight || summary?.insights?.[0] || "Mantenha o ritmo."}</p></div>
            </div>

	            <div className="col-span-2 xl:col-span-8 glass-card !p-4 flex flex-col min-h-[260px] sm:min-h-[280px]">
              <h3 className="font-bold text-sm mb-2">Evolução do Saldo</h3>
              <div className="flex-1 min-h-0"><Line data={lineChartData} options={{ responsive: true, maintainAspectRatio: false, scales: { y: { ticks: { font: { size: 10 } } }, x: { ticks: { font: { size: 10 } } } } }} /></div>
            </div>
	            <div className="col-span-2 xl:col-span-4 glass-card !p-4 flex flex-col justify-between">
              <h3 className="font-bold text-sm mb-2">Resumo do Período</h3>
              <div className="space-y-3">
                <div className="flex justify-between text-xs"><span className="text-white/40">Média Diária</span><span className="font-bold">R$ {(summary?.averageDailySpent ?? 0).toLocaleString('pt-BR')}</span></div>
                <div className="flex justify-between text-xs"><span className="text-white/40">Maior Categoria</span><span className="font-bold text-brand-primary">{summary?.dominantCategory || 'Nenhuma'}</span></div>
              </div>
            </div>

	            <div className="col-span-2 xl:col-span-12 glass-card !p-4 flex flex-col min-h-[260px]">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-bold text-sm">Ritmo de Gastos</h3>
                <div className="flex bg-white/5 p-1 rounded-lg overflow-x-auto no-scrollbar">
                  {(['day', 'week', 'month'] as const).map(f => (
                    <button key={f} onClick={() => setRhythmFilter(f)} className={`px-3 py-2 min-h-9 rounded-md text-[11px] sm:text-[10px] font-bold uppercase transition-all whitespace-nowrap ${rhythmFilter === f ? 'bg-brand-primary text-black' : 'text-white/40 hover:text-white'}`}>{f === 'day' ? 'Dia' : f === 'week' ? 'Semana' : 'Mês'}</button>
                  ))}
                </div>
              </div>
              <div className="flex-1 min-h-0"><Line data={rhythmChartData} options={{ responsive: true, maintainAspectRatio: false }} /></div>
            </div>

	            <div className="col-span-2 sm:col-span-1 xl:col-span-4 glass-card !p-3 flex flex-col min-h-[190px]">
              <h3 className="font-bold text-xs mb-3 flex items-center justify-between"><span>Top Categorias</span><PieChartIcon size={14} className="text-white/40" /></h3>
              <div className="flex-1 space-y-2 overflow-y-auto no-scrollbar">{summary?.topCategories?.map(cat => (<div key={cat.name} className="flex flex-col gap-1"><div className="flex justify-between text-[10px]"><span className="text-white/70 truncate">{cat.name}</span><span className="font-bold">R$ {cat.amount.toFixed(0)}</span></div><div className="h-1 w-full bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-brand-primary" style={{ width: `${cat.percentage}%` }}></div></div></div>))}</div>
            </div>
	            <div className="col-span-2 sm:col-span-1 xl:col-span-4 glass-card !p-3 flex flex-col min-h-[190px]">
              <h3 className="font-bold text-xs mb-3 flex items-center justify-between"><span>Lançamentos</span><HistoryIcon size={14} className="text-white/40" /></h3>
              <div className="flex-1 space-y-2 overflow-y-auto no-scrollbar">{latestOverviewTransactions.map(t => (<div key={t.id} className="flex items-center justify-between text-[10px] p-2 bg-white/5 rounded-lg border border-white/5"><div className="truncate mr-2"><div className="font-bold truncate">{t.description || t.category}</div><div className="text-white/40">{format(new Date(t.date), 'dd/MM')}</div></div><div className={`font-bold shrink-0 ${t.type === 'income' ? 'text-green-400' : 'text-white'}`}>{t.type === 'income' ? '+' : '-'} {Math.abs(t.amount).toFixed(0)}</div></div>))}</div>
            </div>
	            <div className="col-span-2 sm:col-span-1 xl:col-span-4 glass-card !p-3 flex flex-col min-h-[190px]">
              <h3 className="font-bold text-xs mb-3 flex items-center justify-between"><span>Cartões</span><CreditCardIcon size={14} className="text-white/40" /></h3>
              <div className="flex-1 flex flex-col justify-center gap-3">
                <div className="flex justify-between text-[10px]"><span className="text-white/40">Utilizado</span><span className="font-bold">R$ {overviewCardsUsed.toLocaleString('pt-BR')}</span></div>
                <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-brand-secondary" style={{ width: `${overviewCardsUsagePercent}%` }}></div></div>
                <div className="flex justify-between items-center pt-2 border-t border-white/5"><span className="text-[10px] text-white/40">Disponível</span><span className="text-xs font-bold text-brand-primary">R$ {overviewCardsAvailable.toLocaleString('pt-BR')}</span></div>
              </div>
            </div>
          </main>
        )}

        {activeTab === 'details' && <Details transactions={transactions} summary={summary} />}
        {activeTab === 'insights' && <Insights summary={summary} />}
        {activeTab === 'history' && <History transactions={transactions} onDelete={handleDeleteTransaction} onDeleteAll={handleDeleteAllTransactions} />}
        {activeTab === 'cards' && <Cartoes cards={cards} installments={installments} onAddCard={openAddCardModal} onEditCard={openEditCardModal} onDeleteCard={handleDeleteCard} onAddInstallment={openAddInstallmentModal} onEditInstallment={openEditInstallmentModal} onDeleteInstallment={handleDeleteInstallment} />}
        {activeTab === 'import' && <ImportarExtratos onImport={handleImportTransactions} onCancel={() => setActiveTab('overview')} />}
        {activeTab === 'base' && <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4 pb-4"><div className="flex items-center justify-between gap-3 shrink-0"><h2 className="text-lg font-bold">Base Financeira</h2><button onClick={() => setShowSetupHelper(true)} className="flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs text-white/60 transition-all border border-white/10"><Database size={14} />Configurar</button></div>{settings ? <BaseFinanceira settings={settings} onSave={handleUpdateSettings} fixedBills={fixedBills} dailyBills={dailyBills} summary={summary} onToggleBillStatus={handleToggleBillStatus} onRefresh={fetchData} /> : <div className="flex-1 flex items-center justify-center text-white/40 animate-pulse">Carregando...</div>}</div>}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="glass-card w-full max-w-md animate-fade-in">
            <h2 className="text-xl font-bold mb-6">Novo Lançamento</h2>
            <form onSubmit={handleAddTransaction} className="space-y-4">
              <div><label className="block text-sm text-white/60 mb-1">Valor</label><input type="number" step="0.01" required value={newTransaction.amount} onChange={e => setNewTransaction({...newTransaction, amount: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none text-2xl font-bold" /></div>
              <div className="flex gap-2"><button type="button" onClick={() => setNewTransaction({...newTransaction, type: 'expense'})} className={`flex-1 p-3 rounded-xl border ${newTransaction.type === 'expense' ? 'bg-red-500/20 border-red-500 text-red-400' : 'bg-white/5 border-white/10 text-white/40'}`}>Saída</button><button type="button" onClick={() => setNewTransaction({...newTransaction, type: 'income'})} className={`flex-1 p-3 rounded-xl border ${newTransaction.type === 'income' ? 'bg-green-500/20 border-green-500 text-green-400' : 'bg-white/5 border-white/10 text-white/40'}`}>Entrada</button></div>
              <div><label className="block text-sm text-white/60 mb-1">Categoria</label><select value={newTransaction.category} onChange={e => setNewTransaction({...newTransaction, category: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl p-3 outline-none">
                {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select></div>
              <div><label className="block text-sm text-white/60 mb-1">Descrição</label><input type="text" value={newTransaction.description} onChange={e => setNewTransaction({...newTransaction, description: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none" placeholder="Ex: Almoço..." /></div>
              <div className="flex gap-3 pt-4"><button type="button" onClick={() => setShowAddModal(false)} className="flex-1 p-3 rounded-xl bg-white/5">Cancelar</button><button type="submit" className="flex-1 p-3 rounded-xl bg-brand-primary text-black font-bold">Confirmar</button></div>
            </form>
          </div>
        </div>
      )}

      {showSalaryConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="glass-card w-full max-w-md animate-fade-in p-6">
            <h2 className="text-xl font-bold mb-3">Confirmação de Salário</h2>
            <p className="text-sm text-white/70 leading-relaxed">Hoje ({salaryPromptDayLabel}) é dia de pagamento. Você já recebeu seu salário líquido de <span className="font-bold text-brand-primary">R$ {salaryPromptAmount.toLocaleString('pt-BR')}</span>?</p>
            <div className="flex gap-3 pt-5">
              <button onClick={() => setShowSalaryConfirmModal(false)} className="flex-1 p-3 rounded-xl bg-white/5">Ainda não</button>
              <button onClick={handleConfirmSalaryReceived} className="flex-1 p-3 rounded-xl bg-brand-primary text-black font-bold">Recebi</button>
            </div>
          </div>
        </div>
      )}

      {showSettingsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="glass-card w-full max-w-lg overflow-y-auto max-h-[90vh] no-scrollbar">
            <h2 className="text-xl font-bold mb-6 p-6 pb-0">Configurações Base</h2>
            <form onSubmit={(e) => { e.preventDefault(); handleUpdateSettings(editSettings as UserSettings); }} className="space-y-4 p-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className="text-sm text-white/60">Saldo Atual</label><input type="number" step="0.01" value={editSettings.current_balance} onChange={e => setEditSettings({...editSettings, current_balance: parseFloat(e.target.value)})} className="w-full bg-white/5 border border-white/10 rounded-xl p-3" /></div>
                <div><label className="text-sm text-white/60">Benefícios</label><input type="number" step="0.01" value={editSettings.benefits} onChange={e => setEditSettings({...editSettings, benefits: parseFloat(e.target.value)})} className="w-full bg-white/5 border border-white/10 rounded-xl p-3" /></div>
              </div>
              <div className="flex gap-3 pt-4"><button type="button" onClick={() => setShowSettingsModal(false)} className="flex-1 p-3 rounded-xl bg-white/5">Cancelar</button><button type="submit" className="flex-1 p-3 rounded-xl bg-brand-primary text-black font-bold">Salvar</button></div>
            </form>
          </div>
        </div>
      )}

      {showSetupHelper && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl glass-card !p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold">Configuração Manual</h2>
              <button onClick={() => setShowSetupHelper(false)}><X size={20} /></button>
            </div>
            <pre className="p-4 bg-black rounded-xl border border-white/10 text-[10px] text-brand-primary overflow-auto max-h-48">
              {`-- Scripts para o Supabase SQL Editor...`}
            </pre>
            <div className="flex gap-3 mt-6">
              <button onClick={() => { setShowSetupHelper(false); fetchData(); }} className="flex-1 py-3 bg-brand-primary text-black rounded-xl font-bold">Já executei o SQL</button>
            </div>
          </div>
        </div>
      )}

      {showCardModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="glass-card w-full max-w-md p-6">
            <h2 className="text-xl font-bold mb-6">{editingCard ? 'Editar Cartão' : 'Novo Cartão'}</h2>
            <form onSubmit={handleSaveCard} className="space-y-4">
              <input type="text" placeholder="Nome" required value={cardForm.name} onChange={e => setCardForm({...cardForm, name: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl p-3" />
              <input type="number" placeholder="Limite" required value={cardForm.limit} onChange={e => setCardForm({...cardForm, limit: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl p-3" />
              <div className="flex gap-3"><button type="button" onClick={() => setShowCardModal(false)} className="flex-1 p-3 rounded-xl bg-white/5">Cancelar</button><button type="submit" className="flex-1 p-3 rounded-xl bg-brand-primary text-black font-bold">Salvar</button></div>
            </form>
          </div>
        </div>
      )}

      {showInstallmentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto no-scrollbar">
          <div className="glass-card w-full max-w-md p-6">
            <h2 className="text-xl font-bold mb-6">{editingInstallment ? 'Editar Parcelamento' : 'Novo Parcelamento'}</h2>
            <form onSubmit={handleSaveInstallment} className="space-y-4">
              <div>
                <label className="text-[10px] text-white/40 uppercase font-bold mb-1 block">Fonte do Pagamento</label>
                <select 
                  required 
                  value={installmentForm.card_id || 'boleto'} 
                  onChange={e => setInstallmentForm({ ...installmentForm, card_id: e.target.value })} 
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-3"
                >
                  <option value="boleto">Boleto / Outros</option>
                  {cards.map(card => (<option key={card.id} value={card.id}>{card.name}</option>))}
                </select>
              </div>

              <div>
                <label className="text-[10px] text-white/40 uppercase font-bold mb-1 block">Descrição do Item</label>
                <input type="text" placeholder="Ex: iPhone 15, Notebook..." required value={installmentForm.description} onChange={e => setInstallmentForm({...installmentForm, description: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl p-3" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] text-white/40 uppercase font-bold mb-1 block">Valor Total</label>
                  <input type="number" step="0.01" placeholder="0.00" required value={installmentForm.total_amount} onChange={e => setInstallmentForm({...installmentForm, total_amount: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl p-3" />
                </div>
                <div>
                  <label className="text-[10px] text-white/40 uppercase font-bold mb-1 block">Valor da Parcela</label>
                  <input type="number" step="0.01" placeholder="0.00" required value={installmentForm.monthly_amount} onChange={e => setInstallmentForm({...installmentForm, monthly_amount: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl p-3" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] text-white/40 uppercase font-bold mb-1 block">Parcela Atual</label>
                  <input type="number" required value={installmentForm.current_installment} onChange={e => setInstallmentForm({...installmentForm, current_installment: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl p-3" />
                </div>
                <div>
                  <label className="text-[10px] text-white/40 uppercase font-bold mb-1 block">Total de Parcelas</label>
                  <input type="number" required value={installmentForm.total_installments} onChange={e => setInstallmentForm({...installmentForm, total_installments: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl p-3" />
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setShowInstallmentModal(false)} className="flex-1 p-3 rounded-xl bg-white/5">Cancelar</button>
                <button type="submit" className="flex-1 p-3 rounded-xl bg-brand-primary text-black font-bold">Salvar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

