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

  return undefined;
}

function classifyCategory(description: string, kind: PayrollItemKind): PayrollItemCategory {
  const text = normalize(description);
  if (/\binss\b|previdencia/.test(text)) return 'inss';
  if (/\birrf\b|imposto de renda/.test(text)) return 'irrf';
  if (/vale transporte|\bvt\b|transporte/.test(text)) return 'transport';
  if (/saude|medic|odont|farmacia|coparticipacao/.test(text)) return 'health';
  if (/alimentacao|refeicao|ticket|cesta|\bvr\b|\bva\b/.test(text)) return 'food';
  if (/emprestimo|consignado|financiamento/.test(text)) return 'loan';
  if (/falta|atraso|ausencia/.test(text)) return 'absence';
  if (/salario|vencimento|ordenado/.test(text)) return 'salary';
  return kind === 'earning' ? 'salary' : 'other';
}

function classifyKind(description: string, amount: number, rowText: string): PayrollItemKind {
  const text = normalize(`${description} ${rowText}`);
  if (BENEFIT_TERMS.some((term) => text.includes(term))) return 'benefit';
  if (DEDUCTION_TERMS.some((term) => text.includes(term))) return 'deduction';
  if (EARNING_TERMS.some((term) => text.includes(term))) return 'earning';
  return amount < 0 ? 'deduction' : 'earning';
}

function isSummaryRow(row: Row): boolean {
  const text = normalize(row.text);
  return SUMMARY_TERMS.some((term) => text.includes(term));
}

function descriptionFromRow(row: Row, money: MoneyCell): string {
  const before = row.tokens
    .filter((token) => token.x < money.x - 4)
    .map((token) => token.text.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const fallback = row.text.replace(money.raw, '').replace(/\s+/g, ' ').trim();
  return before || fallback || 'Rubrica não identificada';
}

function itemId(page: number, index: number, description: string): string {
  const compact = normalize(description).replace(/[^a-z0-9]/g, '').slice(0, 22) || 'item';
  return `pdf-${page}-${index}-${compact}`;
}

function likelyItemRow(row: Row): boolean {
  if (isSummaryRow(row)) return false;
  const text = normalize(row.text);
  if (text.length < 4) return false;
  if (/^(?:nome|cpf|matricula|empresa|cnpj|cargo|funcao|admissao|banco|agencia|conta)\b/.test(text)) return false;
  return moneyCells(row).length > 0;
}

function inferTotals(rows: Row[], items: PayrollItem[]) {
  const totalEarnings = round(items.filter((item) => item.kind === 'earning').reduce((sum, item) => sum + item.amount, 0));
  const totalDeductions = round(items.filter((item) => item.kind === 'deduction').reduce((sum, item) => sum + item.amount, 0));
  const benefits = round(items.filter((item) => item.kind === 'benefit').reduce((sum, item) => sum + item.amount, 0));

  const summaryText = rows.map((row) => normalize(row.text)).join('\n');
  const summaryValue = (patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const match = summaryText.match(pattern);
      if (match?.[1]) return Math.abs(parseAmount(match[1]));
    }
    return 0;
  };

  const grossSalary = summaryValue([
    /total\s+(?:de\s+)?(?:vencimentos|proventos|bruto)[^\d]{0,30}([\d.,]+)/,
    /salario\s+bruto[^\d]{0,30}([\d.,]+)/,
  ]) || totalEarnings;
  const explicitDeductions = summaryValue([
    /total\s+(?:de\s+)?descontos[^\d]{0,30}([\d.,]+)/,
    /descontos\s+total[^\d]{0,30}([\d.,]+)/,
  ]);
  const totalDeductionsValue = explicitDeductions || totalDeductions;
  const netSalary = summaryValue([
    /(?:liquido\s+a\s+receber|valor\s+liquido|salario\s+liquido|valor\s+a\s+receber)[^\d]{0,30}([\d.,]+)/,
  ]) || Math.max(0, round(grossSalary - totalDeductionsValue));

  return {
    grossSalary: round(grossSalary),
    totalEarnings,
    totalDeductions: round(totalDeductionsValue),
    netSalary: round(netSalary),
    benefits,
  };
}

export async function analyzePayrollPdf(file: File): Promise<PayrollPdfAnalysis> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  const tokens: Token[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    content.items.forEach((item: any) => {
      if (!item?.str?.trim()) return;
      const transform = item.transform || [];
      tokens.push({
        text: String(item.str),
        x: Number(transform[4] || 0),
        y: Number(transform[5] || 0),
        page: pageNumber,
      });
    });
  }

  const rows = groupRows(tokens);
  const items: PayrollItem[] = [];
  rows.filter(likelyItemRow).forEach((row, rowIndex) => {
    const cells = moneyCells(row);
    if (!cells.length) return;
    const money = cells[cells.length - 1];
    const description = descriptionFromRow(row, money);
    if (!description) return;
    const kind = classifyKind(description, money.amount, row.text);
    const amount = Math.abs(money.amount);
    if (!amount) return;
    items.push({
      id: itemId(row.page, rowIndex, description),
      description,
      kind,
      category: classifyCategory(description, kind),
      amount,
      percentage: 0,
      source: 'pdf',
      confidence: 0.82,
    });
  });

  const totals = inferTotals(rows, items);
  const grossForPercentage = totals.grossSalary || totals.totalEarnings;
  items.forEach((item) => {
    item.percentage = grossForPercentage > 0 ? round((item.amount / grossForPercentage) * 100) : 0;
  });

  const warnings: string[] = [];
  if (!tokens.length) warnings.push('Não foi possível encontrar texto selecionável neste PDF.');
  if (!items.length) warnings.push('Não foi possível identificar rubricas financeiras automaticamente.');
  if (!totals.grossSalary) warnings.push('Salário bruto não identificado; confira os dados manualmente.');
  if (!totals.netSalary) warnings.push('Salário líquido não identificado; confira os dados manualmente.');

  return {
    competence: detectCompetence(rows, file.name),
    grossSalary: totals.grossSalary,
    totalEarnings: totals.totalEarnings,
    totalDeductions: totals.totalDeductions,
    netSalary: totals.netSalary,
    benefits: totals.benefits,
    items,
    warnings,
    pageCount: pdf.numPages,
    fileName: file.name,
  };
}
