import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

export type PayrollItemKind = 'earning' | 'deduction' | 'benefit';
export type PayrollItemCategory = 'salary' | 'inss' | 'irrf' | 'transport' | 'health' | 'food' | 'loan' | 'absence' | 'other';

export type PayrollItem = {
  id: string;
  code?: string;
  description: string;
  kind: PayrollItemKind;
  category: PayrollItemCategory;
  amount: number;
  percentage: number;
  reference?: string;
  source: 'pdf' | 'manual';
  confidence: number;
};

export type PayrollPdfAnalysis = {
  competence?: string;
  grossSalary: number;
  totalEarnings: number;
  totalDeductions: number;
  netSalary: number;
  benefits: number;
  items: PayrollItem[];
  warnings: string[];
  pageCount: number;
  fileName: string;
};

type Token = { text: string; x: number; y: number; page: number };
type Row = { text: string; tokens: Token[]; page: number };
type MoneyCell = { amount: number; raw: string; x: number };

const amountRegex = /(?:R\$\s*)?\(?-?\d{1,3}(?:\.\d{3})*,\d{2}\)?-?|(?:R\$\s*)?\(?-?\d+\.\d{2}\)?-?/g;

const MONTHS: Record<string, string> = {
  janeiro: '01', jan: '01',
  fevereiro: '02', fev: '02',
  marco: '03', mar: '03',
  abril: '04', abr: '04',
  maio: '05', mai: '05',
  junho: '06', jun: '06',
  julho: '07', jul: '07',
  agosto: '08', ago: '08',
  setembro: '09', set: '09',
  outubro: '10', out: '10',
  novembro: '11', nov: '11',
  dezembro: '12', dez: '12',
};

const DEDUCTION_TERMS = [
  'inss', 'irrf', 'imposto de renda', 'previdencia', 'vale transporte', 'plano de saude',
  'assistencia medica', 'odontologico', 'coparticipacao', 'sindicato', 'emprestimo',
  'consignado', 'adiantamento', 'pensao', 'falta', 'atraso', 'seguro', 'convenio',
  'farmacia', 'desconto', 'mensalidade', 'aviso previo', 'desc.',
];

const EARNING_TERMS = [
  'salario', 'vencimento', 'ordenado', 'provento', 'hora extra', 'adicional', 'comissao',
  'gratificacao', 'bonus', 'premio', 'dsr', 'ferias', 'decimo terceiro', '13 salario',
  'abono', 'insalubridade', 'periculosidade', 'noturno', 'produtividade',
];

const BENEFIT_TERMS = [
  'vale alimentacao', 'vale refeicao', 'auxilio alimentacao', 'auxilio refeicao',
  'cesta basica', 'ticket', 'beneficio', 'auxilio creche', 'vale combustivel',
];

const SUMMARY_TERMS = [
  'total de vencimentos', 'total vencimentos', 'total de proventos', 'total proventos',
  'total de descontos', 'total descontos', 'liquido a receber', 'valor liquido',
  'salario liquido', 'base inss', 'base irrf', 'base fgts', 'fgts do mes',
  'salario base', 'total bruto', 'total liquido', 'valor a receber',
];

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseAmount(raw: string): number {
  const negative = raw.trim().startsWith('-') || raw.trim().endsWith('-') || /^\(.*\)$/.test(raw.trim());
  const cleaned = raw.replace(/R\$/gi, '').replace(/[()\s-]/g, '').replace(/[^\d.,]/g, '');
  if (!cleaned) return 0;

  let canonical = cleaned;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    canonical = cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.replace(/,/g, '');
  } else if (cleaned.includes(',')) {
    canonical = cleaned.replace(/\./g, '').replace(',', '.');
  }

  const value = Number(canonical);
  return Number.isFinite(value) ? round(negative ? -Math.abs(value) : value) : 0;
}

function tokenAsMoney(token: Token): MoneyCell | null {
  const value = token.text.trim();
  if (!/^(?:R\$\s*)?\(?-?\d{1,3}(?:\.\d{3})*,\d{2}\)?-?$|^(?:R\$\s*)?\(?-?\d+\.\d{2}\)?-?$/.test(value)) return null;
  return { amount: Math.abs(parseAmount(value)), raw: value, x: token.x };
}

function moneyCells(row: Row): MoneyCell[] {
  const tokenCells = row.tokens.map(tokenAsMoney).filter((cell): cell is MoneyCell => Boolean(cell));
  if (tokenCells.length) return tokenCells;
  return Array.from(row.text.matchAll(amountRegex)).map((match, index) => ({
    amount: Math.abs(parseAmount(match[0])),
    raw: match[0],
    x: index * 100,
  }));
}

function groupRows(tokens: Token[]): Row[] {
  const groups = new Map<string, Token[]>();
  tokens.forEach((token) => {
    const key = `${token.page}:${Math.round(token.y / 2.5) * 2.5}`;
    groups.set(key, [...(groups.get(key) || []), token]);
  });

  return Array.from(groups.values())
    .map((items) => {
      const sorted = [...items].sort((a, b) => a.x - b.x);
      return {
        page: sorted[0]?.page || 1,
        tokens: sorted,
        text: sorted.map((item) => item.text.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(),
      };
    })
    .filter((row) => row.text)
    .sort((a, b) => a.page - b.page || b.tokens[0].y - a.tokens[0].y);
}

function competenceFromMonthName(value: string): string | undefined {
  const text = normalize(value);
  const match = text.match(/\b(janeiro|jan|fevereiro|fev|marco|mar|abril|abr|maio|mai|junho|jun|julho|jul|agosto|ago|setembro|set|outubro|out|novembro|nov|dezembro|dez)\s*(?:\/|-|de)?\s*(20\d{2})\b/);
  if (!match) return undefined;
  return `${match[2]}-${MONTHS[match[1]]}`;
}

function competenceFromFileName(fileName: string): string | undefined {
  const name = normalize(fileName.replace(/\.pdf$/i, ' '));
  const compactYearMonth = name.match(/(?:^|\D)(20\d{2})(0[1-9]|1[0-2])(?:\D|$)/);
  if (compactYearMonth) return `${compactYearMonth[1]}-${compactYearMonth[2]}`;

  const compactMonthYear = name.match(/(?:^|\D)(0[1-9]|1[0-2])(20\d{2})(?:\D|$)/);
  if (compactMonthYear) return `${compactMonthYear[2]}-${compactMonthYear[1]}`;

  return competenceFromMonthName(name);
}

function detectCompetence(rows: Row[], fileName: string): string | undefined {
  const text = normalize(rows.map((row) => row.text).join(' '));

  const direct = text.match(/(?:competencia|referencia|mes\/ano|periodo|folha)\D{0,40}(0?[1-9]|1[0-2])[\/.\-](20\d{2})/);
  if (direct) return `${direct[2]}-${String(Number(direct[1])).padStart(2, '0')}`;

  const reverse = text.match(/(?:competencia|referencia|mes\/ano|periodo|folha)\D{0,40}(20\d{2})[\/.\-](0?[1-9]|1[0-2])/);
  if (reverse) return `${reverse[1]}-${String(Number(reverse[2])).padStart(2, '0')}`;

  const named = competenceFromMonthName(text);
  if (named) return named;

  const fromFile = competenceFromFileName(fileName);
  if (fromFile) return fromFile;

  const compact = text.match(/(?:^|\D)(20\d{2})(0[1-9]|1[0-2])(?:\D|$)/);
  if (compact) return `${compact[1]}-${compact[2]}`;

  const fallback = text.match(/\b(0?[1-9]|1[0-2])[\/.\-](20\d{2})\b/);
  return fallback ? `${fallback[2]}-${String(Number(fallback[1])).padStart(2, '0')}` : undefined;
}

function findHeaderX(rows: Row[], terms: string[]): number | null {
  for (const row of rows) {
    const token = row.tokens.find((item) => terms.some((term) => normalize(item.text).includes(term)));
    if (token) return token.x;
  }
  return null;
}

function summaries(rows: Row[]) {
  let earnings = 0;
  let deductions = 0;
  let net = 0;
  let salaryBase = 0;

  rows.forEach((row) => {
    const text = normalize(row.text);
    const values = moneyCells(row).map((cell) => cell.amount).filter((value) => value > 0);
    if (!values.length) return;

    const earningsLabel = /total (?:de )?(?:vencimentos|proventos|creditos)/.test(text);
    const deductionsLabel = /total (?:de )?(?:descontos|debitos)/.test(text);
    if (earningsLabel && deductionsLabel && values.length >= 2) {
      earnings = values[values.length - 2];
      deductions = values[values.length - 1];
    } else {
      if (earningsLabel) earnings = values[values.length - 1];
      if (deductionsLabel) deductions = values[values.length - 1];
    }
    if (/(liquido a receber|valor liquido|salario liquido|total liquido)/.test(text)) net = values[values.length - 1];
    if (/(salario base|base salarial)/.test(text)) salaryBase = values[values.length - 1];
  });

  return { earnings, deductions, net, salaryBase };
}

function category(description: string): PayrollItemCategory {
  const text = normalize(description);
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

function classify(textValue: string, amountX: number, earningX: number | null, deductionX: number | null) {
  const text = normalize(textValue);
  const hasDeduction = DEDUCTION_TERMS.some((term) => text.includes(term));
  const hasEarning = EARNING_TERMS.some((term) => text.includes(term));
  const hasBenefit = BENEFIT_TERMS.some((term) => text.includes(term));

  if (hasDeduction) return { kind: 'deduction' as const, confidence: 0.96 };
  if (earningX !== null && deductionX !== null) {
    const earningDistance = Math.abs(amountX - earningX);
    const deductionDistance = Math.abs(amountX - deductionX);
    if (deductionDistance + 8 < earningDistance) return { kind: 'deduction' as const, confidence: 0.84 };
    if (earningDistance + 8 < deductionDistance) {
      return { kind: hasBenefit ? 'benefit' as const : 'earning' as const, confidence: hasEarning || hasBenefit ? 0.94 : 0.8 };
    }
  }
  if (hasBenefit) return { kind: 'benefit' as const, confidence: 0.85 };
  if (hasEarning) return { kind: 'earning' as const, confidence: 0.93 };
  return null;
}

function isMetadataDescription(description: string): boolean {
  const text = normalize(description);
  if (!text) return true;
  if (SUMMARY_TERMS.some((term) => text.includes(term))) return true;
  if (/cpf|cnpj|matricula|admissao|banco|agencia|conta|cargo|funcao|empresa|empregador/.test(text)) return true;
  if (/\b\d{1,3}\/\d{4}-\d{2}\b/.test(text)) return true;
  if (/\b(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\/?20\d{2}\b/.test(text) && /\d/.test(text)) return true;
  return false;
}

function itemRows(rows: Row[], grossHint: number): PayrollItem[] {
  const earningX = findHeaderX(rows, ['vencimento', 'provento', 'credito']);
  const deductionX = findHeaderX(rows, ['desconto', 'debito']);
  const seen = new Set<string>();
  const result: PayrollItem[] = [];

  rows.forEach((row) => {
    const normalized = normalize(row.text);
    if (SUMMARY_TERMS.some((term) => normalized.includes(term))) return;
    if (/codigo.*descricao|descricao.*referencia|demonstrativo de pagamento|recibo de pagamento/.test(normalized)) return;

    const cells = moneyCells(row).filter((cell) => cell.amount > 0);
    if (!cells.length) return;
    const amountCell = cells[cells.length - 1];
    const inferred = classify(row.text, amountCell.x, earningX, deductionX);
    if (!inferred) return;

    let description = row.text;
    cells.forEach((cell) => { description = description.replace(cell.raw, ' '); });
    description = description.replace(/\b\d{1,3}(?:[.,]\d{1,4})?\s*%\b/g, ' ').replace(/\s+/g, ' ').trim();
    const codeMatch = description.match(/^([A-Z]?\d{1,6})\s+(.+)$/i);
    const code = codeMatch?.[1];
    if (codeMatch) description = codeMatch[2];
    description = description.replace(/^[-–—.:\s]+|[-–—.:\s]+$/g, '').trim();
    if (/^\*+$/.test(description.replace(/\s/g, ''))) description = 'Rubrica não identificada';

    if (description.length < 2 || isMetadataDescription(description)) return;
    const amount = round(amountCell.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) return;

    const key = `${row.page}:${normalize(description)}:${amount}:${inferred.kind}`;
    if (seen.has(key)) return;
    seen.add(key);

    result.push({
      id: `pdf-${row.page}-${result.length + 1}`,
      code,
      description,
      kind: inferred.kind,
      category: category(description),
      amount,
      percentage: grossHint > 0 ? round((amount / grossHint) * 100) : 0,
      reference: row.text.match(/\b\d{1,3}(?:[.,]\d{1,4})?\s*%\b/)?.[0],
      source: 'pdf',
      confidence: description === 'Rubrica não identificada' ? 0.35 : inferred.confidence,
    });
  });

  return result;
}

export async function analyzePayrollPdf(file: File, onProgress?: (progress: number) => void): Promise<PayrollPdfAnalysis> {
  if (!file || (!(file.type === 'application/pdf') && !file.name.toLowerCase().endsWith('.pdf'))) {
    throw new Error('Selecione um arquivo PDF de holerite.');
  }
  if (file.size > 20 * 1024 * 1024) throw new Error('O PDF deve ter no máximo 20 MB.');

  const document = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const tokens: Token[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    (content.items as any[]).forEach((item) => {
      const text = String(item.str || '').trim();
      if (!text) return;
      tokens.push({
        text,
        x: Number(item.transform?.[4] || 0),
        y: Number(item.transform?.[5] || 0),
        page: pageNumber,
      });
    });
    onProgress?.(Math.round((pageNumber / document.numPages) * 100));
  }

  if (!tokens.length) {
    throw new Error('O PDF não possui texto pesquisável. Holerites escaneados ainda precisam ser preenchidos manualmente.');
  }

  const rows = groupRows(tokens);
  const summary = summaries(rows);
  let grossSalary = summary.earnings || summary.salaryBase;
  let items = itemRows(rows, grossSalary);
  const earningsFromItems = round(items.filter((item) => item.kind === 'earning').reduce((sum, item) => sum + item.amount, 0));
  const deductionsFromItems = round(items.filter((item) => item.kind === 'deduction').reduce((sum, item) => sum + item.amount, 0));
  const benefits = round(items.filter((item) => item.kind === 'benefit').reduce((sum, item) => sum + item.amount, 0));

  if (grossSalary <= 0) grossSalary = earningsFromItems;
  items = items.map((item) => ({ ...item, percentage: grossSalary > 0 ? round((item.amount / grossSalary) * 100) : 0 }));

  const totalEarnings = summary.earnings || earningsFromItems || grossSalary;
  const totalDeductions = summary.deductions || deductionsFromItems;
  const netSalary = summary.net || Math.max(0, round(grossSalary - totalDeductions));
  const competence = detectCompetence(rows, file.name);
  const warnings: string[] = [];

  if (!competence) warnings.push('A competência não foi identificada; confirme o mês antes de salvar.');
  if (grossSalary <= 0) warnings.push('O salário bruto não foi identificado; informe-o manualmente.');
  if (!items.length) warnings.push('Nenhuma rubrica foi reconhecida; adicione os descontos e benefícios manualmente.');
  if (summary.deductions > 0 && deductionsFromItems > 0 && Math.abs(summary.deductions - deductionsFromItems) > 1) {
    warnings.push('A soma das rubricas reconhecidas difere do total de descontos do PDF. Revise as linhas antes de salvar.');
  }
  if (summary.net > 0 && grossSalary > 0 && Math.abs(summary.net - Math.max(0, grossSalary - deductionsFromItems)) > 1) {
    warnings.push('O líquido informado no PDF difere da soma das rubricas reconhecidas.');
  }

  return {
    competence,
    grossSalary: round(grossSalary),
    totalEarnings: round(totalEarnings),
    totalDeductions: round(totalDeductions),
    netSalary: round(netSalary),
    benefits,
    items,
    warnings,
    pageCount: document.numPages,
    fileName: file.name,
  };
}
