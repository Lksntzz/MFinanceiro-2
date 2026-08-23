import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import type {
  PayrollItem,
  PayrollItemCategory,
  PayrollItemKind,
} from '../../lib/payroll-pdf-parser';
import { calculatePayrollFromGross } from '../../lib/payroll-tax';

export type SettingsRow = {
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

export type PayrollRow = {
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
  cycle_net_salary?: number | null;
  payday_cycle: 'monthly' | 'biweekly';
  payday_1: number;
  payday_2?: number | null;
  payday_1_percentage: number;
  payday_2_percentage: number;
  notes?: string | null;
  payroll_items?: unknown;
  source_kind?: 'manual' | 'pdf' | 'mixed';
  source_file_name?: string | null;
  updated_at?: string;
};

export type EditorForm = {
  competence: string;
  grossSalary: string;
  paydayCycle: 'monthly' | 'biweekly';
  payday1: string;
  payday2: string;
  payday1Percentage: string;
  payday2Percentage: string;
  notes: string;
};

export function monthKey(now = new Date()): string {
  return format(now, 'yyyy-MM');
}

export function numberValue(value: string | number | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function dateForMonth(key: string, fallback = new Date()): Date {
  const parsed = parseISO(`${key || monthKey(fallback)}-01T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

export function monthLabel(key: string): string {
  return format(dateForMonth(key), "MMMM 'de' yyyy", { locale: ptBR });
}

export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function categoryFromDescription(
  description: string,
): PayrollItemCategory {
  const text = normalizeText(description);
  if (/\binss\b|previdencia/.test(text)) return 'inss';
  if (/\birrf\b|imposto de renda/.test(text)) return 'irrf';
  if (/vale transporte|\bvt\b|transporte/.test(text)) return 'transport';
  if (/saude|medic|odont|farmacia|coparticipacao/.test(text)) return 'health';
  if (/alimentacao|refeicao|ticket|cesta|\bvr\b|\bva\b/.test(text))
    return 'food';
  if (/emprestimo|consignado|financiamento/.test(text)) return 'loan';
  if (/falta|atraso|ausencia/.test(text)) return 'absence';
  if (/salario|vencimento|ordenado/.test(text)) return 'salary';
  return 'other';
}

export function createId(prefix = 'manual'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeSettings(row: unknown): SettingsRow {
  const value =
    row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
  return {
    ...value,
    user_id: String(value.user_id || ''),
    gross_salary: numberValue(value.gross_salary as number),
    net_salary_estimated: numberValue(value.net_salary_estimated as number),
    deductions: numberValue(value.deductions as number),
    benefits: numberValue(value.benefits as number),
    payday_cycle: value.payday_cycle === 'biweekly' ? 'biweekly' : 'monthly',
    payday_1: Number(value.payday_1 || 5),
    payday_2: Number(value.payday_2 || 20),
    payday_1_percentage: numberValue(
      (value.payday_1_percentage as number) ?? 50,
    ),
    payday_2_percentage: numberValue(
      (value.payday_2_percentage as number) ?? 50,
    ),
  } as SettingsRow;
}

export function normalizePayroll(row: unknown): PayrollRow {
  const value =
    row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
  return {
    ...value,
    id: String(value.id),
    competence: String(value.competence),
    gross_salary: numberValue(value.gross_salary as number),
    expected_inss: numberValue(value.expected_inss as number),
    inss_amount: numberValue(value.inss_amount as number),
    expected_irrf: numberValue(value.expected_irrf as number),
    irrf_amount: numberValue(value.irrf_amount as number),
    other_deductions: numberValue(value.other_deductions as number),
    benefits: numberValue(value.benefits as number),
    net_salary: numberValue(value.net_salary as number),
    cycle_net_salary: numberValue(value.cycle_net_salary as number),
    payday_cycle: value.payday_cycle === 'biweekly' ? 'biweekly' : 'monthly',
    payday_1: Number(value.payday_1 || 5),
    payday_2: Number(value.payday_2 || 20),
    payday_1_percentage: numberValue(
      (value.payday_1_percentage as number) ?? 50,
    ),
    payday_2_percentage: numberValue(
      (value.payday_2_percentage as number) ?? 50,
    ),
  } as PayrollRow;
}

export function percentageNumber(part: number, total: number): number {
  return total > 0 ? roundMoney((part / total) * 100) : 0;
}

export function sanitizeItems(raw: unknown, gross = 0): PayrollItem[] {
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = [];
    }
  }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((rawItem, index) => {
      const value =
        rawItem && typeof rawItem === 'object'
          ? (rawItem as Record<string, unknown>)
          : {};
      let description = String(value.description || '').trim();
      if (/^\*+$/.test(description.replace(/\s/g, '')))
        description = 'Rubrica não identificada';
      if (!description) return null;

      const normalized = normalizeText(description);
      if (/\b\d{1,3}\/\d{4}-\d{2}\b/.test(normalized)) return null;
      if (
        /\b(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\/?20\d{2}\b/.test(
          normalized,
        ) &&
        /\d/.test(normalized)
      )
        return null;

      const kind: PayrollItemKind = [
        'earning',
        'deduction',
        'benefit',
      ].includes(String(value.kind))
        ? (value.kind as PayrollItemKind)
        : 'deduction';
      const amount = numberValue(value.amount as number);
      return {
        id: String(value.id || `stored-${index}`),
        code: value.code ? String(value.code) : undefined,
        description,
        kind,
        category: (value.category ||
          categoryFromDescription(description)) as PayrollItemCategory,
        amount,
        percentage:
          gross > 0
            ? roundMoney((amount / gross) * 100)
            : numberValue(value.percentage as number),
        reference: value.reference ? String(value.reference) : undefined,
        source: value.source === 'pdf' ? 'pdf' : 'manual',
        confidence: numberValue((value.confidence as number) ?? 1),
      } as PayrollItem;
    })
    .filter((item): item is PayrollItem => Boolean(item));
}

export function legacyItems(
  row: PayrollRow,
  idFactory = createId,
): PayrollItem[] {
  const result: PayrollItem[] = [];
  const add = (
    description: string,
    kind: PayrollItemKind,
    category: PayrollItemCategory,
    amount: number,
  ) => {
    if (amount <= 0) return;
    result.push({
      id: idFactory('legacy'),
      description,
      kind,
      category,
      amount,
      percentage: percentageNumber(amount, row.gross_salary),
      source: 'manual',
      confidence: 1,
    });
  };
  add('INSS', 'deduction', 'inss', row.inss_amount);
  add('IRRF', 'deduction', 'irrf', row.irrf_amount);
  add('Outros descontos', 'deduction', 'other', row.other_deductions);
  add('Benefícios', 'benefit', 'other', row.benefits);
  return result;
}

export function emptyForm(
  settings: SettingsRow | null,
  competence = monthKey(),
): EditorForm {
  const cycle = settings?.payday_cycle || 'biweekly';
  return {
    competence,
    grossSalary: String(settings?.gross_salary || 0),
    paydayCycle: cycle,
    payday1: String(settings?.payday_1 || 5),
    payday2: String(settings?.payday_2 || 20),
    payday1Percentage: String(
      cycle === 'biweekly' ? (settings?.payday_1_percentage ?? 60) : 100,
    ),
    payday2Percentage: String(
      cycle === 'biweekly' ? (settings?.payday_2_percentage ?? 40) : 0,
    ),
    notes: '',
  };
}

export function derivePayrollSummary(form: EditorForm, items: PayrollItem[]) {
  const gross = numberValue(form.grossSalary);
  const normalizedItems = items.map((item) => ({
    ...item,
    percentage: percentageNumber(item.amount, gross),
  }));
  const deductionItems = normalizedItems.filter(
    (item) => item.kind === 'deduction',
  );
  const benefitItems = normalizedItems.filter(
    (item) => item.kind === 'benefit',
  );
  const earningItems = normalizedItems.filter(
    (item) => item.kind === 'earning',
  );
  const actualInss = deductionItems
    .filter(
      (item) =>
        item.category === 'inss' ||
        /\binss\b/.test(normalizeText(item.description)),
    )
    .reduce((sum, item) => sum + item.amount, 0);
  const actualIrrf = deductionItems
    .filter(
      (item) =>
        item.category === 'irrf' ||
        /\birrf\b|imposto de renda/.test(normalizeText(item.description)),
    )
    .reduce((sum, item) => sum + item.amount, 0);
  const totalDeductions = deductionItems.reduce(
    (sum, item) => sum + item.amount,
    0,
  );
  const otherDeductions = Math.max(
    0,
    totalDeductions - actualInss - actualIrrf,
  );
  const benefits = benefitItems.reduce((sum, item) => sum + item.amount, 0);
  const actualNet = Math.max(0, roundMoney(gross - totalDeductions));
  const cycleBase = Math.max(0, roundMoney(gross - actualInss - actualIrrf));
  const firstPercentage =
    form.paydayCycle === 'biweekly'
      ? Math.min(100, numberValue(form.payday1Percentage))
      : 100;
  const secondPercentage =
    form.paydayCycle === 'biweekly'
      ? Math.min(100, numberValue(form.payday2Percentage))
      : 0;
  const firstPayment =
    form.paydayCycle === 'biweekly'
      ? roundMoney((cycleBase * firstPercentage) / 100)
      : cycleBase;
  const secondPayment =
    form.paydayCycle === 'biweekly' ? roundMoney(cycleBase - firstPayment) : 0;
  const estimatedTaxes = calculatePayrollFromGross(
    gross,
    dateForMonth(form.competence),
  );

  return {
    gross,
    normalizedItems,
    deductionItems,
    benefitItems,
    earningItems,
    actualInss,
    actualIrrf,
    totalDeductions,
    otherDeductions,
    benefits,
    actualNet,
    cycleBase,
    firstPercentage,
    secondPercentage,
    firstPayment,
    secondPayment,
    estimatedTaxes,
  };
}

export function buildPayrollSaveCommand(
  form: EditorForm,
  items: PayrollItem[],
  sourceFileName: string | null,
) {
  const summary = derivePayrollSummary(form, items);
  const payday1 = Number(form.payday1);
  const payday2 = Number(form.payday2);
  if (summary.gross <= 0) throw new Error('Informe o total bruto da folha.');
  if (summary.totalDeductions > summary.gross)
    throw new Error('Os descontos não podem superar o total bruto.');
  if (summary.normalizedItems.some((item) => !item.description.trim()))
    throw new Error('Preencha ou exclua as rubricas sem descrição.');
  if (!Number.isInteger(payday1) || payday1 < 1 || payday1 > 31)
    throw new Error('O primeiro dia deve ficar entre 1 e 31.');
  if (form.paydayCycle === 'biweekly') {
    if (!Number.isInteger(payday2) || payday2 < 1 || payday2 > 31)
      throw new Error('O segundo dia deve ficar entre 1 e 31.');
    if (
      Math.abs(summary.firstPercentage + summary.secondPercentage - 100) > 0.01
    )
      throw new Error('Os percentuais precisam somar 100%.');
  }

  const sourceKind: 'manual' | 'pdf' | 'mixed' = sourceFileName
    ? summary.normalizedItems.some((item) => item.source === 'manual')
      ? 'mixed'
      : 'pdf'
    : 'manual';

  return {
    summary,
    params: {
      p_competence: `${form.competence}-01`,
      p_gross_salary: summary.gross,
      p_expected_inss: summary.estimatedTaxes.inss,
      p_inss_amount: summary.actualInss,
      p_expected_irrf: summary.estimatedTaxes.irrf,
      p_irrf_amount: summary.actualIrrf,
      p_other_deductions: summary.otherDeductions,
      p_benefits: summary.benefits,
      p_payday_cycle: form.paydayCycle,
      p_payday_1: payday1,
      p_payday_2: form.paydayCycle === 'biweekly' ? payday2 : null,
      p_payday_1_percentage:
        form.paydayCycle === 'biweekly' ? summary.firstPercentage : 100,
      p_payday_2_percentage:
        form.paydayCycle === 'biweekly' ? summary.secondPercentage : 0,
      p_notes: form.notes.trim() || null,
      p_items: summary.normalizedItems.map((item) => ({
        id: item.id,
        code: item.code || null,
        description: item.description.trim(),
        kind: item.kind,
        category: item.category,
        amount: roundMoney(item.amount),
        percentage: roundMoney(item.percentage),
        reference: item.reference || null,
        source: item.source,
        confidence: item.confidence,
      })),
      p_source_kind: sourceKind,
      p_source_file_name: sourceFileName,
    },
  };
}
