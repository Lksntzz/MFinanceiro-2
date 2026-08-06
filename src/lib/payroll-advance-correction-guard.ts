import { supabase } from './supabase';

type StoredPayrollItem = {
  description?: string;
  kind?: string;
  category?: string;
  amount?: number | string;
  confidence?: number | string;
};

type PayrollStatementRow = {
  id: string;
  competence: string;
  gross_salary: number | string | null;
  inss_amount: number | string | null;
  irrf_amount: number | string | null;
  other_deductions: number | string | null;
  net_salary: number | string | null;
  cycle_net_salary: number | string | null;
  payday_cycle: string | null;
  payday_1_percentage: number | string | null;
  payday_2_percentage: number | string | null;
  payroll_items: unknown;
};

const ROOT_ID = 'mf-income-payroll-center-root';
let activeUserId: string | null = null;
let syncInFlight = false;
let patchQueued = false;

const normalize = (value: string | null | undefined) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const numberValue = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const money = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function parseItems(raw: unknown): StoredPayrollItem[] {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      value = [];
    }
  }
  return Array.isArray(value) ? value as StoredPayrollItem[] : [];
}

function isAdvanceDescription(description: string | null | undefined) {
  const text = normalize(description);
  return text.includes('adiantamento') || text.includes('vale salarial');
}

function isMetadataItem(item: StoredPayrollItem) {
  const text = normalize(item.description);
  const confidence = numberValue(item.confidence ?? 1);
  if ((text === 'rubrica nao identificada' || text === 'rubrica não identificada') && confidence < 0.5) return true;
  return /base calculo fgts|base calculo irrf|sal\.contr\.inss|fgts do mes|faixa irrf/.test(text);
}

function cleanItems(items: StoredPayrollItem[]) {
  return items.filter((item) => !isMetadataItem(item));
}

function advanceAmount(items: StoredPayrollItem[]) {
  return roundMoney(items.reduce((sum, item) => {
    if (normalize(item.kind) !== 'deduction') return sum;
    return isAdvanceDescription(item.description) ? sum + numberValue(item.amount) : sum;
  }, 0));
}

function statementValues(row: PayrollStatementRow) {
  const items = cleanItems(parseItems(row.payroll_items));
  const advance = advanceAmount(items);
  const gross = numberValue(row.gross_salary);
  const totalDeductions = numberValue(row.inss_amount) + numberValue(row.irrf_amount) + numberValue(row.other_deductions);
  const finalPayment = numberValue(row.net_salary) || Math.max(0, roundMoney(gross - totalDeductions));
  const cycleTotal = advance > 0
    ? roundMoney(finalPayment + advance)
    : numberValue(row.cycle_net_salary) || Math.max(0, roundMoney(gross - numberValue(row.inss_amount) - numberValue(row.irrf_amount)));
  const firstPercentage = cycleTotal > 0 && advance > 0 ? roundMoney((finalPayment / cycleTotal) * 100) : numberValue(row.payday_1_percentage);
  const secondPercentage = advance > 0 ? roundMoney(100 - firstPercentage) : numberValue(row.payday_2_percentage);
  return { items, advance, finalPayment, cycleTotal, firstPercentage, secondPercentage };
}

async function syncStoredStatements() {
  if (!activeUserId || syncInFlight) return;
  syncInFlight = true;
  try {
    const { data, error } = await supabase
      .from('mf_payroll_statements')
      .select('id,competence,gross_salary,inss_amount,irrf_amount,other_deductions,net_salary,cycle_net_salary,payday_cycle,payday_1_percentage,payday_2_percentage,payroll_items')
      .eq('user_id', activeUserId);
    if (error) return;

    const currentMonth = new Date().toISOString().slice(0, 7);
    let currentSettings: { cycleTotal: number; firstPercentage: number; secondPercentage: number } | null = null;

    for (const row of (data || []) as PayrollStatementRow[]) {
      const values = statementValues(row);
      if (values.advance <= 0) continue;

      const needsRowUpdate =
        Math.abs(numberValue(row.cycle_net_salary) - values.cycleTotal) > 0.009 ||
        Math.abs(numberValue(row.payday_1_percentage) - values.firstPercentage) > 0.009 ||
        Math.abs(numberValue(row.payday_2_percentage) - values.secondPercentage) > 0.009 ||
        values.items.length !== parseItems(row.payroll_items).length;

      if (needsRowUpdate) {
        await supabase
          .from('mf_payroll_statements')
          .update({
            cycle_net_salary: values.cycleTotal,
            payday_1_percentage: values.firstPercentage,
            payday_2_percentage: values.secondPercentage,
            payroll_items: values.items,
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id)
          .eq('user_id', activeUserId);
      }

      if (String(row.competence).slice(0, 7) === currentMonth) {
        currentSettings = {
          cycleTotal: values.cycleTotal,
          firstPercentage: values.firstPercentage,
          secondPercentage: values.secondPercentage,
        };
      }
    }

    if (currentSettings) {
      await supabase
        .from('mf_user_settings')
        .update({
          net_salary_estimated: currentSettings.cycleTotal,
          payday_1_percentage: currentSettings.firstPercentage,
          payday_2_percentage: currentSettings.secondPercentage,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', activeUserId);
    }
  } finally {
    syncInFlight = false;
  }
}

function labelInput(root: HTMLElement, labelText: string): HTMLInputElement | null {
  const wanted = normalize(labelText);
  const label = Array.from(root.querySelectorAll<HTMLLabelElement>('label')).find((candidate) => {
    const span = candidate.querySelector('span');
    return normalize(span?.textContent) === wanted;
  });
  return label?.querySelector<HTMLInputElement>('input') || null;
}

function setControlledInput(input: HTMLInputElement | null, value: number) {
  if (!input) return;
  const next = String(roundMoney(value));
  if (Math.abs(numberValue(input.value) - value) < 0.005) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, next);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function editorRubrics(root: HTMLElement) {
  const rows: Array<{ element: HTMLElement; kind: string; description: string; amount: number }> = [];
  root.querySelectorAll<HTMLSelectElement>('select').forEach((select) => {
    const optionValues = Array.from(select.options).map((option) => option.value);
    if (!optionValues.includes('earning') || !optionValues.includes('deduction')) return;
    const row = select.parentElement as HTMLElement | null;
    if (!row) return;
    const inputs = Array.from(row.querySelectorAll<HTMLInputElement>('input'));
    const descriptionInput = inputs.find((input) => input.type !== 'number');
    const amountInput = inputs.find((input) => input.type === 'number');
    if (!descriptionInput || !amountInput) return;
    rows.push({
      element: row,
      kind: select.value,
      description: descriptionInput.value,
      amount: numberValue(amountInput.value),
    });
  });
  return rows;
}

function patchSummaryRow(root: HTMLElement, oldLabel: string, newLabel: string, value: number) {
  const wanted = normalize(oldLabel);
  root.querySelectorAll<HTMLElement>('div').forEach((row) => {
    const span = row.querySelector(':scope > span');
    const strong = row.querySelector(':scope > strong');
    if (!span || !strong || normalize(span.textContent) !== wanted) return;
    span.textContent = newLabel;
    strong.textContent = money(value);
  });
}

function patchCycleCard(root: HTMLElement, day: number, value: number, percent: number) {
  root.querySelectorAll<HTMLElement>('div.rounded-2xl.border.p-4').forEach((card) => {
    const dayLabel = Array.from(card.querySelectorAll<HTMLElement>('span')).find((span) => normalize(span.textContent) === `dia ${day}`);
    if (!dayLabel) return;
    const badge = Array.from(card.querySelectorAll<HTMLElement>('span')).find((span) => normalize(span.textContent).endsWith('%'));
    const amount = Array.from(card.querySelectorAll<HTMLElement>('div')).find((element) => /^R\$/.test(String(element.textContent || '').trim()));
    if (badge) badge.textContent = `${percent.toFixed(2)}%`;
    if (amount) amount.textContent = money(value);
  });
}

function patchEditorPreview() {
  patchQueued = false;
  const root = document.getElementById(ROOT_ID);
  if (!root) return;
  const editorOpen = Array.from(root.querySelectorAll<HTMLElement>('h3')).some((heading) => {
    const text = normalize(heading.textContent);
    return text.includes('novo holerite') || text.includes('editar holerite');
  });
  if (!editorOpen) return;

  const grossInput = labelInput(root, 'Salário bruto / total de proventos');
  const gross = numberValue(grossInput?.value);
  if (gross <= 0) return;

  const rubrics = editorRubrics(root);
  rubrics.forEach((item) => {
    if (normalize(item.description) === 'rubrica nao identificada') {
      item.element.style.display = 'none';
      item.element.dataset.mfPayrollMetadata = 'true';
    }
  });

  const realRubrics = rubrics.filter((item) => normalize(item.description) !== 'rubrica nao identificada');
  const totalDeductions = roundMoney(realRubrics.filter((item) => item.kind === 'deduction').reduce((sum, item) => sum + item.amount, 0));
  const advance = roundMoney(realRubrics.filter((item) => item.kind === 'deduction' && isAdvanceDescription(item.description)).reduce((sum, item) => sum + item.amount, 0));
  if (advance <= 0) return;

  const finalPayment = Math.max(0, roundMoney(gross - totalDeductions));
  const cycleTotal = roundMoney(finalPayment + advance);
  const firstPercentage = cycleTotal > 0 ? roundMoney((finalPayment / cycleTotal) * 100) : 0;
  const secondPercentage = roundMoney(100 - firstPercentage);

  setControlledInput(labelInput(root, 'Percentual do primeiro'), firstPercentage);
  setControlledInput(labelInput(root, 'Percentual do segundo'), secondPercentage);

  patchSummaryRow(root, 'Base do ciclo', 'Total recebido no mês', cycleTotal);

  const day1 = Math.trunc(numberValue(labelInput(root, 'Primeiro dia')?.value || 5));
  const day2 = Math.trunc(numberValue(labelInput(root, 'Segundo dia')?.value || 20));
  patchCycleCard(root, day1, finalPayment, firstPercentage);
  patchCycleCard(root, day2, advance, secondPercentage);

  Array.from(root.querySelectorAll<HTMLElement>('p')).forEach((paragraph) => {
    if (!normalize(paragraph.textContent).includes('a base e o bruto menos inss e irrf')) return;
    paragraph.textContent = 'Quando o PDF informa Adiantamento Anterior, o valor do segundo pagamento é usado exatamente como aparece no holerite.';
  });
}

function queuePreviewPatch() {
  if (patchQueued) return;
  patchQueued = true;
  window.setTimeout(patchEditorPreview, 30);
}

function installPayrollAdvanceGuard() {
  supabase.auth.getUser().then(({ data }) => {
    activeUserId = data.user?.id || null;
    void syncStoredStatements();
  }).catch(() => undefined);

  supabase.auth.onAuthStateChange((_event, session) => {
    activeUserId = session?.user?.id || null;
    void syncStoredStatements();
  });

  const observer = new MutationObserver(queuePreviewPatch);
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['value', 'class'] });
  queuePreviewPatch();

  document.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('button');
    const label = normalize(button?.textContent);
    if (label.includes('salvar holerite')) {
      window.setTimeout(() => void syncStoredStatements(), 700);
      window.setTimeout(() => void syncStoredStatements(), 1800);
    }
  }, true);

  window.addEventListener('beforeunload', () => observer.disconnect(), { once: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installPayrollAdvanceGuard, { once: true });
} else {
  installPayrollAdvanceGuard();
}

export {};
