
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { BankId, FileFormat, ParserResult, BankAdapter } from './types';
import { nubankAdapter } from './banks/nubank';
import { interAdapter } from './banks/inter';
import { NormalizedTransaction } from '../../types';
import { suggestCategory, generateDuplicateKey, normalizeAmount } from './utils';

const adapters: BankAdapter[] = [
  nubankAdapter,
  interAdapter,
  // Add other adapters here
];

export async function parseStatement(file: File, selectedBank: BankId = 'auto'): Promise<ParserResult> {
  const format = detectFormat(file);
  const content = await readFileContent(file, format);
  
  let bankId = selectedBank;
  if (bankId === 'auto') {
    bankId = detectBank(content, format);
  }

  const adapter = adapters.find(a => a.id === bankId);
  
  if (adapter && adapter.supportedFormats.includes(format)) {
    const transactions = await adapter.parse(content, format);
    return {
      transactions,
      detectedBank: bankId,
      detectedFormat: format,
      confidence: 0.9
    };
  }

  // Fallback to generic parser
  const transactions = await genericParse(content, format);
  return {
    transactions,
    detectedBank: bankId === 'auto' ? undefined : bankId,
    detectedFormat: format,
    confidence: 0.5
  };
}

function detectFormat(file: File): FileFormat {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'csv') return 'csv';
  if (ext === 'ofx' || ext === 'ofc') return 'ofx';
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx';
  if (ext === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg'].includes(ext || '')) return 'image';
  return 'unknown';
}

async function readFileContent(file: File, format: FileFormat): Promise<any> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    if (format === 'csv' || format === 'ofx') {
      reader.onload = (e) => {
        const text = e.target?.result as string;
        if (format === 'csv') {
          const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
          resolve(parsed.data);
        } else {
          resolve(text);
        }
      };
      reader.readAsText(file);
    } else if (format === 'xlsx') {
      reader.onload = (e) => {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(firstSheet);
        resolve(jsonData);
      };
      reader.readAsArrayBuffer(file);
    } else {
      // For PDF and images, we might need a different approach (OCR)
      resolve(file);
    }
  });
}

function detectBank(content: any, format: FileFormat): BankId {
  const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
  for (const adapter of adapters) {
    if (adapter.canHandle(contentStr, format)) {
      return adapter.id;
    }
  }
  return 'auto';
}

async function genericParse(content: any, format: FileFormat): Promise<NormalizedTransaction[]> {
  if (format === 'csv' || format === 'xlsx') {
    const rows = Array.isArray(content) ? content : [];
    return rows.map((row: any, index: number) => {
      // Try to guess columns
      const amountKey = Object.keys(row).find(k => k.toLowerCase().includes('valor') || k.toLowerCase().includes('amount') || k.toLowerCase().includes('lançamento'));
      const descKey = Object.keys(row).find(k => k.toLowerCase().includes('desc') || k.toLowerCase().includes('hist') || k.toLowerCase().includes('memo'));
      const dateKey = Object.keys(row).find(k => k.toLowerCase().includes('data') || k.toLowerCase().includes('date'));

      const amount = normalizeAmount(amountKey ? row[amountKey] : 0);
      const description = descKey ? row[descKey] : 'Sem descrição';
      const date = dateKey ? row[dateKey] : new Date().toISOString();

      const normalized: Partial<NormalizedTransaction> = {
        id: `gen-${index}-${Date.now()}`,
        bankName: 'Genérico',
        sourceFormat: format,
        transactionDate: new Date(date).toISOString(),
        description: String(description),
        normalizedDescription: String(description).toUpperCase(),
        amount: Math.abs(amount),
        direction: amount < 0 ? 'expense' : 'income',
        categorySuggested: suggestCategory(String(description)),
        categoryConfidence: 0.5,
        importConfidence: 0.5,
        rawRow: row,
        status: 'ready'
      };
      normalized.duplicateKey = generateDuplicateKey(normalized);
      return normalized as NormalizedTransaction;
    });
  }
  return [];
}
