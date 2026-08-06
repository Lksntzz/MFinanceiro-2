import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlertTriangle,
  BadgeDollarSign,
  CalendarDays,
  CheckCircle2,
  FileText,
  LayoutDashboard,
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

type Tab = 'overview' | 'deductions' | 'distribution' | 'payroll';

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
  inss_amount: number;
  irrf_amount: number;
  other_deductions: number;
  benefits: number;
  net_salary: number;
  payday_cycle: 'monthly' | 'biweekly';
  payday_1: number;
  payday_2?: number | null;
  payday_1_percentage: number;
  payday_2_percentage: number;
};

type DeductionsForm = {
  otherDeductions: string;
  benefits: string;
};

type DistributionForm = {
  paydayCycle: 'monthly' | 'biweekly';
  payday1: string;
  payday2: string;
  payday1Percentage: string;
  payday2Percentage: string;
};

const money = (value: number) =>
  Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const percent = (part: number, total: number) =>
  total > 0 ? `${((part / total) * 100).toFixed(1)}%` : '0,0%';

const numberValue = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

const inputClass =
  'w-full rounded-xl border border-white/10 bg-black/35 px-3 py-2.5 text-sm text-white outline-none transition focus:border-brand-primary/60';

function findPayrollTrigger(): HTMLButtonElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) => {
      if (button.dataset.mfPreferencesAction === 'true') return false;
      return button.textContent?.trim().toLowerCase() === 'folha de pagamento';
    }) || null
  );
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
    inss_amount: Number(row.inss_amount || 0),
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

function PreferencesCenter() {
  const [visible, setVisible] = useState(false);
  const [top, setTop] = useState(72);
  const [userId, setUserId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [settings, setSettings] = useState<SettingsRow | null>(null);
  const [payrollRows, setPayrollRows] = useState<PayrollRow[]>([]);
  const [deductionsForm, setDeductionsForm] = useState<DeductionsForm>({
    otherDeductions: '0',
    benefits: '0',
  });
  const [distributionForm, setDistributionForm] = useState<DistributionForm>({
    paydayCycle: 'monthly',
    payday1: '5',
    payday2: '20',
    payday1Percentage: '100',
    payday2Percentage: '0',
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deductionsDirty, setDeductionsDirty] = useState(false);
  const [distributionDirty, setDistributionDirty] = useState(false);
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
      setVisible(Boolean(activeButton?.textContent?.toLowerCase().includes('preferências')));
      const header = document.querySelector<HTMLElement>('.mf-topbar');
      setTop(Math.ceil(header?.getBoundingClientRect().bottom || 64) + 8);
    };

    detect();
    const observer = new MutationObserver(detect);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    const interval = window.setInterval(detect, 500);
    window.addEventListener('resize', detect);

    return () => {
      observer.disconnect();
      window.clearInterval(interval);
      window.removeEventListener('resize', detect);
    };
  }, []);

  useEffect(() => {
    const syncTrigger = () => {
      const trigger = findPayrollTrigger();
      if (!trigger) return;
      if (visible) {
        if (trigger.dataset.mfPreferencesHidden !== 'true') {
          trigger.dataset.mfPreferencesOriginalDisplay = trigger.style.display || '';
          trigger.dataset.mfPreferencesHidden = 'true';
        }
        trigger.style.display = 'none';
      } else if (trigger.dataset.mfPreferencesHidden === 'true') {
        trigger.style.display = trigger.dataset.mfPreferencesOriginalDisplay || '';
        delete trigger.dataset.mfPreferencesHidden;
        delete trigger.dataset.mfPreferencesOriginalDisplay;
      }
    };

    syncTrigger();
    const interval = window.setInterval(syncTrigger, 250);
    return () => {
      window.clearInterval(interval);
      const trigger = findPayrollTrigger();
      if (trigger?.dataset.mfPreferencesHidden === 'true') {
        trigger.style.display = trigger.dataset.mfPreferencesOriginalDisplay || '';
        delete trigger.dataset.mfPreferencesHidden;
        delete trigger.dataset.mfPreferencesOriginalDisplay;
      }
    };
  }, [visible]);

  const hydrate = useCallback((nextSettings: SettingsRow, latestPayroll?: PayrollRow | null) => {
    const official = calculatePayrollFromGross(nextSettings.gross_salary, new Date());
    const statutoryDeductions = latestPayroll
      ? latestPayroll.inss_amount + latestPayroll.irrf_amount
      : official.totalDeductions;
    const otherDeductions = Math.max(0, nextSettings.deductions - statutoryDeductions);
    const cycle = nextSettings.payday_cycle;

    setDeductionsForm({
      otherDeductions: String(Number(otherDeductions.toFixed(2))),
      benefits: String(nextSettings.benefits),
    });
    setDistributionForm({
      paydayCycle: cycle,
      payday1: String(nextSettings.payday_1 || 5),
      payday2: String(nextSettings.payday_2 || 20),
      payday1Percentage: String(cycle === 'biweekly' ? Number(nextSettings.payday_1_percentage ?? 50) : 100),
      payday2Percentage: String(cycle === 'biweekly' ? Number(nextSettings.payday_2_percentage ?? 50) : 0),
    });
    setDeductionsDirty(false);
    setDistributionDirty(false);
  }, []);

  const loadData = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);

    const [settingsResult, payrollResult] = await Promise.all([
      supabase.from('mf_user_settings').select('*').eq('user_id', userId).maybeSingle(),
      supabase
        .from('mf_payroll_statements')
        .select('*')
        .eq('user_id', userId)
        .order('competence', { ascending: false })
        .limit(6),
    ]);

    if (settingsResult.error) setError(settingsResult.error.message);
    if (payrollResult.error) setError(payrollResult.error.message);

    const nextPayrollRows = (payrollResult.data || []).map(normalizePayroll);
    setPayrollRows(nextPayrollRows);

    if (settingsResult.data) {
      const nextSettings = normalizeSettings(settingsResult.data);
      setSettings(nextSettings);
      hydrate(nextSettings, nextPayrollRows[0] || null);
    }
    setLoading(false);
  }, [userId, hydrate]);

  useEffect(() => {
    if (!userId) return;
    void loadData();

    const channel = supabase
      .channel(`preferences-center-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_user_settings', filter: `user_id=eq.${userId}` }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_payroll_statements', filter: `user_id=eq.${userId}` }, loadData)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, loadData]);

  const latestPayroll = payrollRows[0] || null;
  const gross = Number(settings?.gross_salary || 0);
  const official = useMemo(() => calculatePayrollFromGross(gross, new Date()), [gross]);
  const inssBase = latestPayroll?.inss_amount ?? official.inss;
  const irrfBase = latestPayroll?.irrf_amount ?? official.irrf;
  const otherDeductions = numberValue(deductionsForm.otherDeductions);
  const benefits = numberValue(deductionsForm.benefits);
  const totalDeductions = inssBase + irrfBase + otherDeductions;
  const previewNetSalary = Math.max(0, gross - totalDeductions);
  const savedNetSalary = Number(settings?.net_salary_estimated || 0);
  const cycleNetSalary = savedNetSalary > 0 ? savedNetSalary : previewNetSalary;
  const firstPercentage = distributionForm.paydayCycle === 'biweekly'
    ? Math.min(100, numberValue(distributionForm.payday1Percentage))
    : 100;
  const secondPercentage = distributionForm.paydayCycle === 'biweekly'
    ? Math.min(100, numberValue(distributionForm.payday2Percentage))
    : 0;
  const firstPayment = cycleNetSalary * firstPercentage / 100;
  const secondPayment = cycleNetSalary * secondPercentage / 100;
  const discountRate = gross > 0 ? totalDeductions / gross : 0;

  function changeDeduction<K extends keyof DeductionsForm>(field: K, value: DeductionsForm[K]) {
    setDeductionsForm((current) => ({ ...current, [field]: value }));
    setDeductionsDirty(true);
    setSuccess(null);
  }

  function changeDistribution<K extends keyof DistributionForm>(field: K, value: DistributionForm[K]) {
    setDistributionForm((current) => ({ ...current, [field]: value }));
    setDistributionDirty(true);
    setSuccess(null);
  }

  function changeCycle(value: 'monthly' | 'biweekly') {
    setDistributionForm((current) => ({
      ...current,
      paydayCycle: value,
      payday1Percentage: value === 'monthly' ? '100' : '50',
      payday2Percentage: value === 'monthly' ? '0' : '50',
    }));
    setDistributionDirty(true);
    setSuccess(null);
  }

  function changeFirstPercentage(value: string) {
    const first = Math.min(100, numberValue(value));
    setDistributionForm((current) => ({
      ...current,
      payday1Percentage: String(first),
      payday2Percentage: String(Number((100 - first).toFixed(2))),
    }));
    setDistributionDirty(true);
    setSuccess(null);
  }

  function changeSecondPercentage(value: string) {
    const second = Math.min(100, numberValue(value));
    setDistributionForm((current) => ({
      ...current,
      payday2Percentage: String(second),
      payday1Percentage: String(Number((100 - second).toFixed(2))),
    }));
    setDistributionDirty(true);
    setSuccess(null);
  }

  async function saveDeductions() {
    if (!userId || !settings) return;
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      if (gross <= 0) throw new Error('Registre o salário bruto na Folha de pagamento antes de ajustar os descontos.');
      if (totalDeductions > gross) throw new Error('Os descontos não podem superar o salário bruto.');

      const result = await supabase
        .from('mf_user_settings')
        .update({
          deductions: Number(totalDeductions.toFixed(2)),
          benefits,
          net_salary_estimated: Number(previewNetSalary.toFixed(2)),
        })
        .eq('user_id', userId);

      if (result.error) throw result.error;
      setSuccess('Descontos recorrentes e benefícios atualizados no Dashboard.');
      setDeductionsDirty(false);
      await loadData();
    } catch (saveError: any) {
      setError(saveError?.message || 'Não foi possível salvar os descontos.');
    } finally {
      setSaving(false);
    }
  }

  async function saveDistribution() {
    if (!userId) return;
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const payday1 = Number(distributionForm.payday1);
      const payday2 = Number(distributionForm.payday2);
      if (!Number.isInteger(payday1) || payday1 < 1 || payday1 > 31) {
        throw new Error('O primeiro dia deve ficar entre 1 e 31.');
      }
      if (distributionForm.paydayCycle === 'biweekly') {
        if (!Number.isInteger(payday2) || payday2 < 1 || payday2 > 31) {
          throw new Error('O segundo dia deve ficar entre 1 e 31.');
        }
        if (Math.abs(firstPercentage + secondPercentage - 100) > 0.01) {
          throw new Error('Os percentuais precisam somar 100%.');
        }
      }

      const result = await supabase
        .from('mf_user_settings')
        .update({
          payday_cycle: distributionForm.paydayCycle,
          payday_1: payday1,
          payday_2: distributionForm.paydayCycle === 'biweekly' ? payday2 : null,
          payday_1_percentage: distributionForm.paydayCycle === 'biweekly' ? firstPercentage : 100,
          payday_2_percentage: distributionForm.paydayCycle === 'biweekly' ? secondPercentage : 0,
        })
        .eq('user_id', userId);

      if (result.error) throw result.error;
      setSuccess('Distribuição do ciclo atualizada no Dashboard.');
      setDistributionDirty(false);
      await loadData();
    } catch (saveError: any) {
      setError(saveError?.message || 'Não foi possível salvar a distribuição.');
    } finally {
      setSaving(false);
    }
  }

  function openPayrollCenter() {
    setError(null);
    let attempts = 0;
    const tryOpen = () => {
      const trigger = findPayrollTrigger();
      if (trigger) {
        trigger.click();
        return;
      }
      attempts += 1;
      if (attempts < 15) window.setTimeout(tryOpen, 100);
      else setError('A central da folha ainda está carregando. Tente novamente em alguns segundos.');
    };
    tryOpen();
  }

  if (!visible || !userId) return null;

  const tabs: Array<{ id: Tab; label: string; icon: React.ComponentType<{ size?: number }> }> = [
    { id: 'overview', label: 'Resumo', icon: LayoutDashboard },
    { id: 'deductions', label: 'Descontos e benefícios', icon: Percent },
    { id: 'distribution', label: 'Distribuição', icon: CalendarDays },
    { id: 'payroll', label: 'Folha', icon: FileText },
  ];

  return (
    <div
      className="fixed z-[49] overflow-hidden rounded-2xl border border-white/10 bg-[#050505] shadow-2xl"
      style={{ top, left: 12, right: 12, bottom: 12 }}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3 md:px-5">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-black md:text-lg">
              <SlidersHorizontal size={19} className="text-brand-primary" /> Preferências
            </h2>
            <p className="mt-0.5 truncate text-[9px] uppercase tracking-[0.18em] text-white/35">
              Cada configuração em um único lugar, sem funções repetidas
            </p>
          </div>
          <div className="flex items-center gap-2 text-[9px] text-white/30">
            {loading ? 'Atualizando...' : 'Sincronizado com o Dashboard'}
          </div>
        </header>

        <nav className="flex shrink-0 gap-2 overflow-x-auto border-b border-white/10 px-4 py-2 md:px-5">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition ${
                activeTab === id ? 'bg-brand-primary text-black' : 'bg-white/5 text-white/45 hover:text-white'
              }`}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </nav>

        <main className="min-h-0 flex-1 overflow-y-auto p-3 md:p-4">
          {(error || success) && (
            <div className={`mb-3 flex items-center justify-between rounded-xl border px-3 py-2 text-xs ${
              error ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-green-500/30 bg-green-500/10 text-green-300'
            }`}>
              <span className="flex items-center gap-2">{error ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}{error || success}</span>
              <button type="button" onClick={() => { setError(null); setSuccess(null); }}>×</button>
            </div>
          )}

          {!settings && loading && (
            <div className="flex min-h-[240px] items-center justify-center text-sm text-white/35">Carregando preferências...</div>
          )}

          {settings && activeTab === 'overview' && (
            <div className="grid gap-3 xl:grid-cols-12">
              <section className="xl:col-span-12 grid grid-cols-2 gap-2 md:grid-cols-5">
                <Metric label="Salário bruto" value={money(settings.gross_salary)} />
                <Metric label="Salário líquido" value={money(settings.net_salary_estimated)} highlight />
                <Metric label="Descontos" value={money(settings.deductions)} detail={percent(settings.deductions, settings.gross_salary)} danger={settings.gross_salary > 0 && settings.deductions / settings.gross_salary > 0.5} />
                <Metric label="Benefícios" value={money(settings.benefits)} />
                <Metric label="Ciclo" value={settings.payday_cycle === 'biweekly' ? 'Quinzenal' : 'Mensal'} detail={settings.payday_cycle === 'biweekly' ? `Dias ${settings.payday_1} e ${settings.payday_2}` : `Dia ${settings.payday_1}`} />
              </section>

              <section className="glass-card !p-4 xl:col-span-7">
                <div className="mb-3 flex items-center justify-between">
                  <div><h3 className="text-sm font-bold">Distribuição atual</h3><p className="text-[10px] text-white/35">Consulta sobre o salário líquido salvo</p></div>
                  <Sparkles size={17} className="text-brand-primary" />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <CycleCard day={String(settings.payday_1)} percentage={Number(settings.payday_1_percentage ?? 100)} amount={settings.net_salary_estimated * Number(settings.payday_1_percentage ?? 100) / 100} primary />
                  {settings.payday_cycle === 'biweekly' ? (
                    <CycleCard day={String(settings.payday_2 || 20)} percentage={Number(settings.payday_2_percentage ?? 0)} amount={settings.net_salary_estimated * Number(settings.payday_2_percentage ?? 0) / 100} />
                  ) : (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <div className="text-[9px] uppercase text-white/30">Recebimento</div>
                      <div className="mt-2 text-lg font-black">100% em um pagamento</div>
                      <p className="mt-1 text-[10px] text-white/35">O ciclo começa no dia {settings.payday_1}.</p>
                    </div>
                  )}
                </div>
                <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.025] p-3 text-xs text-white/45">
                  O Resumo é somente para consulta. Edições ficam separadas nas áreas de Descontos, Distribuição e Folha.
                </div>
              </section>

              <aside className="glass-card !p-4 xl:col-span-5">
                <h3 className="mb-3 text-sm font-bold">Ações rápidas</h3>
                <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
                  <QuickAction icon={<Percent size={16} />} title="Ajustar descontos" text="Padrões recorrentes e benefícios" onClick={() => setActiveTab('deductions')} />
                  <QuickAction icon={<CalendarDays size={16} />} title="Distribuir o ciclo" text="Dias e percentuais de recebimento" onClick={() => setActiveTab('distribution')} />
                  <QuickAction icon={<FileText size={16} />} title="Registrar holerite" text="Valores reais e histórico mensal" onClick={openPayrollCenter} primary />
                </div>
              </aside>

              <section className="glass-card !p-4 xl:col-span-12">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-bold"><ReceiptText size={16} /> Última folha registrada</h3>
                    <p className="mt-1 text-[10px] text-white/35">A folha é a fonte dos valores reais do holerite</p>
                  </div>
                  <button data-mf-preferences-action="true" type="button" onClick={openPayrollCenter} className="rounded-xl border border-brand-primary/30 bg-brand-primary/10 px-3 py-2 text-[10px] font-bold text-brand-primary">Abrir folha</button>
                </div>
                {latestPayroll ? (
                  <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-6">
                    <MiniMetric label="Competência" value={format(parseISO(`${latestPayroll.competence.slice(0, 7)}-01T12:00:00`), 'MMM/yy', { locale: ptBR })} />
                    <MiniMetric label="Bruto" value={money(latestPayroll.gross_salary)} />
                    <MiniMetric label="INSS" value={money(latestPayroll.inss_amount)} />
                    <MiniMetric label="IRRF" value={money(latestPayroll.irrf_amount)} />
                    <MiniMetric label="Outros" value={money(latestPayroll.other_deductions)} />
                    <MiniMetric label="Líquido" value={money(latestPayroll.net_salary)} highlight />
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl border border-dashed border-white/10 py-5 text-center text-xs text-white/30">Nenhuma folha registrada.</div>
                )}
              </section>
            </div>
          )}

          {settings && activeTab === 'deductions' && (
            <div className="grid gap-3 xl:grid-cols-12">
              <section className="glass-card !p-4 xl:col-span-7">
                <div className="mb-4">
                  <h3 className="text-sm font-bold">Descontos recorrentes e benefícios</h3>
                  <p className="mt-1 text-[10px] text-white/35">Somente os padrões usados nas projeções; o holerite mensal fica na Folha</p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <ReadOnly label="Salário bruto da folha" value={money(gross)} />
                  <ReadOnly label="Salário líquido projetado" value={money(previewNetSalary)} />
                  <ReadOnly label={latestPayroll ? 'INSS da última folha' : 'INSS estimado'} value={money(inssBase)} detail={percent(inssBase, gross)} />
                  <ReadOnly label={latestPayroll ? 'IRRF da última folha' : 'IRRF estimado'} value={money(irrfBase)} detail={percent(irrfBase, gross)} />
                  <Field label="Outros descontos recorrentes"><input className={inputClass} type="number" min="0" step="0.01" value={deductionsForm.otherDeductions} onChange={(event) => changeDeduction('otherDeductions', event.target.value)} /></Field>
                  <Field label="Benefícios mensais"><input className={inputClass} type="number" min="0" step="0.01" value={deductionsForm.benefits} onChange={(event) => changeDeduction('benefits', event.target.value)} /></Field>
                </div>
                <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.025] p-3 text-[10px] leading-relaxed text-white/40">
                  Use esta área apenas para padrões recorrentes, como plano de saúde, vale-transporte ou empréstimo fixo. Valores específicos de cada mês, salário bruto e impostos reais são registrados exclusivamente na Folha de pagamento.
                </div>
              </section>

              <aside className="glass-card !p-4 xl:col-span-5">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-bold"><BadgeDollarSign size={16} /> Impacto dos ajustes</h3>
                <SummaryRow label="INSS + IRRF de referência" value={money(inssBase + irrfBase)} />
                <SummaryRow label="Outros descontos" value={money(otherDeductions)} />
                <SummaryRow label="Total descontado" value={money(totalDeductions)} danger={discountRate > 0.5} />
                <SummaryRow label="Percentual descontado" value={percent(totalDeductions, gross)} danger={discountRate > 0.5} />
                <SummaryRow label="Salário líquido projetado" value={money(previewNetSalary)} highlight />
                <SummaryRow label="Benefícios separados" value={money(benefits)} />
                {discountRate > 0.5 && <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-[10px] text-amber-200">Mais de 50% do salário está comprometido com descontos. Confira as rubricas na Folha mensal.</div>}
                <button type="button" onClick={saveDeductions} disabled={saving || !deductionsDirty} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-primary py-3 text-sm font-black text-black disabled:opacity-40"><Save size={15} /> {saving ? 'Salvando...' : deductionsDirty ? 'Salvar ajustes' : 'Ajustes salvos'}</button>
                <button type="button" onClick={openPayrollCenter} data-mf-preferences-action="true" className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-3 text-xs font-bold text-white/55"><FileText size={15} /> Abrir holerite do mês</button>
              </aside>
            </div>
          )}

          {settings && activeTab === 'distribution' && (
            <div className="grid gap-3 xl:grid-cols-12">
              <section className="glass-card !p-4 xl:col-span-7">
                <div className="mb-4">
                  <h3 className="text-sm font-bold">Distribuição do recebimento</h3>
                  <p className="mt-1 text-[10px] text-white/35">Somente datas e percentuais; os valores do holerite não são editados aqui</p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Frequência"><select className={inputClass} value={distributionForm.paydayCycle} onChange={(event) => changeCycle(event.target.value as 'monthly' | 'biweekly')}><option value="monthly">Mensal</option><option value="biweekly">Quinzenal</option></select></Field>
                  <Field label="Primeiro pagamento"><input className={inputClass} type="number" min="1" max="31" value={distributionForm.payday1} onChange={(event) => changeDistribution('payday1', event.target.value)} /></Field>
                  {distributionForm.paydayCycle === 'biweekly' && (
                    <>
                      <Field label="Percentual do primeiro"><input className={inputClass} type="number" min="0" max="100" step="0.01" value={distributionForm.payday1Percentage} onChange={(event) => changeFirstPercentage(event.target.value)} /></Field>
                      <Field label="Segundo pagamento"><input className={inputClass} type="number" min="1" max="31" value={distributionForm.payday2} onChange={(event) => changeDistribution('payday2', event.target.value)} /></Field>
                      <Field label="Percentual do segundo"><input className={inputClass} type="number" min="0" max="100" step="0.01" value={distributionForm.payday2Percentage} onChange={(event) => changeSecondPercentage(event.target.value)} /></Field>
                    </>
                  )}
                </div>
                <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.025] p-3 text-[10px] leading-relaxed text-white/40">
                  A distribuição usa o salário líquido salvo pela Folha. Alterar dias ou percentuais não modifica salário, INSS, IRRF, descontos ou benefícios.
                </div>
              </section>

              <aside className="glass-card !p-4 xl:col-span-5">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-bold"><CalendarDays size={16} /> Prévia da distribuição</h3>
                <SummaryRow label="Salário líquido usado" value={money(cycleNetSalary)} highlight />
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <MiniMetric label={`Dia ${distributionForm.payday1}`} value={money(firstPayment)} detail={`${firstPercentage.toFixed(1)}%`} />
                  {distributionForm.paydayCycle === 'biweekly' ? <MiniMetric label={`Dia ${distributionForm.payday2}`} value={money(secondPayment)} detail={`${secondPercentage.toFixed(1)}%`} /> : <MiniMetric label="Frequência" value="Mensal" detail="Pagamento único" />}
                </div>
                <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3 text-[10px] text-white/40">
                  Soma prevista: <strong className="text-white">{money(firstPayment + secondPayment)}</strong>
                </div>
                <button type="button" onClick={saveDistribution} disabled={saving || !distributionDirty} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-primary py-3 text-sm font-black text-black disabled:opacity-40"><Save size={15} /> {saving ? 'Salvando...' : distributionDirty ? 'Salvar distribuição' : 'Distribuição salva'}</button>
              </aside>
            </div>
          )}

          {settings && activeTab === 'payroll' && (
            <div className="grid gap-3 xl:grid-cols-12">
              <section className="glass-card !p-4 xl:col-span-5">
                <div className="flex h-full flex-col">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-primary/10 text-brand-primary"><ReceiptText size={21} /></div>
                  <h3 className="mt-4 text-lg font-black">Folha de pagamento</h3>
                  <p className="mt-2 text-xs leading-relaxed text-white/45">Único lugar para editar salário bruto, INSS real, IRRF real, descontos do mês, benefícios do mês e observações do holerite.</p>
                  <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.025] p-3 text-[10px] leading-relaxed text-white/40">Ao salvar a folha, o salário líquido e os padrões usados no Dashboard são atualizados. A distribuição de datas e percentuais permanece na aba Distribuição.</p>
                  <button type="button" onClick={openPayrollCenter} data-mf-preferences-action="true" className="mt-5 flex items-center justify-center gap-2 rounded-xl bg-brand-primary py-3 text-sm font-black text-black"><FileText size={16} /> Abrir folha de pagamento</button>
                </div>
              </section>

              <section className="glass-card !p-4 xl:col-span-7">
                <div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-bold">Últimas competências</h3><p className="text-[10px] text-white/35">Histórico resumido, sem edição duplicada</p></div>{loading && <span className="text-[10px] text-white/30">Atualizando...</span>}</div>
                {payrollRows.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/10 py-10 text-center text-xs text-white/30">Nenhuma folha registrada.</div>
                ) : (
                  <div className="grid gap-2 md:grid-cols-2">
                    {payrollRows.map((row) => (
                      <button key={row.id} type="button" onClick={openPayrollCenter} data-mf-preferences-action="true" className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-left transition hover:border-brand-primary/30">
                        <div className="flex items-center justify-between gap-2"><span className="text-xs font-bold capitalize">{format(parseISO(`${row.competence.slice(0, 7)}-01T12:00:00`), 'MMMM yyyy', { locale: ptBR })}</span><span className="text-[9px] text-white/30">{row.payday_cycle === 'biweekly' ? 'Quinzenal' : 'Mensal'}</span></div>
                        <div className="mt-3 flex items-end justify-between"><div><div className="text-[9px] uppercase text-white/30">Líquido</div><div className="text-sm font-black text-brand-primary">{money(row.net_salary)}</div></div><div className="text-right text-[9px] text-white/35">Descontos<br />{money(row.inss_amount + row.irrf_amount + row.other_deductions)}</div></div>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function Metric({ label, value, detail, highlight, danger }: { label: string; value: string; detail?: string; highlight?: boolean; danger?: boolean }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3"><div className="text-[9px] font-bold uppercase text-white/30">{label}</div><div className={`mt-1 truncate text-sm font-black ${highlight ? 'text-brand-primary' : danger ? 'text-red-400' : ''}`}>{value}</div>{detail && <div className="mt-1 text-[9px] text-white/30">{detail}</div>}</div>;
}

function MiniMetric({ label, value, detail, highlight }: { label: string; value: string; detail?: string; highlight?: boolean }) {
  return <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-[8px] font-bold uppercase text-white/30">{label}</div><div className={`mt-1 truncate text-xs font-black ${highlight ? 'text-brand-primary' : ''}`}>{value}</div>{detail && <div className="mt-1 text-[8px] text-white/30">{detail}</div>}</div>;
}

function CycleCard({ day, percentage, amount, primary }: { day: string; percentage: number; amount: number; primary?: boolean }) {
  return <div className={`rounded-2xl border p-4 ${primary ? 'border-brand-primary/25 bg-brand-primary/5' : 'border-white/10 bg-white/[0.03]'}`}><div className="flex items-center justify-between"><span className="text-[9px] font-bold uppercase text-white/30">Pagamento dia {day}</span><span className="rounded-full bg-white/5 px-2 py-1 text-[9px] text-white/45">{percentage.toFixed(1)}%</span></div><div className={`mt-3 text-xl font-black ${primary ? 'text-brand-primary' : ''}`}>{money(amount)}</div></div>;
}

function QuickAction({ icon, title, text, onClick, primary }: { icon: React.ReactNode; title: string; text: string; onClick: () => void; primary?: boolean }) {
  return <button data-mf-preferences-action="true" type="button" onClick={onClick} className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition ${primary ? 'border-brand-primary/25 bg-brand-primary/5 hover:bg-brand-primary/10' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'}`}><span className={primary ? 'text-brand-primary' : 'text-white/55'}>{icon}</span><span className="min-w-0"><strong className="block truncate text-xs">{title}</strong><span className="block truncate text-[9px] text-white/35">{text}</span></span></button>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-[9px] font-bold uppercase text-white/35">{label}</span>{children}</label>;
}

function ReadOnly({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div><span className="mb-1.5 block text-[9px] font-bold uppercase text-white/35">{label}</span><div className={`${inputClass} flex items-center justify-between`}><strong>{value}</strong>{detail && <span className="text-[9px] text-white/30">{detail}</span>}</div></div>;
}

function SummaryRow({ label, value, highlight, danger }: { label: string; value: string; highlight?: boolean; danger?: boolean }) {
  return <div className="flex items-center justify-between border-b border-white/5 py-2.5 text-xs"><span className="text-white/40">{label}</span><strong className={highlight ? 'text-brand-primary' : danger ? 'text-red-400' : ''}>{value}</strong></div>;
}

function mountPreferencesCenter() {
  if (document.getElementById('mf-preferences-center-root')) return;
  const host = document.createElement('div');
  host.id = 'mf-preferences-center-root';
  document.body.appendChild(host);
  createRoot(host).render(<PreferencesCenter />);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountPreferencesCenter, { once: true });
} else {
  mountPreferencesCenter();
}

export {};
