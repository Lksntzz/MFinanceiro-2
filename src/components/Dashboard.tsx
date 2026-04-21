import React, { useState, useEffect, useRef, useMemo } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Transaction, UserSettings, FinanceSummary, FixedBill, DailyBill, CreditCard, CardInstallment, ImportedTransaction, Investment } from '../types';
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
  ShieldAlert,
  PieChart as PieChartIcon,
  History as HistoryIcon,
  CreditCard as CreditCardIcon,
  Database,
  X,
  Info,
  Check,
  CheckCircle2,
  Circle,
  Bell,
  Pencil,
  Eye,
  EyeOff,
  Sun,
  Moon,
  Crown,
  FileDown,
  PlayCircle,
  Heart,
  Calendar as CalendarIcon,
  Activity,
  Briefcase,
  Target,
  Brain,
  Layout,
  List
} from 'lucide-react';
import { ReportService } from '../services/reportService';
import { useApp } from '../context/AppContext';
import { formatCurrency, formatPercent, formatCompact } from '../lib/formatters';
import {
  Chart as ChartJS,
  registerables
} from 'chart.js';
import { Line, Doughnut, Bar } from 'react-chartjs-2';
import { format, subDays, isAfter, isBefore, addDays, getDaysInMonth, isSameDay, addMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { clearLegacyCache } from '../lib/clearCache';
import NotificationCenter from './NotificationCenter';
import AppUpdateNotification from './AppUpdateNotification';
import { AppUpdateInfo, fetchLatestAppUpdate } from '../lib/app-updates';
import { fetchMaintenanceConfig } from '../lib/maintenance';

ChartJS.register(...registerables);

import History from './History';
import Details from './Details';
import Insights from './Insights';
import BaseFinanceira from './BaseFinanceira';
import Cartoes from './Cartoes';
import ImportarExtratos from './ImportarExtratos';
import Investments from './Investments';
import FinancialGoals from './FinancialGoals';
import SubscriptionManager from './SubscriptionManager';
import FinancialHealth from './FinancialHealth';
import FinancialCalendar from './FinancialCalendar';
import AdminAccessRequests from './AdminAccessRequests';

export default function Dashboard({ user, isMaintenanceBypass }: { user: User, isMaintenanceBypass?: boolean }) {
  const { isPrivate, setIsPrivate, theme, setTheme } = useApp();
  
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
  const [activeTab, setActiveTab] = useState<'overview' | 'details' | 'insights' | 'history' | 'base' | 'cards' | 'import' | 'investments' | 'goals' | 'health' | 'subscriptions' | 'calendar' | 'access_requests'>('overview');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [fixedBills, setFixedBills] = useState<FixedBill[]>([]);
  const [dailyBills, setDailyBills] = useState<DailyBill[]>([]);
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [installments, setInstallments] = useState<CardInstallment[]>([]);
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [missingTables, setMissingTables] = useState<string[]>([]);
  const [showSetupHelper, setShowSetupHelper] = useState(false);
  const [showNotificationCenter, setShowNotificationCenter] = useState(false);
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
  const [showBalanceModal, setShowBalanceModal] = useState(false);
  const [tempBalance, setTempBalance] = useState('');
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
  const [latestUpdate, setLatestUpdate] = useState<AppUpdateInfo | null>(null);
  const [isUpdateOpen, setIsUpdateOpen] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState<{
    title: string;
    message: string;
    onConfirmed: () => void;
  } | null>(null);
  const [installmentForm, setInstallmentForm] = useState({
    card_id: '',
    description: '',
    total_amount: '',
    monthly_amount: '',
    current_installment: '1',
    total_installments: '1',
    due_day: '1'
  });
  const currentUserIdRef = useRef(user.id);
  const fetchVersionRef = useRef(0);
  const isAdminUser = useMemo(() => {
    const role = String(user.app_metadata?.role || '').toLowerCase();
    if (role === 'admin' || role === 'owner') return true;
    return user.user_metadata?.is_admin === true;
  }, [user]);

  useEffect(() => {
    let active = true;

    const loadLatestAppUpdate = async () => {
      try {
        const update = await fetchLatestAppUpdate(db);
        if (active && update) {
          const lastDismissed = localStorage.getItem(`mfinanceiro-update-dismissed:${user.id}`);
          if (lastDismissed !== update.version) {
            setLatestUpdate(update);
            setIsUpdateOpen(true);
          }
        }
      } catch (err) {
        console.warn('Silent update check failure:', err);
      }
    };

    const enforceMaintenanceLock = async () => {
      if (isMaintenanceBypass) return;
      try {
        const config = await fetchMaintenanceConfig(db);
        if (active && config?.maintenance_mode) {
          // If maintenance starts while user is inside, reload to trigger App.tsx maintenance check
          window.location.reload();
        }
      } catch (err) {
        console.warn('Maintenance check failure on interval:', err);
      }
    };

    loadLatestAppUpdate();
    const updateTimer = window.setInterval(loadLatestAppUpdate, 60000); // 1 minute
    const maintenanceTimer = window.setInterval(enforceMaintenanceLock, 30000); // 30 seconds

    return () => {
      active = false;
      window.clearInterval(updateTimer);
      window.clearInterval(maintenanceTimer);
    };
  }, [user.id, isMaintenanceBypass]);

  useEffect(() => {
    currentUserIdRef.current = user.id;
  }, [user.id]);

  useEffect(() => {
    if (!isAdminUser && activeTab === 'access_requests') {
      setActiveTab('overview');
    }
  }, [activeTab, isAdminUser]);

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
      setLoading(false); // Liberar UI o quanto antes

      // 2. Health check for tables (Parallel)
      const tablesToCheck = ['mf_finance_ledger_entries', 'mf_credit_cards', 'mf_card_installments', 'mf_daily_bills', 'mf_fixed_bills', 'mf_investments'];
      const healthResults = await Promise.all(tablesToCheck.map(t => db.from(t).select('id').limit(1)));
      healthResults.forEach((res, idx) => {
        if (res.error && (res.error.code === 'PGRST205' || res.error.code === 'PGRST204')) {
          detectedMissing.push(tablesToCheck[idx]);
        }
      });

      // 3. Fetch data
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
        due_day: Number(inst.due_day) || 1,
        last_paid_month: inst.last_paid_month,
        card_id: inst.card_id
      }));
      if (!isStale()) setInstallments(normalizedInst);

      const { data: daily } = await db.from('mf_daily_bills').select('*').eq('user_id', user.id);
      if (!isStale()) setDailyBills(daily || []);

      const { data: fixedData } = await db.from('mf_fixed_bills').select('*').eq('user_id', user.id);
      if (!isStale()) setFixedBills(fixedData || []);

      const { data: invData } = await db.from('mf_investments').select('*').eq('user_id', user.id);
      if (!isStale()) {
        const normalizedInv = (invData || []).map((inv: any) => ({
          ...inv,
          amount: Number(inv.amount || inv.valor || 0)
        }));
        setInvestments(normalizedInv);
      }
      
      if (!isStale()) setError(null);
    } catch (e: any) {
      console.error('Fetch error:', e);
      if (e.message?.includes('fetch') || e.name === 'TypeError') {
        if (!isStale()) setError('Erro de conexão com o banco de dados. Verifique seu sinal de internet.');
      } else if (e.code === 'PGRST205' || e.code === 'PGRST204') {
        detectedMissing.push('database structure');
      }
    }
    if (!isStale()) {
      setMissingTables(detectedMissing);
      setLoading(false);
    }
  }

  async function handleToggleBillStatus(id: string) {
    const bill = fixedBills.find(b => b.id === id);
    if (!bill || !settings || !user) return;
    
    const today = new Date();
    const currentMonth = format(today, 'yyyy-MM');
    const isAlreadyPaidThisMonth = bill.last_paid_month === currentMonth;

    let targetMonth = currentMonth;
    let message = `Deseja baixar o pagamento da conta "${bill.name}"?\n\nValor: R$ ${Math.abs(bill.amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\nEste valor será deduzido do seu saldo atual.`;

    if (isAlreadyPaidThisMonth) {
      const nextMonthDate = addMonths(today, 1);
      targetMonth = format(nextMonthDate, 'yyyy-MM');
      message = `Você já pagou esta conta este mês (${format(today, 'MMMM', { locale: ptBR })}).\n\nDeseja antecipar o pagamento do próximo mês (${format(nextMonthDate, 'MMMM', { locale: ptBR })})?\n\nValor: R$ ${Math.abs(bill.amount).toLocaleString('pt-BR')}`;
    }

    // Trava de saldo insuficiente
    if ((Number(settings.current_balance) || 0) < Math.abs(bill.amount)) {
      alert(`Saldo Insuficiente!\n\nVocê precisa de R$ ${Math.abs(bill.amount).toLocaleString('pt-BR')} para pagar esta conta, mas seu saldo atual é de R$ ${(Number(settings.current_balance) || 0).toLocaleString('pt-BR')}.`);
      return;
    }

    setConfirmConfig({
      title: isAlreadyPaidThisMonth ? 'Antecipar Pagamento' : 'Confirmar Pagamento',
      message: message,
      onConfirmed: async () => {
        try {
          setLoading(true);
          const balanceDelta = -Math.abs(bill.amount);
          
          // 1. Registro no Histórico
          await resilientLedgerInsert({ 
            user_id: user.id, 
            amount: balanceDelta, 
            category: bill.category || 'Contas Fixas', 
            description: `Pagam.: ${bill.name} (${targetMonth})`, 
            type: 'expense', 
            date: today.toISOString() 
          });

          // 2. Atualiza a conta fixa
          await db.from('mf_fixed_bills').update({ 
            status: 'paid',
            last_paid_month: targetMonth 
          }).eq('id', id);

          // 3. Atualiza saldo
          const nextBalance = (Number(settings.current_balance) || 0) + balanceDelta;
          await db.from('mf_user_settings').update({ current_balance: nextBalance }).eq('user_id', user.id);
          
          if (settings) setSettings({ ...settings, current_balance: nextBalance });
          fetchData();
        } catch (err) { 
          console.error('[ERROR] handleToggleBillStatus:', err);
          alert('Erro ao processar pagamento.');
        } finally {
          setLoading(false);
          setConfirmConfig(null);
        }
      }
    });
  }

  async function handleAddTransaction(e: React.FormEvent) {
    e.preventDefault();
    try {
      const amt = parseFloat(newTransaction.amount);
      if (isNaN(amt)) return;

      const finalAmt = newTransaction.type === 'expense' ? -Math.abs(amt) : Math.abs(amt);
      
      // Trava de saldo insuficiente para despesas manuais pagas
      if (newTransaction.type === 'expense' && newTransaction.status === 'paid' && (Number(settings.current_balance) || 0) < Math.abs(amt)) {
        alert(`Saldo Insuficiente!\n\nSeu saldo atual é R$ ${(Number(settings.current_balance) || 0).toLocaleString('pt-BR')}, insuficiente para este lançamento de R$ ${Math.abs(amt).toLocaleString('pt-BR')}.`);
        return;
      }

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
    const transaction = transactions.find(t => t.id === id);
    if (!transaction || !settings || !user) return;

    setConfirmConfig({
      title: 'Excluir Lançamento',
      message: `Deseja realmente excluir "${transaction.description}"?\n\nO valor de R$ ${Math.abs(transaction.amount).toLocaleString('pt-BR')} será ${transaction.amount < 0 ? 'devolvido ao' : 'removido do'} seu saldo.`,
      onConfirmed: async () => {
        try {
          // 1. Reverte o saldo
          const reverseAmount = -transaction.amount; // Se era -100 (despesa), vira +100
          const nextBalance = (Number(settings.current_balance) || 0) + reverseAmount;
          
          await db.from('mf_user_settings').update({ current_balance: nextBalance }).eq('user_id', user.id);
          
          // 2. Deleta a transação
          await db.from('mf_finance_ledger_entries').delete().eq('id', id);
          
          setSettings({ ...settings, current_balance: nextBalance });
          fetchData();
        } catch (err) { 
          console.error('Erro ao excluir transação:', err);
          alert('Falha ao processar a exclusão.');
        } finally {
          setConfirmConfig(null);
        }
      }
    });
  }

  async function handleDeleteAllTransactions() {
    setConfirmConfig({
      title: 'Limpar Histórico e Zerar Saldo',
      message: 'Tem certeza que deseja apagar TODOS os lançamentos do histórico? Isso também zerará seu saldo disponível para R$ 0,00.',
      onConfirmed: async () => {
        try {
          // 1. Zerar saldo no banco
          await db.from('mf_user_settings').update({ current_balance: 0 }).eq('user_id', user.id);
          
          // 2. Apagar todas as transações
          await db.from('mf_finance_ledger_entries').delete().eq('user_id', user.id);
          
          // 3. Atualizar estado local
          if (settings) setSettings({ ...settings, current_balance: 0 });
          fetchData();
        } catch (err) { 
          console.error('[ERROR] Falha ao limpar histórico:', err);
          alert('Erro ao processar limpeza total.');
        } finally {
          setConfirmConfig(null);
        }
      }
    });
  }

  const openAddCardModal = () => { setEditingCard(null); setCardForm({ name: '', brand: '', limit: '', used: '0', closing_day: '1', due_day: '10' }); setShowCardModal(true); };
  const openEditCardModal = (card: CreditCard) => { setEditingCard(card); setCardForm({ name: card.name, brand: card.brand, limit: card.limit.toString(), used: card.used.toString(), closing_day: card.closing_day.toString(), due_day: card.due_day.toString() }); setShowCardModal(true); };
  const handleDeleteCard = async (card: CreditCard) => { 
    setConfirmConfig({
      title: 'Excluir Cartão',
      message: `Deseja realmente excluir o cartão "${card.name}"?\n\nOs parcelamentos vinculados a este cartão não serão apagados, mas ficarão sem cartão associado.`,
      onConfirmed: async () => {
        try {
          await db.from('mf_credit_cards').delete().eq('id', card.id); 
          fetchData(); 
        } catch (err) { console.error(err); }
        setConfirmConfig(null);
      }
    });
  };
  
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
      current_installment: '1',
      due_day: '1'
    }); 
    setShowInstallmentModal(true); 
  };
  
  const openEditInstallmentModal = (inst: CardInstallment) => { 
    setEditingInstallment(inst); 
    setInstallmentForm({ 
      card_id: inst.card_id || 'boleto', 
      description: inst.description, 
      total_amount: inst.total_amount.toString(), 
      monthly_amount: inst.monthly_amount.toString(), 
      total_installments: inst.total_installments.toString(), 
      current_installment: inst.current_installment.toString(),
      due_day: (inst.due_day || 1).toString()
    }); 
    setShowInstallmentModal(true); 
  };

  const handlePayInstallment = async (inst: CardInstallment) => {
    if (!settings || !user) {
      alert('Sessão ou configurações não carregadas. Tente atualizar a página.');
      return;
    }

    const today = new Date();
    const currentMonth = format(today, 'yyyy-MM');
    const isAlreadyPaidThisMonth = inst.last_paid_month === currentMonth;
    
    let targetMonth = currentMonth;
    const monthlyAmount = Number(inst.monthly_amount) || 0;
    let message = `Deseja baixar o pagamento da parcela ${inst.current_installment}/${inst.total_installments} de "${inst.description}"?\n\nValor: R$ ${monthlyAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\nEste valor será deduzido do seu saldo atual.`;

    if (isAlreadyPaidThisMonth) {
      const nextMonthDate = addMonths(today, 1);
      targetMonth = format(nextMonthDate, 'yyyy-MM');
      message = `Você já pagou a parcela deste mês (${format(today, 'MMMM', { locale: ptBR })}).\n\nDeseja antecipar o pagamento da próxima parcela (${format(nextMonthDate, 'MMMM', { locale: ptBR })})?\n\nValor: R$ ${monthlyAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    }
    
    // Trava de saldo insuficiente
    if ((Number(settings.current_balance) || 0) < monthlyAmount) {
      alert(`Saldo Insuficiente!\n\nO valor da parcela é R$ ${monthlyAmount.toLocaleString('pt-BR')}, mas seu saldo atual é de R$ ${(Number(settings.current_balance) || 0).toLocaleString('pt-BR')}.`);
      return;
    }

    setConfirmConfig({
      title: isAlreadyPaidThisMonth ? 'Antecipar Pagamento' : 'Confirmar Pagamento',
      message: message,
      onConfirmed: async () => {
        try {
          setLoading(true);
          const amount = -Math.abs(monthlyAmount);
          
          // 1. Registro no Histórico
          await resilientLedgerInsert({
            user_id: user.id,
            amount: amount,
            category: 'Parcelamentos',
            description: `Pagam. Parcela ${inst.current_installment}/${inst.total_installments}: ${inst.description} (${targetMonth})`,
            type: 'expense',
            date: today.toISOString()
          });

          // 2. Atualiza Saldo
          const nextBalance = (Number(settings.current_balance) || 0) + amount;
          await db.from('mf_user_settings').update({ current_balance: nextBalance }).eq('user_id', user.id);
          
          // 3. Atualiza o Parcelamento
          const nextInstallmentNum = inst.current_installment + 1;
          const { error: instError } = await db.from('mf_card_installments').update({
            last_paid_month: targetMonth,
            current_installment: nextInstallmentNum
          }).eq('id', inst.id).eq('user_id', user.id);

          if (instError) throw instError;

          setSettings(prev => prev ? { ...prev, current_balance: nextBalance } : null);
          fetchData();
        } catch (err: any) {
          console.error('[ERROR] handlePayInstallment:', err);
          alert(`Erro: ${err.message || 'Falha ao processar pagamento.'}`);
        } finally {
          setLoading(false);
          setConfirmConfig(null);
        }
      }
    });
  };
  
  const handleDeleteInstallment = async (inst: CardInstallment) => { 
    setConfirmConfig({
      title: 'Excluir Parcelamento',
      message: `Deseja realmente excluir o parcelamento "${inst.description}"?`,
      onConfirmed: async () => {
        try {
          const { error } = await db.from('mf_card_installments').delete().eq('id', inst.id); 
          if (error) throw error;
          fetchData(); 
        } catch (err: any) {
          console.error('Error deleting installment:', err);
          setError('Falha ao excluir parcelamento.');
        } finally {
          setConfirmConfig(null);
        }
      }
    });
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
      total_installments: Number(installmentForm.total_installments),
      due_day: Number(installmentForm.due_day) 
    };

    try {
      if (editingInstallment) {
        const { error } = await db.from('mf_card_installments').update(payload).eq('id', editingInstallment.id);
        if (error) throw error;
      } else {
        const { error } = await db.from('mf_card_installments').insert(payload);
        if (error) throw error;
      }
      
      setShowInstallmentModal(false); 
      fetchData();
    } catch (err: any) {
      console.error('Error saving installment:', err);
      // Extrai a mensagem de erro real ou fornece uma alternativa clara
      const errorMessage = err.message || JSON.stringify(err) || 'Falha ao conectar com o banco de dados.';
      setError(`Erro ao salvar: ${errorMessage}`);
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

  const notifications = useMemo(() => {
    const alerts: any[] = [];
    const today = new Date();
    const todayDay = today.getDate();
    const currentMonthStr = format(today, 'yyyy-MM');

    // Helper para calcular próximo vencimento
    const getNextDueDate = (dueDay: number, lastPaidMonth?: string) => {
      const d = new Date(today.getFullYear(), today.getMonth(), dueDay, 12, 0, 0, 0);
      if (lastPaidMonth === currentMonthStr) {
        return addMonths(d, 1);
      }
      return d;
    };

    // 1. Contas Fixas
    fixedBills.forEach(bill => {
      const nextDate = getNextDueDate(bill.due_day || 1, bill.last_paid_month);
      const isOverdue = isBefore(nextDate, today) && !isSameDay(nextDate, today) && bill.last_paid_month !== currentMonthStr;
      const isDueToday = isSameDay(nextDate, today);
      
      // Mostra todas as contas fixas para que o usuário veja o "próximo boleto"
      alerts.push({
        id: `fixed-${bill.id}`,
        type: 'fixed',
        title: bill.name,
        amount: bill.amount,
        dueDate: bill.due_day,
        nextDueDateLabel: format(nextDate, "dd 'de' MMMM", { locale: ptBR }),
        status: isDueToday ? 'due_today' : (isOverdue ? 'overdue' : 'pending'),
        originalData: bill
      });
    });

    // 2. Parcelamentos
    installments.forEach(inst => {
      const isFinished = inst.current_installment > inst.total_installments;
      if (!isFinished) {
        const nextDate = getNextDueDate(inst.due_day || 1, inst.last_paid_month);
        const isOverdue = isBefore(nextDate, today) && !isSameDay(nextDate, today) && inst.last_paid_month !== currentMonthStr;
        const isDueToday = isSameDay(nextDate, today);

        alerts.push({
          id: `inst-${inst.id}`,
          type: 'installment',
          title: inst.description,
          amount: inst.monthly_amount,
          dueDate: inst.due_day,
          nextDueDateLabel: format(nextDate, "dd 'de' MMMM", { locale: ptBR }),
          status: isDueToday ? 'due_today' : (isOverdue ? 'overdue' : 'pending'),
          originalData: inst
        });
      }
    });

    // 3. Cartões
    cards.forEach(card => {
      if (card.used > 0) {
        const nextDate = new Date(today.getFullYear(), today.getMonth(), card.due_day, 12, 0, 0, 0);
        const isOverdue = isBefore(nextDate, today) && !isSameDay(nextDate, today);
        const isDueToday = isSameDay(nextDate, today);

        alerts.push({
          id: `card-${card.id}`,
          type: 'card',
          title: `Fatura: ${card.name}`,
          amount: card.used,
          dueDate: card.due_day,
          nextDueDateLabel: format(nextDate, "dd 'de' MMMM", { locale: ptBR }),
          status: isDueToday ? 'due_today' : (isOverdue ? 'overdue' : 'pending'),
          originalData: card
        });
      }
    });

    return alerts.sort((a, b) => {
        // Ordena por urgência primário
        const priority = { overdue: 0, due_today: 1, pending: 2 };
        if (priority[a.status] !== priority[b.status]) return priority[a.status] - priority[b.status];
        return a.dueDate - b.dueDate;
    });
  }, [fixedBills, installments, cards]);

  const handlePayCardBill = async (card: CreditCard) => {
    if (!settings || !user) return;
    
    const amountToPay = Number(card.used) || 0;
    if (amountToPay <= 0) {
      alert('Não há saldo devedor neste cartão.');
      return;
    }

    // Trava de saldo insuficiente
    if ((Number(settings.current_balance) || 0) < amountToPay) {
      alert(`Saldo Insuficiente!\n\nA fatura deste cartão é R$ ${amountToPay.toLocaleString('pt-BR')}, mas seu saldo atual é de R$ ${(Number(settings.current_balance) || 0).toLocaleString('pt-BR')}.`);
      return;
    }

    const confirmMsg = `Deseja baixar o pagamento total da fatura do cartão "${card.name}"?\n\nValor: R$ ${amountToPay.toLocaleString('pt-BR')}\nEste valor será deduzido do seu saldo atual.`;

    setConfirmConfig({
      title: 'Confirmar Pagamento de Fatura',
      message: confirmMsg,
      onConfirmed: async () => {
        try {
          setLoading(true);
          const today = new Date();
          
          // 1. Registro no Histórico
          const ledgerResult = await resilientLedgerInsert({
            user_id: user.id,
            amount: -amountToPay,
            category: 'Cartão de Crédito',
            description: `Pagamento Fatura: ${card.name}`,
            type: 'expense',
            date: today.toISOString()
          });

          if (ledgerResult.error) throw new Error(ledgerResult.error);

          // 2. Abate do Saldo
          const nextBalance = (Number(settings.current_balance) || 0) - amountToPay;
          const { error: settingsError } = await db.from('mf_user_settings').update({ current_balance: nextBalance }).eq('user_id', user.id);
          if (settingsError) throw settingsError;

          // 3. Zera o uso do cartão
          const { error: cardError } = await db.from('mf_credit_cards').update({ used: 0 }).eq('id', card.id);
          if (cardError) throw cardError;

          setSettings(prev => prev ? { ...prev, current_balance: nextBalance } : null);
          alert('Pagamento da fatura realizado com sucesso!');
          fetchData();
        } catch (err: any) {
          console.error('Erro pagando fatura:', err);
          alert(`Falha ao processar pagamento: ${err.message || 'Erro interno.'}`);
        } finally {
          setLoading(false);
          setConfirmConfig(null);
        }
      }
    });
  };

  const handleNotificationPay = async (item: any) => {
    if (item.type === 'installment') {
      await handlePayInstallment(item.originalData);
    } else if (item.type === 'fixed') {
      await handleToggleBillStatus(item.originalData.id);
    } else if (item.type === 'card') {
      await handlePayCardBill(item.originalData);
    }
  };

  const urgentNotifications = useMemo(() => notifications.filter(n => n.status === 'due_today' || n.status === 'overdue'), [notifications]);

  const overviewTopCategories = useMemo(() => {
    const last30Days = subDays(new Date(), 30);
    let expenses = transactions.filter(t => t.type === 'expense' && new Date(t.date) >= last30Days);
    
    // Se não houver despesas nos últimos 30 dias, mostra as do mês atual
    if (expenses.length === 0) {
      expenses = transactions.filter(t => t.type === 'expense');
    }
    
    const totals: Record<string, number> = {};
    let totalSpent = 0;
    
    expenses.forEach(t => {
      const amt = Math.abs(t.amount || 0);
      totals[t.category] = (totals[t.category] || 0) + amt;
      totalSpent += amt;
    });

    return Object.entries(totals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, amount]) => ({
        name,
        amount,
        percentage: totalSpent > 0 ? (amount / totalSpent) * 100 : 0
      }));
  }, [transactions]);

  const latestOverviewTransactions = useMemo(() => 
    [...transactions]
      .sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 5),
  [transactions]);
  const overviewCardsUsed = cards.reduce((s, c) => s + Number(c.used), 0);
  const overviewCardsLimit = cards.reduce((s, c) => s + Number(c.limit), 0);
  const overviewCardsAvailable = overviewCardsLimit - overviewCardsUsed;
  const overviewCardsUsagePercent = overviewCardsLimit > 0 ? (overviewCardsUsed / overviewCardsLimit) * 100 : 0;

  const timelineDays = 30;
  const dailyMap = new Map();
  const today = new Date();
  const todayKey = format(today, 'yyyy-MM-dd');
  const startDate = subDays(today, timelineDays - 1);
  
  // Inicializa o mapa com os últimos 30 dias
  for (let d = startDate; !isAfter(d, today); d = addDays(d, 1)) {
    dailyMap.set(format(d, 'yyyy-MM-dd'), { net: 0, inflow: 0 });
  }

  // Preenche com as transações
  transactions.forEach(t => {
    const k = t.date.includes('T') ? t.date.split('T')[0] : t.date;
    if (dailyMap.has(k)) {
      dailyMap.get(k).net += t.amount;
      if (t.amount > 0) dailyMap.get(k).inflow += t.amount;
    }
  });

  // Calcula a série de saldo real de forma progressiva respeitando o saldo atual
  const dailyKeys = Array.from(dailyMap.keys());
  let firstActivityIdx = -1;
  
  // Encontra o dia da primeira transação no período
  for (let i = 0; i < dailyKeys.length; i++) {
    const dayData = dailyMap.get(dailyKeys[i]);
    if (dayData.net !== 0 || dayData.inflow !== 0) {
      firstActivityIdx = i;
      break;
    }
  }

  // Se não houve transação, a "atividade" é o ajuste manual de hoje
  if (firstActivityIdx === -1) {
    firstActivityIdx = dailyKeys.length - 1;
  }

  const balanceSeries: number[] = new Array(dailyKeys.length).fill(0);
  let movingBalance = settings?.current_balance || 0;

  // Preenche de trás para frente, do dia atual até a primeira atividade encontrada
  // Isso garante que o ponto final (hoje) seja exatamente o saldo atual configurado
  for (let i = dailyKeys.length - 1; i >= firstActivityIdx; i--) {
    balanceSeries[i] = Number(Math.max(0, movingBalance).toFixed(2));
    movingBalance -= dailyMap.get(dailyKeys[i]).net;
  }

  const lineChartData = {
    labels: dailyKeys.map(k => format(new Date(k + 'T12:00:00'), 'dd/MM')),
    datasets: [{ 
      label: 'Saldo', 
      data: balanceSeries, 
      borderColor: '#00f2ff', 
      backgroundColor: 'rgba(0, 242, 255, 0.1)', 
      fill: true, 
      tension: 0.35,
      pointRadius: 2,
      pointHoverRadius: 6,
      borderWidth: 2
    }]
  };

  const rhythmChartData = {
    labels: summary?.rhythm?.[rhythmFilter]?.labels || [],
    datasets: [
      { 
        label: 'Saídas', 
        data: summary?.rhythm?.[rhythmFilter]?.data || [], 
        borderColor: '#ef4444', 
        backgroundColor: 'rgba(239, 68, 68, 0.1)', 
        borderWidth: 2, 
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 4
      },
      { 
        label: 'Entradas', 
        data: summary?.rhythm?.[rhythmFilter]?.incomeData || [], 
        borderColor: '#22c55e', 
        backgroundColor: 'rgba(34, 197, 94, 0.1)', 
        borderWidth: 2, 
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 4
      }
    ]
  };

  const handleUpdateBalance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !settings) return;
    
    try {
      setLoading(true);
      const newAmount = parseFloat(tempBalance) || 0;
      const { error } = await db.from('mf_user_settings').update({ current_balance: newAmount }).eq('user_id', user.id);
      if (error) throw error;
      
      setSettings({ ...settings, current_balance: newAmount });
      setShowBalanceModal(false);
      fetchData();
    } catch (err: any) {
      console.error('Erro ao atualizar saldo:', err);
      alert('Falha ao atualizar saldo.');
    } finally {
      setLoading(false);
    }
  };

  const baseToolGroups = [
    {
      id: 'monitor',
      label: 'Análise',
      icon: Activity,
      tabs: [
        { id: 'overview', label: 'Dashboard' },
        { id: 'details', label: 'Estatísticas' },
        { id: 'insights', label: 'Insights AI' },
        { id: 'health', label: 'Saúde' },
      ]
    },
    {
      id: 'ops',
      label: 'Operações',
      icon: List,
      tabs: [
        { id: 'history', label: 'Lançamentos' },
        { id: 'cards', label: 'Cartões' },
        { id: 'import', label: 'Importar' },
      ]
    },
    {
      id: 'plan',
      label: 'Escopo',
      icon: Calendar,
      tabs: [
        { id: 'calendar', label: 'Calendário' },
        { id: 'subscriptions', label: 'Assinaturas' },
        { id: 'goals', label: 'Metas' },
      ]
    },
    {
      id: 'wealth',
      label: 'Capital',
      icon: Briefcase,
      tabs: [
        { id: 'investments', label: 'Investimentos' },
      ]
    }
  ];

  const toolGroups = isAdminUser
    ? [
        ...baseToolGroups,
        {
          id: 'admin',
          label: 'Admin',
          icon: ShieldAlert,
          tabs: [{ id: 'access_requests', label: 'Solicitações de acesso' }],
        },
      ]
    : baseToolGroups;

  const allTabs = toolGroups.flatMap(g => g.tabs);

  return (
    <div className="h-screen w-full p-4 flex flex-col gap-4 overflow-hidden bg-[#050505] text-white no-scrollbar">
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

      <header className="flex items-center justify-between gap-3 shrink-0 mb-2">
        <div className="flex items-center gap-4 shrink-0">
          <div className="flex bg-white/5 p-1 rounded-xl border border-white/5">
            <button 
              onClick={() => setIsPrivate(!isPrivate)} 
              className="p-1.5 rounded-lg text-white/40 hover:text-white transition-all"
              title={isPrivate ? "Mostrar Valores" : "Ocultar Valores"}
            >
              {isPrivate ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
            <div className="w-[1px] h-4 bg-white/10 mx-1 my-auto" />
            <button 
              onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'gold' : 'dark')} 
              className="p-1.5 rounded-lg text-white/40 hover:text-white transition-all"
              title="Trocar Tema"
            >
              {theme === 'dark' ? <Moon size={16} /> : theme === 'light' ? <Sun size={16} /> : <Crown size={16} className="text-yellow-500" />}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-brand-primary to-brand-secondary flex items-center justify-center"><Wallet className="text-white" size={18} /></div>
            <h1 className="text-xl font-bold tracking-tight">MFinanceiro</h1>
            {isMaintenanceBypass && (
              <div className="ml-2 flex items-center gap-2 px-3 py-1 bg-yellow-500/10 border border-yellow-500/20 rounded-full animate-pulse">
                <ShieldAlert size={12} className="text-yellow-500" />
                <span className="text-[10px] font-bold text-yellow-500 uppercase tracking-wider">Manutenção ativa</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex-1 min-w-0 mx-2">
          <nav className="w-full overflow-x-auto no-scrollbar">
            <div className="w-max min-w-full flex items-center gap-2 px-1">
              {toolGroups.map(group => (
                <div key={group.id} className="shrink-0 flex bg-white/5 p-1 rounded-xl border border-white/5 items-center gap-1">
                  <div className="px-2 text-white/30 hidden lg:block">
                    <group.icon size={14} />
                  </div>
                  <div className="flex gap-1">
                    {group.tabs.map(tab => (
                      <button 
                        key={tab.id} 
                        onClick={() => setActiveTab(tab.id as any)} 
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${activeTab === tab.id ? 'bg-brand-primary text-black' : 'text-white/40 hover:text-white hover:bg-white/5'}`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </nav>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button 
            onClick={() => setShowNotificationCenter(true)}
            className="relative p-2 text-white/60 hover:text-white transition-colors bg-white/5 rounded-lg border border-white/5"
          >
            <Bell size={18} />
            {urgentNotifications && urgentNotifications.length > 0 && (
              <span className="absolute -top-1 -right-1 h-4 w-4 bg-brand-primary text-[10px] text-black font-bold rounded-full flex items-center justify-center animate-pulse shadow-[0_0_10px_rgba(0,242,255,0.4)]">
                {urgentNotifications.length}
              </span>
            )}
          </button>
          <button onClick={() => setShowAddModal(true)} className="flex items-center gap-2 bg-brand-primary text-black px-3 py-1.5 rounded-lg font-bold text-sm hover:opacity-90 transition-opacity"><Plus size={16} /><span>Lançar</span></button>
          <button 
            onClick={() => setActiveTab('base')} 
            className={`p-1.5 transition-colors ${activeTab === 'base' ? 'text-brand-primary' : 'text-white/60 hover:text-white'}`}
          >
            <Settings size={18} />
          </button>
          <button onClick={async () => { await db.auth.signOut(); clearLegacyCache(); window.location.replace('/'); }} className="p-1.5 text-white/60 hover:text-white transition-colors"><LogOut size={18} /></button>
        </div>
      </header>

      <div className="flex-1 overflow-hidden flex flex-col">
        {activeTab === 'overview' && (
          <main className="flex-1 grid grid-cols-12 grid-rows-[auto_auto_auto_1.2fr_1fr_1.2fr] gap-4 overflow-hidden animate-fade-in">
            {urgentNotifications.length > 0 && (
              <div className="col-span-12 glass-card !p-4 border-brand-primary/20 bg-brand-primary/5 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-full bg-brand-primary/20 flex items-center justify-center animate-pulse">
                    <AlertCircle className="text-brand-primary" size={20} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold">Você tem {urgentNotifications.length} conta(s) pendente(s) hoje!</h3>
                    <p className="text-[10px] text-white/60 uppercase font-bold tracking-wider">Acesse a Central de Alertas (sino) ou clique abaixo para baixar.</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowNotificationCenter(true)}
                  className="px-4 py-2 bg-brand-primary text-black text-xs font-bold rounded-xl uppercase hover:opacity-90 transition-opacity"
                >
                  Ver Pendências
                </button>
              </div>
            )}
            
            <div className="col-span-3 glass-card !p-4 flex flex-col justify-between group">
              <div className="flex items-center justify-between">
                <span className="text-white/40 text-xs font-medium uppercase tracking-wider">Saldo Disponível</span>
                <button 
                  onClick={() => {
                    setTempBalance(settings?.current_balance?.toString() || '0');
                    setShowBalanceModal(true);
                  }}
                  className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:text-brand-primary hover:bg-brand-primary/10 transition-all opacity-0 group-hover:opacity-100"
                >
                  <Pencil size={12} />
                </button>
              </div>
              <div className="text-2xl font-bold">{formatCurrency(Math.max(0, summary?.currentBalance ?? 0), isPrivate)}</div>
            </div>
            <div className="col-span-3 glass-card !p-4 flex flex-col justify-between border-brand-primary/30">
              <span className="text-brand-primary text-xs font-medium uppercase tracking-wider">Limite Diário</span>
              <div className="text-2xl font-bold text-brand-primary">{formatCurrency(summary?.dailyLimit ?? 0, isPrivate)}</div>
            </div>
            <div className="col-span-3 glass-card !p-4 flex flex-col justify-between">
              <span className="text-white/40 text-xs font-medium uppercase tracking-wider">Ciclo Atual</span>
              <div className="text-2xl font-bold flex items-center gap-2">
                {summary?.cyclePeriodLabel || '-- a --'}
                <span className="text-[10px] text-white/20 font-normal">({summary?.daysRemaining ?? 0}d)</span>
              </div>
            </div>
            <div className="col-span-3 glass-card !p-4 flex flex-col justify-between">
              <span className="text-white/40 text-xs font-medium uppercase tracking-wider">Gasto Hoje</span>
              <div className={`text-2xl font-bold ${summary && summary.todaySpent > summary.dailyLimit ? 'text-red-400' : 'text-white'}`}>{formatCurrency(Math.max(0, summary?.todaySpent ?? 0), isPrivate)}</div>
            </div>

            <div className={`col-span-6 glass-card !p-3 flex items-center gap-4 ${summary?.smartAlert?.type === 'danger' ? 'bg-red-500/10 border-red-500/30' : 'bg-brand-primary/5 border-brand-primary/20'}`}>
              <AlertCircle className={summary?.smartAlert?.type === 'danger' ? 'text-red-400' : 'text-brand-primary'} size={20} />
              <div className="flex-1 min-w-0"><h3 className="font-bold text-sm">Alerta Inteligente</h3><p className="text-xs text-white/70 truncate">{summary?.smartAlert?.message || "Ciclo estável."}</p></div>
            </div>
            <div className="col-span-6 glass-card !p-3 flex items-center gap-4 bg-brand-secondary/5 border-brand-secondary/20">
              <TrendingUp className="text-brand-secondary" size={20} />
              <div className="flex-1 min-w-0"><h3 className="font-bold text-sm">Insight do Dia</h3><p className="text-xs text-white/70 truncate">{summary?.dailyInsight || summary?.insights?.[0] || "Mantenha o ritmo."}</p></div>
            </div>

            <div className="col-span-8 glass-card !p-4 flex flex-col">
              <h3 className="font-bold text-sm mb-2">Evolução do Saldo</h3>
              <div className="flex-1 min-h-0"><Line data={lineChartData} options={{ responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { font: { size: 10 } } }, x: { ticks: { font: { size: 10 } } } } }} /></div>
            </div>
            <div className="col-span-4 glass-card !p-4 flex flex-col justify-between">
              <h3 className="font-bold text-sm mb-2">Resumo do Período</h3>
              <div className="space-y-3">
                <div className="flex justify-between text-xs"><span className="text-white/40">Média Diária</span><span className="font-bold">R$ {(summary?.averageDailySpent ?? 0).toLocaleString('pt-BR')}</span></div>
                <div className="flex justify-between text-xs"><span className="text-white/40">Maior Categoria</span><span className="font-bold text-brand-primary">{summary?.dominantCategory || 'Nenhuma'}</span></div>
              </div>
            </div>

            <div className="col-span-12 glass-card !p-4 flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-bold text-sm">Ritmo de Gastos</h3>
                <div className="flex bg-white/5 p-1 rounded-lg">
                  {(['day', 'week', 'month'] as const).map(f => (
                    <button key={f} onClick={() => setRhythmFilter(f)} className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase transition-all ${rhythmFilter === f ? 'bg-brand-primary text-black' : 'text-white/40 hover:text-white'}`}>{f === 'day' ? 'Dia' : f === 'week' ? 'Semana' : 'Mês'}</button>
                  ))}
                </div>
              </div>
              <div className="flex-1 min-h-0"><Line data={rhythmChartData} options={{ responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }} /></div>
            </div>

            <div className="col-span-4 glass-card !p-3 flex flex-col min-h-[160px]">
              <h3 className="font-bold text-xs mb-3 flex items-center justify-between"><span>Top Categorias</span><PieChartIcon size={14} className="text-white/40" /></h3>
              <div className="flex-1 space-y-2 overflow-y-auto no-scrollbar">
                {overviewTopCategories.length > 0 ? (
                  overviewTopCategories.map(cat => (
                    <div key={cat.name} className="flex flex-col gap-1">
                      <div className="flex justify-between text-[10px]">
                        <span className="text-white/70 truncate">{cat.name}</span>
                        <span className="font-bold">R$ {cat.amount.toFixed(0)}</span>
                      </div>
                      <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                        <div className="h-full bg-brand-primary" style={{ width: `${cat.percentage}%` }}></div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="h-full flex items-center justify-center text-[10px] text-white/20 italic uppercase tracking-widest text-center px-4">Sem despesas nos últimos 30 dias</div>
                )}
              </div>
            </div>
            <div className="col-span-4 glass-card !p-3 flex flex-col min-h-[160px]">
              <h3 className="font-bold text-xs mb-3 flex items-center justify-between"><span>Lançamentos</span><HistoryIcon size={14} className="text-white/40" /></h3>
              <div className="flex-1 space-y-2 overflow-y-auto no-scrollbar">
                {latestOverviewTransactions.length > 0 ? (
                  latestOverviewTransactions.map(t => (
                    <div key={t.id} className="flex items-center justify-between text-[10px] p-2 bg-white/5 rounded-lg border border-white/5">
                      <div className="truncate mr-2">
                        <div className="font-bold truncate">{t.description || t.category}</div>
                        <div className="text-white/40 font-mono">{t.date ? format(new Date(t.date), 'dd/MM') : '--/--'}</div>
                      </div>
                      <div className={`font-bold shrink-0 ${t.type === 'income' ? 'text-green-400' : 'text-white'}`}>
                        {t.type === 'income' ? '+' : '-'} {Math.abs(t.amount).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="h-full flex items-center justify-center text-[10px] text-white/20 italic uppercase tracking-widest">Nenhum lançamento</div>
                )}
              </div>
            </div>
            <div className="col-span-4 glass-card !p-3 flex flex-col">
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
        {activeTab === 'insights' && <Insights summary={summary} transactions={transactions} fixedBills={fixedBills} />}
        {activeTab === 'history' && <History transactions={transactions} onDelete={handleDeleteTransaction} onDeleteAll={handleDeleteAllTransactions} />}
        {activeTab === 'cards' && <Cartoes 
          cards={cards} 
          installments={installments} 
          onAddCard={openAddCardModal} 
          onEditCard={openEditCardModal} 
          onDeleteCard={handleDeleteCard} 
          onAddInstallment={openAddInstallmentModal} 
          onEditInstallment={openEditInstallmentModal} 
          onDeleteInstallment={handleDeleteInstallment} 
          onPayInstallment={handlePayInstallment}
          onPayCardBill={handlePayCardBill}
        />}
        {activeTab === 'investments' && <Investments user={user} settings={settings} onRefresh={fetchData} />}
        {activeTab === 'goals' && <FinancialGoals />}
        {activeTab === 'health' && <FinancialHealth transactions={transactions} summary={summary} totals={{ totalInvestments: investments.reduce((sum, i) => sum + i.amount, 0), categoryCount: new Set(transactions.map(t => t.category)).size }} />}
        {activeTab === 'subscriptions' && <SubscriptionManager />}
        {activeTab === 'calendar' && <FinancialCalendar fixedBills={fixedBills} settings={settings} />}
        {activeTab === 'access_requests' && isAdminUser && <AdminAccessRequests user={user} />}
        {activeTab === 'import' && <ImportarExtratos onImport={handleImportTransactions} onCancel={() => setActiveTab('overview')} />}
        {activeTab === 'base' && (
          <div className="flex-1 overflow-hidden flex flex-col gap-4">
            <div className="flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-brand-primary/10 flex items-center justify-center">
                  <Settings className="text-brand-primary" size={20} />
                </div>
                <div>
                  <h2 className="text-xl font-bold">Estrutura Salarial</h2>
                  <p className="text-[10px] text-white/40 uppercase font-bold tracking-widest">Ajustes e Configurações do Aplicativo</p>
                </div>
              </div>
            </div>
            {settings ? (
              <BaseFinanceira 
                settings={settings} 
                onSave={handleUpdateSettings} 
                fixedBills={fixedBills} 
                dailyBills={dailyBills} 
                summary={summary} 
                onToggleBillStatus={handleToggleBillStatus} 
                onRefresh={fetchData} 
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-white/40 animate-pulse">Carregando...</div>
            )}
          </div>
        )}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="glass-card w-full max-w-md animate-fade-in">
            <h2 className="text-xl font-bold mb-6">Novo Lançamento</h2>
            <form onSubmit={handleAddTransaction} className="space-y-4">
              <div><label className="block text-sm text-white/60 mb-1">Valor</label><input type="number" step="0.01" required value={newTransaction.amount} onChange={e => setNewTransaction({...newTransaction, amount: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none text-2xl font-bold" /></div>
              <div className="flex gap-2"><button type="button" onClick={() => setNewTransaction({...newTransaction, type: 'expense'})} className={`flex-1 p-3 rounded-xl border ${newTransaction.type === 'expense' ? 'bg-red-500/20 border-red-500 text-red-400' : 'bg-white/5 border-white/10 text-white/40'}`}>Saída</button><button type="button" onClick={() => setNewTransaction({...newTransaction, type: 'income'})} className={`flex-1 p-3 rounded-xl border ${newTransaction.type === 'income' ? 'bg-green-500/20 border-green-500 text-green-400' : 'bg-white/5 border-white/10 text-white/40'}`}>Entrada</button></div>
              <div><label className="block text-sm text-white/60 mb-1">Categoria</label><select value={newTransaction.category} onChange={e => setNewTransaction({...newTransaction, category: e.target.value})} className="w-full bg-[#121212] border border-white/10 rounded-xl p-3 outline-none [&>option]:bg-[#121212] [&>option]:text-white">
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


      {showSetupHelper && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl glass-card !p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold">Configuração Manual</h2>
              <button onClick={() => setShowSetupHelper(false)}><X size={20} /></button>
            </div>
            <pre className="p-4 bg-black rounded-xl border border-white/10 text-[10px] text-brand-primary overflow-auto max-h-64 select-all">
              {`-- 1. CRIAR TABELA DE INVESTIMENTOS
CREATE TABLE IF NOT EXISTS public.mf_investments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    institution TEXT,
    amount NUMERIC DEFAULT 0,
    initial_amount NUMERIC DEFAULT 0,
    quantity NUMERIC DEFAULT 1,
    average_price NUMERIC DEFAULT 0,
    current_price NUMERIC DEFAULT 0,
    dividends_received NUMERIC DEFAULT 0,
    target_percentage NUMERIC DEFAULT 0,
    category TEXT DEFAULT 'Investimento',
    purchase_date TIMESTAMPTZ DEFAULT NOW(),
    pl NUMERIC,
    roe NUMERIC,
    ebitda NUMERIC,
    liquid_debt NUMERIC,
    dividend_yield NUMERIC,
    score NUMERIC,
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Adicionar colunas se já existir
ALTER TABLE public.mf_investments ADD COLUMN IF NOT EXISTS quantity NUMERIC DEFAULT 1;
ALTER TABLE public.mf_investments ADD COLUMN IF NOT EXISTS average_price NUMERIC DEFAULT 0;
ALTER TABLE public.mf_investments ADD COLUMN IF NOT EXISTS current_price NUMERIC DEFAULT 0;
ALTER TABLE public.mf_investments ADD COLUMN IF NOT EXISTS dividends_received NUMERIC DEFAULT 0;
ALTER TABLE public.mf_investments ADD COLUMN IF NOT EXISTS target_percentage NUMERIC DEFAULT 0;
ALTER TABLE public.mf_investments ADD COLUMN IF NOT EXISTS pl NUMERIC;
ALTER TABLE public.mf_investments ADD COLUMN IF NOT EXISTS roe NUMERIC;
ALTER TABLE public.mf_investments ADD COLUMN IF NOT EXISTS ebitda NUMERIC;
ALTER TABLE public.mf_investments ADD COLUMN IF NOT EXISTS liquid_debt NUMERIC;
ALTER TABLE public.mf_investments ADD COLUMN IF NOT EXISTS dividend_yield NUMERIC;
ALTER TABLE public.mf_investments ADD COLUMN IF NOT EXISTS score NUMERIC;
ALTER TABLE public.mf_investments ADD COLUMN IF NOT EXISTS note TEXT;

ALTER TABLE public.mf_investments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own investments" ON public.mf_investments FOR ALL USING (auth.uid() = user_id);

-- 2. AJUSTAR TABELA DE ATUALIZAÇÕES
CREATE TABLE IF NOT EXISTS public.mf_app_updates (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    version TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    features TEXT[] DEFAULT '{}',
    fixes TEXT[] DEFAULT '{}',
    released_at TIMESTAMPTZ DEFAULT NOW(),
    is_major BOOLEAN DEFAULT false
);
ALTER TABLE public.mf_app_updates ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ DEFAULT NOW();

-- 3. RECARREGAR SCHEMA
NOTIFY pgrst, 'reload schema';`}
            </pre>
            <div className="flex gap-3 mt-6">
              <button onClick={() => { setShowSetupHelper(false); fetchData(); }} className="flex-1 py-3 bg-brand-primary text-black rounded-xl font-bold">Já executei o SQL</button>
            </div>
          </div>
        </div>
      )}

      <NotificationCenter 
        isOpen={showNotificationCenter}
        onClose={() => setShowNotificationCenter(false)}
        notifications={notifications}
        onPay={handleNotificationPay}
      />

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
                  className="w-full bg-[#121212] border border-white/10 rounded-xl p-3 [&>option]:bg-[#121212] [&>option]:text-white"
                >
                  <option value="boleto">Boleto / Outros</option>
                  {cards.map(card => (<option key={card.id} value={card.id}>{card.name}</option>))}
                </select>
              </div>

              <div>
                <label className="text-[10px] text-white/40 uppercase font-bold mb-1 block">Descrição do Item</label>
                <input type="text" placeholder="Ex: iPhone 15, Notebook..." required value={installmentForm.description} onChange={e => setInstallmentForm({...installmentForm, description: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl p-3" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] text-white/40 uppercase font-bold mb-1 block">Valor Total</label>
                  <input type="number" step="0.01" placeholder="0.00" required value={installmentForm.total_amount} onChange={e => setInstallmentForm({...installmentForm, total_amount: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl p-3" />
                </div>
                <div>
                  <label className="text-[10px] text-white/40 uppercase font-bold mb-1 block">Valor da Parcela</label>
                  <input type="number" step="0.01" placeholder="0.00" required value={installmentForm.monthly_amount} onChange={e => setInstallmentForm({...installmentForm, monthly_amount: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl p-3" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] text-white/40 uppercase font-bold mb-1 block">Parcela Atual</label>
                  <input type="number" required value={installmentForm.current_installment} onChange={e => setInstallmentForm({...installmentForm, current_installment: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl p-3" />
                </div>
                <div>
                  <label className="text-[10px] text-white/40 uppercase font-bold mb-1 block">Dia do Vencimento</label>
                  <input type="number" min="1" max="31" required value={installmentForm.due_day} onChange={e => setInstallmentForm({...installmentForm, due_day: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl p-3" />
                </div>
              </div>

              <div>
                <label className="text-[10px] text-white/40 uppercase font-bold mb-1 block">Total de Parcelas</label>
                <input type="number" required value={installmentForm.total_installments} onChange={e => setInstallmentForm({...installmentForm, total_installments: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl p-3" />
              </div>

              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setShowInstallmentModal(false)} className="flex-1 p-3 rounded-xl bg-white/5">Cancelar</button>
                <button type="submit" className="flex-1 p-3 rounded-xl bg-brand-primary text-black font-bold">Salvar</button>
              </div>
            </form>
          </div>
        </div>
      )}

        {showBalanceModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
            <div className="glass-card w-full max-w-xs p-6 border-brand-primary/30">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-10 w-10 rounded-xl bg-brand-primary/10 flex items-center justify-center">
                  <Wallet className="text-brand-primary" size={20} />
                </div>
                <h2 className="text-lg font-bold">Saldo atual de conta</h2>
              </div>
              <form onSubmit={handleUpdateBalance} className="space-y-6">
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 font-bold">R$</span>
                  <input 
                    type="number" 
                    step="0.01"
                    autoFocus
                    value={tempBalance}
                    onChange={(e) => setTempBalance(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-4 pl-12 pr-4 outline-none focus:border-brand-primary transition-all font-bold text-xl"
                  />
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setShowBalanceModal(false)} className="flex-1 py-3 rounded-xl bg-white/5 text-sm font-bold">Cancelar</button>
                  <button type="submit" className="flex-1 py-3 rounded-xl bg-brand-primary text-black text-sm font-bold">Salvar</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {confirmConfig && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="glass-card w-full max-w-sm animate-fade-in border-brand-primary/30">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-10 w-10 rounded-full bg-brand-primary/10 flex items-center justify-center">
                  <Info className="text-brand-primary" size={20} />
                </div>
                <h2 className="text-lg font-bold">{confirmConfig.title}</h2>
              </div>
              <p className="text-sm text-white/70 mb-8 whitespace-pre-wrap leading-relaxed">{confirmConfig.message}</p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setConfirmConfig(null)} 
                  className="flex-1 py-3 rounded-xl bg-white/5 text-sm font-bold border border-white/10 hover:bg-white/10 transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  onClick={() => confirmConfig.onConfirmed()} 
                  className="flex-1 py-3 rounded-xl bg-brand-primary text-black text-sm font-bold hover:brightness-110 transition-all shadow-[0_0_20px_rgba(0,242,255,0.2)]"
                >
                  Confirmar
                </button>
              </div>
            </div>
          </div>
        )}

        <AppUpdateNotification 
          isOpen={isUpdateOpen}
          updateInfo={latestUpdate}
          onClose={() => setIsUpdateOpen(false)}
          onAcknowledge={() => {
            setIsUpdateOpen(false);
            if (latestUpdate) {
              localStorage.setItem(`mfinanceiro-update-dismissed:${user.id}`, latestUpdate.version);
            }
          }}
        />
    </div>
  );
}
