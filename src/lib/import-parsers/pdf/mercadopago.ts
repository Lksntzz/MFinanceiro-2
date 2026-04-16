import { PdfBankParser } from './types';
import { parseByDateAndCurrencyLines, parseByBlockRegex } from './utils';

export const parseMercadoPagoPdf: PdfBankParser = (context) => {
  const fromLines = parseByDateAndCurrencyLines(context);
  if (fromLines.length > 0) return fromLines;
  return parseByBlockRegex(context);
};

