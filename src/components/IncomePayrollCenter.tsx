import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  Pencil,
  Plus,
  ReceiptText,
  Save,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildPayrollSaveCommand,
  categoryFromDescription,
  createId,
  dateForMonth,
  derivePayrollSummary,
  type EditorForm,
  emptyForm,
  legacyItems,
  monthKey,
  monthLabel,
  normalizePayroll,
  normalizeSettings,
  numberValue,
  type PayrollRow,
  roundMoney,
  type SettingsRow,
  sanitizeItems,
} from '../features/payroll/payroll-domain';
import {
  analyzePayrollPdf,
  type PayrollItem,
  type PayrollItemKind,
} from '../lib/payroll-pdf-parser';
import { calculatePayrollFromGross } from '../lib/payroll-tax';
import { supabase } from '../lib/supabase';

const inputClass =
  'w-full rounded-xl border border-white/10 bg-black/35 px-3 py-2.5 text-sm text-white outline-none transition focus:border-brand-primary/60';

const money = (value: number) =>
  Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });

const percentage = (part: number, total: number) =>
  total > 0 ? `${((part / total) * 100).toFixed(2)}%` : '0,00%';

export default function IncomePayrollCenter({ userId }: { userId: string }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [settings, setSettings] = useState<SettingsRow | null>(null);
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [openMonths, setOpenMonths] = useState<string[]>([]);
  const [openGroups, setOpenGroups] = useState<string[]>([]);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EditorForm>(() => emptyForm(null));
  const [items, setItems] = useState<PayrollItem[]>([]);
  const [sourceFileName, setSourceFileName] = useState<string | null>(null);
  const [analysisWarnings, setAnalysisWarnings] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);

  async function loadData() {
    if (!userId) return;
    setLoading(true);
    const [settingsResult, statementsResult] = await Promise.all([
      supabase
        .from('mf_user_settings')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle(),
      supabase
        .from('mf_payroll_statements')
        .select('*')
        .eq('user_id', userId)
        .order('competence', { ascending: false }),
    ]);

    if (settingsResult.error) setError(settingsResult.error.message);
    if (statementsResult.error) setError(statementsResult.error.message);
    setSettings(
      settingsResult.data ? normalizeSettings(settingsResult.data) : null,
    );
    setRows((statementsResult.data || []).map(normalizePayroll));
    setLoading(false);
  }

  useEffect(() => {
    if (!userId) return;
    void loadData();

    const channel = supabase
      .channel(`income-payroll-library-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'mf_payroll_statements',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          if (!dirty) void loadData();
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'mf_user_settings',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          if (!dirty) void loadData();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, dirty, loadData]);

  const payrollSummary = useMemo(
    () => derivePayrollSummary(form, items),
    [form, items],
  );
  const {
    gross,
    deductionItems,
    benefitItems,
    earningItems,
    actualInss,
    actualIrrf,
    totalDeductions,
    actualNet,
    cycleBase,
    firstPercentage,
    secondPercentage,
    firstPayment,
    secondPayment,
    estimatedTaxes,
  } = payrollSummary;

  function toggleMonth(id: string) {
    setOpenMonths((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  function toggleGroup(key: string) {
    setOpenGroups((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  }

  function changeForm<K extends keyof EditorForm>(
    field: K,
    value: EditorForm[K],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
    setDirty(true);
    setSuccess(null);
  }

  function updateItem(id: string, patch: Partial<PayrollItem>) {
    setItems((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        const description = patch.description ?? item.description;
        return {
          ...item,
          ...patch,
          description,
          category:
            patch.description !== undefined
              ? categoryFromDescription(description)
              : patch.category || item.category,
          source: 'manual',
          confidence: 1,
        };
      }),
    );
    setDirty(true);
    setSuccess(null);
  }

  function addItem(kind: PayrollItemKind) {
    setItems((current) => [
      ...current,
      {
        id: createId(),
        description: '',
        kind,
        category: 'other',
        amount: 0,
        percentage: 0,
        source: 'manual',
        confidence: 1,
      },
    ]);
    setDirty(true);
  }

  function removeItem(id: string) {
    setItems((current) => current.filter((item) => item.id !== id));
    setDirty(true);
  }

  function changeCycle(value: 'monthly' | 'biweekly') {
    setForm((current) => ({
      ...current,
      paydayCycle: value,
      payday1Percentage: value === 'biweekly' ? '60' : '100',
      payday2Percentage: value === 'biweekly' ? '40' : '0',
    }));
    setDirty(true);
  }

  function changeFirstPercentage(value: string) {
    const first = Math.min(100, numberValue(value));
    setForm((current) => ({
      ...current,
      payday1Percentage: String(first),
      payday2Percentage: String(roundMoney(100 - first)),
    }));
    setDirty(true);
  }

  function changeSecondPercentage(value: string) {
    const second = Math.min(100, numberValue(value));
    setForm((current) => ({
      ...current,
      payday2Percentage: String(second),
      payday1Percentage: String(roundMoney(100 - second)),
    }));
    setDirty(true);
  }

  function startManual() {
    const nextForm = emptyForm(settings, monthKey());
    const estimate = calculatePayrollFromGross(
      numberValue(nextForm.grossSalary),
      dateForMonth(nextForm.competence),
    );
    const initial: PayrollItem[] = [];
    if (estimate.inss > 0)
      initial.push({
        id: createId(),
        description: 'INSS',
        kind: 'deduction',
        category: 'inss',
        amount: estimate.inss,
        percentage: 0,
        source: 'manual',
        confidence: 1,
      });
    if (estimate.irrf > 0)
      initial.push({
        id: createId(),
        description: 'IRRF',
        kind: 'deduction',
        category: 'irrf',
        amount: estimate.irrf,
        percentage: 0,
        source: 'manual',
        confidence: 1,
      });
    setEditingId(null);
    setForm(nextForm);
    setItems(initial);
    setSourceFileName(null);
    setAnalysisWarnings([]);
    setEditorOpen(true);
    setDirty(false);
    setError(null);
    setSuccess(null);
  }

  function editRow(row: PayrollRow) {
    const stored = sanitizeItems(row.payroll_items, row.gross_salary);
    setEditingId(row.id);
    setForm({
      competence: row.competence.slice(0, 7),
      grossSalary: String(row.gross_salary),
      paydayCycle: row.payday_cycle,
      payday1: String(row.payday_1),
      payday2: String(row.payday_2 || 20),
      payday1Percentage: String(row.payday_1_percentage),
      payday2Percentage: String(row.payday_2_percentage),
      notes: row.notes || '',
    });
    setItems(stored.length ? stored : legacyItems(row));
    setSourceFileName(row.source_file_name || null);
    setAnalysisWarnings([]);
    setEditorOpen(true);
    setDirty(false);
    setError(null);
    setSuccess(null);
  }

  async function analyzeFile(file: File) {
    setAnalyzing(true);
    setAnalysisProgress(0);
    setError(null);
    setSuccess(null);
    try {
      const analysis = await analyzePayrollPdf(file, setAnalysisProgress);
      const competence = analysis.competence || monthKey();
      const existing = rows.find(
        (row) => row.competence.slice(0, 7) === competence,
      );
      const baseForm = existing
        ? {
            competence,
            grossSalary: String(analysis.grossSalary || existing.gross_salary),
            paydayCycle: existing.payday_cycle,
            payday1: String(existing.payday_1),
            payday2: String(existing.payday_2 || 20),
            payday1Percentage: String(existing.payday_1_percentage),
            payday2Percentage: String(existing.payday_2_percentage),
            notes: existing.notes || '',
          }
        : {
            ...emptyForm(settings, competence),
            grossSalary: String(
              analysis.grossSalary || settings?.gross_salary || 0,
            ),
          };

      setEditingId(existing?.id || null);
      setForm(baseForm);
      setItems(sanitizeItems(analysis.items, analysis.grossSalary));
      setSourceFileName(file.name);
      setAnalysisWarnings(analysis.warnings);
      setEditorOpen(true);
      setDirty(true);
      setSuccess(
        `PDF lido como ${monthLabel(competence)}. Revise os grupos antes de salvar.`,
      );
    } catch (analysisError: any) {
      setError(
        analysisError?.message ||
          'Não foi possível analisar o PDF do holerite.',
      );
    } finally {
      setAnalyzing(false);
      setAnalysisProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function useOfficialTaxes() {
    const withoutTaxes = items.filter(
      (item) => item.category !== 'inss' && item.category !== 'irrf',
    );
    const taxes: PayrollItem[] = [];
    if (estimatedTaxes.inss > 0)
      taxes.push({
        id: createId(),
        description: 'INSS',
        kind: 'deduction',
        category: 'inss',
        amount: estimatedTaxes.inss,
        percentage: 0,
        source: 'manual',
        confidence: 1,
      });
    if (estimatedTaxes.irrf > 0)
      taxes.push({
        id: createId(),
        description: 'IRRF',
        kind: 'deduction',
        category: 'irrf',
        amount: estimatedTaxes.irrf,
        percentage: 0,
        source: 'manual',
        confidence: 1,
      });
    setItems([...taxes, ...withoutTaxes]);
    setDirty(true);
  }

  async function saveEditor() {
    if (!userId) return;
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const command = buildPayrollSaveCommand(form, items, sourceFileName);
      const { error: saveError } = await supabase.rpc(
        'mf_save_payroll_statement_v2',
        command.params,
      );

      if (saveError) throw saveError;
      setEditorOpen(false);
      setDirty(false);
      setEditingId(null);
      setSuccess(
        `${monthLabel(form.competence)} foi salvo e organizado por grupos.`,
      );
      await loadData();
      const saved = rows.find(
        (row) => row.competence.slice(0, 7) === form.competence,
      );
      if (saved && !openMonths.includes(saved.id))
        setOpenMonths((current) => [...current, saved.id]);
    } catch (saveError: any) {
      setError(saveError?.message || 'Não foi possível salvar o holerite.');
    } finally {
      setSaving(false);
    }
  }

  function closeEditor() {
    if (dirty && !window.confirm('Descartar as alterações não salvas?')) return;
    setEditorOpen(false);
    setEditingId(null);
    setDirty(false);
    setError(null);
    setAnalysisWarnings([]);
  }

  return (
    <div className="min-h-0 overflow-hidden rounded-2xl border border-white/10 bg-[#050505] shadow-2xl">
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3 md:px-5">
          <div>
            <h2 className="flex items-center gap-2 text-base font-black md:text-lg">
              <SlidersHorizontal size={19} className="text-brand-primary" />{' '}
              Renda e Folha
            </h2>
            <p className="mt-0.5 text-[9px] uppercase tracking-[0.18em] text-white/35">
              Um holerite por mês, organizado por proventos, descontos e
              benefícios
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              className="hidden"
              type="file"
              accept="application/pdf,.pdf"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void analyzeFile(file);
              }}
            />
            <button
              type="button"
              onClick={startManual}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold"
            >
              <Plus size={14} /> Manual
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={analyzing}
              className="flex items-center gap-2 rounded-xl bg-brand-primary px-4 py-2 text-xs font-black text-black disabled:opacity-50"
            >
              <Upload size={14} />{' '}
              {analyzing ? `Lendo ${analysisProgress}%` : 'Importar PDF'}
            </button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto p-3 md:p-4">
          {(error || success) && (
            <div
              className={`mb-3 flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-xs ${error ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-green-500/30 bg-green-500/10 text-green-300'}`}
            >
              <span className="flex items-center gap-2">
                {error ? (
                  <AlertTriangle size={14} />
                ) : (
                  <CheckCircle2 size={14} />
                )}
                {error || success}
              </span>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setSuccess(null);
                }}
              >
                <X size={14} />
              </button>
            </div>
          )}

          {editorOpen ? (
            <EditorPanel
              editingId={editingId}
              form={form}
              gross={gross}
              earningItems={earningItems}
              deductionItems={deductionItems}
              benefitItems={benefitItems}
              actualInss={actualInss}
              actualIrrf={actualIrrf}
              totalDeductions={totalDeductions}
              actualNet={actualNet}
              cycleBase={cycleBase}
              firstPayment={firstPayment}
              secondPayment={secondPayment}
              firstPercentage={firstPercentage}
              secondPercentage={secondPercentage}
              sourceFileName={sourceFileName}
              warnings={analysisWarnings}
              saving={saving}
              currentMonth={form.competence === monthKey()}
              onFormChange={changeForm}
              onCycleChange={changeCycle}
              onFirstPercentageChange={changeFirstPercentage}
              onSecondPercentageChange={changeSecondPercentage}
              onUpdateItem={updateItem}
              onAddItem={addItem}
              onRemoveItem={removeItem}
              onUseOfficialTaxes={useOfficialTaxes}
              onSave={saveEditor}
              onClose={closeEditor}
            />
          ) : (
            <>
              <section className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="Holerites salvos" value={String(rows.length)} />
                <Metric
                  label="Base atual do ciclo"
                  value={money(settings?.net_salary_estimated || 0)}
                  highlight
                />
                <Metric
                  label="Distribuição atual"
                  value={
                    settings?.payday_cycle === 'biweekly'
                      ? `${settings.payday_1_percentage || 60}% / ${settings.payday_2_percentage || 40}%`
                      : '100%'
                  }
                />
                <Metric
                  label="Dias de pagamento"
                  value={
                    settings?.payday_cycle === 'biweekly'
                      ? `${settings.payday_1 || 5} e ${settings.payday_2 || 20}`
                      : String(settings?.payday_1 || 5)
                  }
                />
              </section>

              <section>
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-bold">
                      <ReceiptText size={16} /> Holerites por mês
                    </h3>
                    <p className="mt-1 text-[10px] text-white/35">
                      Abra somente o mês que deseja consultar.
                    </p>
                  </div>
                  {loading && (
                    <span className="text-[10px] text-white/30">
                      Atualizando...
                    </span>
                  )}
                </div>

                {rows.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 py-14 text-center">
                    <FileText className="mx-auto text-white/20" size={32} />
                    <p className="mt-3 text-sm font-bold text-white/50">
                      Nenhum holerite salvo
                    </p>
                    <p className="mt-1 text-xs text-white/25">
                      Importe um PDF ou adicione os dados manualmente.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {rows.map((row) => (
                      <MonthCard
                        key={row.id}
                        row={row}
                        open={openMonths.includes(row.id)}
                        openGroups={openGroups}
                        onToggle={() => toggleMonth(row.id)}
                        onToggleGroup={toggleGroup}
                        onEdit={() => editRow(row)}
                      />
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function MonthCard({
  row,
  open,
  openGroups,
  onToggle,
  onToggleGroup,
  onEdit,
}: {
  row: PayrollRow;
  open: boolean;
  openGroups: string[];
  onToggle: () => void;
  onToggleGroup: (key: string) => void;
  onEdit: () => void;
}) {
  const stored = sanitizeItems(row.payroll_items, row.gross_salary);
  const items = stored.length ? stored : legacyItems(row);
  const earnings = items.filter((item) => item.kind === 'earning');
  const deductions = items.filter((item) => item.kind === 'deduction');
  const benefits = items.filter((item) => item.kind === 'benefit');
  const totalDeductions =
    row.inss_amount + row.irrf_amount + row.other_deductions;
  const actualNet = numberValue(
    row.net_salary || row.gross_salary - totalDeductions,
  );
  const cycleBase = numberValue(
    row.cycle_net_salary ||
      row.gross_salary - row.inss_amount - row.irrf_amount,
  );
  const key = row.competence.slice(0, 7);

  return (
    <article className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 p-4 text-left transition hover:bg-white/[0.025]"
      >
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-primary/10 text-brand-primary">
          <FileText size={21} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="capitalize">Holerite - {monthLabel(key)}</strong>
            <span className="rounded-full bg-white/5 px-2 py-1 text-[8px] font-bold uppercase text-white/35">
              {row.source_kind === 'pdf'
                ? 'PDF'
                : row.source_kind === 'mixed'
                  ? 'PDF + manual'
                  : 'Manual'}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-white/35">
            <span>
              Bruto: <b className="text-white/60">{money(row.gross_salary)}</b>
            </span>
            <span>
              Descontos:{' '}
              <b className="text-white/60">{money(totalDeductions)}</b>
            </span>
            <span>
              Líquido da folha:{' '}
              <b className="text-white/60">{money(actualNet)}</b>
            </span>
          </div>
        </div>
        <div className="hidden text-right sm:block">
          <div className="text-[8px] uppercase text-white/25">
            Base do ciclo
          </div>
          <div className="text-sm font-black text-brand-primary">
            {money(cycleBase)}
          </div>
        </div>
        {open ? (
          <ChevronDown size={18} className="text-white/40" />
        ) : (
          <ChevronRight size={18} className="text-white/40" />
        )}
      </button>

      {open && (
        <div className="border-t border-white/10 p-3 md:p-4">
          <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <MiniMetric label="Total bruto" value={money(row.gross_salary)} />
            <MiniMetric
              label="Descontos totais"
              value={money(totalDeductions)}
              detail={percentage(totalDeductions, row.gross_salary)}
            />
            <MiniMetric
              label="Líquido real da folha"
              value={money(actualNet)}
            />
            <MiniMetric
              label="Base 60% / 40%"
              value={money(cycleBase)}
              highlight
            />
          </div>

          <div className="space-y-2">
            <RubricGroup
              rowId={row.id}
              kind="earning"
              title="Proventos"
              items={earnings}
              gross={row.gross_salary}
              openGroups={openGroups}
              onToggle={onToggleGroup}
            />
            <RubricGroup
              rowId={row.id}
              kind="deduction"
              title="Descontos"
              items={deductions}
              gross={row.gross_salary}
              openGroups={openGroups}
              onToggle={onToggleGroup}
            />
            <RubricGroup
              rowId={row.id}
              kind="benefit"
              title="Benefícios"
              items={benefits}
              gross={row.gross_salary}
              openGroups={openGroups}
              onToggle={onToggleGroup}
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-[9px] text-white/25">
              {row.source_file_name
                ? `Arquivo: ${row.source_file_name}`
                : 'Registro manual'}
              {row.notes ? ` · ${row.notes}` : ''}
            </div>
            <button
              type="button"
              onClick={onEdit}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-bold"
            >
              <Pencil size={13} /> Editar holerite
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function RubricGroup({
  rowId,
  kind,
  title,
  items,
  gross,
  openGroups,
  onToggle,
}: {
  rowId: string;
  kind: PayrollItemKind;
  title: string;
  items: PayrollItem[];
  gross: number;
  openGroups: string[];
  onToggle: (key: string) => void;
}) {
  const key = `${rowId}:${kind}`;
  const open = openGroups.includes(key);
  const total = items.reduce((sum, item) => sum + item.amount, 0);

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-black/20">
      <button
        type="button"
        onClick={() => onToggle(key)}
        className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          {open ? (
            <ChevronDown size={15} className="text-brand-primary" />
          ) : (
            <ChevronRight size={15} className="text-white/35" />
          )}
          <strong className="text-xs">{title}</strong>
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[8px] text-white/35">
            {items.length}
          </span>
        </div>
        <div className="text-right">
          <div className="text-xs font-black">{money(total)}</div>
          <div className="text-[8px] text-white/30">
            {percentage(total, gross)}
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-white/10 px-3 py-2">
          {items.length === 0 ? (
            <p className="py-4 text-center text-[10px] text-white/25">
              Nenhuma rubrica neste grupo.
            </p>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 border-b border-white/5 py-2.5 last:border-0"
              >
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium">
                    {item.description}
                  </div>
                  <div className="mt-0.5 text-[8px] text-white/25">
                    {item.source === 'pdf'
                      ? 'Extraído do PDF'
                      : 'Informado manualmente'}
                    {item.reference ? ` · ref. ${item.reference}` : ''}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-xs font-black">{money(item.amount)}</div>
                  <div className="text-[8px] text-white/30">
                    {percentage(item.amount, gross)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function EditorPanel(props: {
  editingId: string | null;
  form: EditorForm;
  gross: number;
  earningItems: PayrollItem[];
  deductionItems: PayrollItem[];
  benefitItems: PayrollItem[];
  actualInss: number;
  actualIrrf: number;
  totalDeductions: number;
  actualNet: number;
  cycleBase: number;
  firstPayment: number;
  secondPayment: number;
  firstPercentage: number;
  secondPercentage: number;
  sourceFileName: string | null;
  warnings: string[];
  saving: boolean;
  currentMonth: boolean;
  onFormChange: <K extends keyof EditorForm>(
    field: K,
    value: EditorForm[K],
  ) => void;
  onCycleChange: (value: 'monthly' | 'biweekly') => void;
  onFirstPercentageChange: (value: string) => void;
  onSecondPercentageChange: (value: string) => void;
  onUpdateItem: (id: string, patch: Partial<PayrollItem>) => void;
  onAddItem: (kind: PayrollItemKind) => void;
  onRemoveItem: (id: string) => void;
  onUseOfficialTaxes: () => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const allItems = [
    ...props.earningItems,
    ...props.deductionItems,
    ...props.benefitItems,
  ];
  return (
    <div className="space-y-3">
      <section className="glass-card !p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold">
              <ReceiptText size={16} />{' '}
              {props.editingId ? 'Editar holerite' : 'Novo holerite'}
            </h3>
            <p className="mt-1 text-[10px] text-white/35">
              Revise o mês e as rubricas antes de salvar.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={props.onClose}
              className="rounded-xl border border-white/10 px-3 py-2 text-xs font-bold"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={props.onSave}
              disabled={props.saving}
              className="flex items-center gap-2 rounded-xl bg-brand-primary px-4 py-2 text-xs font-black text-black disabled:opacity-50"
            >
              <Save size={14} />{' '}
              {props.saving ? 'Salvando...' : 'Salvar holerite'}
            </button>
          </div>
        </div>

        <div
          className={`mt-3 rounded-xl border px-3 py-2 text-[10px] ${props.currentMonth ? 'border-green-500/20 bg-green-500/10 text-green-300' : 'border-blue-500/20 bg-blue-500/10 text-blue-300'}`}
        >
          {props.currentMonth
            ? 'Esta é a competência atual. Ao salvar, a base do ciclo e o Dashboard serão atualizados.'
            : 'Esta é uma competência histórica. Ela será salva no mês correto sem substituir os valores atuais do Dashboard.'}
        </div>

        {props.sourceFileName && (
          <div className="mt-2 text-[9px] text-white/30">
            PDF: {props.sourceFileName}
          </div>
        )}
        {props.warnings.length > 0 && (
          <div className="mt-2 space-y-1 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-[10px] text-amber-200">
            {props.warnings.map((warning) => (
              <div key={warning}>• {warning}</div>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-3 xl:grid-cols-12">
        <div className="glass-card !p-4 xl:col-span-7">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Competência">
              <input
                className={inputClass}
                type="month"
                value={props.form.competence}
                onChange={(event) =>
                  props.onFormChange('competence', event.target.value)
                }
              />
            </Field>
            <Field label="Salário bruto / total de proventos">
              <input
                className={inputClass}
                type="number"
                min="0"
                step="0.01"
                value={props.form.grossSalary}
                onChange={(event) =>
                  props.onFormChange('grossSalary', event.target.value)
                }
              />
            </Field>
            <Field label="Observações" wide>
              <textarea
                className={`${inputClass} min-h-20 resize-none`}
                value={props.form.notes}
                onChange={(event) =>
                  props.onFormChange('notes', event.target.value)
                }
                placeholder="Férias, adiantamento, observações da competência..."
              />
            </Field>
          </div>
        </div>
        <div className="glass-card !p-4 xl:col-span-5">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-bold">Resumo calculado</h4>
            <button
              type="button"
              onClick={props.onUseOfficialTaxes}
              className="rounded-lg border border-brand-primary/25 px-2 py-1 text-[9px] font-bold text-brand-primary"
            >
              Usar INSS/IRRF estimados
            </button>
          </div>
          <SummaryRow
            label="INSS"
            value={`${money(props.actualInss)} · ${percentage(props.actualInss, props.gross)}`}
          />
          <SummaryRow
            label="IRRF"
            value={`${money(props.actualIrrf)} · ${percentage(props.actualIrrf, props.gross)}`}
          />
          <SummaryRow
            label="Todos os descontos"
            value={`${money(props.totalDeductions)} · ${percentage(props.totalDeductions, props.gross)}`}
          />
          <SummaryRow
            label="Líquido real da folha"
            value={money(props.actualNet)}
          />
          <SummaryRow
            label="Base do ciclo"
            value={money(props.cycleBase)}
            highlight
          />
        </div>
      </section>

      <section className="glass-card !p-4">
        <div className="mb-3">
          <h3 className="text-sm font-bold">Rubricas organizadas</h3>
          <p className="mt-1 text-[10px] text-white/35">
            Cada item fica dentro do seu grupo. Você pode mover, editar ou
            excluir.
          </p>
        </div>
        <div className="space-y-3">
          <EditorGroup
            title="Proventos"
            kind="earning"
            items={props.earningItems}
            gross={props.gross}
            onUpdate={props.onUpdateItem}
            onAdd={props.onAddItem}
            onRemove={props.onRemoveItem}
          />
          <EditorGroup
            title="Descontos"
            kind="deduction"
            items={props.deductionItems}
            gross={props.gross}
            onUpdate={props.onUpdateItem}
            onAdd={props.onAddItem}
            onRemove={props.onRemoveItem}
          />
          <EditorGroup
            title="Benefícios"
            kind="benefit"
            items={props.benefitItems}
            gross={props.gross}
            onUpdate={props.onUpdateItem}
            onAdd={props.onAddItem}
            onRemove={props.onRemoveItem}
          />
        </div>
        {allItems.length === 0 && (
          <div className="mt-3 rounded-xl border border-dashed border-white/10 py-6 text-center text-xs text-white/25">
            Adicione pelo menos uma rubrica ou importe um PDF.
          </div>
        )}
      </section>

      <section className="glass-card !p-4">
        <div className="mb-3">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <CalendarDays size={16} /> Distribuição da base do ciclo
          </h3>
          <p className="mt-1 text-[10px] text-white/35">
            A base é o bruto menos INSS e IRRF. O segundo pagamento recebe o
            restante exato.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Field label="Frequência">
            <select
              className={inputClass}
              value={props.form.paydayCycle}
              onChange={(event) =>
                props.onCycleChange(
                  event.target.value as 'monthly' | 'biweekly',
                )
              }
            >
              <option value="monthly">Mensal</option>
              <option value="biweekly">Quinzenal</option>
            </select>
          </Field>
          <Field label="Primeiro dia">
            <input
              className={inputClass}
              type="number"
              min="1"
              max="31"
              value={props.form.payday1}
              onChange={(event) =>
                props.onFormChange('payday1', event.target.value)
              }
            />
          </Field>
          {props.form.paydayCycle === 'biweekly' && (
            <>
              <Field label="Percentual do primeiro">
                <input
                  className={inputClass}
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={props.form.payday1Percentage}
                  onChange={(event) =>
                    props.onFirstPercentageChange(event.target.value)
                  }
                />
              </Field>
              <Field label="Segundo dia">
                <input
                  className={inputClass}
                  type="number"
                  min="1"
                  max="31"
                  value={props.form.payday2}
                  onChange={(event) =>
                    props.onFormChange('payday2', event.target.value)
                  }
                />
              </Field>
              <Field label="Percentual do segundo">
                <input
                  className={inputClass}
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={props.form.payday2Percentage}
                  onChange={(event) =>
                    props.onSecondPercentageChange(event.target.value)
                  }
                />
              </Field>
            </>
          )}
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <CycleCard
            day={props.form.payday1}
            value={props.firstPayment}
            percent={props.firstPercentage}
            primary
          />
          {props.form.paydayCycle === 'biweekly' && (
            <CycleCard
              day={props.form.payday2}
              value={props.secondPayment}
              percent={props.secondPercentage}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function EditorGroup({
  title,
  kind,
  items,
  gross,
  onUpdate,
  onAdd,
  onRemove,
}: {
  title: string;
  kind: PayrollItemKind;
  items: PayrollItem[];
  gross: number;
  onUpdate: (id: string, patch: Partial<PayrollItem>) => void;
  onAdd: (kind: PayrollItemKind) => void;
  onRemove: (id: string) => void;
}) {
  const total = items.reduce((sum, item) => sum + item.amount, 0);
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <strong className="text-xs">{title}</strong>
          <span className="ml-2 text-[9px] text-white/30">
            {items.length} itens · {money(total)}
          </span>
        </div>
        <button
          type="button"
          onClick={() => onAdd(kind)}
          className="flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1.5 text-[9px] font-bold"
        >
          <Plus size={11} /> Adicionar
        </button>
      </div>
      {items.length === 0 ? (
        <p className="py-3 text-center text-[10px] text-white/20">
          Nenhum item.
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="grid gap-2 rounded-xl border border-white/5 bg-white/[0.02] p-2 lg:grid-cols-[130px_1fr_150px_90px_36px] lg:items-center"
            >
              <select
                className={inputClass}
                value={item.kind}
                onChange={(event) =>
                  onUpdate(item.id, {
                    kind: event.target.value as PayrollItemKind,
                  })
                }
              >
                <option value="earning">Provento</option>
                <option value="deduction">Desconto</option>
                <option value="benefit">Benefício</option>
              </select>
              <input
                className={inputClass}
                value={item.description}
                onChange={(event) =>
                  onUpdate(item.id, { description: event.target.value })
                }
                placeholder="Descrição da rubrica"
              />
              <input
                className={inputClass}
                type="number"
                min="0"
                step="0.01"
                value={item.amount}
                onChange={(event) =>
                  onUpdate(item.id, { amount: numberValue(event.target.value) })
                }
              />
              <div className={`${inputClass} text-right font-bold`}>
                {percentage(item.amount, gross)}
              </div>
              <button
                type="button"
                onClick={() => onRemove(item.id)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-red-400 hover:bg-red-500/10"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={wide ? 'block md:col-span-2' : 'block'}>
      <span className="mb-1.5 block text-[9px] font-bold uppercase text-white/35">
        {label}
      </span>
      {children}
    </label>
  );
}

function Metric({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-3">
      <div className="text-[8px] font-bold uppercase text-white/25">
        {label}
      </div>
      <div
        className={`mt-1 truncate text-sm font-black ${highlight ? 'text-brand-primary' : ''}`}
      >
        {value}
      </div>
    </div>
  );
}

function MiniMetric({
  label,
  value,
  detail,
  highlight,
}: {
  label: string;
  value: string;
  detail?: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="text-[8px] uppercase text-white/25">{label}</div>
      <div
        className={`mt-1 text-xs font-black ${highlight ? 'text-brand-primary' : ''}`}
      >
        {value}
      </div>
      {detail && (
        <div className="mt-0.5 text-[8px] text-white/25">{detail}</div>
      )}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/5 py-2 text-xs last:border-0">
      <span className="text-white/40">{label}</span>
      <strong className={highlight ? 'text-brand-primary' : ''}>{value}</strong>
    </div>
  );
}

function CycleCard({
  day,
  value,
  percent,
  primary,
}: {
  day: string;
  value: number;
  percent: number;
  primary?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${primary ? 'border-brand-primary/25 bg-brand-primary/5' : 'border-white/10 bg-white/[0.02]'}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-bold uppercase text-white/30">
          Dia {day}
        </span>
        <span className="rounded-full bg-white/5 px-2 py-1 text-[9px] text-white/40">
          {percent.toFixed(2)}%
        </span>
      </div>
      <div
        className={`mt-2 text-xl font-black ${primary ? 'text-brand-primary' : ''}`}
      >
        {money(value)}
      </div>
    </div>
  );
}
