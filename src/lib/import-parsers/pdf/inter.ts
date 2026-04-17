import { PdfBankParser } from './types';
import { parseByDateAndCurrencyLines, parseByBlockRegex } from './utils';

export const parseInterPdf: PdfBankParser = (context) => {
  const fromLines = parseByDateAndCurrencyLines(context);
  if (fromLines.length > 0) return fromLines;
  return parseByBlockRegex(context);
};
