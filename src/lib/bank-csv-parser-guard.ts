type BankId = 'nubank' | 'inter' | 'santander' | 'bradesco' | 'mercadopago' | 'c6bank' | 'generic';

interface CsvProfile {
  id: BankId;
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
  profile: CsvProfile;
  headerIndex: number;
  delimiter: string;
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

const originalFileText = File.prototype.text;
const MAX_TRANSACTION_VALUE = 100_000_000;

const PROFILES: CsvProfile[] = [
  {
    id: 'nubank', label: 'Nubank', hints: ['nubank', 'nupagamentos', 'identificador'],
    date: ['data', 'date'], description: ['descricao', 'descricaodatransacao', 'estabelecimento', 'titulo'],
    document: ['identificador', 'id'], credit: ['credito', 'entrada'], debit: ['debito', 'saida'],
    amount: ['valor', 'amount'], balance: ['saldo'], type: ['tipo', 'categoria'],
  },
  {
    id: 'inter', label: 'Banco Inter', hints: ['bancointer', 'intermedium', 'contadigitalinter'],
    date: ['datalancamento', 'datamovimento', 'data'], description: ['historico', 'descricao', 'titulo', 'transacao'],
    document: ['documento', 'idtransacao', 'identificador'], credit: ['credito', 'entrada'], debit: ['debito', 'saida'],
    amount: ['valor', 'valorlancamento'], balance: ['saldo'], type: ['tipo', 'natureza'],
  },
  {
    id: 'santander', label: 'Santander', hints: ['santander', 'bancosantander', 'superlinha'],
    date: ['data', 'datalancamento', 'datamovimento'], description: ['historico', 'descricao', 'lancamento'],
    document: ['documento', 'docto', 'doc'], credit: ['credito', 'creditos', 'entrada'], debit: ['debito', 'debitos', 'saida'],
    amount: ['valor', 'valorrs', 'valorlancamento'], balance: ['saldo'], type: ['tipo', 'natureza'],
  },
  {
    id: 'bradesco', label: 'Bradesco', hints: ['bradesco', 'bancobradesco', 'bradescocelular'],
    date: ['data', 'datalancamento', 'datamovimento'], description: ['historico', 'lancamento', 'descricao', 'movimento'],
    document: ['docto', 'documento', 'doc', 'numero'], credit: ['credito', 'creditos', 'entrada'], debit: ['debito', 'debitos', 'saida'],
    amount: ['valor', 'valorlancto', 'valorlancamento'], balance: ['saldo', 'saldors'], type: ['tipo', 'natureza'],
  },
  {
    id: 'mercadopago', label: 'Mercado Pago', hints: ['mercadopago', 'releasedate', 'referenceid', 'transactionnetamount'],
    date: ['releasedate', 'data', 'date'], description: ['transactiondescription', 'transactiondetails', 'description', 'transactiontype', 'descricao'],
    document: ['referenceid', 'identificador', 'id'], credit: ['credito', 'receivedamount', 'entrada'], debit: ['debito', 'paidamount', 'saida'],
    amount: ['transactionnetamount', 'transactionamount', 'netamount', 'valor'], balance: ['partialbalance', 'saldo'], type: ['transactiontype', 'tipo'],
  },
  {
    id: 'c6bank', label: 'C6 Bank', hints: ['c6bank', 'bancoc6'],
    date: ['data', 'datalancamento', 'datatransacao'], description: ['descricao', 'historico', 'lancamento', 'estabelecimento'],
    document: ['identificador', 'documento', 'idtransacao'], credit: ['credito', 'entrada'], debit: ['debito', 'saida'],
    amount: ['valor', 'valordatransacao', 'valortransacao'], balance: ['saldo'], type: ['tipo', 'natureza'],
  },
  {
    id: 'generic', label: 'Banco não identificado', hints: [],
    date: ['data', 'date', 'datalancamento', 'datamovimento', 'datatransacao', 'releasedate'],
    description: ['descricao', 'historico', 'lancamento', 'movimento', 'detalhes', 'transacao', 'estabelecimento', 'transactiondescription', 'transactiondetails', 'transactiontype', 'memo'],
    document: ['documento', 'docto', 'doc', 'identificador', 'referenceid', 'idtransacao'],
    credit: ['credito', 'creditos', 'entrada', 'entradas', 'credit', 'receivedamount'],
    debit: ['debito', 'debitos', 'saida', 'saidas', 'debit', 'paidamount'],
    amount: ['valor', 'valorrs', 'valorlancamento', 'valortransacao', 'amount', 'transactionamount', 'transactionnetamount', 'netamount'],
    balance: ['saldo', 'saldors', 'saldoparcial', 'partialbalance', 'currentbalance', 'finalbalance'],
    type: ['tipo', 'natureza', 'type', 'transactiontype', 'operacao'],
  },
];

function normalize(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function detectDelimiter(line: string): string {
  const candidates = [';', ',', '\t', '|'];
  let best = ';';
  let bestCount = -1;
  for (const candidate of candidates) {
    let count = 0;
    let quoted = false;
    for (const char of line) {
      if (char === '"') quoted = !quoted;
      else if (char === candidate && !quoted) count += 1;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

function parseLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  cells.push(current.trim());
  return cells;
}

function headerMatches(header: string, alias: string): boolean {
  const normalizedAlias = normalize(alias);
  return Boolean(header && normalizedAlias && (
    header === normalizedAlias || header.startsWith(normalizedAlias) || normalizedAlias.startsWith(header)
  ));
}

function findColumn(headers: string[], aliases: string[]): number {
  return headers.findIndex((header) => aliases.some((alias) => headerMatches(header, alias)));
}

function parseMoney(rawValue: string | undefined): number {
  const raw = String(rawValue ?? '').trim();
  if (!raw) return 0;

  const normalizedText = normalize(raw);
  const negative = /^\(.*\)$/.test(raw) || /-$/.test(raw) || normalizedText.endsWith('debito');
  let cleaned = raw
    .replace(/R\$/gi, '')
    .replace(/\s+/g, '')
    .replace(/[A-Za-z]/g, '')
    .replace(/[^\d,().+-]/g, '')
    .replace(/[()]/g, '');
  if (!cleaned) return 0;

  if (cleaned.includes(',') && cleaned.includes('.')) {
    cleaned = cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.replace(/,/g, '');
  } else if (cleaned.includes(',')) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  }

  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return 0;
  return negative ? -Math.abs(parsed) : parsed;
}

function normalizeDate(rawValue: string | undefined): string | null {
  const raw = String(rawValue ?? '').trim();
  const match = raw.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 2000 || year > 2100 || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

function inferDirection(rawValue: string | undefined): 'income' | 'expense' | 'unknown' {
  const text = normalize(rawValue);
  if (/(credito|credit|entrada|recebido|recebimento|deposito|cashin|income|pixrecebido|rendimento)/.test(text)) return 'income';
  if (/(debito|debit|saida|enviado|pagamento|compra|cashout|expense|pixenviado|saque|tarifa)/.test(text)) return 'expense';
  return 'unknown';
}

function isIgnoredDescription(description: string): boolean {
  const text = normalize(description);
  return !text ||
    /^(saldo|total|subtotal|data|historico|descricao|lancamento|movimento|documento|credito|debito|valor)$/.test(text) ||
    text.includes('saldoanterior') || text.includes('saldodisponivel') || text.includes('saldofinal') ||
    text.includes('totaldecreditos') || text.includes('totaldedebitos') || text.includes('resumodaconta') ||
    text.includes('agenciaeconta') || text.includes('periododoextrato') || text.includes('dadosdocliente') ||
    text.includes('centraldeatendimento') || text.includes('ouvidoria');
}

function scoreHeader(lines: string[], rowIndex: number, profile: CsvProfile): HeaderMatch | null {
  const delimiter = detectDelimiter(lines[rowIndex]);
  const headers = parseLine(lines[rowIndex], delimiter).map(normalize);
  const date = findColumn(headers, profile.date);
  const description = findColumn(headers, profile.description);
  const document = findColumn(headers, profile.document);
  const credit = findColumn(headers, profile.credit);
  const debit = findColumn(headers, profile.debit);
  const amount = findColumn(headers, profile.amount);
  const balance = findColumn(headers, profile.balance);
  const type = findColumn(headers, profile.type);
  if (date < 0 || description < 0 || (credit < 0 && debit < 0 && amount < 0)) return null;

  const context = normalize(lines.slice(Math.max(0, rowIndex - 10), rowIndex + 3).join(' '));
  let score = 20 + (credit >= 0 ? 4 : 0) + (debit >= 0 ? 4 : 0) + (amount >= 0 ? 4 : 0) +
    (balance >= 0 ? 2 : 0) + (document >= 0 ? 2 : 0) + (type >= 0 ? 1 : 0);
  for (const hint of profile.hints) if (context.includes(normalize(hint))) score += 8;
  if (profile.id === 'generic') score -= 5;

  return { profile, headerIndex: rowIndex, delimiter, score, date, description, document, credit, debit, amount, balance, type };
}

function findBestHeader(lines: string[]): HeaderMatch | null {
  let best: HeaderMatch | null = null;
  const limit = Math.min(lines.length, 80);
  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    for (const profile of PROFILES) {
      const candidate = scoreHeader(lines, rowIndex, profile);
      if (candidate && (!best || candidate.score > best.score)) best = candidate;
    }
  }
  return best;
}

function csvField(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function standardizeCsv(content: string, fileName: string): string | null {
  if (normalize(fileName).includes('mfinanceirorelatoriotransacoes')) return null;
  const lines = content.split(/\r?\n/).map((line) => line.replace(/^\uFEFF/, '').trim()).filter(Boolean);
  if (lines.length < 2) return null;
  if (lines[0].toLowerCase().startsWith('sep=')) lines.shift();

  const header = findBestHeader(lines);
  if (!header) return null;

  const output = ['Data;Descricao;Documento;Credito;Debito;Saldo;Tipo;Banco'];
  const seen = new Set<string>();
  let lastDate: string | null = null;

  for (let index = header.headerIndex + 1; index < lines.length; index += 1) {
    const row = parseLine(lines[index], header.delimiter);
    const parsedDate = normalizeDate(row[header.date]);
    const description = String(row[header.description] ?? '').replace(/\s+/g, ' ').trim();
    if (parsedDate) lastDate = parsedDate;
    const date = parsedDate || lastDate;
    if (!date || isIgnoredDescription(description)) continue;

    let credit = header.credit >= 0 ? Math.abs(parseMoney(row[header.credit])) : 0;
    let debit = header.debit >= 0 ? Math.abs(parseMoney(row[header.debit])) : 0;
    const rawType = header.type >= 0 ? row[header.type] : '';

    if (credit === 0 && debit === 0 && header.amount >= 0) {
      const signedAmount = parseMoney(row[header.amount]);
      const direction = inferDirection(rawType);
      if (direction === 'income') credit = Math.abs(signedAmount);
      else if (direction === 'expense') debit = Math.abs(signedAmount);
      else if (signedAmount > 0) credit = signedAmount;
      else if (signedAmount < 0) debit = Math.abs(signedAmount);
    }

    const movement = Math.max(credit, debit);
    if (!Number.isFinite(movement) || movement <= 0 || movement > MAX_TRANSACTION_VALUE || (credit > 0 && debit > 0)) continue;

    const document = header.document >= 0 ? row[header.document] : '';
    const balance = header.balance >= 0 ? parseMoney(row[header.balance]) : 0;
    const fingerprint = [date, normalize(description), document, credit.toFixed(2), debit.toFixed(2)].join('|');
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);

    output.push([
      csvField(date), csvField(description), csvField(document),
      credit ? credit.toFixed(2) : '', debit ? debit.toFixed(2) : '',
      Number.isFinite(balance) && balance !== 0 ? balance.toFixed(2) : '',
      csvField(rawType), csvField(header.profile.label),
    ].join(';'));
  }

  return output.length > 1 ? output.join('\n') : null;
}

File.prototype.text = async function bankAwareText(): Promise<string> {
  const original = await originalFileText.call(this);
  const extension = this.name.split('.').pop()?.toLowerCase();
  if (extension !== 'csv' && !this.type.toLowerCase().includes('csv')) return original;

  try {
    return standardizeCsv(original, this.name) || original;
  } catch (error) {
    console.warn('Falha ao normalizar CSV bancário; usando arquivo original.', error);
    return original;
  }
};
