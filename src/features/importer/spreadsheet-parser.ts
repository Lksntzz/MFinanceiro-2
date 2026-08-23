import readXlsxFile from 'read-excel-file/browser';

import {
  type SpreadsheetRow,
  standardizeBankSheet,
} from '../../lib/bank-excel-normalizer';
import { parseCsvTransactions } from './csv-parser';
import { analyzeDelimitedContent } from './import-file';
import type { SpreadsheetAnalysis } from './import-types';

export async function analyzeSpreadsheetContent(
  file: File,
): Promise<SpreadsheetAnalysis> {
  const sheets = await readXlsxFile(file);
  if (!sheets.length)
    return {
      csv: '',
      nonEmptyRows: 0,
      hasHeaderKeywords: false,
      hasTransactionSignals: false,
    };

  let best: SpreadsheetAnalysis = {
    csv: '',
    nonEmptyRows: 0,
    hasHeaderKeywords: false,
    hasTransactionSignals: false,
    selectedSheetName: sheets[0].sheet,
  };
  for (const { sheet: sheetName, data: rows } of sheets) {
    // read-excel-file v9 declares date cells as `typeof Date`, although the
    // browser parser returns Date instances. Keep that upstream type mismatch
    // isolated at the adapter boundary.
    const normalizedRows = rows as unknown as SpreadsheetRow[];
    const fallbackCsv = normalizedRows
      .map((row) =>
        row
          .map((cell) => {
            const value =
              cell instanceof Date
                ? cell.toISOString().slice(0, 10)
                : String(cell ?? '');
            return /[";,\n\r]/.test(value)
              ? `"${value.replace(/"/g, '""')}"`
              : value;
          })
          .join(';'),
      )
      .join('\n');
    const csv = standardizeBankSheet(normalizedRows) || fallbackCsv;
    const analysis = analyzeDelimitedContent(csv);
    const candidate = {
      csv,
      nonEmptyRows: analysis.nonEmptyLines,
      hasHeaderKeywords: analysis.hasHeaderKeywords,
      hasTransactionSignals: analysis.hasTransactionSignals,
      selectedSheetName: sheetName,
    };
    const score = (value: SpreadsheetAnalysis) =>
      (value.hasTransactionSignals ? 1000 : 0) +
      (value.hasHeaderKeywords ? 100 : 0) +
      value.nonEmptyRows;
    if (score(candidate) > score(best)) best = candidate;
  }
  return best;
}

export async function parseSpreadsheetTransactions(
  file: File,
  selectedBank: string,
) {
  const { csv } = await analyzeSpreadsheetContent(file);
  return csv.trim() ? parseCsvTransactions(csv, selectedBank) : [];
}
