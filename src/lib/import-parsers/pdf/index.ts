import { PdfBankParser } from './types';
import { parseMercadoPagoPdf } from './mercadopago';
import { parseNubankPdf } from './nubank';
import { parseInterPdf } from './inter';
import { parseBradescoPdf } from './bradesco';
import { parseSantanderPdf } from './santander';
import { parseC6BankPdf } from './c6bank';
import { parseGenericPdf } from './generic';
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
  return BANK_PDF_PARSERS[bank] || parseGenericPdf;
}
