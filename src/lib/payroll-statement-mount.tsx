import React, { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlertTriangle,
  BadgeDollarSign,
  CalendarDays,
  CheckCircle2,
  FileText,
  History,
  Percent,
  Save,
  Scale,
  X,
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

const percent = (part: number, total: number) =>
  total > 0 ? `${((part / total) * 100).toFixed(2)}%` : '0,00%';

const numberValue = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

const monthKey = () => format(new Date(), 'yyyy-MM');

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

const inputClass =
  'w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none transition focus:border-brand-primary/60';

function PayrollStatementCenter() {
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [buttonTop, setButtonTop] = useState(72);
  const [userId, setUserId] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingsRow | null>(null);
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [form, setForm] = useState<FormState>(defaultForm);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
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
      const activeButton = Array.from(document.querySelectorAll<HTMLButtonElement>('.mf-nav button')).find((button) =>
        button.classList.contains('active'),
      );
      setAvailable(Boolean(activeButton?.textContent?.toLowerCase().includes('preferências')));
      const header = document.querySelector<HTMLElement>('.mf-topbar');
      setButtonTop(Math.ceil(header?.getBoundingClientRect().bottom || 64) + 10);
    };

    detect();
    const observer = new MutationObserver(detect);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    const interval = window.setInterval(detect, 700);
    window.addEventListener('resize', detect);

    return () => {
      observer.disconnect();
      window.clearInterval(interval);
      window.removeEventListener('resize', detect);
    };
  }, []);

  const loadData = useCallback(async () => {
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
        .limit(24),
    ]);

    if (settingsResult.error) setError(settingsResult.error.message);
    if (rowsResult.error) setError(rowsResult.error.message);

    const nextSettings = settingsResult.data
      ? ({
          ...settingsResult.data,
          gross_salary: Number(settingsResult.data.gross_salary || 0),
          net_salary_estimated: Number(settingsResult.data.net_salary_estimated || 0),
          deductions: Number(settingsResult.data.deductions || 0),
          benefits: Number(settingsResult.data.benefits || 0),
          payday_1: Number(settingsResult.data.payday_1 || 5),
          payday_2: Number(settingsResult.data.payday_2 || 20),
          payday_1_percentage: Number(settingsResult.data.payday_1_percentage ?? 50),
          payday_2_percentage: Number(settingsResult.data.payday_2_percentage ?? 50),
        } as SettingsRow)
      : null;

    const nextRows = (rowsResult.data || []).map((row: any) => ({
      ...row,
      gross_salary: Number(row.gross_salary || 0),
      expected_inss: Number(row.expected_inss || 0),
      inss_amount: Number(row.inss_amount || 0),
      expected_irrf: Number(row.expected_irrf || 0),
      irrf_amount: Number(row.irrf_amount || 0),
      other_deductions: Number(row.other_deductions || 0),
      benefits: Number(row.benefits || 0),
      net_salary: Number(row.net_salary || 0),
      payday_1: Number(row.payday_1 || 5),
      payday_2: Number(row.payday_2 || 20),
      payday_1_percentage: Number(row.payday_1_percentage ?? 50),
      payday_2_percentage: Number(row.payday_2_percentage ?? 50),
    })) as PayrollRow[];

    setSettings(nextSettings);
    setRows(nextRows);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    void loadData();

    const channel = supabase
      .channel(`payroll-center-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_payroll_statements', filter: `user_id=eq.${userId}` }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_user_settings', filter: `user_id=eq.${userId}` }, loadData)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, loadData]);

  const expected = useMemo(
    () => calculatePayrollFromGross(numberValue(form.grossSalary), competenceDate(form.competence)),
    [form.grossSalary, form.competence],
  );

  const gross = numberValue(form.grossSalary);
  const actualInss = numberValue(form.inssAmount);
  const actualIrrf = numberValue(form.irrfAmount);
  const otherDeductions = numberValue(form.otherDeductions);
  const benefits = numberValue(form.benefits);
  const totalDeductions = actualInss + actualIrrf + otherDeductions;
  const netSalary = Math.max(0, gross - totalDeductions);
  const inssDifference = actualInss - expected.inss;
  const irrfDifference = actualIrrf - expected.irrf;
  const firstPercentage = form.paydayCycle === 'biweekly' ? numberValue(form.payday1Percentage) : 100;
  const secondPercentage = form.paydayCycle === 'biweekly' ? numberValue(form.payday2Percentage) : 0;
  const firstPayment = netSalary * firstPercentage / 100;
  const secondPayment = netSalary * secondPercentage / 100;

  function hydrateForCompetence(key: string, sourceRows = rows, sourceSettings = settings) {
    const existing = sourceRows.find((row) => row.competence.slice(0, 7) === key);
    if (existing) {
      setForm({
        competence: key,
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
      return;
    }

    const grossSalary = Number(sourceSettings?.gross_salary || 0);
    const estimate = calculatePayrollFromGross(grossSalary, competenceDate(key));
    const storedDeductions = Number(sourceSettings?.deductions || 0);
    const inferredOther = Math.max(0, storedDeductions - estimate.inss - estimate.irrf);
    const cycle = sourceSettings?.payday_cycle || 'monthly';

    setForm({
      competence: key,
      grossSalary: String(grossSalary),
      inssAmount: String(estimate.inss),
      irrfAmount: String(estimate.irrf),
      otherDeductions: String(Number(inferredOther.toFixed(2))),
      benefits: String(Number(sourceSettings?.benefits || 0)),
      paydayCycle: cycle,
      payday1: String(sourceSettings?.payday_1 || 5),
      payday2: String(sourceSettings?.payday_2 || 20),
      payday1Percentage: String(cycle === 'biweekly' ? Number(sourceSettings?.payday_1_percentage ?? 50) : 100),
      payday2Percentage: String(cycle === 'biweekly' ? Number(sourceSettings?.payday_2_percentage ?? 50) : 0),
      notes: '',
    });
  }

  useEffect(() => {
    if (!settings) return;
    hydrateForCompetence(form.competence || monthKey(), rows, settings);
    // Only hydrate after fresh data arrives. Competence changes are handled by the input below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.user_id, rows.length]);

  function useOfficialEstimate() {
    setForm((current) => ({
      ...current,
      inssAmount: String(expected.inss),
      irrfAmount: String(expected.irrf),
    }));
  }

  function setFirstPercentage(value: string) {
    const first = Math.min(100, numberValue(value));
    setForm((current) => ({
      ...current,
      payday1Percentage: String(first),
      payday2Percentage: String(Number((100 - first).toFixed(2))),
    }));
  }

  function setSecondPercentage(value: string) {
    const second = Math.min(100, numberValue(value));
    setForm((current) => ({
      ...current,
      payday2Percentage: String(second),
      payday1Percentage: String(Number((100 - second).toFixed(2))),
    }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!userId) return;
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const payday1 = Number(form.payday1);
      const payday2 = Number(form.payday2);
      if (!Number.isFinite(gross) || gross <= 0) throw new Error('Informe um salário bruto maior que zero.');
      if (totalDeductions > gross) throw new Error('Os descontos não podem superar o salário bruto.');
      if (!Number.isInteger(payday1) || payday1 < 1 || payday1 > 31) throw new Error('O primeiro dia deve ficar entre 1 e 31.');
      if (form.paydayCycle === 'biweekly') {
        if (!Number.isInteger(payday2) || payday2 < 1 || payday2 > 31) throw new Error('O segundo dia deve ficar entre 1 e 31.');
        if (Math.abs(firstPercentage + secondPercentage - 100) > 0.01) throw new Error('As porcentagens do ciclo precisam somar 100%.');
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
      setSuccess('Folha salva. A renda líquida e o ciclo foram atualizados no Dashboard.');
      await loadData();
    } catch (saveError: any) {
      setError(saveError?.message || 'Não foi possível salvar a folha de pagamento.');
    } finally {
      setSaving(false);
    }
  }

  if (!available || !userId) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setError(null);
          setSuccess(null);
          void loadData();
        }}
        className="fixed right-4 z-[48] flex items-center gap-2 rounded-xl border border-brand-primary/30 bg-[#071313] px-3 py-2 text-xs font-bold text-brand-primary shadow-xl hover:bg-brand-primary/10"
        style={{ top: buttonTop }}
      >
        <FileText size={15} /> Folha de pagamento
      </button>

      {open && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-3 backdrop-blur-md">
          <div className="flex h-[min(94vh,860px)] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#070707] shadow-2xl">
            <header className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-black"><BadgeDollarSign size={20} className="text-brand-primary" /> Folha de pagamento</h2>
                <p className="mt-1 text-[10px] uppercase tracking-widest text-white/35">Descontos reais, percentuais e renda líquida do ciclo</p>
              </div>
              <button onClick={() => setOpen(false)} className="rounded-xl bg-white/5 p-2 text-white/50 hover:text-white"><X size={18} /></button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
              {(error || success) && (
                <div className={`mb-4 flex items-center justify-between rounded-xl border px-3 py-2 text-xs ${error ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-green-500/30 bg-green-500/10 text-green-300'}`}>
                  <span className="flex items-center gap-2">{error ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}{error || success}</span>
                  <button onClick={() => { setError(null); setSuccess(null); }}><X size={14} /></button>
                </div>
              )}

              <div className="grid gap-4 xl:grid-cols-12">
                <form onSubmit={save} className="glass-card !p-4 xl:col-span-7">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div><h3 className="text-sm font-bold">Registrar competência</h3><p className="text-[10px] text-white/35">Use os valores que aparecem no holerite.</p></div>
                    <button type="button" onClick={useOfficialEstimate} className="rounded-xl border border-brand-primary/30 bg-brand-primary/10 px-3 py-2 text-[10px] font-bold text-brand-primary">Usar INSS/IRRF estimados</button>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label="Competência"><input className={inputClass} type="month" value={form.competence} onChange={(event) => hydrateForCompetence(event.target.value)} /></Field>
                    <Field label="Salário bruto"><input className={inputClass} type="number" min="0" step="0.01" value={form.grossSalary} onChange={(event) => setForm({ ...form, grossSalary: event.target.value })} /></Field>
                    <Field label="INSS descontado"><input className={inputClass} type="number" min="0" step="0.01" value={form.inssAmount} onChange={(event) => setForm({ ...form, inssAmount: event.target.value })} /></Field>
                    <Field label="IRRF descontado"><input className={inputClass} type="number" min="0" step="0.01" value={form.irrfAmount} onChange={(event) => setForm({ ...form, irrfAmount: event.target.value })} /></Field>
                    <Field label="Outros descontos"><input className={inputClass} type="number" min="0" step="0.01" value={form.otherDeductions} onChange={(event) => setForm({ ...form, otherDeductions: event.target.value })} /></Field>
                    <Field label="Benefícios separados"><input className={inputClass} type="number" min="0" step="0.01" value={form.benefits} onChange={(event) => setForm({ ...form, benefits: event.target.value })} /></Field>
                    <Field label="Ciclo de recebimento"><select className={inputClass} value={form.paydayCycle} onChange={(event) => setForm({ ...form, paydayCycle: event.target.value as 'monthly' | 'biweekly', payday1Percentage: event.target.value === 'monthly' ? '100' : '50', payday2Percentage: event.target.value === 'monthly' ? '0' : '50' })}><option value="monthly">Mensal</option><option value="biweekly">Quinzenal</option></select></Field>
                    <Field label="Primeiro pagamento"><input className={inputClass} type="number" min="1" max="31" value={form.payday1} onChange={(event) => setForm({ ...form, payday1: event.target.value })} /></Field>
                    {form.paydayCycle === 'biweekly' && (
                      <>
                        <Field label="Percentual do 1º pagamento"><input className={inputClass} type="number" min="0" max="100" step="0.01" value={form.payday1Percentage} onChange={(event) => setFirstPercentage(event.target.value)} /></Field>
                        <Field label="Segundo pagamento"><input className={inputClass} type="number" min="1" max="31" value={form.payday2} onChange={(event) => setForm({ ...form, payday2: event.target.value })} /></Field>
                        <Field label="Percentual do 2º pagamento"><input className={inputClass} type="number" min="0" max="100" step="0.01" value={form.payday2Percentage} onChange={(event) => setSecondPercentage(event.target.value)} /></Field>
                      </>
                    )}
                    <Field label="Observações" wide><textarea className={`${inputClass} min-h-20 resize-none`} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Ex.: vale-transporte, plano de saúde, adiantamento..." /></Field>
                  </div>

                  <button disabled={saving} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-primary py-3 text-sm font-black text-black disabled:opacity-50"><Save size={16} /> {saving ? 'Salvando...' : 'Salvar folha e atualizar ciclo'}</button>
                </form>

                <aside className="space-y-4 xl:col-span-5">
                  <section className="glass-card !p-4">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-bold"><Scale size={16} /> Conferência dos descontos</h3>
                    <div className="grid grid-cols-2 gap-2">
                      <Metric label="INSS estimado" value={money(expected.inss)} detail={percent(expected.inss, gross)} />
                      <Metric label="INSS informado" value={money(actualInss)} detail={percent(actualInss, gross)} danger={Math.abs(inssDifference) > 2} />
                      <Metric label="IRRF estimado" value={money(expected.irrf)} detail={percent(expected.irrf, gross)} />
                      <Metric label="IRRF informado" value={money(actualIrrf)} detail={percent(actualIrrf, gross)} danger={Math.abs(irrfDifference) > 2} />
                      <Metric label="Outros descontos" value={money(otherDeductions)} detail={percent(otherDeductions, gross)} />
                      <Metric label="Desconto total" value={money(totalDeductions)} detail={percent(totalDeductions, gross)} danger={totalDeductions > gross * 0.5} />
                    </div>
                    {(Math.abs(inssDifference) > 2 || Math.abs(irrfDifference) > 2) && <p className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-[10px] text-amber-200">Existe diferença entre o cálculo estimado e o valor informado. Isso pode acontecer por competência anterior, múltiplos vínculos, dependentes, pensão, férias ou rubricas específicas. Confira o holerite antes de salvar.</p>}
                    <p className="mt-3 text-[9px] leading-relaxed text-white/30">{expected.tableReferenceLabel}. {expected.irrfRuleLabel} O cálculo é uma conferência; o valor real do holerite prevalece.</p>
                  </section>

                  <section className="glass-card !p-4">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-bold"><Percent size={16} /> Renda depois dos descontos</h3>
                    <SummaryRow label="Salário bruto" value={money(gross)} />
                    <SummaryRow label="Total descontado" value={`- ${money(totalDeductions)}`} danger />
                    <SummaryRow label="Salário líquido" value={money(netSalary)} highlight />
                    <SummaryRow label="Benefícios separados" value={money(benefits)} />
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Metric label={`Dia ${form.payday1}`} value={money(firstPayment)} detail={`${firstPercentage.toFixed(2)}% do líquido`} />
                      {form.paydayCycle === 'biweekly' ? <Metric label={`Dia ${form.payday2}`} value={money(secondPayment)} detail={`${secondPercentage.toFixed(2)}% do líquido`} /> : <Metric label="Ciclo" value="Mensal" detail="100% no primeiro dia" />}
                    </div>
                    <p className="mt-3 text-[10px] text-white/35">O Dashboard passa a projetar o ciclo usando o salário líquido. Benefícios ficam separados e não são tratados como dinheiro disponível em conta.</p>
                  </section>
                </aside>
              </div>

              <section className="mt-4 glass-card !p-4">
                <div className="mb-3 flex items-center justify-between"><div><h3 className="flex items-center gap-2 text-sm font-bold"><History size={16} /> Histórico da folha</h3><p className="text-[9px] uppercase text-white/30">Últimas competências registradas</p></div>{loading && <span className="text-[10px] text-white/30">Atualizando...</span>}</div>
                {rows.length === 0 ? <div className="rounded-xl border border-dashed border-white/10 py-8 text-center text-xs text-white/30">Nenhuma folha registrada.</div> : (
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {rows.slice(0, 9).map((row) => (
                      <button key={row.id} type="button" onClick={() => hydrateForCompetence(row.competence.slice(0, 7))} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-left hover:border-brand-primary/30">
                        <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-xs font-bold"><CalendarDays size={13} /> {format(competenceDate(row.competence.slice(0, 7)), 'MMMM yyyy', { locale: ptBR })}</span><span className="text-[9px] text-white/30">{percent(row.inss_amount + row.irrf_amount + row.other_deductions, row.gross_salary)}</span></div>
                        <div className="mt-2 flex items-end justify-between"><div><div className="text-[9px] uppercase text-white/30">Líquido</div><div className="text-sm font-black text-brand-primary">{money(row.net_salary)}</div></div><div className="text-right text-[9px] text-white/40">Bruto {money(row.gross_salary)}<br />INSS {money(row.inss_amount)}</div></div>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={wide ? 'md:col-span-2' : ''}><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-white/35">{label}</span>{children}</label>;
}

function Metric({ label, value, detail, danger }: { label: string; value: string; detail: string; danger?: boolean }) {
  return <div className={`rounded-xl border p-3 ${danger ? 'border-red-500/30 bg-red-500/5' : 'border-white/10 bg-white/[0.03]'}`}><div className="text-[9px] uppercase text-white/30">{label}</div><div className={`mt-1 text-sm font-black ${danger ? 'text-red-300' : ''}`}>{value}</div><div className="mt-1 text-[9px] text-white/35">{detail}</div></div>;
}

function SummaryRow({ label, value, highlight, danger }: { label: string; value: string; highlight?: boolean; danger?: boolean }) {
  return <div className="flex items-center justify-between border-b border-white/5 py-2 text-xs"><span className="text-white/45">{label}</span><strong className={highlight ? 'text-brand-primary' : danger ? 'text-red-300' : ''}>{value}</strong></div>;
}

function mountPayrollCenter() {
  if (document.getElementById('mf-payroll-statement-root')) return;
  const root = document.createElement('div');
  root.id = 'mf-payroll-statement-root';
  document.body.appendChild(root);
  createRoot(root).render(<PayrollStatementCenter />);
}

if (typeof document !== 'undefined') {
  if (document.body) mountPayrollCenter();
  else window.addEventListener('DOMContentLoaded', mountPayrollCenter, { once: true });
}

export {};
