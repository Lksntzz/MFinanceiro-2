import type { ExtractedPdfTransaction, PdfParserContext } from './types';

const DATE_TOKEN_REGEX = /\b(\d{2}[./-]\d{2}(?:[./-]\d{2,4})?)\b/;
// Monetary tokens must be contiguous. Allowing arbitrary spaces inside the numeric body
// can concatenate a document/NSU column with the actual amount in PDF table extraction.
const AMOUNT_TOKEN_REGEX =
  /(?:R\$\s*)?[+-]?\s*(?:\d{1,3}(?:\.\d{3})+,\d{2}|\d{1,3}(?:,\d{3})+\.\d{2}|\d+[,.]\d{2})-?/g;
const AMOUNT_TOKEN_TEST_REGEX =
  /(?:R\$\s*)?[+-]?\s*(?:\d{1,3}(?:\.\d{3})+,\d{2}|\d{1,3}(?:,\d{3})+\.\d{2}|\d+[,.]\d{2})-?/;

export function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function parseAmount(raw: string | undefined): number {
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

export function looksLikeNoiseLine(line: string): boolean {
  const normalized = normalizeHeader(line);
  if (!normalized) return true;
  return [
    'extratodeconta',
    'detalhedosmovimentos',
    'datadescricao',
    'iddaoperacao',
    'saldoinicial',
    'saldofinal',
    'entradas',
    'saidas',
    'datadegeracao',
    'portaldeajuda',
    'ouvidoria',
    'sac',
    'cnpj',
    'periodo',
    'conta',
    'agencia',
    'cpfcnpj',
    'encontrenossoscanais',
    'valor',
    'saldo',
  ].some((token) => normalized.includes(token));
}

// Devolve ISO (meio-dia UTC) só se a data existir no calendário; senão ''.
// Nunca "rola" 31/02 para março nem inventa a data de hoje.
function existingDateToIso(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const exists =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  return exists ? date.toISOString() : '';
}

export function parsePdfDateToIso(rawDate: string): string {
  const fullYear = rawDate.match(/(\d{2})[./-](\d{2})[./-](\d{4})/);
  if (fullYear)
    return existingDateToIso(
      Number(fullYear[3]),
      Number(fullYear[2]),
      Number(fullYear[1]),
    );

  const shortYear = rawDate.match(/(\d{2})[./-](\d{2})[./-](\d{2})/);
  if (shortYear)
    return existingDateToIso(
      Number(`20${shortYear[3]}`),
      Number(shortYear[2]),
      Number(shortYear[1]),
    );

  const withoutYear = rawDate.match(/(\d{2})[./-](\d{2})$/);
  if (!withoutYear) return '';
  const day = Number(withoutYear[1]);
  const month = Number(withoutYear[2]);
  const now = new Date();
  let iso = existingDateToIso(now.getUTCFullYear(), month, day);
  // Extrato sem ano lido em janeiro (ex.: lançamento de 28/12): se a data cair
  // mais de 7 dias no futuro, pertence ao ano anterior.
  if (iso && new Date(iso).getTime() > now.getTime() + 7 * 86_400_000)
    iso = existingDateToIso(now.getUTCFullYear() - 1, month, day);
  return iso;
}

export function detectBankFromText(text: string): string {
  const normalized = normalizeHeader(text);
  if (normalized.includes('mercadopago')) return 'mercadopago';
  if (normalized.includes('nubank')) return 'nubank';
  if (normalized.includes('bancointer') || normalized.includes('inter'))
    return 'inter';
  if (normalized.includes('bradesco')) return 'bradesco';
  if (normalized.includes('santander')) return 'santander';
  if (normalized.includes('c6bank') || normalized.includes('c6'))
    return 'c6bank';
  return 'generic';
}

export function parseByDateAndCurrencyLines(
  context: PdfParserContext,
): ExtractedPdfTransaction[] {
  const pendingDescription: string[] = [];
  const extracted: ExtractedPdfTransaction[] = [];

  for (const line of context.lines) {
    const dateMatch = line.match(DATE_TOKEN_REGEX);
    const amountMatches = [...line.matchAll(AMOUNT_TOKEN_REGEX)].map(
      (match) => match[0],
    );

    if (!dateMatch || amountMatches.length === 0) {
      const hasDate = DATE_TOKEN_REGEX.test(line);
      const hasAmount = AMOUNT_TOKEN_TEST_REGEX.test(line);
      if (!hasDate && !hasAmount && !looksLikeNoiseLine(line)) {
        pendingDescription.push(line);
      }
      continue;
    }

    const rawDate = dateMatch[1];
    const signedAmount = context.parseAmount(amountMatches[0]);
    if (Math.abs(signedAmount) <= 0) continue;

    const descriptionFromLine = line
      .replace(rawDate, ' ')
      .replace(AMOUNT_TOKEN_REGEX, ' ')
      .replace(/\b\d{9,}\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    let description = descriptionFromLine;
    if (!description && pendingDescription.length > 0) {
      description = pendingDescription.join(' ').replace(/\s+/g, ' ').trim();
    }
    if (!description) description = 'Sem descricao';

    extracted.push({
      rawDate,
      description,
      signedAmount,
      confidence: description === 'Sem descricao' ? 0.35 : 0.9,
    });

    pendingDescription.length = 0;
  }

  return extracted;
}

export function parseByBlockRegex(
  context: PdfParserContext,
): ExtractedPdfTransaction[] {
  const normalizedText = context.fullText.replace(/\s+/g, ' ').trim();
  const extracted: ExtractedPdfTransaction[] = [];
  const blockRegex =
    /(\d{2}[./-]\d{2}(?:[./-]\d{2,4})?)\s+(.+?)\s+((?:R\$\s*)?[+-]?\s*(?:\d{1,3}(?:\.\d{3})+,\d{2}|\d{1,3}(?:,\d{3})+\.\d{2}|\d+[,.]\d{2})-?)(?:\s+(?:R\$\s*)?[+-]?\s*(?:\d{1,3}(?:\.\d{3})+,\d{2}|\d{1,3}(?:,\d{3})+\.\d{2}|\d+[,.]\d{2})-?)?/g;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(normalizedText)) !== null) {
    const signedAmount = context.parseAmount(match[3]);
    if (Math.abs(signedAmount) <= 0) continue;

    const description =
      (match[2] || '')
        .replace(/\b\d{9,}\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || 'Sem descricao';

    extracted.push({
      rawDate: match[1],
      description,
      signedAmount,
      confidence: description === 'Sem descricao' ? 0.35 : 0.82,
    });
  }

  return extracted;
}
