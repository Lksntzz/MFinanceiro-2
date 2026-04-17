
import { NormalizedTransaction } from '../../types';

export type BankId = 'nubank' | 'inter' | 'mercadopago' | 'santander' | 'bradesco' | 'bb' | 'auto';
export type FileFormat = 'csv' | 'ofx' | 'xlsx' | 'pdf' | 'image' | 'unknown';

export interface ParserResult {
  transactions: NormalizedTransaction[];
  detectedBank?: BankId;
  detectedFormat: FileFormat;
  openingBalance?: number;
  closingBalance?: number;
  confidence: number;
}

export interface BankAdapter {
  id: BankId;
  name: string;
  supportedFormats: FileFormat[];
  canHandle: (content: string, format: FileFormat) => boolean;
  parse: (content: any, format: FileFormat) => Promise<NormalizedTransaction[]>;
}

export interface FormatAdapter {
  format: FileFormat;
  parse: (file: File) => Promise<any>;
}
