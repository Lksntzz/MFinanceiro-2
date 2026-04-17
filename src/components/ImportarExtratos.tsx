import React, { useState, useCallback } from 'react';
import { ImportedTransaction } from '../types';
import { parsePdfStatement } from '../lib/import-parsers/pdf/parse-pdf-statement';
import {
  Upload,
  FileText,
  CheckCircle2,
  Filter,
  Trash2,
  Check,
  X,
  ChevronRight,
  Database,
  Info,
  Loader2,
  ArrowRightLeft,
  ShieldCheck
} from 'lucide-react';

interface ImportarExtratosProps {
  onImport: (transactions: ImportedTransaction[]) => void;
  onCancel: () => void;
}

function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function detectDelimiter(line: string): string {
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestCount = -1;

  for (const candidate of candidates) {
    const count = (line.match(new RegExp(`\\${candidate}`, 'g')) || []).length;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }

  return best;
}

function scoreHeader(cells: string[]): number {
  const keys = [
    'data',
    'date',
    'dtposted',
    'descricao',
    'historico',
    'memo',
    'description',
    'transactiondescription',
    'transactiondetails',
    'valor',
    'amount',
    'transactionamount',
    'transactionnetamount',
    'debito',
    'credito',
    'categoria',
    'category',
    'type',
    'tipo'
  ];

  return cells.reduce((sum, cell) => (
    sum + (keys.some(key => cell.includes(normalizeHeader(key))) ? 1 : 0)
  ), 0);
}

function findKnownTransactionHeader(lines: string[]): { index: number; delimiter: string } | null {
  for (let i = 0; i < lines.length; i++) {
    const delimiter = detectDelimiter(lines[i]);
    const cols = parseCsvLine(lines[i], delimiter).map(normalizeHeader);
    const hasReleaseDate = cols.includes('releasedate');
    const hasType = cols.includes('transactiontype');
    const hasNetAmount = cols.includes('transactionnetamount') || cols.includes('transactionamount');
    if (hasReleaseDate && hasType && hasNetAmount) {
      return { index: i, delimiter };
    }
  }
  return null;
}

function parseAmount(raw: string | undefined): number {
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
    const num = Number(normalized);
    if (!Number.isFinite(num)) return 0;
    return isNegative ? -Math.abs(num) : num;
  }

  if (cleaned.includes(',')) {
    const num = Number(cleaned.replace(',', '.'));
    if (!Number.isFinite(num)) return 0;
    return isNegative ? -Math.abs(num) : num;
  }

  const num = Number(cleaned);
  if (!Number.isFinite(num)) return 0;
  return isNegative ? -Math.abs(num) : num;
}

function parseDateToIso(raw: string | undefined): string {
  if (!raw) return new Date().toISOString();
  const value = raw.trim();

  // Usa meio-dia UTC para evitar deslocamento de dia por fuso horário
  // (ex.: data do extrato no dia 03 aparecendo como dia 02 no app).
  const toStableIso = (year: number, month: number, day: number) =>
    new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).toISOString();

  const br = value.match(/^(\d{2})[./-](\d{2})[./-](\d{2,4})$/);
  if (br) {
    const day = Number(br[1]);
    const month = Number(br[2]);
    const year = Number(br[3].length === 2 ? `20${br[3]}` : br[3]);
    return toStableIso(year, month, day);
  }

  const isoDateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateOnly) {
    const year = Number(isoDateOnly[1]);
    const month = Number(isoDateOnly[2]);
    const day = Number(isoDateOnly[3]);
    return toStableIso(year, month, day);
  }

  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? new Date().toISOString() : dt.toISOString();
}

function looksLikeDate(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim();
  if (!v) return false;
  if (/^\d{2}[/-]\d{2}[/-]\d{2,4}$/.test(v)) return true;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return true;
  return false;
}

function looksLikeAmount(value: string | undefined): boolean {
  if (!value) return false;
  return /[-+]?\s*R?\$?\s*[\d.,]+/.test(value);
}

function looksLikeText(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim();
  if (!v) return false;
  if (looksLikeDate(v) || looksLikeAmount(v)) return false;
  return /[a-zA-Z]/.test(v);
}

function pickDescription(cols: string[], descriptionIdx: number): string {
  const direct = (descriptionIdx >= 0 ? cols[descriptionIdx] : '').trim();
  if (direct) return direct;

  const textCandidates = cols
    .map((value, idx) => ({ value: value?.trim() || '', idx }))
    .filter(item => looksLikeText(item.value))
    .sort((a, b) => b.value.length - a.value.length);

  return textCandidates[0]?.value || 'Sem descricao';
}

function pickAmount(cols: string[], amountIdx: number, debitIdx: number, creditIdx: number): number {
  const debit = debitIdx >= 0 ? Math.abs(parseAmount(cols[debitIdx])) : 0;
  const credit = creditIdx >= 0 ? Math.abs(parseAmount(cols[creditIdx])) : 0;
  if (debit > 0 || credit > 0) return credit - debit;

  const explicitAmount = amountIdx >= 0 ? parseAmount(cols[amountIdx]) : 0;
  const MAX_REASONABLE_TRANSACTION = 1_000_000; // Protege contra IDs/saldos gigantes lidos como valor
  if (Math.abs(explicitAmount) > 0 && Math.abs(explicitAmount) <= MAX_REASONABLE_TRANSACTION) {
    return explicitAmount;
  }

  // Se existe coluna explícita de valor, não devemos adivinhar usando outras colunas numéricas.
  // Isso evita capturar IDs/documentos/saldos e gerar números absurdos.
  if (amountIdx >= 0) return 0;

  const numericCandidates = cols
    .map(value => parseAmount(value))
    .filter(v => Math.abs(v) > 0 && Math.abs(v) <= MAX_REASONABLE_TRANSACTION)
    .sort((a, b) => Math.abs(a) - Math.abs(b));

  return numericCandidates[0] || 0;
}

function inferColumnByRatio(rows: string[][], predicate: (value: string | undefined) => boolean, minRatio = 0.45): number {
  const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0);
  let bestIdx = -1;
  let bestRatio = 0;

  for (let col = 0; col < maxCols; col++) {
    let hits = 0;
    let total = 0;
    for (const row of rows) {
      const value = row[col];
      if (value === undefined || value.trim() === '') continue;
      total++;
      if (predicate(value)) hits++;
    }
    if (total === 0) continue;
    const ratio = hits / total;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestIdx = col;
    }
  }

  return bestRatio >= minRatio ? bestIdx : -1;
}

function inferCategory(description: string, type: 'income' | 'expense'): string {
  const text = normalizeHeader(description);
  
  // Entradas Específicas
  if (type === 'income') {
    if (/(salario|pagamento|folha|remunera|provento|vencimento)/.test(text)) return 'Salário';
    if (/(vr|va|ticket|alimentacao|refeicao|beneficio|auxilio)/.test(text)) return 'Benefícios';
    if (/(rendimento|juros|aplicacao|poupanca|cdb|selic|resgate)/.test(text)) return 'Rendimentos';
    if (/(pix|ted|doc|transferencia|recebido|enviado)/.test(text)) return 'Transferência';
    return 'Geral';
  }

  // Saídas
  if (/(uber|99|taxi|combustivel|posto|ipiranga|shell|estacionamento|shellbox)/.test(text)) return 'Transporte';
  if (/(mercado|supermercado|ifood|restaurante|padaria|food|acougue|fast|pizza|burger)/.test(text)) return 'Alimentação';
  if (/(farmacia|hospital|clinica|medic|droga|saude)/.test(text)) return 'Saúde';
  if (/(netflix|spotify|cinema|stream|show|lazer|ingresso|tour|viagem)/.test(text)) return 'Lazer';
  if (/(aluguel|condominio|energia|agua|internet|telefone|vivo|claro|tim|oito|luz|cpfl|enel)/.test(text)) return 'Contas Fixas';
  if (/(escola|faculdade|curso|livros|estudo|educa)/.test(text)) return 'Educação';
  
  return 'Geral';
}

function inferCategoryFromStatement(description: string, type: 'income' | 'expense'): string {
  // Unifica a lógica usando a mesma engine de inferência aprimorada
  return inferCategory(description, type);
}

function generateId(prefix: string, index: number): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${index}`;
}

function parseCsvTransactions(content: string, bank: string): ImportedTransaction[] {
  const lines = content
    .split(/\r?\n/)
    .map(line => line.replace(/\uFEFF/g, '').trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const linesWithoutSep = lines[0].toLowerCase().startsWith('sep=')
    ? lines.slice(1)
    : lines;
  if (linesWithoutSep.length < 2) return [];

  const knownHeader = findKnownTransactionHeader(linesWithoutSep);
  let headerIndex = -1;
  let delimiter = knownHeader ? knownHeader.delimiter : detectDelimiter(linesWithoutSep[0]);
  let bestScore = 0;
  const probeCount = Math.min(linesWithoutSep.length, 30);

  if (knownHeader) {
    headerIndex = knownHeader.index;
    bestScore = 99;
  } else {
    for (let i = 0; i < probeCount; i++) {
      const currentDelimiter = detectDelimiter(linesWithoutSep[i]);
      const cells = parseCsvLine(linesWithoutSep[i], currentDelimiter).map(normalizeHeader).filter(Boolean);
      const score = scoreHeader(cells);
      if (score > bestScore) {
        bestScore = score;
        headerIndex = i;
        delimiter = currentDelimiter;
      }
    }
  }

  const hasHeader = bestScore >= 2;
  const rawHeaders = hasHeader ? parseCsvLine(linesWithoutSep[headerIndex], delimiter) : [];
  const headers = rawHeaders.map(normalizeHeader);
  const findKey = (...keys: string[]) =>
    headers.findIndex(header => keys.some(key => header.includes(normalizeHeader(key))));

  const dateIdx = findKey('data', 'date', 'dtposted');
  const descriptionIdx = findKey(
    'descricao',
    'historico',
    'memo',
    'description',
    'desc',
    'transactiondescription',
    'transactiondetails',
    'narrative',
    'details',
    'merchant'
  );
  const amountIdx = findKey(
    'valor',
    'amount',
    'valorrs',
    'transactionamount',
    'transactionnetamount',
    'netamount',
    'paidamount',
    'receivedamount'
  );
  const runningBalanceIdx = findKey(
    'partialbalance',
    'balance',
    'finalbalance',
    'currentbalance',
    'saldo',
    'saldoparcial'
  );
  const debitIdx = findKey('debito', 'debit', 'saidas');
  const creditIdx = findKey('credito', 'credit', 'entradas');
  const categoryIdx = findKey('categoria', 'category', 'transactioncategory');
  const typeIdx = findKey('type', 'tipo', 'natureza', 'transactiontype');

  const dataStart = hasHeader ? headerIndex + 1 : 0;
  const dataLines = linesWithoutSep.slice(dataStart);

  const releaseDateIdx = headers.indexOf('releasedate');
  const transactionTypeIdx = headers.indexOf('transactiontype');
  const referenceIdIdx = headers.indexOf('referenceid');
  const transactionNetAmountIdx = headers.indexOf('transactionnetamount') >= 0
    ? headers.indexOf('transactionnetamount')
    : headers.indexOf('transactionamount');
  const partialBalanceIdx = headers.indexOf('partialbalance');

  const isKnownStatementFormat =
    releaseDateIdx >= 0 &&
    transactionTypeIdx >= 0 &&
    transactionNetAmountIdx >= 0;

  if (isKnownStatementFormat) {
    return dataLines.map((line, index) => {
      const cols = parseCsvLine(line, delimiter);
      const description = (cols[transactionTypeIdx] || '').trim() || 'Sem descricao';
      const sourceId = referenceIdIdx >= 0 ? (cols[referenceIdIdx] || '').trim() : '';
      const signedAmount = parseAmount(cols[transactionNetAmountIdx]);
      const normalizedAmount = Math.abs(signedAmount);
      const type: 'income' | 'expense' = signedAmount >= 0 ? 'income' : 'expense';
      const parsedRunningBalance = partialBalanceIdx >= 0 ? parseAmount(cols[partialBalanceIdx]) : NaN;
      const runningBalance = Number.isFinite(parsedRunningBalance) ? parsedRunningBalance : undefined;
      const status: ImportedTransaction['status'] = description !== 'Sem descricao' && normalizedAmount > 0 ? 'ready' : 'error';

      return {
        id: generateId('csv-statement', index),
        date: parseDateToIso(cols[releaseDateIdx]),
        description,
        amount: normalizedAmount,
        source_id: sourceId || undefined,
        type,
        category: inferCategoryFromStatement(description, type),
        status,
        confidence: status === 'ready' ? 0.98 : 0.35,
        original_description: description,
        bank_source: bank === 'auto' ? 'Importado CSV' : bank,
        running_balance: runningBalance
      };
    });
  }

  const sampleRows = dataLines.slice(0, 20).map(line => parseCsvLine(line, delimiter));

  const inferredDateIdx = dateIdx >= 0 ? dateIdx : inferColumnByRatio(sampleRows, looksLikeDate);
  const inferredAmountIdx = amountIdx >= 0 ? amountIdx : inferColumnByRatio(sampleRows, looksLikeAmount);
  const inferredDescriptionIdx = descriptionIdx >= 0
    ? descriptionIdx
    : inferColumnByRatio(sampleRows, looksLikeText, 0.35);

  return dataLines.map((line, index) => {
    const cols = parseCsvLine(line, delimiter);
    const description = pickDescription(cols, inferredDescriptionIdx);
    const amount = pickAmount(cols, inferredAmountIdx, debitIdx, creditIdx);

    const explicitType = typeIdx >= 0 ? normalizeHeader(cols[typeIdx]) : '';
    const type: 'income' | 'expense' =
      /(receita|income|credito|entrada|recebido|rendimentos|rendimento|deposito|ganho|bonus)/.test(explicitType) || amount > 0
        ? 'income'
        : 'expense';
        
    const category = ((categoryIdx >= 0 ? cols[categoryIdx] : '') || '').trim() || inferCategory(description, type);
    const rawDate = inferredDateIdx >= 0 ? cols[inferredDateIdx] : (looksLikeDate(cols[0]) ? cols[0] : '');
    const normalizedAmount = Math.abs(amount);
    const status: ImportedTransaction['status'] = description !== 'Sem descricao' && normalizedAmount > 0 ? 'ready' : 'error';
    const parsedRunningBalance = runningBalanceIdx >= 0 ? parseAmount(cols[runningBalanceIdx]) : NaN;
    const runningBalance = Number.isFinite(parsedRunningBalance) ? parsedRunningBalance : undefined;
    const normalizedDescription = normalizeHeader(description);
    const looksLikeHeaderRow =
      normalizedDescription.includes('transaction') ||
      normalizedDescription.includes('description') ||
      normalizedDescription.includes('amount') ||
      normalizedDescription.includes('categoria');

    return {
      id: generateId('csv', index),
      date: parseDateToIso(rawDate),
      description,
      amount: normalizedAmount,
      type,
      category,
      status: looksLikeHeaderRow ? 'error' : status,
      confidence: looksLikeHeaderRow ? 0.1 : (status === 'ready' ? 0.9 : 0.35),
      original_description: description,
      bank_source: bank === 'auto' ? 'Importado CSV' : bank,
      running_balance: runningBalance
    };
  });
}

function parseOfxTransactions(content: string, bank: string): ImportedTransaction[] {
  const blocks = content.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) || [];

  return blocks.map((block, index) => {
    const fitid = (block.match(/<FITID>(.*)/i)?.[1] || '').trim();
    const trnType = normalizeHeader((block.match(/<TRNTYPE>(.*)/i)?.[1] || '').trim());
    const dtPosted = (block.match(/<DTPOSTED>(.*)/i)?.[1] || '').trim();
    const memo = (block.match(/<MEMO>(.*)/i)?.[1] || '').trim();
    const name = (block.match(/<NAME>(.*)/i)?.[1] || '').trim();
    const trnAmt = parseAmount((block.match(/<TRNAMT>(.*)/i)?.[1] || '').trim());
    const description = memo || name || 'Sem descricao';
    const rawDate = dtPosted ? `${dtPosted.slice(6, 8)}/${dtPosted.slice(4, 6)}/${dtPosted.slice(0, 4)}` : '';
    const type: 'income' | 'expense' = /(credit|dep|income)/.test(trnType) || trnAmt > 0 ? 'income' : 'expense';
    const status: ImportedTransaction['status'] = trnAmt !== 0 ? 'ready' : 'error';

    return {
      id: fitid || generateId('ofx', index),
      date: parseDateToIso(rawDate),
      description,
      amount: Math.abs(trnAmt),
      type,
      category: inferCategory(description, type),
      status,
      confidence: trnAmt !== 0 ? 0.96 : 0.45,
      original_description: description,
      bank_source: bank === 'auto' ? 'Importado OFX' : bank
    };
  });
}

async function parsePdfTransactions(file: File, selectedBank: string): Promise<ImportedTransaction[]> {
  return parsePdfStatement(file, selectedBank);
}

export default function ImportarExtratos({ onImport, onCancel }: ImportarExtratosProps) {
  const [step, setStep] = useState<'upload' | 'processing' | 'review' | 'success'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [bank, setBank] = useState<string>('auto');
  const [importedData, setImportedData] = useState<ImportedTransaction[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const signedAmountFromImported = (item: ImportedTransaction): number =>
    item.type === 'income' ? Math.abs(item.amount) : -Math.abs(item.amount);

  const parseImportedDate = (value: string): number => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  };

  const balanceValidation = (() => {
    if (importedData.length === 0) return null;

    const withRunning = importedData
      .map((item, idx) => ({ item, idx }))
      .filter(entry => entry.item.running_balance !== undefined && Number.isFinite(entry.item.running_balance));

    if (withRunning.length === 0) return null;

    const sortedByDateAsc = [...withRunning].sort((a, b) => {
      const byDate = parseImportedDate(a.item.date) - parseImportedDate(b.item.date);
      if (byDate !== 0) return byDate;
      return a.idx - b.idx;
    });
    const sortedByDateDesc = [...withRunning].sort((a, b) => {
      const byDate = parseImportedDate(b.item.date) - parseImportedDate(a.item.date);
      if (byDate !== 0) return byDate;
      return b.idx - a.idx;
    });

    const firstWithBalance = sortedByDateAsc[0]?.item;
    const lastWithBalance = sortedByDateDesc[0]?.item;
    if (!firstWithBalance || !lastWithBalance) return null;

    const openingBalance = (firstWithBalance.running_balance || 0) - signedAmountFromImported(firstWithBalance);
    const selectedNet = importedData
      .filter(item => item.status === 'ready')
      .reduce((sum, item) => sum + signedAmountFromImported(item), 0);
    const expectedFinal = openingBalance + selectedNet;
    const statementFinal = lastWithBalance.running_balance || 0;
    const diff = expectedFinal - statementFinal;

    return {
      expectedFinal,
      statementFinal,
      diff,
      isClose: Math.abs(diff) < 0.01,
    };
  })();

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  }, [bank]);

  const processFile = async (selectedFile: File) => {
    setFile(selectedFile);
    setStep('processing');

    try {
      const filename = selectedFile.name.toLowerCase();
      let parsed: ImportedTransaction[] = [];

      if (filename.endsWith('.csv')) {
        const content = await selectedFile.text();
        parsed = parseCsvTransactions(content, bank);
      } else if (filename.endsWith('.ofx')) {
        const content = await selectedFile.text();
        parsed = parseOfxTransactions(content, bank);
      } else if (filename.endsWith('.pdf')) {
        parsed = await parsePdfTransactions(selectedFile, bank);
      }

      setImportedData(parsed);
      setStep('review');
    } catch (error) {
      console.error('Erro ao processar arquivo:', error);
      setImportedData([]);
      setStep('review');
    }
  };

  const handleToggleStatus = (id: string) => {
    setImportedData(prev => prev.map(item => {
      if (item.id === id) {
        if (item.status === 'error' && (item.amount <= 0 || item.description === 'Sem descricao')) {
          return item;
        }
        return { ...item, status: item.status === 'ready' ? 'pending' : 'ready' };
      }
      return item;
    }));
  };

  const handleRemove = (id: string) => {
    setImportedData(prev => prev.filter(item => item.id !== id));
  };

  const handleFinalImport = () => {
    const readyItems = importedData.filter(item =>
      item.status === 'ready' &&
      item.amount > 0 &&
      item.description !== 'Sem descricao'
    );
    onImport(readyItems);
    setStep('success');
  };

  if (step === 'success') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-6 animate-fade-in">
        <div className="h-20 w-20 rounded-full bg-green-500/20 flex items-center justify-center text-green-500">
          <CheckCircle2 size={48} />
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold">Importacao Concluida!</h2>
          <p className="text-white/40 text-sm max-w-xs mx-auto">
            {importedData.filter(i => i.status === 'ready').length} lancamentos foram adicionados ao seu ledger com sucesso.
          </p>
        </div>
        <button
          onClick={onCancel}
          className="px-8 py-3 bg-brand-primary text-white rounded-xl font-bold uppercase tracking-widest hover:bg-brand-primary/80 transition-all"
        >
          Voltar ao Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col gap-4 overflow-hidden animate-fade-in">
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Database className="text-brand-secondary" size={24} /> Importar Extratos
          </h2>
          <p className="text-sm sm:text-xs text-white/40">Traga suas movimentacoes bancarias para o MFinanceiro de forma inteligente.</p>
        </div>
        <button onClick={onCancel} className="p-2 text-white/20 hover:text-white transition-colors">
          <X size={20} />
        </button>
      </div>

      {step === 'upload' && (
        <div className="flex-1 flex flex-col gap-4 overflow-y-auto no-scrollbar">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-8 space-y-4">
              <div
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                className={`h-64 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center gap-4 transition-all ${
                  isDragging ? 'border-brand-primary bg-brand-primary/5' : 'border-white/10 bg-white/5 hover:border-white/20'
                }`}
              >
                <div className="h-16 w-16 rounded-full bg-white/5 flex items-center justify-center text-white/40">
                  <Upload size={32} />
                </div>
                <div className="text-center">
                  <p className="font-bold text-sm">Arraste seu extrato aqui</p>
                  <p className="text-[11px] sm:text-[10px] text-white/40 uppercase tracking-widest mt-1">Ou clique para selecionar</p>
                </div>
                <input
                  type="file"
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  onChange={handleFileSelect}
                  accept=".csv,.ofx,.xlsx,.pdf,image/*"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="glass-card !p-4 flex items-start gap-3">
                  <div className="h-8 w-8 rounded-lg bg-brand-secondary/20 flex items-center justify-center text-brand-secondary">
                    <FileText size={18} />
                  </div>
                  <div>
                    <h4 className="text-sm sm:text-xs font-bold">Formatos Suportados</h4>
                    <p className="text-[11px] sm:text-[10px] text-white/40 mt-1">CSV, OFX e PDF com mapeamento automatico de campos.</p>
                  </div>
                </div>
                <div className="glass-card !p-4 flex items-start gap-3">
                  <div className="h-8 w-8 rounded-lg bg-brand-primary/20 flex items-center justify-center text-brand-primary">
                    <ShieldCheck size={18} />
                  </div>
                  <div>
                    <h4 className="text-sm sm:text-xs font-bold">Seguranca de Dados</h4>
                    <p className="text-[11px] sm:text-[10px] text-white/40 mt-1">Seus dados sao processados localmente.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-4 space-y-4">
              <div className="glass-card !p-5 space-y-4">
                <h3 className="text-sm sm:text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                  <Filter size={14} className="text-white/40" /> Configuracao
                </h3>
                <div>
                  <label className="text-[11px] sm:text-[10px] text-white/40 uppercase font-bold block mb-1.5">Banco / Origem</label>
                  <select
                    value={bank}
                    onChange={(e) => setBank(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm sm:text-xs focus:outline-none focus:border-brand-primary transition-all"
                  >
                    <option value="auto">Deteccao Automatica</option>
                    <option value="nubank">Nubank</option>
                    <option value="inter">Inter</option>
                    <option value="santander">Santander</option>
                    <option value="bradesco">Bradesco</option>
                    <option value="mercadopago">Mercado Pago</option>
                    <option value="c6bank">C6 Bank</option>
                  </select>
                </div>
              </div>

              <div className="glass-card !p-5 bg-brand-primary/5 border-brand-primary/20">
                <h3 className="text-sm sm:text-xs font-bold flex items-center gap-2 mb-2">
                  <Info size={14} className="text-brand-primary" /> Dica Pro
                </h3>
                <p className="text-[11px] sm:text-[10px] text-white/60 leading-relaxed">
                  OFX costuma ter mais precisao na importacao por trazer identificadores unicos e valor consolidado por transacao.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {step === 'processing' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 animate-pulse">
          <Loader2 size={48} className="text-brand-secondary animate-spin" />
          <div className="text-center">
            <p className="font-bold">Interpretando Extrato...</p>
            <p className="text-[11px] sm:text-[10px] text-white/40 uppercase tracking-widest mt-1">Normalizando dados e detectando duplicidades</p>
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className="flex-1 flex flex-col gap-4 overflow-hidden">
          {balanceValidation && (
            <div className={`glass-card !p-3 shrink-0 border ${balanceValidation.isClose ? 'border-green-500/30 bg-green-500/10' : 'border-yellow-500/30 bg-yellow-500/10'}`}>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[11px] sm:text-[10px] uppercase tracking-widest text-white/50 font-bold">Validação de Saldo (pré-importação)</div>
                  <div className="text-sm sm:text-xs text-white/80 mt-1">
                    Saldo final esperado x saldo do extrato
                  </div>
                </div>
                <div className="text-right text-[11px] leading-5">
                  <div>Esperado: <span className="font-bold">R$ {balanceValidation.expectedFinal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                  <div>Extrato: <span className="font-bold">R$ {balanceValidation.statementFinal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                  <div className={balanceValidation.isClose ? 'text-green-300' : 'text-yellow-300'}>
                    Diferença: {balanceValidation.diff >= 0 ? '+' : '-'} R$ {Math.abs(balanceValidation.diff).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>
              {!balanceValidation.isClose && (
                <div className="text-[11px] sm:text-[10px] text-yellow-200/90 mt-2">
                  A diferença indica que algum lançamento pode estar pendente, desmarcado ou com valor/categoria incorreto.
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 shrink-0">
            <div className="flex-1 glass-card !p-3 flex items-center justify-between">
              <div className="flex items-center gap-6">
                <div className="flex flex-col">
                  <span className="text-[8px] text-white/40 uppercase font-bold">Lancamentos</span>
                  <span className="text-sm font-bold">{importedData.length}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[8px] text-white/40 uppercase font-bold">Prontos</span>
                  <span className="text-sm font-bold text-green-400">{importedData.filter(i => i.status === 'ready').length}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[8px] text-white/40 uppercase font-bold">Erros</span>
                  <span className="text-sm font-bold text-red-400">{importedData.filter(i => i.status === 'error').length}</span>
                </div>
              </div>
              <button
                onClick={handleFinalImport}
                className="px-4 py-2 bg-brand-primary text-white text-[11px] sm:text-[10px] font-bold uppercase tracking-widest rounded-lg hover:bg-brand-primary/80 transition-all flex items-center gap-2"
              >
                Confirmar Importacao <ChevronRight size={14} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto no-scrollbar space-y-2">
            {importedData.map(item => (
              <div
                key={item.id}
                className={`p-4 rounded-xl border transition-all flex items-center gap-4 ${
                  item.status === 'ready' ? 'bg-white/5 border-white/5' : 'bg-red-500/5 border-red-500/20'
                }`}
              >
                <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
                  item.type === 'income' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                }`}>
                  <ArrowRightLeft size={20} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm sm:text-xs font-bold truncate">{item.description}</span>
                    {item.status === 'error' && (
                      <span className="text-[8px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded uppercase font-bold">Campo faltando</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[11px] sm:text-[10px] text-white/40">{new Date(item.date).toLocaleDateString('pt-BR')}</span>
                    <span className="text-[11px] sm:text-[10px] text-white/40 uppercase font-bold tracking-tighter bg-white/5 px-1.5 rounded">{item.category}</span>
                    <span className="text-[11px] sm:text-[10px] text-white/20 truncate">{item.original_description}</span>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className={`text-sm font-bold ${item.type === 'income' ? 'text-green-400' : 'text-white'}`}>
                    {item.type === 'income' ? '+' : '-'} R$ {item.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </div>
                  <div className="text-[8px] text-white/40 uppercase font-bold">{item.bank_source}</div>
                </div>

                <div className="flex items-center gap-1 shrink-0 ml-4">
                  <button
                    onClick={() => handleToggleStatus(item.id)}
                    className={`p-2 rounded-lg transition-colors ${item.status === 'ready' ? 'text-green-400 bg-green-400/10' : 'text-white/20 hover:text-white/40 bg-white/5'}`}
                  >
                    <Check size={16} />
                  </button>
                  <button
                    onClick={() => handleRemove(item.id)}
                    className="p-2 text-white/20 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
            {importedData.length === 0 && (
              <div className="p-4 rounded-xl border border-yellow-500/20 bg-yellow-500/5 text-sm sm:text-xs text-yellow-300">
                Nenhum lancamento valido encontrado. Para XLSX/imagem ainda falta parser no app. Se puder, exporte o extrato em CSV, OFX ou PDF.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

