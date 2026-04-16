
import React, { useState, useEffect, useRef } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Transaction, UserSettings, FinanceSummary, FixedBill, DailyBill, CreditCard, CardInstallment, ImportedTransaction } from '../types';
import { calculateFinanceSummary } from '../lib/finance-calculations';
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
  Check
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
    type: 'expense' as 'expense' | 'income'
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

  async function handleUpdateSettings(newSettings: UserSettings) {
    try {
      // Excluir o ID do payload para evitar erro de chave duplicada ao atualizar
      const { id, ...settingsToUpdate } = newSettings;
      
      const { error } = await db
        .from('mf_user_settings')
        .update(settingsToUpdate)
        .eq('user_id', user.id);

      if (error) {
        if (error.code === 'PGRST205') {
          console.warn('Table mf_user_settings missing, saving to local state only');
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
      const msg = err.message || 'Erro ao salvar configurações';
      alert(`Erro ao salvar no banco de dados: ${msg}. As alterações foram aplicadas apenas localmente nesta sessão.`);
      // Still update local state so user can continue
      setSettings(newSettings);
      setShowSettingsModal(false);
    }
  }

  async function handleImportTransactions(imported: ImportedTransaction[]) {
    try {
      const validImported = imported.filter(item => item.amount > 0 && item.description && item.description !== 'Sem descricao');
      // Deduplica apenas por identificador único do extrato (REFERENCE_ID).
      // Não deduplica por descrição/valor para não remover compras legítimas repetidas no mesmo dia.
      const seenSourceIds = new Set<string>();
      const uniqueImported = validImported.filter(item => {
        if (!item.source_id) return true;
        if (seenSourceIds.has(item.source_id)) return false;
        seenSourceIds.add(item.source_id);
        return true;
      });

      const newEntries = uniqueImported
        .map(item => ({
        user_id: user.id,
        date: item.date,
        description: item.description,
        amount: item.type === 'expense' ? -Math.abs(item.amount) : Math.abs(item.amount),
        type: item.type,
        category: item.category
      }));

      if (newEntries.length === 0) return;

      const { error } = await db
        .from('mf_finance_ledger_entries')
        .insert(newEntries);

      if (error) throw error;

      const latestRunningBalanceItem = [...uniqueImported]
        .reverse()
        .find(item => typeof item.running_balance === 'number' && Number.isFinite(item.running_balance));
      const netImported = newEntries.reduce((sum, entry) => sum + entry.amount, 0);
      const nextBalance =
        latestRunningBalanceItem?.running_balance ??
        (settings ? settings.current_balance + netImported : null);

      if (nextBalance !== null) {
        const { error: balanceError } = await db
          .from('mf_user_settings')
          .update({ current_balance: nextBalance })
          .eq('user_id', user.id);

        if (balanceError && balanceError.code !== 'PGRST205') {
          console.error('Error updating user balance after import:', balanceError);
        } else if (settings) {
          setSettings({ ...settings, current_balance: nextBalance });
        }
      }

      fetchData();
    } catch (err) {
      console.error('Error importing transactions:', err);
    }
  }

  useEffect(() => {
    setSummary(null);
    fetchData();

    const channel = db
      .channel(`ledger_changes_${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_finance_ledger_entries' }, () => {
        fetchData();
      })
      .subscribe();

    return () => {
      db.removeChannel(channel);
    };
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
    const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
    const currentYear = now.getFullYear();
    const normalizedTodayDay = now.getDate();

    const paydayCandidates = [
      { slot: 'payday_1', day: settings.payday_1 || 1 },
      ...(settings.payday_cycle === 'biweekly' && settings.payday_2 ? [{ slot: 'payday_2', day: settings.payday_2 }] : [])
    ];

    const matchingCandidate = paydayCandidates.find(candidate => {
      const effectiveDay = Math.min(Math.max(1, candidate.day), getDaysInMonth(now));
      return effectiveDay === normalizedTodayDay;
    });

    if (!matchingCandidate) {
      setShowSalaryConfirmModal(false);
      setSalaryPromptSlot(null);
      return;
    }

    const promptKey = `salary-confirm:${user.id}:${currentYear}-${currentMonth}:${matchingCandidate.slot}`;
    const alreadyConfirmed = typeof window !== 'undefined' && window.localStorage.getItem(promptKey) === 'confirmed';
    if (alreadyConfirmed) {
      setShowSalaryConfirmModal(false);
      setSalaryPromptSlot(null);
      return;
    }

    const hasSalaryToday = transactions.some(t => {
      const parsed = parseTransactionDate(t.date);
      if (!parsed) return false;
      const isSameCalendarDay =
        parsed.getFullYear() === today.getFullYear() &&
        parsed.getMonth() === today.getMonth() &&
        parsed.getDate() === today.getDate();
      if (!isSameCalendarDay) return false;

      const signed = Number(t.amount) || 0;
      const isIncome = t.type === 'income' || signed > 0;
      if (!isIncome) return false;

      const text = `${t.description || ''} ${t.category || ''}`.toLowerCase();
      return /(sal[aá]rio|pagamento|folha|remunera[cç][aã]o)/i.test(text);
    });

    if (hasSalaryToday) {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(promptKey, 'confirmed');
      }
      setShowSalaryConfirmModal(false);
      setSalaryPromptSlot(null);
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
    const fetchUserId = user.id;
    const fetchVersion = ++fetchVersionRef.current;
    const isStale = () =>
      fetchVersionRef.current !== fetchVersion || currentUserIdRef.current !== fetchUserId;

    setLoading(true);
    setError(null);
    setTransactions([]);
    setFixedBills([]);
    setDailyBills([]);
    setCards([]);
    setInstallments([]);
    
    let detectedMissing: string[] = [];
    const todayPaydayDefault = new Date().getDate();

    // 1. Fetch Settings (Critical)
    try {
      const { data: settingsData, error: settingsError } = await db
        .from('mf_user_settings')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (settingsError) {
        if (settingsError.code === 'PGRST205') detectedMissing.push('mf_user_settings');
        
        if (settingsError.code !== 'PGRST116') {
          console.error('Settings error:', settingsError);
          const fallbackSettings: UserSettings = {
            id: 'local-id',
            user_id: user.id,
            current_balance: 0,
            gross_salary: 0,
            net_salary_estimated: 0,
            benefits: 0,
            deductions: 0,
            payday_cycle: 'monthly',
            payday_1: todayPaydayDefault
          };
          if (isStale()) return;
          setSettings(fallbackSettings);
        } else if (!settingsData) {
          const defaultSettings: Partial<UserSettings> = {
            user_id: user.id,
            current_balance: 0,
            gross_salary: 0,
            net_salary_estimated: 0,
            benefits: 0,
            deductions: 0,
            payday_cycle: 'monthly',
            payday_1: todayPaydayDefault
          };
          
          const { data: newSettings, error: insertError } = await db
            .from('mf_user_settings')
            .insert(defaultSettings)
            .select()
            .single();
          
          if (insertError && insertError.code !== '23505') throw insertError;
          
          if (newSettings) {
            if (isStale()) return;
            setSettings(newSettings);
          } else {
            const { data: retryData } = await db
              .from('mf_user_settings')
              .select('*')
              .eq('user_id', user.id)
              .single();
            if (retryData) {
              if (isStale()) return;
              setSettings(retryData);
            }
          }
        }
      } else {
        if (isStale()) return;
        setSettings(settingsData);
      }
    } catch (err: any) {
      console.error('Critical settings fetch failed:', err);
    }

    // 2. Fetch Transactions (Critical)
    try {
      const { data: transData, error: transError } = await db
        .from('mf_finance_ledger_entries')
        .select('*')
        .eq('user_id', user.id)
        .order('date', { ascending: false });

      if (transError) {
        if (transError.code === 'PGRST205') detectedMissing.push('mf_finance_ledger_entries');
        if (transError.code === '42703' || transError.code === 'PGRST204') {
          detectedMissing.push('mf_finance_ledger_entries (colunas incorretas)');
        }
        throw transError;
      }
      const normalizedTransactions: Transaction[] = (transData || []).map((t: any) => {
        const numericAmount = Number(t.amount) || 0;
        return {
          ...t,
          amount: numericAmount,
          type: t.type || (numericAmount >= 0 ? 'income' : 'expense'),
          category: t.category || 'Geral',
          description: t.description || 'Sem descrição'
        };
      });
      if (isStale()) return;
      setTransactions(normalizedTransactions);
    } catch (err: any) {
      console.error('Transactions error:', err);
      if (isStale()) return;
      setTransactions([]);
    }

    // 3. Fetch Bills (Non-critical)
    try {
      const { data: fixedData, error: fixedError } = await db.from('mf_fixed_bills').select('*').eq('user_id', user.id);
      if (fixedError) {
        if (fixedError.code === 'PGRST205') detectedMissing.push('mf_fixed_bills');
        throw fixedError;
      }
      if (isStale()) return;
      setFixedBills(fixedData || []);
      
      const { data: dailyData, error: dailyError } = await db.from('mf_daily_bills').select('*').eq('user_id', user.id);
      if (dailyError) {
        if (dailyError.code === 'PGRST205') detectedMissing.push('mf_daily_bills');
        throw dailyError;
      }
      if (isStale()) return;
      setDailyBills(dailyData || []);
    } catch (e: any) {
      console.warn('Bills fetch failed:', e);
      if (isStale()) return;
      setFixedBills([]);
      setDailyBills([]);
    }

    // 4. Fetch Cards & Installments (Non-critical)
    try {
      const { data: cardData, error: cardError } = await db.from('mf_credit_cards').select('*').eq('user_id', user.id);
      if (cardError) {
        if (cardError.code === 'PGRST205') detectedMissing.push('mf_credit_cards');
        throw cardError;
      }
      if (isStale()) return;
      setCards(cardData || []);
      
      const cardIds = (cardData || []).map(card => card.id);
      const { data: instData, error: instError } = cardIds.length > 0
        ? await db.from('mf_card_installments').select('*').in('card_id', cardIds)
        : { data: [], error: null };
      if (instError) {
        if (instError.code === 'PGRST205') detectedMissing.push('mf_card_installments');
        throw instError;
      }
      if (isStale()) return;
      setInstallments(instData || []);
    } catch (e: any) {
      console.warn('Cards fetch failed:', e);
      if (isStale()) return;
      setCards([]);
      setInstallments([]);
    }

    if (isStale()) return;
    setMissingTables(detectedMissing);
    if (detectedMissing.length > 0) {
      console.error('Missing setup detected:', detectedMissing);
    }

    setLoading(false);
  }

  async function handleToggleBillStatus(id: string) {
    const bill = fixedBills.find(b => b.id === id);
    if (!bill) return;
    if (!settings) return;

    const wasPaid = bill.status === 'paid';
    let paidDateForLedger: Date | null = null;

    if (!wasPaid) {
      const todayLabel = format(new Date(), 'dd/MM/yyyy');
      const paidDateInput = window.prompt(
        `Informe a data em que a conta "${bill.name}" foi paga (dd/mm/aaaa):`,
        todayLabel
      );

      if (paidDateInput === null) return;

      const raw = paidDateInput.trim();
      const br = raw.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
      const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (br) {
        const day = Number(br[1]);
        const month = Number(br[2]);
        const year = Number(br[3]);
        paidDateForLedger = new Date(year, month - 1, day, 12, 0, 0, 0);
      } else if (iso) {
        const year = Number(iso[1]);
        const month = Number(iso[2]);
        const day = Number(iso[3]);
        paidDateForLedger = new Date(year, month - 1, day, 12, 0, 0, 0);
      }

      if (!paidDateForLedger || Number.isNaN(paidDateForLedger.getTime())) {
        alert('Data inválida. Use o formato dd/mm/aaaa.');
        return;
      }

      const confirmPay = window.confirm(
        `Confirmar pagamento da conta "${bill.name}" no valor de R$ ${Number(bill.amount).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} em ${format(paidDateForLedger, 'dd/MM/yyyy')}?`
      );
      if (!confirmPay) return;
    }

    const newStatus = bill.status === 'paid' ? 'pending' : 'paid';
    const balanceDelta = wasPaid ? Math.abs(bill.amount) : -Math.abs(bill.amount);
    const ledgerDescription = wasPaid
      ? `Estorno de conta fixa: ${bill.name}`
      : `Pagamento de conta fixa: ${bill.name}`;
    const ledgerType: 'income' | 'expense' = balanceDelta >= 0 ? 'income' : 'expense';

    try {
      const { error } = await db.from('mf_fixed_bills').update({ status: newStatus }).eq('id', id);
      if (error) throw error;

      const { error: ledgerError } = await db.from('mf_finance_ledger_entries').insert({
        user_id: user.id,
        amount: balanceDelta,
        category: 'Contas Fixas',
        description: ledgerDescription,
        type: ledgerType,
        date: wasPaid ? new Date().toISOString() : paidDateForLedger!.toISOString()
      });
      if (ledgerError) throw ledgerError;

      const nextBalance = (Number(settings.current_balance) || 0) + balanceDelta;
      const { error: balanceError } = await db
        .from('mf_user_settings')
        .update({ current_balance: nextBalance })
        .eq('user_id', user.id);

      if (balanceError && balanceError.code !== 'PGRST205') throw balanceError;

      // Ao confirmar pagamento, cria automaticamente a próxima conta fixa para o mês seguinte,
      // evitando duplicar se já existir um item pendente equivalente nesse mês.
      if (!wasPaid) {
        const referenceDate = paidDateForLedger!;
        const nextMonthStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 1, 0, 0, 0, 0);
        const nextMonthEnd = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 2, 1, 0, 0, 0, 0);
        const daysInNextMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 2, 0).getDate();
        const nextDueDate = new Date(
          referenceDate.getFullYear(),
          referenceDate.getMonth() + 1,
          Math.min(Math.max(1, Number(bill.due_day) || 1), daysInNextMonth),
          12,
          0,
          0,
          0
        );

        const { data: existingNextMonth } = await db
          .from('mf_fixed_bills')
          .select('id')
          .eq('user_id', user.id)
          .eq('status', 'pending')
          .eq('name', bill.name)
          .eq('amount', bill.amount)
          .eq('due_day', bill.due_day)
          .eq('category', bill.category)
          .gte('created_at', nextMonthStart.toISOString())
          .lt('created_at', nextMonthEnd.toISOString())
          .limit(1);

        if (!existingNextMonth || existingNextMonth.length === 0) {
          const { error: nextBillError } = await db.from('mf_fixed_bills').insert({
            user_id: user.id,
            name: bill.name,
            amount: bill.amount,
            due_day: bill.due_day,
            category: bill.category,
            status: 'pending',
            created_at: nextDueDate.toISOString()
          });

          if (nextBillError && nextBillError.code !== 'PGRST205') {
            throw nextBillError;
          }
        }
      }

      setFixedBills(prev => prev.map(b => b.id === id ? { ...b, status: newStatus } : b));
      setSettings({ ...settings, current_balance: nextBalance });
      fetchData();
    } catch (err) {
      console.error('Error toggling bill status:', err);
      alert('Não foi possível atualizar o pagamento da conta fixa.');
    }
  }

  async function handleAddTransaction(e: React.FormEvent) {
    e.preventDefault();
    try {
      const amount = parseFloat(newTransaction.amount);
      const finalAmount = newTransaction.type === 'expense' ? -Math.abs(amount) : Math.abs(amount);

      const { error } = await db.from('mf_finance_ledger_entries').insert({
        user_id: user.id,
        amount: finalAmount,
        category: newTransaction.category,
        description: newTransaction.description,
        type: newTransaction.type,
        date: new Date().toISOString()
      });

      if (error) throw error;

      if (settings) {
        const newBalance = settings.current_balance + finalAmount;
        const { error: balanceError } = await db.from('mf_user_settings').update({ current_balance: newBalance }).eq('user_id', user.id);
        
        if (balanceError && balanceError.code !== 'PGRST205') {
          console.error('Error updating balance in DB:', balanceError);
        }
        
        setSettings({ ...settings, current_balance: newBalance });
      }

      setShowAddModal(false);
      setNewTransaction({ amount: '', category: 'Geral', description: '', type: 'expense' });
      fetchData();
    } catch (err) {
      console.error('Error adding transaction:', err);
    }
  }

  async function handleDeleteTransaction(id: string) {
    try {
      const { error } = await db
        .from('mf_finance_ledger_entries')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);

      if (error) throw error;
      fetchData();
    } catch (err) {
      console.error('Error deleting transaction:', err);
      alert('Não foi possível apagar o lançamento. Tente novamente.');
    }
  }

  async function handleDeleteAllTransactions() {
    try {
      const { error } = await db
        .from('mf_finance_ledger_entries')
        .delete()
        .eq('user_id', user.id);

      if (error) throw error;
      fetchData();
    } catch (err) {
      console.error('Error deleting all transactions:', err);
      alert('Não foi possível apagar todos os lançamentos. Tente novamente.');
    }
  }

  function openAddCardModal() {
    setEditingCard(null);
    setCardForm({
      name: '',
      brand: 'Visa',
      limit: '',
      used: '',
      closing_day: '1',
      due_day: '10',
    });
    setShowCardModal(true);
  }

  function openEditCardModal(card: CreditCard) {
    setEditingCard(card);
    setCardForm({
      name: card.name || '',
      brand: card.brand || 'Visa',
      limit: String(card.limit ?? 0),
      used: String(card.used ?? 0),
      closing_day: String(card.closing_day ?? 1),
      due_day: String(card.due_day ?? 10),
    });
    setShowCardModal(true);
  }

  async function handleSaveCard(e: React.FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        user_id: user.id,
        name: cardForm.name.trim(),
        brand: cardForm.brand.trim() || 'Cartão',
        limit: Math.max(0, Number(cardForm.limit) || 0),
        used: Math.max(0, Number(cardForm.used) || 0),
        closing_day: Math.min(31, Math.max(1, Number(cardForm.closing_day) || 1)),
        due_day: Math.min(31, Math.max(1, Number(cardForm.due_day) || 1)),
      };

      if (!payload.name) {
        alert('Informe o nome do cartão.');
        return;
      }

      if (editingCard) {
        const { error } = await db
          .from('mf_credit_cards')
          .update(payload)
          .eq('id', editingCard.id)
          .eq('user_id', user.id);
        if (error) throw error;
      } else {
        const { error } = await db.from('mf_credit_cards').insert(payload);
        if (error) throw error;
      }

      setShowCardModal(false);
      setEditingCard(null);
      fetchData();
    } catch (err) {
      console.error('Error saving credit card:', err);
      alert('Não foi possível salvar o cartão. Verifique a configuração do banco e tente novamente.');
    }
  }

  async function handleDeleteCard(card: CreditCard) {
    const ok = window.confirm(`Excluir o cartão "${card.name}"?`);
    if (!ok) return;

    try {
      const { error } = await db
        .from('mf_credit_cards')
        .delete()
        .eq('id', card.id)
        .eq('user_id', user.id);
      if (error) throw error;
      fetchData();
    } catch (err) {
      console.error('Error deleting credit card:', err);
      alert('Não foi possível excluir o cartão.');
    }
  }

  function openAddInstallmentModal() {
    const defaultCardId = cards[0]?.id || '';
    setEditingInstallment(null);
    setInstallmentForm({
      card_id: defaultCardId,
      description: '',
      total_amount: '',
      monthly_amount: '',
      current_installment: '1',
      total_installments: '1',
    });
    setShowInstallmentModal(true);
  }

  function openEditInstallmentModal(installment: CardInstallment) {
    setEditingInstallment(installment);
    setInstallmentForm({
      card_id: installment.card_id,
      description: installment.description || '',
      total_amount: String(installment.total_amount ?? 0),
      monthly_amount: String(installment.monthly_amount ?? 0),
      current_installment: String(installment.current_installment ?? 1),
      total_installments: String(installment.total_installments ?? 1),
    });
    setShowInstallmentModal(true);
  }

  async function handleSaveInstallment(e: React.FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        card_id: installmentForm.card_id,
        description: installmentForm.description.trim(),
        total_amount: Math.max(0, Number(installmentForm.total_amount) || 0),
        monthly_amount: Math.max(0, Number(installmentForm.monthly_amount) || 0),
        current_installment: Math.max(1, Number(installmentForm.current_installment) || 1),
        total_installments: Math.max(1, Number(installmentForm.total_installments) || 1),
      };

      if (!payload.card_id) {
        alert('Selecione um cartão para o parcelamento.');
        return;
      }
      if (!payload.description) {
        alert('Informe a descrição do parcelamento.');
        return;
      }

      if (editingInstallment) {
        const { error } = await db
          .from('mf_card_installments')
          .update(payload)
          .eq('id', editingInstallment.id);
        if (error) throw error;
      } else {
        const { error } = await db.from('mf_card_installments').insert(payload);
        if (error) throw error;
      }

      setShowInstallmentModal(false);
      setEditingInstallment(null);
      fetchData();
    } catch (err) {
      console.error('Error saving installment:', err);
      alert('Não foi possível salvar o parcelamento.');
    }
  }

  async function handleDeleteInstallment(installment: CardInstallment) {
    const ok = window.confirm(`Excluir o parcelamento "${installment.description}"?`);
    if (!ok) return;

    try {
      const { error } = await db
        .from('mf_card_installments')
        .delete()
        .eq('id', installment.id);
      if (error) throw error;
      fetchData();
    } catch (err) {
      console.error('Error deleting installment:', err);
      alert('Não foi possível excluir o parcelamento.');
    }
  }

  async function handleConfirmSalaryReceived() {
    if (!settings || !salaryPromptKey || !salaryPromptSlot) return;

    setSalaryPromptProcessing(true);
    try {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
      const salaryAmount = getSalaryAmountForSlot(salaryPromptSlot, settings);

      if (salaryAmount <= 0) {
        alert('Defina o Salário Líquido Estimado na Base Financeira antes de confirmar o recebimento.');
        return;
      }

      const hasSalaryToday = transactions.some(t => {
        const parsed = parseTransactionDate(t.date);
        if (!parsed) return false;
        const isSameCalendarDay =
          parsed.getFullYear() === today.getFullYear() &&
          parsed.getMonth() === today.getMonth() &&
          parsed.getDate() === today.getDate();
        if (!isSameCalendarDay) return false;

        const signed = Number(t.amount) || 0;
        const isIncome = t.type === 'income' || signed > 0;
        if (!isIncome) return false;

        const text = `${t.description || ''} ${t.category || ''}`.toLowerCase();
        return /(sal[aá]rio|pagamento|folha|remunera[cç][aã]o)/i.test(text);
      });

      if (!hasSalaryToday) {
        const salaryDescription = `Salário recebido em ${format(now, 'dd/MM/yyyy')}`;

        const { error: insertError } = await db
          .from('mf_finance_ledger_entries')
          .insert({
            user_id: user.id,
            amount: salaryAmount,
            category: 'Salário',
            description: salaryDescription,
            type: 'income',
            date: now.toISOString()
          });

        if (insertError) throw insertError;

        const nextBalance = (Number(settings.current_balance) || 0) + salaryAmount;
        const { error: balanceError } = await db
          .from('mf_user_settings')
          .update({ current_balance: nextBalance })
          .eq('user_id', user.id);

        if (balanceError && balanceError.code !== 'PGRST205') throw balanceError;
        setSettings({ ...settings, current_balance: nextBalance });
      }

      if (typeof window !== 'undefined') {
        window.localStorage.setItem(salaryPromptKey, 'confirmed');
      }
      setShowSalaryConfirmModal(false);
      setSalaryPromptKey(null);
      setSalaryPromptSlot(null);
      fetchData();
    } catch (err) {
      console.error('Error confirming salary receipt:', err);
      alert('Não foi possível confirmar o recebimento do salário. Tente novamente.');
    } finally {
      setSalaryPromptProcessing(false);
    }
  }

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-[#050505] text-white p-6 text-center">
        <div className="text-red-400 font-bold text-xl">Ops! Algo deu errado.</div>
        <div className="text-sm text-white/60 max-w-md">{error}</div>
        
        <div className="flex gap-3 mt-4">
          <button 
            onClick={() => window.location.reload()}
            className="px-6 py-2 bg-white/10 text-white rounded-xl font-bold hover:bg-white/20 transition-all"
          >
            Recarregar App
          </button>
          <button 
            onClick={fetchData}
            className="px-6 py-2 bg-brand-primary text-black rounded-xl font-bold hover:opacity-90 transition-all"
          >
            Tentar Novamente
          </button>
        </div>

        <div className="mt-8 p-4 bg-white/5 rounded-xl border border-white/10 text-[10px] text-white/20 font-mono text-left max-w-lg overflow-auto">
          <div className="font-bold mb-1 uppercase">Dica Técnica:</div>
          Se o erro persistir, verifique se as tabelas do Supabase foram criadas corretamente. 
          Este erro geralmente ocorre quando o banco de dados ainda não está pronto ou as permissões (RLS) estão bloqueando o acesso.
        </div>
      </div>
    );
  }

  if (loading && !summary) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-brand-primary border-t-transparent"></div>
      </div>
    );
  }

  const parseChartDate = (raw: string): Date | null => {
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

  const dayToKey = (d: Date) => format(d, 'yyyy-MM-dd');
  const keyToDay = (key: string) => {
    const [year, month, day] = key.split('-').map(Number);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
  };
  const normalizePtText = (text: string) =>
    text
      .replace(/ÃƒÂ£|Ã£/g, 'ã')
      .replace(/ÃƒÂ¡|Ã¡/g, 'á')
      .replace(/ÃƒÂ©|Ã©/g, 'é')
      .replace(/ÃƒÂ­|Ã­/g, 'í')
      .replace(/ÃƒÂ³|Ã³/g, 'ó')
      .replace(/ÃƒÂº|Ãº/g, 'ú')
      .replace(/ÃƒÂ§|Ã§/g, 'ç')
      .replace(/ÃƒÂª|Ãª/g, 'ê')
      .replace(/ÃƒÂ´|Ã´/g, 'ô')
      .replace(/ÃƒÂµ|Ãµ/g, 'õ')
      .replace(/Â/g, '');

  const timelineDays = 30;
  const normalizedForChart = transactions
    .map(t => {
      const date = parseChartDate(t.date);
      if (!date) return null;
      return {
        amount: Number(t.amount) || 0,
        date,
        category: t.category || 'Geral',
      };
    })
    .filter((item): item is { amount: number; date: Date; category: string } => item !== null);

  const latestChartDate = normalizedForChart.length > 0
    ? normalizedForChart.reduce((max, t) => (isAfter(t.date, max) ? t.date : max), normalizedForChart[0].date)
    : new Date();
  const startChartDate = subDays(latestChartDate, timelineDays - 1);

  const dailyMap = new Map<string, { net: number; inflow: number }>();
  for (let day = startChartDate; !isAfter(day, latestChartDate); day = addDays(day, 1)) {
    dailyMap.set(dayToKey(day), { net: 0, inflow: 0 });
  }

  normalizedForChart.forEach(t => {
    if (isBefore(t.date, startChartDate) || isAfter(t.date, latestChartDate)) return;
    const key = dayToKey(t.date);
    const slot = dailyMap.get(key);
    if (!slot) return;
    slot.net += t.amount;
    if (t.amount > 0) slot.inflow += t.amount;
  });

  const keys = Array.from(dailyMap.keys());
  const inWindowTransactions = normalizedForChart.filter(t =>
    !isBefore(t.date, startChartDate) && !isAfter(t.date, latestChartDate)
  );
  const periodOutflows = inWindowTransactions.filter(t => t.amount < 0);
  const periodTotalSpent = periodOutflows.reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const periodAverageDailySpent = periodTotalSpent / timelineDays;
  const periodCategoryTotals = periodOutflows.reduce((acc, t) => {
    acc[t.category] = (acc[t.category] || 0) + Math.abs(t.amount);
    return acc;
  }, {} as Record<string, number>);
  const periodDominantCategory = Object.entries(periodCategoryTotals)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 'Nenhuma';

  const totalNetInWindow = keys.reduce((sum, key) => sum + (dailyMap.get(key)?.net || 0), 0);
  const currentBalance = settings?.current_balance ?? 0;
  const baseBalance = currentBalance - totalNetInWindow;

  let runningBalance = baseBalance;
  const balanceSeries = keys.map(key => {
    runningBalance += dailyMap.get(key)?.net || 0;
    return Number(runningBalance.toFixed(2));
  });
  const inflowSeries = keys.map(key => Number((dailyMap.get(key)?.inflow || 0).toFixed(2)));

  const lineChartData = {
    labels: keys.map(key => format(keyToDay(key), 'dd/MM')),
    datasets: [
      {
        label: 'Saldo',
        data: balanceSeries,
        yAxisID: 'yBalance',
        borderColor: '#00f2ff',
        backgroundColor: 'rgba(0, 242, 255, 0.1)',
        fill: true,
        tension: 0.35,
      },
      {
        label: 'Entradas',
        data: inflowSeries,
        yAxisID: 'yEntries',
        borderColor: '#22c55e',
        backgroundColor: 'rgba(34, 197, 94, 0.15)',
        fill: false,
        tension: 0.25,
        borderDash: [6, 4],
        pointRadius: 2,
      },
    ],
  };

  const lineChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      yBalance: {
        position: 'left' as const,
        grid: { color: 'rgba(255,255,255,0.05)' },
        ticks: { font: { size: 10 } },
      },
      yEntries: {
        position: 'right' as const,
        grid: { drawOnChartArea: false, color: 'rgba(34,197,94,0.15)' },
        ticks: { font: { size: 10 } },
      },
      x: { grid: { display: false }, ticks: { font: { size: 10 } } },
    },
    plugins: {
      legend: {
        display: true,
        labels: { boxWidth: 10, font: { size: 10 } },
      },
    },
  };

  const rhythmChartData = {
    labels: summary?.rhythm?.[rhythmFilter]?.labels || [],
    datasets: [
      {
        label: 'Gastos',
        data: summary?.rhythm?.[rhythmFilter]?.data || [],
        backgroundColor: 'rgba(112, 0, 255, 0.5)',
        borderColor: '#7000ff',
        borderWidth: 1,
        borderRadius: 4,
      },
    ],
  };

  const latestOverviewTransactions = [...transactions]
    .sort((a, b) => {
      const aDate = parseTransactionDate(a.date);
      const bDate = parseTransactionDate(b.date);
      const aTime = aDate ? aDate.getTime() : 0;
      const bTime = bDate ? bDate.getTime() : 0;

      if (bTime !== aTime) return bTime - aTime;

      const aCreated = (a as any).created_at ? new Date((a as any).created_at).getTime() : 0;
      const bCreated = (b as any).created_at ? new Date((b as any).created_at).getTime() : 0;
      if (bCreated !== aCreated) return bCreated - aCreated;

      return String(b.id).localeCompare(String(a.id));
    })
    .slice(0, 3);

  const overviewCardsUsed = cards.reduce((sum, card) => sum + (Number(card.used) || 0), 0);
  const overviewCardsLimit = cards.reduce((sum, card) => sum + (Number(card.limit) || 0), 0);
  const overviewCardsAvailable = Math.max(0, overviewCardsLimit - overviewCardsUsed);
  const overviewCardsUsagePercent = overviewCardsLimit > 0
    ? Math.min(100, (overviewCardsUsed / overviewCardsLimit) * 100)
    : 0;
  const isFreshAccount =
    (transactions?.length ?? 0) === 0 &&
    (fixedBills?.length ?? 0) === 0 &&
    (dailyBills?.length ?? 0) === 0 &&
    (cards?.length ?? 0) === 0 &&
    (installments?.length ?? 0) === 0 &&
    Number(settings?.current_balance ?? 0) === 0 &&
    Number(settings?.gross_salary ?? 0) === 0;
  const overviewDaysRemaining = isFreshAccount ? 0 : (summary?.daysRemaining ?? 0);
  const overviewNextPaydayLabel = isFreshAccount ? '--/--' : (summary?.nextPaydayLabel ?? '--/--');

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
    <div className="h-screen w-full p-4 flex flex-col gap-4 no-scrollbar overflow-hidden bg-[#050505]">
      {/* Missing Tables Banner */}
      {missingTables.length > 0 && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3 flex items-center justify-between animate-pulse-slow">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-yellow-500/20 flex items-center justify-center text-yellow-500">
              <Database size={18} />
            </div>
            <div>
              <div className="text-sm font-bold text-yellow-500">Configuração Incompleta</div>
              <div className="text-[10px] text-white/60">Algumas tabelas não foram encontradas no seu banco de dados Supabase.</div>
            </div>
          </div>
          <button 
            onClick={() => setShowSetupHelper(true)}
            className="px-4 py-1.5 bg-yellow-500 text-black rounded-lg text-xs font-bold hover:opacity-90 transition-opacity"
          >
            Corrigir Agora
          </button>
        </div>
      )}

      {/* Header */}
      <header className="flex items-center justify-between shrink-0 mb-2">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-brand-primary to-brand-secondary flex items-center justify-center">
            <Wallet className="text-white" size={18} />
          </div>
          <h1 className="text-xl font-bold tracking-tight">MFinanceiro</h1>
        </div>
        
        <nav className="flex bg-white/5 p-1 rounded-xl border border-white/5 overflow-x-auto no-scrollbar max-w-[700px] mx-4">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${activeTab === tab.id ? 'bg-brand-primary text-black' : 'text-white/40 hover:text-white'}`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <button onClick={() => setShowAddModal(true)} className="flex items-center gap-2 bg-brand-primary text-black px-3 py-1.5 rounded-lg font-bold text-sm hover:opacity-90 transition-opacity">
            <Plus size={16} />
            <span>Lançar</span>
          </button>
          <button onClick={() => setShowSettingsModal(true)} className="p-1.5 text-white/60 hover:text-white transition-colors">
            <Settings size={18} />
          </button>
          <button onClick={async () => {
              await db.auth.signOut();
              clearLegacyCache();
              window.location.replace('/');
            }} className="p-1.5 text-white/60 hover:text-white transition-colors">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {activeTab === 'overview' && (
          <main className="flex-1 grid grid-cols-12 grid-rows-[auto_auto_1.2fr_1fr_1.2fr] gap-4 overflow-hidden animate-fade-in">
            {/* Row 1: Key Stats */}
            <div className="col-span-3 glass-card !p-4 flex flex-col justify-between">
              <span className="text-white/40 text-xs font-medium uppercase tracking-wider">Saldo Disponível</span>
              <div className="text-2xl font-bold">R$ {(summary?.currentBalance ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
            </div>
            <div className="col-span-3 glass-card !p-4 flex flex-col justify-between border-brand-primary/30">
              <span className="text-brand-primary text-xs font-medium uppercase tracking-wider">Limite Diário</span>
              <div className="text-2xl font-bold text-brand-primary">R$ {(summary?.dailyLimit ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
            <div className="col-span-3 glass-card !p-4 flex flex-col justify-between">
              <span className="text-white/40 text-xs font-medium uppercase tracking-wider">Dias Restantes</span>
              <div>
                <div className="text-2xl font-bold">{overviewDaysRemaining} dias</div>
                <div className="text-[11px] text-white/50 mt-1">Próx. pagamento: {overviewNextPaydayLabel}</div>
              </div>
            </div>
            <div className="col-span-3 glass-card !p-4 flex flex-col justify-between">
              <span className="text-white/40 text-xs font-medium uppercase tracking-wider">Gasto Hoje</span>
              <div className={`text-2xl font-bold ${summary && summary.todaySpent > summary.dailyLimit ? 'text-red-400' : 'text-white'}`}>
                R$ {(summary?.todaySpent ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </div>
            </div>

            {/* Row 2: Alerts & Insights */}
            <div className={`col-span-6 glass-card !p-3 flex items-center gap-4 ${summary?.smartAlert?.type === 'danger' ? 'bg-red-500/10 border-red-500/30' : summary?.smartAlert?.type === 'warning' ? 'bg-yellow-500/10 border-yellow-500/30' : 'bg-brand-primary/5 border-brand-primary/20'}`}>
              <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${summary?.smartAlert?.type === 'danger' ? 'bg-red-500/20 text-red-400' : summary?.smartAlert?.type === 'warning' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-brand-primary/20 text-brand-primary'}`}>
                <AlertCircle size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-sm">Alerta Inteligente</h3>
                <p className="text-xs text-white/70 truncate">{summary?.smartAlert?.message || "Ciclo estável. Continue acompanhando seus gastos."}</p>
              </div>
            </div>
            <div className="col-span-6 glass-card !p-3 flex items-center gap-4 bg-brand-secondary/5 border-brand-secondary/20">
              <div className="h-10 w-10 rounded-full bg-brand-secondary/20 flex items-center justify-center shrink-0 text-brand-secondary">
                <TrendingUp size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-sm">Insight do Dia</h3>
                <p className="text-xs text-white/70 truncate">{summary?.dailyInsight || summary?.insights?.[0] || "Mantenha o ritmo atual para fechar o mes no azul."}</p>
              </div>
              <button onClick={() => setActiveTab('insights')} className="text-[10px] uppercase font-bold text-brand-secondary hover:underline">Ver todos</button>
            </div>

            {/* Row 3: Evolution Chart & Summary */}
            <div className="col-span-8 glass-card !p-4 flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-bold text-sm">Evolução do Saldo</h3>
                <span className="text-[10px] text-white/40 uppercase">Últimos 10 lançamentos</span>
              </div>
              <div className="flex-1 min-h-0">
                <Line data={lineChartData} options={lineChartOptions} />
              </div>
            </div>

            <div className="col-span-4 glass-card !p-4 flex flex-col justify-between">
              <h3 className="font-bold text-sm mb-2">Resumo do Período</h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-white/40">Total Gasto</span>
                  <span className="font-bold text-sm">R$ {periodTotalSpent.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-white/40">Média Diária</span>
                  <span className="font-bold text-sm">R$ {periodAverageDailySpent.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-white/40">Maior Categoria</span>
                  <span className="font-bold text-sm text-brand-primary">{periodDominantCategory}</span>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-white/5">
                <div className="flex items-center gap-2 text-[10px] text-white/40 uppercase">
                  <div className={`h-2 w-2 rounded-full ${summary?.spendingTrend === 'up' ? 'bg-red-400' : 'bg-green-400'}`}></div>
                  Tendência: {summary?.spendingTrend === 'up' ? 'Alta' : 'Baixa'}
                </div>
              </div>
            </div>

            {/* Row 4: Rhythm Chart */}
            <div className="col-span-12 glass-card !p-4 flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-bold text-sm">Ritmo de Gastos</h3>
                <div className="flex bg-white/5 p-1 rounded-lg">
                  {(['day', 'week', 'month'] as const).map(f => (
                    <button 
                      key={f}
                      onClick={() => setRhythmFilter(f)}
                      className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase transition-all ${rhythmFilter === f ? 'bg-brand-primary text-black' : 'text-white/40 hover:text-white'}`}
                    >
                      {f === 'day' ? 'Dia' : f === 'week' ? 'Semana' : 'Mês'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1 min-h-0">
                <Line 
                  data={rhythmChartData} 
                  options={{ 
                    responsive: true, 
                    maintainAspectRatio: false, 
                    scales: { 
                      y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { font: { size: 10 } } }, 
                      x: { grid: { display: false }, ticks: { font: { size: 10 } } } 
                    }, 
                    plugins: { legend: { display: false } } 
                  }} 
                />
              </div>
            </div>

            {/* Row 5: Bottom Grid */}
            <div className="col-span-3 glass-card !p-3 flex flex-col">
              <h3 className="font-bold text-xs mb-3 flex items-center justify-between">
                <span>Top Categorias</span>
                <PieChartIcon size={14} className="text-white/40" />
              </h3>
              <div className="flex-1 space-y-2 overflow-hidden">
                {summary?.topCategories?.map(cat => (
                  <div key={cat.name} className="flex flex-col gap-1">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-white/70 truncate">{cat.name}</span>
                      <span className="font-bold">R$ {cat.amount.toFixed(0)}</span>
                    </div>
                    <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-brand-primary" style={{ width: `${cat.percentage}%` }}></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="col-span-3 glass-card !p-3 flex flex-col">
              <h3 className="font-bold text-xs mb-3 flex items-center justify-between">
                <span>Lançamentos</span>
                <HistoryIcon size={14} className="text-white/40" />
              </h3>
              <div className="flex-1 space-y-2 overflow-hidden">
                {latestOverviewTransactions.map(t => (
                  <div key={t.id} className="flex items-center justify-between text-[10px] p-2 bg-white/5 rounded-lg border border-white/5">
                    <div className="truncate mr-2">
                      <div className="font-bold truncate">{t.description || t.category}</div>
                      <div className="text-white/40">
                        {(() => {
                          try {
                            const parsed = parseTransactionDate(t.date);
                            return parsed ? format(parsed, 'dd/MM') : '??/??';
                          } catch {
                            return '??/??';
                          }
                        })()}
                      </div>
                    </div>
                    <div className={`font-bold shrink-0 ${t.type === 'income' ? 'text-green-400' : 'text-white'}`}>
                      {t.type === 'income' ? '+' : '-'} {Math.abs(t.amount).toFixed(0)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="col-span-3 glass-card !p-3 flex flex-col">
              <h3 className="font-bold text-xs mb-3 flex items-center justify-between">
                <span>Cartões</span>
                <CreditCardIcon size={14} className="text-white/40" />
              </h3>
              <div className="flex-1 flex flex-col justify-center gap-3">
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-white/40">Utilizado</span>
                    <span className="font-bold">
                      R$ {overviewCardsUsed.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-brand-secondary" style={{ width: `${overviewCardsUsagePercent}%` }}></div>
                  </div>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-white/5">
                  <span className="text-[10px] text-white/40">Disponível</span>
                  <span className="text-xs font-bold text-brand-primary">
                    R$ {overviewCardsAvailable.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="text-[10px] text-white/40">
                  {cards.length > 0
                    ? `${cards.length} cartão(ões) • Limite total R$ ${overviewCardsLimit.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : 'Nenhum cartão cadastrado'}
                </div>
              </div>
            </div>

            <div className="col-span-3 glass-card !p-3 flex flex-col">
              <h3 className="font-bold text-xs mb-3 flex items-center justify-between">
                <span>Prioridades do Dia</span>
                <AlertCircle size={14} className="text-white/40" />
              </h3>
              <div className="flex-1 space-y-2 overflow-hidden">
                {summary?.priorities?.map(p => (
                  <div key={p.id} className={`p-2 rounded-lg border text-[10px] ${p.type === 'urgent' ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-white/5 border-white/10 text-white/70'}`}>
                    <div className="font-bold uppercase mb-0.5">{normalizePtText(p.title)}</div>
                    <div className="line-clamp-1">{normalizePtText(p.message)}</div>
                  </div>
                ))}
                {(summary?.priorities?.length ?? 0) === 0 && <div className="text-[10px] text-white/40 text-center py-4">Nenhuma prioridade crítica no momento.</div>}
              </div>
            </div>
          </main>
        )}

        {activeTab === 'details' && <Details transactions={transactions} summary={summary} />}
        {activeTab === 'insights' && <Insights summary={summary} />}
        {activeTab === 'history' && (
          <History
            transactions={transactions}
            onDelete={handleDeleteTransaction}
            onDeleteAll={handleDeleteAllTransactions}
          />
        )}
        {activeTab === 'cards' && (
          <Cartoes 
            cards={cards} 
            installments={installments} 
            onAddCard={openAddCardModal}
            onEditCard={openEditCardModal}
            onDeleteCard={handleDeleteCard}
            onAddInstallment={openAddInstallmentModal}
            onEditInstallment={openEditInstallmentModal}
            onDeleteInstallment={handleDeleteInstallment}
          />
        )}
        {activeTab === 'import' && (
          <ImportarExtratos 
            onImport={handleImportTransactions}
            onCancel={() => setActiveTab('overview')}
          />
        )}
        {activeTab === 'base' && (
          settings ? (
            <div className="flex-1 overflow-hidden flex flex-col gap-4">
              <div className="flex items-center justify-between shrink-0">
                <h2 className="text-lg font-bold">Base Financeira</h2>
                <button 
                  onClick={() => setShowSetupHelper(true)}
                  className="flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs text-white/60 transition-all border border-white/10"
                >
                  <Database size={14} />
                  Configurar Banco de Dados
                </button>
              </div>
              <BaseFinanceira 
                settings={settings} 
                onSave={handleUpdateSettings}
                fixedBills={fixedBills}
                dailyBills={dailyBills}
                summary={summary}
                onToggleBillStatus={handleToggleBillStatus}
                onRefresh={fetchData}
              />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-white/40 animate-pulse">
              Carregando configurações da base...
            </div>
          )
        )}
      </div>

      {/* Modals remain the same but styled more compactly if needed */}
      {/* ... (Add Transaction Modal and Settings Modal code) ... */}

      {/* Add Transaction Modal */}
      {showAddModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="glass-card w-full max-w-md animate-fade-in">
            <h2 className="text-xl font-bold mb-6">Novo Lançamento</h2>
            <form onSubmit={handleAddTransaction} className="space-y-4">
              <div>
                <label className="block text-sm text-white/60 mb-1">Valor</label>
                <input 
                  type="number" 
                  step="0.01"
                  required
                  value={newTransaction.amount}
                  onChange={e => setNewTransaction({...newTransaction, amount: e.target.value})}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none text-2xl font-bold"
                  placeholder="0,00"
                />
              </div>
              <div className="flex gap-2">
                <button 
                  type="button"
                  onClick={() => setNewTransaction({...newTransaction, type: 'expense'})}
                  className={`flex-1 p-3 rounded-xl border transition-all ${newTransaction.type === 'expense' ? 'bg-red-500/20 border-red-500 text-red-400' : 'bg-white/5 border-white/10 text-white/40'}`}
                >
                  Saída
                </button>
                <button 
                  type="button"
                  onClick={() => setNewTransaction({...newTransaction, type: 'income'})}
                  className={`flex-1 p-3 rounded-xl border transition-all ${newTransaction.type === 'income' ? 'bg-green-500/20 border-green-500 text-green-400' : 'bg-white/5 border-white/10 text-white/40'}`}
                >
                  Entrada
                </button>
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-1">Categoria</label>
                <select 
                  value={newTransaction.category}
                  onChange={e => setNewTransaction({...newTransaction, category: e.target.value})}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none"
                >
                  <option value="Geral">Geral</option>
                  <option value="Alimentação">Alimentação</option>
                  <option value="Transporte">Transporte</option>
                  <option value="Lazer">Lazer</option>
                  <option value="Saúde">Saúde</option>
                  <option value="Educação">Educação</option>
                  <option value="Contas Fixas">Contas Fixas</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-1">Descrição</label>
                <input 
                  type="text"
                  value={newTransaction.description}
                  onChange={e => setNewTransaction({...newTransaction, description: e.target.value})}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none"
                  placeholder="Ex: Almoço, Uber, Salário..."
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setShowAddModal(false)} className="flex-1 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">Cancelar</button>
                <button type="submit" className="flex-1 p-3 rounded-xl bg-brand-primary text-black font-bold hover:opacity-90 transition-opacity">Confirmar</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Credit Card Modal */}
      {showCardModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="glass-card w-full max-w-md animate-fade-in">
            <h2 className="text-xl font-bold mb-6">
              {editingCard ? 'Editar Cartão' : 'Novo Cartão'}
            </h2>
            <form onSubmit={handleSaveCard} className="space-y-4">
              <div>
                <label className="block text-sm text-white/60 mb-1">Nome do Cartão</label>
                <input
                  type="text"
                  required
                  value={cardForm.name}
                  onChange={e => setCardForm({ ...cardForm, name: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none"
                  placeholder="Ex: Nubank Roxinho"
                />
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-1">Bandeira</label>
                <input
                  type="text"
                  value={cardForm.brand}
                  onChange={e => setCardForm({ ...cardForm, brand: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none"
                  placeholder="Visa, Mastercard..."
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-white/60 mb-1">Limite</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={cardForm.limit}
                    onChange={e => setCardForm({ ...cardForm, limit: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm text-white/60 mb-1">Utilizado</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={cardForm.used}
                    onChange={e => setCardForm({ ...cardForm, used: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-white/60 mb-1">Dia de Fechamento</label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={cardForm.closing_day}
                    onChange={e => setCardForm({ ...cardForm, closing_day: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm text-white/60 mb-1">Dia de Vencimento</label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={cardForm.due_day}
                    onChange={e => setCardForm({ ...cardForm, due_day: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none"
                  />
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowCardModal(false);
                    setEditingCard(null);
                  }}
                  className="flex-1 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 p-3 rounded-xl bg-brand-primary text-black font-bold hover:opacity-90 transition-opacity"
                >
                  {editingCard ? 'Salvar' : 'Cadastrar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Installment Modal */}
      {showInstallmentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="glass-card w-full max-w-md animate-fade-in">
            <h2 className="text-xl font-bold mb-6">
              {editingInstallment ? 'Editar Parcelamento' : 'Novo Parcelamento'}
            </h2>
            <form onSubmit={handleSaveInstallment} className="space-y-4">
              <div>
                <label className="block text-sm text-white/60 mb-1">Cartão</label>
                <select
                  required
                  value={installmentForm.card_id}
                  onChange={e => setInstallmentForm({ ...installmentForm, card_id: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none"
                >
                  <option value="" disabled>Selecione um cartão</option>
                  {cards.map(card => (
                    <option key={card.id} value={card.id}>{card.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-1">Descrição</label>
                <input
                  type="text"
                  required
                  value={installmentForm.description}
                  onChange={e => setInstallmentForm({ ...installmentForm, description: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none"
                  placeholder="Ex: Notebook, Celular..."
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-white/60 mb-1">Valor Total</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={installmentForm.total_amount}
                    onChange={e => setInstallmentForm({ ...installmentForm, total_amount: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm text-white/60 mb-1">Valor Mensal</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={installmentForm.monthly_amount}
                    onChange={e => setInstallmentForm({ ...installmentForm, monthly_amount: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-white/60 mb-1">Parcela Atual</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={installmentForm.current_installment}
                    onChange={e => setInstallmentForm({ ...installmentForm, current_installment: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm text-white/60 mb-1">Total de Parcelas</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={installmentForm.total_installments}
                    onChange={e => setInstallmentForm({ ...installmentForm, total_installments: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none"
                  />
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowInstallmentModal(false);
                    setEditingInstallment(null);
                  }}
                  className="flex-1 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 p-3 rounded-xl bg-brand-primary text-black font-bold hover:opacity-90 transition-opacity"
                >
                  {editingInstallment ? 'Salvar' : 'Cadastrar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Salary Confirmation Modal */}
      {showSalaryConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="glass-card w-full max-w-md animate-fade-in">
            <h2 className="text-xl font-bold mb-3">Confirmação de Salário</h2>
            <p className="text-sm text-white/70 leading-relaxed">
              Hoje ({salaryPromptDayLabel}) é dia de pagamento. Você já recebeu seu salário líquido estimado de
              {' '}
              <span className="font-bold text-brand-primary">
                R$ {(salaryPromptAmount ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              ?
            </p>
            <p className="text-[11px] text-white/40 mt-2">
              Ao confirmar, o lançamento de salário será registrado e o próximo pagamento seguirá o ciclo configurado.
            </p>
            <div className="flex gap-3 pt-5">
              <button
                type="button"
                onClick={() => setShowSalaryConfirmModal(false)}
                disabled={salaryPromptProcessing}
                className="flex-1 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors disabled:opacity-60"
              >
                Ainda não
              </button>
              <button
                type="button"
                onClick={handleConfirmSalaryReceived}
                disabled={salaryPromptProcessing}
                className="flex-1 p-3 rounded-xl bg-brand-primary text-black font-bold hover:opacity-90 transition-opacity disabled:opacity-60"
              >
                {salaryPromptProcessing ? 'Confirmando...' : 'Recebi'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Settings Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="glass-card w-full max-w-lg animate-fade-in max-h-[90vh] overflow-y-auto no-scrollbar">
            <h2 className="text-xl font-bold mb-6">Configurações Base</h2>
            <form 
              onSubmit={(e) => {
                e.preventDefault();
                handleUpdateSettings(editSettings as UserSettings);
              }} 
              className="space-y-4"
            >
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-white/60 mb-1">Saldo Atual (Manual)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    value={editSettings.current_balance}
                    onChange={e => setEditSettings({...editSettings, current_balance: parseFloat(e.target.value)})}
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm text-white/60 mb-1">Salário Líquido Est.</label>
                  <input 
                    type="number" 
                    step="0.01"
                    value={editSettings.net_salary_estimated}
                    readOnly
                    aria-readonly="true"
                    title="Valor calculado automaticamente na Base Financeira"
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-3 outline-none cursor-not-allowed text-white/70"
                  />
                  <p className="mt-1 text-[10px] text-white/40">Calculado automaticamente na Base Financeira.</p>
                </div>
                <div>
                  <label className="block text-sm text-white/60 mb-1">Benefícios (VR/VA)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    value={editSettings.benefits}
                    onChange={e => setEditSettings({...editSettings, benefits: parseFloat(e.target.value)})}
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm text-white/60 mb-1">Dia do Pagamento</label>
                  <input 
                    type="number" 
                    min="1" max="31"
                    value={editSettings.payday_1}
                    onChange={e => setEditSettings({...editSettings, payday_1: parseInt(e.target.value)})}
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm text-white/60 mb-1">Ciclo de Pagamento</label>
                <select 
                  value={editSettings.payday_cycle}
                  onChange={e => setEditSettings({...editSettings, payday_cycle: e.target.value as any})}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none"
                >
                  <option value="monthly">Mensal (1 pagamento)</option>
                  <option value="biweekly">Quinzenal (2 pagamentos)</option>
                </select>
              </div>

              {editSettings.payday_cycle === 'biweekly' && (
                <div>
                  <label className="block text-sm text-white/60 mb-1">Segundo Dia do Pagamento</label>
                  <input 
                    type="number" 
                    min="1" max="31"
                    value={editSettings.payday_2 || ''}
                    onChange={e => setEditSettings({...editSettings, payday_2: parseInt(e.target.value)})}
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-primary outline-none"
                  />
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setShowSettingsModal(false)} className="flex-1 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">Cancelar</button>
                <button type="submit" className="flex-1 p-3 rounded-xl bg-brand-primary text-black font-bold hover:opacity-90 transition-opacity">Salvar Alterações</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Setup Helper Modal */}
      {showSetupHelper && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl glass-card !p-6 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-yellow-500/20 flex items-center justify-center text-yellow-500">
                  <Database size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-bold">Configuração do Banco de Dados</h2>
                  <p className="text-sm text-white/40">Siga os passos abaixo para ativar todas as funções.</p>
                </div>
              </div>
              <button onClick={() => setShowSetupHelper(false)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-6">
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <div className="flex items-center gap-2 mb-2 text-yellow-500">
                  <Info size={16} />
                  <span className="text-xs font-bold uppercase tracking-wider">Por que isso é necessário?</span>
                </div>
                <p className="text-sm text-white/70 leading-relaxed">
                  O MFinanceiro utiliza tabelas específicas para gerenciar suas contas fixas, gastos diários e cartões de crédito. 
                  Detectamos que as seguintes tabelas estão faltando: 
                  <span className="text-yellow-500 font-mono ml-1">{missingTables.join(', ')}</span>.
                </p>
              </div>

              <div className="space-y-3">
                <div className="text-sm font-bold">Instruções:</div>
                <ol className="text-sm text-white/60 space-y-2 list-decimal list-inside">
                  <li>Acesse o seu painel do <span className="text-white font-bold">Supabase</span>.</li>
                  <li>Vá em <span className="text-white font-bold">SQL Editor</span> no menu lateral.</li>
                  <li>Clique em <span className="text-white font-bold">New Query</span>.</li>
                  <li>Cole o código abaixo e clique em <span className="text-white font-bold">Run</span>.</li>
                </ol>
              </div>

              <div className="relative group">
                <pre className="p-4 bg-black rounded-xl border border-white/10 text-[10px] font-mono text-brand-primary overflow-x-auto max-h-48 no-scrollbar">
{`-- SQL SCRIPT PARA MFINANCEIRO
-- 1. TABELA DE TRANSAÇÕES (LEDGER)
CREATE TABLE IF NOT EXISTS mf_finance_ledger_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  description TEXT NOT NULL,
  amount DECIMAL NOT NULL,
  type TEXT NOT NULL,
  category TEXT,
  is_pending BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Corrigir colunas se existirem com nomes errados
DO $$ 
BEGIN 
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mf_finance_ledger_entries' AND column_name='data') THEN
    ALTER TABLE mf_finance_ledger_entries RENAME COLUMN data TO date;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mf_finance_ledger_entries' AND column_name='valor') THEN
    ALTER TABLE mf_finance_ledger_entries RENAME COLUMN valor TO amount;
  END IF;
END $$;

-- 2. TABELA DE CONFIGURAÇÕES
CREATE TABLE IF NOT EXISTS mf_user_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id),
  current_balance DECIMAL DEFAULT 0,
  gross_salary DECIMAL DEFAULT 0,
  net_salary_estimated DECIMAL DEFAULT 0,
  benefits DECIMAL DEFAULT 0,
  deductions DECIMAL DEFAULT 0,
  payday_cycle TEXT DEFAULT 'monthly',
  payday_1 INTEGER DEFAULT 5,
  payday_2 INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Limpar duplicatas se existirem (mantém apenas a mais recente)
DELETE FROM mf_user_settings a USING mf_user_settings b 
WHERE a.id < b.id AND a.user_id = b.user_id;

-- Garantir restrição única se a tabela já existia
DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='mf_user_settings_user_id_key') THEN
    ALTER TABLE mf_user_settings ADD CONSTRAINT mf_user_settings_user_id_key UNIQUE (user_id);
  END IF;
END $$;

-- 3. TABELA DE CONTAS FIXAS
CREATE TABLE IF NOT EXISTS mf_fixed_bills (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL,
  amount DECIMAL NOT NULL,
  due_day INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',
  category TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. TABELA DE CONTAS DIÁRIAS
CREATE TABLE IF NOT EXISTS mf_daily_bills (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL,
  average_amount DECIMAL NOT NULL,
  frequency TEXT DEFAULT 'weekly',
  category TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. TABELA DE CARTÕES DE CRÉDITO
CREATE TABLE IF NOT EXISTS mf_credit_cards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL,
  brand TEXT,
  "limit" DECIMAL NOT NULL,
  used DECIMAL DEFAULT 0,
  closing_day INTEGER NOT NULL,
  due_day INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. TABELA DE PARCELAMENTOS
CREATE TABLE IF NOT EXISTS mf_card_installments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  card_id UUID NOT NULL REFERENCES mf_credit_cards(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  total_amount DECIMAL NOT NULL,
  monthly_amount DECIMAL NOT NULL,
  current_installment INTEGER NOT NULL,
  total_installments INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- SEGURANÇA (RLS)
ALTER TABLE mf_finance_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE mf_user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE mf_fixed_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE mf_daily_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE mf_credit_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE mf_card_installments ENABLE ROW LEVEL SECURITY;

-- POLÍTICAS
DROP POLICY IF EXISTS "Manage own ledger" ON mf_finance_ledger_entries;
CREATE POLICY "Manage own ledger" ON mf_finance_ledger_entries FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Manage own settings" ON mf_user_settings;
CREATE POLICY "Manage own settings" ON mf_user_settings FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Manage own fixed bills" ON mf_fixed_bills;
CREATE POLICY "Manage own fixed bills" ON mf_fixed_bills FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Manage own daily bills" ON mf_daily_bills;
CREATE POLICY "Manage own daily bills" ON mf_daily_bills FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Manage own credit cards" ON mf_credit_cards;
CREATE POLICY "Manage own credit cards" ON mf_credit_cards FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Manage own installments" ON mf_card_installments;
CREATE POLICY "Manage own installments" ON mf_card_installments FOR ALL USING (true);`}
                </pre>
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(`-- SQL SCRIPT COMPLETO PARA MFINANCEIRO
CREATE TABLE IF NOT EXISTS mf_finance_ledger_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  description TEXT NOT NULL,
  amount DECIMAL NOT NULL,
  type TEXT NOT NULL,
  category TEXT,
  is_pending BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

DO $$ 
BEGIN 
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mf_finance_ledger_entries' AND column_name='data') THEN
    ALTER TABLE mf_finance_ledger_entries RENAME COLUMN data TO date;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mf_finance_ledger_entries' AND column_name='valor') THEN
    ALTER TABLE mf_finance_ledger_entries RENAME COLUMN valor TO amount;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS mf_user_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id),
  current_balance DECIMAL DEFAULT 0,
  gross_salary DECIMAL DEFAULT 0,
  net_salary_estimated DECIMAL DEFAULT 0,
  benefits DECIMAL DEFAULT 0,
  deductions DECIMAL DEFAULT 0,
  payday_cycle TEXT DEFAULT 'monthly',
  payday_1 INTEGER DEFAULT 5,
  payday_2 INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

DELETE FROM mf_user_settings a USING mf_user_settings b WHERE a.id < b.id AND a.user_id = b.user_id;

DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='mf_user_settings_user_id_key') THEN
    ALTER TABLE mf_user_settings ADD CONSTRAINT mf_user_settings_user_id_key UNIQUE (user_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS mf_fixed_bills (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL,
  amount DECIMAL NOT NULL,
  due_day INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',
  category TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mf_daily_bills (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL,
  average_amount DECIMAL NOT NULL,
  frequency TEXT DEFAULT 'weekly',
  category TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mf_credit_cards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL,
  brand TEXT,
  "limit" DECIMAL NOT NULL,
  used DECIMAL DEFAULT 0,
  closing_day INTEGER NOT NULL,
  due_day INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mf_card_installments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  card_id UUID NOT NULL REFERENCES mf_credit_cards(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  total_amount DECIMAL NOT NULL,
  monthly_amount DECIMAL NOT NULL,
  current_installment INTEGER NOT NULL,
  total_installments INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE mf_finance_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE mf_user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE mf_fixed_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE mf_daily_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE mf_credit_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE mf_card_installments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Manage own ledger" ON mf_finance_ledger_entries FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Manage own settings" ON mf_user_settings FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Manage own fixed bills" ON mf_fixed_bills FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Manage own daily bills" ON mf_daily_bills FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Manage own credit cards" ON mf_credit_cards FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Manage own installments" ON mf_card_installments FOR ALL USING (true);`);
                    alert('Código SQL copiado!');
                  }}
                  className="absolute top-2 right-2 p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors text-white"
                >
                  <Check size={14} />
                </button>
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={() => {
                    setShowSetupHelper(false);
                    fetchData();
                  }}
                  className="flex-1 py-3 bg-brand-primary text-black rounded-xl font-bold hover:opacity-90 transition-opacity"
                >
                  Já executei o SQL
                </button>
                <button 
                  onClick={() => setShowSetupHelper(false)}
                  className="px-6 py-3 bg-white/5 text-white rounded-xl font-bold hover:bg-white/10 transition-all"
                >
                  Depois
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


