import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  FileText,
  Percent,
  ReceiptText,
  Save,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { calculatePayrollFromGross } from './payroll-tax';
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
};

type FormState = {
  competence: string;
  grossSalary: string;
  inssAmount: string;
  irrfAmount: string;
  otherDeductions: string;
  benefits: string;
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

const numberValue = (value: string) => {
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

function defaultForm(): FormState {
  return {
    competence: monthKey(),
    grossSalary: '0',
    inssAmount: '0',
    irrfAmount: '0',
    otherDeductions: '0',
    benefits: '0',
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

function IncomePayrollCenter() {
  const [visible, setVisible] = useState(false);
  const [top, setTop] = useState(72);
  const [userId, setUserId] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingsRow | null>(null);
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [form, setForm] = useState<FormState>(defaultForm);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (mounted) setUserId(data.user?.id || null);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id || null);
    });
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
      setVisible(activeLabel.includes('renda e folha') || activeLabel.includes('preferências'));

      const header = document.querySelector<HTMLElement>('.mf-topbar');
      setTop(Math.ceil(header?.getBoundingClientRect().bottom || 64) + 8);

      const payrollButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => button.textContent?.trim().toLowerCase() === 'folha de pagamento',
      );
      if (payrollButton) payrollButton.style.display = activeLabel.includes('renda e folha') ? 'none' : '';
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

  function hydrate(competence: string, nextSettings: SettingsRow | null, sourceRows: PayrollRow[]) {
    const existing = sourceRows.find((row) => row.competence.slice(0, 7) === competence);
    if (existing) {
      setForm({
        competence,
        grossSalary: String(existing.gross_salary),
        inssAmount: String(existing.inss_amount),
        irrfAmount: String(existing.irrf_amount),
        otherDeductions: String(existing.other_deductions),
        benefits: String(existing.benefits),
        paydayCycle: existing.payday_cycle,
        payday1: String(existing.payday_1),
        payday2: String(existing.payday_2 || 20),
        payday1Percentage: String(existing.payday_1_percentage),
        payday2Percentage: String(existing.payday_2_percentage),
        notes: existing.notes || '',
      });
      setDirty(false);
      return;
    }

    const gross = Number(nextSettings?.gross_salary || 0);
    const estimate = calculatePayrollFromGross(gross, competenceDate(competence));
    const inferredOther = Math.max(0, Number(nextSettings?.deductions || 0) - estimate.inss - estimate.irrf);
    const cycle = nextSettings?.payday_cycle || 'monthly';

    setForm({
      competence,
      grossSalary: String(gross),
      inssAmount: String(estimate.inss),
      irrfAmount: String(estimate.irrf),
      otherDeductions: String(Number(inferredOther.toFixed(2))),
      benefits: String(Number(nextSettings?.benefits || 0)),
      paydayCycle: cycle,
      payday1: String(nextSettings?.payday_1 || 5),
      payday2: String(nextSettings?.payday_2 || 20),
      payday1Percentage: String(cycle === 'biweekly' ? Number(nextSettings?.payday_1_percentage ?? 50) : 100),
      payday2Percentage: String(cycle === 'biweekly' ? Number(nextSettings?.payday_2_percentage ?? 50) : 0),
      notes: '',
    });
    setDirty(false);
  }

  async function loadData(targetCompetence = monthKey()) {
    if (!userId) return;
    setLoading(true);
    setError(null);

    const [settingsResult, rowsResult] = await Promise.all([
      supabase.from('mf_user_settings').select('*').eq('user_id', userId).maybeSingle(),
      supabase
        .from('mf_payroll_statements')
        .select('*')
        .eq('user_id', userId)
        .order('competence', { ascending: false })
        .limit(18),
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
    // Carrega somente ao entrar na área ou trocar a sessão; edição local não dispara recarga.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, userId]);

  const gross = numberValue(form.grossSalary);
  const expected = useMemo(
    () => calculatePayrollFromGross(gross, competenceDate(form.competence)),
    [gross, form.competence],
  );
  const actualInss = numberValue(form.inssAmount);
  const actualIrrf = numberValue(form.irrfAmount);
  const otherDeductions = numberValue(form.otherDeductions);
  const benefits = numberValue(form.benefits);
  const totalDeductions = actualInss + actualIrrf + otherDeductions;
  const netSalary = Math.max(0, gross - totalDeductions);
  const discountRate = gross > 0 ? totalDeductions / gross : 0;
  const firstPercentage = form.paydayCycle === 'biweekly' ? Math.min(100, numberValue(form.payday1Percentage)) : 100;
  const secondPercentage = form.paydayCycle === 'biweekly' ? Math.min(100, numberValue(form.payday2Percentage)) : 0;
  const firstPayment = netSalary * firstPercentage / 100;
  const secondPayment = netSalary * secondPercentage / 100;

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

  function useOfficialEstimate() {
    setForm((current) => ({
      ...current,
      inssAmount: String(expected.inss),
      irrfAmount: String(expected.irrf),
    }));
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
    setForm((current) => ({
      ...current,
      payday1Percentage: String(first),
      payday2Percentage: String(Number((100 - first).toFixed(2))),
    }));
    setDirty(true);
    setSuccess(null);
  }

  function changeSecondPercentage(value: string) {
    const second = Math.min(100, numberValue(value));
    setForm((current) => ({
      ...current,
      payday2Percentage: String(second),
      payday1Percentage: String(Number((100 - second).toFixed(2))),
    }));
    setDirty(true);
    setSuccess(null);
  }

  async function save() {
    if (!userId) return;
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const payday1 = Number(form.payday1);
      const payday2 = Number(form.payday2);
      if (gross <= 0) throw new Error('Informe um salário bruto maior que zero.');
      if (totalDeductions > gross) throw new Error('Os descontos não podem superar o salário bruto.');
      if (!Number.isInteger(payday1) || payday1 < 1 || payday1 > 31) throw new Error('O primeiro dia deve ficar entre 1 e 31.');
      if (form.paydayCycle === 'biweekly') {
        if (!Number.isInteger(payday2) || payday2 < 1 || payday2 > 31) throw new Error('O segundo dia deve ficar entre 1 e 31.');
        if (Math.abs(firstPercentage + secondPercentage - 100) > 0.01) throw new Error('Os percentuais precisam somar 100%.');
      }

      const { error: saveError } = await supabase.rpc('mf_save_payroll_statement', {
        p_competence: `${form.competence}-01`,
        p_gross_salary: gross,
        p_expected_inss: expected.inss,
        p_inss_amount: actualInss,
        p_expected_irrf: expected.irrf,
        p_irrf_amount: actualIrrf,
        p_other_deductions: otherDeductions,
        p_benefits: benefits,
        p_payday_cycle: form.paydayCycle,
        p_payday_1: payday1,
        p_payday_2: form.paydayCycle === 'biweekly' ? payday2 : null,
        p_payday_1_percentage: form.paydayCycle === 'biweekly' ? firstPercentage : 100,
        p_payday_2_percentage: form.paydayCycle === 'biweekly' ? secondPercentage : 0,
        p_notes: form.notes.trim() || null,
      });

      if (saveError) throw saveError;
      setSuccess('Renda, descontos, distribuição e folha foram salvos. O Dashboard foi atualizado.');
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
    <div
      className="fixed z-[49] overflow-hidden rounded-2xl border border-white/10 bg-[#050505] shadow-2xl"
      style={{ top, left: 12, right: 12, bottom: 12 }}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3 md:px-5">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-black md:text-lg">
              <SlidersHorizontal size={19} className="text-brand-primary" /> Renda e Folha
            </h2>
            <p className="mt-0.5 truncate text-[9px] uppercase tracking-[0.18em] text-white/35">
              Uma única configuração para salário, descontos, benefícios e recebimentos
            </p>
          </div>
          <div className="flex items-center gap-2">
            {dirty && <span className="hidden rounded-full bg-amber-500/10 px-2 py-1 text-[9px] font-bold text-amber-300 sm:inline">Alterações não salvas</span>}
            <button
              type="button"
              onClick={save}
              disabled={saving || loading}
              className="flex items-center gap-2 rounded-xl bg-brand-primary px-4 py-2 text-xs font-black text-black disabled:opacity-50"
            >
              <Save size={14} /> {saving ? 'Salvando...' : 'Salvar tudo'}
            </button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto p-3 md:p-4">
          {(error || success) && (
            <div className={`mb-3 flex items-center justify-between rounded-xl border px-3 py-2 text-xs ${
              error ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-green-500/30 bg-green-500/10 text-green-300'
            }`}>
              <span className="flex items-center gap-2">{error ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}{error || success}</span>
              <button type="button" onClick={() => { setError(null); setSuccess(null); }}>×</button>
            </div>
          )}

          <section className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-5">
            <Metric label="Salário bruto" value={money(gross)} />
            <Metric label="Salário líquido" value={money(netSalary)} highlight />
            <Metric label="Descontos" value={money(totalDeductions)} detail={percentage(totalDeductions, gross)} danger={discountRate > 0.5} />
            <Metric label="Benefícios" value={money(benefits)} />
            <Metric label="Recebimento" value={form.paydayCycle === 'biweekly' ? 'Quinzenal' : 'Mensal'} detail={form.paydayCycle === 'biweekly' ? `Dias ${form.payday1} e ${form.payday2}` : `Dia ${form.payday1}`} />
          </section>

          <div className="grid gap-3 xl:grid-cols-12">
            <section className="glass-card !p-4 xl:col-span-7">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-bold"><ReceiptText size={16} /> Detalhes do holerite</h3>
                  <p className="mt-1 text-[10px] text-white/35">Edite os valores reais da competência selecionada.</p>
                </div>
                <button type="button" onClick={useOfficialEstimate} className="rounded-xl border border-brand-primary/30 bg-brand-primary/10 px-3 py-2 text-[10px] font-bold text-brand-primary">Usar INSS e IRRF estimados</button>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Competência"><input className={inputClass} type="month" value={form.competence} onChange={(event) => selectCompetence(event.target.value)} /></Field>
                <Field label="Salário bruto"><input className={inputClass} type="number" min="0" step="0.01" value={form.grossSalary} onChange={(event) => change('grossSalary', event.target.value)} /></Field>
                <Field label="INSS descontado"><input className={inputClass} type="number" min="0" step="0.01" value={form.inssAmount} onChange={(event) => change('inssAmount', event.target.value)} /></Field>
                <Field label="IRRF descontado"><input className={inputClass} type="number" min="0" step="0.01" value={form.irrfAmount} onChange={(event) => change('irrfAmount', event.target.value)} /></Field>
                <Field label="Outros descontos"><input className={inputClass} type="number" min="0" step="0.01" value={form.otherDeductions} onChange={(event) => change('otherDeductions', event.target.value)} /></Field>
                <Field label="Benefícios"><input className={inputClass} type="number" min="0" step="0.01" value={form.benefits} onChange={(event) => change('benefits', event.target.value)} /></Field>
                <Field label="Observações" wide><textarea className={`${inputClass} min-h-20 resize-none`} value={form.notes} onChange={(event) => change('notes', event.target.value)} placeholder="Plano de saúde, vale-transporte, adiantamento, empréstimo..." /></Field>
              </div>
            </section>

            <aside className="glass-card !p-4 xl:col-span-5">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-bold"><Percent size={16} /> Conferência dos descontos</h3>
              <SummaryRow label="INSS estimado" value={`${money(expected.inss)} · ${percentage(expected.inss, gross)}`} />
              <SummaryRow label="INSS informado" value={`${money(actualInss)} · ${percentage(actualInss, gross)}`} danger={Math.abs(actualInss - expected.inss) > 2} />
              <SummaryRow label="IRRF estimado" value={`${money(expected.irrf)} · ${percentage(expected.irrf, gross)}`} />
              <SummaryRow label="IRRF informado" value={`${money(actualIrrf)} · ${percentage(actualIrrf, gross)}`} danger={Math.abs(actualIrrf - expected.irrf) > 2} />
              <SummaryRow label="Outros descontos" value={`${money(otherDeductions)} · ${percentage(otherDeductions, gross)}`} />
              <SummaryRow label="Desconto total" value={`${money(totalDeductions)} · ${percentage(totalDeductions, gross)}`} danger={discountRate > 0.5} />
              <SummaryRow label="Salário líquido" value={money(netSalary)} highlight />
              <SummaryRow label="Benefícios separados" value={money(benefits)} />
              {(Math.abs(actualInss - expected.inss) > 2 || Math.abs(actualIrrf - expected.irrf) > 2) && (
                <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-[10px] text-amber-200">
                  O valor informado difere do cálculo estimado. O holerite real prevalece; confira férias, dependentes, múltiplos vínculos ou outras rubricas.
                </div>
              )}
            </aside>

            <section className="glass-card !p-4 xl:col-span-12">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-bold"><CalendarDays size={16} /> Distribuição do recebimento</h3>
                  <p className="mt-1 text-[10px] text-white/35">Defina como o salário líquido chega durante o mês.</p>
                </div>
                <Sparkles size={17} className="text-brand-primary" />
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <Field label="Frequência"><select className={inputClass} value={form.paydayCycle} onChange={(event) => changeCycle(event.target.value as 'monthly' | 'biweekly')}><option value="monthly">Mensal</option><option value="biweekly">Quinzenal</option></select></Field>
                <Field label="Primeiro pagamento"><input className={inputClass} type="number" min="1" max="31" value={form.payday1} onChange={(event) => change('payday1', event.target.value)} /></Field>
                {form.paydayCycle === 'biweekly' && (
                  <>
                    <Field label="Percentual do primeiro"><input className={inputClass} type="number" min="0" max="100" step="0.01" value={form.payday1Percentage} onChange={(event) => changeFirstPercentage(event.target.value)} /></Field>
                    <Field label="Segundo pagamento"><input className={inputClass} type="number" min="1" max="31" value={form.payday2} onChange={(event) => change('payday2', event.target.value)} /></Field>
                    <Field label="Percentual do segundo"><input className={inputClass} type="number" min="0" max="100" step="0.01" value={form.payday2Percentage} onChange={(event) => changeSecondPercentage(event.target.value)} /></Field>
                  </>
                )}
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-2">
                <CycleCard day={form.payday1} percentage={firstPercentage} amount={firstPayment} primary />
                {form.paydayCycle === 'biweekly' ? (
                  <CycleCard day={form.payday2} percentage={secondPercentage} amount={secondPayment} />
                ) : (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="text-[9px] uppercase text-white/30">Pagamento único</div>
                    <div className="mt-2 text-xl font-black">{money(netSalary)}</div>
                    <p className="mt-1 text-[10px] text-white/35">100% do líquido no dia {form.payday1}.</p>
                  </div>
                )}
              </div>
            </section>

            <section className="glass-card !p-4 xl:col-span-12">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-bold"><FileText size={16} /> Histórico da folha</h3>
                  <p className="mt-1 text-[10px] text-white/35">Clique em uma competência para consultar ou editar.</p>
                </div>
                {loading && <span className="text-[10px] text-white/30">Atualizando...</span>}
              </div>

              {rows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 py-8 text-center text-xs text-white/30">Nenhuma folha registrada.</div>
              ) : (
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  {rows.slice(0, 12).map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => selectCompetence(row.competence.slice(0, 7))}
                      className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-left transition hover:border-brand-primary/30"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold capitalize">{format(competenceDate(row.competence.slice(0, 7)), 'MMMM yyyy', { locale: ptBR })}</span>
                        <span className="text-[9px] text-white/30">{row.payday_cycle === 'biweekly' ? 'Quinzenal' : 'Mensal'}</span>
                      </div>
                      <div className="mt-3 flex items-end justify-between">
                        <div>
                          <div className="text-[9px] uppercase text-white/30">Líquido</div>
                          <div className="text-sm font-black text-brand-primary">{money(row.net_salary)}</div>
                        </div>
                        <div className="text-right text-[9px] text-white/35">Descontos<br />{money(row.inss_amount + row.irrf_amount + row.other_deductions)}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

function Metric({ label, value, detail, highlight, danger }: { label: string; value: string; detail?: string; highlight?: boolean; danger?: boolean }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3"><div className="text-[9px] font-bold uppercase text-white/30">{label}</div><div className={`mt-1 truncate text-sm font-black ${highlight ? 'text-brand-primary' : danger ? 'text-red-400' : ''}`}>{value}</div>{detail && <div className="mt-1 text-[9px] text-white/30">{detail}</div>}</div>;
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <label className={wide ? 'block md:col-span-2' : 'block'}><span className="mb-1.5 block text-[9px] font-bold uppercase text-white/35">{label}</span>{children}</label>;
}

function SummaryRow({ label, value, highlight, danger }: { label: string; value: string; highlight?: boolean; danger?: boolean }) {
  return <div className="flex items-center justify-between gap-3 border-b border-white/5 py-2.5 text-xs"><span className="text-white/40">{label}</span><strong className={`text-right ${highlight ? 'text-brand-primary' : danger ? 'text-red-400' : ''}`}>{value}</strong></div>;
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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountIncomePayrollCenter, { once: true });
} else {
  mountIncomePayrollCenter();
}

export {};
