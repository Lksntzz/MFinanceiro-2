import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
// @ts-ignore
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ImportedTransaction } from '../../../types';
import { getPdfBankParser, resolvePdfBank } from './index';
import { parseAmount, parsePdfDateToIso, normalizeHeader, looksLikeNoiseLine } from './utils';
import { ExtractedPdfTransaction, PdfParserContext } from './types';

GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

function inferCategoryFromStatement(description: string, type: 'income' | 'expense'): string {
  const text = normalizeHeader(description);

  if (/(rendimento|rendimentos|juros)/.test(text)) return 'Rendimentos';
  if (/(pixrecebido|recebido)/.test(text)) return 'Transferencia';
  if (/(pixenviado|enviado)/.test(text)) return 'Transferencia';
  if (/(dinheiroreservado|reservado|reserva)/.test(text)) return 'Reserva';
  if (/(uber|autopass|99|taxi|estacionamento|combustivel|posto)/.test(text)) return 'Transporte';
  if (/(ifood|pizzaria|esfiha|supermercado|mercado|food|coffee|padaria|doce|restaurante)/.test(text)) return 'Alimentacao';
  if (/(farmacia|clinica|hospital|medic)/.test(text)) return 'Saude';

  return type === 'income' ? 'Receita' : 'Despesa';
}

function generateId(prefix: string, index: number): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${index}`;
}

function normalizeBankLabel(bank: string): string {
  switch (bank) {
    case 'mercadopago': return 'Mercado Pago';
    case 'nubank': return 'Nubank';
    case 'inter': return 'Inter';
    case 'bradesco': return 'Bradesco';
    case 'santander': return 'Santander';
    case 'c6bank': return 'C6 Bank';
    default: return 'Importado PDF';
  }
}

export interface PdfParseDebugInfo {
  isScannedPdf: boolean;
  isLikelyBankStatement: boolean;
  hasTransactionPattern: boolean;
  totalPages: number;
  totalTextItems: number;
  linesExtracted: number;
  ignoredLines: number;
  extractedTransactions: number;
  rejectedLineReasons: string[];
  parserBank: string;
  parserBankLabel: string;
  usedGenericFallback: boolean;
  reason?: string;
  textPreview: string;
}

export interface PdfParseResult {
  transactions: ImportedTransaction[];
  debug: PdfParseDebugInfo;
}

export interface PdfClassificationOptions {
  accountHolderName?: string;
  internalAccountAliases?: string[];
}

function normalizeText(value: string): string {
  return normalizeHeader(value || '');
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 3);
}

function tokenOverlapRatio(a: string, b: string): number {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) intersection++;
  }
  return intersection / Math.min(aTokens.size, bTokens.size);
}

function extractPixCounterparty(description: string): string {
  const raw = description || '';
  const patterns = [
    /pix\s+(?:para|p\/|destinatario|favorecido)\s*[:\-]?\s*(.+)$/i,
    /pix\s+(?:de|remetente)\s*[:\-]?\s*(.+)$/i,
    /transferencia\s+pix\s*[:\-]?\s*(.+)$/i,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return raw;
}

function isLikelyInternalTransfer(description: string, options?: PdfClassificationOptions): boolean {
  const normalized = normalizeText(description);
  const isPixTransfer = normalized.includes('transferenciapix') || normalized.includes('pix');
  if (!isPixTransfer) return false;

  const counterparty = extractPixCounterparty(description);
  const aliases = [
    options?.accountHolderName || '',
    ...(options?.internalAccountAliases || []),
  ].filter(Boolean);
  if (aliases.length === 0) return false;

  return aliases.some((alias) => {
    const normalizedAlias = normalizeText(alias);
    if (!normalizedAlias) return false;
    if (normalizeText(counterparty).includes(normalizedAlias) || normalizedAlias.includes(normalizeText(counterparty))) {
      return true;
    }
    return tokenOverlapRatio(counterparty, alias) >= 0.6;
  });
}

function classifyStatementEntry(
  description: string,
  type: 'income' | 'expense',
  options?: PdfClassificationOptions
): { category: string; tags: string[] } {
  const normalized = normalizeText(description);

  if (/libemprestim|financiam/.test(normalized)) {
    return {
      category: 'Crédito Financeiro',
      tags: ['credito_financeiro', 'emprestimo_financiamento', 'nao_salario'],
    };
  }

  if (/baixaautomatpoupanca/.test(normalized)) {
    return {
      category: 'Movimentação Interna',
      tags: ['movimentacao_interna', 'conta_poupanca', 'nao_conta_fixa', 'nao_despesa_comum'],
    };
  }

  if (isLikelyInternalTransfer(description, options)) {
    return {
      category: 'Transferência Interna',
      tags: ['transferencia_interna', 'nao_salario', 'nao_nova_renda', 'nao_gasto_comum'],
    };
  }

  if (/\bdes[:\s-]/i.test(description)) {
    return {
      category: type === 'income' ? 'Receita' : 'Despesa',
      tags: ['descricao_extrato_bradesco'],
    };
  }

  return {
    category: inferCategoryFromStatement(description, type),
    tags: [],
  };
}

function inferFlowByDescription(description: string): 'income' | 'expense' | null {
  const normalized = normalizeText(description);

  const incomeHints = [
    'transferenciarecebidapelopix',
    'transferenciarecebida',
    'pixrecebido',
    'resgaterdb',
    'creditoemconta',
    'creditoconta',
    'libemprestim',
    'financiam',
    'deposito',
    'rendimentos',
    'rendimento'
  ];
  if (incomeHints.some((hint) => normalized.includes(hint))) return 'income';

  const expenseHints = [
    'transferenciaenviadapelopix',
    'transferenciaenviada',
    'pixenviado',
    'comprafii',
    'baixaautomatpoupanca',
    'pagamento',
    'compra',
    'debito'
  ];
  if (expenseHints.some((hint) => normalized.includes(hint))) return 'expense';

  return null;
}

function toImportedTransactions(
  bank: string,
  extracted: ExtractedPdfTransaction[],
  options?: PdfClassificationOptions
): ImportedTransaction[] {
  const bankSource = normalizeBankLabel(bank);
  return extracted.map((entry, index) => {
    const amount = Math.abs(entry.signedAmount);
    const description = entry.description || 'Sem descricao';
    const flowByContext = inferFlowByDescription(description);
    const type: 'income' | 'expense' =
      flowByContext || (entry.signedAmount >= 0 ? 'income' : 'expense');
    const status: ImportedTransaction['status'] = description !== 'Sem descricao' && amount > 0 ? 'ready' : 'error';
    const classification = classifyStatementEntry(description, type, options);
    return {
      id: generateId(`pdf-${bank}`, index),
      date: parsePdfDateToIso(entry.rawDate),
      description,
      amount,
      source_id: entry.sourceId,
      type,
      category: classification.category,
      source: bankSource,
      categorySuggestion: classification.category,
      status,
      confidence: typeof entry.confidence === 'number' ? entry.confidence : (status === 'ready' ? 0.9 : 0.35),
      original_description: description,
      bank_source: bankSource,
      running_balance: entry.runningBalance
    };
  });
}

export async function parsePdfStatementWithDebug(
  file: File,
  selectedBank: string,
  options?: PdfClassificationOptions
): Promise<PdfParseResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await getDocument({ data: bytes }).promise;
  const lines: string[] = [];
  let fullText = '';
  let totalTextItems = 0;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const rows = new Map<number, { x: number; text: string }[]>();
    totalTextItems += content.items.length;

    for (const item of content.items as Array<{ str: string; transform: number[] }>) {
      const y = Math.round(item.transform[5]);
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y)!.push({ x: item.transform[4], text: item.str });
      fullText += ` ${item.str}`;
    }

    const ys = [...rows.keys()].sort((a, b) => b - a);
    for (const y of ys) {
      const line = rows.get(y)!
        .sort((a, b) => a.x - b.x)
        .map(part => part.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (line) lines.push(line);
    }
  }

  const bank = resolvePdfBank(selectedBank, fullText);
  const parser = getPdfBankParser(bank);
  const context: PdfParserContext = {
    lines,
    fullText,
    normalize: normalizeHeader,
    parseAmount,
  };
  let extracted = parser(context);
  let usedGenericFallback = false;

  if (extracted.length === 0 && bank !== 'generic') {
    const genericParser = getPdfBankParser('generic');
    extracted = genericParser(context);
    usedGenericFallback = extracted.length > 0;
  }

  const transactions = toImportedTransactions(bank, extracted, options);
  const cleanedText = fullText.replace(/\s+/g, ' ').trim();
  const normalizedText = normalizeHeader(cleanedText);
  const isScannedPdf = cleanedText.length < 40 || totalTextItems < 20 || lines.length < 5;
  const hasTransactionPattern =
    /\b\d{2}[./-]\d{2}(?:[./-]\d{2,4})?\b/.test(cleanedText) &&
    /(?:R\$\s*)?[+-]?\s*\d[\d.\s]*[,.]\d{2}-?/.test(cleanedText);
  const isLikelyBankStatement =
    /(extrato|movimentacao|lancamento|saldo|contacorrente|banco|agencia|debito|credito|pix|transferencia)/.test(normalizedText) ||
    hasTransactionPattern;

  let reason: string | undefined;
  if (transactions.length === 0) {
    if (isScannedPdf) {
      reason = 'PDF sem texto selecionavel (provavel escaneado/imagem). Use OCR ou exporte em CSV/OFX.';
    } else if (!isLikelyBankStatement) {
      reason = 'arquivo nao e um extrato bancario';
    } else if (cleanedText.length < 120) {
      reason = 'Texto extraido insuficiente para mapear movimentacoes financeiras.';
    } else {
      reason = 'nenhum registro de transacao encontrado';
    }
  }

  const datePattern = /\b\d{2}[./-]\d{2}(?:[./-]\d{2,4})?\b/;
  const amountPattern = /(?:R\$\s*)?[+-]?\s*\d[\d.\s]*[,.]\d{2}-?/;
  const rejectedLineReasons: string[] = [];
  let ignoredLines = 0;

  for (const line of lines) {
    const hasDate = datePattern.test(line);
    const hasAmount = amountPattern.test(line);
    if (hasDate && hasAmount) continue;
    ignoredLines++;
    if (looksLikeNoiseLine(line)) continue;
    if (rejectedLineReasons.length >= 8) continue;
    if (hasDate && !hasAmount) {
      rejectedLineReasons.push(`Linha ignorada sem valor monetario: "${line.slice(0, 120)}"`);
    } else if (!hasDate && hasAmount) {
      rejectedLineReasons.push(`Linha ignorada sem data: "${line.slice(0, 120)}"`);
    } else {
      rejectedLineReasons.push(`Linha sem padrao de transacao: "${line.slice(0, 120)}"`);
    }
  }

  return {
    transactions,
    debug: {
      isScannedPdf,
      isLikelyBankStatement,
      hasTransactionPattern,
      totalPages: pdf.numPages,
      totalTextItems,
      linesExtracted: lines.length,
      ignoredLines,
      extractedTransactions: transactions.length,
      rejectedLineReasons,
      parserBank: bank,
      parserBankLabel: normalizeBankLabel(bank),
      usedGenericFallback,
      reason,
      textPreview: cleanedText.slice(0, 500),
    }
  };
}

export async function parsePdfStatement(file: File, selectedBank: string): Promise<ImportedTransaction[]> {
  const result = await parsePdfStatementWithDebug(file, selectedBank);
  return result.transactions;
}
