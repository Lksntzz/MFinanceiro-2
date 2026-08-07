import React, { useState, useCallback, useEffect, useRef } from 'react';
import { FinancialAccount, ImportedTransaction, StatementImportOptions } from '../types';
import { identifyCompany } from '../lib/company-aliases';
import { standardizeBankCsv } from '../lib/bank-csv-normalizer';
import { standardizeBankSheet } from '../lib/bank-excel-normalizer';
import { supabase } from '../lib/supabase';
import * as XLSX from 'xlsx';
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
  ShieldCheck,
  AlertCircle
} from 'lucide-react';

interface ImportarExtratosProps {
  onImport: (
    transactions: ImportedTransaction[],
    newBalance: number | undefined,
    options: StatementImportOptions,
  ) => Promise<number>;
  onCancel: () => void;
  accounts: FinancialAccount[];
  accountHolderName?: string;
  internalAccountAliases?: string[];
}

type FileFormat = 'csv' | 'ofx' | 'pdf' | 'xls' | 'xlsx' | 'image' | 'unknown';

interface FormatDetectionResult {
  format: FileFormat;
  formatLabel: string;
  parserLabel: string;
  parserExists: boolean;
  supported: boolean;
  reason?: string;
}

interface ImportDiagnostics {
  fileName: string;
  mimeType: string;
  fileSize: number;
  fileLastModified: number;
  formatLabel: string;
  parserLabel: string;
  parserExists: boolean;
  supported: boolean;
  totalFound: number;
  validFound: number;
  linesExtracted: number;
  linesIgnored: number;
  rejectedLineReasons: string[];
  reason?: string;
  debugNote?: string;
  baseTextPreview?: string;
  ocrExtractionId?: string;
  ocrDocumentConfidence?: number;
}

interface DelimitedAnalysis {
  nonEmptyLines: number;
  hasHeaderKeywords: boolean;
  hasTransactionSignals: boolean;
}

interface SpreadsheetAnalysis {
  csv: string;
  nonEmptyRows: number;
  hasHeaderKeywords: boolean;
  hasTransactionSignals: boolean;
  selectedSheetName?: string;
}

interface ParserDebugSummary {
  linesExtracted: number;
  linesIgnored: number;
  rejectedLineReasons: string[];
}

async function hashImportFile(file: File): Promise<string | undefined> {
  if (!globalThis.crypto?.subtle) return undefined;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function extractStatementWithOcr(file: File, accountId: string): Promise<{
  extractionId: string;
  transactions: ImportedTransaction[];
  documentConfidence: number;
  warnings: string[];
}> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error('Sua sessão expirou antes do OCR. Entre novamente.');
  if (!accountId) throw new Error('Selecione a conta financeira antes de usar o OCR.');

  const extractionId = crypto.randomUUID();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-180) || 'extrato';
  const storagePath = `${userData.user.id}/${extractionId}/${safeName}`;
  const fileHash = await hashImportFile(file);
  const sourceMimeType = inferFileMimeType(file);
  const { error: uploadError } = await supabase.storage
    .from('mf-import-documents')
    .upload(storagePath, file, { upsert: false, contentType: sourceMimeType });
  if (uploadError) throw uploadError;

  const { data: extraction, error: extractionError } = await supabase
    .from('mf_document_extractions')
    .insert({
      id: extractionId,
      user_id: userData.user.id,
      account_id: accountId,
      source_file_path: storagePath,
      source_file_name: file.name,
      source_mime_type: sourceMimeType,
      source_file_size: file.size,
      source_file_hash: fileHash || null,
      document_type: 'statement',
      status: 'uploaded',
    })
    .select('id')
    .single();
  if (extractionError || !extraction) {
    await supabase.storage.from('mf-import-documents').remove([storagePath]);
    throw extractionError || new Error('Não foi possível registrar o documento para OCR.');
  }

  const { data, error: functionError } = await supabase.functions.invoke('statement-ocr', {
    body: { extractionId: extraction.id },
  });
  if (functionError) throw functionError;
  if (data?.error) throw new Error(String(data.error));

  const rawItems = Array.isArray(data?.items) ? data.items as Array<Record<string, unknown>> : [];
  const transactions = rawItems.map((item, index) => {
    const signedAmount = Number(item.signed_amount || 0);
    const type: ImportedTransaction['type'] = item.transaction_type === 'income' || signedAmount > 0 ? 'income' : 'expense';
    const confidence = Math.min(1, Math.max(0, Number(item.overall_confidence || 0)));
    const description = String(item.description || '').trim() || 'Sem descricao';
    const date = String(item.transaction_date || '');
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && description !== 'Sem descricao' && Math.abs(signedAmount) > 0;
    return {
      id: generateId('ocr', index),
      extraction_item_id: String(item.id || '') || undefined,
      date: date || new Date().toISOString().slice(0, 10),
      description,
      amount: Math.abs(signedAmount),
      source_id: String(item.external_id || '') || undefined,
      type,
      category: String(item.category_name || 'Geral'),
      status: valid && confidence >= 0.85 ? 'ready' : valid ? 'pending' : 'error',
      confidence,
      original_description: description,
      bank_source: String(item.source_name || 'OCR/IA'),
      running_balance: Number.isFinite(Number(item.running_balance)) ? Number(item.running_balance) : undefined,
      source: 'ocr_ai',
      review_status: 'pending',
    } satisfies ImportedTransaction;
  });

  const warnings = Array.isArray(data?.warnings)
    ? data.warnings.map(String)
    : ['Revise as linhas e confirme manualmente os itens com confiança abaixo de 85%.'];
  return {
    extractionId: extraction.id,
    transactions,
    documentConfidence: Math.min(1, Math.max(0, Number(data?.documentConfidence || 0))),
    warnings,
  };
}

function inferFileMimeType(file: File): string {
  if (file.type) return file.type.toLowerCase();
  const extension = file.name.split('.').pop()?.toLowerCase();
  const byExtension: Record<string, string> = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  };
  return byExtension[extension || ''] || 'application/octet-stream';
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

function analyzeDelimitedContent(content: string): DelimitedAnalysis {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.replace(/\uFEFF/g, '').trim())
    .filter(Boolean);

  const dateRegex = /\b\d{2}[./-]\d{2}(?:[./-]\d{2,4})?\b|\b\d{4}-\d{2}-\d{2}\b/;
  const amountRegex = /(?:R\$\s*)?[+-]?\s*\d[\d.\s]*[,.]\d{2}-?/;
  const headerKeywords = /(data|date|descricao|hist[óo]rico|description|valor|amount|debito|credito|saldo|lan[çc]amento)/i;

  const hasHeaderKeywords = lines.some((line) => headerKeywords.test(line));
  const hasTransactionSignals = lines.some((line) => dateRegex.test(line) && amountRegex.test(line));

  return {
    nonEmptyLines: lines.length,
    hasHeaderKeywords,
    hasTransactionSignals,
  };
}

async function analyzeSpreadsheetContent(file: File): Promise<SpreadsheetAnalysis> {
  const bytes = await file.arrayBuffer();
  const workbook = XLSX.read(bytes, { type: 'array' });
  const sheetNames = workbook.SheetNames || [];
  if (sheetNames.length === 0) {
    return { csv: '', nonEmptyRows: 0, hasHeaderKeywords: false, hasTransactionSignals: false };
  }
  
  let best: SpreadsheetAnalysis = {
    csv: '',
    nonEmptyRows: 0,
    hasHeaderKeywords: false,
    hasTransactionSignals: false,
    selectedSheetName: sheetNames[0],
  };

  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const csv = standardizeBankSheet(sheet) || XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    const analysis = analyzeDelimitedContent(csv);
    const candidate: SpreadsheetAnalysis = {
      csv,
      nonEmptyRows: analysis.nonEmptyLines,
      hasHeaderKeywords: analysis.hasHeaderKeywords,
      hasTransactionSignals: analysis.hasTransactionSignals,
      selectedSheetName: sheetName,
    };

    const bestScore =
      (best.hasTransactionSignals ? 1000 : 0) +
      (best.hasHeaderKeywords ? 100 : 0) +
      best.nonEmptyRows;
    const candidateScore =
      (candidate.hasTransactionSignals ? 1000 : 0) +
      (candidate.hasHeaderKeywords ? 100 : 0) +
      candidate.nonEmptyRows;

    if (candidateScore > bestScore) {
      best = candidate;
    }
  }

  return best;
}

function inferEmptyResultReason(params: {
  fileName?: string;
  format: FileFormat;
  csvAnalysis?: DelimitedAnalysis;
  sheetAnalysis?: SpreadsheetAnalysis;
  ofxContent?: string;
  pdfReason?: string;
}): string {
  const { fileName, format, csvAnalysis, sheetAnalysis, ofxContent, pdfReason } = params;
  const normalizedFileName = normalizeHeader(fileName || '');
  const isMfinanceiroExport = normalizedFileName.includes('mfinanceirorelatoriotransacoes');

  if (format === 'pdf') {
    return pdfReason || 'nenhum registro de transacao encontrado';
  }

  if (format === 'csv') {
    if (isMfinanceiroExport && (!csvAnalysis || csvAnalysis.nonEmptyLines === 0)) {
      return 'arquivo do MFinanceiro sem transacoes para importar';
    }
    if (!csvAnalysis || csvAnalysis.nonEmptyLines === 0) return 'planilha vazia';
    if (csvAnalysis.nonEmptyLines <= 1 && csvAnalysis.hasHeaderKeywords) return 'arquivo sem movimentacoes';
    if (!csvAnalysis.hasTransactionSignals) return 'arquivo nao e um extrato bancario';
    return 'nenhum registro de transacao encontrado';
  }

  if (format === 'xls' || format === 'xlsx') {
    if (isMfinanceiroExport && (!sheetAnalysis || sheetAnalysis.nonEmptyRows === 0)) {
      return 'arquivo do MFinanceiro sem transacoes para importar';
    }
    if (!sheetAnalysis || sheetAnalysis.nonEmptyRows === 0) return 'planilha vazia';
    if (sheetAnalysis.nonEmptyRows <= 1 && sheetAnalysis.hasHeaderKeywords) return 'arquivo sem movimentacoes';
    if (!sheetAnalysis.hasTransactionSignals) return 'arquivo nao e um extrato bancario';
    return 'nenhum registro de transacao encontrado';
  }

  if (format === 'ofx') {
    const content = ofxContent || '';
    if (!content.trim()) return 'arquivo sem movimentacoes';
    if (!/<OFX|<BANKTRANLIST|<STMTTRN>/i.test(content)) return 'arquivo nao e um extrato bancario';
    if (!/<STMTTRN>/i.test(content)) return 'arquivo sem movimentacoes';
    return 'nenhum registro de transacao encontrado';
  }

  return 'nenhum registro de transacao encontrado';
}

function buildTextPreview(raw: string | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280);
}

async function cloneFileForSession(source: File): Promise<File> {
  const buffer = await source.arrayBuffer();
  return new File([buffer], source.name, {
    type: source.type,
    lastModified: source.lastModified
  });
}

function getInvalidLineReasons(items: ImportedTransaction[]): string[] {
  const reasons: string[] = [];
  for (const item of items) {
    if (item.status !== 'error') continue;
    if (!item.description || item.description === 'Sem descricao') {
      reasons.push(`Linha rejeitada: descricao ausente (${item.id})`);
      continue;
    }
    if (!item.amount || Math.abs(item.amount) <= 0) {
      reasons.push(`Linha rejeitada: valor invalido (${item.id})`);
      continue;
    }
    if (!item.date || Number.isNaN(new Date(item.date).getTime())) {
      reasons.push(`Linha rejeitada: data invalida (${item.id})`);
      continue;
    }
    reasons.push(`Linha rejeitada: nao reconhecida como transacao (${item.id})`);
  }
  return reasons;
}

function ensureMinimumTransactionFields(items: ImportedTransaction[]): ImportedTransaction[] {
  return items.map((item) => ({
    ...item,
    source: item.source || item.bank_source || 'importacao_extrato',
    categorySuggestion: item.categorySuggestion || item.category || 'Geral',
  }));
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
  // Tenta usar a engine de identificação avançada primeiro
  const identified = identifyCompany(description);
  
  if (identified) {
    // Mapeia categorias do alias para as categorias do app
    const categoryMap: { [key: string]: string } = {
      'internet_telefonia': 'Contas Fixas',
      'agua_saneamento': 'Contas Fixas',
      'energia_eletrica': 'Contas Fixas',
      'bancos_financeiras': 'Geral',
      'emprestimos_acordos': 'Geral',
      'alimentacao': 'Alimentação',
      'transporte': 'Transporte',
      'saude': 'Saúde',
      'lazer': 'Lazer',
      'educacao': 'Educação'
    };
    return categoryMap[identified.category] || 'Geral';
  }

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

export function detectFileFormat(file: File): FormatDetectionResult {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const mime = file.type.toLowerCase();

  if (ext === 'csv' || mime.includes('csv')) {
    return { format: 'csv', formatLabel: 'CSV', parserLabel: 'Parser CSV', parserExists: true, supported: true };
  }
  if (ext === 'ofx' || mime.includes('ofx')) {
    return { format: 'ofx', formatLabel: 'OFX', parserLabel: 'Parser OFX', parserExists: true, supported: true };
  }
  if (ext === 'pdf' || mime.includes('pdf')) {
    return { format: 'pdf', formatLabel: 'PDF', parserLabel: 'Parser PDF', parserExists: true, supported: true };
  }
  if (ext === 'xlsx') {
    return { format: 'xlsx', formatLabel: 'XLSX', parserLabel: 'Parser XLSX', parserExists: true, supported: true };
  }
  if (ext === 'xls') {
    return { format: 'xls', formatLabel: 'XLS', parserLabel: 'Parser XLS', parserExists: true, supported: true };
  }
  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
    return {
      format: 'image',
      formatLabel: 'Imagem',
      parserLabel: 'OCR/IA com revisão',
      parserExists: true,
      supported: true,
    };
  }

  return {
    format: 'unknown',
    formatLabel: ext ? ext.toUpperCase() : 'Desconhecido',
    parserLabel: 'Nao disponivel',
    parserExists: false,
    supported: false,
    reason: 'Formato nao suportado. Use CSV, OFX, PDF, XLS, XLSX ou imagem.'
  };
}

export function normalizeImportedTransactions(items: ImportedTransaction[]): ImportedTransaction[] {
  return items.map((item, idx) => {
    const safeDate = Number.isNaN(new Date(item.date).getTime()) ? new Date().toISOString() : item.date;
    const safeDescription = (item.description || '').trim() || 'Sem descricao';
    const safeAmount = Math.abs(Number(item.amount) || 0);
    const safeType: 'income' | 'expense' = item.type === 'income' ? 'income' : 'expense';
    const isValid = safeDescription !== 'Sem descricao' && safeAmount > 0;
    const normalizedStatus: ImportedTransaction['status'] =
      isValid && item.status !== 'error' ? item.status : (isValid ? 'ready' : 'error');

    return {
      ...item,
      id: item.id || generateId('imported', idx),
      date: safeDate,
      description: safeDescription,
      amount: safeAmount,
      type: safeType,
      status: normalizedStatus
    };
  });
}

export function parseCsvTransactions(content: string, bank: string): ImportedTransaction[] {
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

export function parseOfxTransactions(content: string, bank: string): ImportedTransaction[] {
  const blocks = content.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) || [];
  
  // Extrai o saldo final do extrato (Ledger Balance)
  const ledgerBalMatch = content.match(/<LEDGERBAL>[\s\S]*?<BALAMT>([\d.,-]+)/i);
  const finalLedgerBalance = ledgerBalMatch ? parseAmount(ledgerBalMatch[1]) : undefined;

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
    const status: 'ready' | 'error' = trnAmt !== 0 ? 'ready' : 'error';

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
      bank_source: bank === 'auto' ? 'Importado OFX' : bank,
      // No OFX, atribuímos o saldo final apenas ao último lançamento para o validador de saldo usá-lo
      running_balance: (index === blocks.length - 1) ? finalLedgerBalance : undefined
    };
  });
}

export async function parsePdfTransactions(
  file: File,
  selectedBank: string,
  options?: { accountHolderName?: string; internalAccountAliases?: string[] }
): Promise<ImportedTransaction[]> {
  const { parsePdfStatementWithDebug } = await import('../lib/import-parsers/pdf/parse-pdf-statement');
  const { transactions } = await parsePdfStatementWithDebug(file, selectedBank, options);
  return transactions;
}

export async function parseSpreadsheetTransactions(file: File, selectedBank: string): Promise<ImportedTransaction[]> {
  const { csv } = await analyzeSpreadsheetContent(file);
  if (!csv.trim()) return [];

  return parseCsvTransactions(csv, selectedBank);
}

export default function ImportarExtratos({
  onImport,
  onCancel,
  accounts,
  accountHolderName,
  internalAccountAliases
}: ImportarExtratosProps) {
  const importSessionRef = useRef(0);
  const pdfPasswordResolverRef = useRef<((password: string | null) => void) | null>(null);
  const [step, setStep] = useState<'upload' | 'processing' | 'review' | 'success'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [bank, setBank] = useState<string>('auto');
  const [importedData, setImportedData] = useState<ImportedTransaction[]>([]);
  const [importDiagnostics, setImportDiagnostics] = useState<ImportDiagnostics | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [balanceMode, setBalanceMode] = useState<'keep' | 'apply_new' | 'statement'>('keep');
  const [reviewAcknowledged, setReviewAcknowledged] = useState(false);
  const [ocrExtractionId, setOcrExtractionId] = useState<string | null>(null);
  const [rejectedOcrItemIds, setRejectedOcrItemIds] = useState<string[]>([]);
  const [pdfPasswordPrompt, setPdfPasswordPrompt] = useState<{ fileName?: string; incorrect?: boolean } | null>(null);
  const [pdfPassword, setPdfPassword] = useState('');
  const [showPdfPassword, setShowPdfPassword] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [committedCount, setCommittedCount] = useState(0);
  const [selectedAccountId, setSelectedAccountId] = useState(
    () => accounts.find((account) => account.is_default && account.is_active)?.id
      || accounts.find((account) => account.is_active)?.id
      || '',
  );
  const readyItemsCount = importedData.filter(i => i.status === 'ready').length;
  const canConfirmImport = readyItemsCount > 0 && Boolean(selectedAccountId) && reviewAcknowledged;

  useEffect(() => {
    if (accounts.some((account) => account.id === selectedAccountId && account.is_active)) return;
    setSelectedAccountId(
      accounts.find((account) => account.is_default && account.is_active)?.id
        || accounts.find((account) => account.is_active)?.id
        || '',
    );
  }, [accounts, selectedAccountId]);

  useEffect(() => () => {
    pdfPasswordResolverRef.current?.(null);
    pdfPasswordResolverRef.current = null;
  }, []);

  const requestPdfPassword = useCallback((options: { fileName?: string; incorrect?: boolean }) => {
    pdfPasswordResolverRef.current?.(null);
    setPdfPassword('');
    setShowPdfPassword(false);
    setPdfPasswordPrompt(options);
    return new Promise<string | null>((resolve) => {
      pdfPasswordResolverRef.current = resolve;
    });
  }, []);

  const finishPdfPassword = useCallback((value: string | null) => {
    const resolve = pdfPasswordResolverRef.current;
    pdfPasswordResolverRef.current = null;
    setPdfPassword('');
    setPdfPasswordPrompt(null);
    resolve?.(value);
  }, []);

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
    e.currentTarget.value = '';
  };

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const resetImportState = useCallback((targetStep: 'upload' | 'processing' = 'upload') => {
    importSessionRef.current += 1;
    setFile(null);
    setImportedData([]);
    setImportDiagnostics(null);
    setBalanceMode('keep');
    setReviewAcknowledged(false);
    setOcrExtractionId(null);
    setRejectedOcrItemIds([]);
    setImportError(null);
    setCommittedCount(0);
    setStep(targetStep);
  }, []);

  const processFile = async (selectedFile: File) => {
    const sessionId = ++importSessionRef.current;
    const isStale = () => importSessionRef.current !== sessionId;
    const fileSnapshot = await cloneFileForSession(selectedFile);

    setFile(fileSnapshot);
    setImportedData([]);
    setImportDiagnostics(null);
    setStep('processing');
    setBalanceMode('keep');
    setReviewAcknowledged(false);
    setOcrExtractionId(null);
    setRejectedOcrItemIds([]);
    setImportError(null);
    setCommittedCount(0);

    try {
      const detection = detectFileFormat(fileSnapshot);
      let parsed: ImportedTransaction[] = [];
      let csvAnalysis: DelimitedAnalysis | undefined;
      let sheetAnalysis: SpreadsheetAnalysis | undefined;
      let ofxContent = '';
      let rawTextPreview = '';
      let ocrDocumentConfidence: number | null = null;
      let currentOcrExtractionId: string | null = null;
      let ocrWarnings: string[] = [];
      let parserDebug: ParserDebugSummary = { linesExtracted: 0, linesIgnored: 0, rejectedLineReasons: [] };
      let pdfDebugInfo: {
        totalPages: number;
        totalTextItems: number;
        linesExtracted: number;
        ignoredLines?: number;
        rejectedLineReasons?: string[];
        usedGenericFallback: boolean;
        isLikelyBankStatement?: boolean;
        hasTransactionPattern?: boolean;
        reason?: string;
        textPreview: string;
      } | null = null;

      if (!detection.supported || !detection.parserExists) {
        if (isStale()) return;
        setImportedData([]);
        setImportDiagnostics({
          fileName: selectedFile.name,
          mimeType: fileSnapshot.type || 'desconhecido',
          fileSize: fileSnapshot.size,
          fileLastModified: fileSnapshot.lastModified,
          formatLabel: detection.formatLabel,
          parserLabel: detection.parserLabel,
          parserExists: detection.parserExists,
          supported: detection.supported,
          totalFound: 0,
          validFound: 0,
          linesExtracted: 0,
          linesIgnored: 0,
          rejectedLineReasons: [],
          reason: detection.reason || 'Formato nao suportado para importacao.'
        });
        setStep('review');
        return;
      }

      if (detection.format === 'csv') {
        const rawContent = await fileSnapshot.text();
        const content = standardizeBankCsv(rawContent, fileSnapshot.name) || rawContent;
        rawTextPreview = buildTextPreview(content);
        csvAnalysis = analyzeDelimitedContent(content);
        parsed = parseCsvTransactions(content, bank);
        const rejected = getInvalidLineReasons(parsed);
        parserDebug = {
          linesExtracted: Math.max(csvAnalysis.nonEmptyLines - 1, 0),
          linesIgnored: rejected.length,
          rejectedLineReasons: rejected
        };
      } else if (detection.format === 'ofx') {
        ofxContent = await fileSnapshot.text();
        rawTextPreview = buildTextPreview(ofxContent);
        parsed = parseOfxTransactions(ofxContent, bank);
        const rejected = getInvalidLineReasons(parsed);
        parserDebug = {
          linesExtracted: (ofxContent.match(/<STMTTRN>/gi) || []).length,
          linesIgnored: rejected.length,
          rejectedLineReasons: rejected
        };
      } else if (detection.format === 'pdf') {
        const { parsePdfStatementWithDebug } = await import('../lib/import-parsers/pdf/parse-pdf-statement');
        const pdfResult = await parsePdfStatementWithDebug(fileSnapshot, bank, {
          accountHolderName,
          internalAccountAliases,
          requestPassword: requestPdfPassword,
        });
        parsed = pdfResult.transactions;
        pdfDebugInfo = pdfResult.debug;
        rawTextPreview = buildTextPreview(pdfResult.debug.textPreview);
        parserDebug = {
          linesExtracted: pdfResult.debug.linesExtracted,
          linesIgnored: pdfResult.debug.ignoredLines || 0,
          rejectedLineReasons: pdfResult.debug.rejectedLineReasons || []
        };
        const hasValidLocalRows = parsed.some((item) => item.status === 'ready' && Number(item.amount) > 0);
        if (!hasValidLocalRows) {
          try {
            const ocrResult = await extractStatementWithOcr(fileSnapshot, selectedAccountId);
            parsed = ocrResult.transactions;
            currentOcrExtractionId = ocrResult.extractionId;
            ocrDocumentConfidence = ocrResult.documentConfidence;
            ocrWarnings = ocrResult.warnings;
            parserDebug = {
              linesExtracted: parsed.length,
              linesIgnored: parsed.filter((item) => item.status !== 'ready').length,
              rejectedLineReasons: ocrWarnings,
            };
          } catch (ocrError) {
            pdfDebugInfo = {
              ...pdfResult.debug,
              reason: `${pdfResult.debug.reason || 'PDF sem texto transacional.'} OCR/IA indisponível: ${ocrError instanceof Error ? ocrError.message : 'falha desconhecida'}`,
            };
          }
        }
      } else if (detection.format === 'xls' || detection.format === 'xlsx') {
        sheetAnalysis = await analyzeSpreadsheetContent(fileSnapshot);
        rawTextPreview = buildTextPreview(sheetAnalysis.csv);
        parsed = sheetAnalysis.csv.trim() ? parseCsvTransactions(sheetAnalysis.csv, bank) : [];
        const rejected = getInvalidLineReasons(parsed);
        parserDebug = {
          linesExtracted: Math.max(sheetAnalysis.nonEmptyRows - 1, 0),
          linesIgnored: rejected.length,
          rejectedLineReasons: rejected
        };
      } else if (detection.format === 'image') {
        const ocrResult = await extractStatementWithOcr(fileSnapshot, selectedAccountId);
        parsed = ocrResult.transactions;
        currentOcrExtractionId = ocrResult.extractionId;
        ocrDocumentConfidence = ocrResult.documentConfidence;
        ocrWarnings = ocrResult.warnings;
        parserDebug = {
          linesExtracted: parsed.length,
          linesIgnored: parsed.filter((item) => item.status !== 'ready').length,
          rejectedLineReasons: ocrWarnings,
        };
      }

      if (isStale()) return;

      const normalized = ensureMinimumTransactionFields(normalizeImportedTransactions(parsed));
      const validFound = normalized.filter(
        (item) => item.status === 'ready' && item.amount > 0 && item.description !== 'Sem descricao'
      ).length;

      setImportedData(normalized);
      setOcrExtractionId(currentOcrExtractionId);
      let debugNote: string | undefined;
      if (ocrDocumentConfidence !== null) {
        debugNote = `OCR/IA -> confiança do documento: ${Math.round(ocrDocumentConfidence * 100)}%; revisão humana obrigatória; ${ocrWarnings.join(' | ')}`;
      } else if (detection.format === 'pdf' && pdfDebugInfo) {
        const preview = pdfDebugInfo.textPreview ? ` | Texto extraido: "${pdfDebugInfo.textPreview}"` : '';
        debugNote = `PDF Debug -> paginas: ${pdfDebugInfo.totalPages}, itens de texto: ${pdfDebugInfo.totalTextItems}, linhas extraidas: ${pdfDebugInfo.linesExtracted}, linhas ignoradas: ${pdfDebugInfo.ignoredLines || 0}, perfil extrato: ${pdfDebugInfo.isLikelyBankStatement ? 'sim' : 'nao'}, padrao transacao: ${pdfDebugInfo.hasTransactionPattern ? 'sim' : 'nao'}, fallback generico: ${pdfDebugInfo.usedGenericFallback ? 'sim' : 'nao'}${preview}`;
      } else if ((detection.format === 'xls' || detection.format === 'xlsx') && sheetAnalysis) {
        debugNote = `XLSX Debug -> aba usada: ${sheetAnalysis.selectedSheetName || 'desconhecida'}, linhas nao vazias: ${sheetAnalysis.nonEmptyRows}, sinais de transacao: ${sheetAnalysis.hasTransactionSignals ? 'sim' : 'nao'}`;
      } else if (detection.format === 'csv' && csvAnalysis) {
        debugNote = `CSV Debug -> linhas nao vazias: ${csvAnalysis.nonEmptyLines}, sinais de transacao: ${csvAnalysis.hasTransactionSignals ? 'sim' : 'nao'}`;
      } else if (detection.format === 'ofx') {
        debugNote = `OFX Debug -> blocos STMTTRN: ${(ofxContent.match(/<STMTTRN>/gi) || []).length}`;
      }
      const zeroResultReason = inferEmptyResultReason({
        fileName: fileSnapshot.name,
        format: detection.format,
        csvAnalysis,
        sheetAnalysis,
        ofxContent,
        pdfReason: pdfDebugInfo?.reason,
      });
      setImportDiagnostics({
        fileName: selectedFile.name,
        mimeType: fileSnapshot.type || 'desconhecido',
        fileSize: fileSnapshot.size,
        fileLastModified: fileSnapshot.lastModified,
        formatLabel: detection.formatLabel,
        parserLabel: detection.parserLabel,
        parserExists: detection.parserExists,
        supported: detection.supported,
        totalFound: normalized.length,
        validFound,
        linesExtracted: parserDebug.linesExtracted,
        linesIgnored: parserDebug.linesIgnored,
        rejectedLineReasons: parserDebug.rejectedLineReasons,
        reason: validFound === 0
          ? zeroResultReason
          : undefined,
        debugNote,
        baseTextPreview: rawTextPreview,
        ocrExtractionId: currentOcrExtractionId || undefined,
        ocrDocumentConfidence: ocrDocumentConfidence ?? undefined,
      });
      if (isStale()) return;
      setStep('review');
    } catch (error) {
      if (isStale()) return;
      console.error('Erro ao processar arquivo:', error);
      setImportedData([]);
      setImportDiagnostics({
        fileName: selectedFile.name,
        mimeType: fileSnapshot.type || 'desconhecido',
        fileSize: fileSnapshot.size,
        fileLastModified: fileSnapshot.lastModified,
        formatLabel: detectFileFormat(fileSnapshot).formatLabel,
        parserLabel: detectFileFormat(fileSnapshot).parserLabel,
        parserExists: true,
        supported: true,
        totalFound: 0,
        validFound: 0,
        linesExtracted: 0,
        linesIgnored: 0,
        rejectedLineReasons: [],
        reason: 'Falha ao ler o arquivo. Verifique o formato e tente novamente.'
      });
      setStep('review');
    }
  };

  const handleToggleStatus = (id: string) => {
    setReviewAcknowledged(false);
    setImportedData(prev => prev.map(item => {
      if (item.id === id) {
        if (item.status === 'error' && (item.amount <= 0 || item.description === 'Sem descricao')) {
          return item;
        }
        const selected = item.status !== 'ready';
        return {
          ...item,
          status: selected ? 'ready' : 'pending',
          review_status: item.extraction_item_id ? (selected ? 'accepted' : 'pending') : item.review_status,
        };
      }
      return item;
    }));
  };

  const handleRemove = (id: string) => {
    setReviewAcknowledged(false);
    setImportedData(prev => {
      const removed = prev.find((item) => item.id === id);
      if (removed?.extraction_item_id) {
        setRejectedOcrItemIds((current) => current.includes(removed.extraction_item_id!)
          ? current
          : [...current, removed.extraction_item_id!]);
      }
      return prev.filter(item => item.id !== id);
    });
  };

  const handleUpdateItem = (id: string, patch: Partial<ImportedTransaction>) => {
    setReviewAcknowledged(false);
    setImportedData((current) => current.map((item) => {
      if (item.id !== id) return item;
      const next = { ...item, ...patch };
      const valid = /^\d{4}-\d{2}-\d{2}$/.test(next.date)
        && next.description.trim().length > 0
        && Number(next.amount) > 0;
      return {
        ...next,
        status: valid ? 'ready' : 'error',
        confidence: Math.min(Number(next.confidence || 0), 0.99),
        review_status: 'edited',
      };
    }));
  };

  async function persistOcrReview() {
    if (!ocrExtractionId) return;

    const updates = importedData
      .filter((item) => item.extraction_item_id)
      .map((item) => supabase
        .from('mf_document_extraction_items')
        .update({
          transaction_date: item.date.slice(0, 10),
          description: item.description,
          signed_amount: item.type === 'income' ? Math.abs(item.amount) : -Math.abs(item.amount),
          transaction_type: item.type,
          source_name: item.bank_source || item.source || 'OCR/IA',
          external_id: item.source_id || null,
          running_balance: item.running_balance ?? null,
          category_name: item.category || 'Geral',
          reviewed_at: new Date().toISOString(),
          review_status: item.status === 'ready'
            ? (item.review_status === 'edited' ? 'edited' : 'accepted')
            : 'rejected',
          reviewer_notes: item.status === 'ready' ? 'Revisado antes da importação.' : 'Não selecionado na revisão.',
        })
        .eq('id', item.extraction_item_id!)
        .eq('extraction_id', ocrExtractionId));

    if (rejectedOcrItemIds.length) {
      updates.push(supabase
        .from('mf_document_extraction_items')
        .update({ review_status: 'rejected', reviewer_notes: 'Removido durante a revisão humana.' })
        .eq('extraction_id', ocrExtractionId)
        .in('id', rejectedOcrItemIds));
    }

    const results = await Promise.all(updates);
    const failed = results.find((result) => result.error);
    if (failed?.error) throw new Error(`Não foi possível salvar a revisão do OCR: ${failed.error.message}`);
  }

  const handleFinalImport = async () => {
    if (!canConfirmImport || isImporting) return;

    const calibrationBalance = balanceMode === 'statement' && balanceValidation ? balanceValidation.statementFinal : undefined;

    setIsImporting(true);
    setImportError(null);

    try {
      if (!file || !selectedAccountId) throw new Error('Selecione um arquivo e a conta financeira de destino.');
      await persistOcrReview();
      const fileHash = await hashImportFile(file);
      const insertedCount = await onImport(importedData, calibrationBalance, {
        accountId: selectedAccountId,
        balanceMode,
        fileName: file.name,
        fileType: file.type || undefined,
        fileSize: file.size,
        fileHash,
        parserName: importDiagnostics?.parserLabel,
        diagnostics: importDiagnostics
          ? { ...importDiagnostics } as unknown as Record<string, unknown>
          : undefined,
      });
      setCommittedCount(insertedCount);
      if (ocrExtractionId) {
        const { error: extractionError } = await supabase
          .from('mf_document_extractions')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('id', ocrExtractionId);
        if (extractionError) console.warn('A revisão OCR não pôde ser encerrada após a importação:', extractionError.message);
      }
      setStep('success');
    } catch (error) {
      console.error('Falha ao importar lançamentos:', error);
      setImportError(
        error instanceof Error && error.message
          ? error.message
          : 'Não foi possível concluir a importação. Nenhum sucesso foi confirmado.'
      );
    } finally {
      setIsImporting(false);
    }
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
            {committedCount} lancamentos foram adicionados ao seu ledger com sucesso.
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
          <p className="text-xs text-white/40">Traga suas movimentacoes bancarias para o MFinanceiro de forma inteligente.</p>
        </div>
        <button
          onClick={onCancel}
          disabled={isImporting}
          className="p-2 text-white/20 hover:text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40"
        >
          <X size={20} />
        </button>
      </div>

      {step === 'upload' && (
        <div className="flex-1 flex flex-col gap-4 overflow-y-auto no-scrollbar">
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-8 space-y-4">
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
                  <p className="text-[10px] text-white/40 uppercase tracking-widest mt-1">Ou clique para selecionar</p>
                </div>
                <input
                  type="file"
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  onChange={handleFileSelect}
                  accept=".csv,.ofx,.xls,.xlsx,.pdf,image/*"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="glass-card !p-4 flex items-start gap-3">
                  <div className="h-8 w-8 rounded-lg bg-brand-secondary/20 flex items-center justify-center text-brand-secondary">
                    <FileText size={18} />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold">Formatos Suportados</h4>
                    <p className="text-[10px] text-white/40 mt-1">CSV, OFX, Excel, PDF e imagens; OCR/IA exige revisão humana.</p>
                  </div>
                </div>
                <div className="glass-card !p-4 flex items-start gap-3">
                  <div className="h-8 w-8 rounded-lg bg-brand-primary/20 flex items-center justify-center text-brand-primary">
                    <ShieldCheck size={18} />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold">Seguranca de Dados</h4>
                    <p className="text-[10px] text-white/40 mt-1">Arquivos de OCR ficam em armazenamento privado e a chave de IA permanece no servidor.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="col-span-4 space-y-4">
              <div className="glass-card !p-5 space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                  <Filter size={14} className="text-white/40" /> Configuracao
                </h3>
                <div>
                  <label className="text-[10px] text-white/40 uppercase font-bold block mb-1.5">Banco / Origem</label>
                  <select
                    value={bank}
                    onChange={(e) => setBank(e.target.value)}
                    className="w-full bg-[#121212] border border-white/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-brand-primary transition-all [&>option]:bg-[#121212] [&>option]:text-white"
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
                <h3 className="text-xs font-bold flex items-center gap-2 mb-2">
                  <Info size={14} className="text-brand-primary" /> Dica Pro
                </h3>
                <p className="text-[10px] text-white/60 leading-relaxed">
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
            {file?.name && <p className="text-[10px] text-white/60 mt-1">Arquivo atual: {file.name}</p>}
            <p className="text-[10px] text-white/40 uppercase tracking-widest mt-1">Normalizando dados e detectando duplicidades</p>
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className="flex-1 flex flex-col gap-4 overflow-hidden">
          <div className="glass-card !p-3 shrink-0 border border-brand-primary/20">
            <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-widest text-white/45 sm:flex-row sm:items-center sm:justify-between">
              Conta financeira do extrato
              <select
                value={selectedAccountId}
                onChange={(event) => { setSelectedAccountId(event.target.value); setReviewAcknowledged(false); }}
                disabled={isImporting}
                className="min-w-[220px] rounded-lg border border-white/10 bg-[#121212] px-3 py-2 text-xs font-medium normal-case tracking-normal text-white outline-none focus:border-brand-primary disabled:opacity-50"
              >
                <option value="">Selecione uma conta</option>
                {accounts.filter((account) => account.is_active).map((account) => (
                  <option key={account.id} value={account.id}>{account.name} · {Number(account.current_balance || 0).toLocaleString('pt-BR', { style: 'currency', currency: account.currency || 'BRL' })}</option>
                ))}
              </select>
            </label>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {([
                { id: 'keep', label: 'Preservar saldo atual', detail: 'Importa o histórico sem alterar o saldo de hoje.' },
                { id: 'apply_new', label: 'Aplicar movimentações', detail: 'Soma entradas e saídas novas ao saldo.' },
                { id: 'statement', label: 'Usar saldo do extrato', detail: balanceValidation ? 'Calibra para o saldo final informado.' : 'O arquivo não trouxe saldo final.' },
              ] as const).map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  disabled={mode.id === 'statement' && !balanceValidation}
                  onClick={() => { setBalanceMode(mode.id); setReviewAcknowledged(false); }}
                  className={`rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-35 ${balanceMode === mode.id ? 'border-brand-primary/40 bg-brand-primary/10' : 'border-white/10 bg-white/[0.02]'}`}
                >
                  <strong className="block text-[10px]">{mode.label}</strong>
                  <span className="mt-1 block text-[9px] font-normal normal-case tracking-normal text-white/35">{mode.detail}</span>
                </button>
              ))}
            </div>
          </div>
          {balanceValidation && (
            <div className={`glass-card !p-3 shrink-0 border transition-all ${balanceValidation.isClose ? 'border-green-500/30 bg-green-500/10' : 'border-yellow-500/30 bg-yellow-500/10'}`}>
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div className="text-[10px] uppercase tracking-widest text-white/50 font-bold">Validação de Saldo</div>
                    {balanceValidation.isClose && (
                      <span className="text-[8px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded-full font-bold uppercase">Sincronizado</span>
                    )}
                  </div>
                  <div className="text-xs text-white/80 mt-1">Saldo final extraído do comprovante.</div>
                </div>
                <div className="text-right text-[11px] leading-5 shrink-0">
                  <div className="text-white/40">Esperado: <span className="text-white font-medium">R$ {balanceValidation.expectedFinal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                  <div>Final no Extrato: <span className="font-bold text-white text-sm">R$ {balanceValidation.statementFinal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                  <div className={balanceValidation.isClose ? 'text-green-300' : 'text-yellow-300'}>
                    Diferença: {balanceValidation.diff >= 0 ? '+' : '-'} R$ {Math.abs(balanceValidation.diff).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>
              {balanceMode === 'statement' && (
                <div className="mt-2 py-2 px-3 bg-brand-primary/10 rounded-lg border border-brand-primary/20 flex items-center gap-3">
                  <Info size={14} className="text-brand-primary shrink-0" />
                  <p className="text-[10px] text-brand-primary/80 leading-relaxed font-medium">
                    Ao confirmar, seu saldo atual no sistema será ajustado para <span className="font-bold">R$ {balanceValidation.statementFinal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> após a importação.
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-4 shrink-0">
            <div className="flex-1 glass-card !p-3 flex items-center justify-between">
              <div className="flex flex-wrap items-center gap-6">
                <div className="flex flex-col">
                  <span className="text-[8px] text-white/40 uppercase font-bold">Lancamentos</span>
                  <span className="text-sm font-bold">{importedData.length}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[8px] text-white/40 uppercase font-bold">Prontos</span>
                  <span className="text-sm font-bold text-green-400">{readyItemsCount}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[8px] text-white/40 uppercase font-bold">Erros</span>
                  <span className="text-sm font-bold text-red-400">{importedData.filter(i => i.status === 'error').length}</span>
                </div>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[9px] text-white/60">
                  <input type="checkbox" checked={reviewAcknowledged} onChange={(event) => setReviewAcknowledged(event.target.checked)} disabled={readyItemsCount === 0 || isImporting} />
                  Revisei os itens selecionados e o modo de saldo
                </label>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => resetImportState('upload')}
                  disabled={isImporting}
                  className="px-4 py-2 bg-white/10 text-white text-[10px] font-bold uppercase tracking-widest rounded-lg hover:bg-white/20 transition-all disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Novo Arquivo
                </button>
                <button
                  onClick={handleFinalImport}
                  disabled={!canConfirmImport || isImporting}
                  className={`px-4 py-2 text-[10px] font-bold uppercase tracking-widest rounded-lg transition-all flex items-center gap-2 ${
                    canConfirmImport && !isImporting
                      ? 'bg-brand-primary text-white hover:bg-brand-primary/80'
                      : 'bg-white/10 text-white/40 cursor-not-allowed'
                  }`}
                >
                  {isImporting ? (
                    <>
                      <Loader2 size={14} className="animate-spin" /> Importando...
                    </>
                  ) : (
                    <>
                      Confirmar Importacao <ChevronRight size={14} />
                    </>
                  )}
                </button>
              </div>
            </div>
            {importError && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200" role="alert">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span>A importação não foi concluída: {importError}</span>
              </div>
            )}
          </div>

          {importDiagnostics && (
            <div className="glass-card !p-3 shrink-0 border border-white/10">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
                <div>
                  <div className="text-white/40 uppercase text-[9px] font-bold">Arquivo atual</div>
                  <div className="font-bold truncate">{importDiagnostics.fileName}</div>
                </div>
                <div>
                  <div className="text-white/40 uppercase text-[9px] font-bold">Formato detectado</div>
                  <div className="font-bold">{importDiagnostics.formatLabel}</div>
                </div>
                <div>
                  <div className="text-white/40 uppercase text-[9px] font-bold">Parser</div>
                  <div className="font-bold">{importDiagnostics.parserLabel}</div>
                </div>
                <div>
                  <div className="text-white/40 uppercase text-[9px] font-bold">Tipo detectado</div>
                  <div className="font-bold">{importDiagnostics.mimeType || 'desconhecido'}</div>
                </div>
                <div>
                  <div className="text-white/40 uppercase text-[9px] font-bold">Parser disponivel</div>
                  <div className={`font-bold ${importDiagnostics.parserExists ? 'text-green-400' : 'text-red-400'}`}>
                    {importDiagnostics.parserExists ? 'Sim' : 'Nao'}
                  </div>
                </div>
              </div>
              <div className="mt-2 text-[10px] text-white/60">
                <span className="text-white/40 uppercase text-[9px] font-bold">Tamanho:</span>{' '}
                {(importDiagnostics.fileSize / 1024).toFixed(1)} KB{' '}
                <span className="text-white/30">|</span>{' '}
                <span className="text-white/40 uppercase text-[9px] font-bold">Modificado:</span>{' '}
                {new Date(importDiagnostics.fileLastModified).toLocaleString('pt-BR')}
              </div>
              <div className="mt-2 text-[11px]">
                <span className="text-white/40 uppercase text-[9px] font-bold">Lancamentos validos:</span>{' '}
                <span className="font-bold">{importDiagnostics.validFound}</span>
              </div>
              <div className="mt-1 text-[11px]">
                <span className="text-white/40 uppercase text-[9px] font-bold">Linhas extraidas:</span>{' '}
                <span className="font-bold">{importDiagnostics.linesExtracted}</span>{' '}
                <span className="text-white/30">|</span>{' '}
                <span className="text-white/40 uppercase text-[9px] font-bold">Linhas ignoradas:</span>{' '}
                <span className="font-bold">{importDiagnostics.linesIgnored}</span>
              </div>
              {importDiagnostics.reason && (
                <div className="mt-2 text-[11px] text-yellow-300">
                  {importDiagnostics.reason}
                </div>
              )}
              {importDiagnostics.baseTextPreview && (
                <div className="mt-2 text-[10px] text-white/60 break-words">
                  <span className="text-white/40 uppercase text-[9px] font-bold">Texto base identificado:</span>{' '}
                  {importDiagnostics.baseTextPreview}
                </div>
              )}
              {importDiagnostics.debugNote && (
                <div className="mt-2 text-[10px] text-white/50 break-words">
                  {importDiagnostics.debugNote}
                </div>
              )}
              {importDiagnostics.rejectedLineReasons.length > 0 && (
                <div className="mt-2 text-[10px] text-red-300 space-y-1">
                  <div className="text-[9px] uppercase text-red-200/80 font-bold">Motivos de rejeicao (amostra)</div>
                  {importDiagnostics.rejectedLineReasons.map((msg, idx) => (
                    <div key={`${idx}-${msg.slice(0, 20)}`}>- {msg}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex-1 overflow-y-auto no-scrollbar space-y-2">
            {importedData.map(item => (
              <div
                key={item.id}
                className={`grid grid-cols-[40px_minmax(0,1fr)] items-center gap-3 rounded-xl border p-3 transition-all md:grid-cols-[40px_minmax(0,1fr)_150px_auto] ${
                  item.status === 'ready' ? 'bg-white/5 border-white/5' : item.status === 'pending' ? 'border-yellow-500/20 bg-yellow-500/5' : 'bg-red-500/5 border-red-500/20'
                }`}
              >
                <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
                  item.type === 'income' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                }`}>
                  <ArrowRightLeft size={20} />
                </div>

                <div className="min-w-0 space-y-2">
                  <div className="flex items-center gap-2">
                    <input aria-label="Descrição do lançamento" value={item.description} onChange={(event) => handleUpdateItem(item.id, { description: event.target.value })} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-xs font-bold text-white outline-none focus:border-brand-primary/50" />
                    {item.status === 'error' && (
                      <span className="text-[8px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded uppercase font-bold">Campo faltando</span>
                    )}
                    {item.confidence < 0.85 && item.status !== 'error' && (
                      <span className="whitespace-nowrap rounded bg-yellow-500/15 px-1.5 py-0.5 text-[8px] font-bold text-yellow-200">REVISAR {Math.round(item.confidence * 100)}%</span>
                    )}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[130px_minmax(0,1fr)]">
                    <input aria-label="Data do lançamento" type="date" value={item.date.slice(0, 10)} onChange={(event) => handleUpdateItem(item.id, { date: event.target.value })} className="rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-white" />
                    <input aria-label="Categoria do lançamento" value={item.category} onChange={(event) => handleUpdateItem(item.id, { category: event.target.value })} className="min-w-0 rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-white" />
                  </div>
                </div>

                <div className="col-start-2 text-right md:col-start-auto">
                  <label className="block text-[8px] font-bold uppercase text-white/35">{item.type === 'income' ? 'Entrada' : 'Saída'}
                    <input aria-label="Valor do lançamento" type="number" min="0.01" step="0.01" value={item.amount} onChange={(event) => handleUpdateItem(item.id, { amount: Math.abs(Number(event.target.value || 0)) })} className={`mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-right text-sm font-bold ${item.type === 'income' ? 'text-green-400' : 'text-white'}`} />
                  </label>
                  <div className="mt-1 text-[8px] text-white/40 uppercase font-bold">{item.bank_source} · confiança {Math.round(item.confidence * 100)}%</div>
                </div>

                <div className="col-start-2 flex items-center justify-end gap-1 md:col-start-auto">
                  <button
                    type="button"
                    aria-label={item.status === 'ready' ? `Não importar ${item.description}` : `Aprovar ${item.description}`}
                    onClick={() => handleToggleStatus(item.id)}
                    className={`p-2 rounded-lg transition-colors ${item.status === 'ready' ? 'text-green-400 bg-green-400/10' : 'text-white/20 hover:text-white/40 bg-white/5'}`}
                  >
                    <Check size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remover ${item.description}`}
                    onClick={() => handleRemove(item.id)}
                    className="p-2 text-white/20 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
            {importedData.length === 0 && (
              <div className="p-4 rounded-xl border border-yellow-500/20 bg-yellow-500/5 text-xs text-yellow-300">
                {importDiagnostics?.reason || 'Nenhum lancamento valido encontrado. Revise o formato e tente novamente.'}
              </div>
            )}
          </div>
        </div>
      )}

      {pdfPasswordPrompt && (
        <div className="fixed inset-0 z-[200] grid place-items-center bg-black/80 p-5 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="mf-pdf-password-title">
          <form
            className="w-full max-w-md rounded-3xl border border-white/10 bg-[#151515] p-6 shadow-2xl"
            onSubmit={(event) => {
              event.preventDefault();
              if (pdfPassword) finishPdfPassword(pdfPassword);
            }}
          >
            <span className="inline-flex rounded-full bg-purple-500/15 px-2.5 py-1 text-[10px] font-black tracking-widest text-purple-300">PDF PROTEGIDO</span>
            <h3 id="mf-pdf-password-title" className="mt-3 text-xl font-black">{pdfPasswordPrompt.incorrect ? 'Senha incorreta' : 'Este extrato precisa de senha'}</h3>
            <p className="mt-2 text-xs leading-5 text-white/55">{pdfPasswordPrompt.incorrect ? 'A senha informada não abriu o PDF. Confira e tente novamente.' : 'A senha será usada somente nesta leitura e não será salva.'}</p>
            <div className="mt-4 truncate rounded-xl bg-white/5 px-3 py-2 text-[10px] text-white/45">{pdfPasswordPrompt.fileName || 'Arquivo PDF protegido'}</div>
            <label className="mt-4 block text-[10px] font-bold uppercase tracking-widest text-white/55">Senha do PDF
              <div className="mt-2 flex gap-2">
                <input autoFocus autoComplete="off" type={showPdfPassword ? 'text' : 'password'} value={pdfPassword} onChange={(event) => setPdfPassword(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/35 px-3 py-3 text-sm text-white outline-none focus:border-purple-400/60" />
                <button type="button" onClick={() => setShowPdfPassword((current) => !current)} className="rounded-xl border border-white/10 px-3 text-[10px] font-bold text-white/65">{showPdfPassword ? 'Ocultar' : 'Mostrar'}</button>
              </div>
            </label>
            {pdfPasswordPrompt.incorrect && <p className="mt-2 text-[10px] text-red-300">Senha incorreta. Tente novamente.</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => finishPdfPassword(null)} className="rounded-xl border border-white/10 px-4 py-2.5 text-xs font-bold text-white/65">Cancelar</button>
              <button type="submit" disabled={!pdfPassword} className="rounded-xl bg-purple-600 px-4 py-2.5 text-xs font-black text-white disabled:opacity-40">Abrir PDF</button>
            </div>
            <p className="mt-4 text-[9px] leading-4 text-white/30">A senha permanece apenas na memória durante a abertura do arquivo.</p>
          </form>
        </div>
      )}
    </div>
  );
}
