import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  FileSearch,
  FileText,
  Percent,
  Plus,
  ReceiptText,
  Save,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { calculatePayrollFromGross } from './payroll-tax';
import {
  analyzePayrollPdf,
  PayrollItem,
  PayrollItemCategory,
  PayrollItemKind,
} from './payroll-pdf-parser';
import { supabase } from './supabase';

type SettingsRow = {
  user_id: string;
  gross_salary: number;
  net_salary_estimated: number;
  deductions: number;
  benefits: number;
  payday_cycle: 'monthly' | 'biweekly';
  payday_1: number;
  payday_2?: number | null;
  payday_1_percentage?: number | null;
  payday_2_percentage?: number | null;
};

type PayrollRow = {
  id: string;
  competence: string;
  gross_salary: number;
  expected_inss: number;
  inss_amount: number;
  expected_irrf: number;
  irrf_amount: number;
  other_deductions: number;
  benefits: number;
  net_salary: number;
  payday_cycle: 'monthly' | 'biweekly';
  payday_1: number;
  payday_2?: number | null;
  payday_1_percentage: number;
  payday_2_percentage: number;
  notes?: string | null;
  payroll_items?: unknown;
  source_kind?: 'manual' | 'pdf' | 'mixed';
  source_file_name?: string | null;
};

type FormState = {
  competence: string;
  grossSalary: string;
  paydayCycle: 'monthly' | 'biweekly';
  payday1: string;
  payday2: string;
  payday1Percentage: string;
  payday2Percentage: string;
  notes: string;
};

const money = (value: number) =>
  Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const percentage = (part: number, total: number) =>
  total > 0 ? `${((part / total) * 100).toFixed(2)}%` : '0,00%';

const numberValue = (value: string | number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

const monthKey = () => format(new Date(), 'yyyy-MM');

const inputClass =
  'w-full rounded-xl border border-white/10 bg-black/35 px-3 py-2.5 text-sm text-white outline-none transition focus:border-brand-primary/60';

function competenceDate(key: string): Date {
  const parsed = parseISO(`${key || monthKey()}-01T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function categoryFromDescription(description: string): PayrollItemCategory {
  const text = normalizeText(description);
  if (/\binss\b|previdencia/.test(text)) return 'inss';
  if (/\birrf\b|imposto de renda/.test(text)) return 'irrf';
  if (/vale transporte|\bvt\b|transporte/.test(text)) return 'transport';
  if (/saude|medic|odont|farmacia|coparticipacao/.test(text)) return 'health';
  if (/alimentacao|refeicao|ticket|cesta|\bvr\b|\bva\b/.test(text)) return 'food';
  if (/emprestimo|consignado|financiamento/.test(text)) return 'loan';
  if (/falta|atraso|ausencia/.test(text)) return 'absence';
  if (/salario|vencimento|ordenado/.test(text)) return 'salary';
  return 'other';
}

function createId(prefix = 'manual'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultForm(): FormState {
  return {
    competence: monthKey(),
    grossSalary: '0',
    paydayCycle: 'monthly',
    payday1: '5',
    payday2: '20',
    payday1Percentage: '100',
    payday2Percentage: '0',
    notes: '',
  };
}

function normalizeSettings(row: any): SettingsRow {
  return {
    ...row,
    user_id: String(row.user_id || ''),
    gross_salary: Number(row.gross_salary || 0),
    net_salary_estimated: Number(row.net_salary_estimated || 0),
    deductions: Number(row.deductions || 0),
    benefits: Number(row.benefits || 0),
    payday_cycle: row.payday_cycle === 'biweekly' ? 'biweekly' : 'monthly',
    payday_1: Number(row.payday_1 || 5),
    payday_2: Number(row.payday_2 || 20),
    payday_1_percentage: Number(row.payday_1_percentage ?? 50),
    payday_2_percentage: Number(row.payday_2_percentage ?? 50),
  };
}

function normalizePayroll(row: any): PayrollRow {
  return {
    ...row,
    gross_salary: Number(row.gross_salary || 0),
    expected_inss: Number(row.expected_inss || 0),
    inss_amount: Number(row.inss_amount || 0),
    expected_irrf: Number(row.expected_irrf || 0),
    irrf_amount: Number(row.irrf_amount || 0),
    other_deductions: Number(row.other_deductions || 0),
    benefits: Number(row.benefits || 0),
    net_salary: Number(row.net_salary || 0),
    payday_cycle: row.payday_cycle === 'biweekly' ? 'biweekly' : 'monthly',
    payday_1: Number(row.payday_1 || 5),
    payday_2: Number(row.payday_2 || 20),
    payday_1_percentage: Number(row.payday_1_percentage ?? 50),
    payday_2_percentage: Number(row.payday_2_percentage ?? 50),
  };
}

function parseStoredItems(raw: unknown): PayrollItem[] {
  let value = raw;
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw); } catch { value = []; }
  }
  if (!Array.isArray(value)) return [];

  return value
    .map((item: any, index) => {
      const description = String(item?.description || '').trim();
      const kind: PayrollItemKind = ['earning', 'deduction', 'benefit'].includes(item?.kind)
        ? item.kind
        : 'deduction';
      if (!description) return null;
      const amount = numberValue(item?.amount);
      return {
        id: String(item?.id || `saved-${index}`),
        code: item?.code ? String(item.code) : undefined,
        description,
        kind,
        category: (item?.category || categoryFromDescription(description)) as PayrollItemCategory,
        amount,
        percentage: numberValue(item?.percentage),
        reference: item?.reference ? String(item.reference) : undefined,
        source: item?.source === 'pdf' ? 'pdf' : 'manual',
        confidence: numberValue(item?.confidence || 1),
      } as PayrollItem;
    })
    .filter((item): item is PayrollItem => Boolean(item));
}

function itemsFromLegacyRow(row: PayrollRow): PayrollItem[] {
  const items: PayrollItem[] = [];
  if (row.inss_amount > 0) items.push({
    id: createId('legacy'), description: 'INSS', kind: 'deduction', category: 'inss',
    amount: row.inss_amount, percentage: row.gross_salary > 0 ? row.inss_amount / row.gross_salary * 100 : 0,
    source: 'manual', confidence: 1,
  });
  if (row.irrf_amount > 0) items.push({
    id: createId('legacy'), description: 'IRRF', kind: 'deduction', category: 'irrf',
    amount: row.irrf_amount, percentage: row.gross_salary > 0 ? row.irrf_amount / row.gross_salary * 100 : 0,
    source: 'manual', confidence: 1,
  });
  if (row.other_deductions > 0) items.push({
    id: createId('legacy'), description: 'Outros descontos', kind: 'deduction', category: 'other',
    amount: row.other_deductions, percentage: row.gross_salary > 0 ? row.other_deductions / row.gross_salary * 100 : 0,
    source: 'manual', confidence: 1,
  });
  if (row.benefits > 0) items.push({
    id: createId('legacy'), description: 'Benefícios', kind: 'benefit', category: 'other',
    amount: row.benefits, percentage: row.gross_salary > 0 ? row.benefits / row.gross_salary * 100 : 0,
    source: 'manual', confidence: 1,
  });
  return items;
}

function IncomePayrollCenter() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [visible, setVisible] = useState(false);
  const [top, setTop] = useState(72);
  const [userId, setUserId] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingsRow | null>(null);
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [form, setForm] = useState<FormState>(defaultForm);
  const [items, setItems] = useState<PayrollItem[]>([]);
  const [sourceFileName, setSourceFileName] = useState<string | null>(null);
  const [analysisWarnings, setAnalysisWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (mounted) setUserId(data.user?.id || null);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setUserId(session?.user?.id || null));
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const detect = () => {
      const navButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.mf-nav button'));
      navButtons.forEach((button) => {
        const label = button.querySelector<HTMLSpanElement>('span');
        if (label?.textContent?.trim() === 'Preferências') label.textContent = 'Renda e Folha';
      });

      const activeButton = navButtons.find((button) => button.classList.contains('active'));
      const activeLabel = activeButton?.textContent?.trim().toLowerCase() || '';
      const isActive = activeLabel.includes('renda e folha') || activeLabel.includes('preferências');
      setVisible(isActive);

      const header = document.querySelector<HTMLElement>('.mf-topbar');
      setTop(Math.ceil(header?.getBoundingClientRect().bottom || 64) + 8);

      const payrollButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => button.textContent?.trim().toLowerCase() === 'folha de pagamento',
      );
      if (payrollButton) payrollButton.style.display = isActive ? 'none' : '';
    };

    detect();
    const observer = new MutationObserver(detect);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    const interval = window.setInterval(detect, 450);
    window.addEventListener('resize', detect);
    return () => {
      observer.disconnect();
      window.clearInterval(interval);
      window.removeEventListener('resize', detect);
    };
  }, []);

  function recalculatePercentages(nextItems: PayrollItem[], gross: number): PayrollItem[] {
    return nextItems.map((item) => ({
      ...item,
      percentage: gross > 0 ? Math.round((item.amount / gross * 100 + Number.EPSILON) * 100) / 100 : 0,
    }));
  }

  function hydrate(competence: string, nextSettings: SettingsRow | null, sourceRows: PayrollRow[]) {
    const existing = sourceRows.find((row) => row.competence.slice(0, 7) === competence);
    if (existing) {
      const savedItems = parseStoredItems(existing.payroll_items);
      const nextItems = savedItems.length ? savedItems : itemsFromLegacyRow(existing);
      setForm({
        competence,
        grossSalary: String(existing.gross_salary),
        paydayCycle: existing.payday_cycle,
        payday1: String(existing.payday_1),
        payday2: String(existing.payday_2 || 20),
        payday1Percentage: String(existing.payday_1_percentage),
        payday2Percentage: String(existing.payday_2_percentage),
        notes: existing.notes || '',
      });
      setItems(recalculatePercentages(nextItems, existing.gross_salary));
      setSourceFileName(existing.source_file_name || null);
      setAnalysisWarnings([]);
      setDirty(false);
      return;
    }

    const gross = Number(nextSettings?.gross_salary || 0);
    const estimate = calculatePayrollFromGross(gross, competenceDate(competence));
    const inferredOther = Math.max(0, Number(nextSettings?.deductions || 0) - estimate.inss - estimate.irrf);
    const cycle = nextSettings?.payday_cycle || 'monthly';
    const initialItems: PayrollItem[] = [];
    if (estimate.inss > 0) initialItems.push({
      id: createId(), description: 'INSS', kind: 'deduction', category: 'inss', amount: estimate.inss,
      percentage: gross > 0 ? estimate.inss / gross * 100 : 0, source: 'manual', confidence: 1,
    });
    if (estimate.irrf > 0) initialItems.push({
      id: createId(), description: 'IRRF', kind: 'deduction', category: 'irrf', amount: estimate.irrf,
      percentage: gross > 0 ? estimate.irrf / gross * 100 : 0, source: 'manual', confidence: 1,
    });
    if (inferredOther > 0) initialItems.push({
      id: createId(), description: 'Outros descontos', kind: 'deduction', category: 'other', amount: inferredOther,
      percentage: gross > 0 ? inferredOther / gross * 100 : 0, source: 'manual', confidence: 1,
    });
    if (Number(nextSettings?.benefits || 0) > 0) initialItems.push({
      id: createId(), description: 'Benefícios', kind: 'benefit', category: 'other', amount: Number(nextSettings?.benefits || 0),
      percentage: gross > 0 ? Number(nextSettings?.benefits || 0) / gross * 100 : 0, source: 'manual', confidence: 1,
    });

    setForm({
      competence,
      grossSalary: String(gross),
      paydayCycle: cycle,
      payday1: String(nextSettings?.payday_1 || 5),
      payday2: String(nextSettings?.payday_2 || 20),
      payday1Percentage: String(cycle === 'biweekly' ? Number(nextSettings?.payday_1_percentage ?? 50) : 100),
      payday2Percentage: String(cycle === 'biweekly' ? Number(nextSettings?.payday_2_percentage ?? 50) : 0),
      notes: '',
    });
    setItems(recalculatePercentages(initialItems, gross));
    setSourceFileName(null);
    setAnalysisWarnings([]);
    setDirty(false);
  }

  async function loadData(targetCompetence = monthKey()) {
    if (!userId) return;
    setLoading(true);
    setError(null);

    const [settingsResult, rowsResult] = await Promise.all([
      supabase.from('mf_user_settings').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('mf_payroll_statements').select('*').eq('user_id', userId).order('competence', { ascending: false }).limit(18),
    ]);

    if (settingsResult.error) setError(settingsResult.error.message);
    if (rowsResult.error) setError(rowsResult.error.message);

    const nextSettings = settingsResult.data ? normalizeSettings(settingsResult.data) : null;
    const nextRows = (rowsResult.data || []).map(normalizePayroll);
    setSettings(nextSettings);
    setRows(nextRows);
    hydrate(targetCompetence, nextSettings, nextRows);
    setLoading(false);
  }

  useEffect(() => {
    if (visible && userId) void loadData(form.competence || monthKey());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, userId]);

  const gross = numberValue(form.grossSalary);
  const expected = useMemo(() => calculatePayrollFromGross(gross, competenceDate(form.competence)), [gross, form.competence]);
  const normalizedItems = useMemo(() => recalculatePercentages(items, gross), [items, gross]);
  const deductionItems = normalizedItems.filter((item) => item.kind === 'deduction');
  const benefitItems = normalizedItems.filter((item) => item.kind === 'benefit');
  const earningItems = normalizedItems.filter((item) => item.kind === 'earning');
  const actualInss = deductionItems.filter((item) => item.category === 'inss' || /\binss\b/.test(normalizeText(item.description))).reduce((sum, item) => sum + item.amount, 0);
  const actualIrrf = deductionItems.filter((item) => item.category === 'irrf' || /\birrf\b|imposto de renda/.test(normalizeText(item.description))).reduce((sum, item) => sum + item.amount, 0);
  const otherDeductions = deductionItems.reduce((sum, item) => sum + item.amount, 0) - actualInss - actualIrrf;
  const totalDeductions = deductionItems.reduce((sum, item) => sum + item.amount, 0);
  const benefits = benefitItems.reduce((sum, item) => sum + item.amount, 0);
  const netSalary = Math.max(0, gross - totalDeductions);
  const discountRate = gross > 0 ? totalDeductions / gross : 0;
  const firstPercentage = form.paydayCycle === 'biweekly' ? Math.min(100, numberValue(form.payday1Percentage)) : 100;
  const secondPercentage = form.paydayCycle === 'biweekly' ? Math.min(100, numberValue(form.payday2Percentage)) : 0;
  const firstPayment = netSalary * firstPercentage / 100;
  const secondPayment = netSalary * secondPercentage / 100;
  const sourceKind: 'manual' | 'pdf' | 'mixed' = sourceFileName
    ? normalizedItems.some((item) => item.source === 'manual') ? 'mixed' : 'pdf'
    : 'manual';

  function change<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setDirty(true);
    setSuccess(null);
  }

  function selectCompetence(value: string) {
    hydrate(value, settings, rows);
    setSuccess(null);
    setError(null);
  }

  function updateItem(id: string, patch: Partial<PayrollItem>) {
    setItems((current) => current.map((item) => {
      if (item.id !== id) return item;
      const description = patch.description ?? item.description;
      return {
        ...item,
        ...patch,
        description,
        category: patch.description !== undefined ? categoryFromDescription(description) : patch.category || item.category,
        source: 'manual',
        confidence: 1,
      };
    }));
    setDirty(true);
    setSuccess(null);
  }

  function addItem(kind: PayrollItemKind = 'deduction') {
    setItems((current) => [...current, {
      id: createId(), description: '', kind, category: 'other', amount: 0,
      percentage: 0, source: 'manual', confidence: 1,
    }]);
    setDirty(true);
    setSuccess(null);
  }

  function removeItem(id: string) {
    setItems((current) => current.filter((item) => item.id !== id));
    setDirty(true);
    setSuccess(null);
  }

  function useOfficialEstimate() {
    const withoutTaxes = items.filter((item) => item.category !== 'inss' && item.category !== 'irrf');
    const taxes: PayrollItem[] = [];
    if (expected.inss > 0) taxes.push({
      id: createId(), description: 'INSS', kind: 'deduction', category: 'inss', amount: expected.inss,
      percentage: gross > 0 ? expected.inss / gross * 100 : 0, source: 'manual', confidence: 1,
    });
    if (expected.irrf > 0) taxes.push({
      id: createId(), description: 'IRRF', kind: 'deduction', category: 'irrf', amount: expected.irrf,
      percentage: gross > 0 ? expected.irrf / gross * 100 : 0, source: 'manual', confidence: 1,
    });
    setItems([...taxes, ...withoutTaxes]);
    setDirty(true);
    setSuccess(null);
  }

  function changeCycle(value: 'monthly' | 'biweekly') {
    setForm((current) => ({
      ...current,
      paydayCycle: value,
      payday1Percentage: value === 'monthly' ? '100' : '50',
      payday2Percentage: value === 'monthly' ? '0' : '50',
    }));
    setDirty(true);
    setSuccess(null);
  }

  function changeFirstPercentage(value: string) {
    const first = Math.min(100, numberValue(value));
    setForm((current) => ({ ...current, payday1Percentage: String(first), payday2Percentage: String(100 - first) }));
    setDirty(true);
    setSuccess(null);
  }

  function changeSecondPercentage(value: string) {
    const second = Math.min(100, numberValue(value));
    setForm((current) => ({ ...current, payday2Percentage: String(second), payday1Percentage: String(100 - second) }));
    setDirty(true);
    setSuccess(null);
  }

  async function analyzeFile(file: File) {
    setAnalyzing(true);
    setAnalysisProgress(0);
    setError(null);
    setSuccess(null);
    setAnalysisWarnings([]);

    try {
      const analysis = await analyzePayrollPdf(file, setAnalysisProgress);
      const nextGross = analysis.grossSalary || gross;
      setForm((current) => ({
        ...current,
        competence: analysis.competence || current.competence,
        grossSalary: String(nextGross),
      }));
      setItems(recalculatePercentages(analysis.items, nextGross));
      setSourceFileName(file.name);
      setAnalysisWarnings(analysis.warnings);
      setDirty(true);
      setSuccess(`PDF analisado: ${analysis.items.length} rubricas encontradas em ${analysis.pageCount} página(s). Revise antes de salvar.`);
    } catch (analysisError: any) {
      setError(analysisError?.message || 'Não foi possível analisar o PDF do holerite.');
    } finally {
      setAnalyzing(false);
      setAnalysisProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function save() {
    if (!userId) return;
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const payday1 = Number(form.payday1);
      const payday2 = Number(form.payday2);
      const validItems = normalizedItems.filter((item) => item.description.trim() && item.amount >= 0);
      if (gross <= 0) throw new Error('Informe um salário bruto maior que zero.');
      if (totalDeductions > gross) throw new Error('Os descontos não podem superar o salário bruto.');
      if (items.some((item) => !item.description.trim())) throw new Error('Preencha a descrição de todas as rubricas ou exclua as linhas vazias.');
      if (!Number.isInteger(payday1) || payday1 < 1 || payday1 > 31) throw new Error('O primeiro dia deve ficar entre 1 e 31.');
      if (form.paydayCycle === 'biweekly') {
        if (!Number.isInteger(payday2) || payday2 < 1 || payday2 > 31) throw new Error('O segundo dia deve ficar entre 1 e 31.');
        if (Math.abs(firstPercentage + secondPercentage - 100) > 0.01) throw new Error('Os percentuais precisam somar 100%.');
      }

      const { error: saveError } = await supabase.rpc('mf_save_payroll_statement_v2', {
        p_competence: `${form.competence}-01`,
        p_gross_salary: gross,
        p_expected_inss: expected.inss,
        p_inss_amount: actualInss,
        p_expected_irrf: expected.irrf,
        p_irrf_amount: actualIrrf,
        p_other_deductions: Math.max(0, otherDeductions),
        p_benefits: benefits,
        p_payday_cycle: form.paydayCycle,
        p_payday_1: payday1,
        p_payday_2: form.paydayCycle === 'biweekly' ? payday2 : null,
        p_payday_1_percentage: form.paydayCycle === 'biweekly' ? firstPercentage : 100,
        p_payday_2_percentage: form.paydayCycle === 'biweekly' ? secondPercentage : 0,
        p_notes: form.notes.trim() || null,
        p_items: validItems.map((item) => ({
          id: item.id,
          code: item.code || null,
          description: item.description.trim(),
          kind: item.kind,
          category: item.category,
          amount: Number(item.amount.toFixed(2)),
          percentage: Number(item.percentage.toFixed(2)),
          reference: item.reference || null,
          source: item.source,
          confidence: item.confidence,
        })),
        p_source_kind: sourceKind,
        p_source_file_name: sourceFileName,
      });

      if (saveError) throw saveError;
      setSuccess('Holerite, rubricas, percentuais e distribuição foram salvos. O Dashboard foi atualizado.');
      setDirty(false);
      await loadData(form.competence);
    } catch (saveError: any) {
      setError(saveError?.message || 'Não foi possível salvar os dados de renda e folha.');
    } finally {
      setSaving(false);
    }
  }

  if (!visible || !userId) return null;

  return (
    <div className="fixed z-[49] overflow-hidden rounded-2xl border border-white/10 bg-[#050505] shadow-2xl" style={{ top, left: 12, right: 12, bottom: 12 }}>
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3 md:px-5">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-black md:text-lg"><SlidersHorizontal size={19} className="text-brand-primary" /> Renda e Folha</h2>
            <p className="mt-0.5 truncate text-[9px] uppercase tracking-[0.18em] text-white/35">Importe o holerite, revise as rubricas e atualize a renda</p>
          </div>
          <div className="flex items-center gap-2">
            {dirty && <span className="hidden rounded-full bg-amber-500/10 px-2 py-1 text-[9px] font-bold text-amber-300 sm:inline">Alterações não salvas</span>}
            <button type="button" onClick={save} disabled={saving || loading || analyzing} className="flex items-center gap-2 rounded-xl bg-brand-primary px-4 py-2 text-xs font-black text-black disabled:opacity-50">
              <Save size={14} /> {saving ? 'Salvando...' : 'Salvar tudo'}
            </button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto p-3 md:p-4">
          {(error || success) && (
            <div className={`mb-3 flex items-center justify-between rounded-xl border px-3 py-2 text-xs ${error ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-green-500/30 bg-green-500/10 text-green-300'}`}>
              <span className="flex items-center gap-2">{error ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}{error || success}</span>
              <button type="button" onClick={() => { setError(null); setSuccess(null); }}>×</button>
            </div>
          )}

          <section className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-6">
            <Metric label="Salário bruto" value={money(gross)} />
            <Metric label="Salário líquido" value={money(netSalary)} highlight />
            <Metric label="Descontos" value={money(totalDeductions)} detail={percentage(totalDeductions, gross)} danger={discountRate > 0.5} />
            <Metric label="Benefícios" value={money(benefits)} />
            <Metric label="Rubricas" value={String(normalizedItems.length)} detail={`${deductionItems.length} descontos`} />
            <Metric label="Origem" value={sourceKind === 'pdf' ? 'PDF' : sourceKind === 'mixed' ? 'PDF + manual' : 'Manual'} detail={sourceFileName || undefined} />
          </section>

          <div className="grid gap-3 xl:grid-cols-12">
            <section className="glass-card !p-4 xl:col-span-5">
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-primary/10 text-brand-primary"><FileSearch size={21} /></div>
                <div><h3 className="text-sm font-bold">Analisar PDF do holerite</h3><p className="text-[10px] text-white/35">A leitura acontece localmente no navegador.</p></div>
              </div>
              <input ref={fileInputRef} className="hidden" type="file" accept="application/pdf,.pdf" onChange={(event) => { const file = event.target.files?.[0]; if (file) void analyzeFile(file); }} />
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={analyzing} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-brand-primary/35 bg-brand-primary/5 py-5 text-xs font-bold text-brand-primary disabled:opacity-50">
                <Upload size={17} /> {analyzing ? `Analisando... ${analysisProgress}%` : sourceFileName ? 'Analisar outro PDF' : 'Selecionar PDF do holerite'}
              </button>
              {analyzing && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/5"><div className="h-full bg-brand-primary transition-all" style={{ width: `${analysisProgress}%` }} /></div>}
              {sourceFileName && <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[10px] text-white/45"><strong className="text-white">Arquivo:</strong> {sourceFileName}</div>}
              {analysisWarnings.length > 0 && <div className="mt-3 space-y-1 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-[10px] text-amber-200">{analysisWarnings.map((warning) => <div key={warning}>• {warning}</div>)}</div>}
              <p className="mt-3 text-[9px] leading-relaxed text-white/30">PDFs com texto pesquisável são aceitos. Holerites escaneados como imagem continuam disponíveis para preenchimento manual.</p>
            </section>

            <section className="glass-card !p-4 xl:col-span-7">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div><h3 className="flex items-center gap-2 text-sm font-bold"><ReceiptText size={16} /> Dados da folha</h3><p className="mt-1 text-[10px] text-white/35">Confirme a competência e o total bruto.</p></div>
                <button type="button" onClick={useOfficialEstimate} className="rounded-xl border border-brand-primary/30 bg-brand-primary/10 px-3 py-2 text-[10px] font-bold text-brand-primary">Usar INSS e IRRF estimados</button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Competência"><input className={inputClass} type="month" value={form.competence} onChange={(event) => selectCompetence(event.target.value)} /></Field>
                <Field label="Salário bruto / total de proventos"><input className={inputClass} type="number" min="0" step="0.01" value={form.grossSalary} onChange={(event) => change('grossSalary', event.target.value)} /></Field>
                <ReadOnly label="INSS informado" value={`${money(actualInss)} · ${percentage(actualInss, gross)}`} danger={Math.abs(actualInss - expected.inss) > 2} />
                <ReadOnly label="IRRF informado" value={`${money(actualIrrf)} · ${percentage(actualIrrf, gross)}`} danger={Math.abs(actualIrrf - expected.irrf) > 2} />
                <ReadOnly label="INSS estimado" value={`${money(expected.inss)} · ${percentage(expected.inss, gross)}`} />
                <ReadOnly label="IRRF estimado" value={`${money(expected.irrf)} · ${percentage(expected.irrf, gross)}`} />
                <Field label="Observações" wide><textarea className={`${inputClass} min-h-20 resize-none`} value={form.notes} onChange={(event) => change('notes', event.target.value)} placeholder="Férias, adiantamento, empréstimo, plano de saúde..." /></Field>
              </div>
            </section>

            <section className="glass-card !p-4 xl:col-span-12">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div><h3 className="flex items-center gap-2 text-sm font-bold"><Percent size={16} /> Rubricas do holerite</h3><p className="mt-1 text-[10px] text-white/35">Edite, remova ou acrescente descontos, benefícios e proventos.</p></div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => addItem('deduction')} className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-bold"><Plus size={13} /> Desconto</button>
                  <button type="button" onClick={() => addItem('benefit')} className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-bold"><Plus size={13} /> Benefício</button>
                  <button type="button" onClick={() => addItem('earning')} className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-bold"><Plus size={13} /> Provento</button>
                </div>
              </div>

              {normalizedItems.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 py-8 text-center text-xs text-white/30">Nenhuma rubrica cadastrada. Importe um PDF ou adicione uma linha manualmente.</div>
              ) : (
                <div className="space-y-2">
                  <div className="hidden grid-cols-[140px_1fr_150px_110px_80px_36px] gap-2 px-2 text-[8px] font-bold uppercase text-white/25 lg:grid">
                    <span>Tipo</span><span>Descrição</span><span>Valor</span><span>Percentual</span><span>Origem</span><span />
                  </div>
                  {normalizedItems.map((item) => (
                    <div key={item.id} className="grid gap-2 rounded-2xl border border-white/10 bg-white/[0.025] p-2 lg:grid-cols-[140px_1fr_150px_110px_80px_36px] lg:items-center">
                      <select className={inputClass} value={item.kind} onChange={(event) => updateItem(item.id, { kind: event.target.value as PayrollItemKind })}>
                        <option value="deduction">Desconto</option><option value="benefit">Benefício</option><option value="earning">Provento</option>
                      </select>
                      <input className={inputClass} value={item.description} onChange={(event) => updateItem(item.id, { description: event.target.value })} placeholder="Nome da rubrica" />
                      <input className={inputClass} type="number" min="0" step="0.01" value={item.amount} onChange={(event) => updateItem(item.id, { amount: numberValue(event.target.value) })} />
                      <div className={`${inputClass} flex items-center justify-between`}><strong>{item.percentage.toFixed(2)}%</strong>{item.reference && <span className="text-[8px] text-white/25">ref. {item.reference}</span>}</div>
                      <span className={`rounded-full px-2 py-1 text-center text-[8px] font-bold ${item.source === 'pdf' ? 'bg-blue-500/10 text-blue-300' : 'bg-white/5 text-white/35'}`}>{item.source === 'pdf' ? 'PDF' : 'Manual'}</span>
                      <button type="button" onClick={() => removeItem(item.id)} className="flex h-9 w-9 items-center justify-center rounded-xl text-red-400 hover:bg-red-500/10"><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                <MiniMetric label="Proventos identificados" value={money(earningItems.reduce((sum, item) => sum + item.amount, 0))} />
                <MiniMetric label="INSS" value={money(actualInss)} detail={percentage(actualInss, gross)} />
                <MiniMetric label="IRRF" value={money(actualIrrf)} detail={percentage(actualIrrf, gross)} />
                <MiniMetric label="Outros descontos" value={money(Math.max(0, otherDeductions))} detail={percentage(Math.max(0, otherDeductions), gross)} />
                <MiniMetric label="Benefícios" value={money(benefits)} detail={percentage(benefits, gross)} highlight />
              </div>
            </section>

            <section className="glass-card !p-4 xl:col-span-12">
              <div className="mb-4 flex items-center justify-between"><div><h3 className="flex items-center gap-2 text-sm font-bold"><CalendarDays size={16} /> Distribuição do recebimento</h3><p className="mt-1 text-[10px] text-white/35">Defina como o salário líquido chega durante o mês.</p></div><Sparkles size={17} className="text-brand-primary" /></div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <Field label="Frequência"><select className={inputClass} value={form.paydayCycle} onChange={(event) => changeCycle(event.target.value as 'monthly' | 'biweekly')}><option value="monthly">Mensal</option><option value="biweekly">Quinzenal</option></select></Field>
                <Field label="Primeiro pagamento"><input className={inputClass} type="number" min="1" max="31" value={form.payday1} onChange={(event) => change('payday1', event.target.value)} /></Field>
                {form.paydayCycle === 'biweekly' && <><Field label="Percentual do primeiro"><input className={inputClass} type="number" min="0" max="100" step="0.01" value={form.payday1Percentage} onChange={(event) => changeFirstPercentage(event.target.value)} /></Field><Field label="Segundo pagamento"><input className={inputClass} type="number" min="1" max="31" value={form.payday2} onChange={(event) => change('payday2', event.target.value)} /></Field><Field label="Percentual do segundo"><input className={inputClass} type="number" min="0" max="100" step="0.01" value={form.payday2Percentage} onChange={(event) => changeSecondPercentage(event.target.value)} /></Field></>}
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2"><CycleCard day={form.payday1} percentage={firstPercentage} amount={firstPayment} primary />{form.paydayCycle === 'biweekly' ? <CycleCard day={form.payday2} percentage={secondPercentage} amount={secondPayment} /> : <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><div className="text-[9px] uppercase text-white/30">Pagamento único</div><div className="mt-2 text-xl font-black">{money(netSalary)}</div><p className="mt-1 text-[10px] text-white/35">100% do líquido no dia {form.payday1}.</p></div>}</div>
            </section>

            <section className="glass-card !p-4 xl:col-span-12">
              <div className="mb-3 flex items-center justify-between"><div><h3 className="flex items-center gap-2 text-sm font-bold"><FileText size={16} /> Histórico da folha</h3><p className="mt-1 text-[10px] text-white/35">Clique em uma competência para consultar ou editar.</p></div>{loading && <span className="text-[10px] text-white/30">Atualizando...</span>}</div>
              {rows.length === 0 ? <div className="rounded-xl border border-dashed border-white/10 py-8 text-center text-xs text-white/30">Nenhuma folha registrada.</div> : <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">{rows.slice(0, 12).map((row) => <button key={row.id} type="button" onClick={() => selectCompetence(row.competence.slice(0, 7))} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-left transition hover:border-brand-primary/30"><div className="flex items-center justify-between gap-2"><span className="text-xs font-bold capitalize">{format(competenceDate(row.competence.slice(0, 7)), 'MMMM yyyy', { locale: ptBR })}</span><span className="text-[9px] text-white/30">{row.source_kind === 'pdf' ? 'PDF' : row.source_kind === 'mixed' ? 'PDF + manual' : 'Manual'}</span></div><div className="mt-3 flex items-end justify-between"><div><div className="text-[9px] uppercase text-white/30">Líquido</div><div className="text-sm font-black text-brand-primary">{money(row.net_salary)}</div></div><div className="text-right text-[9px] text-white/35">Descontos<br />{money(row.inss_amount + row.irrf_amount + row.other_deductions)}</div></div></button>)}</div>}
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

function Metric({ label, value, detail, highlight, danger }: { label: string; value: string; detail?: string; highlight?: boolean; danger?: boolean }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3"><div className="text-[9px] font-bold uppercase text-white/30">{label}</div><div className={`mt-1 truncate text-sm font-black ${highlight ? 'text-brand-primary' : danger ? 'text-red-400' : ''}`}>{value}</div>{detail && <div className="mt-1 truncate text-[9px] text-white/30">{detail}</div>}</div>;
}

function MiniMetric({ label, value, detail, highlight }: { label: string; value: string; detail?: string; highlight?: boolean }) {
  return <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-[8px] font-bold uppercase text-white/30">{label}</div><div className={`mt-1 truncate text-xs font-black ${highlight ? 'text-brand-primary' : ''}`}>{value}</div>{detail && <div className="mt-1 text-[8px] text-white/30">{detail}</div>}</div>;
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <label className={wide ? 'block md:col-span-2' : 'block'}><span className="mb-1.5 block text-[9px] font-bold uppercase text-white/35">{label}</span>{children}</label>;
}

function ReadOnly({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return <div><span className="mb-1.5 block text-[9px] font-bold uppercase text-white/35">{label}</span><div className={`${inputClass} flex items-center font-bold ${danger ? 'text-amber-300' : ''}`}>{value}</div></div>;
}

function CycleCard({ day, percentage: value, amount, primary }: { day: string; percentage: number; amount: number; primary?: boolean }) {
  return <div className={`rounded-2xl border p-4 ${primary ? 'border-brand-primary/25 bg-brand-primary/5' : 'border-white/10 bg-white/[0.03]'}`}><div className="flex items-center justify-between"><span className="text-[9px] font-bold uppercase text-white/30">Pagamento dia {day}</span><span className="rounded-full bg-white/5 px-2 py-1 text-[9px] text-white/45">{value.toFixed(1)}%</span></div><div className={`mt-3 text-xl font-black ${primary ? 'text-brand-primary' : ''}`}>{money(amount)}</div></div>;
}

function mountIncomePayrollCenter() {
  if (document.getElementById('mf-preferences-center-root')) return;
  const host = document.createElement('div');
  host.id = 'mf-preferences-center-root';
  document.body.appendChild(host);
  createRoot(host).render(<IncomePayrollCenter />);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountIncomePayrollCenter, { once: true });
else mountIncomePayrollCenter();

export {};
