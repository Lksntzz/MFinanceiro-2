export interface ExtractedPdfTransaction {
  rawDate: string;
  description: string;
  signedAmount: number;
  sourceId?: string;
  runningBalance?: number;
  confidence?: number;
}

export interface PdfParserContext {
  lines: string[];
  fullText: string;
  normalize: (value: string) => string;
  parseAmount: (value: string | undefined) => number;
}

export type PdfBankParser = (context: PdfParserContext) => ExtractedPdfTransaction[];

