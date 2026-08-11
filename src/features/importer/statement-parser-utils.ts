import { identifyCompany } from '../../lib/company-aliases';

export function normalizeStatementHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function parseDelimitedLine(line: string, delimiter: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  const quote = String.fromCharCode(34);

  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    const nextChar = line[index + 1];
    if (char === quote) {
      if (inQuotes && nextChar === quote) {
        current += quote;
        index++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

export function detectDelimiter(line: string): string {
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestCount = -1;
  for (const candidate of candidates) {
    const count = line.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

function scoreHeader(cells: string[]): number {
  const keys = [
    'data', 'date', 'dtposted', 'descricao', 'historico', 'memo', 'description',
    'transactiondescription', 'transactiondetails', 'valor', 'amount', 'transactionamount',
    'transactionnetamount', 'debito', 'credito', 'categoria', 'category', 'type', 'tipo',
  ];
  return cells.reduce(
    (sum, cell) => sum + (keys.some((key) => cell.includes(normalizeStatementHeader(key))) ? 1 : 0),
    0,
  );
}

export function findKnownTransactionHeader(lines: string[]): { index: number; delimiter: string } | null {
  for (let index = 0; index < lines.length; index++) {
    const delimiter = detectDelimiter(lines[index]);
    const columns = parseDelimitedLine(lines[index], delimiter).map(normalizeStatementHeader);
    const hasReleaseDate = columns.includes('releasedate');
    const hasType = columns.includes('transactiontype');
    const hasNetAmount = columns.includes('transactionnetamount') || columns.includes('transactionamount');
    if (hasReleaseDate && hasType && hasNetAmount) return { index, delimiter };
  }
  return null;
}

export function findBestHeader(lines: string[]): { index: number; delimiter: string; score: number } {
  const known = findKnownTransactionHeader(lines);
  if (known) return { ...known, score: 99 };

  let index = -1;
  let delimiter = detectDelimiter(lines[0] || '');
  let score = 0;
  const probeCount = Math.min(lines.length, 30);
  for (let currentIndex = 0; currentIndex < probeCount; currentIndex++) {
    const currentDelimiter = detectDelimiter(lines[currentIndex]);
    const cells = parseDelimitedLine(lines[currentIndex], currentDelimiter)
      .map(normalizeStatementHeader)
      .filter(Boolean);
    const currentScore = scoreHeader(cells);
    if (currentScore > score) {
      index = currentIndex;
      delimiter = currentDelimiter;
      score = currentScore;
    }
  }
  return { index, delimiter, score };
}

export function parseStatementAmount(raw: string | undefined): number {
  if (!raw) return 0;
  const trimmed = raw.trim();
  const isNegative = /^\(.*\)$/.test(trimmed) || trimmed.endsWith('-');
  const cleaned = trimmed
    .replace(/\s/g, '')
    .replace(/R\$/gi, '')
    .replace(/[^\d,.-]/g, '');
  if (!cleaned) return 0;

  if (cleaned.includes(',') && cleaned.includes('.')) {
    const brazilian = cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.');
    const normalized = brazilian
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.replace(/,/g, '');
    const value = Number(normalized);
    if (!Number.isFinite(value)) return 0;
    return isNegative ? -Math.abs(value) : value;
  }

  if (cleaned.includes(',')) {
    const value = Number(cleaned.replace(',', '.'));
    if (!Number.isFinite(value)) return 0;
    return isNegative ? -Math.abs(value) : value;
  }

  const value = Number(cleaned);
  if (!Number.isFinite(value)) return 0;
  return isNegative ? -Math.abs(value) : value;
}

export function parseStatementDate(raw: string | undefined, fallback = new Date()): string {
  if (!raw) return fallback.toISOString();
  const value = raw.trim();
  const stableIso = (year: number, month: number, day: number) =>
    new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).toISOString();

  const br = value.match(/^(\d{2})[./-](\d{2})[./-](\d{2,4})$/);
  if (br) {
    const year = Number(br[3].length === 2 ? `20${br[3]}` : br[3]);
    return stableIso(year, Number(br[2]), Number(br[1]));
  }

  const isoDateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateOnly) return stableIso(Number(isoDateOnly[1]), Number(isoDateOnly[2]), Number(isoDateOnly[3]));

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback.toISOString() : parsed.toISOString();
}

export function looksLikeDate(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim();
  return /^\d{2}[/-]\d{2}[/-]\d{2,4}$/.test(normalized) || /^\d{4}-\d{2}-\d{2}/.test(normalized);
}

export function looksLikeAmount(value: string | undefined): boolean {
  return Boolean(value && /[-+]?\s*R?\$?\s*[\d.,]+/.test(value));
}

export function looksLikeText(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim();
  return Boolean(normalized && !looksLikeDate(normalized) && !looksLikeAmount(normalized) && /[a-zA-Z]/.test(normalized));
}

export function pickStatementDescription(columns: string[], descriptionIndex: number): string {
  const direct = (descriptionIndex >= 0 ? columns[descriptionIndex] : '').trim();
  if (direct) return direct;
  return columns
    .map((value) => value?.trim() || '')
    .filter(looksLikeText)
    .sort((a, b) => b.length - a.length)[0] || 'Sem descricao';
}

export function pickStatementAmount(
  columns: string[],
  amountIndex: number,
  debitIndex: number,
  creditIndex: number,
): number {
  const debit = debitIndex >= 0 ? Math.abs(parseStatementAmount(columns[debitIndex])) : 0;
  const credit = creditIndex >= 0 ? Math.abs(parseStatementAmount(columns[creditIndex])) : 0;
  if (debit > 0 || credit > 0) return credit - debit;

  const explicitAmount = amountIndex >= 0 ? parseStatementAmount(columns[amountIndex]) : 0;
  const maxReasonableTransaction = 1_000_000;
  if (Math.abs(explicitAmount) > 0 && Math.abs(explicitAmount) <= maxReasonableTransaction) return explicitAmount;
  if (amountIndex >= 0) return 0;

  return columns
    .map(parseStatementAmount)
    .filter((value) => Math.abs(value) > 0 && Math.abs(value) <= maxReasonableTransaction)
    .sort((a, b) => Math.abs(a) - Math.abs(b))[0] || 0;
}

export function inferColumnByRatio(
  rows: string[][],
  predicate: (value: string | undefined) => boolean,
  minRatio = 0.45,
): number {
  const maxColumns = rows.reduce((max, row) => Math.max(max, row.length), 0);
  let bestIndex = -1;
  let bestRatio = 0;
  for (let column = 0; column < maxColumns; column++) {
    let hits = 0;
    let total = 0;
    for (const row of rows) {
      const value = row[column];
      if (value === undefined || value.trim() === '') continue;
      total++;
      if (predicate(value)) hits++;
    }
    const ratio = total ? hits / total : 0;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestIndex = column;
    }
  }
  return bestRatio >= minRatio ? bestIndex : -1;
}

export function inferStatementCategory(description: string, type: 'income' | 'expense'): string {
  const identified = identifyCompany(description);
  if (identified) {
    const categories: Record<string, string> = {
      internet_telefonia: 'Contas Fixas', agua_saneamento: 'Contas Fixas', energia_eletrica: 'Contas Fixas',
      bancos_financeiras: 'Geral', emprestimos_acordos: 'Geral', alimentacao: 'Alimentação',
      transporte: 'Transporte', saude: 'Saúde', lazer: 'Lazer', educacao: 'Educação',
    };
    return categories[identified.category] || 'Geral';
  }

  const text = normalizeStatementHeader(description);
  if (type === 'income') {
    if (/(salario|pagamento|folha|remunera|provento|vencimento)/.test(text)) return 'Salário';
    if (/(vr|va|ticket|alimentacao|refeicao|beneficio|auxilio)/.test(text)) return 'Benefícios';
    if (/(rendimento|juros|aplicacao|poupanca|cdb|selic|resgate)/.test(text)) return 'Rendimentos';
    if (/(pix|ted|doc|transferencia|recebido|enviado)/.test(text)) return 'Transferência';
    return 'Geral';
  }

  if (/(uber|99|taxi|combustivel|posto|ipiranga|shell|estacionamento|shellbox)/.test(text)) return 'Transporte';
  if (/(mercado|supermercado|ifood|restaurante|padaria|food|acougue|fast|pizza|burger)/.test(text)) return 'Alimentação';
  if (/(farmacia|hospital|clinica|medic|droga|saude)/.test(text)) return 'Saúde';
  if (/(netflix|spotify|cinema|stream|show|lazer|ingresso|tour|viagem)/.test(text)) return 'Lazer';
  if (/(aluguel|condominio|energia|agua|internet|telefone|vivo|claro|tim|oito|luz|cpfl|enel)/.test(text)) return 'Contas Fixas';
  if (/(escola|faculdade|curso|livros|estudo|educa)/.test(text)) return 'Educação';
  return 'Geral';
}

export function generateTransactionId(prefix: string, index: number): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${index}`;
}
