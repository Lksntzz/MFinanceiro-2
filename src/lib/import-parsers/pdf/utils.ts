import { ExtractedPdfTransaction, PdfParserContext } from './types';

const DATE_TOKEN_REGEX = /\b(\d{2}[./-]\d{2}(?:[./-]\d{2,4})?)\b/;
const AMOUNT_TOKEN_REGEX = /(?:R\$\s*)?[+-]?\s*\d[\d.\s]*[,.]\d{2}-?/g;
const AMOUNT_TOKEN_TEST_REGEX = /(?:R\$\s*)?[+-]?\s*\d[\d.\s]*[,.]\d{2}-?/;

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
    'saldo'
  ].some(token => normalized.includes(token));
}

export function parsePdfDateToIso(rawDate: string): string {
  const fullYear = rawDate.match(/(\d{2})[./-](\d{2})[./-](\d{4})/);
  if (fullYear) {
    const day = Number(fullYear[1]);
    const month = Number(fullYear[2]);
    const year = Number(fullYear[3]);
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).toISOString();
  }

  const shortYear = rawDate.match(/(\d{2})[./-](\d{2})[./-](\d{2})/);
  if (shortYear) {
    const day = Number(shortYear[1]);
    const month = Number(shortYear[2]);
    const year = Number(`20${shortYear[3]}`);
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).toISOString();
  }

  const withoutYear = rawDate.match(/(\d{2})[./-](\d{2})$/);
  if (!withoutYear) return new Date().toISOString();
  const day = Number(withoutYear[1]);
  const month = Number(withoutYear[2]);
  const year = new Date().getUTCFullYear();
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).toISOString();
}

export function detectBankFromText(text: string): string {
  const normalized = normalizeHeader(text);
  if (normalized.includes('mercadopago')) return 'mercadopago';
  if (normalized.includes('nubank')) return 'nubank';
  if (normalized.includes('bancointer') || normalized.includes('inter')) return 'inter';
  if (normalized.includes('bradesco')) return 'bradesco';
  if (normalized.includes('santander')) return 'santander';
  if (normalized.includes('c6bank') || normalized.includes('c6')) return 'c6bank';
  return 'generic';
}

export function parseByDateAndCurrencyLines(context: PdfParserContext): ExtractedPdfTransaction[] {
  const pendingDescription: string[] = [];
  const extracted: ExtractedPdfTransaction[] = [];

  for (const line of context.lines) {
    const dateMatch = line.match(DATE_TOKEN_REGEX);
    const amountMatches = [...line.matchAll(AMOUNT_TOKEN_REGEX)].map(match => match[0]);

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
      confidence: description === 'Sem descricao' ? 0.35 : 0.9
    });

    pendingDescription.length = 0;
  }

  return extracted;
}

export function parseByBlockRegex(context: PdfParserContext): ExtractedPdfTransaction[] {
  const normalizedText = context.fullText.replace(/\s+/g, ' ').trim();
  const extracted: ExtractedPdfTransaction[] = [];
  const blockRegex = /(\d{2}[./-]\d{2}(?:[./-]\d{2,4})?)\s+(.+?)\s+((?:R\$\s*)?[+-]?\s*\d[\d.\s]*[,.]\d{2}-?)(?:\s+(?:R\$\s*)?[+-]?\s*\d[\d.\s]*[,.]\d{2}-?)?/g;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(normalizedText)) !== null) {
    const signedAmount = context.parseAmount(match[3]);
    if (Math.abs(signedAmount) <= 0) continue;

    const description = (match[2] || '')
      .replace(/\b\d{9,}\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'Sem descricao';

    extracted.push({
      rawDate: match[1],
      description,
      signedAmount,
      confidence: description === 'Sem descricao' ? 0.35 : 0.82
    });
  }

  return extracted;
}
