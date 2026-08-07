import * as XLSX from 'xlsx';

type Cell = string | number | boolean | Date | null | undefined;
type Row = Cell[];
type Direction = 'income' | 'expense' | 'unknown';

interface BankProfile {
  id: 'nubank' | 'inter' | 'santander' | 'bradesco' | 'mercadopago' | 'c6bank' | 'generic';
  label: string;
  hints: string[];
  date: string[];
  description: string[];
  document: string[];
  credit: string[];
  debit: string[];
  amount: string[];
  balance: string[];
  type: string[];
}

interface HeaderMatch {
  profile: BankProfile;
  rowIndex: number;
  score: number;
  date: number;
  description: number;
  document: number;
  credit: number;
  debit: number;
  amount: number;
  balance: number;
  type: number;
}

const MAX_TRANSACTION_VALUE = 100_000_000;

const COMMON_DATE = ['data', 'date', 'datalancamento', 'datamovimento', 'datatransacao', 'releasedate'];
const COMMON_DESCRIPTION = [
  'descricao',
  'historico',
  'lancamento',
  'movimento',
  'detalhes',
  'transacao',
  'estabelecimento',
  'transactiondescription',
  'transactiondetails',
  'transactiontype',
  'memo',
];
const COMMON_DOCUMENT = ['documento', 'docto', 'doc', 'identificador', 'referenceid', 'idtransacao', 'id'];
const COMMON_CREDIT = ['credito', 'creditos', 'entrada', 'entradas', 'credit', 'receivedamount'];
const COMMON_DEBIT = ['debito', 'debitos', 'saida', 'saidas', 'debit', 'paidamount'];
const COMMON_AMOUNT = [
  'valor',
  'valorrs',
  'valorlancamento',
  'valortransacao',
  'amount',
  'transactionamount',
  'transactionnetamount',
  'netamount',
];
const COMMON_BALANCE = ['saldo', 'saldors', 'saldoparcial', 'partialbalance', 'currentbalance', 'finalbalance'];
const COMMON_TYPE = ['tipo', 'natureza', 'type', 'transactiontype', 'operacao'];

const BANK_PROFILES: BankProfile[] = [
  {
    id: 'nubank',
    label: 'Nubank',
    hints: ['nubank', 'nu pagamentos', 'identificador', 'descricaodatransacao'],
    date: ['data', 'date'],
    description: ['descricao', 'descricaodatransacao', 'estabelecimento', 'titulo'],
    document: ['identificador', 'id'],
    credit: ['credito', 'entrada'],
    debit: ['debito', 'saida'],
    amount: ['valor', 'amount'],
    balance: ['saldo'],
    type: ['tipo', 'categoria'],
  },
  {
    id: 'inter',
    label: 'Banco Inter',
    hints: ['bancointer', 'intermedium', 'contadigitalinter', 'inter'],
    date: ['datalancamento', 'datamovimento', 'data'],
    description: ['historico', 'descricao', 'titulo', 'transacao'],
    document: ['documento', 'idtransacao', 'identificador'],
    credit: ['credito', 'entrada'],
    debit: ['debito', 'saida'],
    amount: ['valor', 'valorlancamento'],
    balance: ['saldo'],
    type: ['tipo', 'natureza'],
  },
  {
    id: 'santander',
    label: 'Santander',
    hints: ['santander', 'bancosantander', 'superlinha'],
    date: ['data', 'datalancamento', 'datamovimento'],
    description: ['historico', 'descricao', 'lancamento'],
    document: ['documento', 'docto', 'doc'],
    credit: ['credito', 'creditos', 'entrada'],
    debit: ['debito', 'debitos', 'saida'],
    amount: ['valor', 'valorrs', 'valorlancamento'],
    balance: ['saldo'],
    type: ['tipo', 'natureza'],
  },
  {
    id: 'bradesco',
    label: 'Bradesco',
    hints: ['bradesco', 'bancobradesco', 'bradescocelular'],
    date: ['data', 'datalancamento', 'datamovimento'],
    description: ['historico', 'lancamento', 'descricao', 'movimento'],
    document: ['docto', 'documento', 'doc', 'numero'],
    credit: ['credito', 'creditos', 'entrada'],
    debit: ['debito', 'debitos', 'saida'],
    amount: ['valor', 'valorlancto', 'valorlancamento'],
    balance: ['saldo', 'saldors'],
    type: ['tipo', 'natureza'],
  },
  {
    id: 'mercadopago',
    label: 'Mercado Pago',
    hints: ['mercadopago', 'mercadolivre', 'releasedate', 'referenceid', 'transactionnetamount'],
    date: ['releasedate', 'data', 'date'],
    description: ['transactiondescription', 'transactiondetails', 'description', 'transactiontype', 'descricao'],
    document: ['referenceid', 'identificador', 'id'],
    credit: ['credito', 'receivedamount', 'entrada'],
    debit: ['debito', 'paidamount', 'saida'],
    amount: ['transactionnetamount', 'transactionamount', 'netamount', 'valor'],
    balance: ['partialbalance', 'saldo'],
    type: ['transactiontype', 'tipo'],
  },
  {
    id: 'c6bank',
    label: 'C6 Bank',
    hints: ['c6bank', 'bancoc6', 'c6 conta'],
    date: ['data', 'datalancamento', 'datatransacao'],
    description: ['descricao', 'historico', 'lancamento', 'estabelecimento'],
    document: ['identificador', 'documento', 'idtransacao'],
    credit: ['credito', 'entrada'],
    debit: ['debito', 'saida'],
    amount: ['valor', 'valordatransacao', 'valortransacao'],
    balance: ['saldo'],
    type: ['tipo', 'natureza'],
  },
  {
    id: 'generic',
    label: 'Banco não identificado',
    hints: [],
    date: COMMON_DATE,
    description: COMMON_DESCRIPTION,
    document: COMMON_DOCUMENT,
    credit: COMMON_CREDIT,
    debit: COMMON_DEBIT,
    amount: COMMON_AMOUNT,
    balance: COMMON_BALANCE,
    type: COMMON_TYPE,
  },
];

function normalize(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function displayCell(value: Cell): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${String(value.getDate()).padStart(2, '0')}/${String(value.getMonth() + 1).padStart(2, '0')}/${value.getFullYear()}`;
  }
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function headerMatches(header: string, alias: string): boolean {
  const normalizedAlias = normalize(alias);
  if (!header || !normalizedAlias) return false;
  return header === normalizedAlias || header.startsWith(normalizedAlias) || normalizedAlias.startsWith(header);
}

function findColumn(headers: string[], aliases: string[]): number {
  return headers.findIndex((header) => aliases.some((alias) => headerMatches(header, alias)));
}

function parseExcelDate(value: Cell): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${String(value.getDate()).padStart(2, '0')}/${String(value.getMonth() + 1).padStart(2, '0')}/${value.getFullYear()}`;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed && parsed.y >= 2000 && parsed.y <= 2100) {
      return `${String(parsed.d).padStart(2, '0')}/${String(parsed.m).padStart(2, '0')}/${parsed.y}`;
    }
  }

  const text = displayCell(value);
  const match = text.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 2000 ||
    year > 2100 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

function parseMoney(value: Cell): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  const raw = displayCell(value);
  if (!raw) return 0;

  const normalizedText = normalize(raw);
  const negative =
    /^\(.*\)$/.test(raw) ||
    /-$/.test(raw) ||
    /(?:^|\s)d(?:\s|$)/i.test(raw) ||
    normalizedText.endsWith('debito');

  let cleaned = raw
    .replace(/R\$/gi, '')
    .replace(/\s+/g, '')
    .replace(/[A-Za-z]/g, '')
    .replace(/[^\d,().+-]/g, '')
    .replace(/[()]/g, '');

  if (!cleaned) return 0;

  let numberText = cleaned;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    numberText = cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.replace(/,/g, '');
  } else if (cleaned.includes(',')) {
    numberText = cleaned.replace(/\./g, '').replace(',', '.');
  }

  const parsed = Number(numberText);
  if (!Number.isFinite(parsed)) return 0;
  return negative ? -Math.abs(parsed) : parsed;
}

function inferDirection(value: Cell): Direction {
  const text = normalize(displayCell(value));
  if (!text) return 'unknown';

  if (
    /(credito|credit|entrada|recebido|recebimento|deposito|cashin|income|pixrecebido|rendimento)/.test(text)
  ) {
    return 'income';
  }

  if (
    /(debito|debit|saida|enviado|pagamento|compra|cashout|expense|pixenviado|saque|tarifa)/.test(text)
  ) {
    return 'expense';
  }

  return 'unknown';
}

function nearbyText(rows: Row[], rowIndex: number): string {
  const start = Math.max(0, rowIndex - 12);
  const end = Math.min(rows.length, rowIndex + 4);
  return normalize(rows.slice(start, end).flat().map(displayCell).join(' '));
}

function scoreProfile(rows: Row[], rowIndex: number, profile: BankProfile): HeaderMatch | null {
  const headers = rows[rowIndex].map((cell) => normalize(displayCell(cell)));
  const date = findColumn(headers, profile.date);
  const description = findColumn(headers, profile.description);
  const document = findColumn(headers, profile.document);
  const credit = findColumn(headers, profile.credit);
  const debit = findColumn(headers, profile.debit);
  const amount = findColumn(headers, profile.amount);
  const balance = findColumn(headers, profile.balance);
  const type = findColumn(headers, profile.type);

  if (date < 0 || description < 0 || (credit < 0 && debit < 0 && amount < 0)) return null;

  let score = 20;
  if (credit >= 0) score += 4;
  if (debit >= 0) score += 4;
  if (amount >= 0) score += 4;
  if (balance >= 0) score += 2;
  if (document >= 0) score += 2;
  if (type >= 0) score += 1;

  const context = nearbyText(rows, rowIndex);
  for (const hint of profile.hints) {
    if (context.includes(normalize(hint))) score += 8;
  }

  if (profile.id === 'generic') score -= 5;

  return {
    profile,
    rowIndex,
    score,
    date,
    description,
    document,
    credit,
    debit,
    amount,
    balance,
    type,
  };
}

function findBestHeader(rows: Row[]): HeaderMatch | null {
  let best: HeaderMatch | null = null;
  const limit = Math.min(rows.length, 80);

  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    for (const profile of BANK_PROFILES) {
      const candidate = scoreProfile(rows, rowIndex, profile);
      if (!candidate) continue;
      if (!best || candidate.score > best.score) best = candidate;
    }
  }

  return best;
}

function isNonTransactionDescription(description: string): boolean {
  const text = normalize(description);
  if (!text) return true;

  return (
    /^(saldo|total|subtotal|data|historico|descricao|lancamento|movimento|documento|credito|debito|valor)$/.test(text) ||
    text.includes('saldoanterior') ||
    text.includes('saldodisponivel') ||
    text.includes('saldofinal') ||
    text.includes('saldototal') ||
    text.includes('totaldecreditos') ||
    text.includes('totaldedebitos') ||
    text.includes('extratoinexistente') ||
    text.includes('ultimoslancamentos') ||
    text.includes('resumodaconta') ||
    text.includes('agenciaeconta') ||
    text.includes('periododoextrato') ||
    text.includes('dadosdocliente') ||
    text.includes('contacorrente') ||
    text.includes('centraldeatendimento') ||
    text.includes('ouvidoria') ||
    text.includes('paginade')
  );
}

function csvField(value: unknown): string {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function movementForRow(row: Row, header: HeaderMatch): { credit: number; debit: number } {
  let credit = header.credit >= 0 ? Math.abs(parseMoney(row[header.credit])) : 0;
  let debit = header.debit >= 0 ? Math.abs(parseMoney(row[header.debit])) : 0;

  if (credit === 0 && debit === 0 && header.amount >= 0) {
    const signedAmount = parseMoney(row[header.amount]);
    const direction = header.type >= 0 ? inferDirection(row[header.type]) : 'unknown';

    if (direction === 'income') credit = Math.abs(signedAmount);
    else if (direction === 'expense') debit = Math.abs(signedAmount);
    else if (signedAmount > 0) credit = signedAmount;
    else if (signedAmount < 0) debit = Math.abs(signedAmount);
  }

  return { credit, debit };
}

export function standardizeBankSheet(sheet: XLSX.WorkSheet): string | null {
  const rows = XLSX.utils.sheet_to_json<Row>(sheet, {
    header: 1,
    raw: true,
    defval: '',
    blankrows: false,
  });

  if (!rows.length) return null;
  const header = findBestHeader(rows);
  if (!header) return null;

  const output: string[] = ['Data;Descricao;Documento;Credito;Debito;Saldo;Tipo;Banco'];
  const seen = new Set<string>();
  let lastDate: string | null = null;

  for (let index = header.rowIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    const parsedDate = parseExcelDate(row[header.date]);
    const description = displayCell(row[header.description]);
    const document = header.document >= 0 ? displayCell(row[header.document]) : '';
    const rawType = header.type >= 0 ? displayCell(row[header.type]) : '';

    if (parsedDate) lastDate = parsedDate;
    const date = parsedDate || lastDate;
    if (!date || isNonTransactionDescription(description)) continue;

    const { credit, debit } = movementForRow(row, header);
    const movement = Math.max(credit, debit);
    if (!Number.isFinite(movement) || movement <= 0 || movement > MAX_TRANSACTION_VALUE) continue;
    if (credit > 0 && debit > 0) continue;

    const balance = header.balance >= 0 ? parseMoney(row[header.balance]) : 0;
    const fingerprint = [date, normalize(description), document, credit.toFixed(2), debit.toFixed(2)].join('|');
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);

    output.push([
      csvField(date),
      csvField(description),
      csvField(document),
      credit ? credit.toFixed(2) : '',
      debit ? debit.toFixed(2) : '',
      Number.isFinite(balance) && balance !== 0 ? balance.toFixed(2) : '',
      csvField(rawType),
      csvField(header.profile.label),
    ].join(';'));
  }

  return output.length > 1 ? output.join('\n') : null;
}
