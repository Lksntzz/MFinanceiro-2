import * as XLSX from 'xlsx';

import { standardizeBankSheet } from '../../lib/bank-excel-normalizer';
import { analyzeDelimitedContent } from './import-file';
import { parseCsvTransactions } from './csv-parser';
import type { SpreadsheetAnalysis } from './import-types';

export async function analyzeSpreadsheetContent(file: File): Promise<SpreadsheetAnalysis> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheetNames = workbook.SheetNames || [];
  if (!sheetNames.length) return { csv: '', nonEmptyRows: 0, hasHeaderKeywords: false, hasTransactionSignals: false };

  let best: SpreadsheetAnalysis = {
    csv: '', nonEmptyRows: 0, hasHeaderKeywords: false, hasTransactionSignals: false,
    selectedSheetName: sheetNames[0],
  };
  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const csv = standardizeBankSheet(sheet) || XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    const analysis = analyzeDelimitedContent(csv);
    const candidate = { csv, nonEmptyRows: analysis.nonEmptyLines, hasHeaderKeywords: analysis.hasHeaderKeywords, hasTransactionSignals: analysis.hasTransactionSignals, selectedSheetName: sheetName };
    const score = (value: SpreadsheetAnalysis) =>
      (value.hasTransactionSignals ? 1000 : 0) + (value.hasHeaderKeywords ? 100 : 0) + value.nonEmptyRows;
    if (score(candidate) > score(best)) best = candidate;
  }
  return best;
}

export async function parseSpreadsheetTransactions(file: File, selectedBank: string) {
  const { csv } = await analyzeSpreadsheetContent(file);
  return csv.trim() ? parseCsvTransactions(csv, selectedBank) : [];
}
