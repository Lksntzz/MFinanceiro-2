import type { ImportedTransaction } from '../../types';
import { generateTransactionId } from './statement-parser-utils';
import type {
  DelimitedAnalysis,
  FileFormat,
  FormatDetectionResult,
  SpreadsheetAnalysis,
} from './import-types';

export async function hashImportFile(file: File): Promise<string | undefined> {
  if (!globalThis.crypto?.subtle) return undefined;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function inferFileMimeType(file: Pick<File, 'name' | 'type'>): string {
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

export function analyzeDelimitedContent(content: string): DelimitedAnalysis {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.replace(/\uFEFF/g, '').trim())
    .filter(Boolean);

  const dateRegex = /\b\d{2}[./-]\d{2}(?:[./-]\d{2,4})?\b|\b\d{4}-\d{2}-\d{2}\b/;
  const amountRegex = /(?:R\$\s*)?[+-]?\s*\d[\d.\s]*[,.]\d{2}-?/;
  const headerKeywords = /(data|date|descricao|hist[óo]rico|description|valor|amount|debito|credito|saldo|lan[çc]amento)/i;

  return {
    nonEmptyLines: lines.length,
    hasHeaderKeywords: lines.some((line) => headerKeywords.test(line)),
    hasTransactionSignals: lines.some((line) => dateRegex.test(line) && amountRegex.test(line)),
  };
}

export function inferEmptyResultReason(params: {
  fileName?: string;
  format: FileFormat;
  csvAnalysis?: DelimitedAnalysis;
  sheetAnalysis?: SpreadsheetAnalysis;
  ofxContent?: string;
  pdfReason?: string;
}): string {
  const { fileName, format, csvAnalysis, sheetAnalysis, ofxContent, pdfReason } = params;
  const normalizedFileName = String(fileName || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  const isMfinanceiroExport = normalizedFileName.includes('mfinanceirorelatoriotransacoes');

  if (format === 'pdf') return pdfReason || 'nenhum registro de transacao encontrado';

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
  }

  return 'nenhum registro de transacao encontrado';
}

export function buildTextPreview(raw: string | undefined): string {
  return raw ? raw.replace(/\s+/g, ' ').trim().slice(0, 280) : '';
}

export async function cloneFileForSession(source: File): Promise<File> {
  const buffer = await source.arrayBuffer();
  return new File([buffer], source.name, { type: source.type, lastModified: source.lastModified });
}

export function getInvalidLineReasons(items: ImportedTransaction[]): string[] {
  const reasons: string[] = [];
  for (const item of items) {
    if (item.status !== 'error') continue;
    if (!item.description || item.description === 'Sem descricao') {
      reasons.push(`Linha rejeitada: descricao ausente (${item.id})`);
    } else if (!item.amount || Math.abs(item.amount) <= 0) {
      reasons.push(`Linha rejeitada: valor invalido (${item.id})`);
    } else if (!item.date || Number.isNaN(new Date(item.date).getTime())) {
      reasons.push(`Linha rejeitada: data invalida (${item.id})`);
    } else {
      reasons.push(`Linha rejeitada: nao reconhecida como transacao (${item.id})`);
    }
  }
  return reasons;
}

export function ensureMinimumTransactionFields(items: ImportedTransaction[]): ImportedTransaction[] {
  return items.map((item) => ({
    ...item,
    source: item.source || item.bank_source || 'importacao_extrato',
    categorySuggestion: item.categorySuggestion || item.category || 'Geral',
  }));
}

export function detectFileFormat(file: Pick<File, 'name' | 'type'>): FormatDetectionResult {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const mime = file.type.toLowerCase();

  if (ext === 'csv' || mime.includes('csv')) return { format: 'csv', formatLabel: 'CSV', parserLabel: 'Parser CSV', parserExists: true, supported: true };
  if (ext === 'ofx' || mime.includes('ofx')) return { format: 'ofx', formatLabel: 'OFX', parserLabel: 'Parser OFX', parserExists: true, supported: true };
  if (ext === 'pdf' || mime.includes('pdf')) return { format: 'pdf', formatLabel: 'PDF', parserLabel: 'Parser PDF', parserExists: true, supported: true };
  if (ext === 'xlsx') return { format: 'xlsx', formatLabel: 'XLSX', parserLabel: 'Parser XLSX', parserExists: true, supported: true };
  if (ext === 'xls') return { format: 'xls', formatLabel: 'XLS', parserLabel: 'Parser XLS', parserExists: true, supported: true };
  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
    return { format: 'image', formatLabel: 'Imagem', parserLabel: 'OCR/IA com revisão', parserExists: true, supported: true };
  }

  return {
    format: 'unknown',
    formatLabel: ext ? ext.toUpperCase() : 'Desconhecido',
    parserLabel: 'Nao disponivel',
    parserExists: false,
    supported: false,
    reason: 'Formato nao suportado. Use CSV, OFX, PDF, XLS, XLSX ou imagem.',
  };
}

export function normalizeImportedTransactions(items: ImportedTransaction[]): ImportedTransaction[] {
  return items.map((item, index) => {
    const safeDate = Number.isNaN(new Date(item.date).getTime()) ? new Date().toISOString() : item.date;
    const safeDescription = (item.description || '').trim() || 'Sem descricao';
    const safeAmount = Math.abs(Number(item.amount) || 0);
    const safeType: ImportedTransaction['type'] = item.type === 'income' ? 'income' : 'expense';
    const isValid = safeDescription !== 'Sem descricao' && safeAmount > 0;
    const status: ImportedTransaction['status'] = isValid && item.status !== 'error'
      ? item.status
      : isValid ? 'ready' : 'error';

    return {
      ...item,
      id: item.id || generateTransactionId('imported', index),
      date: safeDate,
      description: safeDescription,
      amount: safeAmount,
      type: safeType,
      status,
    };
  });
}
