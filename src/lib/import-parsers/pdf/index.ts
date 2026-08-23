import { parseBradescoPdf } from './bradesco';
import { parseC6BankPdf } from './c6bank';
import { parseGenericPdf } from './generic';
import { parseInterPdf } from './inter';
import { parseMercadoPagoPdf } from './mercadopago';
import { parseNubankPdf } from './nubank';
import { parseSantanderPdf } from './santander';
import type { PdfBankParser } from './types';
import { parseUniversalPdfStatement } from './universal';
import { detectBankFromText } from './utils';

const BANK_PDF_PARSERS: Record<string, PdfBankParser> = {
  mercadopago: parseMercadoPagoPdf,
  nubank: parseNubankPdf,
  inter: parseInterPdf,
  bradesco: parseBradescoPdf,
  santander: parseSantanderPdf,
  c6bank: parseC6BankPdf,
  generic: parseGenericPdf,
};

export function resolvePdfBank(selectedBank: string, fullText: string): string {
  if (selectedBank && selectedBank !== 'auto') return selectedBank;
  return detectBankFromText(fullText);
}

export function getPdfBankParser(bank: string): PdfBankParser {
  const bankParser = BANK_PDF_PARSERS[bank] || parseGenericPdf;

  return (context) => {
    const bankSpecific = bankParser(context);

    // A known-bank parser wins whenever it found transactions. The universal parser is
    // recovery only; merging both sets can duplicate rows or reinterpret document/NSU
    // columns as money when a bank changes the visual layout of its PDF.
    if (bank !== 'generic' && bankSpecific.length > 0) return bankSpecific;

    const universal = parseUniversalPdfStatement(context);
    if (bankSpecific.length === 0) return universal;
    if (universal.length === 0) return bankSpecific;

    // For an unknown bank, choose one coherent interpretation instead of merging two
    // independent parsers. Prefer the parser that recovered more transaction rows.
    return universal.length > bankSpecific.length ? universal : bankSpecific;
  };
}
