import { ExtractedPdfTransaction, PdfParserContext } from './types';
import { looksLikeNoiseLine, normalizeHeader } from './utils';

const DATE_REGEX = /\b(\d{2}[./-]\d{2}(?:[./-]\d{2,4})?)\b/;
// Keep monetary values contiguous so a document/NSU column cannot be merged into the amount.
const AMOUNT_REGEX = /(?:R\$\s*)?[+-]?\s*(?:\d{1,3}(?:\.\d{3})+,\d{2}|\d{1,3}(?:,\d{3})+\.\d{2}|\d+[,.]\d{2})-?/g;

function inferStatementYear(text: string): number | null {
  const explicitDates = [...text.matchAll(/\b\d{2}[./-]\d{2}[./-](20\d{2})\b/g)]
    .map((match) => Number(match[1]))
    .filter((year) => year >= 2000 && year <= 2100);
  if (explicitDates.length) return explicitDates[0];

  const years = [...text.matchAll(/\b(20\d{2})\b/g)]
    .map((match) => Number(match[1]))
    .filter((year) => year >= 2000 && year <= 2100);
  return years.length ? years[0] : null;
}

function withYear(rawDate: string, year: number | null): string {
  if (!year || /\d{2}[./-]\d{2}[./-]\d{2,4}/.test(rawDate)) return rawDate;
  const match = rawDate.match(/^(\d{2})[./-](\d{2})$/);
  return match ? `${match[1]}/${match[2]}/${year}` : rawDate;
}

function isBalanceOrSummaryLine(line: string): boolean {
  const normalized = normalizeHeader(line);
  return [
    'saldoinicial',
    'saldoanterior',
    'saldoatual',
    'saldofinal',
    'saldodisponivel',
    'saldobloqueado',
    'totaldebitos',
    'totalcreditos',
    'totalentradas',
    'totalsaidas',
    'resumodoperiodo',
    'limitedaconta',
    'limiteutilizado',
  ].some((token) => normalized.includes(token));
}

function cleanDescription(line: string, rawDate: string | null, amountTokens: string[]): string {
  let description = line;
  if (rawDate) description = description.replace(rawDate, ' ');
  for (const amount of amountTokens) description = description.replace(amount, ' ');

  return description
    .replace(/\b(?:doc(?:umento)?|id|nsu|aut(?:orizacao)?)?\s*[:#-]?\s*\d{8,}\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function signedByContext(line: string, description: string, parsed: number): number {
  if (parsed < 0 || /-\s*$/.test(line)) return -Math.abs(parsed);

  const normalized = normalizeHeader(`${line} ${description}`);
  if (/\bD\b/i.test(line) || /(debito|saida|pagamento|compra|tarifa|saque|pixenviado|transferenciaenviada)/.test(normalized)) {
    return -Math.abs(parsed);
  }
  if (/\bC\b/i.test(line) || /(credito|entrada|recebido|deposito|pixrecebido|transferenciarecebida|rendimento)/.test(normalized)) {
    return Math.abs(parsed);
  }
  return parsed;
}

function keyOf(item: ExtractedPdfTransaction): string {
  return [
    item.rawDate.replace(/[^0-9]/g, ''),
    Math.round(item.signedAmount * 100),
    normalizeHeader(item.description).slice(0, 80),
  ].join('|');
}

export function mergePdfTransactions(...groups: ExtractedPdfTransaction[][]): ExtractedPdfTransaction[] {
  const seen = new Set<string>();
  const merged: ExtractedPdfTransaction[] = [];
  for (const item of groups.flat()) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

/**
 * Resilient fallback shared by every registered bank.
 * Supports tables where a date appears once and the following movements reuse it,
 * common in PJ statements, and tolerates descriptions split across adjacent rows.
 */
export function parseUniversalPdfStatement(context: PdfParserContext): ExtractedPdfTransaction[] {
  const extracted: ExtractedPdfTransaction[] = [];
  const statementYear = inferStatementYear(context.fullText);
  let currentDate: string | null = null;
  let pendingDescription: string[] = [];

  for (const rawLine of context.lines) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (!line) continue;

    const dateMatch = line.match(DATE_REGEX);
    if (dateMatch?.[1]) currentDate = withYear(dateMatch[1], statementYear);

    if (looksLikeNoiseLine(line) || isBalanceOrSummaryLine(line)) {
      if (dateMatch) pendingDescription = [];
      continue;
    }

    const amountTokens = [...line.matchAll(AMOUNT_REGEX)].map((match) => match[0]);
    if (amountTokens.length === 0) {
      const withoutDate = dateMatch ? line.replace(dateMatch[1], ' ').trim() : line;
      if (withoutDate && !/^\d+$/.test(withoutDate) && withoutDate.length <= 180) {
        pendingDescription.push(withoutDate);
        if (pendingDescription.length > 3) pendingDescription.shift();
      }
      continue;
    }

    if (!currentDate) continue;

    // In bank tables with movement + running balance, the first monetary cell is the movement.
    const movementToken = amountTokens[0];
    const parsedAmount = context.parseAmount(movementToken);
    if (!Number.isFinite(parsedAmount) || Math.abs(parsedAmount) <= 0) continue;

    let description = cleanDescription(line, dateMatch?.[1] || null, amountTokens);
    if (!description && pendingDescription.length) description = pendingDescription.join(' ');
    if (description.length < 2 && pendingDescription.length) {
      description = `${pendingDescription.join(' ')} ${description}`.trim();
    }
    description = description.replace(/\s+/g, ' ').trim();

    if (!description || isBalanceOrSummaryLine(description)) {
      pendingDescription = [];
      continue;
    }

    extracted.push({
      rawDate: currentDate,
      description,
      signedAmount: signedByContext(line, description, parsedAmount),
      confidence: dateMatch ? 0.9 : 0.84,
    });
    pendingDescription = [];
  }

  return extracted;
}
