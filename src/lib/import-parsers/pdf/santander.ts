import { ExtractedPdfTransaction, PdfBankParser } from './types';
import { looksLikeNoiseLine, parseByDateAndCurrencyLines, parseByBlockRegex } from './utils';

const DATE_AT_START = /^(\d{2}[./-]\d{2}(?:[./-]\d{2,4})?)\b/;
const AMOUNT_REGEX = /(?:R\$\s*)?\d[\d.\s]*[,.]\d{2}-?/g;

function cleanDescription(value: string): string {
  return value
    .replace(DATE_AT_START, ' ')
    .replace(AMOUNT_REGEX, ' ')
    .replace(/\b\d{6,}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeSantanderCheckingHeader(line: string, normalize: (value: string) => string): boolean {
  const normalized = normalize(line);
  return (
    normalized.includes('datadescricao') &&
    normalized.includes('documento') &&
    normalized.includes('movimentos') &&
    normalized.includes('saldo')
  );
}

function isSantanderSectionStop(line: string, normalize: (value: string) => string): boolean {
  const normalized = normalize(line);
  return (
    normalized.startsWith('saldoem') ||
    normalized.includes('saldosporperiodo') ||
    normalized.includes('produtoseservicosquantidadecontratada') ||
    normalized.includes('pacotedeservicos')
  );
}

function isSantanderNonTransactionLine(line: string, normalize: (value: string) => string): boolean {
  const normalized = normalize(line);
  if (!normalized) return true;
  return (
    looksLikeNoiseLine(line) ||
    normalized.includes('creditosdebitos') ||
    normalized.includes('prezadocliente') ||
    normalized.includes('extratopjbasico') ||
    normalized.includes('santander') ||
    normalized.includes('balpuy') ||
    normalized.includes('resumo') ||
    normalized.startsWith('nome') ||
    normalized.startsWith('agencia') ||
    normalized.includes('contacorrente')
  );
}

function parseSantanderPjChecking(context: Parameters<PdfBankParser>[0]): ExtractedPdfTransaction[] {
  const extracted: ExtractedPdfTransaction[] = [];
  const pendingDescription: string[] = [];
  let active = false;
  let currentDate = '';

  for (const originalLine of context.lines) {
    const line = originalLine.replace(/\s+/g, ' ').trim();
    if (!line) continue;

    if (looksLikeSantanderCheckingHeader(line, context.normalize)) {
      active = true;
      pendingDescription.length = 0;
      continue;
    }

    if (!active) continue;
    if (isSantanderSectionStop(line, context.normalize)) {
      active = false;
      pendingDescription.length = 0;
      continue;
    }

    const dateMatch = line.match(DATE_AT_START);
    if (dateMatch?.[1]) currentDate = dateMatch[1];

    const amounts = [...line.matchAll(AMOUNT_REGEX)].map((match) => match[0].trim());
    if (amounts.length === 0) {
      if (!isSantanderNonTransactionLine(line, context.normalize)) {
        const text = cleanDescription(line);
        if (text) pendingDescription.push(text);
      }
      continue;
    }

    if (!currentDate) continue;

    // In Santander PJ checking-account statements the first monetary cell is the
    // movement amount and a possible second monetary cell is the running balance.
    // Debits are commonly represented with a trailing minus ("123,45-").
    const movementRaw = amounts[0];
    let signedAmount = context.parseAmount(movementRaw);
    if (movementRaw.endsWith('-')) signedAmount = -Math.abs(signedAmount);
    else signedAmount = Math.abs(signedAmount);
    if (!Number.isFinite(signedAmount) || Math.abs(signedAmount) <= 0) continue;

    const inlineDescription = cleanDescription(line);
    const pieces = [...pendingDescription, inlineDescription].filter(Boolean);
    const description = pieces.join(' ').replace(/\s+/g, ' ').trim() || 'Sem descricao';

    const sourceIdMatch = line.match(/\b\d{6,}\b/);
    const runningBalance = amounts.length > 1
      ? Math.abs(context.parseAmount(amounts[amounts.length - 1]))
      : undefined;

    extracted.push({
      rawDate: currentDate,
      description,
      signedAmount,
      sourceId: sourceIdMatch?.[0],
      runningBalance,
      confidence: description === 'Sem descricao' ? 0.45 : 0.95,
    });

    pendingDescription.length = 0;
  }

  return extracted;
}

export const parseSantanderPdf: PdfBankParser = (context) => {
  const pjChecking = parseSantanderPjChecking(context);
  if (pjChecking.length > 0) return pjChecking;

  const fromLines = parseByDateAndCurrencyLines(context);
  if (fromLines.length > 0) return fromLines;
  return parseByBlockRegex(context);
};
