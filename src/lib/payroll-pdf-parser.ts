import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

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

type PdfToken = {
  text: string;
  x: number;
  y: number;
  width: number;
  page: number;
};

type PdfRow = {
  text: string;
  tokens: PdfToken[];
  page: number;
};

type MoneyCell = {
  amount: number;
  raw: string;
  x: number;
};

const moneyPattern = /(?:R\$\s*)?\(?-?\d{1,3}(?:\.\d{3})*,\d{2}\)?-?|(?:R\$\s*)?\(?-?\d+\.\d{2}\)?-?/g;

const deductionWords = [
  'inss', 'irrf', 'imposto de renda', 'vale transporte', 'vt ', 'plano de saude',
  'assistencia medica', 'assistencia odontologica', 'odontologico', 'coparticipacao',
  'sindicato', 'contribuicao assistencial', 'emprestimo', 'consignado', 'adiantamento',
  'pensão', 'pensao', 'falta', 'faltas', 'atraso', 'seguro', 'convenio', 'desconto',
  'farmacia', 'mensalidade', 'refeicao descont', 'alimentacao descont', 'aviso previo',
];

const earningWords = [
  'salario', 'vencimento', 'ordenado', 'provento', 'hora extra', 'horas extras',
  'adicional', 'comissao', 'gratificacao', 'bonus', 'premio', 'dsr', 'ferias',
  'decimo terceiro', '13 salario', 'abono', 'saldo de salario', 'insalubridade',
  'periculosidade', 'noturno', 'auxilio pago', 'diaria', 'produtividade',
];

const benefitWords = [
  'vale alimentacao', 'vale refeicao', 'ticket', 'auxilio alimentacao', 'auxilio refeicao',
  'cesta basica', 'beneficio', 'vr', 'va', 'plano de saude empresa', 'auxilio creche',
  'auxilio combustivel', 'vale combustivel',
];

const summaryWords = [
  'total de vencimentos', 'total vencimentos', 'total de proventos', 'total proventos',
  'total de descontos', 'total descontos', 'liquido a receber', 'valor liquido',
  'salario liquido', 'base inss', 'base irrf', 'base fgts', 'fgts do mes',
  'salario base', 'total bruto', 'total liquido',
];

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseMoney(raw: string): number {
  const trimmed = raw.trim();
  const negative = trimmed.startsWith('-') || trimmed.endsWith('-') || /^\(.*\)$/.test(trimmed);
  const cleaned = trimmed
    .replace(/R\$/gi, '')
    .replace(/[()\s-]/g, '')
    .replace(/[^\d.,]/g, '');

  if (!cleaned) return 0;
  let normalized = cleaned;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    normalized = cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.replace(/,/g, '');
  } else if (cleaned.includes(',')) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) return 0;
  return roundMoney(negative ? -Math.abs(value) : value);
}

function tokenMoney(token: PdfToken): MoneyCell | null {
  const match = token.text.trim().match(/^(?:R\$\s*)?\(?-?\d{1,3}(?:\.\d{3})*,\d{2}\)?-?$|^(?:R\$\s*)?\(?-?\d+\.\d{2}\)?-?$/);
  if (!match) return null;
  return { amount: Math.abs(parseMoney(match[0])), raw: match[0], x: token.x };
}

function rowMoneyCells(row: PdfRow): MoneyCell[] {
  const cells = row.tokens.map(tokenMoney).filter((cell): cell is MoneyCell => Boolean(cell));
  if (cells.length > 0) return cells;

  return Array.from(row.text.matchAll(moneyPattern)).map((match, index) => ({
    amount: Math.abs(parseMoney(match[0])),
    raw: match[0],
    x: index * 100,
  }));
}

function groupRows(tokens: PdfToken[]): PdfRow[] {
  const grouped = new Map<string, PdfToken[]>();
  for (const token of tokens) {
    const yBucket = Math.round(token.y / 2.5) * 2.5;
    const key = `${token.page}:${yBucket}`;
    const current = grouped.get(key) || [];
    current.push(token);
    grouped.set(key, current);
  }

  return Array.from(grouped.values())
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

function findColumnX(rows: PdfRow[], terms: string[]): number | null {
  for (const row of rows) {
    for (const token of row.tokens) {
      const normalized = normalize(token.text);
      if (terms.some((term) => normalized.includes(term))) return token.x;
    }
  }
  return null;
}

function detectCompetence(rows: PdfRow[]): string | undefined {
  const all = normalize(rows.map((row) => row.text).join(' '));
  const labeled = all.match(/(?:competencia|referencia|mes\/ano|periodo|folha)\D{0,30}(0?[1-9]|1[0-2])[\/.\-](20\d{2})/);
  if (labeled) return `${labeled[2]}-${String(Number(labeled[1])).padStart(2, '0')}`;

  const reversed = all.match(/(?:competencia|referencia|mes\/ano|periodo|folha)\D{0,30}(20\d{2})[\/.\-](0?[1-9]|1[0-2])/);
  if (reversed) return `${reversed[1]}-${String(Number(reversed[2])).padStart(2, '0')}`;

  const monthYear = all.match(/\b(0?[1-9]|1[0-2])[\/.\-](20\d{2})\b/);
  if (monthYear) return `${monthYear[2]}-${String(Number(monthYear[1])).padStart(2, '0')}`;
  return undefined;
}

function lastAmount(row: PdfRow): number {
  const cells = rowMoneyCells(row);
  return cells.length ? cells[cells.length - 1].amount : 0;
}

function detectSummaries(rows: PdfRow[]) {
  let totalEarnings = 0;
  let totalDeductions = 0;
  let netSalary = 0;
  let salaryBase = 0;

  for (const row of rows) {
    const text = normalize(row.text);
    const amounts = rowMoneyCells(row).map((cell) => cell.amount).filter((amount) => amount > 0);
    if (amounts.length === 0) continue;

    const hasEarningsTotal = /total (?:de )?(?:vencimentos|proventos|creditos)/.test(text);
    const hasDeductionsTotal = /total (?:de )?(?:descontos|debitos)/.test(text);

    if (hasEarningsTotal && hasDeductionsTotal && amounts.length >= 2) {
      totalEarnings = amounts[amounts.length - 2];
      totalDeductions = amounts[amounts.length - 1];
      continue;
    }
    if (hasEarningsTotal) totalEarnings = amounts[amounts.length - 1];
    if (hasDeductionsTotal) totalDeductions = amounts[amounts.length - 1];
    if (/(liquido a receber|valor liquido|salario liquido|total liquido)/.test(text)) netSalary = amounts[amounts.length - 1];
    if (/(salario base|base salarial)/.test(text)) salaryBase = amounts[amounts.length - 1];
  }

  return { totalEarnings, totalDeductions, netSalary, salaryBase };
}

function categoryFor(description: string): PayrollItemCategory {
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

function classifyRow(textValue: string, amountX: number, earningX: number | null, deductionX: number | null): { kind: PayrollItemKind; confidence: number } | null {
  const text = normalize(textValue);
  const hasDeduction = deductionWords.some((word) => text.includes(normalize(word)));
  const hasEarning = earningWords.some((word) => text.includes(normalize(word)));
  const hasBenefit = benefitWords.some((word) => text.includes(normalize(word));

  if (hasDeduction) return { kind: 'deduction', confidence: 0.96 };

  if (earningX !== null && deductionX !== null) {
    const earningDistance = Math.abs(amountX - earningX);
    const deductionDistance = Math.abs(amountX - deductionX);
    if (deductionDistance + 8 < earningDistance) return { kind: 'deduction', confidence: hasBenefit ? 0.92 : 0.82 };
    if (earningDistance + 8 < deductionDistance) {
      if (hasBenefit) return { kind: 'benefit', confidence: 0.86 };
      return { kind: 'earning', confidence: hasEarning ? 0.96 : 0.8 };
    }
  }

  if (hasBenefit) return { kind: 'benefit', confidence: 0.84 };
  if (hasEarning) return { kind: 'earning', confidence: 0.93 };
  return null;
}

function cleanDescription(row: PdfRow, moneyCells: MoneyCell[]): { code?: string; description: string; reference?: string } {
  let text = row.text;
  for (const cell of moneyCells) text = text.replace(cell.raw, ' ');
  text = text.replace(/\b\d{1,3}(?:[.,]\d{1,4})?\s*%\b/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();

  const codeMatch = text.match(/^([A-Z]?\d{1,6})\s+(.+)$/i);
  const code = codeMatch?.[1];
  if (codeMatch) text = codeMatch[2];

  const referenceMatch = row.text.match(/\b\d{1,3}(?:[.,]\d{1,4})?\s*%\b/);
  const description = text.replace(/^[-–—.:\s]+|[-–—.:\s]+$/g, '').trim();
  return { code, description, reference: referenceMatch?.[0] };
}

function buildItems(rows: PdfRow[], grossHint: number): PayrollItem[] {
  const earningX = findColumnX(rows, ['vencimento', 'provento', 'credito']);
  const deductionX = findColumnX(rows, ['desconto', 'debito']);
  const items: PayrollItem[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const text = normalize(row.text);
    if (summaryWords.some((word) => text.includes(word))) continue;
    if (/codigo.*descricao|descricao.*referencia|demonstrativo de pagamento|recibo de pagamento/.test(text)) continue;

    const cells = rowMoneyCells(row).filter((cell) => cell.amount > 0);
    if (cells.length === 0) continue;
    const amountCell = cells[cells.length - 1];
    const classification = classifyRow(row.text, amountCell.x, earningX, deductionX);
    if (!classification) continue;

    const cleaned = cleanDescription(row, cells);
    if (!cleaned.description || cleaned.description.length < 2) continue;
    if (/cpf|cnpj|matricula|admissao|banco|agencia|conta|cargo|funcao/.test(normalize(cleaned.description))) continue;

    const amount = roundMoney(amountCell.amount);
    const key = `${row.page}:${normalize(cleaned.description)}:${amount}:${classification.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);

    items.push({
      id: `pdf-${row.page}-${items.length + 1}`,
      code: cleaned.code,
      description: cleaned.description,
      kind: classification.kind,
      category: categoryFor(cleaned.description),
      amount,
      percentage: grossHint > 0 ? roundMoney((amount / grossHint) * 100) : 0,
      reference: cleaned.reference,
      source: 'pdf',
      confidence: classification.confidence,
    });
  }

  return items;
}

function normalizeItemPercentages(items: PayrollItem[], grossSalary: number): PayrollItem[] {
  return items.map((item) => ({
    ...item,
    percentage: grossSalary > 0 ? roundMoney((item.amount / grossSalary) * 100) : 0,
  }));
}

export async function analyzePayrollPdf(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<PayrollPdfAnalysis> {
  if (!file || file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    throw new Error('Selecione um arquivo PDF de holerite.');
  }
  if (file.size > 20 * 1024 * 1024) throw new Error('O PDF deve ter no máximo 20 MB.');

  const bytes = await file.arrayBuffer();
  const document = await pdfjs.getDocument({ data: bytes }).promise;
  const tokens: PdfToken[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    for (const rawItem of content.items as any[]) {
      const text = String(rawItem.str || '').trim();
      if (!text) continue;
      tokens.push({
        text,
        x: Number(rawItem.transform?.[4] || 0),
        y: Number(rawItem.transform?.[5] || 0),
        width: Number(rawItem.width || 0),
        page: pageNumber,
      });
    }
    onProgress?.(Math.round((pageNumber / document.numPages) * 100));
  }

  if (tokens.length === 0) {
    throw new Error('O PDF não possui texto pesquisável. Holerites escaneados precisam de OCR e ainda não são aceitos automaticamente.');
  }

  const rows = groupRows(tokens);
  const summary = detectSummaries(rows);
  let grossSalary = summary.totalEarnings || summary.salaryBase;
  let items = buildItems(rows, grossSalary);

  const earningsFromItems = roundMoney(items.filter((item) => item.kind === 'earning').reduce((sum, item) => sum + item.amount, 0));
  const deductionsFromItems = roundMoney(items.filter((item) => item.kind === 'deduction').reduce((sum, item) => sum + item.amount, 0));
  const benefits = roundMoney(items.filter((item) => item.kind === 'benefit').reduce((sum, item) => sum + item.amount, 0));

  if (grossSalary <= 0) grossSalary = earningsFromItems;
  items = normalizeItemPercentages(items, grossSalary);

  const totalEarnings = summary.totalEarnings || earningsFromItems || grossSalary;
  const totalDeductions = summary.totalDeductions || deductionsFromItems;
  const netSalary = summary.netSalary || Math.max(0, roundMoney(grossSalary - totalDeductions));
  const warnings: string[] = [];

  if (!detectCompetence(rows)) warnings.push('A competência não foi identificada; confirme o mês antes de salvar.');
  if (grossSalary <= 0) warnings.push('O salário bruto não foi identificado; informe-o manualmente.');
  if (items.length === 0) warnings.push('Nenhuma rubrica foi reconhecida; adicione os descontos e benefícios manualmente.');
  if (summary.totalDeductions > 0 && deductionsFromItems > 0 && Math.abs(summary.totalDeductions - deductionsFromItems) > 1) {
    warnings.push('A soma das rubricas reconhecidas difere do total de descontos do PDF. Revise as linhas antes de salvar.');
  }
  if (summary.netSalary > 0 && grossSalary > 0 && Math.abs(summary.netSalary - (grossSalary - totalDeductions)) > 1) {
    warnings.push('O líquido do PDF não coincide com bruto menos descontos; podem existir proventos ou bases não reconhecidas.');
  }

  return {
    competence: detectCompetence(rows),
    grossSalary: roundMoney(grossSalary),
    totalEarnings: roundMoney(totalEarnings),
    totalDeductions: roundMoney(totalDeductions),
    netSalary: roundMoney(netSalary),
    benefits,
    items,
    warnings,
    pageCount: document.numPages,
    fileName: file.name,
  };
}
