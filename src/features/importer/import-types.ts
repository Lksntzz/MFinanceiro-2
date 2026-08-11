export type FileFormat = 'csv' | 'ofx' | 'pdf' | 'xls' | 'xlsx' | 'image' | 'unknown';

export interface FormatDetectionResult {
  format: FileFormat;
  formatLabel: string;
  parserLabel: string;
  parserExists: boolean;
  supported: boolean;
  reason?: string;
}

export interface ImportDiagnostics {
  fileName: string;
  mimeType: string;
  fileSize: number;
  fileLastModified: number;
  formatLabel: string;
  parserLabel: string;
  parserExists: boolean;
  supported: boolean;
  totalFound: number;
  validFound: number;
  linesExtracted: number;
  linesIgnored: number;
  rejectedLineReasons: string[];
  reason?: string;
  debugNote?: string;
  baseTextPreview?: string;
  ocrExtractionId?: string;
  ocrDocumentConfidence?: number;
}

export interface DelimitedAnalysis {
  nonEmptyLines: number;
  hasHeaderKeywords: boolean;
  hasTransactionSignals: boolean;
}

export interface SpreadsheetAnalysis {
  csv: string;
  nonEmptyRows: number;
  hasHeaderKeywords: boolean;
  hasTransactionSignals: boolean;
  selectedSheetName?: string;
}

export interface ParserDebugSummary {
  linesExtracted: number;
  linesIgnored: number;
  rejectedLineReasons: string[];
}

export interface ImportBalanceValidation {
  expectedFinal: number;
  statementFinal: number;
  diff: number;
  isClose: boolean;
}
