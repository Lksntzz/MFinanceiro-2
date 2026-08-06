import * as XLSX from 'xlsx';

type Cell = string | number | boolean | Date | null | undefined;
type Row = Cell[];

const originalSheetToCsv = XLSX.utils.sheet_to_csv.bind(XLSX.utils);

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
  return String(value ?? '').trim();
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
  const match = text.match(/\b(\d{2})[./-](\d{2})[./-](\d{2,4})\b/);
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
    /-$/.test(raw.trim()) ||
    /(?:^|\s)d(?:\s|$)/i.test(raw) ||
    normalizedText.endsWith('debito');

  let cleaned = raw
    .replace(/R\$/gi, '')
    .replace(/\s+/g, '')
    .replace(/[A-Za-z]/g, '')
    .replace(/[^\d,().+-]/g, '');

  cleaned = cleaned.replace(/[()]/g, '');
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

function findColumn(headers: string[], keys: string[]): number {
  return headers.findIndex((header) => keys.some((key) => header.includes(key)));
}

interface HeaderMatch {
  rowIndex: number;
  date: number;
  description: number;
  document: number;
  credit: number;
  debit: number;
  amount: number;
  balance: number;
}

function findBradescoHeader(rows: Row[]): HeaderMatch | null {
  const limit = Math.min(rows.length, 50);

  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const headers = rows[rowIndex].map((cell) => normalize(displayCell(cell)));
    const joined = headers.join('|');

    const date = findColumn(headers, ['data', 'datalancamento', 'datamovimento']);
    const description = findColumn(headers, ['historico', 'lancamento', 'descricao', 'movimento']);
    const document = findColumn(headers, ['docto', 'documento', 'doc', 'numero']);
    const credit = findColumn(headers, ['credito', 'creditos', 'entrada']);
    const debit = findColumn(headers, ['debito', 'debitos', 'saida']);
    const amount = findColumn(headers, ['valor', 'valorlancto', 'valorlancamento']);
    const balance = findColumn(headers, ['saldo', 'saldors']);

    const hasCoreColumns = date >= 0 && description >= 0 && (credit >= 0 || debit >= 0 || amount >= 0);
    const looksBradesco = joined.includes('historico') || joined.includes('lancamento');

    if (hasCoreColumns && looksBradesco) {
      return { rowIndex, date, description, document, credit, debit, amount, balance };
    }
  }

  return null;
}

function isNonTransactionDescription(description: string): boolean {
  const text = normalize(description);
  if (!text) return true;

  return (
    /^(saldo|total|subtotal)/.test(text) ||
    text.includes('saldoanterior') ||
    text.includes('saldodisponivel') ||
    text.includes('saldototal') ||
    text.includes('extratoinexistente') ||
    text.includes('bradescocelular') ||
    text.includes('ultimoslancamentos') ||
    text.includes('datahistorico') ||
    text === 'historico' ||
    text === 'lancamento' ||
    text === 'descricao'
  );
}

function csvField(value: unknown): string {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function standardizeBradescoSheet(sheet: XLSX.WorkSheet): string | null {
  const rows = XLSX.utils.sheet_to_json<Row>(sheet, {
    header: 1,
    raw: true,
    defval: '',
    blankrows: false,
  });

  if (!rows.length) return null;

  const header = findBradescoHeader(rows);
  if (!header) return null;

  const output: string[] = ['Data;Historico;Documento;Credito;Debito;Saldo'];
  let lastDate: string | null = null;

  for (let index = header.rowIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    const parsedDate = parseExcelDate(row[header.date]);
    const description = displayCell(row[header.description]).replace(/\s+/g, ' ').trim();
    const document = header.document >= 0 ? displayCell(row[header.document]) : '';

    if (parsedDate) lastDate = parsedDate;
    const date = parsedDate || lastDate;

    if (!date || isNonTransactionDescription(description)) continue;

    let credit = header.credit >= 0 ? Math.abs(parseMoney(row[header.credit])) : 0;
    let debit = header.debit >= 0 ? Math.abs(parseMoney(row[header.debit])) : 0;

    if (header.amount >= 0 && credit === 0 && debit === 0) {
      const signedAmount = parseMoney(row[header.amount]);
      if (signedAmount > 0) credit = signedAmount;
      if (signedAmount < 0) debit = Math.abs(signedAmount);
    }

    const balance = header.balance >= 0 ? parseMoney(row[header.balance]) : 0;
    const movement = Math.max(credit, debit);

    // Cabeçalhos, números de conta, datas concatenadas e saldos não podem virar lançamentos.
    if (!Number.isFinite(movement) || movement <= 0 || movement > 100_000_000) continue;

    output.push([
      csvField(date),
      csvField(description),
      csvField(document),
      credit ? credit.toFixed(2) : '',
      debit ? debit.toFixed(2) : '',
      Number.isFinite(balance) && balance !== 0 ? balance.toFixed(2) : '',
    ].join(';'));
  }

  return output.length > 1 ? output.join('\n') : null;
}

// O importador legado transforma planilhas em CSV. Interceptamos somente planilhas
// que possuem a estrutura de extrato Bradesco e preservamos o comportamento original
// para todos os demais bancos e formatos.
XLSX.utils.sheet_to_csv = ((sheet: XLSX.WorkSheet, options?: XLSX.Sheet2CSVOpts) => {
  try {
    const standardized = standardizeBradescoSheet(sheet);
    if (standardized) return standardized;
  } catch (error) {
    console.warn('Falha ao normalizar planilha Bradesco; usando parser genérico.', error);
  }

  return originalSheetToCsv(sheet, options);
}) as typeof XLSX.utils.sheet_to_csv;
