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
  Wallet,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { calculatePayrollFromGross } from './payroll-tax';
import { supabase } from './supabase';

type Tab = 'overview' | 'income' | 'deductions' | 'payroll';

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

type FormState = {
  grossSalary: string;
  otherDeductions: string;
  benefits: string;
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
  const [form, setForm] = useState<FormState>({
    grossSalary: '0',
    otherDeductions: '0',
    benefits: '0',
    paydayCycle: 'monthly',
    payday1: '5',
    payday2: '20',
    payday1Percentage: '100',
    payday2Percentage: '0',
  });
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

  const hydrate = useCallback((nextSettings: SettingsRow) => {
    const estimate = calculatePayrollFromGross(nextSettings.gross_salary, new Date());
    const otherDeductions = Math.max(0, nextSettings.deductions - estimate.totalDeductions);
    const cycle = nextSettings.payday_cycle;
    setForm({
      grossSalary: String(nextSettings.gross_salary),
      otherDeductions: String(Number(otherDeductions.toFixed(2))),
      benefits: String(nextSettings.benefits),
      paydayCycle: cycle,
      payday1: String(nextSettings.payday_1 || 5),
      payday2: String(nextSettings.payday_2 || 20),
      payday1Percentage: String(cycle === 'biweekly' ? Number(nextSettings.payday_1_percentage ?? 50) : 100),
      payday2Percentage: String(cycle === 'biweekly' ? Number(nextSettings.payday_2_percentage ?? 50) : 0),
    });
    setDirty(false);
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

    if (settingsResult.data) {
      const nextSettings = normalizeSettings(settingsResult.data);
      setSettings(nextSettings);
      hydrate(nextSettings);
    }
    setPayrollRows((payrollResult.data || []).map(normalizePayroll));
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

  const gross = numberValue(form.grossSalary);
  const official = useMemo(() => calculatePayrollFromGross(gross, new Date()), [gross]);
  const otherDeductions = numberValue(form.otherDeductions);
  const benefits = numberValue(form.benefits);
  const totalDeductions = official.totalDeductions + otherDeductions;
  const netSalary = Math.max(0, gross - totalDeductions);
  const firstPercentage = form.paydayCycle === 'biweekly' ? Math.min(100, numberValue(form.payday1Percentage)) : 100;
  const secondPercentage = form.paydayCycle === 'biweekly' ? Math.min(100, numberValue(form.payday2Percentage)) : 0;
  const firstPayment = netSalary * firstPercentage / 100;
  const secondPayment = netSalary * secondPercentage / 100;
  const discountRate = gross > 0 ? totalDeductions / gross : 0;
  const latestPayroll = payrollRows[0] || null;

  function change<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
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

  async function saveSettings() {
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

      const result = await supabase
        .from('mf_user_settings')
        .update({
          gross_salary: gross,
          net_salary_estimated: Number(netSalary.toFixed(2)),
          deductions: Number(totalDeductions.toFixed(2)),
          benefits,
          payday_cycle: form.paydayCycle,
          payday_1: payday1,
          payday_2: form.paydayCycle === 'biweekly' ? payday2 : null,
          payday_1_percentage: form.paydayCycle === 'biweekly' ? firstPercentage : 100,
          payday_2_percentage: form.paydayCycle === 'biweekly' ? secondPercentage : 0,
        })
        .eq('user_id', userId);

      if (result.error) throw result.error;
      setSuccess('Preferências salvas. O Dashboard foi atualizado.');
      setDirty(false);
      await loadData();
    } catch (saveError: any) {
      setError(saveError?.message || 'Não foi possível salvar as preferências.');
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
    { id: 'income', label: 'Renda e ciclo', icon: Wallet },
    { id: 'deductions', label: 'Descontos', icon: Percent },
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
              Renda, ciclo, descontos e folha em uma única central
            </p>
          </div>
          <div className="flex items-center gap-2">
            {dirty && <span className="hidden rounded-full bg-amber-500/10 px-2 py-1 text-[9px] font-bold text-amber-300 sm:inline">Alterações não salvas</span>}
            <button
              type="button"
              onClick={saveSettings}
              disabled={saving || loading}
              className="flex items-center gap-2 rounded-xl bg-brand-primary px-4 py-2 text-xs font-black text-black disabled:opacity-50"
            >
              <Save size={14} /> {saving ? 'Salvando...' : 'Salvar'}
            </button>
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

          {activeTab === 'overview' && (
            <div className="grid gap-3 xl:grid-cols-12">
              <section className="xl:col-span-12 grid grid-cols-2 gap-2 md:grid-cols-5">
                <Metric label="Salário bruto" value={money(gross)} />
                <Metric label="Salário líquido" value={money(netSalary)} highlight />
                <Metric label="Descontos" value={money(totalDeductions)} detail={percent(totalDeductions, gross)} danger={discountRate > 0.5} />
                <Metric label="Benefícios" value={money(benefits)} />
                <Metric label="Ciclo" value={form.paydayCycle === 'biweekly' ? 'Quinzenal' : 'Mensal'} detail={form.paydayCycle === 'biweekly' ? `Dias ${form.payday1} e ${form.payday2}` : `Dia ${form.payday1}`} />
              </section>

              <section className="glass-card !p-4 xl:col-span-7">
                <div className="mb-3 flex items-center justify-between">
                  <div><h3 className="text-sm font-bold">Distribuição do ciclo</h3><p className="text-[10px] text-white/35">Valores calculados sobre o salário líquido</p></div>
                  <Sparkles size={17} className="text-brand-primary" />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <CycleCard day={form.payday1} percentage={firstPercentage} amount={firstPayment} primary />
                  {form.paydayCycle === 'biweekly' ? (
                    <CycleCard day={form.payday2} percentage={secondPercentage} amount={secondPayment} />
                  ) : (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <div className="text-[9px] uppercase text-white/30">Recebimento</div>
                      <div className="mt-2 text-lg font-black">100% em um pagamento</div>
                      <p className="mt-1 text-[10px] text-white/35">O ciclo começa no dia {form.payday1}.</p>
                    </div>
                  )}
                </div>
                <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.025] p-3 text-xs text-white/45">
                  O Dashboard usa <strong className="text-white">{money(netSalary)}</strong> como renda mensal projetada. Benefícios continuam separados do dinheiro disponível em conta.
                </div>
              </section>

              <aside className="glass-card !p-4 xl:col-span-5">
                <h3 className="mb-3 text-sm font-bold">Ações rápidas</h3>
                <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
                  <QuickAction icon={<Wallet size={16} />} title="Editar renda e ciclo" text="Salário, datas e divisão" onClick={() => setActiveTab('income')} />
                  <QuickAction icon={<Percent size={16} />} title="Revisar descontos" text="INSS, IRRF e adicionais" onClick={() => setActiveTab('deductions')} />
                  <QuickAction icon={<FileText size={16} />} title="Abrir folha completa" text="Registrar o holerite do mês" onClick={openPayrollCenter} primary />
                </div>
              </aside>

              <section className="glass-card !p-4 xl:col-span-12">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-bold"><ReceiptText size={16} /> Última folha registrada</h3>
                    <p className="mt-1 text-[10px] text-white/35">Conferência rápida do histórico mensal</p>
                  </div>
                  <button data-mf-preferences-action="true" type="button" onClick={openPayrollCenter} className="rounded-xl border border-brand-primary/30 bg-brand-primary/10 px-3 py-2 text-[10px] font-bold text-brand-primary">Ver histórico completo</button>
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

          {activeTab === 'income' && (
            <div className="grid gap-3 xl:grid-cols-12">
              <section className="glass-card !p-4 xl:col-span-7">
                <div className="mb-4"><h3 className="text-sm font-bold">Renda e ciclo</h3><p className="mt-1 text-[10px] text-white/35">Campos essenciais em uma única tela</p></div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Salário bruto"><input className={inputClass} type="number" min="0" step="0.01" value={form.grossSalary} onChange={(event) => change('grossSalary', event.target.value)} /></Field>
                  <Field label="Salário líquido calculado"><div className={`${inputClass} flex items-center font-black text-brand-primary`}>{money(netSalary)}</div></Field>
                  <Field label="Ciclo de pagamento"><select className={inputClass} value={form.paydayCycle} onChange={(event) => { const cycle = event.target.value as 'monthly' | 'biweekly'; setForm((current) => ({ ...current, paydayCycle: cycle, payday1Percentage: cycle === 'monthly' ? '100' : '50', payday2Percentage: cycle === 'monthly' ? '0' : '50' })); setDirty(true); setSuccess(null); }}><option value="monthly">Mensal</option><option value="biweekly">Quinzenal</option></select></Field>
                  <Field label="Primeiro pagamento"><input className={inputClass} type="number" min="1" max="31" value={form.payday1} onChange={(event) => change('payday1', event.target.value)} /></Field>
                  {form.paydayCycle === 'biweekly' && (
                    <>
                      <Field label="Percentual do primeiro"><input className={inputClass} type="number" min="0" max="100" step="0.01" value={form.payday1Percentage} onChange={(event) => changeFirstPercentage(event.target.value)} /></Field>
                      <Field label="Segundo pagamento"><input className={inputClass} type="number" min="1" max="31" value={form.payday2} onChange={(event) => change('payday2', event.target.value)} /></Field>
                      <Field label="Percentual do segundo"><input className={inputClass} type="number" min="0" max="100" step="0.01" value={form.payday2Percentage} onChange={(event) => changeSecondPercentage(event.target.value)} /></Field>
                    </>
                  )}
                </div>
              </section>

              <aside className="glass-card !p-4 xl:col-span-5">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-bold"><CalendarDays size={16} /> Prévia do ciclo</h3>
                <SummaryRow label="Salário bruto" value={money(gross)} />
                <SummaryRow label="Descontos totais" value={`- ${money(totalDeductions)}`} danger />
                <SummaryRow label="Renda líquida" value={money(netSalary)} highlight />
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <MiniMetric label={`Dia ${form.payday1}`} value={money(firstPayment)} detail={`${firstPercentage.toFixed(1)}%`} />
                  {form.paydayCycle === 'biweekly' ? <MiniMetric label={`Dia ${form.payday2}`} value={money(secondPayment)} detail={`${secondPercentage.toFixed(1)}%`} /> : <MiniMetric label="Frequência" value="Mensal" detail="Pagamento único" />}
                </div>
                <button type="button" onClick={saveSettings} disabled={saving} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-primary py-3 text-sm font-black text-black disabled:opacity-50"><Save size={15} /> Salvar renda e ciclo</button>
              </aside>
            </div>
          )}

          {activeTab === 'deductions' && (
            <div className="grid gap-3 xl:grid-cols-12">
              <section className="glass-card !p-4 xl:col-span-7">
                <div className="mb-4"><h3 className="text-sm font-bold">Descontos e benefícios</h3><p className="mt-1 text-[10px] text-white/35">O cálculo oficial fica separado dos descontos da empresa</p></div>
                <div className="grid gap-3 md:grid-cols-2">
                  <ReadOnly label="INSS estimado" value={money(official.inss)} detail={percent(official.inss, gross)} />
                  <ReadOnly label="IRRF estimado" value={money(official.irrf)} detail={percent(official.irrf, gross)} />
                  <Field label="Outros descontos da folha"><input className={inputClass} type="number" min="0" step="0.01" value={form.otherDeductions} onChange={(event) => change('otherDeductions', event.target.value)} /></Field>
                  <Field label="Benefícios mensais"><input className={inputClass} type="number" min="0" step="0.01" value={form.benefits} onChange={(event) => change('benefits', event.target.value)} /></Field>
                </div>
                <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.025] p-3 text-[10px] leading-relaxed text-white/40">
                  “Outros descontos” inclui plano de saúde, vale-transporte, empréstimos, faltas, adiantamentos ou rubricas que não fazem parte do INSS e do IRRF. Para valores exatos do holerite, use a área de Folha.
                </div>
              </section>

              <aside className="glass-card !p-4 xl:col-span-5">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-bold"><BadgeDollarSign size={16} /> Impacto na renda</h3>
                <SummaryRow label="INSS + IRRF" value={money(official.totalDeductions)} />
                <SummaryRow label="Outros descontos" value={money(otherDeductions)} />
                <SummaryRow label="Total descontado" value={money(totalDeductions)} danger={discountRate > 0.5} />
                <SummaryRow label="Percentual descontado" value={percent(totalDeductions, gross)} danger={discountRate > 0.5} />
                <SummaryRow label="Salário líquido" value={money(netSalary)} highlight />
                {discountRate > 0.5 && <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-[10px] text-amber-200">Mais de 50% do salário está comprometido com descontos. Confira a folha mensal para identificar as rubricas.</div>}
                <button type="button" onClick={openPayrollCenter} data-mf-preferences-action="true" className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-brand-primary/30 bg-brand-primary/10 py-3 text-xs font-bold text-brand-primary"><FileText size={15} /> Conferir no holerite</button>
              </aside>
            </div>
          )}

          {activeTab === 'payroll' && (
            <div className="grid gap-3 xl:grid-cols-12">
              <section className="glass-card !p-4 xl:col-span-5">
                <div className="flex h-full flex-col">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-primary/10 text-brand-primary"><ReceiptText size={21} /></div>
                  <h3 className="mt-4 text-lg font-black">Folha de pagamento</h3>
                  <p className="mt-2 text-xs leading-relaxed text-white/45">Registre os valores reais do holerite, compare INSS e IRRF, visualize as porcentagens e atualize a renda líquida do Dashboard.</p>
                  <button type="button" onClick={openPayrollCenter} data-mf-preferences-action="true" className="mt-5 flex items-center justify-center gap-2 rounded-xl bg-brand-primary py-3 text-sm font-black text-black"><FileText size={16} /> Abrir folha de pagamento</button>
                </div>
              </section>

              <section className="glass-card !p-4 xl:col-span-7">
                <div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-bold">Últimas competências</h3><p className="text-[10px] text-white/35">Histórico resumido</p></div>{loading && <span className="text-[10px] text-white/30">Atualizando...</span>}</div>
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
